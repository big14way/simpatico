// Drafts as the public pages and API show them. With sandbox mode on, every delivery goes to the
// builder's own inbox; the demo says so without printing that address.
export const SANDBOX_INBOX_LABEL = 'the sandbox inbox';

export function publicDraft<T extends { deliveredTo: string | null; intendedRecipient: string }>(d: T): T {
  return d.deliveredTo && d.deliveredTo !== d.intendedRecipient ? { ...d, deliveredTo: SANDBOX_INBOX_LABEL } : d;
}
