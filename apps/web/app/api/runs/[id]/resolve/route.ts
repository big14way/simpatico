import { submitResolutions, type ResolutionChoice } from '@simpatico/engine';
import { getDeps } from '@/lib/runtime';
import { body, fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const b = await body<{ choices: ResolutionChoice[] }>(req);
    if (!Array.isArray(b.choices)) return json({ error: 'choices must be an array' }, 400);
    await submitResolutions(await getDeps(), id, b.choices);
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
