// Server-side wiring: one Qloo transport (keep-alive pool), one limiter, one store per process.
import { buildAgents } from '@simpatico/agents';
import { buildActions } from '@simpatico/actions';
import type { EngineDeps } from '@simpatico/engine';
import { Limiter, RestTransport, type DemoMode } from '@simpatico/qloo';
import { createStore, getDb, type Store } from '@simpatico/store';

const g = globalThis as unknown as { __simpaticoDeps?: Promise<EngineDeps> };

export function demoMode(): DemoMode {
  const m = process.env.DEMO_MODE;
  return m === 'live' || m === 'replay' ? m : 'hybrid';
}

export function qlooConfigured(): boolean {
  return !!process.env.QLOO_API_KEY;
}

export function getDeps(): Promise<EngineDeps> {
  if (!g.__simpaticoDeps) {
    g.__simpaticoDeps = (async () => {
      const store = createStore(await getDb());
      const env = process.env;
      const actions = buildActions(env, store);
      return {
        store,
        transport: env.QLOO_API_KEY ? new RestTransport({ apiKey: env.QLOO_API_KEY, baseUrl: env.QLOO_BASE_URL || undefined }) : null,
        limiter: new Limiter({ ratePerSec: 4, burst: 8, concurrency: Math.max(1, Math.min(8, Number(env.QLOO_CONCURRENCY ?? 4) || 4)) }),
        mode: demoMode(),
        agents: buildAgents(env, { cache: store.llm }),
        notifier: actions.notifier,
        mailer: actions.mailer,
        mirror: actions.mirror,
      } satisfies EngineDeps;
    })().catch((err) => {
      g.__simpaticoDeps = undefined;
      throw err;
    });
  }
  return g.__simpaticoDeps;
}

export async function getStore(): Promise<Store> {
  return (await getDeps()).store;
}
