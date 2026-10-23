// Momentum (m6) from /v2/trending.
//
// What the hackathon data looks like (checked live, Oct 2026):
//  - population_rank shifts for *every* brand at once on some dates (the population being
//    ranked changes size), so a raw rank series mixes brand momentum with universe changes;
//  - since mid-October 2025 the series is flat for every brand we checked.
// So momentum is measured relative to the screened cohort (buyer brands + shortlist): each
// week we subtract the cohort median of -log10(rank). Universe-wide shifts cancel out. A
// window where the brand and the cohort are both flat is reported as not covered, never as
// "no change".

import type { TrendPoint } from '@simpatico/qloo';
import { clamp, mean, median, sd } from './stats';

export const RECENT_WEEKS = 4;
export const PRIOR_WEEKS = 8;
/** floor on the prior-window spread, in log10-rank units (~5% rank change) */
export const SD_FLOOR = 0.02;
const MIN_COHORT_FOR_NORMALISATION = 3;

export interface MomentumInput {
  entityId: string;
  points: readonly TrendPoint[];
}

export interface WeekValue {
  /** ISO date the week ends on */
  end: string;
  raw: number | null;
  rel: number | null;
}

export interface MomentumOutcome {
  entityId: string;
  z: number | null;
  value: number | null;
  coverage: 0 | 1;
  note: string | null;
  recentMean: number | null;
  priorMean: number | null;
  priorSd: number | null;
  normalised: boolean;
  weeks: WeekValue[];
}

const DAY = 86_400_000;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Week-end dates, oldest first, the last one being asOf. */
export function weekEnds(asOf: string, weeks: number): string[] {
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(end)) throw new Error(`bad asOf date: ${asOf}`);
  return Array.from({ length: weeks }, (_, k) => isoDay(new Date(end - (weeks - 1 - k) * 7 * DAY)));
}

/**
 * -log10(rank) at each week end: the last observation on or before the week end (carried
 * forward). null before the first observation.
 */
export function weeklySeries(points: readonly TrendPoint[], ends: readonly string[]): (number | null)[] {
  const sorted = [...points].filter((p) => p.rank > 0).sort((a, b) => a.date.localeCompare(b.date));
  const out: (number | null)[] = [];
  let i = 0;
  let last: number | null = null;
  for (const end of ends) {
    while (i < sorted.length && sorted[i]!.date <= end) {
      last = -Math.log10(sorted[i]!.rank);
      i++;
    }
    out.push(last);
  }
  return out;
}

function isFlat(xs: readonly number[]): boolean {
  return xs.every((x) => Math.abs(x - xs[0]!) < 1e-12);
}

export function computeMomentum(cohort: readonly MomentumInput[], asOf: string, weeks = 24): Map<string, MomentumOutcome> {
  const span = RECENT_WEEKS + PRIOR_WEEKS;
  if (weeks < span) throw new Error(`momentum needs at least ${span} weeks`);
  const ends = weekEnds(asOf, weeks);
  const series = new Map(cohort.map((c) => [c.entityId, weeklySeries(c.points, ends)]));

  const withData = [...series.values()].filter((s) => s.slice(-span).every((v) => v !== null));
  const normalised = withData.length >= MIN_COHORT_FOR_NORMALISATION;
  const baseline: (number | null)[] = ends.map((_, w) => {
    if (!normalised) return 0;
    const vals = withData.map((s) => s[w]!).filter((v): v is number => v !== null);
    return vals.length > 0 ? median(vals) : null;
  });

  const out = new Map<string, MomentumOutcome>();
  for (const { entityId } of cohort) {
    const raw = series.get(entityId)!;
    const rel = raw.map((v, w) => (v === null || baseline[w] === null ? null : v - baseline[w]!));
    const weeksOut: WeekValue[] = ends.map((end, w) => ({ end, raw: raw[w] ?? null, rel: rel[w] ?? null }));
    const base: Omit<MomentumOutcome, 'z' | 'value' | 'coverage' | 'note'> = {
      entityId,
      recentMean: null,
      priorMean: null,
      priorSd: null,
      normalised,
      weeks: weeksOut,
    };
    const tail = rel.slice(-span);
    if (tail.some((v) => v === null)) {
      out.set(entityId, { ...base, z: null, value: null, coverage: 0, note: `Qloo has no trending history for the ${span} weeks to ${asOf}.` });
      continue;
    }
    const rawTail = raw.slice(-span) as number[];
    const baseTail = baseline.slice(-span) as number[];
    if (isFlat(rawTail) && isFlat(baseTail)) {
      out.set(entityId, {
        ...base,
        z: null,
        value: null,
        coverage: 0,
        note: `Qloo's trending series did not move for this brand or the cohort in the ${span} weeks to ${asOf}, so momentum is not measurable for this window.`,
      });
      continue;
    }
    const t = tail as number[];
    const prior = t.slice(0, PRIOR_WEEKS);
    const recent = t.slice(PRIOR_WEEKS);
    const priorMean = mean(prior);
    const recentMean = mean(recent);
    const priorSd = sd(prior);
    const z = clamp((recentMean - priorMean) / Math.max(priorSd, SD_FLOOR), -3, 3);
    out.set(entityId, {
      ...base,
      z,
      value: (z + 3) / 6,
      coverage: 1,
      note: normalised ? null : 'Not cohort-normalised: fewer than 3 brands had trending data.',
      recentMean,
      priorMean,
      priorSd,
    });
  }
  return out;
}

/** Start date for a trending request covering `weeks` weeks to asOf (plus one week of lead-in). */
export function trendingWindow(asOf: string, weeks = 24): { startDate: string; endDate: string } {
  const end = Date.parse(`${asOf}T00:00:00Z`);
  return { startDate: isoDay(new Date(end - (weeks + 1) * 7 * DAY)), endDate: asOf };
}
