'use client';

import Link from 'next/link';
import { useState } from 'react';

interface Draft {
  id: string;
  runId: string;
  targetId: string;
  targetName: string;
  intendedRecipient: string;
  subject: string;
  body: string;
  status: string;
  deliveredTo: string | null;
  error: string | null;
  model: string | null;
  approval: { approvedAt: string; approvedBy: string; bodySha256: string } | null;
  createdAt: string;
}

function DraftCard({ d, onChange }: { d: Draft; onChange: (d: Draft) => void }) {
  const [recipient, setRecipient] = useState(d.intendedRecipient);
  const [subject, setSubject] = useState(d.subject);
  const [body, setBody] = useState(d.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = d.status === 'pending';

  async function act(kind: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/outreach/${d.id}/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: kind === 'approve' ? JSON.stringify({ recipient, subject, body, approvedBy: 'demo reviewer' }) : '{}',
    });
    const data = (await res.json()) as { draft?: Draft; error?: string };
    setBusy(false);
    if (data.draft) onChange(data.draft);
    else setError(data.error ?? 'Something went wrong.');
  }

  return (
    <article className="card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">
          <Link href={`/runs/${d.runId}/targets/${d.targetId}`}>{d.targetName}</Link>
        </h2>
        <span className="text-xs text-muted">
          {d.model ? `Drafted by ${d.model}` : 'Template draft'} · {d.status}
        </span>
      </div>
      {pending ? (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="label">Recipient</span>
            <input className="input" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="partnerships@brand.com" />
          </label>
          <label className="block space-y-1">
            <span className="label">Subject</span>
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="label">Body</span>
            <textarea className="input min-h-[180px] font-sans" value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          {error && <p className="text-sm text-critical">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={busy} onClick={() => act('approve')}>
              {busy ? 'Working...' : 'Approve and send'}
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => act('reject')}>
              Reject
            </button>
          </div>
          <p className="text-xs text-muted">The approval is bound to this exact recipient, subject and text (SHA-256). Any later edit voids it.</p>
        </div>
      ) : (
        <div className="space-y-1 text-sm">
          <div>
            <span className="label">To</span> {d.intendedRecipient || '(none)'}
          </div>
          <div>
            <span className="label">Subject</span> {d.subject}
          </div>
          <pre className="whitespace-pre-wrap rounded border border-line bg-surface-2 p-2 font-sans text-sm">{d.body}</pre>
          {d.status === 'sent' && (
            <p className="text-sm text-good-ink">
              {`Approved ${d.approval?.approvedAt.slice(0, 16).replace('T', ' ')} UTC and delivered to ${d.deliveredTo ?? 'the sandbox inbox'}${d.deliveredTo !== d.intendedRecipient ? ' (sandbox: intended recipient not contacted)' : ''}.`}
            </p>
          )}
          {d.status === 'approved' && (
            <p className="text-sm text-ink">
              Approved {d.approval?.approvedAt.slice(0, 16).replace('T', ' ')} UTC. {d.error ?? 'Not sent.'}
            </p>
          )}
          {d.status === 'failed' && <p className="text-sm text-critical">Send failed: {d.error}</p>}
          {d.status === 'rejected' && <p className="text-sm text-muted">{d.error ?? 'Rejected.'}</p>}
          {d.approval && <p className="font-mono text-[11px] text-muted">body sha256 {d.approval.bodySha256.slice(0, 16)}...</p>}
        </div>
      )}
    </article>
  );
}

export function Inbox({ initial }: { initial: Draft[] }) {
  const [drafts, setDrafts] = useState(initial);
  const update = (d: Draft) => setDrafts(drafts.map((x) => (x.id === d.id ? d : x)));
  const pending = drafts.filter((d) => d.status === 'pending');
  const done = drafts.filter((d) => d.status !== 'pending');
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-lg font-bold">Waiting for approval ({pending.length})</h2>
        {pending.length === 0 ? <p className="text-sm text-muted">Nothing waiting. ADVANCE verdicts create drafts here.</p> : pending.map((d) => <DraftCard key={d.id} d={d} onChange={update} />)}
      </section>
      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">Handled</h2>
          {done.map((d) => (
            <DraftCard key={d.id} d={d} onChange={update} />
          ))}
        </section>
      )}
    </div>
  );
}
