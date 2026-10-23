import { newId } from './canonical';
import type { EnvelopeStatus, QlooErrorInfo, Surface } from './types';

export interface CachedResponse {
  id: string;
  key: string;
  method: string;
  path: string;
  params: Record<string, string>;
  httpStatus: number;
  /** compacted Qloo body (see normalize.compact) */
  body: unknown;
  fetchedAt: Date;
  /** pinned rows are the recorded showcase responses; hybrid/replay modes serve them at any age */
  pinned: boolean;
  surface: Surface;
}

export interface CacheLookupPolicy {
  /** null = accept any age */
  maxAgeMs: number | null;
  acceptPinned: boolean;
}

/**
 * Private server-side cache of Qloo responses. Rows are immutable: a refresh inserts a new
 * row, so evidence written earlier keeps pointing at exactly the bytes it used.
 */
export interface ResponseCache {
  lookup(key: string, policy: CacheLookupPolicy): Promise<CachedResponse | null>;
  put(row: Omit<CachedResponse, 'id' | 'pinned'>): Promise<CachedResponse>;
}

/** One row per gateway call. The provenance drawer reads these. */
export interface QlooEvidence {
  id: string;
  runId: string | null;
  purpose: string;
  subjects: string[];
  method: string;
  path: string;
  /** request params as sent, minus the key (the key is a header and is never logged) */
  params: Record<string, string>;
  responseId: string | null;
  status: EnvelopeStatus;
  httpStatus: number | null;
  error: QlooErrorInfo | null;
  fromCache: boolean;
  surface: Surface;
  durationMs: number;
  fetchedAt: string | null;
  summary: string;
}

export interface EvidenceLedger {
  recordQloo(e: QlooEvidence): Promise<void>;
}

export class MemoryCache implements ResponseCache {
  readonly rows: CachedResponse[] = [];

  async lookup(key: string, policy: CacheLookupPolicy): Promise<CachedResponse | null> {
    const now = Date.now();
    const candidates = this.rows
      .filter((r) => r.key === key)
      .filter((r) => (policy.acceptPinned && r.pinned) || policy.maxAgeMs === null || now - r.fetchedAt.getTime() <= policy.maxAgeMs)
      .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
    return candidates[0] ?? null;
  }

  async put(row: Omit<CachedResponse, 'id' | 'pinned'>): Promise<CachedResponse> {
    const stored: CachedResponse = { ...row, id: newId('qr'), pinned: false };
    this.rows.push(stored);
    return stored;
  }
}

export class MemoryLedger implements EvidenceLedger {
  readonly rows: QlooEvidence[] = [];
  async recordQloo(e: QlooEvidence): Promise<void> {
    this.rows.push(e);
  }
}
