// Two jobs:
//  1. compact(): trim a raw Qloo body before it is cached/logged. Keeps the same field
//     names as the live API (so parse() works on raw and compacted bodies alike), drops
//     bulky fields we never read (akas, external ids), and turns the ~5k-cell heatmap
//     into a column table.
//  2. parse*(): turn a body into the typed results the rest of Simpatico consumes.

import type {
  CompareResult,
  CompareTag,
  DemographicsRow,
  EntityHit,
  HeatCell,
  InsightEntity,
  TagAffinity,
  TagHit,
  TrendPoint,
} from './types';
import { AGE_BUCKETS, GENDERS } from './types';

type Json = Record<string, unknown>;

const KEPT_PROPERTIES = [
  'description',
  'short_description',
  'image',
  'founded_year',
  'owned_by',
  'parent_organization',
  'immediate_parent',
  'ultimate_parent',
  'headquartered',
  'market_positioning',
  'key_markets',
  'known_partnerships',
  'competitor_brands',
  'official_site',
  'price_range_usd_min',
  'price_range_usd_max',
  'industry',
] as const;

const MAX_ENTITY_TAGS = 12;

function obj(v: unknown): Json {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function compactEntity(e: unknown): Json {
  const src = obj(e);
  const props = obj(src.properties);
  const kept: Json = {};
  for (const k of KEPT_PROPERTIES) if (props[k] !== undefined && props[k] !== null) kept[k] = props[k];
  const out: Json = {};
  for (const k of ['entity_id', 'name', 'type', 'types', 'subtype', 'popularity', 'disambiguation', 'query']) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  out.properties = kept;
  out.tags = arr(src.tags).slice(0, MAX_ENTITY_TAGS);
  return out;
}

export const HEATMAP_FIELDS = ['geohash', 'lat', 'lon', 'affinity', 'affinity_rank', 'popularity'] as const;

export function compact(path: string, params: Record<string, string>, body: unknown): unknown {
  const b = obj(body);
  if (path === '/search') {
    return { results: arr(b.results).map(compactEntity) };
  }
  if (path === '/v2/insights') {
    const results = obj(b.results);
    const filterType = params['filter.type'];
    if (filterType === 'urn:heatmap') {
      const rows = arr(results.heatmap).map((c) => {
        const cell = obj(c);
        const loc = obj(cell.location);
        const q = obj(cell.query);
        return [loc.geohash, loc.latitude, loc.longitude, q.affinity, q.affinity_rank, q.popularity];
      });
      return { success: b.success, query: b.query, results: { heatmap_compact: { fields: HEATMAP_FIELDS, rows } } };
    }
    if (filterType === 'urn:tag') {
      return {
        success: b.success,
        results: {
          tags: arr(results.tags).map((t) => {
            const tag = obj(t);
            return { tag_id: tag.tag_id, name: tag.name, subtype: tag.subtype, popularity: tag.popularity, query: tag.query };
          }),
        },
      };
    }
    if (filterType === 'urn:demographics') return body;
    return { success: b.success, query: b.query, results: { entities: arr(results.entities).map(compactEntity) } };
  }
  if (path === '/v2/analysis/compare') {
    const results = obj(b.results);
    const slim = (t: unknown) => {
      const tag = obj(t);
      const q = obj(tag.query);
      return { tag_id: tag.tag_id, name: tag.name, subtype: tag.subtype, query: { score: q.score, count: q.count } };
    };
    return { results: { tags: arr(results.tags).map(slim), a: arr(results.a).map(slim), b: arr(results.b).map(slim) } };
  }
  if (path === '/v2/tags') {
    const results = obj(b.results);
    return {
      results: {
        tags: arr(results.tags).map((t) => {
          const tag = obj(t);
          return { id: tag.id, name: tag.name, type: tag.type, popularity: tag.popularity };
        }),
      },
    };
  }
  return body; // /v2/trending is already small
}

function categoryTags(e: Json): { id: string; name: string }[] {
  return arr(e.tags)
    .map(obj)
    .map((t) => ({ id: str(t.tag_id) ?? str(t.id) ?? '', name: str(t.name) ?? '' }))
    .filter((t) => t.id.startsWith('urn:tag:genre:') && t.name !== '');
}

function imageUrl(e: Json): string | null {
  return str(obj(obj(e.properties).image).url);
}

export function parseSearch(body: unknown): EntityHit[] {
  return arr(obj(body).results).map((r) => {
    const e = obj(r);
    const props = obj(e.properties);
    return {
      id: str(e.entity_id) ?? '',
      name: str(e.name) ?? '',
      types: arr(e.types).filter((t): t is string => typeof t === 'string'),
      popularity: num(e.popularity),
      disambiguation: str(e.disambiguation) || null,
      description: str(props.short_description) ?? str(props.description),
      imageUrl: imageUrl(e),
      categoryTags: categoryTags(e),
    };
  }).filter((h) => h.id !== '');
}

export function parseInsightEntities(body: unknown): InsightEntity[] {
  return arr(obj(obj(body).results).entities).map((r) => {
    const e = obj(r);
    const q = obj(e.query);
    const expl = arr(obj(q.explainability)['signal.interests.entities']).map(obj);
    return {
      id: str(e.entity_id) ?? '',
      name: str(e.name) ?? '',
      type: str(e.type),
      subtype: str(e.subtype),
      popularity: num(e.popularity),
      affinity: num(q.affinity) ?? 0,
      explainability: expl
        .map((x) => ({ entityId: str(x.entity_id) ?? '', score: num(x.score) ?? 0 }))
        .filter((x) => x.entityId !== ''),
      audienceGrowth: num(obj(q.measurements).audience_growth),
      disambiguation: str(e.disambiguation) || null,
      imageUrl: imageUrl(e),
      categoryTags: categoryTags(e),
    };
  }).filter((x) => x.id !== '');
}

/** Corporate profile fields Qloo returns for brand entities (kept by compact()). */
export interface EntityProfile {
  id: string;
  name: string;
  foundedYear: number | null;
  ultimateParent: string | null;
  immediateParent: string | null;
  ownedBy: string | null;
  headquartered: string | null;
  marketPositioning: string | null;
  keyMarkets: string[];
  knownPartnerships: string[];
  competitorBrands: string[];
  officialSite: string | null;
  priceRangeUsd: [number, number] | null;
  description: string | null;
}

function strList(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

export function parseEntityProfiles(body: unknown): EntityProfile[] {
  const b = obj(body);
  const list = Array.isArray(b.results) ? arr(b.results) : arr(obj(b.results).entities);
  return list.map((r): EntityProfile => {
    const e = obj(r);
    const p = obj(e.properties);
    const lo = num(p.price_range_usd_min);
    const hi = num(p.price_range_usd_max);
    return {
      id: str(e.entity_id) ?? '',
      name: str(e.name) ?? '',
      foundedYear: num(p.founded_year),
      ultimateParent: str(p.ultimate_parent),
      immediateParent: str(p.immediate_parent),
      ownedBy: str(p.owned_by) ?? str(p.parent_organization),
      headquartered: str(p.headquartered),
      marketPositioning: str(p.market_positioning),
      keyMarkets: strList(p.key_markets),
      knownPartnerships: strList(p.known_partnerships),
      competitorBrands: strList(p.competitor_brands),
      officialSite: str(p.official_site),
      priceRangeUsd: lo !== null && hi !== null ? [lo, hi] : null,
      description: str(p.short_description) ?? str(p.description),
    };
  }).filter((p) => p.id !== '');
}

export function parseTagAffinities(body: unknown): TagAffinity[] {
  return arr(obj(obj(body).results).tags).map((r) => {
    const t = obj(r);
    return {
      id: str(t.tag_id) ?? '',
      name: (str(t.name) ?? '').trim(),
      subtype: str(t.subtype) ?? '',
      affinity: num(obj(t.query).affinity) ?? 0,
      popularity: num(t.popularity),
    };
  }).filter((t) => t.id !== '');
}

export function parseDemographics(body: unknown): DemographicsRow[] {
  return arr(obj(obj(body).results).demographics).map((r) => {
    const d = obj(r);
    const q = obj(d.query);
    const age = obj(q.age);
    const gender = obj(q.gender);
    return {
      entityId: str(d.entity_id) ?? '',
      age: Object.fromEntries(AGE_BUCKETS.map((k) => [k, num(age[k]) ?? 0])) as DemographicsRow['age'],
      gender: Object.fromEntries(GENDERS.map((k) => [k, num(gender[k]) ?? 0])) as DemographicsRow['gender'],
    };
  }).filter((d) => d.entityId !== '');
}

export function parseHeatmap(body: unknown): HeatCell[] {
  const results = obj(obj(body).results);
  const compacted = obj(results.heatmap_compact);
  if (Array.isArray(compacted.rows)) {
    return arr(compacted.rows).map((row) => {
      const r = arr(row);
      return {
        geohash: str(r[0]) ?? '',
        lat: num(r[1]) ?? 0,
        lon: num(r[2]) ?? 0,
        affinity: num(r[3]) ?? 0,
        affinityRank: num(r[4]) ?? 0,
        popularity: num(r[5]) ?? 0,
      };
    }).filter((c) => c.geohash !== '');
  }
  return arr(results.heatmap).map((c) => {
    const cell = obj(c);
    const loc = obj(cell.location);
    const q = obj(cell.query);
    return {
      geohash: str(loc.geohash) ?? '',
      lat: num(loc.latitude) ?? 0,
      lon: num(loc.longitude) ?? 0,
      affinity: num(q.affinity) ?? 0,
      affinityRank: num(q.affinity_rank) ?? 0,
      popularity: num(q.popularity) ?? 0,
    };
  }).filter((c) => c.geohash !== '');
}

export function parseCompare(body: unknown): CompareResult {
  const results = obj(obj(body).results);
  const tag = (t: unknown): CompareTag => {
    const x = obj(t);
    const q = obj(x.query);
    return {
      id: str(x.tag_id) ?? '',
      name: str(x.name) ?? '',
      subtype: str(x.subtype) ?? '',
      score: num(q.score),
      count: num(q.count),
    };
  };
  return {
    shared: arr(results.tags).map(tag).filter((t) => t.id !== ''),
    aTags: arr(results.a).map(tag).filter((t) => t.id !== ''),
    bTags: arr(results.b).map(tag).filter((t) => t.id !== ''),
  };
}

export function parseTrending(body: unknown): TrendPoint[] {
  return arr(obj(obj(body).results).trending)
    .map((r) => {
      const t = obj(r);
      return {
        date: str(t.date) ?? '',
        percentile: num(t.population_percentile) ?? 0,
        rank: num(t.population_rank) ?? 0,
        rankVelocity: num(t.population_rank_velocity) ?? 0,
        foldChange: num(t.velocity_fold_change) ?? 0,
        percentDelta: num(t.population_percent_delta) ?? 0,
      };
    })
    .filter((p) => p.date !== '' && p.rank > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function parseTagSearch(body: unknown): TagHit[] {
  return arr(obj(obj(body).results).tags).map((r) => {
    const t = obj(r);
    return { id: str(t.id) ?? str(t.tag_id) ?? '', name: str(t.name) ?? '', type: str(t.type) ?? '', popularity: num(t.popularity) };
  }).filter((t) => t.id !== '');
}

/** Pulls the first validation message out of a 4xx body ({errors:[{message}]}) if there is one. */
export function errorMessage(body: unknown): string | null {
  const first = obj(arr(obj(body).errors)[0]);
  const msg = str(first.message);
  if (msg) return msg;
  return str(obj(body).message) ?? str(obj(body).error);
}
