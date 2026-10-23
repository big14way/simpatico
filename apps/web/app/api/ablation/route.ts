import { runAblation } from '@simpatico/engine';
import { getDeps } from '@/lib/runtime';
import { body, clientIp, fail, json } from '@/lib/http';
import { allowPerHour } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  const runId = new URL(req.url).searchParams.get('runId');
  if (!runId) return json({ error: 'runId is required' }, 400);
  const deps = await getDeps();
  return json({ ablation: await deps.store.ablations.latestForRun(runId) });
}

export async function POST(req: Request) {
  try {
    if (!allowPerHour(`ablation:${clientIp(req)}`, 6)) return json({ error: 'Ablation limit reached on the public demo; try later.' }, 429);
    const b = await body<{ runId: string }>(req);
    if (!b.runId) return json({ error: 'runId is required' }, 400);
    return json({ ablation: await runAblation(await getDeps(), b.runId) });
  } catch (err) {
    return fail(err, 500);
  }
}
