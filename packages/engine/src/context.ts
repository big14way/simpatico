import type { Mailer, Notifier, PipelineMirror } from '@simpatico/actions';
import type { AgentSuite } from '@simpatico/agents';

export type { Mailer, Notifier, PipelineMirror };
import { DEFAULT_SCORING, type ScoringConfig } from '@simpatico/core';
import { Limiter, QlooClient, type DemoMode, type Transport } from '@simpatico/qloo';
import type { Store } from '@simpatico/store';

export interface EngineDeps {
  store: Store;
  /** null when QLOO_API_KEY is not configured */
  transport: Transport | null;
  limiter: Limiter;
  mode: DemoMode;
  agents: AgentSuite | null;
  notifier?: Notifier | null;
  mailer?: Mailer | null;
  mirror?: PipelineMirror | null;
  now?: () => Date;
}

export function today(deps: EngineDeps): string {
  return (deps.now ? deps.now() : new Date()).toISOString().slice(0, 10);
}

/** A Qloo client bound to one run: counts calls on the run and logs evidence with its id. */
export function qlooForRun(deps: EngineDeps, runId: string | null, opts: { mode?: DemoMode; refresh?: boolean } = {}): QlooClient {
  return new QlooClient({
    transport: deps.transport,
    cache: deps.store.cache,
    ledger: deps.store.qlooEvidence,
    limiter: deps.limiter,
    mode: opts.mode ?? deps.mode,
    refresh: opts.refresh ?? false,
    onCall: runId ? callCounter(deps, runId) : undefined,
  });
}

/** Buffers per-run call counts and flushes them in one UPDATE every second or so. */
function callCounter(deps: EngineDeps, runId: string): (e: { fromCache: boolean }) => void {
  let live = 0;
  let cached = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const l = live;
    const c = cached;
    live = 0;
    cached = 0;
    void deps.store.runs.addCalls(runId, l, c).catch(() => {});
  };
  return (e) => {
    if (e.fromCache) cached++;
    else live++;
    timer ??= setTimeout(flush, 1000);
  };
}

export async function scoringConfig(deps: EngineDeps): Promise<ScoringConfig> {
  const saved = await deps.store.settings.get<Partial<ScoringConfig>>('scoring');
  if (!saved) return DEFAULT_SCORING;
  return {
    weights: { ...DEFAULT_SCORING.weights, ...(saved.weights ?? {}) },
    flags: { ...DEFAULT_SCORING.flags, ...(saved.flags ?? {}) },
    bands: { ...DEFAULT_SCORING.bands, ...(saved.bands ?? {}) },
  };
}
