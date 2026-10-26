import { getStore } from '@/lib/runtime';
import { fail, json } from '@/lib/http';
import { publicDraft } from '@/lib/drafts';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const store = await getStore();
    const d = await store.outreach.get(id);
    if (!d) return json({ error: 'Draft not found.' }, 404);
    if (d.status === 'sent') return json({ error: 'Already sent.' }, 409);
    await store.outreach.update(id, { status: 'rejected', approval: null });
    const draft = await store.outreach.get(id);
    return json({ draft: draft && publicDraft(draft) });
  } catch (err) {
    return fail(err);
  }
}
