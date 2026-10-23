// Shapes verified against live responses from https://hackathon.api.qloo.com (Oct 2026).

export const ENTITY_TYPES = [
  'urn:entity:artist',
  'urn:entity:book',
  'urn:entity:brand',
  'urn:entity:destination',
  'urn:entity:movie',
  'urn:entity:person',
  'urn:entity:place',
  'urn:entity:podcast',
  'urn:entity:tv_show',
  'urn:entity:video_game',
] as const;
export type EntityUrn = (typeof ENTITY_TYPES)[number];

export type EnvelopeStatus = 'ok' | 'empty' | 'needs_input' | 'partial' | 'degraded' | 'error';

export interface QlooErrorInfo {
  code: 'auth' | 'forbidden' | 'bad_request' | 'rate_limited' | 'server' | 'network' | 'timeout' | 'not_recorded' | 'parse';
  message: string;
  retryable: boolean;
  httpStatus?: number;
  recovery?: string;
}

/** Every gateway call returns an envelope and writes one evidence row; evidenceId points at it. */
export interface Envelope<T> {
  status: EnvelopeStatus;
  summary: string;
  results: T;
  error?: QlooErrorInfo;
  evidenceId: string;
  fromCache: boolean;
  surface: Surface;
}

/** Which Qloo surface produced the data (the provenance drawer shows it). */
export type Surface = 'rest' | 'harness';
export type DemoMode = 'live' | 'hybrid' | 'replay';

export interface EntityHit {
  id: string;
  name: string;
  types: string[];
  popularity: number | null;
  disambiguation: string | null;
  description: string | null;
  imageUrl: string | null;
  categoryTags: { id: string; name: string }[];
}

export interface InsightEntity {
  id: string;
  name: string;
  type: string | null;
  subtype: string | null;
  popularity: number | null;
  affinity: number;
  /** per-signal-entity contribution scores when feature.explainability=true */
  explainability: { entityId: string; score: number }[];
  audienceGrowth: number | null;
  disambiguation: string | null;
  imageUrl: string | null;
  categoryTags: { id: string; name: string }[];
}

export interface TagAffinity {
  id: string;
  name: string;
  subtype: string;
  affinity: number;
  popularity: number | null;
}

export const AGE_BUCKETS = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'] as const;
export const GENDERS = ['male', 'female'] as const;

export interface DemographicsRow {
  entityId: string;
  /** relative over/under-index per bucket, roughly in [-1, 1] */
  age: Record<(typeof AGE_BUCKETS)[number], number>;
  gender: Record<(typeof GENDERS)[number], number>;
}

export interface HeatCell {
  geohash: string;
  lat: number;
  lon: number;
  affinity: number;
  affinityRank: number;
  popularity: number;
}

export interface CompareTag {
  id: string;
  name: string;
  subtype: string;
  score: number | null;
  count: number | null;
}

export interface CompareResult {
  /** catalogue tags both sides carry, with Qloo's overlap score */
  shared: CompareTag[];
  aTags: CompareTag[];
  bTags: CompareTag[];
}

export interface TrendPoint {
  date: string;
  percentile: number;
  rank: number;
  rankVelocity: number;
  foldChange: number;
  percentDelta: number;
}

export interface TagHit {
  id: string;
  name: string;
  type: string;
  popularity: number | null;
}

export interface CallMeta {
  runId?: string | null;
  /** what this call is for, shown in the provenance drawer */
  purpose: string;
  /** entity ids this call is about (subject), for evidence-pack lookups */
  subjects?: string[];
  /** skip cache reads (monitor re-scores) */
  bypassCache?: boolean;
}
