import { QlooRequiredError, newId, type DemoMode } from '@simpatico/qloo';
import { stageAct } from './act';
import { stageAnalyze } from './analyze';
import { flushCallCounts, qlooForRun, today, type EngineDeps } from './context';
import { stageDebate } from './debate';
import { parseMandate, type Mandate, type MandateInput } from './mandate';
import { stageMemo } from './memo';
import { stageResolve } from './resolve';
import { QlooCallError, type RunCtx } from './run-context';
import { stageScore } from './score';
import { stageDiscover, stageScreen } from './screen';
import { STAGES, type RunState, type RunSummary, type Stage } from './state';

const running = new Set<string>();

export interface StartOptions {
  scenario?: string | null;
  /** re-query Qloo instead of serving cached responses */
  refresh?: boolean;
  /** wait for the run to finish (scripts/tests) instead of returning immediately */
  wait?: boolean;
  /** hand the background job to the host (e.g. Next's after() on serverless) */
  schedule?: (job: Promise<void>) => void;
}

export async function startRun(deps: EngineDeps, input: MandateInput, opts: StartOptions = {}): Promise<string> {
  const mandate = parseMandate(input);
  const id = newId('run');
  const runDate = today(deps);
  const state: RunState = { runDate, asOf: mandate.momentumAsOf ?? runDate, meta: { refresh: !!opts.refresh } };
  await deps.store.runs.create({ id, scenario: opts.scenario ?? null, stage: 'resolve', mandate, demoMode: opts.refresh ? 'live' : deps.mode });
  await deps.store.runs.update(id, { state });
  const job = continueRun(deps, id);
  if (opts.wait) await job;
  else if (opts.schedule) opts.schedule(job);
  else void job;
  return id;
}

/** Runs the pipeline from the run's current stage until it finishes, fails or needs input. */
export async function continueRun(deps: EngineDeps, runId: string): Promise<void> {
  if (running.has(runId)) return;
  running.add(runId);
  try {
    const run = await deps.store.runs.get<Mandate, RunState>(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    const mandate = parseMandate(run.mandate);
    const state = run.state;
    const mode: DemoMode = run.demoMode as DemoMode;
    const refresh = !!state.meta?.refresh;
    const qloo = qlooForRun(deps, runId, { mode: refresh ? 'live' : mode, refresh });
    const ctx: RunCtx = {
      deps,
      runId,
      mandate,
      state,
      qloo,
      emit: async (kind, message, data) => {
        await deps.store.runs.appendEvent(runId, kind, message, data);
      },
      save: async () => {
        await deps.store.runs.update(runId, { state });
      },
    };
    if (!ctx.qloo.canCallLive && mode !== 'replay' && mode !== 'hybrid') {
      throw new QlooRequiredError();
    }

    let stage = run.stage as Stage;
    for (let i = STAGES.indexOf(stage); i < STAGES.length; i++) {
      stage = STAGES[i]!;
      if (stage === 'done') break;
      await deps.store.runs.update(runId, { stage, status: 'running' });
      switch (stage) {
        case 'resolve': {
          const r = await stageResolve(ctx);
          if (r === 'needs_input') {
            await deps.store.runs.update(runId, { status: 'needs_input' });
            return;
          }
          break;
        }
        case 'discover':
          await stageDiscover(ctx);
          break;
        case 'screen':
          await stageScreen(ctx);
          break;
        case 'analyze':
          await stageAnalyze(ctx);
          break;
        case 'score':
          await stageScore(ctx);
          break;
        case 'debate':
          await stageDebate(ctx);
          break;
        case 'memo':
          await stageMemo(ctx);
          break;
        case 'act':
          await stageAct(ctx);
          break;
      }
    }
    const summary = await summarize(deps, runId, state);
    // event first, then status: a stream that sees the terminal status has already got the event
    await ctx.emit('done', `Done: ${Object.entries(summary.verdicts).map(([v, n]) => `${n} ${v}`).join(', ') || 'no targets scored'}.`, summary);
    await deps.store.runs.update(runId, { stage: 'done', status: 'done', summary, error: null });
  } catch (err) {
    const message =
      err instanceof QlooRequiredError || err instanceof QlooCallError ? err.message : `Unexpected error: ${(err as Error).message ?? String(err)}`;
    await deps.store.runs.appendEvent(runId, 'error', message).catch(() => {});
    await deps.store.runs.update(runId, { status: 'failed', error: message }).catch(() => {});
  } finally {
    await flushCallCounts(runId).catch(() => {});
    running.delete(runId);
  }
}

export interface ResolutionChoice {
  role: 'buyer' | 'proxy' | 'universe';
  index: number;
  /** null = drop this name */
  entityId: string | null;
  name?: string;
}

/** Apply the user's confirm-chip picks and resume the run. */
export async function submitResolutions(
  deps: EngineDeps,
  runId: string,
  choices: ResolutionChoice[],
  opts: { wait?: boolean; schedule?: (job: Promise<void>) => void } = {},
): Promise<void> {
  const run = await deps.store.runs.get<Mandate, RunState>(runId);
  if (!run) throw new Error('run not found');
  if (run.status !== 'needs_input') throw new Error('this run is not waiting for input');
  const m = parseMandate(run.mandate);
  const pending = run.state.pending ?? [];
  for (const p of pending) {
    const c = choices.find((x) => x.role === p.role && x.index === p.index);
    if (!c) throw new Error(`no choice for "${p.query}"`);
    if (c.entityId !== null && !p.candidates.some((cand) => cand.id === c.entityId)) throw new Error(`"${c.entityId}" was not offered for "${p.query}"`);
  }
  const pick = (role: ResolutionChoice['role'], index: number) => choices.find((c) => c.role === role && c.index === index);
  const named = (entityId: string, role: ResolutionChoice['role'], index: number) =>
    pending.find((p) => p.role === role && p.index === index)?.candidates.find((c) => c.id === entityId)?.name;

  const b = pick('buyer', 0);
  if (b) {
    if (!b.entityId) throw new Error('the buyer cannot be dropped');
    m.buyer = { name: named(b.entityId, 'buyer', 0) ?? m.buyer.name, entityId: b.entityId };
  }
  m.proxies = m.proxies.flatMap((p, i) => {
    const c = pick('proxy', i);
    if (!c) return [p];
    return c.entityId ? [{ name: named(c.entityId, 'proxy', i) ?? p.name, entityId: c.entityId }] : [];
  });
  m.universe = m.universe.flatMap((u, i) => {
    const c = pick('universe', i);
    if (!c) return [u];
    return c.entityId ? [{ name: named(c.entityId, 'universe', i) ?? u.name, entityId: c.entityId, ...(u.pin ? { pin: true } : {}) }] : [];
  });
  await deps.store.runs.update(runId, { mandate: m, stage: 'resolve', status: 'running', state: { ...run.state, pending: [] } });
  await deps.store.runs.appendEvent(runId, 'info', `Confirmed ${choices.filter((c) => c.entityId).length} name(s), dropped ${choices.filter((c) => !c.entityId).length}.`);
  const job = continueRun(deps, runId);
  if (opts.wait) await job;
  else if (opts.schedule) opts.schedule(job);
  else void job;
}

export async function summarize(deps: EngineDeps, runId: string, state: RunState): Promise<RunSummary> {
  const targets = await deps.store.targets.list(runId);
  const shortlist = new Set(state.shortlist ?? []);
  const sl = targets.filter((t) => shortlist.has(t.targetId));
  const claims = await deps.store.claims.list(runId);
  const memos = await deps.store.memos.list(runId);
  const drafts = await deps.store.outreach.listForRun(runId);
  const verdicts: Record<string, number> = {};
  for (const t of sl) if (t.verdict) verdicts[t.verdict] = (verdicts[t.verdict] ?? 0) + 1;
  return {
    screened: targets.length,
    shortlisted: sl.length,
    verdicts,
    claimsAccepted: claims.filter((c) => c.accepted).length,
    claimsRejected: claims.filter((c) => !c.accepted).length,
    memosBlocked: memos.filter((m) => !m.ok).length,
    outreachDrafts: drafts.length,
    agentsModel: deps.agents?.model ?? null,
    topTargets: [...sl].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 5).map((t) => ({ id: t.targetId, name: t.name, F: t.score, verdict: t.verdict ?? 'PASS' })),
  };
}
