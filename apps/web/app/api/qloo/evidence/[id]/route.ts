import { getStore } from '@/lib/runtime';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

const MAX_PREVIEW = 6000;

/** One provenance row: the redacted request (no key: it travels in a header and is never logged) and a response excerpt. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const store = await getStore();
  const ev = await store.qlooEvidence.get(id);
  if (!ev) return json({ error: 'Not found.' }, 404);
  const resp = ev.responseId ? await store.cache.getById(ev.responseId) : null;
  let preview: string | null = null;
  if (resp) {
    const text = JSON.stringify(resp.body, null, 1);
    preview = text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}\n... (${text.length - MAX_PREVIEW} more characters)` : text;
  }
  const qs = new URLSearchParams(ev.params).toString();
  return json({
    evidence: ev,
    request: `${ev.method} https://hackathon.api.qloo.com${ev.path}${qs ? `?${qs}` : ''}`,
    header: 'X-Api-Key: [redacted]',
    response: resp ? { fetchedAt: resp.fetchedAt.toISOString(), pinned: resp.pinned, preview } : null,
  });
}
