import { describe, expect, it } from 'vitest';
import {
  compact,
  parseCompare,
  parseDemographics,
  parseHeatmap,
  parseSearch,
  parseTagAffinities,
  parseTagSearch,
  parseTrending,
} from '../src/normalize';
import { entity } from './fake';

describe('normalize', () => {
  it('parses /search hits', () => {
    const hits = parseSearch({ results: [entity('B-1', 'Brand One', 0)] });
    expect(hits[0]).toMatchObject({ id: 'B-1', name: 'Brand One', imageUrl: 'https://example.invalid/B-1.jpg' });
    expect(hits[0]!.categoryTags).toEqual([{ id: 'urn:tag:genre:brand:food_and_beverage', name: 'Food & Beverage' }]);
  });

  it('compacts the heatmap into a column table and parses both forms identically', () => {
    const raw = {
      success: true,
      results: {
        heatmap: [
          { location: { latitude: 42.6, longitude: -75.4, geohash: 'drd6' }, query: { affinity: 1, affinity_rank: 0.99, popularity: 0.8, entity_brand_affinity: 1 } },
          { location: { latitude: 34.0, longitude: -118.2, geohash: '9q5c' }, query: { affinity: 0.4, affinity_rank: 0.3, popularity: 0.95 } },
        ],
      },
    };
    const params = { 'filter.type': 'urn:heatmap' };
    const small = compact('/v2/insights', params, raw);
    expect(JSON.stringify(small)).not.toContain('entity_brand_affinity');
    expect(parseHeatmap(small)).toEqual(parseHeatmap(raw));
    expect(parseHeatmap(raw)[1]).toEqual({ geohash: '9q5c', lat: 34.0, lon: -118.2, affinity: 0.4, affinityRank: 0.3, popularity: 0.95 });
  });

  it('parses tag affinities and trims names', () => {
    const body = { results: { tags: [{ tag_id: 'urn:tag:genre:music:indie_rock', name: ' indie rock', subtype: 'urn:tag:genre:music', popularity: 0.9, query: { affinity: 0.98 } }] } };
    expect(parseTagAffinities(compact('/v2/insights', { 'filter.type': 'urn:tag' }, body))).toEqual([
      { id: 'urn:tag:genre:music:indie_rock', name: 'indie rock', subtype: 'urn:tag:genre:music', affinity: 0.98, popularity: 0.9 },
    ]);
  });

  it('parses demographics rows', () => {
    const rows = parseDemographics({
      results: { demographics: [{ entity_id: 'B-1', query: { age: { '24_and_younger': -0.18, '25_to_29': 0.44 }, gender: { male: -0.31, female: 0.31 } } }] },
    });
    expect(rows[0]!.age['25_to_29']).toBe(0.44);
    expect(rows[0]!.age['55_and_older']).toBe(0);
    expect(rows[0]!.gender.female).toBe(0.31);
  });

  it('parses compare results', () => {
    const r = parseCompare(
      compact('/v2/analysis/compare', {}, {
        results: {
          tags: [{ tag_id: 'urn:tag:genre:brand:food_and_beverage', name: 'Food & Beverage', subtype: 'urn:tag:genre:brand', query: { score: 0.73, 'a.signal.interests.entities': [{ entity_id: 'X' }] } }],
          a: [{ tag_id: 'urn:tag:genre:brand:food_and_beverage:drinks', name: 'Drinks', subtype: 'urn:tag:genre:brand', query: { count: '2' } }],
          b: [],
          matchEntities: [],
        },
      }),
    );
    expect(r.shared[0]).toMatchObject({ name: 'Food & Beverage', score: 0.73 });
    expect(r.aTags[0]).toMatchObject({ name: 'Drinks', count: 2 });
  });

  it('parses trending into ascending dates with numeric ranks', () => {
    const pts = parseTrending({
      results: {
        trending: [
          { date: '2024-10-14', population_percentile: 0.77, population_rank: '3893', population_rank_velocity: 0, velocity_fold_change: 0, population_percent_delta: 0 },
          { date: '2024-10-07', population_percentile: 0.70, population_rank: '5580', population_rank_velocity: -17, velocity_fold_change: 0, population_percent_delta: 0 },
        ],
      },
    });
    expect(pts.map((p) => [p.date, p.rank])).toEqual([['2024-10-07', 5580], ['2024-10-14', 3893]]);
    expect(pts[0]!.rankVelocity).toBe(-17);
  });

  it('parses /v2/tags hits', () => {
    expect(parseTagSearch({ results: { tags: [{ id: 'urn:tag:genre:brand:food_and_beverage:food:packaged:snacks', name: 'Snacks', type: 'urn:tag:genre:brand', popularity: 0.98 }] } })).toEqual([
      { id: 'urn:tag:genre:brand:food_and_beverage:food:packaged:snacks', name: 'Snacks', type: 'urn:tag:genre:brand', popularity: 0.98 },
    ]);
  });

  it('tolerates null bodies (error paths)', () => {
    expect(parseSearch(null)).toEqual([]);
    expect(parseHeatmap(null)).toEqual([]);
    expect(parseCompare(null)).toEqual({ shared: [], aTags: [], bTags: [] });
  });
});
