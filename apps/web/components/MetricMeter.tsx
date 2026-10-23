import { CoverageNote } from './VerdictBadge';

/** A 0-1 metric as a thin bar with the shortlist-average tick; the value is always printed. */
export function MetricMeter({
  label,
  value,
  coverage,
  average,
  note,
  hint,
}: {
  label: string;
  value: number | null;
  coverage: number;
  average?: number | null;
  note?: string | null;
  hint?: string;
}) {
  const v = value === null ? null : Math.max(0, Math.min(1, value));
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-ink">
          {label} <CoverageNote coverage={coverage} />
        </div>
        <div className="num text-sm font-semibold text-ink">{v === null ? 'n/a' : v.toFixed(2)}</div>
      </div>
      <div className="relative mt-1.5 h-2 rounded-full bg-surface-2" role="img" aria-label={`${label}: ${v === null ? 'not measured' : v.toFixed(2)}${average != null ? `, shortlist average ${average.toFixed(2)}` : ''}`}>
        {v !== null && <div className="absolute left-0 top-0 h-2 rounded-full bg-s1" style={{ width: `${v * 100}%` }} />}
        {average != null && (
          <div className="absolute -top-1 h-4 w-0.5 rounded bg-ink" style={{ left: `calc(${Math.max(0, Math.min(1, average)) * 100}% - 1px)` }} title={`shortlist average ${average.toFixed(2)}`} />
        )}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
      {note && <div className="mt-1 text-xs text-ink-2">{note}</div>}
    </div>
  );
}
