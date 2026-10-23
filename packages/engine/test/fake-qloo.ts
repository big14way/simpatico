// A small synthetic Qloo "world" for offline pipeline tests. Every name and id is invented;
// shapes follow the live API (Qloo's terms keep real responses out of public repos).
import { createHash } from 'node:crypto';
import type { Transport, TransportResponse } from '@simpatico/qloo';

const h = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16) / 0xffffffff;

export const BRANDS: Record<string, { id: string; parent?: string; site?: string }> = {
  'Acme Cola': { id: 'B-ACME', parent: 'Acme Holdings, Inc.' },
  'Acme Chips': { id: 'B-CHIPS', parent: 'Acme Holdings, Inc.' },
  'Fizz One': { id: 'B-F1', parent: 'Fizz One, LLC', site: 'https://www.fizzone.example' },
  'Fizz Two': { id: 'B-F2' },
  'Crunch Co': { id: 'B-CR', parent: 'Acme Holdings, Inc.' },
  'Oat Dream': { id: 'B-OAT', parent: 'Big Food Group' },
  'Kombu': { id: 'B-KOM' },
  'Barely There': { id: 'B-BARE' },
};
const byId = new Map(Object.entries(BRANDS).map(([name, b]) => [b.id, { name, ...b }]));

const entity = (id: string, name: string, affinity: number, extra: Record<string, unknown> = {}) => ({
  entity_id: id,
  name,
  type: 'urn:entity',
  subtype: 'urn:entity:brand',
  popularity: 0.4 + h(id) * 0.5,
  properties: {
    ultimate_parent: byId.get(id)?.parent ?? null,
    official_site: byId.get(id)?.site ?? null,
    founded_year: 2010 + Math.floor(h(id + 'y') * 12),
    market_positioning: `${name} synthetic positioning`,
    competitor_brands: ['Other Brand'],
  },
  tags: [{ id: 'urn:tag:genre:brand:food_and_beverage', name: 'Food & Beverage', type: 'urn:tag:genre:brand' }],
  query: { affinity, explainability: { 'signal.interests.entities': [{ entity_id: 'B-ACME', score: 0.8 }] } },
  ...extra,
});

const list = (v: string | undefined) => (v ? v.split(',') : []);
const METRO_POINTS = [
  [40.71, -74.0], [34.05, -118.24], [41.88, -87.63], [32.78, -96.8], [29.76, -95.37], [38.91, -77.04], [39.95, -75.17],
  [25.76, -80.19], [33.75, -84.39], [42.36, -71.06], [33.45, -112.07], [37.77, -122.42], [47.61, -122.33], [39.74, -104.99],
];

export function fakeQloo(): Transport & { calls: number } {
  const t = {
    surface: 'rest' as const,
    calls: 0,
    async request(path: string, p: Record<string, string>): Promise<TransportResponse> {
      t.calls++;
      const ok = (body: unknown): TransportResponse => ({ httpStatus: 200, body, durationMs: 1 });
      if (path === '/search') {
        const q = (p.query ?? '').toLowerCase();
        if (q === 'acme group') return ok({ results: [entity('B-ACME', 'Acme Cola', 0)] }); // not name-compatible -> chip
        if (q === 'kombu') return ok({ results: [entity('B-KOM', 'Kombu', 0), entity('B-KOM2', 'Kombu Kombucha', 0)] }); // exact
        const hits = Object.entries(BRANDS).filter(([name]) => name.toLowerCase() === q).map(([name, b]) => entity(b.id, name, 0));
        return ok({ results: hits });
      }
      if (path === '/v2/insights') {
        const type = p['filter.type'];
        const signal = list(p['signal.interests.entities']);
        if (type === 'urn:entity:brand' && p['filter.results.entities']) {
          const cands = list(p['filter.results.entities']).filter((id) => byId.has(id) && id !== 'B-BARE');
          return ok({ success: true, results: { entities: cands.map((id) => entity(id, byId.get(id)!.name, 0.5 + 0.4 * h(signal.join() + id))) } });
        }
        if (type?.startsWith('urn:entity:') && p['filter.results.entities']) {
          const cands = list(p['filter.results.entities']);
          return ok({ success: true, results: { entities: cands.map((id) => entity(id, `Title ${id}`, 0.6 + 0.3 * h(signal.join() + id))) } });
        }
        if (type?.startsWith('urn:entity:')) {
          const n = Number(p.take ?? 10);
          return ok({ success: true, results: { entities: Array.from({ length: n }, (_, i) => entity(`${type}-${i}`, `Title ${i}`, 0.99 - i * 0.01)) } });
        }
        if (type === 'urn:tag') {
          const seed = signal.join();
          const tags = Array.from({ length: 30 }, (_, i) => {
            const k = Math.floor(h(seed + i) * 45);
            return { tag_id: `urn:tag:genre:music:t${k}`, name: `tag ${k}`, subtype: 'urn:tag:genre:music', popularity: 0.9, query: { affinity: 0.99 } };
          });
          const seen = new Set<string>();
          return ok({ success: true, results: { tags: tags.filter((x) => (seen.has(x.tag_id) ? false : (seen.add(x.tag_id), true))) } });
        }
        if (type === 'urn:demographics') {
          return ok({
            success: true,
            results: {
              demographics: signal.map((id) => ({
                entity_id: id,
                query: {
                  age: { '24_and_younger': h(id + 1) - 0.5, '25_to_29': h(id + 2) - 0.5, '30_to_34': h(id + 3) - 0.5, '35_to_44': h(id + 4) - 0.5, '45_to_54': h(id + 5) - 0.5, '55_and_older': h(id + 6) - 0.5 },
                  gender: { male: h(id + 7) - 0.5, female: 0.5 - h(id + 7) },
                },
              })),
            },
          });
        }
        if (type === 'urn:heatmap') {
          const seed = signal.join();
          return ok({
            success: true,
            results: {
              heatmap: METRO_POINTS.map(([lat, lon], i) => ({
                location: { latitude: lat, longitude: lon, geohash: `g${i}` },
                query: { affinity: h(seed + i), affinity_rank: h(seed + 'r' + i), popularity: 0.8 },
              })),
            },
          });
        }
      }
      if (path === '/v2/analysis/compare') {
        return ok({ results: { tags: [{ tag_id: 'urn:tag:genre:brand:food_and_beverage', name: 'Food & Beverage', subtype: 'urn:tag:genre:brand', query: { score: 0.7 } }], a: [], b: [] } });
      }
      if (path === '/v2/trending') {
        // flat series, like the hackathon data since late 2025
        return ok({ success: true, results: { trending: [{ date: p['filter.end_date'], population_percentile: 0.5, population_rank: '1000', population_rank_velocity: 0, velocity_fold_change: 0, population_percent_delta: 0 }, { date: p['filter.start_date'], population_percentile: 0.5, population_rank: '1000', population_rank_velocity: 0, velocity_fold_change: 0, population_percent_delta: 0 }] } });
      }
      return { httpStatus: 404, body: { message: 'No path matching request parameters' }, durationMs: 1 };
    },
  };
  return t;
}
