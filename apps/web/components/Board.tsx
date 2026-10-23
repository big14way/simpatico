'use client';

import Link from 'next/link';
import { useState } from 'react';
import { VerdictBadge } from './VerdictBadge';

interface Deal {
  id: string;
  buyerName: string;
  dealType: string;
  targetName: string;
  targetId: string;
  score: number | null;
  verdict: string;
  stage: string;
  nextStep: string | null;
  lastRunId: string;
  monitored: boolean;
}

const STAGES = ['Sourced', 'Screened', 'Debated', 'IC', 'Outreach', 'Monitoring'] as const;

/** Drag a card to move a deal; keyboard users get the stage select on each card. */
export function Board({ initial }: { initial: Deal[] }) {
  const [deals, setDeals] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(id: string, stage: string) {
    const prev = deals;
    setDeals(deals.map((d) => (d.id === id ? { ...d, stage } : d)));
    const res = await fetch(`/api/pipeline/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) });
    if (!res.ok) {
      setDeals(prev);
      setError(((await res.json()) as { error?: string }).error ?? 'Could not move the deal.');
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-critical">{error}</p>}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {STAGES.map((stage) => {
          const col = deals.filter((d) => d.stage === stage);
          return (
            <section
              key={stage}
              className={`min-h-40 rounded-xl border p-2 ${dragging ? 'border-dashed border-axis' : 'border-line'} bg-surface-2`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                if (id) void move(id, stage);
                setDragging(null);
              }}
              aria-label={`${stage} column`}
            >
              <h2 className="mb-2 flex justify-between px-1 text-xs font-semibold text-ink-2">
                <span>{stage}</span>
                <span className="num">{col.length}</span>
              </h2>
              <ul className="space-y-2">
                {col.map((d) => (
                  <li
                    key={d.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', d.id);
                      setDragging(d.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className="card cursor-grab space-y-1.5 p-2.5 text-sm active:cursor-grabbing"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <Link href={`/runs/${d.lastRunId}/targets/${d.targetId}`} className="font-semibold">
                        {d.targetName}
                      </Link>
                      <span className="num text-xs text-ink-2">{d.score === null ? '' : d.score.toFixed(1)}</span>
                    </div>
                    <div className="text-xs text-muted">for {d.buyerName}</div>
                    <VerdictBadge verdict={d.verdict} />
                    {d.nextStep && <div className="text-xs text-ink-2">{d.nextStep}</div>}
                    {d.monitored && <div className="text-[11px] text-muted">monitored weekly</div>}
                    <label className="sr-only" htmlFor={`stage-${d.id}`}>
                      Stage for {d.targetName}
                    </label>
                    <select id={`stage-${d.id}`} className="input !py-0.5 !text-xs" value={d.stage} onChange={(e) => move(d.id, e.target.value)}>
                      {STAGES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
