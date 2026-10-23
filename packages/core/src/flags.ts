import type { FlagThresholds } from './config';
import type { DealType, FlagHit, MetricKey, MetricResult } from './types';

const covered = (m: MetricResult | undefined): m is MetricResult & { value: number } =>
  !!m && m.value !== null && m.coverage > 0;

function n(data: Record<string, unknown>, key: string): number | null {
  const v = data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Red flags are code rules over the metrics. Agents can surface them; they cannot invent them. */
export function redFlags(metrics: Record<MetricKey, MetricResult>, dealType: DealType, t: FlagThresholds): FlagHit[] {
  const hits: FlagHit[] = [];
  const m1 = metrics.m1;
  if (covered(m1)) {
    const ratio = n(m1.data, 'ratio');
    if (ratio !== null && ratio < t.oneSidedRatio) {
      hits.push({
        flag: 'AUDIENCE_ONE_SIDED',
        rule: `min(a, b) / max(a, b) < ${t.oneSidedRatio}`,
        observed: { ratio, a: n(m1.data, 'a') ?? NaN, b: n(m1.data, 'b') ?? NaN },
      });
    }
  }
  const m2 = metrics.m2;
  if (covered(m2)) {
    const missing = n(m2.data, 'buyerTop20MissingShare');
    if (missing !== null && missing > t.tasteMissingShare && m2.value < t.tasteOverlapMax) {
      hits.push({
        flag: 'TASTE_CLASH',
        rule: `> ${t.tasteMissingShare * 100}% of the buyer's top-20 tags missing from the target's top-50, and m2 < ${t.tasteOverlapMax}`,
        observed: { buyerTop20MissingShare: missing, m2: m2.value },
      });
    }
  }
  const m4 = metrics.m4;
  if (covered(m4) && m4.value < t.demographicMin) {
    hits.push({ flag: 'DEMOGRAPHIC_MISMATCH', rule: `m4 < ${t.demographicMin}`, observed: { m4: m4.value } });
  }
  const m6 = metrics.m6;
  if (covered(m6)) {
    const z = n(m6.data, 'z');
    if (z !== null && z < t.fadingZ) hits.push({ flag: 'FADING', rule: `momentum z < ${t.fadingZ}`, observed: { z } });
  }
  const m5 = metrics.m5;
  if (dealType === 'licensing' && covered(m5) && m5.value < t.geoMin) {
    hits.push({ flag: 'NO_GEO_OVERLAP', rule: `m5 < ${t.geoMin} (licensing deals only)`, observed: { m5: m5.value } });
  }
  return hits;
}
