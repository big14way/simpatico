import type { Claim, DealType, RedFlag } from '@simpatico/core';

/** What a model sees of one evidence row (see core/evidence.modelView). */
export interface EvidenceView {
  id: string;
  label: string;
  data: Record<string, unknown>;
  /** shortlist mean per polarised path: bull cites at/above it, bear at/below */
  shortlistAverages?: Record<string, number>;
}

export interface DebateInput {
  side: 'bull' | 'bear';
  dealType: DealType;
  buyerName: string;
  targetName: string;
  evidence: EvidenceView[];
  /** flags the code rules raised; bear may surface them, bull may mitigate FADING / NO_GEO_OVERLAP */
  flags: { flag: RedFlag; rule: string }[];
  score: { F: number | null; coverage: number };
}

export interface MemoTargetInput {
  key: string;
  name: string;
  verdict: string;
  why: string;
  F: number | null;
  rank: number;
  evidence: EvidenceView[];
  acceptedClaims: { side: 'bull' | 'bear'; text: string; flag: RedFlag | null }[];
  diligenceQuestions: string[];
}

export interface MemoInput {
  dealType: DealType;
  buyerName: string;
  title: string;
  momentumAsOf: string;
  shortlistSize: number;
  target: MemoTargetInput;
  /** set on the single repair attempt after the number checker or language guard failed */
  repair?: { previous: string; unverifiedNumbers: string[]; language: string[] };
}

export interface OutreachInput {
  dealType: DealType;
  buyerName: string;
  targetName: string;
  /** a few validated facts the note may lean on (already ledger-checked) */
  facts: string[];
}

export interface AblationRankInput {
  dealType: DealType;
  buyerName: string;
  proxies: string[];
  candidates: string[];
}

/** A stored model answer. Its key covers everything that shaped it: model, effort, prompts, output schema. */
export interface LlmCacheEntry {
  kind: string;
  model: string;
  output: unknown;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface LlmCache {
  get(key: string): Promise<LlmCacheEntry | null>;
  put(key: string, entry: LlmCacheEntry): Promise<void>;
}

/** Filled in by a call, so a stage can say how many answers were replayed from the cache. */
export interface CallMeta {
  cached?: boolean;
}

export interface AgentSuite {
  /** provider/model label shown in the UI */
  readonly model: string;
  /** model behind rankWithoutQloo, when it differs from `model` */
  readonly rankerModel?: string;
  argue(input: DebateInput, meta?: CallMeta): Promise<Claim[]>;
  writeMemo(input: MemoInput, meta?: CallMeta): Promise<string>;
  draftOutreach(input: OutreachInput, meta?: CallMeta): Promise<{ subject: string; body: string }>;
  /** ablation: a model ranking the same universe with no Qloo data */
  rankWithoutQloo(input: AblationRankInput, meta?: CallMeta): Promise<{ ranking: string[]; notes: string }>;
}
