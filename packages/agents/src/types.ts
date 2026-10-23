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
  runDate: string;
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

export interface AgentSuite {
  /** provider/model label shown in the UI */
  readonly model: string;
  argue(input: DebateInput): Promise<Claim[]>;
  writeMemo(input: MemoInput): Promise<string>;
  draftOutreach(input: OutreachInput): Promise<{ subject: string; body: string }>;
  /** ablation: the same model ranking the same universe with no Qloo data */
  rankWithoutQloo(input: AblationRankInput): Promise<{ ranking: string[]; notes: string }>;
}
