import type { Mailer, SendResult } from './types';

export const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

/**
 * Sandbox is the default and cannot be turned off in production: a hackathon demo must
 * never email a real company. Only local development may set OUTREACH_SANDBOX=0.
 */
export function sandboxEnabled(env: Record<string, string | undefined>): boolean {
  if (env.NODE_ENV === 'production') return true;
  return env.OUTREACH_SANDBOX !== '0';
}

export class ResendMailer implements Mailer {
  readonly provider = 'resend' as const;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    readonly sandbox: boolean,
    readonly sandboxInbox: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(msg: { to: string; subject: string; text: string }): Promise<SendResult> {
    const to = this.sandbox ? this.sandboxInbox : msg.to;
    if (!to || !EMAIL_RE.test(to)) {
      throw new Error(this.sandbox ? 'Sandbox is on but OUTREACH_SANDBOX_INBOX is not a valid address.' : 'Recipient is not a valid email address.');
    }
    const subject = this.sandbox ? `[Simpatico sandbox] ${msg.subject}` : msg.subject;
    const text = this.sandbox ? `Sandbox delivery. Intended recipient: ${msg.to}. Not contacted.\n\n---\n\n${msg.text}` : msg.text;
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [to], subject, text }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) throw new Error(`Resend rejected the email (${res.status}): ${body.message ?? 'unknown error'}`);
    return { id: body.id ?? null, deliveredTo: to, simulated: false };
  }
}

/** No email provider configured: record the approval, say plainly that nothing was sent. */
export class NoMailer implements Mailer {
  readonly provider = 'none' as const;
  constructor(
    readonly sandbox: boolean,
    readonly sandboxInbox: string | null,
  ) {}
  async send(): Promise<SendResult> {
    return { id: null, deliveredTo: '', simulated: true };
  }
}
