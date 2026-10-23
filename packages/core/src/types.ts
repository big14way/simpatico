export const DEAL_TYPES = ['ma_bolt_on', 'licensing', 'vc_thesis'] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  ma_bolt_on: 'M&A bolt-on',
  licensing: 'Licensing / co-brand',
  vc_thesis: 'VC thesis',
};

export const METRIC_KEYS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABELS: Record<MetricKey, string> = {
  m1: 'Two-way audience affinity',
  m2: 'Taste-profile overlap',
  m3: 'Cross-domain agreement',
  m4: 'Demographic alignment',
  m5: 'Geographic footprint',
  m6: 'Momentum',
};

export type Weights = Record<MetricKey, number>;

/** 1 = fully measured, 0.5 = partial/degraded Qloo data, 0 = not measurable (excluded from F). */
export type Coverage = 0 | 0.5 | 1;

export interface MetricResult<D extends Record<string, unknown> = Record<string, unknown>> {
  key: MetricKey;
  /** in [0, 1]; null when coverage is 0 */
  value: number | null;
  coverage: Coverage;
  /** why coverage is below 1, in plain words */
  note: string | null;
  /** the numbers behind the value; claims cite paths into this object */
  data: D;
  /** Qloo evidence ids the metric was computed from */
  sources: string[];
}

export const RED_FLAGS = ['AUDIENCE_ONE_SIDED', 'TASTE_CLASH', 'DEMOGRAPHIC_MISMATCH', 'FADING', 'NO_GEO_OVERLAP'] as const;
export type RedFlag = (typeof RED_FLAGS)[number];

/** Flags a validated bull claim may mitigate (everything else is a hard stop). */
export const MITIGABLE_FLAGS: readonly RedFlag[] = ['FADING', 'NO_GEO_OVERLAP'];

export interface FlagHit {
  flag: RedFlag;
  /** the rule as shown in the UI */
  rule: string;
  observed: Record<string, number>;
}

export const VERDICTS = ['ADVANCE', 'WATCH', 'PASS', 'INSUFFICIENT_COVERAGE'] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface Cite {
  evidenceId: string;
  /** dot/bracket path into the evidence row's data, e.g. "value", "domains[0].score" */
  path: string;
  value: number;
}

export interface Claim {
  text: string;
  direction: '+' | '-';
  flag?: RedFlag | null;
  cites: Cite[];
}

/** A derived evidence row: what bull/bear see and what the judge checks claims against. */
export interface EvidenceRow {
  id: string;
  targetId: string;
  kind: 'metric' | 'profile' | 'flags' | 'score';
  metric: MetricKey | null;
  label: string;
  data: Record<string, unknown>;
  /** per numeric path: +1 higher is better, -1 lower is better, 0 descriptive */
  polarity: Record<string, 1 | -1 | 0>;
  /** per numeric path: the shortlist mean, used for the direction check */
  ref: Record<string, number>;
  sources: string[];
}
