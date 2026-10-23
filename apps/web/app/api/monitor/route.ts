import { runMonitor } from '@simpatico/engine';
import { getDeps } from '@/lib/runtime';
import { body, clientIp, fail, json } from '@/lib/http';
import { allowPerHour } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const deps = await getDeps();
  return json({ runs: await deps.store.monitor.listRuns(20), alerts: await deps.store.monitor.listAlerts(50) });
}

/** "Run monitor now": re-scores every monitored deal against fresh Qloo data. */
export async function POST(req: Request) {
  try {
    if (!allowPerHour(`monitor:${clientIp(req)}`, 10)) return json({ error: 'Monitor limit reached on the public demo; try later.' }, 429);
    const b = await body<{ asOf?: string }>(req).catch(() => ({}) as { asOf?: string });
    if (b.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(b.asOf)) return json({ error: 'asOf must be YYYY-MM-DD' }, 400);
    const result = await runMonitor(await getDeps(), { trigger: 'manual', asOf: b.asOf });
    return json({ result });
  } catch (err) {
    return fail(err, 500);
  }
}
