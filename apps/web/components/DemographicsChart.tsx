'use client';

import { useState } from 'react';

const LABELS: Record<string, string> = {
  '24_and_younger': '≤24',
  '25_to_29': '25–29',
  '30_to_34': '30–34',
  '35_to_44': '35–44',
  '45_to_54': '45–54',
  '55_and_older': '55+',
  male: 'Men',
  female: 'Women',
};

/**
 * Grouped bars around a zero baseline: Qloo's over/under-index per audience bucket for the
 * buyer (series 1) and the target (series 2). Hover for values; the table view has them all.
 */
export function DemographicsChart({ buyer, target, buyerName, targetName }: { buyer: Record<string, number>; target: Record<string, number>; buyerName: string; targetName: string }) {
  const keys = Object.keys(LABELS).filter((k) => k in buyer || k in target);
  const [hover, setHover] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(0.2, ...keys.flatMap((k) => [Math.abs(buyer[k] ?? 0), Math.abs(target[k] ?? 0)]));
  const W = 560;
  const H = 200;
  const pad = { l: 34, r: 8, t: 10, b: 26 };
  const plotH = H - pad.t - pad.b;
  const zeroY = pad.t + plotH / 2;
  const groupW = (W - pad.l - pad.r) / keys.length;
  const barW = Math.min(16, (groupW - 10) / 2);
  const y = (v: number) => zeroY - (v / max) * (plotH / 2);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex gap-4" aria-label="Legend">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-s1" aria-hidden /> {buyerName} (buyer)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-s2" aria-hidden /> {targetName}
          </span>
        </div>
        <button type="button" className="text-link underline" onClick={() => setTable(!table)}>
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-1">Audience bucket</th>
              <th className="py-1 text-right">{buyerName}</th>
              <th className="py-1 text-right">{targetName}</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k} className="border-b border-line last:border-0">
                <td className="py-1">{LABELS[k]}</td>
                <td className="num py-1 text-right">{(buyer[k] ?? 0).toFixed(2)}</td>
                <td className="num py-1 text-right">{(target[k] ?? 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Audience over- and under-index by age and gender for ${buyerName} and ${targetName}`}>
            {[-max, -max / 2, 0, max / 2, max].map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--axis)' : 'var(--hairline)'} strokeWidth={1} />
                <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-muted)" className="num">
                  {v > 0 ? '+' : ''}
                  {v.toFixed(2)}
                </text>
              </g>
            ))}
            {keys.map((k, i) => {
              const cx = pad.l + groupW * i + groupW / 2;
              const bars = [
                { v: buyer[k] ?? 0, x: cx - barW - 1, cls: 'var(--series-1)' },
                { v: target[k] ?? 0, x: cx + 1, cls: 'var(--series-2)' },
              ];
              return (
                <g key={k} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(k)} onBlur={() => setHover(null)} tabIndex={0}>
                  <rect x={cx - groupW / 2} y={pad.t} width={groupW} height={plotH} fill={hover === k ? 'var(--surface-2)' : 'transparent'} />
                  {bars.map((b, j) => {
                    const top = Math.min(y(b.v), zeroY);
                    const h = Math.max(1, Math.abs(y(b.v) - zeroY));
                    return <rect key={j} x={b.x} y={top} width={barW} height={h} rx={2} fill={b.cls} />;
                  })}
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
                    {LABELS[k]}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover && (
            <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-sm">
              <div className="font-semibold">{LABELS[hover]}</div>
              <div className="num">
                {buyerName}: {(buyer[hover] ?? 0).toFixed(2)}
              </div>
              <div className="num">
                {targetName}: {(target[hover] ?? 0).toFixed(2)}
              </div>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-muted">Relative over-index (+) or under-index (−) of each aggregate audience, from Qloo. Not individual data.</p>
    </div>
  );
}
