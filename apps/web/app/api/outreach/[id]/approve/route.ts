import { approveAndSend } from '@simpatico/actions';
import { getDeps } from '@/lib/runtime';
import { body, clientIp, fail, json } from '@/lib/http';
import { allowPerHour } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!allowPerHour(`send:${clientIp(req)}`, 10)) return json({ error: 'Approval limit reached on the public demo; try later.' }, 429);
    const b = await body<{ recipient: string; subject: string; body: string; approvedBy?: string }>(req);
    const deps = await getDeps();
    if (!deps.mailer) return json({ error: 'No mailer configured.' }, 500);
    const draft = await approveAndSend(deps.store, deps.mailer, {
      draftId: id,
      recipient: String(b.recipient ?? '').slice(0, 200),
      subject: String(b.subject ?? '').slice(0, 200),
      body: String(b.body ?? '').slice(0, 5000),
      approvedBy: (b.approvedBy ?? 'demo reviewer').slice(0, 80),
    });
    return json({ draft, sandbox: deps.mailer.sandbox, provider: deps.mailer.provider });
  } catch (err) {
    return fail(err);
  }
}
