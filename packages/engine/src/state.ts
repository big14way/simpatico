import type { MetroScore } from '@simpatico/core';
import type { EntityHit } from '@simpatico/qloo';

export type Role = 'buyer' | 'proxy' | 'universe';

export const STAGES = ['resolve', 'discover', 'screen', 'analyze', 'score', 'debate', 'memo', 'act', 'done'] as const;
export type Stage = (typeof STAGES)[number];

export interface ResolvedEntity {
  id: string;
  name: string;
  query: string;
  role: Role;
  imageUrl: string | null;
  pin?: boolean;
}

export interface PendingResolution {
  role: Role;
  /** index into mandate.proxies / mandate.universe (0 for buyer) */
  index: number;
  query: string;
  candidates: Pick<EntityHit, 'id' | 'name' | 'popularity' | 'disambiguation' | 'description' | 'imageUrl'>[];
}

export interface UniverseItem {
  id: string;
  name: string;
  source: 'list' | 'discover';
  imageUrl: string | null;
  /** always carried into the shortlist (e.g. back-test brands) */
  pinned?: boolean;
  /** Qloo explainability from discovery, when the item was discovered */
  discoveredAffinity?: number;
}

export interface RunState {
  runDate: string;
  asOf: string;
  buyer?: {
    name: string;
    entities: ResolvedEntity[];
    /** buyer + proxies: the audience signal */
    signalIds: string[];
    /** brand-typed signal ids (reverse rank and momentum cohort need brands) */
    brandIds: string[];
    /** the buyer brand's ultimate parent (Qloo entity data) */
    parent: string | null;
    /** every parent across the buyer's brands; a target under any of them is "owned" */
    parents: string[];
  };
  pending?: PendingResolution[];
  unresolved?: { role: Role; query: string; reason: string }[];
  universe?: UniverseItem[];
  shortlist?: string[];
  /** targetId -> short evidence key ("t1") */
  keys?: Record<string, string>;
  /** evidence ids of the screen-stage rank calls (the forward affinity behind m1) */
  screenEvidenceIds?: string[];
  buyerProfile?: BuyerProfile;
  notes?: string[];
  /** run options: refresh = re-query Qloo instead of using cached responses */
  meta?: { refresh?: boolean };
}

export interface BuyerProfile {
  topTags: { name: string; subtype: string }[];
  domains: { label: string; top: string[] }[];
  metros: MetroScore[];
}

export interface RunSummary {
  screened: number;
  shortlisted: number;
  verdicts: Record<string, number>;
  claimsAccepted: number;
  claimsRejected: number;
  memosBlocked: number;
  outreachDrafts: number;
  agentsModel: string | null;
  topTargets: { id: string; name: string; F: number | null; verdict: string }[];
}
