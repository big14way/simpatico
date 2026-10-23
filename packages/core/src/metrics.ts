// The six audience-fit metrics. Pure functions over Qloo results; every value is in [0, 1]
// and carries a coverage of 1, 0.5 or 0. Nothing here calls a model or guesses.

import type { DemographicsRow, TagAffinity } from '@simpatico/qloo';
import { AGE_BUCKETS, GENDERS } from '@simpatico/qloo';
import { TASTE_PROFILE_TAKE } from './config';
import type { MetroScore } from './geo';
import type { MomentumOutcome } from './momentum';
import { cosine, harmonic, mean, pearson, quantile, median } from './stats';
import type { Coverage, MetricResult } from './types';

// ---------------------------------------------------------------- m1 two-way affinity

export interface TwoWayInput {
  /** forward: the buyer audience's affinity for the target (rank with signal = buyer) */
  a: number | null;
  /** reverse: the target audience's affinity for each buyer brand (rank with signal = target) */
  reverse: { id: string; name: string; affinity: number }[];
  /** how many buyer brands the reverse call asked about */
  reverseExpected: number;
  sources: string[];
}

export function twoWayAffinity(inp: TwoWayInput): MetricResult {
  const data: Record<string, unknown> = { a: inp.a, b: null, ratio: null, reverse: inp.reverse };
  if (inp.a === null) {
    return { key: 'm1', value: null, coverage: 0, note: 'Qloo did not score this target against the buyer audience.', data, sources: inp.sources };
  }
  if (inp.reverse.length === 0) {
    return { key: 'm1', value: null, coverage: 0, note: "Qloo returned no reverse affinity (target audience for the buyer's brands).", data, sources: inp.sources };
  }
  const b = mean(inp.reverse.map((r) => r.affinity));
  const value = harmonic(inp.a, b);
  const ratio = Math.max(inp.a, b) === 0 ? 0 : Math.min(inp.a, b) / Math.max(inp.a, b);
  const coverage: Coverage = inp.reverse.length < inp.reverseExpected ? 0.5 : 1;
  return {
    key: 'm1',
    value,
    coverage,
    note: coverage < 1 ? `Reverse affinity covers ${inp.reverse.length} of ${inp.reverseExpected} buyer brands.` : null,
    data: { ...data, b, ratio, value },
    sources: inp.sources,
  };
}

// ---------------------------------------------------------------- m2 taste overlap

/**
 * Qloo's tag affinities cluster between 0.98 and 1.00, so they barely separate tags. Each
 * tag is weighted by its position in the profile instead: top tag 1, 50th tag 0.02.
 */
export function rankWeights(tags: readonly TagAffinity[], n = TASTE_PROFILE_TAKE): Map<string, number> {
  const out = new Map<string, number>();
  tags.slice(0, n).forEach((t, i) => {
    if (!out.has(t.id)) out.set(t.id, (n - i) / n);
  });
  return out;
}

export interface TasteInput {
  buyer: TagAffinity[];
  target: TagAffinity[];
  sources: string[];
}

export function tasteOverlap(inp: TasteInput): MetricResult {
  if (inp.buyer.length === 0 || inp.target.length === 0) {
    return {
      key: 'm2',
      value: null,
      coverage: 0,
      note: inp.buyer.length === 0 ? 'Qloo returned no taste profile for the buyer.' : 'Qloo returned no taste profile for this target.',
      data: {},
      sources: inp.sources,
    };
  }
  const wa = rankWeights(inp.buyer);
  const wb = rankWeights(inp.target);
  const union = new Set([...wa.keys(), ...wb.keys()]);
  let num = 0;
  let den = 0;
  for (const id of union) {
    const x = wa.get(id) ?? 0;
    const y = wb.get(id) ?? 0;
    num += Math.min(x, y);
    den += Math.max(x, y);
  }
  const value = den === 0 ? 0 : num / den;
  const name = new Map([...inp.buyer, ...inp.target].map((t) => [t.id, { id: t.id, name: t.name, subtype: t.subtype }]));
  const buyerTop20 = inp.buyer.slice(0, 20);
  const missing = buyerTop20.filter((t) => !wb.has(t.id));
  const shared = [...union]
    .filter((id) => wa.has(id) && wb.has(id))
    .sort((p, q) => Math.min(wa.get(q)!, wb.get(q)!) - Math.min(wa.get(p)!, wb.get(p)!))
    .slice(0, 8)
    .map((id) => name.get(id)!);
  return {
    key: 'm2',
    value,
    coverage: 1,
    note: null,
    data: {
      value,
      sharedCount: [...union].filter((id) => wa.has(id) && wb.has(id)).length,
      unionCount: union.size,
      buyerTop20MissingShare: buyerTop20.length === 0 ? 0 : missing.length / buyerTop20.length,
      shared,
      buyerOnly: missing.slice(0, 5).map((t) => ({ id: t.id, name: t.name, subtype: t.subtype })),
      targetOnly: inp.target.filter((t) => !wa.has(t.id)).slice(0, 5).map((t) => ({ id: t.id, name: t.name, subtype: t.subtype })),
    },
    sources: inp.sources,
  };
}

// ---------------------------------------------------------------- m3 cross-domain agreement

export interface DomainInput {
  type: string;
  label: string;
  /** the buyer audience's top entities in this domain, in Qloo's order */
  buyerTop: { id: string; name: string }[];
  /** the target audience's affinity for those same entities (rank restricted to buyerTop) */
  targetAffinity: { id: string; affinity: number }[];
}

export interface CrossDomainInput {
  domains: DomainInput[];
  sources: string[];
}

/**
 * For each domain: how strongly does the target's audience embrace the buyer audience's
 * favourite artists / shows / films / podcasts? Score = mean affinity over the buyer's top
 * list. The metric is the mean over domains.
 */
export function crossDomain(inp: CrossDomainInput): MetricResult {
  const domains = inp.domains.map((d) => {
    const names = new Map(d.buyerTop.map((e) => [e.id, e.name]));
    const scored = d.targetAffinity.filter((x) => names.has(x.id)).sort((p, q) => q.affinity - p.affinity);
    const returnedShare = d.buyerTop.length === 0 ? 0 : scored.length / d.buyerTop.length;
    const valid = d.buyerTop.length > 0 && scored.length > 0 && returnedShare >= 0.5;
    return {
      type: d.type,
      label: d.label,
      score: valid ? mean(scored.map((s) => s.affinity)) : null,
      returned: scored.length,
      expected: d.buyerTop.length,
      shared: scored.slice(0, 3).map((s) => ({ name: names.get(s.id)!, affinity: s.affinity })),
      clash: scored.slice(-3).reverse().map((s) => ({ name: names.get(s.id)!, affinity: s.affinity })),
    };
  });
  const valid = domains.filter((d) => d.score !== null);
  if (valid.length === 0 || valid.length < inp.domains.length / 2) {
    return {
      key: 'm3',
      value: null,
      coverage: 0,
      note: `Qloo returned usable cross-domain data for ${valid.length} of ${inp.domains.length} domains.`,
      data: { domains },
      sources: inp.sources,
    };
  }
  const value = mean(valid.map((d) => d.score!));
  const coverage: Coverage = valid.length === inp.domains.length ? 1 : 0.5;
  return {
    key: 'm3',
    value,
    coverage,
    note: coverage < 1 ? `Measured in ${valid.length} of ${inp.domains.length} domains.` : null,
    data: { value, domains },
    sources: inp.sources,
  };
}

// ---------------------------------------------------------------- m4 demographics

export function demographicVector(row: DemographicsRow): number[] {
  return [...AGE_BUCKETS.map((k) => row.age[k]), ...GENDERS.map((k) => row.gender[k])];
}

export interface DemographicsInput {
  buyer: DemographicsRow[];
  target: DemographicsRow | null;
  sources: string[];
}

/** Cosine of the (already centred) age x gender over/under-index vectors, mapped to [0, 1]. */
export function demographicAlignment(inp: DemographicsInput): MetricResult {
  if (inp.buyer.length === 0 || !inp.target) {
    return { key: 'm4', value: null, coverage: 0, note: 'Qloo returned no demographic profile for one side.', data: {}, sources: inp.sources };
  }
  const bv = demographicVector(inp.buyer[0]!).map((_, i) => mean(inp.buyer.map((r) => demographicVector(r)[i]!)));
  const tv = demographicVector(inp.target);
  const cos = cosine(bv, tv);
  const labels = [...AGE_BUCKETS, ...GENDERS];
  const asObj = (v: number[]) => Object.fromEntries(labels.map((k, i) => [k, v[i]!]));
  if (cos === null) {
    return { key: 'm4', value: null, coverage: 0, note: 'Demographic profile is flat on one side.', data: { buyer: asObj(bv), target: asObj(tv) }, sources: inp.sources };
  }
  let gapIdx = 0;
  for (let i = 1; i < labels.length; i++) if (Math.abs(bv[i]! - tv[i]!) > Math.abs(bv[gapIdx]! - tv[gapIdx]!)) gapIdx = i;
  const value = (cos + 1) / 2;
  return {
    key: 'm4',
    value,
    coverage: 1,
    note: null,
    data: {
      value,
      cosine: cos,
      buyer: asObj(bv),
      target: asObj(tv),
      biggestGap: { bucket: labels[gapIdx]!, buyer: bv[gapIdx]!, target: tv[gapIdx]! },
    },
    sources: inp.sources,
  };
}

// ---------------------------------------------------------------- m5 geographic footprint

export interface GeoInput {
  buyer: MetroScore[];
  target: MetroScore[];
  sources: string[];
  minMetros?: number;
}

/**
 * Correlation of metro-level audience affinity (Qloo heatmap affinity_rank summarised per
 * metro), mapped to [0, 1]. Correlation, not raw cosine: the scores are all positive, so a
 * raw cosine sits near 1 for any two brands. White space = metros in the target's top
 * quartile and the buyer's bottom half.
 */
export function geoFootprint(inp: GeoInput): MetricResult {
  const minMetros = inp.minMetros ?? 8;
  const bm = new Map(inp.buyer.map((m) => [m.metro, m]));
  const common = inp.target.filter((m) => bm.has(m.metro));
  if (common.length < minMetros) {
    return {
      key: 'm5',
      value: null,
      coverage: 0,
      note: `Only ${common.length} metros have Qloo heatmap data for both sides (need ${minMetros}).`,
      data: {},
      sources: inp.sources,
    };
  }
  const t = common.map((m) => m.score);
  const b = common.map((m) => bm.get(m.metro)!.score);
  const r = pearson(b, t);
  if (r === null) {
    return { key: 'm5', value: null, coverage: 0, note: 'Heatmap is flat across metros on one side.', data: {}, sources: inp.sources };
  }
  const tQ3 = quantile(t, 0.75);
  const bMed = median(b);
  const bQ3 = quantile(b, 0.75);
  const perMetro = common.map((m) => ({ metro: m.metro, lat: m.lat, lon: m.lon, target: m.score, buyer: bm.get(m.metro)!.score }));
  const whiteSpace = perMetro.filter((m) => m.target >= tQ3 && m.buyer <= bMed).sort((p, q) => q.target - p.target);
  const strongholds = perMetro.filter((m) => m.target >= tQ3 && m.buyer >= bQ3).sort((p, q) => q.target + q.buyer - (p.target + p.buyer));
  const value = (r + 1) / 2;
  return {
    key: 'm5',
    value,
    coverage: 1,
    note: null,
    data: {
      value,
      correlation: r,
      metroCount: common.length,
      whiteSpaceCount: whiteSpace.length,
      whiteSpace: whiteSpace.slice(0, 8),
      strongholds: strongholds.slice(0, 8),
      perMetro,
    },
    sources: inp.sources,
  };
}

// ---------------------------------------------------------------- m6 momentum

export function momentumMetric(outcome: MomentumOutcome | undefined, sources: string[]): MetricResult {
  if (!outcome) {
    return { key: 'm6', value: null, coverage: 0, note: 'No trending data was requested for this target.', data: {}, sources };
  }
  return {
    key: 'm6',
    value: outcome.value,
    coverage: outcome.coverage,
    note: outcome.note,
    data: {
      value: outcome.value,
      z: outcome.z,
      recentMean: outcome.recentMean,
      priorMean: outcome.priorMean,
      priorSd: outcome.priorSd,
      normalised: outcome.normalised,
      weeks: outcome.weeks,
    },
    sources,
  };
}
