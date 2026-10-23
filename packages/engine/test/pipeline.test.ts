import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Limiter } from '@simpatico/qloo';
import { createStore, openDb, type Db, type Store } from '@simpatico/store';
import type { AgentSuite } from '@simpatico/agents';
import { startRun, submitResolutions } from '../src/pipeline';
import type { EngineDeps } from '../src/context';
import type { RunState } from '../src/state';
import { fakeQloo } from './fake-qloo';

let db: Db;
let store: Store;
beforeAll(async () => {
  db = await openDb({ dataDir: null });
  store = createStore(db);
});
afterAll(async () => db.close());

const mandate = {
  title: 'Test screen',
  dealType: 'ma_bolt_on' as const,
  buyer: { name: 'Acme Group' },
  proxies: [{ name: 'Acme Chips' }],
  universe: [{ name: 'Fizz One' }, { name: 'Fizz Two' }, { name: 'Crunch Co' }, { name: 'Oat Dream' }, { name: 'Kombu' }, { name: 'Barely There' }, { name: 'Nope Brand' }],
  shortlistSize: 4,
  excludeOwned: true,
};

function deps(agents: AgentSuite | null = null): EngineDeps & { transport: ReturnType<typeof fakeQloo> } {
  return {
    store,
    transport: fakeQloo(),
    limiter: new Limiter({ ratePerSec: 1000, burst: 1000, concurrency: 8 }),
    mode: 'live',
    agents,
    now: () => new Date('2026-10-23T12:00:00Z'),
  };
}

describe('pipeline (offline, synthetic Qloo)', () => {
  it('stops for confirm chips, then runs to done without an LLM', async () => {
    const d = deps();
    const runId = await startRun(d, mandate, { wait: true });
    let run = await store.runs.get<unknown, RunState>(runId);
    expect(run!.status).toBe('needs_input');
    expect(run!.state.pending!.map((p) => p.query)).toEqual(['Acme Group']);

    await submitResolutions(d, runId, [{ role: 'buyer', index: 0, entityId: 'B-ACME' }], { wait: true });
    run = await store.runs.get<unknown, RunState>(runId);
    expect(run!.error).toBeNull();
    expect(run!.status).toBe('done');
    expect(run!.state.buyer!.signalIds).toEqual(['B-ACME', 'B-CHIPS']);
    expect(run!.state.buyer!.parent).toBe('Acme Holdings, Inc.');
    expect(run!.state.unresolved!.map((u) => u.query)).toEqual(['Nope Brand']);

    const targets = await store.targets.list(runId);
    const crunch = targets.find((t) => t.name === 'Crunch Co')!;
    expect(crunch.ownedByBuyer).toBe(true);
    expect(run!.state.shortlist).not.toContain(crunch.targetId); // excludeOwned
    const bare = targets.find((t) => t.name === 'Barely There')!;
    expect(bare.forwardAffinity).toBeNull(); // Qloo didn't score it -> never shortlisted
    expect(run!.state.shortlist).toHaveLength(4);

    const scored = targets.filter((t) => run!.state.shortlist!.includes(t.targetId));
    for (const t of scored) {
      const m = t.metrics as Record<string, { coverage: number; note: string | null }>;
      expect(m.m6!.coverage).toBe(0); // flat trending -> not covered
      expect(m.m6!.note).toMatch(/did not move/);
      expect(['ADVANCE', 'WATCH', 'PASS', 'INSUFFICIENT_COVERAGE']).toContain(t.verdict);
    }
    const rows = await store.evidence.list(runId);
    expect(rows.filter((r) => r.id.endsWith('-m1'))).toHaveLength(4);

    const memos = await store.memos.list(runId);
    expect(memos.find((m) => m.targetId === null)).toBeTruthy();
    for (const m of memos) if (!m.ok) throw new Error(`memo ${m.id} failed checks: ${JSON.stringify(m.checks)}\n${m.markdown}`);
    const deals = await store.pipeline.list();
    expect(deals.filter((x) => x.lastRunId === runId)).toHaveLength(4);
    const events = await store.runs.events(runId);
    expect(events.some((e) => e.kind === 'warn' && /debate was skipped/.test(e.message))).toBe(true);
    expect(events.at(-1)!.kind).toBe('done');

    // every Qloo call left an evidence row tied to the run
    const ev = await store.qlooEvidence.listByRun(runId);
    expect(ev.length).toBeGreaterThan(20);
    expect(ev.every((e) => e.status !== 'error')).toBe(true);
  });

  it('runs the debate through the judge and keeps rejected claims', async () => {
    const agents: AgentSuite = {
      model: 'fake-model',
      async argue(input) {
        const m1 = input.evidence.find((e) => e.id.endsWith('-m1'))!;
        const value = m1.data.value as number;
        if (input.side === 'bull') {
          return [
            { text: 'Two-way affinity is real.', direction: '+', cites: [{ evidenceId: m1.id, path: 'value', value }] },
            { text: 'Invented number.', direction: '+', cites: [{ evidenceId: m1.id, path: 'value', value: value + 0.2 }] },
          ];
        }
        return [{ text: 'Invented flag.', direction: '-', flag: 'TASTE_CLASH', cites: [{ evidenceId: m1.id, path: 'value', value }] }];
      },
      async writeMemo() {
        return 'A memo that claims 99.9% fit.';
      },
      async draftOutreach(i) {
        return { subject: `Hello ${i.targetName}`, body: 'Short note.' };
      },
      async rankWithoutQloo(i) {
        return { ranking: i.candidates, notes: '' };
      },
    };
    const d = deps(agents);
    const runId = await startRun(d, { ...mandate, buyer: { name: 'Acme Cola' } }, { wait: true });
    const run = await store.runs.get<unknown, RunState>(runId);
    expect(run!.status).toBe('done');
    const claims = await store.claims.list(runId);
    const bullOk = claims.filter((c) => c.side === 'bull' && c.accepted);
    const rejected = claims.filter((c) => !c.accepted);
    expect(bullOk.length).toBeGreaterThan(0);
    expect(rejected.some((c) => /but the ledger says/.test(c.reason!))).toBe(true);
    expect(rejected.some((c) => /bear cannot invent a flag/.test(c.reason!))).toBe(true);
    // the LLM memo invents "99.9%": blocked after one repair attempt
    const memos = (await store.memos.list(runId)).filter((m) => m.targetId !== null);
    for (const m of memos) {
      expect(m.ok).toBe(false);
      expect((m.checks as { unverifiedNumbers: string[] }).unverifiedNumbers).toContain('99.9%');
    }
  });
});

describe('call counting', () => {
  it('records every Qloo call on the run by the time the pipeline returns', async () => {
    const d = deps();
    const runId = await startRun(d, { ...mandate, buyer: { name: 'Acme Cola' } }, { wait: true });
    const run = await store.runs.get(runId);
    const ev = await store.qlooEvidence.listByRun(runId);
    expect(run!.callsLive + run!.callsCached).toBe(ev.length);
  });
});
