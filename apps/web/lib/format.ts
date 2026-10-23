import { DEAL_TYPE_LABELS, type DealType } from '@simpatico/core';

export const VERDICT_STYLE: Record<string, { label: string; dot: string; text: string }> = {
  ADVANCE: { label: 'Advance', dot: 'bg-good', text: 'text-good-ink' },
  WATCH: { label: 'Watch', dot: 'bg-warn', text: 'text-ink' },
  PASS: { label: 'Pass', dot: 'bg-serious', text: 'text-ink-2' },
  INSUFFICIENT_COVERAGE: { label: 'Insufficient coverage', dot: 'bg-muted', text: 'text-muted' },
};

export function dealTypeLabel(t: string): string {
  return DEAL_TYPE_LABELS[t as DealType] ?? t;
}

export function f2(x: unknown): string {
  return typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : 'n/a';
}

export function f1(x: unknown): string {
  return typeof x === 'number' && Number.isFinite(x) ? x.toFixed(1) : 'n/a';
}

export function pct(x: unknown): string {
  return typeof x === 'number' && Number.isFinite(x) ? `${Math.round(x * 100)}%` : 'n/a';
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

export function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}
