import { Inbox } from '@/components/Inbox';
import { publicDraft } from '@/lib/drafts';
import { getDeps } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const deps = await getDeps();
  const drafts = (await deps.store.outreach.list()).map(publicDraft);
  const mailer = deps.mailer;
  const sends = mailer?.provider === 'resend' && (!mailer.sandbox || !!mailer.sandboxInbox);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="text-sm text-ink-2">Outreach drafted by the agents. Nothing is sent until a human approves it here.</p>
      </div>
      <div className="rounded-lg border border-warn bg-surface px-3 py-2 text-sm">
        {mailer?.provider === 'resend'
          ? mailer.sandbox
            ? mailer.sandboxInbox
              ? 'Sandbox is on: every approved email goes to the builder’s own inbox, never to the brand. The intended recipient is named inside the email.'
              : 'Sandbox is on but no sandbox inbox is set, so approvals are recorded and nothing is sent.'
            : 'Sandbox is off (local development only): approved emails go to the real recipient.'
          : 'No email provider is configured on this deployment: approvals are recorded, but nothing is sent.'}
      </div>
      <Inbox
        sends={sends}
        initial={drafts.map((d) => ({
          id: d.id,
          runId: d.runId,
          targetId: d.targetId,
          targetName: d.targetName,
          intendedRecipient: d.intendedRecipient,
          subject: d.subject,
          body: d.body,
          status: d.status,
          deliveredTo: d.deliveredTo,
          error: d.error,
          model: d.model,
          approval: d.approval ? { approvedAt: d.approval.approvedAt, approvedBy: d.approval.approvedBy, bodySha256: d.approval.bodySha256 } : null,
          createdAt: d.createdAt,
        }))}
      />
    </div>
  );
}
