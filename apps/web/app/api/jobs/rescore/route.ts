import { createHmac, timingSafeEqual } from 'node:crypto';
import { runMonitor } from '@simpatico/engine';
import { getDeps } from '@/lib/runtime';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Weekly re-score, called by the GitHub Actions cron. Signed:
 *   X-Simpatico-Timestamp: unix seconds
 *   X-Simpatico-Signature: sha256=HMAC_SHA256(JOB_HMAC_SECRET, "<timestamp>.<raw body>")
 */
export async function POST(req: Request) {
  const secret = process.env.JOB_HMAC_SECRET;
  if (!secret) return json({ error: 'JOB_HMAC_SECRET is not configured.' }, 503);
  const ts = req.headers.get('x-simpatico-timestamp') ?? '';
  const sig = req.headers.get('x-simpatico-signature') ?? '';
  const raw = await req.text();
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!/^\d+$/.test(ts) || !(age < 300)) return json({ error: 'Stale or missing timestamp.' }, 401);
  const expected = `sha256=${createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')}`;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return json({ error: 'Bad signature.' }, 401);
  try {
    const result = await runMonitor(await getDeps(), { trigger: 'cron' });
    return json({ ok: true, monitorRunId: result.id, deals: result.deals.length, alerts: result.alerts });
  } catch (err) {
    return fail(err, 500);
  }
}
