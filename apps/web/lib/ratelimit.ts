// A public demo shares one Qloo key: cap live work per visitor and overall.
import type { Store } from '@simpatico/store';

const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

export function allowPerHour(key: string, max: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export async function runningRuns(store: Store): Promise<number> {
  const rows = await store.db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM runs WHERE status = 'running' AND updated_at > now() - interval '10 minutes'",
  );
  return rows[0]?.n ?? 0;
}
