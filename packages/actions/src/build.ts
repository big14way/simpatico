import type { Store } from '@simpatico/store';
import { NoMailer, ResendMailer, sandboxEnabled } from './mail';
import { SlackNotifier } from './slack';
import type { Mailer, Notifier, PipelineMirror } from './types';

export interface Actions {
  mailer: Mailer;
  notifier: Notifier | null;
  mirror: PipelineMirror | null;
}

export function buildActions(env: Record<string, string | undefined>, _store?: Store): Actions {
  const sandbox = sandboxEnabled(env);
  const inbox = env.OUTREACH_SANDBOX_INBOX?.trim() || null;
  const mailer: Mailer = env.RESEND_API_KEY
    ? new ResendMailer(env.RESEND_API_KEY, env.RESEND_FROM || 'Simpatico <onboarding@resend.dev>', sandbox, inbox)
    : new NoMailer(sandbox, inbox);
  const notifier = env.SLACK_WEBHOOK_URL ? new SlackNotifier(env.SLACK_WEBHOOK_URL) : null;
  return { mailer, notifier, mirror: null };
}
