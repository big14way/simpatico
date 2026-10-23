import { PIPELINE_STAGES, type PipelineStage } from '@simpatico/store';
import { getStore } from '@/lib/runtime';
import { body, fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const b = await body<{ stage?: string; owner?: string | null; nextStep?: string | null; monitored?: boolean }>(req);
    const store = await getStore();
    if (!(await store.pipeline.get(id))) return json({ error: 'Deal not found.' }, 404);
    if (b.stage !== undefined && !PIPELINE_STAGES.includes(b.stage as PipelineStage)) return json({ error: 'Unknown stage.' }, 400);
    await store.pipeline.update(id, {
      stage: b.stage as PipelineStage | undefined,
      owner: b.owner === undefined ? undefined : b.owner?.slice(0, 80) ?? null,
      nextStep: b.nextStep === undefined ? undefined : b.nextStep?.slice(0, 200) ?? null,
      monitored: typeof b.monitored === 'boolean' ? b.monitored : undefined,
    });
    return json({ deal: await store.pipeline.get(id) });
  } catch (err) {
    return fail(err);
  }
}
