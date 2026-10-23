import type { AgentSuite } from '@simpatico/agents';
import { DEFAULT_SCORING, type ScoringConfig } from '@simpatico/core';
import { Limiter, QlooClient, type DemoMode, type Transport } from '@simpatico/qloo';
import type { Store } from '@simpatico/store';

export interface Notifier {
  /** Slack (or similar) alert; returns a delivery note for the alert row */
  alert(text: string): Promise<Record<string, unknown>>;
}

export interface Mailer {
  send(msg: { to: string; subject: string; text: string }): Promise<{ id: string | null; deliveredTo: string }>;
  readonly sandbox: boolean;
  readonly sandboxInbox: string | null;
}

export interface PipelineMirror {
  /** e.g. Notion; failures are logged, never fatal */
  upsertDeal(deal: Record<string, unknown>): Promise<void>;
}

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
    onCall: runId
      ? (e) => {
          void deps.store.runs.countCall(runId, e.fromCache).catch(() => {});
        }
      : undefined,
  });
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
