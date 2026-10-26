import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QlooClient } from '@simpatico/qloo';
import type { Transport } from '@simpatico/qloo';
import { openDb, type Db } from '../src/db';
import { createStore, type Store } from '../src/repos';

let db: Db;
let store: Store;

beforeAll(async () => {
  db = await openDb({ dataDir: null });
  store = createStore(db);
});
afterAll(async () => {
  await db.close();
});

describe('schema', () => {
  it('migrations are idempotent', async () => {
    const { migrate } = await import('../src/db');
    await migrate(db);
    await migrate(db);
  });
});

describe('stored model answers', () => {
  it('round-trips structured and text answers and keeps the first write', async () => {
    expect(await store.llm.get('k1')).toBeNull();
    await store.llm.put('k1', { kind: 'argue:bull', model: 'claude-opus-5-5', output: { claims: [{ text: 'x' }] }, usage: { inputTokens: 10, outputTokens: 2 } });
    await store.llm.put('k1', { kind: 'argue:bull', model: 'other', output: { claims: [] }, usage: null });
    expect(await store.llm.get('k1')).toEqual({ kind: 'argue:bull', model: 'claude-opus-5-5', output: { claims: [{ text: 'x' }] }, usage: { inputTokens: 10, outputTokens: 2 } });
    await store.llm.put('k2', { kind: 'memo', model: 'claude-opus-5-5', output: '## Memo\n"quoted"', usage: null });
    expect(await store.llm.get('k2')).toEqual({ kind: 'memo', model: 'claude-opus-5-5', output: '## Memo\n"quoted"', usage: null });
    expect((await store.llm.stats()).answers).toBe(2);
  });
});

describe('Qloo cache + evidence (backing the gateway)', () => {
  it('works end to end with QlooClient', async () => {
    let calls = 0;
    const transport: Transport = {
      surface: 'rest',
      async request() {
        calls++;
        return { httpStatus: 200, durationMs: 3, body: { results: [{ entity_id: 'B-1', name: 'Brand One', types: ['urn:entity:brand'], properties: { akas: [] } }] } };
      },
    };
    const client = new QlooClient({ transport, cache: store.cache, ledger: store.qlooEvidence, mode: 'live' });
    await store.runs.create({ id: 'run_a', stage: 'resolve', mandate: { buyer: 'x' }, demoMode: 'live' });
    const first = await client.search('Brand One', {}, { purpose: 'resolve', runId: 'run_a', subjects: ['B-1'] });
    const second = await client.search('Brand One', {}, { purpose: 'resolve', runId: 'run_a' });
    expect(calls).toBe(1);
    expect(first.results[0]!.name).toBe('Brand One');
    expect(second.fromCache).toBe(true);
    const ev = await store.qlooEvidence.listByRun('run_a');
    expect(ev).toHaveLength(2);
    expect(ev[0]!.subjects).toEqual(['B-1']);
    expect(ev[0]!.params).toEqual({ query: 'Brand One', take: '5' });
    const resp = await store.cache.getById(ev[0]!.responseId!);
    expect(JSON.stringify(resp!.body)).not.toContain('akas');
  });

  it('respects TTL in live mode and pinned rows in hybrid/replay', async () => {
    const key = 'k-ttl';
    const old = new Date(Date.now() - 48 * 3600_000);
    await store.cache.put({ key, method: 'GET', path: '/search', params: {}, httpStatus: 200, body: { v: 1 }, fetchedAt: old, surface: 'rest' });
    expect(await store.cache.lookup(key, { maxAgeMs: 24 * 3600_000, acceptPinned: false })).toBeNull();
    expect(await store.cache.lookup(key, { maxAgeMs: null, acceptPinned: false })).not.toBeNull();
    // pin it via a run's evidence
    const row = await store.cache.lookup(key, { maxAgeMs: null, acceptPinned: false });
    await store.qlooEvidence.recordQloo({
      id: 'ev_pin', runId: 'run_pin', purpose: 'x', subjects: [], method: 'GET', path: '/search', params: {}, responseId: row!.id,
      status: 'ok', httpStatus: 200, error: null, fromCache: false, surface: 'rest', durationMs: 1, fetchedAt: old.toISOString(), summary: 's',
    });
    expect(await store.cache.pinForRun('run_pin')).toBe(1);
    expect(await store.cache.lookup(key, { maxAgeMs: 24 * 3600_000, acceptPinned: true })).not.toBeNull();
    expect((await store.cache.stats()).pinned).toBeGreaterThanOrEqual(1);
  });
});

describe('runs and events', () => {
  it('stores state, counts calls and streams events after a sequence number', async () => {
    await store.runs.create({ id: 'run_b', scenario: 'demo-a', stage: 'resolve', mandate: { dealType: 'ma_bolt_on' }, demoMode: 'hybrid' });
    const s1 = await store.runs.appendEvent('run_b', 'stage', 'Resolving 3 names');
    await store.runs.appendEvent('run_b', 'stage', 'Ranking universe', { n: 12 });
    await store.runs.countCall('run_b', false);
    await store.runs.countCall('run_b', true);
    await store.runs.update('run_b', { status: 'done', stage: 'done', state: { buyer: { ids: ['a'] } }, summary: { advance: 2 } });
    const run = await store.runs.get<{ dealType: string }, { buyer: { ids: string[] } }, { advance: number }>('run_b');
    expect(run).toMatchObject({ status: 'done', callsLive: 1, callsCached: 1, scenario: 'demo-a' });
    expect(run!.mandate.dealType).toBe('ma_bolt_on');
    expect(run!.state.buyer.ids).toEqual(['a']);
    const after = await store.runs.events('run_b', s1);
    expect(after.map((e) => e.message)).toEqual(['Ranking universe']);
    expect(after[0]!.data).toEqual({ n: 12 });
    expect((await store.runs.latestForScenario('demo-a'))!.id).toBe('run_b');
  });
});

describe('targets, evidence rows, claims, memos', () => {
  it('round-trips', async () => {
    await store.targets.upsert({
      runId: 'run_b', targetId: 'T1', key: 't1', name: 'Brand One', stage: 'analysed', screenRank: 1, forwardAffinity: 0.78, popularity: 0.9,
      imageUrl: null, profile: { foundedYear: 2005 }, metrics: { m1: { value: 0.7 } }, composite: { F: 71 }, flags: [], verdict: 'ADVANCE',
      why: 'F 71', score: 71, coverage: 1, ownedByBuyer: false, pinned: false,
    });
    await store.targets.upsert({
      runId: 'run_b', targetId: 'T2', key: null, name: 'Brand Two', stage: 'screened', screenRank: 2, forwardAffinity: 0.6, popularity: null,
      imageUrl: null, profile: null, metrics: null, composite: null, flags: null, verdict: null, why: null, score: null, coverage: null, ownedByBuyer: true, pinned: false,
    });
    const ts = await store.targets.list('run_b');
    expect(ts.map((t) => t.targetId)).toEqual(['T1', 'T2']);
    expect(ts[1]!.ownedByBuyer).toBe(true);

    await store.evidence.replaceForTarget('run_b', 'T1', [
      { id: 't1-m1', targetId: 'T1', kind: 'metric', metric: 'm1', label: 'm1', data: { value: 0.7, reverse: [{ a: 1 }] }, polarity: { value: 1 }, ref: { value: 0.6 }, sources: ['ev_1'] },
    ]);
    const rows = await store.evidence.list('run_b', 'T1');
    expect(rows[0]!.data).toEqual({ value: 0.7, reverse: [{ a: 1 }] });
    expect(rows[0]!.sources).toEqual(['ev_1']);

    await store.claims.replaceForTarget('run_b', 'T1', [
      { id: 'c1', runId: 'run_b', targetId: 'T1', side: 'bull', text: 'x', direction: '+', flag: null, cites: [{ evidenceId: 't1-m1', path: 'value', value: 0.7 }], accepted: true, reason: null, model: 'm' },
      { id: 'c2', runId: 'run_b', targetId: 'T1', side: 'bear', text: 'y', direction: '-', flag: 'FADING', cites: [], accepted: false, reason: 'bad', model: 'm' },
    ]);
    const cs = await store.claims.list('run_b', 'T1');
    expect(cs.map((c) => [c.id, c.accepted, c.flag])).toEqual([['c1', true, null], ['c2', false, 'FADING']]);

    // one insert shares one created_at: the debate's own order must survive random ids
    const claim = (id: string, text: string) => ({ id, runId: 'run_b', targetId: 'T2', side: 'bull' as const, text, direction: '+' as const, flag: null, cites: [], accepted: true, reason: null, model: 'm' });
    await store.claims.replaceForTarget('run_b', 'T2', [claim('cl_z', 'first'), claim('cl_m', 'second'), claim('cl_a', 'third')]);
    expect((await store.claims.list('run_b', 'T2')).map((c) => c.text)).toEqual(['first', 'second', 'third']);
    expect((await store.claims.list('run_b')).filter((c) => c.targetId === 'T2').map((c) => c.text)).toEqual(['first', 'second', 'third']);

    await store.memos.upsert({ id: 'memo_1', runId: 'run_b', targetId: 'T1', markdown: '# Memo', checks: { ok: true }, ok: true, model: 'm' });
    await store.memos.upsert({ id: 'memo_1', runId: 'run_b', targetId: 'T1', markdown: '# Memo v2', checks: { ok: false }, ok: false, model: 'm' });
    const memo = await store.memos.get('memo_1');
    expect(memo).toMatchObject({ markdown: '# Memo v2', ok: false });
  });
});

describe('pipeline, outreach, monitor, settings', () => {
  it('upserts deals by buyer/deal type/target and keeps monitored on', async () => {
    const a = await store.pipeline.upsert({ buyerKey: 'pepsi', buyerName: 'Pepsi', dealType: 'ma_bolt_on', targetId: 'T1', targetName: 'Brand One', imageUrl: null, score: 71, verdict: 'ADVANCE', stage: 'IC', nextStep: 'Approve outreach', lastRunId: 'run_b', monitored: true });
    const b = await store.pipeline.upsert({ buyerKey: 'pepsi', buyerName: 'Pepsi', dealType: 'ma_bolt_on', targetId: 'T1', targetName: 'Brand One', imageUrl: null, score: 66, verdict: 'WATCH', stage: 'Debated', nextStep: null, lastRunId: 'run_c' });
    expect(b.id).toBe(a.id);
    expect(b.monitored).toBe(true);
    expect(b.verdict).toBe('WATCH');
    await store.pipeline.update(a.id, { stage: 'Monitoring', owner: 'me' });
    expect((await store.pipeline.get(a.id))!.stage).toBe('Monitoring');
  });

  it('outreach lifecycle', async () => {
    await store.outreach.create({ id: 'dr_1', runId: 'run_b', pipelineId: null, targetId: 'T1', targetName: 'Brand One', intendedRecipient: 'partnerships@example.com', subject: 'Hi', body: 'Body', bodySha256: 'abc', model: 'm' });
    await store.outreach.update('dr_1', { status: 'approved', approval: { draftId: 'dr_1', targetId: 'T1', recipient: 'partnerships@example.com', subject: 'Hi', bodySha256: 'abc', approvedAt: '2026-10-23T00:00:00Z', approvedBy: 'demo' } });
    const o = await store.outreach.get('dr_1');
    expect(o!.status).toBe('approved');
    expect(o!.approval!.bodySha256).toBe('abc');
  });

  it('monitor runs, alerts, settings and ablations', async () => {
    await store.monitor.start('mon_1', 'manual', '2026-10-23');
    await store.monitor.addAlert({ id: 'al_1', monitorRunId: 'mon_1', pipelineId: 'deal_x', targetName: 'Brand One', kind: 'verdict_change', message: 'ADVANCE -> WATCH', data: { from: 'ADVANCE' } });
    await store.monitor.setDelivery('al_1', { slack: 'sent' });
    await store.monitor.finish('mon_1', 'done', { alerts: 1 });
    expect((await store.monitor.listRuns())[0]).toMatchObject({ id: 'mon_1', status: 'done', summary: { alerts: 1 } });
    expect((await store.monitor.listAlerts())[0]).toMatchObject({ id: 'al_1', delivery: { slack: 'sent' } });
    await store.settings.set('scoring', { bands: { advanceMin: 68 } });
    await store.settings.set('scoring', { bands: { advanceMin: 69 } });
    expect(await store.settings.get('scoring')).toEqual({ bands: { advanceMin: 69 } });
    expect(await store.settings.get('missing')).toBeNull();
    await store.ablations.save('ab_1', 'run_b', { tau: 0.2 });
    expect((await store.ablations.latestForRun<{ tau: number }>('run_b'))!.result.tau).toBe(0.2);
  });
});
