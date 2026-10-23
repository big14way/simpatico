import type { QueryParams } from './canonical';
import { cacheKey, canonicalParams, newId } from './canonical';
import { QlooRequiredError } from './errors';
import { Limiter, sleep } from './limiter';
import {
  compact,
  errorMessage,
  parseCompare,
  parseDemographics,
  parseEntityProfiles,
  parseHeatmap,
  parseInsightEntities,
  parseSearch,
  parseTagAffinities,
  parseTagSearch,
  parseTrending,
  type EntityProfile,
} from './normalize';
import type { CachedResponse, EvidenceLedger, ResponseCache } from './stores';
import { TransportError, type Transport } from './transport';
import type {
  CallMeta,
  CompareResult,
  DemoMode,
  DemographicsRow,
  EntityHit,
  EntityUrn,
  Envelope,
  EnvelopeStatus,
  HeatCell,
  InsightEntity,
  QlooErrorInfo,
  Surface,
  TagAffinity,
  TagHit,
  TrendPoint,
} from './types';

type Endpoint = '/search' | '/v2/insights' | '/v2/analysis/compare' | '/v2/trending' | '/v2/tags';

const HOUR = 3_600_000;
const DEFAULT_TTL: Record<Endpoint, number> = {
  '/search': 24 * HOUR,
  '/v2/insights': 24 * HOUR,
  '/v2/analysis/compare': 24 * HOUR,
  '/v2/tags': 24 * HOUR,
  '/v2/trending': 6 * HOUR,
};

export interface CallEvent {
  evidenceId: string;
  path: string;
  purpose: string;
  status: EnvelopeStatus;
  fromCache: boolean;
  durationMs: number;
}

export interface QlooClientOptions {
  /** null when no API key is configured: cache misses then throw QlooRequiredError */
  transport: Transport | null;
  cache: ResponseCache;
  ledger: EvidenceLedger;
  mode?: DemoMode;
  limiter?: Limiter;
  ttlMs?: Partial<Record<Endpoint, number>>;
  /** delays between attempts; length = number of retries */
  backoffMs?: number[];
  onCall?: (e: CallEvent) => void;
  /** skip cache reads for every call (responses are still written to the cache) */
  refresh?: boolean;
}

export interface RecommendParams {
  filterType: EntityUrn;
  signalEntities: string[];
  filterTags?: string[];
  /** how multiple filter.tags combine (Qloo's operator.filter.tags) */
  tagsOperator?: 'union' | 'intersection';
  excludeEntities?: string[];
  popularityMin?: number;
  popularityMax?: number;
  take?: number;
  explainability?: boolean;
}

export interface RankParams {
  filterType: EntityUrn;
  signalEntities: string[];
  /** restrict results to these ids (filter.results.entities) */
  candidates: string[];
  take?: number;
  explainability?: boolean;
}

export interface TagProfileParams {
  signalEntities: string[];
  /** filter.tag.types; without it the profile fills up with venue logistics tags */
  tagTypes?: string[];
  take?: number;
}

export interface HeatmapParams {
  signalEntities: string[];
  location: string;
}

export interface TrendingParams {
  filterType: EntityUrn;
  entity: string;
  startDate: string;
  endDate: string;
  take?: number;
}

const list = (ids: string[] | undefined) => (ids && ids.length > 0 ? [...ids].join(',') : '');

export class QlooClient {
  readonly mode: DemoMode;
  private readonly limiter: Limiter;
  private readonly ttl: Record<Endpoint, number>;
  private readonly backoff: number[];

  constructor(private readonly opts: QlooClientOptions) {
    this.mode = opts.mode ?? 'live';
    this.limiter = opts.limiter ?? new Limiter();
    this.ttl = { ...DEFAULT_TTL, ...opts.ttlMs };
    this.backoff = opts.backoffMs ?? [500, 1000, 2000];
  }

  /** true when calls that miss the cache can reach Qloo */
  get canCallLive(): boolean {
    return this.opts.transport !== null && this.mode !== 'replay';
  }

  search(query: string, opts: { types?: EntityUrn[]; take?: number }, meta: CallMeta): Promise<Envelope<EntityHit[]>> {
    const params: QueryParams = { query, types: list(opts.types), take: String(opts.take ?? 5) };
    return this.call('/search', params, parseSearch, meta, (r) => `${r.length} match(es) for "${query}"`);
  }

  /** /search hits with the corporate profile fields (parent, positioning, competitors...). */
  async searchProfiles(query: string, opts: { types?: EntityUrn[]; take?: number }, meta: CallMeta): Promise<Envelope<EntityProfile[]>> {
    const params: QueryParams = { query, types: list(opts.types), take: String(opts.take ?? 5) };
    return this.call('/search', params, parseEntityProfiles, meta, (r) => `${r.length} profile(s) for "${query}"`);
  }

  tags(query: string, opts: { tagTypes?: string[]; take?: number }, meta: CallMeta): Promise<Envelope<TagHit[]>> {
    const params: QueryParams = { 'filter.query': query, 'filter.tag.types': list(opts.tagTypes), take: String(opts.take ?? 10) };
    return this.call('/v2/tags', params, parseTagSearch, meta, (r) => `${r.length} tag(s) for "${query}"`);
  }

  recommend(p: RecommendParams, meta: CallMeta): Promise<Envelope<InsightEntity[]>> {
    const params: QueryParams = {
      'filter.type': p.filterType,
      'signal.interests.entities': list(p.signalEntities),
      'filter.tags': list(p.filterTags),
      'operator.filter.tags': p.filterTags && p.filterTags.length > 1 ? (p.tagsOperator ?? 'union') : '',
      'filter.exclude.entities': list(p.excludeEntities),
      'filter.popularity.min': p.popularityMin !== undefined ? String(p.popularityMin) : '',
      'filter.popularity.max': p.popularityMax !== undefined ? String(p.popularityMax) : '',
      take: String(p.take ?? 20),
      'feature.explainability': p.explainability ? 'true' : '',
    };
    return this.call('/v2/insights', params, parseInsightEntities, meta, (r) => `${r.length} recommended ${p.filterType.split(':').pop()}(s)`);
  }

  /** Same call, but returns the corporate profile fields for each result entity. */
  recommendProfiles(p: RecommendParams, meta: CallMeta): Promise<Envelope<EntityProfile[]>> {
    const params: QueryParams = {
      'filter.type': p.filterType,
      'signal.interests.entities': list(p.signalEntities),
      'filter.tags': list(p.filterTags),
      'operator.filter.tags': p.filterTags && p.filterTags.length > 1 ? (p.tagsOperator ?? 'union') : '',
      'filter.exclude.entities': list(p.excludeEntities),
      'filter.popularity.min': p.popularityMin !== undefined ? String(p.popularityMin) : '',
      'filter.popularity.max': p.popularityMax !== undefined ? String(p.popularityMax) : '',
      take: String(p.take ?? 20),
      'feature.explainability': p.explainability ? 'true' : '',
    };
    return this.call('/v2/insights', params, parseEntityProfiles, meta, (r) => `${r.length} profile(s)`);
  }

  rank(p: RankParams, meta: CallMeta): Promise<Envelope<InsightEntity[]>> {
    const params = this.rankParams(p);
    return this.call('/v2/insights', params, parseInsightEntities, meta, (r) => `${r.length} of ${p.candidates.length} candidates scored`, {
      partialIf: (r) => r.length > 0 && r.length < Math.min(p.candidates.length, p.take ?? p.candidates.length),
    });
  }

  /** Corporate profiles for a rank call (same request, so it is served from cache). */
  rankProfiles(p: RankParams, meta: CallMeta): Promise<Envelope<EntityProfile[]>> {
    return this.call('/v2/insights', this.rankParams(p), parseEntityProfiles, meta, (r) => `${r.length} profile(s)`);
  }

  private rankParams(p: RankParams): QueryParams {
    return {
      'filter.type': p.filterType,
      'signal.interests.entities': list(p.signalEntities),
      'filter.results.entities': list(p.candidates),
      take: String(p.take ?? p.candidates.length),
      'feature.explainability': p.explainability ? 'true' : '',
    };
  }

  tagProfile(p: TagProfileParams, meta: CallMeta): Promise<Envelope<TagAffinity[]>> {
    const params: QueryParams = {
      'filter.type': 'urn:tag',
      'signal.interests.entities': list(p.signalEntities),
      'filter.tag.types': list(p.tagTypes),
      take: String(p.take ?? 50),
    };
    return this.call('/v2/insights', params, parseTagAffinities, meta, (r) => `${r.length} taste tag(s)`);
  }

  demographics(entities: string[], meta: CallMeta): Promise<Envelope<DemographicsRow[]>> {
    const params: QueryParams = { 'filter.type': 'urn:demographics', 'signal.interests.entities': list(entities) };
    return this.call('/v2/insights', params, parseDemographics, meta, (r) => `demographics for ${r.length} of ${entities.length} entities`, {
      partialIf: (r) => r.length > 0 && r.length < entities.length,
    });
  }

  heatmap(p: HeatmapParams, meta: CallMeta): Promise<Envelope<HeatCell[]>> {
    const params: QueryParams = {
      'filter.type': 'urn:heatmap',
      'signal.interests.entities': list(p.signalEntities),
      'filter.location.query': p.location,
    };
    return this.call('/v2/insights', params, parseHeatmap, meta, (r) => `${r.length} heatmap cell(s) in ${p.location}`);
  }

  compare(a: string[], b: string[], meta: CallMeta, take = 20): Promise<Envelope<CompareResult>> {
    const params: QueryParams = {
      'a.signal.interests.entities': list(a),
      'b.signal.interests.entities': list(b),
      take: String(take),
    };
    return this.call('/v2/analysis/compare', params, parseCompare, meta, (r) => `${r.shared.length} shared catalogue tag(s)`, {
      emptyIf: (r) => r.shared.length === 0 && r.aTags.length === 0 && r.bTags.length === 0,
    });
  }

  trending(p: TrendingParams, meta: CallMeta): Promise<Envelope<TrendPoint[]>> {
    const params: QueryParams = {
      'filter.type': p.filterType,
      'signal.interests.entities': p.entity,
      'filter.start_date': p.startDate,
      'filter.end_date': p.endDate,
      take: String(Math.min(50, p.take ?? 50)),
    };
    return this.call('/v2/trending', params, parseTrending, meta, (r) => `${r.length} trend point(s)`);
  }

  // ---------------------------------------------------------------------------

  private async call<T>(
    path: Endpoint,
    rawParams: QueryParams,
    parse: (body: unknown) => T,
    meta: CallMeta,
    summarize: (r: T) => string,
    rules: { emptyIf?: (r: T) => boolean; partialIf?: (r: T) => boolean } = {},
  ): Promise<Envelope<T>> {
    const params = canonicalParams(rawParams);
    const key = cacheKey('GET', path, params);
    const evidenceId = newId('ev');
    const started = Date.now();

    let cached: CachedResponse | null = null;
    if ((!meta.bypassCache && !this.opts.refresh) || this.mode === 'replay') {
      cached = await this.opts.cache.lookup(key, {
        maxAgeMs: this.mode === 'replay' ? null : this.ttl[path],
        acceptPinned: this.mode !== 'live',
      });
    }

    let body: unknown = null;
    let responseId: string | null = null;
    let httpStatus: number | null = null;
    let fetchedAt: Date | null = null;
    let error: QlooErrorInfo | undefined;
    let surface: Surface = 'rest';
    const fromCache = cached !== null;

    if (cached) {
      body = cached.body;
      responseId = cached.id;
      httpStatus = cached.httpStatus;
      fetchedAt = cached.fetchedAt;
      surface = cached.surface;
    } else if (this.mode === 'replay') {
      error = {
        code: 'not_recorded',
        message: 'Replay mode: this Qloo request was not recorded.',
        retryable: false,
        recovery: 'Run the scenario live with a Qloo key to record it.',
      };
    } else if (!this.opts.transport) {
      throw new QlooRequiredError();
    } else {
      const outcome = await this.fetchWithRetry(path, params);
      httpStatus = outcome.httpStatus;
      if (outcome.error) {
        error = outcome.error;
      } else {
        const stored = await this.opts.cache.put({
          key,
          method: 'GET',
          path,
          params,
          httpStatus: outcome.httpStatus ?? 200,
          body: compact(path, params, outcome.body),
          fetchedAt: new Date(),
          surface: this.opts.transport.surface,
        });
        body = stored.body;
        responseId = stored.id;
        fetchedAt = stored.fetchedAt;
        surface = stored.surface;
      }
    }

    let results: T;
    let status: EnvelopeStatus;
    let summary: string;
    if (error) {
      results = parse(null);
      status = 'error';
      summary = error.message;
    } else {
      try {
        results = parse(body);
      } catch (err) {
        results = parse(null);
        error = { code: 'parse', message: `Could not read Qloo response: ${(err as Error).message}`, retryable: false };
      }
      if (error) {
        status = 'error';
        summary = error.message;
      } else {
        const empty = rules.emptyIf ? rules.emptyIf(results) : Array.isArray(results) && results.length === 0;
        status = empty ? 'empty' : rules.partialIf?.(results) ? 'partial' : 'ok';
        summary = summarize(results);
      }
    }

    const durationMs = Date.now() - started;
    await this.opts.ledger.recordQloo({
      id: evidenceId,
      runId: meta.runId ?? null,
      purpose: meta.purpose,
      subjects: meta.subjects ?? [],
      method: 'GET',
      path,
      params,
      responseId,
      status,
      httpStatus,
      error: error ?? null,
      fromCache,
      surface,
      durationMs,
      fetchedAt: fetchedAt ? fetchedAt.toISOString() : null,
      summary,
    });
    this.opts.onCall?.({ evidenceId, path, purpose: meta.purpose, status, fromCache, durationMs });

    const env: Envelope<T> = { status, summary, results, evidenceId, fromCache, surface };
    if (error) env.error = error;
    return env;
  }

  private async fetchWithRetry(
    path: string,
    params: QueryParams,
  ): Promise<{ httpStatus: number | null; body?: unknown; error?: QlooErrorInfo }> {
    const transport = this.opts.transport!;
    let last: { httpStatus: number | null; error: QlooErrorInfo } | null = null;
    for (let attempt = 0; attempt <= this.backoff.length; attempt++) {
      if (attempt > 0) {
        const base = this.backoff[attempt - 1] ?? 2000;
        await sleep(Math.round(base * (0.8 + Math.random() * 0.4)));
      }
      try {
        const res = await this.limiter.run(() => transport.request(path, params));
        if (res.httpStatus >= 200 && res.httpStatus < 300) return { httpStatus: res.httpStatus, body: res.body };
        const info = httpError(res.httpStatus, res.body);
        last = { httpStatus: res.httpStatus, error: info };
        if (!info.retryable) break;
      } catch (err) {
        if (err instanceof TransportError) {
          last = {
            httpStatus: null,
            error: { code: err.code, message: err.message, retryable: true, recovery: 'Retry in a moment; Qloo may be slow.' },
          };
          continue;
        }
        throw err;
      }
    }
    return last ?? { httpStatus: null, error: { code: 'network', message: 'Qloo request failed', retryable: true } };
  }
}

function httpError(status: number, body: unknown): QlooErrorInfo {
  const msg = errorMessage(body) ?? `HTTP ${status}`;
  if (status === 401) return { code: 'auth', message: `Qloo rejected the API key (401): ${msg}`, retryable: false, httpStatus: status, recovery: 'Check QLOO_API_KEY and that it is a hackathon key used against the hackathon host.' };
  if (status === 403) return { code: 'forbidden', message: `Qloo denied access (403): ${msg}`, retryable: false, httpStatus: status };
  if (status === 429) return { code: 'rate_limited', message: 'Qloo rate limit (429)', retryable: true, httpStatus: status, recovery: 'Wait and retry; ask in #api-help for a higher limit.' };
  if (status >= 500) return { code: 'server', message: `Qloo server error (${status}): ${msg}`, retryable: true, httpStatus: status };
  return { code: 'bad_request', message: `Qloo rejected the request (${status}): ${msg}`, retryable: false, httpStatus: status };
}
