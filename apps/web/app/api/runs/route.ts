import { after } from 'next/server';
import { scenario, startRun, type MandateInput } from '@simpatico/engine';
import { appOrigin, driveOptions } from '@/lib/continuation';
import { getDeps } from '@/lib/runtime';
import { body, clientIp, fail, json } from '@/lib/http';
import { allowPerHour, runningRuns } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
// the screen keeps running after the response (after()); serverless hosts cap it here
export const maxDuration = 300;

const PER_HOUR = Number(process.env.LIVE_RUNS_PER_HOUR ?? 6);
const MAX_CONCURRENT = 2;

export async function GET() {
  const deps = await getDeps();
  const runs = await deps.store.runs.list(30);
  return json({ runs: runs.map((r) => ({ id: r.id, scenario: r.scenario, status: r.status, stage: r.stage, createdAt: r.createdAt, mandate: r.mandate })) });
}

/** Start a run from a mandate, or re-run a showcase scenario live ({ scenario, refresh: true }). */
export async function POST(req: Request) {
  try {
    const deps = await getDeps();
    const b = await body<{ mandate?: MandateInput; scenario?: string; refresh?: boolean }>(req);
    if (!allowPerHour(`run:${clientIp(req)}`, PER_HOUR)) return json({ error: `Limit reached: ${PER_HOUR} live runs per hour on the public demo.` }, 429);
    if ((await runningRuns(deps.store)) >= MAX_CONCURRENT) return json({ error: 'Two screens are already running. Try again in a minute.' }, 429);
    let mandate: MandateInput;
    let slug: string | null = null;
    if (b.scenario) {
      const s = scenario(b.scenario);
      if (!s) return json({ error: 'Unknown scenario.' }, 404);
      mandate = s.mandate;
      slug = s.slug;
    } else if (b.mandate) {
      mandate = b.mandate;
    } else {
      return json({ error: 'Send a mandate or a scenario.' }, 400);
    }
    const runId = await startRun(deps, mandate, { scenario: slug, refresh: !!b.refresh, schedule: (job) => after(job), drive: driveOptions(appOrigin(req)) });
    return json({ runId }, 201);
  } catch (err) {
    return fail(err);
  }
}
