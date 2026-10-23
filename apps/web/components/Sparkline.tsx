'use client';

import { useState } from 'react';

interface Week {
  end: string;
  raw: number | null;
  rel: number | null;
}

/**
 * Momentum series: the target's -log10(trending rank) relative to the cohort median, week by
 * week. Up = gaining on the cohort. The last 4 weeks vs the 8 before give the z-score.
 */
export function Sparkline({ weeks, z }: { weeks: Week[]; z: number | null }) {
  const pts = weeks.map((w, i) => ({ i, end: w.end, v: w.rel })).filter((p): p is { i: number; end: string; v: number } => p.v !== null);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  if (pts.length < 2) return <p className="text-sm text-muted">No trending history in this window.</p>;
  const W = 560;
  const H = 120;
  const pad = { l: 8, r: 8, t: 10, b: 18 };
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const span = hi - lo || 1;
  const x = (i: number) => pad.l + (i / (weeks.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const recentStart = x(weeks.length - 4);
  const priorStart = x(weeks.length - 12);
  const hp = hover === null ? null : pts.reduce((best, p) => (Math.abs(p.i - hover) < Math.abs(best.i - hover) ? p : best), pts[0]!);

  return (
    <div className="space-y-1">
      <div className="flex justify-end text-xs">
        <button type="button" className="text-link underline" onClick={() => setTable(!table)}>
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-1">Week ending</th>
                <th className="py-1 text-right">Relative to cohort</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((p) => (
                <tr key={p.end} className="border-b border-line last:border-0">
                  <td className="num py-1">{p.end}</td>
                  <td className="num py-1 text-right">{p.v.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label={`Momentum relative to the cohort, ${weeks.length} weeks${z !== null ? `, z ${z.toFixed(2)}` : ''}`}
            onMouseMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const fx = ((e.clientX - r.left) / r.width) * W;
              setHover(Math.round(((fx - pad.l) / (W - pad.l - pad.r)) * (weeks.length - 1)));
            }}
            onMouseLeave={() => setHover(null)}
          >
            <rect x={priorStart} y={pad.t} width={recentStart - priorStart} height={H - pad.t - pad.b} fill="var(--surface-2)" />
            <rect x={recentStart} y={pad.t} width={W - pad.r - recentStart} height={H - pad.t - pad.b} fill="color-mix(in srgb, var(--series-1) 10%, transparent)" />
            <text x={priorStart + 3} y={H - 4} fontSize={9} fill="var(--text-muted)">
              prior 8 weeks
            </text>
            <text x={recentStart + 3} y={H - 4} fontSize={9} fill="var(--text-muted)">
              last 4
            </text>
            <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hp && (
              <g>
                <line x1={x(hp.i)} x2={x(hp.i)} y1={pad.t} y2={H - pad.b} stroke="var(--axis)" strokeWidth={1} />
                <circle cx={x(hp.i)} cy={y(hp.v)} r={4} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
              </g>
            )}
          </svg>
          {hp && (
            <div className="pointer-events-none absolute left-2 top-1 rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-sm">
              <span className="num">
                {hp.end}: {hp.v.toFixed(3)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
