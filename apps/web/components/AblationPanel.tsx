'use client';

import { useState } from 'react';

interface Variant {
  key: string;
  label: string;
  available: boolean;
  note: string | null;
  ranking: string[];
  tauVsFull: number | null;
  top5Overlap: number | null;
  verdictFlips: { targetId: string; name: string; from: string; to: string }[];
  advanceFlips: number;
  fameRho: number | null;
}
export interface Ablation {
  runId: string;
  createdAt: string;
  model: string | null;
  shortlist: { id: string; name: string; popularity: number | null }[];
  variants: Variant[];
  universe: { size: number; tauQlooVsLlm: number | null; top5Overlap: number | null; fameRhoQloo: number | null; fameRhoLlm: number | null; llmRanking: string[]; qlooRanking: string[] } | null;
}

const n2 = (v: number | null) => (v === null ? 'n/a' : v.toFixed(2));

export function AblationPanel({ runId, initial, names }: { runId: string; initial: Ablation | null; names: Record<string, string> }) {
  const [ab, setAb] = useState<Ablation | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => names[id] ?? id;

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/ablation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }) });
    const data = (await res.json()) as { ablation?: Ablation; error?: string };
    setBusy(false);
    if (data.ablation) setAb(data.ablation);
    else setError(data.error ?? 'Ablation failed.');
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? 'Running four variants...' : ab ? 'Re-run ablation' : 'Run ablation'}
        </button>
        {ab && <span className="text-xs text-muted">Last run {ab.createdAt.slice(0, 16).replace('T', ' ')} UTC{ab.model ? ` · LLM: ${ab.model}` : ''}</span>}
        {error && <span className="text-sm text-critical">{error}</span>}
      </div>
      {ab && (
        <>
          <section className="card overflow-x-auto p-4">
            <h2 className="font-bold">Shortlist rankings, four ways</h2>
            <table className="mt-2 w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1.5">Variant</th>
                  <th className="py-1.5 text-right">Kendall τ vs Full</th>
                  <th className="py-1.5 text-right">Top-5 overlap</th>
                  <th className="py-1.5 text-right">Verdict flips</th>
                  <th className="py-1.5 text-right">Fame bias ρ</th>
                </tr>
              </thead>
              <tbody>
                {ab.variants.map((v) => (
                  <tr key={v.key} className="border-b border-line align-top last:border-0">
                    <td className="py-1.5">
                      <div className="font-semibold">{v.label}</div>
                      {v.note && <div className="text-xs text-muted">{v.note}</div>}
                      {v.available && <div className="text-xs text-ink-2">{v.ranking.slice(0, 5).map(name).join(' › ')}</div>}
                    </td>
                    <td className="num py-1.5 text-right">{v.available ? n2(v.tauVsFull) : '—'}</td>
                    <td className="num py-1.5 text-right">{v.available && v.top5Overlap !== null ? `${Math.round(v.top5Overlap * 5)}/5` : '—'}</td>
                    <td className="py-1.5 text-right text-xs">{v.available ? (v.verdictFlips.length ? v.verdictFlips.map((f) => `${f.name}: ${f.from}→${f.to}`).join('; ') : 'none') : '—'}</td>
                    <td className="num py-1.5 text-right">{v.available ? n2(v.fameRho) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              Fame bias = Spearman correlation between a ranking and Qloo popularity (1 = ranked purely by how famous the brand is). The LLM-only variant uses the same model with no Qloo data; it can&rsquo;t give white space, demographics or momentum and can&rsquo;t check its own claims.
            </p>
          </section>
          {ab.universe && (
            <section className="card p-4">
              <h2 className="font-bold">Whole universe ({ab.universe.size} brands): Qloo vs LLM-only</h2>
              <p className="text-sm text-ink-2">
                Kendall τ {n2(ab.universe.tauQlooVsLlm)} · top-5 overlap {ab.universe.top5Overlap === null ? 'n/a' : `${Math.round(ab.universe.top5Overlap * 5)}/5`} · fame bias: Qloo {n2(ab.universe.fameRhoQloo)}, LLM-only {n2(ab.universe.fameRhoLlm)}
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="label">Qloo forward affinity</div>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm">
                    {ab.universe.qlooRanking.slice(0, 10).map((id) => (
                      <li key={id}>{name(id)}</li>
                    ))}
                  </ol>
                </div>
                <div>
                  <div className="label">LLM-only (general knowledge)</div>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm">
                    {ab.universe.llmRanking.slice(0, 10).map((id) => (
                      <li key={id}>
                        {name(id)}
                        <span className="ml-1 text-xs text-muted">(Qloo #{ab.universe!.qlooRanking.indexOf(id) + 1})</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
