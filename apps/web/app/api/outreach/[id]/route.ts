import { editDraft } from '@simpatico/actions';
import { getStore } from '@/lib/runtime';
import { body, fail, json } from '@/lib/http';
import { publicDraft } from '@/lib/drafts';

export const dynamic = 'force-dynamic';

/** Editing a draft always clears its approval. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const b = await body<{ recipient?: string; subject?: string; body?: string }>(req);
    const store = await getStore();
    await editDraft(store, id, {
      recipient: b.recipient?.slice(0, 200),
      subject: b.subject?.slice(0, 200),
      body: b.body?.slice(0, 5000),
    });
    const draft = await store.outreach.get(id);
    return json({ draft: draft && publicDraft(draft) });
  } catch (err) {
    return fail(err);
  }
}
