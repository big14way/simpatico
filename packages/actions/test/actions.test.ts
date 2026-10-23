import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStore, openDb, type Db, type Store } from '@simpatico/store';
import { approvalMatches, approveAndSend, editDraft, sha256 } from '../src/approvals';
import { NoMailer, ResendMailer, sandboxEnabled } from '../src/mail';
import { SlackNotifier } from '../src/slack';
import { buildActions } from '../src/build';
import type { Mailer } from '../src/types';

let db: Db;
let store: Store;
beforeAll(async () => {
  db = await openDb({ dataDir: null });
  store = createStore(db);
});
afterAll(async () => db.close());

function fakeFetch(status = 200, body: unknown = { id: 'email_1' }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('sandbox', () => {
  it('is always on in production and on by default elsewhere', () => {
    expect(sandboxEnabled({ NODE_ENV: 'production', OUTREACH_SANDBOX: '0' })).toBe(true);
    expect(sandboxEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(sandboxEnabled({ NODE_ENV: 'development', OUTREACH_SANDBOX: '0' })).toBe(false);
  });

  it('rewrites the recipient to the sandbox inbox and says who was intended', async () => {
    const { f, calls } = fakeFetch();
    const m = new ResendMailer('re_test', 'Simpatico <a@b.co>', true, 'me@example.com', f);
    const r = await m.send({ to: 'partnerships@brand.example', subject: 'Hello', text: 'Body' });
    expect(r).toEqual({ id: 'email_1', deliveredTo: 'me@example.com', simulated: false });
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent.to).toEqual(['me@example.com']);
    expect(sent.subject).toBe('[Simpatico sandbox] Hello');
    expect(sent.text).toContain('Intended recipient: partnerships@brand.example. Not contacted.');
  });

  it('refuses to send when the sandbox inbox is missing', async () => {
    const m = new ResendMailer('re_test', 'x <a@b.co>', true, null, fakeFetch().f);
    await expect(m.send({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toThrow(/OUTREACH_SANDBOX_INBOX/);
  });

  it('buildActions falls back to a mailer that sends nothing', () => {
    const a = buildActions({ NODE_ENV: 'production' });
    expect(a.mailer.provider).toBe('none');
    expect(a.mailer.sandbox).toBe(true);
    expect(a.notifier).toBeNull();
  });
});

describe('slack', () => {
  it('reports delivery without throwing', async () => {
    expect(await new SlackNotifier('https://hooks.example/x', fakeFetch(200, {}).f).alert('hi')).toEqual({ slack: 'sent' });
    expect(await new SlackNotifier('https://hooks.example/x', fakeFetch(500, {}).f).alert('hi')).toEqual({ slack: 'failed', status: 500 });
  });
});

describe('approval-gated outreach', () => {
  const draft = (id: string) => ({
    id, runId: 'run_x', pipelineId: null, targetId: 'T1', targetName: 'Brand One', intendedRecipient: '', subject: 'Hi', body: 'Original body', bodySha256: sha256('Original body'), model: null,
  });

  it('binds the approval to the final text, then sends', async () => {
    await store.outreach.create(draft('d1'));
    const sentMsgs: { to: string; subject: string; text: string }[] = [];
    const mailer: Mailer = { sandbox: true, sandboxInbox: 'me@example.com', provider: 'resend', send: async (m) => (sentMsgs.push(m), { id: 'e1', deliveredTo: 'me@example.com', simulated: false }) };
    const out = await approveAndSend(store, mailer, { draftId: 'd1', recipient: 'partnerships@brand.example', subject: 'Hi there', body: 'Edited body', approvedBy: 'demo user' });
    expect(out.status).toBe('sent');
    expect(out.deliveredTo).toBe('me@example.com');
    expect(out.approval).toMatchObject({ recipient: 'partnerships@brand.example', subject: 'Hi there', bodySha256: sha256('Edited body') });
    expect(approvalMatches(out, out.approval!)).toBe(true);
    expect(sentMsgs[0]).toEqual({ to: 'partnerships@brand.example', subject: 'Hi there', text: 'Edited body' });
  });

  it('requires a valid recipient and a pending draft', async () => {
    await store.outreach.create(draft('d2'));
    const mailer = new NoMailer(true, null);
    await expect(approveAndSend(store, mailer, { draftId: 'd2', recipient: 'nope', subject: 's', body: 'b', approvedBy: 'x' })).rejects.toThrow(/valid recipient/);
    const ok = await approveAndSend(store, mailer, { draftId: 'd2', recipient: 'a@brand.example', subject: 's', body: 'b', approvedBy: 'x' });
    expect(ok.status).toBe('sent');
    expect(ok.error).toMatch(/nothing was sent/);
    await expect(approveAndSend(store, mailer, { draftId: 'd2', recipient: 'a@brand.example', subject: 's', body: 'b', approvedBy: 'x' })).rejects.toThrow(/not pending/);
  });

  it('an edit invalidates an approval', async () => {
    await store.outreach.create(draft('d3'));
    await store.outreach.update('d3', { status: 'approved', approval: { draftId: 'd3', targetId: 'T1', recipient: '', subject: 'Hi', bodySha256: sha256('Original body'), approvedAt: 'now', approvedBy: 'x' } });
    await editDraft(store, 'd3', { body: 'Changed' });
    const d = (await store.outreach.get('d3'))!;
    expect(d.status).toBe('pending');
    expect(d.approval).toBeNull();
    expect(d.bodySha256).toBe(sha256('Changed'));
  });

  it('a failed send is recorded, not swallowed', async () => {
    await store.outreach.create(draft('d4'));
    const mailer: Mailer = { sandbox: true, sandboxInbox: 'me@example.com', provider: 'resend', send: async () => { throw new Error('Resend rejected the email (422)'); } };
    await expect(approveAndSend(store, mailer, { draftId: 'd4', recipient: 'a@brand.example', subject: 's', body: 'b', approvedBy: 'x' })).rejects.toThrow(/422/);
    expect((await store.outreach.get('d4'))!.status).toBe('failed');
  });
});
