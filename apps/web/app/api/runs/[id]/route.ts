import { loadRun } from '@/lib/data';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const view = await loadRun(id);
  if (!view) return json({ error: 'Run not found.' }, 404);
  const { run } = view;
  return json({
    id: run.id,
    status: run.status,
    stage: run.stage,
    error: run.error,
    pending: run.state.pending ?? [],
    unresolved: run.state.unresolved ?? [],
    summary: run.summary,
    callsLive: run.callsLive,
    callsCached: run.callsCached,
  });
}
