import { scenario } from '@simpatico/engine';
import { getStore } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

/** Stable link for a showcase screen: redirects to its latest finished run. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!scenario(slug)) return new Response('Unknown scenario', { status: 404 });
  const run = await (await getStore()).runs.latestForScenario(slug);
  return Response.redirect(new URL(run ? `/runs/${run.id}` : '/', req.url), 302);
}
