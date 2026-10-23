export interface Notifier {
  readonly channel: string;
  /** returns a delivery note stored on the alert row */
  alert(text: string): Promise<Record<string, unknown>>;
}

export interface SendResult {
  id: string | null;
  /** where the email actually went (the sandbox inbox when sandboxed) */
  deliveredTo: string;
  simulated: boolean;
}

export interface Mailer {
  /** true: every recipient is rewritten to the sandbox inbox */
  readonly sandbox: boolean;
  readonly sandboxInbox: string | null;
  readonly provider: 'resend' | 'none';
  send(msg: { to: string; subject: string; text: string }): Promise<SendResult>;
}

export interface PipelineMirror {
  upsertDeal(deal: Record<string, unknown>): Promise<void>;
}
