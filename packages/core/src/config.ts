import type { DealType, MetricKey, Weights } from './types';

/** Composite weights by deal type. Editable in the UI; these are the defaults. */
export const DEFAULT_WEIGHTS: Record<DealType, Weights> = {
  ma_bolt_on: { m1: 0.3, m2: 0.2, m3: 0.15, m4: 0.15, m5: 0.1, m6: 0.1 },
  licensing: { m1: 0.35, m2: 0.1, m3: 0.2, m4: 0.1, m5: 0.2, m6: 0.05 },
  vc_thesis: { m1: 0.25, m2: 0.15, m3: 0.1, m4: 0.1, m5: 0.1, m6: 0.3 },
};

export interface FlagThresholds {
  /** AUDIENCE_ONE_SIDED when min(a,b)/max(a,b) is below this */
  oneSidedRatio: number;
  /** TASTE_CLASH when more than this share of the buyer's top-20 tags is missing from the target's top-50 ... */
  tasteMissingShare: number;
  /** ... and m2 is below this */
  tasteOverlapMax: number;
  /** DEMOGRAPHIC_MISMATCH when m4 is below this */
  demographicMin: number;
  /** FADING when the momentum z-score is below this */
  fadingZ: number;
  /** NO_GEO_OVERLAP (licensing only) when m5 is below this */
  geoMin: number;
}

export const DEFAULT_FLAG_THRESHOLDS: FlagThresholds = {
  oneSidedRatio: 0.4,
  tasteMissingShare: 0.5,
  tasteOverlapMax: 0.15,
  demographicMin: 0.35,
  fadingZ: -1.5,
  geoMin: 0.2,
};

export interface VerdictBands {
  /** ADVANCE needs F at or above this and no red flag */
  advanceMin: number;
  /** WATCH needs F at or above this */
  watchMin: number;
  /** below this weighted coverage there is no score at all */
  minCoverage: number;
}

export const DEFAULT_BANDS: VerdictBands = {
  advanceMin: 70,
  watchMin: 55,
  minCoverage: 0.6,
};

export interface ScoringConfig {
  weights: Record<DealType, Weights>;
  flags: FlagThresholds;
  bands: VerdictBands;
}

export const DEFAULT_SCORING: ScoringConfig = {
  weights: DEFAULT_WEIGHTS,
  flags: DEFAULT_FLAG_THRESHOLDS,
  bands: DEFAULT_BANDS,
};

/** Tag types used for taste profiles (m2). Logistics tags (credit cards, price bands, hotel stars) are excluded. */
export const TASTE_TAG_TYPES = [
  'urn:tag:genre:music',
  'urn:tag:genre:media',
  'urn:tag:keyword:media',
  'urn:tag:genre:place',
  'urn:tag:specialty_dish:place',
] as const;

/** Cultural domains for cross-domain agreement (m3). */
export const CROSS_DOMAINS = [
  { type: 'urn:entity:artist', label: 'Music' },
  { type: 'urn:entity:tv_show', label: 'TV' },
  { type: 'urn:entity:movie', label: 'Film' },
  { type: 'urn:entity:podcast', label: 'Podcasts' },
] as const;

export const TASTE_PROFILE_TAKE = 50;
export const CROSS_DOMAIN_TAKE = 25;
export const MOMENTUM_WEEKS = 24;

export function normalizeWeights(w: Weights): Weights {
  const total = (Object.values(w) as number[]).reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error('weights must sum to a positive number');
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / total])) as Record<MetricKey, number>;
}
