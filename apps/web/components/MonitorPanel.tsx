'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Outcome {
  dealId: string;
  targetName: string;
  before: { verdict: string; F: number | null; momentumZ: number | null; shortlistRank: number | null } | null;
  after: { verdict: string; F: number | null; momentumZ: number | null; shortlistRank: number | null };
  alerts: { kind: string; message: string }[];
}
interface Result {
  id: string;
  asOf: string;
  deals: Outcome[];
  alerts: number;
  notes: string[];
}

const z = (v: number | null) => (v === null ? 'n/a' : v.toFixed(2));

export function MonitorPanel({ today }: { today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Result | null>(null);
  const [steps, setSteps] = useState<Result[] | null>(null);
  const [from, setFrom] = useState('2024-08-05');
  const [to, setTo] = useState('2024-10-28');

  async function runNow() {
    setBusy('now');
    setError(null);
    const res = await fetch('/api/monitor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = (await res.json()) as { result?: Result; error?: string };
    setBusy(null);
    if (data.result) {
      setNow(data.result);
      router.refresh();
    } else setError(data.error ?? 'Monitor failed.');
  }

  async function replay() {
    setBusy('replay');
    setError(null);
    const res = await fetch('/api/monitor/replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to }) });
    const data = (await res.json()) as { steps?: Result[]; error?: string };
    setBusy(null);
    if (data.steps) {
      setSteps(data.steps);
      router.refresh();
    } else setError(data.error ?? 'Replay failed.');
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card space-y-3 p-4">
        <h2 className="font-bold">Run monitor now</h2>
        <p className="text-sm text-ink-2">
          Re-ranks every watched deal against fresh Qloo data and refreshes the momentum window to {today}. Alerts on rank moves of 2+ places, momentum crossing ±1.5, and verdict changes.
        </p>
        <button className="btn" onClick={runNow} disabled={busy !== null}>
          {busy === 'now' ? 'Re-scoring...' : 'Run monitor now'}
        </button>
        {now && (
          <div className="space-y-1 text-sm">
            <p className="font-semibold">
              {now.deals.length} deal(s) re-scored, {now.alerts} alert(s).
            </p>
            {now.deals.map((d) => (
              <div key={d.dealId} className="text-ink-2">
                {d.targetName}: {d.before?.verdict ?? 'n/a'} → {d.after.verdict}, F {d.after.F?.toFixed(1) ?? 'n/a'}, momentum z {z(d.after.momentumZ)}
                {d.alerts.map((a, i) => (
                  <div key={i} className="font-semibold text-ink">
                    ! {a.message}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="card space-y-3 p-4">
        <h2 className="font-bold">Historical replay</h2>
        <p className="text-sm text-ink-2">
          Walks the as-of date forward week by week through Qloo&rsquo;s trending history and reports what the monitor would have flagged. Dry run: the
          pipeline is not changed. Affinity uses today&rsquo;s taste graph.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="label">From</span>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="label">To</span>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn btn-ghost" onClick={replay} disabled={busy !== null}>
            {busy === 'replay' ? 'Replaying...' : 'Replay (max 12 weeks)'}
          </button>
        </div>
        {steps && (
          <ol className="space-y-1 text-sm">
            {steps.map((s) => (
              <li key={s.id}>
                <span className="num font-semibold">{s.asOf}</span>:{' '}
                {s.alerts === 0 ? <span className="text-muted">no alerts</span> : s.deals.flatMap((d) => d.alerts).map((a, i) => <div key={i}>! {a.message}</div>)}
              </li>
            ))}
          </ol>
        )}
      </section>
      {error && <p className="text-sm text-critical lg:col-span-2">{error}</p>}
    </div>
  );
}
