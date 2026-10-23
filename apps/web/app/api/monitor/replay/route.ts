import { replayMonitor } from '@simpatico/engine';
import { getDeps } from '@/lib/runtime';
import { body, clientIp, fail, json } from '@/lib/http';
import { allowPerHour } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/** Historical replay: what the monitor would have flagged week by week (dry run). */
export async function POST(req: Request) {
  try {
    if (!allowPerHour(`replay:${clientIp(req)}`, 6)) return json({ error: 'Replay limit reached on the public demo; try later.' }, 429);
    const b = await body<{ from: string; to: string }>(req);
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(b.from ?? '') || !re.test(b.to ?? '')) return json({ error: 'from and to must be YYYY-MM-DD' }, 400);
    const steps = await replayMonitor(await getDeps(), { from: b.from, to: b.to, stepDays: 7, maxSteps: 12 });
    return json({ steps });
  } catch (err) {
    return fail(err, 500);
  }
}
