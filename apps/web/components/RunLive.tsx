'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

interface Ev {
  seq: number;
  kind: string;
  message: string;
  at: string;
}
interface Candidate {
  id: string;
  name: string;
  popularity: number | null;
  disambiguation: string | null;
  description: string | null;
}
interface Pending {
  role: 'buyer' | 'proxy' | 'universe';
  index: number;
  query: string;
  candidates: Candidate[];
}

const ICON: Record<string, string> = { stage: '▸', info: '·', progress: '✓', warn: '!', claim: '✕', needs_input: '?', done: '■', error: '✕' };

export function RunLive({ runId, initialStatus, initialEvents, initialPending }: { runId: string; initialStatus: string; initialEvents: Ev[]; initialPending: Pending[] }) {
  const router = useRouter();
  const [events, setEvents] = useState<Ev[]>(initialEvents);
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState<Pending[]>(initialPending);
  const [choices, setChoices] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const lastSeq = useRef(initialEvents.at(-1)?.seq ?? 0);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (status !== 'running') return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const open = () => {
      es = new EventSource(`/api/runs/${runId}/events?after=${lastSeq.current}`);
      es.addEventListener('log', (m) => {
        const e = JSON.parse((m as MessageEvent).data) as Ev;
        if (e.seq <= lastSeq.current) return;
        lastSeq.current = e.seq;
        setEvents((prev) => [...prev, e]);
      });
      es.addEventListener('status', async (m) => {
        const s = JSON.parse((m as MessageEvent).data) as { status: string; error?: string };
        stopped = true;
        es?.close();
        if (s.status === 'needs_input') {
          const r = (await (await fetch(`/api/runs/${runId}`)).json()) as { pending: Pending[] };
          setPending(r.pending);
        }
        setStatus(s.status);
        if (s.status === 'done' || s.status === 'failed') router.refresh();
      });
      es.onerror = () => {
        es?.close();
        if (!stopped) retry = setTimeout(open, 2000);
      };
    };
    open();
    return () => {
      stopped = true;
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [status, runId, router]);

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [events.length]);

  const key = (p: Pending) => `${p.role}:${p.index}`;
  const allChosen = pending.every((p) => key(p) in choices);

  async function submitChoices() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/runs/${runId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choices: pending.map((p) => ({ role: p.role, index: p.index, entityId: choices[key(p)] ?? null })) }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    setSubmitting(false);
    if (!data.ok) return setError(data.error ?? 'Could not continue.');
    setPending([]);
    setChoices({});
    setStatus('running');
  }

  const shown = status === 'done' ? events.slice(-14) : events;
  return (
    <section className="space-y-4">
      {status === 'needs_input' && pending.length > 0 && (
        <div className="card space-y-3 border-warn p-4">
          <div>
            <h2 className="font-bold">Confirm {pending.length} name(s)</h2>
            <p className="text-sm text-ink-2">Qloo&rsquo;s search returned matches that don&rsquo;t clearly fit these names. Simpatico never takes the first hit silently.</p>
          </div>
          {pending.map((p) => (
            <div key={key(p)} className="space-y-1.5">
              <div className="text-sm">
                <span className="label mr-2">{p.role}</span>&ldquo;{p.query}&rdquo;
              </div>
              <div className="flex flex-wrap gap-2">
                {p.candidates.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    className={`rounded-full border px-3 py-1 text-sm ${choices[key(p)] === c.id ? 'border-s1 bg-surface-2 font-semibold' : 'border-line'}`}
                    title={c.description ?? undefined}
                    onClick={() => setChoices({ ...choices, [key(p)]: c.id })}
                  >
                    {c.name}
                    {c.popularity !== null && <span className="ml-1 text-xs text-muted">pop {c.popularity.toFixed(2)}</span>}
                  </button>
                ))}
                {p.role !== 'buyer' && (
                  <button type="button" className={`rounded-full border px-3 py-1 text-sm ${key(p) in choices && choices[key(p)] === null ? 'border-critical font-semibold' : 'border-line text-muted'}`} onClick={() => setChoices({ ...choices, [key(p)]: null })}>
                    Drop it
                  </button>
                )}
              </div>
            </div>
          ))}
          {error && <p className="text-sm text-critical">{error}</p>}
          <button className="btn" disabled={!allChosen || submitting} onClick={submitChoices}>
            {submitting ? 'Continuing...' : 'Confirm and continue'}
          </button>
        </div>
      )}

      {(status !== 'done' || events.length > 0) && (
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">{status === 'running' ? 'Working...' : status === 'failed' ? 'Stopped' : status === 'needs_input' ? 'Waiting for you' : 'Run log'}</h2>
            {status === 'running' && <span className="text-xs text-muted" aria-live="polite">live</span>}
          </div>
          <ol ref={logRef} className="max-h-72 space-y-1 overflow-y-auto text-sm" aria-live="polite">
            {shown.map((e) => (
              <li key={e.seq} className={`flex gap-2 ${e.kind === 'error' || e.kind === 'claim' ? 'text-critical' : e.kind === 'warn' ? 'text-ink' : e.kind === 'stage' ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                <span aria-hidden className="w-3 shrink-0 text-center">
                  {ICON[e.kind] ?? '·'}
                </span>
                <span>{e.message}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
