import { createHash } from 'node:crypto';
import type { Approval, OutreachRecord, Store } from '@simpatico/store';
import { EMAIL_RE } from './mail';
import type { Mailer } from './types';

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** An approval is bound to exactly this draft, recipient, subject and body. */
export function bindApproval(draft: Pick<OutreachRecord, 'id' | 'targetId'>, recipient: string, subject: string, body: string, approvedBy: string): Approval {
  return {
    draftId: draft.id,
    targetId: draft.targetId,
    recipient,
    subject,
    bodySha256: sha256(body),
    approvedAt: new Date().toISOString(),
    approvedBy,
  };
}

export function approvalMatches(draft: Pick<OutreachRecord, 'id' | 'targetId' | 'subject' | 'body' | 'bodySha256' | 'intendedRecipient'>, a: Approval): boolean {
  return (
    a.draftId === draft.id &&
    a.targetId === draft.targetId &&
    a.recipient === draft.intendedRecipient &&
    a.subject === draft.subject &&
    a.bodySha256 === draft.bodySha256 &&
    sha256(draft.body) === draft.bodySha256
  );
}

export interface ApproveInput {
  draftId: string;
  recipient: string;
  subject: string;
  body: string;
  approvedBy: string;
}

/**
 * Human approval, then send. Edits are applied first and re-hashed; the approval is bound
 * to the final text, re-verified from the database, and only then handed to the mailer.
 */
export async function approveAndSend(store: Store, mailer: Mailer, inp: ApproveInput): Promise<OutreachRecord> {
  const draft = await store.outreach.get(inp.draftId);
  if (!draft) throw new Error('Draft not found.');
  if (draft.status !== 'pending') throw new Error(`This draft is ${draft.status}, not pending.`);
  const recipient = inp.recipient.trim();
  const subject = inp.subject.trim();
  const body = inp.body.replace(/\r\n/g, '\n').trim();
  if (!EMAIL_RE.test(recipient)) throw new Error('Add a valid recipient email before approving.');
  if (!subject || !body) throw new Error('Subject and body are required.');

  if (body !== draft.body || subject !== draft.subject || recipient !== draft.intendedRecipient) {
    await store.outreach.update(draft.id, { body, subject, bodySha256: sha256(body) });
    await store.db.query('UPDATE outreach SET intended_recipient = $2 WHERE id = $1', [draft.id, recipient]);
  }
  const approval = bindApproval(draft, recipient, subject, body, inp.approvedBy);
  await store.outreach.update(draft.id, { status: 'approved', approval });

  const fresh = (await store.outreach.get(draft.id))!;
  if (!fresh.approval || !approvalMatches(fresh, fresh.approval)) {
    await store.outreach.update(draft.id, { status: 'pending', approval: null, error: 'Approval did not match the stored draft; re-approve.' });
    throw new Error('Approval did not match the stored draft; nothing was sent.');
  }

  try {
    const sent = await mailer.send({ to: recipient, subject, text: body });
    await store.outreach.update(draft.id, {
      status: 'sent',
      deliveredTo: sent.simulated ? null : sent.deliveredTo,
      providerId: sent.id,
      error: sent.simulated ? 'No email provider configured: approval recorded, nothing was sent.' : null,
    });
    if (fresh.pipelineId) await store.pipeline.update(fresh.pipelineId, { stage: 'Outreach', nextStep: sent.simulated ? 'Approved (email provider not configured)' : 'Awaiting reply' });
  } catch (err) {
    await store.outreach.update(draft.id, { status: 'failed', error: (err as Error).message });
    throw err;
  }
  return (await store.outreach.get(draft.id))!;
}

/** Editing a draft clears any approval: approvals never carry over to changed text. */
export async function editDraft(store: Store, draftId: string, patch: { recipient?: string; subject?: string; body?: string }): Promise<void> {
  const draft = await store.outreach.get(draftId);
  if (!draft) throw new Error('Draft not found.');
  if (draft.status === 'sent') throw new Error('Sent drafts cannot be edited.');
  const body = patch.body !== undefined ? patch.body.replace(/\r\n/g, '\n').trim() : draft.body;
  await store.outreach.update(draftId, {
    subject: patch.subject?.trim() ?? draft.subject,
    body,
    bodySha256: sha256(body),
    status: 'pending',
    approval: null,
  });
  if (patch.recipient !== undefined) await store.db.query('UPDATE outreach SET intended_recipient = $2 WHERE id = $1', [draftId, patch.recipient.trim()]);
}
