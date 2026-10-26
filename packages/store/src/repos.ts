import type { CacheLookupPolicy, CachedResponse, EvidenceLedger, QlooEvidence, ResponseCache, Surface } from '@simpatico/qloo';
import { newId } from '@simpatico/qloo';
import type { Db } from './db';
import { j } from './db';

type Row = Record<string, unknown>;
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

// ------------------------------------------------------------------ Qloo cache + evidence

export class QlooCacheRepo implements ResponseCache {
  constructor(private readonly db: Db) {}

  async lookup(key: string, policy: CacheLookupPolicy): Promise<CachedResponse | null> {
    const rows = await this.db.query<Row>(
      `SELECT * FROM qloo_response
        WHERE cache_key = $1
          AND ( ($2::boolean AND pinned)
             OR $3::bigint IS NULL
             OR fetched_at >= now() - ($3::bigint * interval '1 millisecond') )
        ORDER BY fetched_at DESC
        LIMIT 1`,
      [key, policy.acceptPinned, policy.maxAgeMs],
    );
    return rows[0] ? toCached(rows[0]) : null;
  }

  async put(row: Omit<CachedResponse, 'id' | 'pinned'>): Promise<CachedResponse> {
    const id = newId('qr');
    await this.db.query(
      `INSERT INTO qloo_response (id, cache_key, method, path, params, http_status, body, fetched_at, pinned, surface)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, false, $9)`,
      [id, row.key, row.method, row.path, j(row.params), row.httpStatus, j(row.body), row.fetchedAt, row.surface],
    );
    return { ...row, id, pinned: false };
  }

  async getById(id: string): Promise<CachedResponse | null> {
    const rows = await this.db.query<Row>('SELECT * FROM qloo_response WHERE id = $1', [id]);
    return rows[0] ? toCached(rows[0]) : null;
  }

  /** Pin every response a run used, so hybrid/replay serve it at any age. */
  async pinForRun(runId: string): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      `WITH upd AS (
         UPDATE qloo_response SET pinned = true
          WHERE id IN (SELECT response_id FROM qloo_evidence WHERE run_id = $1 AND response_id IS NOT NULL)
          RETURNING 1)
       SELECT count(*)::int AS n FROM upd`,
      [runId],
    );
    return rows[0]?.n ?? 0;
  }

  async stats(): Promise<{ responses: number; pinned: number }> {
    const rows = await this.db.query<{ responses: number; pinned: number }>(
      'SELECT count(*)::int AS responses, count(*) FILTER (WHERE pinned)::int AS pinned FROM qloo_response',
    );
    return rows[0] ?? { responses: 0, pinned: 0 };
  }
}

function toCached(r: Row): CachedResponse {
  return {
    id: String(r.id),
    key: String(r.cache_key),
    method: String(r.method),
    path: String(r.path),
    params: r.params as Record<string, string>,
    httpStatus: Number(r.http_status),
    body: r.body,
    fetchedAt: r.fetched_at instanceof Date ? r.fetched_at : new Date(String(r.fetched_at)),
    pinned: Boolean(r.pinned),
    surface: String(r.surface) as Surface,
  };
}

export class QlooEvidenceRepo implements EvidenceLedger {
  constructor(private readonly db: Db) {}

  async recordQloo(e: QlooEvidence): Promise<void> {
    await this.db.query(
      `INSERT INTO qloo_evidence (id, run_id, purpose, subjects, method, path, params, response_id, status, http_status, error,
                                  from_cache, surface, duration_ms, fetched_at, summary)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16)`,
      [
        e.id, e.runId, e.purpose, j(e.subjects), e.method, e.path, j(e.params), e.responseId, e.status, e.httpStatus,
        e.error ? j(e.error) : null, e.fromCache, e.surface, e.durationMs, e.fetchedAt, e.summary,
      ],
    );
  }

  async listByRun(runId: string): Promise<QlooEvidence[]> {
    const rows = await this.db.query<Row>('SELECT * FROM qloo_evidence WHERE run_id = $1 ORDER BY created_at, id', [runId]);
    return rows.map(toEvidence);
  }

  async get(id: string): Promise<QlooEvidence | null> {
    const rows = await this.db.query<Row>('SELECT * FROM qloo_evidence WHERE id = $1', [id]);
    return rows[0] ? toEvidence(rows[0]) : null;
  }
}

function toEvidence(r: Row): QlooEvidence {
  return {
    id: String(r.id),
    runId: (r.run_id as string | null) ?? null,
    purpose: String(r.purpose),
    subjects: (r.subjects as string[]) ?? [],
    method: String(r.method),
    path: String(r.path),
    params: r.params as Record<string, string>,
    responseId: (r.response_id as string | null) ?? null,
    status: r.status as QlooEvidence['status'],
    httpStatus: r.http_status === null ? null : Number(r.http_status),
    error: (r.error as QlooEvidence['error']) ?? null,
    fromCache: Boolean(r.from_cache),
    surface: String(r.surface) as Surface,
    durationMs: Number(r.duration_ms),
    fetchedAt: isoOrNull(r.fetched_at),
    summary: String(r.summary),
  };
}

// ------------------------------------------------------------------ runs + events

export type RunStatus = 'running' | 'needs_input' | 'done' | 'failed';

export interface RunRecord<M = unknown, S = unknown, Sum = unknown> {
  id: string;
  kind: string;
  scenario: string | null;
  status: RunStatus;
  stage: string;
  mandate: M;
  state: S;
  summary: Sum | null;
  error: string | null;
  demoMode: string;
  callsLive: number;
  callsCached: number;
  /** while set and in the future, a worker owns this run */
  leaseUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunEvent {
  seq: number;
  runId: string;
  at: string;
  kind: string;
  message: string;
  data: unknown;
}

export class RunsRepo {
  constructor(private readonly db: Db) {}

  async create(r: { id: string; kind?: string; scenario?: string | null; stage: string; mandate: unknown; demoMode: string }): Promise<void> {
    await this.db.query(
      `INSERT INTO runs (id, kind, scenario, status, stage, mandate, demo_mode) VALUES ($1, $2, $3, 'running', $4, $5::jsonb, $6)`,
      [r.id, r.kind ?? 'screen', r.scenario ?? null, r.stage, j(r.mandate), r.demoMode],
    );
  }

  async update(id: string, patch: { status?: RunStatus; stage?: string; state?: unknown; summary?: unknown; error?: string | null; mandate?: unknown; scenario?: string | null }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const add = (col: string, val: unknown, cast = '') => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast}`);
    };
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.stage !== undefined) add('stage', patch.stage);
    if (patch.state !== undefined) add('state', j(patch.state), '::jsonb');
    if (patch.summary !== undefined) add('summary', j(patch.summary), '::jsonb');
    if (patch.error !== undefined) add('error', patch.error);
    if (patch.mandate !== undefined) add('mandate', j(patch.mandate), '::jsonb');
    if (patch.scenario !== undefined) add('scenario', patch.scenario);
    if (sets.length === 0) return;
    await this.db.query(`UPDATE runs SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  }

  /** Take the run if nobody holds it; false when another worker's lease is still live. */
  async acquireLease(id: string, seconds: number): Promise<boolean> {
    const rows = await this.db.query(
      `UPDATE runs SET lease_until = now() + ($2::int * interval '1 second')
        WHERE id = $1 AND (lease_until IS NULL OR lease_until < now()) RETURNING id`,
      [id, seconds],
    );
    return rows.length > 0;
  }

  async renewLease(id: string, seconds: number): Promise<void> {
    await this.db.query(`UPDATE runs SET lease_until = now() + ($2::int * interval '1 second') WHERE id = $1`, [id, seconds]);
  }

  async releaseLease(id: string): Promise<void> {
    await this.db.query('UPDATE runs SET lease_until = NULL WHERE id = $1', [id]);
  }

  async countCall(id: string, fromCache: boolean): Promise<void> {
    await this.addCalls(id, fromCache ? 0 : 1, fromCache ? 1 : 0);
  }

  async addCalls(id: string, live: number, cached: number): Promise<void> {
    if (live === 0 && cached === 0) return;
    await this.db.query('UPDATE runs SET calls_live = calls_live + $2, calls_cached = calls_cached + $3 WHERE id = $1', [id, live, cached]);
  }

  async get<M = unknown, S = unknown, Sum = unknown>(id: string): Promise<RunRecord<M, S, Sum> | null> {
    const rows = await this.db.query<Row>('SELECT * FROM runs WHERE id = $1', [id]);
    return rows[0] ? toRun<M, S, Sum>(rows[0]) : null;
  }

  async list(limit = 50): Promise<RunRecord[]> {
    const rows = await this.db.query<Row>('SELECT * FROM runs ORDER BY created_at DESC LIMIT $1', [limit]);
    return rows.map((r) => toRun(r));
  }

  /** Latest finished run for a showcase scenario. */
  async latestForScenario(scenario: string): Promise<RunRecord | null> {
    const rows = await this.db.query<Row>(
      `SELECT * FROM runs WHERE scenario = $1 AND status = 'done' ORDER BY created_at DESC LIMIT 1`,
      [scenario],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async appendEvent(runId: string, kind: string, message: string, data?: unknown): Promise<number> {
    const rows = await this.db.query<{ seq: number }>(
      'INSERT INTO run_events (run_id, kind, message, data) VALUES ($1, $2, $3, $4::jsonb) RETURNING seq',
      [runId, kind, message, data === undefined ? null : j(data)],
    );
    return Number(rows[0]!.seq);
  }

  async events(runId: string, afterSeq = 0): Promise<RunEvent[]> {
    const rows = await this.db.query<Row>('SELECT * FROM run_events WHERE run_id = $1 AND seq > $2 ORDER BY seq', [runId, afterSeq]);
    return rows.map((r) => ({
      seq: Number(r.seq),
      runId: String(r.run_id),
      at: iso(r.at),
      kind: String(r.kind),
      message: String(r.message),
      data: r.data ?? null,
    }));
  }
}

function toRun<M, S, Sum>(r: Row): RunRecord<M, S, Sum> {
  return {
    id: String(r.id),
    kind: String(r.kind),
    scenario: (r.scenario as string | null) ?? null,
    status: r.status as RunStatus,
    stage: String(r.stage),
    mandate: r.mandate as M,
    state: (r.state ?? {}) as S,
    summary: (r.summary as Sum | null) ?? null,
    error: (r.error as string | null) ?? null,
    demoMode: String(r.demo_mode),
    callsLive: Number(r.calls_live),
    callsCached: Number(r.calls_cached),
    leaseUntil: isoOrNull(r.lease_until),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

// ------------------------------------------------------------------ targets + evidence rows

export interface TargetRecord {
  runId: string;
  targetId: string;
  key: string | null;
  name: string;
  /** screened | shortlisted | analysed | debated */
  stage: string;
  screenRank: number | null;
  forwardAffinity: number | null;
  popularity: number | null;
  imageUrl: string | null;
  profile: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  composite: Record<string, unknown> | null;
  flags: unknown[] | null;
  verdict: string | null;
  why: string | null;
  score: number | null;
  coverage: number | null;
  ownedByBuyer: boolean;
  pinned: boolean;
}

export class TargetsRepo {
  constructor(private readonly db: Db) {}

  async upsert(t: TargetRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO targets (run_id, target_id, key, name, stage, screen_rank, forward_affinity, popularity, image_url, profile,
                            metrics, composite, flags, verdict, why, score, coverage, owned_by_buyer, pinned)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (run_id, target_id) DO UPDATE SET
         key = EXCLUDED.key, name = EXCLUDED.name, stage = EXCLUDED.stage, screen_rank = EXCLUDED.screen_rank,
         forward_affinity = EXCLUDED.forward_affinity, popularity = EXCLUDED.popularity, image_url = EXCLUDED.image_url,
         profile = EXCLUDED.profile, metrics = EXCLUDED.metrics, composite = EXCLUDED.composite, flags = EXCLUDED.flags,
         verdict = EXCLUDED.verdict, why = EXCLUDED.why, score = EXCLUDED.score, coverage = EXCLUDED.coverage,
         owned_by_buyer = EXCLUDED.owned_by_buyer, pinned = EXCLUDED.pinned`,
      [
        t.runId, t.targetId, t.key, t.name, t.stage, t.screenRank, t.forwardAffinity, t.popularity, t.imageUrl,
        t.profile ? j(t.profile) : null, t.metrics ? j(t.metrics) : null, t.composite ? j(t.composite) : null,
        t.flags ? j(t.flags) : null, t.verdict, t.why, t.score, t.coverage, t.ownedByBuyer, t.pinned,
      ],
    );
  }

  async list(runId: string): Promise<TargetRecord[]> {
    const rows = await this.db.query<Row>(
      'SELECT * FROM targets WHERE run_id = $1 ORDER BY score DESC NULLS LAST, screen_rank ASC NULLS LAST, name',
      [runId],
    );
    return rows.map(toTarget);
  }

  async get(runId: string, targetId: string): Promise<TargetRecord | null> {
    const rows = await this.db.query<Row>('SELECT * FROM targets WHERE run_id = $1 AND target_id = $2', [runId, targetId]);
    return rows[0] ? toTarget(rows[0]) : null;
  }
}

function toTarget(r: Row): TargetRecord {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    runId: String(r.run_id),
    targetId: String(r.target_id),
    key: (r.key as string | null) ?? null,
    name: String(r.name),
    stage: String(r.stage),
    screenRank: num(r.screen_rank),
    forwardAffinity: num(r.forward_affinity),
    popularity: num(r.popularity),
    imageUrl: (r.image_url as string | null) ?? null,
    profile: (r.profile as Record<string, unknown> | null) ?? null,
    metrics: (r.metrics as Record<string, unknown> | null) ?? null,
    composite: (r.composite as Record<string, unknown> | null) ?? null,
    flags: (r.flags as unknown[] | null) ?? null,
    verdict: (r.verdict as string | null) ?? null,
    why: (r.why as string | null) ?? null,
    score: num(r.score),
    coverage: num(r.coverage),
    ownedByBuyer: Boolean(r.owned_by_buyer),
    pinned: Boolean(r.pinned),
  };
}

export interface StoredEvidenceRow {
  id: string;
  targetId: string;
  kind: string;
  metric: string | null;
  label: string;
  data: Record<string, unknown>;
  polarity: Record<string, 1 | -1 | 0>;
  ref: Record<string, number>;
  sources: string[];
}

export class EvidenceRowsRepo {
  constructor(private readonly db: Db) {}

  async replaceForTarget(runId: string, targetId: string, rows: StoredEvidenceRow[]): Promise<void> {
    await this.db.query('DELETE FROM evidence_rows WHERE run_id = $1 AND target_id = $2', [runId, targetId]);
    if (rows.length === 0) return;
    // one multi-row insert: round trips matter on a remote database
    const params: unknown[] = [];
    const values = rows.map((r) => {
      const b = params.length;
      params.push(runId, r.id, r.targetId, r.kind, r.metric, r.label, j(r.data), j(r.polarity), j(r.ref), j(r.sources));
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::jsonb,$${b + 8}::jsonb,$${b + 9}::jsonb,$${b + 10}::jsonb)`;
    });
    await this.db.query(
      `INSERT INTO evidence_rows (run_id, id, target_id, kind, metric, label, data, polarity, ref, sources) VALUES ${values.join(',')}`,
      params,
    );
  }

  async list(runId: string, targetId?: string): Promise<StoredEvidenceRow[]> {
    const rows = targetId
      ? await this.db.query<Row>('SELECT * FROM evidence_rows WHERE run_id = $1 AND target_id = $2 ORDER BY id', [runId, targetId])
      : await this.db.query<Row>('SELECT * FROM evidence_rows WHERE run_id = $1 ORDER BY target_id, id', [runId]);
    return rows.map((r) => ({
      id: String(r.id),
      targetId: String(r.target_id),
      kind: String(r.kind),
      metric: (r.metric as string | null) ?? null,
      label: String(r.label),
      data: r.data as Record<string, unknown>,
      polarity: r.polarity as Record<string, 1 | -1 | 0>,
      ref: r.ref as Record<string, number>,
      sources: r.sources as string[],
    }));
  }
}

// ------------------------------------------------------------------ claims + memos

export interface ClaimRecord {
  id: string;
  runId: string;
  targetId: string;
  side: 'bull' | 'bear';
  text: string;
  direction: '+' | '-';
  flag: string | null;
  cites: { evidenceId: string; path: string; value: number }[];
  accepted: boolean;
  reason: string | null;
  model: string | null;
  createdAt?: string;
}

export class ClaimsRepo {
  constructor(private readonly db: Db) {}

  async replaceForTarget(runId: string, targetId: string, claims: ClaimRecord[]): Promise<void> {
    await this.db.query('DELETE FROM claims WHERE run_id = $1 AND target_id = $2', [runId, targetId]);
    if (claims.length === 0) return;
    const params: unknown[] = [];
    const values = claims.map((c, i) => {
      const b = params.length;
      params.push(c.id, c.runId, c.targetId, c.side, c.text, c.direction, c.flag, j(c.cites), c.accepted, c.reason, c.model, i);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8}::jsonb,$${b + 9},$${b + 10},$${b + 11},$${b + 12})`;
    });
    await this.db.query(
      `INSERT INTO claims (id, run_id, target_id, side, text, direction, flag, cites, accepted, reason, model, seq) VALUES ${values.join(',')}`,
      params,
    );
  }

  async list(runId: string, targetId?: string): Promise<ClaimRecord[]> {
    const rows = targetId
      ? await this.db.query<Row>('SELECT * FROM claims WHERE run_id = $1 AND target_id = $2 ORDER BY created_at, seq, id', [runId, targetId])
      : await this.db.query<Row>('SELECT * FROM claims WHERE run_id = $1 ORDER BY target_id, created_at, seq, id', [runId]);
    return rows.map((r) => ({
      id: String(r.id),
      runId: String(r.run_id),
      targetId: String(r.target_id),
      side: r.side as 'bull' | 'bear',
      text: String(r.text),
      direction: r.direction as '+' | '-',
      flag: (r.flag as string | null) ?? null,
      cites: r.cites as ClaimRecord['cites'],
      accepted: Boolean(r.accepted),
      reason: (r.reason as string | null) ?? null,
      model: (r.model as string | null) ?? null,
      createdAt: iso(r.created_at),
    }));
  }
}

export interface MemoRecord {
  id: string;
  runId: string;
  targetId: string | null;
  markdown: string;
  checks: Record<string, unknown>;
  ok: boolean;
  model: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export class MemosRepo {
  constructor(private readonly db: Db) {}

  async upsert(m: MemoRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO memos (id, run_id, target_id, markdown, checks, ok, model) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
       ON CONFLICT (id) DO UPDATE SET markdown = EXCLUDED.markdown, checks = EXCLUDED.checks, ok = EXCLUDED.ok,
         model = EXCLUDED.model, updated_at = now()`,
      [m.id, m.runId, m.targetId, m.markdown, j(m.checks), m.ok, m.model],
    );
  }

  async list(runId: string): Promise<MemoRecord[]> {
    const rows = await this.db.query<Row>('SELECT * FROM memos WHERE run_id = $1 ORDER BY target_id NULLS FIRST, created_at', [runId]);
    return rows.map(toMemo);
  }

  async get(id: string): Promise<MemoRecord | null> {
    const rows = await this.db.query<Row>('SELECT * FROM memos WHERE id = $1', [id]);
    return rows[0] ? toMemo(rows[0]) : null;
  }
}

function toMemo(r: Row): MemoRecord {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    targetId: (r.target_id as string | null) ?? null,
    markdown: String(r.markdown),
    checks: r.checks as Record<string, unknown>,
    ok: Boolean(r.ok),
    model: (r.model as string | null) ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

// ------------------------------------------------------------------ pipeline

export const PIPELINE_STAGES = ['Sourced', 'Screened', 'Debated', 'IC', 'Outreach', 'Monitoring'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface PipelineRecord {
  id: string;
  buyerKey: string;
  buyerName: string;
  dealType: string;
  targetId: string;
  targetName: string;
  imageUrl: string | null;
  score: number | null;
  verdict: string;
  stage: PipelineStage;
  owner: string | null;
  nextStep: string | null;
  lastRunId: string;
  monitored: boolean;
  lastSnapshot: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export class PipelineRepo {
  constructor(private readonly db: Db) {}

  /** Insert or refresh a deal; keeps the stage a human moved it to unless `stage` is given. */
  async upsert(p: Omit<PipelineRecord, 'id' | 'createdAt' | 'updatedAt' | 'monitored' | 'lastSnapshot' | 'owner'> & { owner?: string | null; monitored?: boolean; lastSnapshot?: Record<string, unknown> | null }): Promise<PipelineRecord> {
    const rows = await this.db.query<Row>(
      `INSERT INTO pipeline (id, buyer_key, buyer_name, deal_type, target_id, target_name, image_url, score, verdict, stage, owner,
                             next_step, last_run_id, monitored, last_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
       ON CONFLICT (buyer_key, deal_type, target_id) DO UPDATE SET
         buyer_name = EXCLUDED.buyer_name, target_name = EXCLUDED.target_name, image_url = EXCLUDED.image_url,
         score = EXCLUDED.score, verdict = EXCLUDED.verdict, stage = EXCLUDED.stage,
         next_step = EXCLUDED.next_step, last_run_id = EXCLUDED.last_run_id,
         monitored = pipeline.monitored OR EXCLUDED.monitored,
         last_snapshot = COALESCE(EXCLUDED.last_snapshot, pipeline.last_snapshot),
         updated_at = now()
       RETURNING *`,
      [
        newId('deal'), p.buyerKey, p.buyerName, p.dealType, p.targetId, p.targetName, p.imageUrl, p.score, p.verdict, p.stage,
        p.owner ?? null, p.nextStep, p.lastRunId, p.monitored ?? false, p.lastSnapshot ? j(p.lastSnapshot) : null,
      ],
    );
    return toPipeline(rows[0]!);
  }

  async list(): Promise<PipelineRecord[]> {
    const rows = await this.db.query<Row>('SELECT * FROM pipeline ORDER BY updated_at DESC');
    return rows.map(toPipeline);
  }

  async get(id: string): Promise<PipelineRecord | null> {
    const rows = await this.db.query<Row>('SELECT * FROM pipeline WHERE id = $1', [id]);
    return rows[0] ? toPipeline(rows[0]) : null;
  }

  async findByKey(buyerKey: string, dealType: string, targetId: string): Promise<PipelineRecord | null> {
    const rows = await this.db.query<Row>('SELECT * FROM pipeline WHERE buyer_key = $1 AND deal_type = $2 AND target_id = $3', [buyerKey, dealType, targetId]);
    return rows[0] ? toPipeline(rows[0]) : null;
  }

  async update(id: string, patch: { stage?: PipelineStage; owner?: string | null; nextStep?: string | null; monitored?: boolean; verdict?: string; score?: number | null; lastSnapshot?: Record<string, unknown> }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const add = (col: string, val: unknown, cast = '') => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast}`);
    };
    if (patch.stage !== undefined) add('stage', patch.stage);
    if (patch.owner !== undefined) add('owner', patch.owner);
    if (patch.nextStep !== undefined) add('next_step', patch.nextStep);
    if (patch.monitored !== undefined) add('monitored', patch.monitored);
    if (patch.verdict !== undefined) add('verdict', patch.verdict);
    if (patch.score !== undefined) add('score', patch.score);
    if (patch.lastSnapshot !== undefined) add('last_snapshot', j(patch.lastSnapshot), '::jsonb');
    if (sets.length === 0) return;
    await this.db.query(`UPDATE pipeline SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM pipeline WHERE id = $1', [id]);
  }
}

function toPipeline(r: Row): PipelineRecord {
  return {
    id: String(r.id),
    buyerKey: String(r.buyer_key),
    buyerName: String(r.buyer_name),
    dealType: String(r.deal_type),
    targetId: String(r.target_id),
    targetName: String(r.target_name),
    imageUrl: (r.image_url as string | null) ?? null,
    score: r.score === null ? null : Number(r.score),
    verdict: String(r.verdict),
    stage: r.stage as PipelineStage,
    owner: (r.owner as string | null) ?? null,
    nextStep: (r.next_step as string | null) ?? null,
    lastRunId: String(r.last_run_id),
    monitored: Boolean(r.monitored),
    lastSnapshot: (r.last_snapshot as Record<string, unknown> | null) ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

// ------------------------------------------------------------------ outreach

export type OutreachStatus = 'pending' | 'approved' | 'sent' | 'rejected' | 'failed';

export interface Approval {
  draftId: string;
  targetId: string;
  recipient: string;
  subject: string;
  bodySha256: string;
  approvedAt: string;
  approvedBy: string;
}

export interface OutreachRecord {
  id: string;
  runId: string;
  pipelineId: string | null;
  targetId: string;
  targetName: string;
  intendedRecipient: string;
  subject: string;
  body: string;
  bodySha256: string;
  status: OutreachStatus;
  approval: Approval | null;
  deliveredTo: string | null;
  providerId: string | null;
  error: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export class OutreachRepo {
  constructor(private readonly db: Db) {}

  async create(o: Omit<OutreachRecord, 'status' | 'approval' | 'deliveredTo' | 'providerId' | 'error' | 'createdAt' | 'updatedAt'>): Promise<void> {
    await this.db.query(
      `INSERT INTO outreach (id, run_id, pipeline_id, target_id, target_name, intended_recipient, subject, body, body_sha256, status, model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)`,
      [o.id, o.runId, o.pipelineId, o.targetId, o.targetName, o.intendedRecipient, o.subject, o.body, o.bodySha256, o.model],
    );
  }

  async get(id: string): Promise<OutreachRecord | null> {
    const rows = await this.db.query<Row>('SELECT * FROM outreach WHERE id = $1', [id]);
    return rows[0] ? toOutreach(rows[0]) : null;
  }

  async list(): Promise<OutreachRecord[]> {
    const rows = await this.db.query<Row>('SELECT * FROM outreach ORDER BY created_at DESC');
    return rows.map(toOutreach);
  }

  async listForRun(runId: string): Promise<OutreachRecord[]> {
    const rows = await this.db.query<Row>('SELECT * FROM outreach WHERE run_id = $1 ORDER BY created_at', [runId]);
    return rows.map(toOutreach);
  }

  async update(id: string, patch: Partial<Pick<OutreachRecord, 'status' | 'approval' | 'deliveredTo' | 'providerId' | 'error' | 'subject' | 'body' | 'bodySha256'>>): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const add = (col: string, val: unknown, cast = '') => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast}`);
    };
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.approval !== undefined) add('approval', patch.approval ? j(patch.approval) : null, '::jsonb');
    if (patch.deliveredTo !== undefined) add('delivered_to', patch.deliveredTo);
    if (patch.providerId !== undefined) add('provider_id', patch.providerId);
    if (patch.error !== undefined) add('error', patch.error);
    if (patch.subject !== undefined) add('subject', patch.subject);
    if (patch.body !== undefined) add('body', patch.body);
    if (patch.bodySha256 !== undefined) add('body_sha256', patch.bodySha256);
    if (sets.length === 0) return;
    await this.db.query(`UPDATE outreach SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  }
}

function toOutreach(r: Row): OutreachRecord {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    pipelineId: (r.pipeline_id as string | null) ?? null,
    targetId: String(r.target_id),
    targetName: String(r.target_name),
    intendedRecipient: String(r.intended_recipient),
    subject: String(r.subject),
    body: String(r.body),
    bodySha256: String(r.body_sha256),
    status: r.status as OutreachStatus,
    approval: (r.approval as Approval | null) ?? null,
    deliveredTo: (r.delivered_to as string | null) ?? null,
    providerId: (r.provider_id as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

// ------------------------------------------------------------------ monitor + alerts

export interface MonitorRunRecord {
  id: string;
  trigger: string;
  asOf: string;
  status: 'running' | 'done' | 'failed';
  summary: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AlertRecord {
  id: string;
  monitorRunId: string;
  pipelineId: string;
  targetName: string;
  kind: string;
  message: string;
  data: Record<string, unknown> | null;
  delivery: Record<string, unknown> | null;
  createdAt: string;
}

export class MonitorRepo {
  constructor(private readonly db: Db) {}

  async start(id: string, trigger: string, asOf: string): Promise<void> {
    await this.db.query(`INSERT INTO monitor_runs (id, trigger, as_of, status) VALUES ($1, $2, $3, 'running')`, [id, trigger, asOf]);
  }

  async finish(id: string, status: 'done' | 'failed', summary: Record<string, unknown> | null, error: string | null = null): Promise<void> {
    await this.db.query(
      'UPDATE monitor_runs SET status = $2, summary = $3::jsonb, error = $4, finished_at = now() WHERE id = $1',
      [id, status, summary ? j(summary) : null, error],
    );
  }

  async listRuns(limit = 20): Promise<MonitorRunRecord[]> {
    const rows = await this.db.query<Row>('SELECT * FROM monitor_runs ORDER BY started_at DESC LIMIT $1', [limit]);
    return rows.map((r) => ({
      id: String(r.id),
      trigger: String(r.trigger),
      asOf: String(r.as_of),
      status: r.status as MonitorRunRecord['status'],
      summary: (r.summary as Record<string, unknown> | null) ?? null,
      error: (r.error as string | null) ?? null,
      startedAt: iso(r.started_at),
      finishedAt: isoOrNull(r.finished_at),
    }));
  }

  async addAlert(a: Omit<AlertRecord, 'createdAt' | 'delivery'>): Promise<void> {
    await this.db.query(
      `INSERT INTO alerts (id, monitor_run_id, pipeline_id, target_name, kind, message, data) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [a.id, a.monitorRunId, a.pipelineId, a.targetName, a.kind, a.message, a.data ? j(a.data) : null],
    );
  }

  async setDelivery(id: string, delivery: Record<string, unknown>): Promise<void> {
    await this.db.query('UPDATE alerts SET delivery = $2::jsonb WHERE id = $1', [id, j(delivery)]);
  }

  async listAlerts(limit = 50): Promise<AlertRecord[]> {
    const rows = await this.db.query<Row>('SELECT * FROM alerts ORDER BY created_at DESC LIMIT $1', [limit]);
    return rows.map((r) => ({
      id: String(r.id),
      monitorRunId: String(r.monitor_run_id),
      pipelineId: String(r.pipeline_id),
      targetName: String(r.target_name),
      kind: String(r.kind),
      message: String(r.message),
      data: (r.data as Record<string, unknown> | null) ?? null,
      delivery: (r.delivery as Record<string, unknown> | null) ?? null,
      createdAt: iso(r.created_at),
    }));
  }
}

// ------------------------------------------------------------------ ablations + settings

export class AblationRepo {
  constructor(private readonly db: Db) {}

  async save(id: string, runId: string, result: unknown): Promise<void> {
    await this.db.query('INSERT INTO ablations (id, run_id, result) VALUES ($1, $2, $3::jsonb)', [id, runId, j(result)]);
  }

  async latestForRun<T = unknown>(runId: string): Promise<{ id: string; result: T; createdAt: string } | null> {
    const rows = await this.db.query<Row>('SELECT * FROM ablations WHERE run_id = $1 ORDER BY created_at DESC LIMIT 1', [runId]);
    const r = rows[0];
    return r ? { id: String(r.id), result: r.result as T, createdAt: iso(r.created_at) } : null;
  }
}

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  async get<T>(key: string): Promise<T | null> {
    const rows = await this.db.query<Row>('SELECT value FROM settings WHERE key = $1', [key]);
    return rows[0] ? (rows[0].value as T) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, j(value)],
    );
  }
}

// ------------------------------------------------------------------ model answers

/** Stored Claude answers (the agents' LlmCache). A key is written once; later writes keep the first answer. */
export class LlmCacheRepo {
  constructor(private readonly db: Db) {}

  async get(key: string): Promise<{ kind: string; model: string; output: unknown; usage: { inputTokens: number; outputTokens: number } | null } | null> {
    const rows = await this.db.query<Row>('SELECT kind, model, output, usage FROM llm_response WHERE cache_key = $1', [key]);
    const r = rows[0];
    return r ? { kind: String(r.kind), model: String(r.model), output: r.output, usage: (r.usage as { inputTokens: number; outputTokens: number } | null) ?? null } : null;
  }

  async put(key: string, entry: { kind: string; model: string; output: unknown; usage: { inputTokens: number; outputTokens: number } | null }): Promise<void> {
    await this.db.query(
      `INSERT INTO llm_response (cache_key, kind, model, output, usage)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (cache_key) DO NOTHING`,
      [key, entry.kind, entry.model, j(entry.output), entry.usage === null ? null : j(entry.usage)],
    );
  }

  async stats(): Promise<{ answers: number }> {
    const rows = await this.db.query<{ answers: number }>('SELECT count(*)::int AS answers FROM llm_response');
    return rows[0] ?? { answers: 0 };
  }
}

// ------------------------------------------------------------------ bundle

export interface Store {
  db: Db;
  cache: QlooCacheRepo;
  qlooEvidence: QlooEvidenceRepo;
  runs: RunsRepo;
  targets: TargetsRepo;
  evidence: EvidenceRowsRepo;
  claims: ClaimsRepo;
  memos: MemosRepo;
  pipeline: PipelineRepo;
  outreach: OutreachRepo;
  monitor: MonitorRepo;
  ablations: AblationRepo;
  settings: SettingsRepo;
  llm: LlmCacheRepo;
}

export function createStore(db: Db): Store {
  return {
    db,
    cache: new QlooCacheRepo(db),
    qlooEvidence: new QlooEvidenceRepo(db),
    runs: new RunsRepo(db),
    targets: new TargetsRepo(db),
    evidence: new EvidenceRowsRepo(db),
    claims: new ClaimsRepo(db),
    memos: new MemosRepo(db),
    pipeline: new PipelineRepo(db),
    outreach: new OutreachRepo(db),
    monitor: new MonitorRepo(db),
    ablations: new AblationRepo(db),
    settings: new SettingsRepo(db),
    llm: new LlmCacheRepo(db),
  };
}
