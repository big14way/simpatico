import type { Notifier } from './types';

export class SlackNotifier implements Notifier {
  readonly channel = 'slack';
  constructor(
    private readonly webhookUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async alert(text: string): Promise<Record<string, unknown>> {
    try {
      const res = await this.fetchImpl(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      return res.ok ? { slack: 'sent' } : { slack: 'failed', status: res.status };
    } catch (err) {
      return { slack: 'failed', error: (err as Error).message };
    }
  }
}
