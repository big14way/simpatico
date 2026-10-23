// Run a showcase scenario end to end against live Qloo and print the outcome.
//   pnpm tsx scripts/run-scenario.ts bfy-bolt-on [--auto-confirm] [--as-of=YYYY-MM-DD]
// Uses DATABASE_URL if set, otherwise the local PGlite database in .data/pglite.
import { createStore, getDb } from '@simpatico/store';
import { Limiter, RestTransport } from '@simpatico/qloo';
import { scenario, startRun, submitResolutions, type EngineDeps, type RunState } from '@simpatico/engine';
import { buildAgents } from '@simpatico/agents';

const slug = process.argv[2];
const autoConfirm = process.argv.includes('--auto-confirm');
const asOf = process.argv.find((a) => a.startsWith('--as-of='))?.split('=')[1];
const s = slug ? scenario(slug) : undefined;
if (!s) {
  console.error('usage: run-scenario.ts <bfy-bolt-on|dodgers-collab|run-club-thesis> [--auto-confirm] [--as-of=YYYY-MM-DD]');
  process.exit(1);
}
if (!process.env.QLOO_API_KEY) {
  console.error('QLOO_API_KEY is not set');
  process.exit(1);
}

const store = createStore(await getDb());
const deps: EngineDeps = {
  store,
  transport: new RestTransport({ apiKey: process.env.QLOO_API_KEY, baseUrl: process.env.QLOO_BASE_URL }),
  limiter: new Limiter({ ratePerSec: 4, burst: 8, concurrency: Number(process.env.QLOO_CONCURRENCY ?? 4) }),
  mode: 'live',
  agents: buildAgents(process.env),
};
console.log(`agents: ${deps.agents?.model ?? 'none (debate skipped, template memos)'}`);

const t0 = Date.now();
const mandate = asOf ? { ...s.mandate, momentumAsOf: asOf } : s.mandate;
const runId = await startRun(deps, mandate, { scenario: s.slug, wait: true });
let run = await store.runs.get<unknown, RunState>(runId);
if (run?.status === 'needs_input') {
  const pending = run.state.pending ?? [];
  for (const p of pending) console.log(`confirm "${p.query}" (${p.role}): ${p.candidates.map((c) => c.name).join(' | ')}`);
  if (!autoConfirm) {
    console.log(`run ${runId} needs input; rerun with --auto-confirm to pick the expected chips`);
    process.exit(0);
  }
  // demo rule: the buyer takes its first candidate; other ambiguous names are dropped
  const choices = pending.map((p) => ({ role: p.role, index: p.index, entityId: p.role === 'buyer' ? p.candidates[0]!.id : null }));
  await submitResolutions(deps, runId, choices, { wait: true });
  run = await store.runs.get<unknown, RunState>(runId);
}
for (const e of await store.runs.events(runId)) console.log(`[${e.kind}] ${e.message}`);
console.log(`\nstatus=${run?.status} live calls=${run?.callsLive} cached=${run?.callsCached} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (run?.error) console.log(`error: ${run.error}`);
const targets = (await store.targets.list(runId)).filter((t) => t.metrics);
for (const t of targets) {
  const m = t.metrics as Record<string, { value: number | null; coverage: number; note: string | null }>;
  const fmt = (k: string) => `${k}=${m[k]?.value === null || m[k]?.value === undefined ? '--' : m[k]!.value!.toFixed(3)}${m[k]?.coverage === 0.5 ? '~' : ''}`;
  console.log(`${(t.key ?? '').padEnd(3)} ${t.name.padEnd(28)} F=${t.score?.toFixed(1) ?? 'n/a'} ${String(t.verdict).padEnd(22)} ${['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map(fmt).join(' ')} ${t.ownedByBuyer ? '[owned]' : ''}`);
}
const m6notes = new Set(targets.map((t) => (t.metrics as Record<string, { note: string | null }>).m6?.note).filter(Boolean));
for (const n of m6notes) console.log(`m6 note: ${n}`);
console.log(`\nrun id: ${runId}`);
process.exit(0);
