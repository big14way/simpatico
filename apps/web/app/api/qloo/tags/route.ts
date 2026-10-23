import { qlooForRun } from '@simpatico/engine';
import { getDeps } from '@/lib/runtime';
import { clientIp, fail, json } from '@/lib/http';
import { allowPerHour } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/** Brand-category tag search for the discovery filter (Qloo /v2/tags). */
export async function GET(req: Request) {
  try {
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
    if (q.length < 2) return json({ tags: [] });
    if (!allowPerHour(`tags:${clientIp(req)}`, 120)) return json({ error: 'Too many tag searches; slow down.' }, 429);
    const client = qlooForRun(await getDeps(), null);
    const env = await client.tags(q.slice(0, 60), { tagTypes: ['urn:tag:genre:brand'], take: 12 }, { purpose: 'tag search (mandate form)' });
    if (env.status === 'error') return json({ error: env.error?.message ?? 'Qloo error' }, 502);
    return json({ tags: env.results.map((t) => ({ id: t.id, name: t.name })) });
  } catch (err) {
    return fail(err, 500);
  }
}
