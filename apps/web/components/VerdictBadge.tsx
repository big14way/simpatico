import { VERDICT_STYLE } from '@/lib/format';

/** Status color always paired with a text label (never color alone). */
export function VerdictBadge({ verdict, size = 'sm' }: { verdict: string | null; size?: 'sm' | 'lg' }) {
  const s = VERDICT_STYLE[verdict ?? ''] ?? { label: verdict ?? 'Not scored', dot: 'bg-axis', text: 'text-muted' };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface font-semibold ${s.text} ${
        size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'
      }`}
    >
      <span aria-hidden className={`inline-block rounded-full ${s.dot} ${size === 'lg' ? 'h-2.5 w-2.5' : 'h-2 w-2'}`} />
      {s.label}
    </span>
  );
}

export function CoverageNote({ coverage }: { coverage: number }) {
  if (coverage >= 1) return null;
  return (
    <span className="rounded border border-line px-1.5 py-0.5 text-[11px] font-semibold text-muted">
      {coverage > 0 ? 'partial data' : 'not measured'}
    </span>
  );
}
