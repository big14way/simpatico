import { normalizeWeights } from './config';
import type { MetricKey, MetricResult, Weights } from './types';
import { METRIC_KEYS } from './types';

export interface Contribution {
  key: MetricKey;
  weight: number;
  coverage: number;
  value: number | null;
  /** points this metric adds to F (0-100 scale) */
  points: number;
}

export interface Composite {
  /** 0-100, or null when weighted coverage is below the minimum */
  F: number | null;
  /** sum of weight x coverage over all six metrics, in [0, 1] */
  coverage: number;
  contributions: Contribution[];
}

/**
 * F = 100 * sum(w * c * x) / sum(w * c). Metrics Qloo couldn't measure drop out of both sums
 * rather than counting as zero; if too little is measured there is no score at all.
 */
export function composite(metrics: Record<MetricKey, MetricResult>, weights: Weights, minCoverage: number): Composite {
  const w = normalizeWeights(weights);
  let num = 0;
  let den = 0;
  for (const k of METRIC_KEYS) {
    const m = metrics[k];
    if (m.value === null || m.coverage === 0) continue;
    num += w[k] * m.coverage * m.value;
    den += w[k] * m.coverage;
  }
  const coverage = den;
  const F = den > 0 && coverage + 1e-9 >= minCoverage ? (100 * num) / den : null;
  const contributions = METRIC_KEYS.map((k) => {
    const m = metrics[k];
    const covered = m.value !== null && m.coverage > 0;
    return {
      key: k,
      weight: w[k],
      coverage: covered ? m.coverage : 0,
      value: m.value,
      points: covered && den > 0 ? (100 * w[k] * m.coverage * m.value!) / den : 0,
    };
  });
  return { F, coverage, contributions };
}
