import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Limiter } from '@simpatico/qloo';
import { createStore, openDb, type Db, type Store } from '@simpatico/store';
import type { AgentSuite } from '@simpatico/agents';
import { startRun } from '../src/pipeline';
import { runMonitor, replayMonitor } from '../src/monitor';
import { runAblation } from '../src/ablation';
import type { EngineDeps } from '../src/context';
import { fakeQloo } from './fake-qloo';

let db: Db;
let store: Store;
let runId: string;
const alerts: string[] = [];

function deps(agents: AgentSuite | null = null): EngineDeps {
  return {
    store,
    transport: fakeQloo(),
    limiter: new Limiter({ ratePerSec: 1000, burst: 1000, concurrency: 8 }),
    mode: 'live',
    agents,
    notifier: { channel: 'test', alert: async (t) => (alerts.push(t), { test: 'sent' }) },
    now: () => new Date('2026-10-23T12:00:00Z'),
  };
}

beforeAll(async () => {
  db = await openDb({ dataDir: null });
  store = createStore(db);
  runId = await startRun(deps(), {
    dealType: 'licensing',
    buyer: { name: 'Acme Cola' },
    proxies: [],
    universe: [{ name: 'Fizz One' }, { name: 'Fizz Two' }, { name: 'Oat Dream' }, { name: 'Kombu' }],
    shortlistSize: 4,
  }, { wait: true });
  // keep every deal under watch for the test
  for (const d of await store.pipeline.list()) await store.pipeline.update(d.id, { monitored: true });
});
afterAll(async () => db.close());

describe('monitor', () => {
  it('re-scores monitored deals and stays quiet when nothing moved', async () => {
    const run = await store.runs.get(runId);
    expect(run!.status).toBe('done');
    const r = await runMonitor(deps(), { trigger: 'manual' });
    expect(r.deals).toHaveLength(4);
    expect(r.alerts).toBe(0);
    expect((await store.monitor.listRuns())[0]).toMatchObject({ id: r.id, status: 'done' });
  });

  it('alerts on a verdict change and a rank move, and notifies', async () => {
    const deal = (await store.pipeline.list())[0]!;
    const snap = deal.lastSnapshot!;
    await store.pipeline.update(deal.id, { lastSnapshot: { ...snap, verdict: 'SOMETHING_ELSE', shortlistRank: 9 } });
    const r = await runMonitor(deps(), { trigger: 'manual' });
    const mine = r.deals.find((d) => d.dealId === deal.id)!;
    expect(mine.alerts.map((a) => a.kind).sort()).toEqual(['rank_move', 'verdict_change']);
    const stored = await store.monitor.listAlerts();
    expect(stored.some((a) => a.pipelineId === deal.id && a.kind === 'verdict_change' && a.delivery?.test === 'sent')).toBe(true);
    expect(alerts.some((t) => t.includes(deal.targetName))).toBe(true);
  });

  it('replay is a dry run: reports per step, leaves the pipeline alone', async () => {
    const before = await store.pipeline.list();
    const steps = await replayMonitor(deps(), { from: '2024-08-05', to: '2024-08-26', stepDays: 7 });
    expect(steps.map((s) => s.asOf)).toEqual(['2024-08-12', '2024-08-19', '2024-08-26']);
    expect(steps[0]!.notes[0]).toMatch(/trending history to 2024-08-12/);
    const after = await store.pipeline.list();
    expect(after.map((d) => d.lastSnapshot)).toEqual(before.map((d) => d.lastSnapshot));
  });
});

describe('ablation', () => {
  it('compares variants; LLM-only is marked unavailable without a model', async () => {
    const r = await runAblation(deps(), runId);
    const byKey = Object.fromEntries(r.variants.map((v) => [v.key, v]));
    expect(byKey.full!.tauVsFull).toBe(1);
    expect(byKey.llm_only!.available).toBe(false);
    expect(byKey.llm_only!.note).toMatch(/No LLM/);
    expect(byKey.minus_cross_domain!.available).toBe(true);
    expect(byKey.minus_two_way!.ranking.length).toBeGreaterThan(0);
    expect(r.universe).toBeNull();
    expect((await store.ablations.latestForRun(runId))!.result).toBeTruthy();
  });

  it('with a model, compares Qloo against an LLM-only ranking', async () => {
    const agents: AgentSuite = {
      model: 'fake',
      argue: async () => [],
      writeMemo: async () => 'x',
      draftOutreach: async () => ({ subject: 's', body: 'b' }),
      rankWithoutQloo: async (i) => ({ ranking: [...i.candidates].reverse(), notes: 'reversed' }),
    };
    const r = await runAblation(deps(agents), runId);
    const llm = r.variants.find((v) => v.key === 'llm_only')!;
    expect(llm.available).toBe(true);
    expect(llm.tauVsFull).not.toBeNull();
    expect(r.universe!.size).toBe(4);
    expect(r.universe!.llmRanking).toHaveLength(4);
  });
});
