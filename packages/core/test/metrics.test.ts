import { describe, expect, it } from 'vitest';
import type { DemographicsRow, HeatCell, TagAffinity, TrendPoint } from '@simpatico/qloo';
import { crossDomain, demographicAlignment, geoFootprint, metroBaseline, momentumMetric, rankWeights, tasteOverlap, twoWayAffinity } from '../src/metrics';
import { metroScores, US_METROS, haversineKm } from '../src/geo';
import { computeMomentum, trendingWindow, weekEnds, weeklySeries } from '../src/momentum';

const tag = (id: string, affinity = 0.99): TagAffinity => ({ id, name: id.toUpperCase(), subtype: 'urn:tag:genre:music', affinity, popularity: 0.5 });

describe('m1 two-way affinity', () => {
  it('is the harmonic mean of forward and mean reverse affinity', () => {
    const r = twoWayAffinity({ a: 0.78, reverse: [{ id: 'P', name: 'P', affinity: 0.77 }, { id: 'D', name: 'D', affinity: 0.73 }], reverseExpected: 2, sources: ['ev1'] });
    expect(r.coverage).toBe(1);
    expect(r.data.b).toBeCloseTo(0.75);
    expect(r.value).toBeCloseTo((2 * 0.78 * 0.75) / (0.78 + 0.75));
    expect(r.data.ratio).toBeCloseTo(0.75 / 0.78);
  });
  it('is partial when the reverse call misses some buyer brands, and absent without a forward score', () => {
    expect(twoWayAffinity({ a: 0.7, reverse: [{ id: 'P', name: 'P', affinity: 0.7 }], reverseExpected: 3, sources: [] }).coverage).toBe(0.5);
    const none = twoWayAffinity({ a: null, reverse: [], reverseExpected: 3, sources: [] });
    expect(none.coverage).toBe(0);
    expect(none.value).toBeNull();
  });
});

describe('m2 taste overlap', () => {
  it('weights tags by rank because Qloo affinities cluster near 1', () => {
    const w = rankWeights([tag('a'), tag('b'), tag('c')], 50);
    expect(w.get('a')).toBe(1);
    expect(w.get('b')).toBeCloseTo(0.98);
  });
  it('identical profiles score 1, disjoint score 0', () => {
    const p = ['a', 'b', 'c', 'd'].map((x) => tag(x));
    expect(tasteOverlap({ buyer: p, target: p, sources: [] }).value).toBeCloseTo(1);
    expect(tasteOverlap({ buyer: p, target: ['w', 'x', 'y', 'z'].map((x) => tag(x)), sources: [] }).value).toBe(0);
  });
  it('reports shared tags and the share of the buyer top-20 missing from the target', () => {
    const buyer = ['a', 'b', 'c', 'd'].map((x) => tag(x));
    const target = ['c', 'a', 'x', 'y'].map((x) => tag(x));
    const r = tasteOverlap({ buyer, target, sources: [] });
    expect(r.data.sharedCount).toBe(2);
    expect(r.data.buyerTop20MissingShare).toBe(0.5);
    expect((r.data.shared as { id: string }[]).map((s) => s.id)).toEqual(['a', 'c']);
    // weighted Jaccard by hand: weights (n=50): buyer a1 b.98 c.96 d.94; target c1 a.98 x.96 y.94
    const num = Math.min(1, 0.98) + Math.min(0.96, 1);
    const den = Math.max(1, 0.98) + 0.98 + Math.max(0.96, 1) + 0.94 + 0.96 + 0.94;
    expect(r.value).toBeCloseTo(num / den);
  });
  it('has no coverage when a profile is missing', () => {
    expect(tasteOverlap({ buyer: [], target: [tag('a')], sources: [] }).coverage).toBe(0);
  });
});

describe('m3 cross-domain agreement', () => {
  const buyerTop = [{ id: 'x1', name: 'X1' }, { id: 'x2', name: 'X2' }, { id: 'x3', name: 'X3' }, { id: 'x4', name: 'X4' }];
  it('averages the target audience affinity for the buyer audience favourites across domains', () => {
    const r = crossDomain({
      domains: [
        { type: 'urn:entity:artist', label: 'Music', buyerTop, targetAffinity: [{ id: 'x1', affinity: 0.8 }, { id: 'x2', affinity: 0.6 }, { id: 'x3', affinity: 0.7 }, { id: 'x4', affinity: 0.7 }] },
        { type: 'urn:entity:movie', label: 'Film', buyerTop, targetAffinity: [{ id: 'x1', affinity: 0.9 }, { id: 'x2', affinity: 0.9 }, { id: 'x3', affinity: 0.9 }] },
      ],
      sources: [],
    });
    expect(r.coverage).toBe(1);
    expect(r.value).toBeCloseTo((0.7 + 0.9) / 2);
    const music = (r.data.domains as { shared: { name: string }[]; clash: { name: string }[] }[])[0]!;
    expect(music.shared[0]!.name).toBe('X1');
    expect(music.clash[0]!.name).toBe('X2');
  });
  it('is partial when a domain is missing and uncovered when most are', () => {
    const good = { type: 'a', label: 'A', buyerTop, targetAffinity: buyerTop.map((b) => ({ id: b.id, affinity: 0.7 })) };
    const bad = { type: 'b', label: 'B', buyerTop, targetAffinity: [{ id: 'x1', affinity: 0.7 }] };
    expect(crossDomain({ domains: [good, bad], sources: [] }).coverage).toBe(0.5);
    expect(crossDomain({ domains: [good, bad, bad], sources: [] }).coverage).toBe(0);
  });
});

describe('m4 demographic alignment', () => {
  const row = (id: string, s: number): DemographicsRow => ({
    entityId: id,
    age: { '24_and_younger': 0.3 * s, '25_to_29': 0.2 * s, '30_to_34': 0.1 * s, '35_to_44': -0.1 * s, '45_to_54': -0.2 * s, '55_and_older': -0.3 * s },
    gender: { male: 0.2 * s, female: -0.2 * s },
  });
  it('maps cosine to [0, 1]', () => {
    expect(demographicAlignment({ buyer: [row('b', 1)], target: row('t', 2), sources: [] }).value).toBeCloseTo(1);
    expect(demographicAlignment({ buyer: [row('b', 1)], target: row('t', -1), sources: [] }).value).toBeCloseTo(0);
  });
  it('averages multiple buyer entities and reports the biggest gap', () => {
    const r = demographicAlignment({ buyer: [row('b1', 1), row('b2', 1)], target: row('t', -1), sources: [] });
    expect((r.data.biggestGap as { bucket: string }).bucket).toBe('24_and_younger');
  });
  it('needs both sides', () => {
    expect(demographicAlignment({ buyer: [], target: row('t', 1), sources: [] }).coverage).toBe(0);
  });
});

describe('geo', () => {
  it('haversine is sane (NYC to LA ~3936 km)', () => {
    expect(haversineKm(40.7128, -74.006, 34.0522, -118.2437)).toBeGreaterThan(3900);
    expect(haversineKm(40.7128, -74.006, 34.0522, -118.2437)).toBeLessThan(3980);
  });
  it('assigns cells to the nearest metro within the radius, popularity-weighted', () => {
    const cells: HeatCell[] = [
      { geohash: 'a', lat: 40.71, lon: -74.0, affinity: 1, affinityRank: 0.9, popularity: 0.75 },
      { geohash: 'b', lat: 40.8, lon: -73.9, affinity: 1, affinityRank: 0.5, popularity: 0.25 },
      { geohash: 'c', lat: 0, lon: 0, affinity: 1, affinityRank: 0.1, popularity: 1 },
    ];
    const s = metroScores(cells);
    expect(s).toHaveLength(1);
    expect(s[0]!.metro).toBe('New York');
    expect(s[0]!.score).toBeCloseTo(0.9 * 0.75 + 0.5 * 0.25);
    expect(s[0]!.cells).toBe(2);
  });
  it('m5 correlates metro scores and finds white space', () => {
    const metros = US_METROS.slice(0, 12);
    const buyer = metros.map((m, i) => ({ metro: m.name, lat: m.lat, lon: m.lon, score: i / 12, cells: 3 }));
    const same = geoFootprint({ buyer, target: buyer.map((m) => ({ ...m })), sources: [] });
    expect(same.value).toBeCloseTo(1);
    const reversed = geoFootprint({ buyer, target: buyer.map((m, i) => ({ ...m, score: 1 - i / 12 })), sources: [] });
    expect(reversed.value).toBeCloseTo(0);
    expect((reversed.data.whiteSpace as { metro: string }[])[0]!.metro).toBe(metros[0]!.name);
    expect(geoFootprint({ buyer: buyer.slice(0, 3), target: buyer.slice(0, 3), sources: [] }).coverage).toBe(0);
  });
});

describe('m6 momentum', () => {
  const series = (ranks: number[], asOf: string): TrendPoint[] =>
    weekEnds(asOf, ranks.length).map((date, i) => ({ date, percentile: 0.5, rank: ranks[i]!, rankVelocity: 0, foldChange: 0, percentDelta: 0 }));
  const asOf = '2024-10-28';
  const flat = (r: number) => Array.from({ length: 24 }, () => r);

  it('builds week ends ending at asOf and carries values forward', () => {
    const ends = weekEnds(asOf, 3);
    expect(ends).toEqual(['2024-10-14', '2024-10-21', '2024-10-28']);
    const s = weeklySeries([{ date: '2024-10-15', percentile: 0, rank: 100, rankVelocity: 0, foldChange: 0, percentDelta: 0 }], ends);
    expect(s).toEqual([null, -2, -2]);
    expect(trendingWindow(asOf, 24)).toEqual({ startDate: '2024-05-06', endDate: asOf }); // 25 weeks back
  });

  it('reports a flat window as not covered (never as neutral)', () => {
    const m = computeMomentum([
      { entityId: 'a', points: series(flat(500), asOf) },
      { entityId: 'b', points: series(flat(900), asOf) },
      { entityId: 'c', points: series(flat(1200), asOf) },
    ], asOf);
    expect(m.get('a')!.coverage).toBe(0);
    expect(m.get('a')!.note).toMatch(/did not move/);
    expect(momentumMetric(m.get('a'), []).value).toBeNull();
  });

  it('a brand climbing while the cohort is flat gets a positive z', () => {
    const climbing = [...flat(1000).slice(0, 20), 600, 500, 400, 300];
    const m = computeMomentum([
      { entityId: 'up', points: series(climbing, asOf) },
      { entityId: 'b', points: series(flat(900), asOf) },
      { entityId: 'c', points: series(flat(1200), asOf) },
    ], asOf);
    expect(m.get('up')!.z).toBeGreaterThan(1.5);
    expect(m.get('up')!.value).toBeGreaterThan(0.75);
  });

  it('a universe-wide rank shift cancels out under cohort normalisation', () => {
    const shift = (r: number) => [...flat(r).slice(0, 20), r / 4, r / 4, r / 4, r / 4];
    const m = computeMomentum([
      { entityId: 'a', points: series(shift(800), asOf) },
      { entityId: 'b', points: series(shift(2000), asOf) },
      { entityId: 'c', points: series(shift(5000), asOf) },
    ], asOf);
    for (const id of ['a', 'b', 'c']) expect(Math.abs(m.get(id)!.z!)).toBeLessThan(1e-9);
  });

  it('a brand falling behind a rising cohort is flagged as fading', () => {
    const rising = (r: number) => [...flat(r).slice(0, 20), r / 2, r / 2, r / 2, r / 2];
    const m = computeMomentum([
      { entityId: 'stuck', points: series(flat(700), asOf) },
      { entityId: 'b', points: series(rising(900), asOf) },
      { entityId: 'c', points: series(rising(1200), asOf) },
    ], asOf);
    expect(m.get('stuck')!.z).toBeLessThan(-1.5);
  });

  it('missing history is not covered', () => {
    const m = computeMomentum([{ entityId: 'a', points: [] }], asOf);
    expect(m.get('a')!.coverage).toBe(0);
  });
});

describe('m5 relative to the cohort', () => {
  it('removes the shared big-metro pattern before correlating', () => {
    const metros = US_METROS.slice(0, 10);
    // everyone scores higher in bigger metros (common pattern), plus a brand-specific tilt
    const common = metros.map((_, i) => 0.9 - i * 0.05);
    const tiltA = metros.map((_, i) => (i % 2 === 0 ? 0.04 : -0.04));
    const tiltB = metros.map((_, i) => (i % 2 === 0 ? -0.04 : 0.04));
    const mk = (tilt: number[]) => metros.map((m, i) => ({ metro: m.name, lat: m.lat, lon: m.lon, score: common[i]! + tilt[i]!, cells: 3 }));
    const buyer = mk(tiltA);
    const target = mk(tiltB);
    const raw = geoFootprint({ buyer, target, sources: [] });
    expect(raw.value!).toBeGreaterThan(0.9);
    const baseline = metroBaseline([buyer, target, mk(metros.map(() => 0))]);
    const rel = geoFootprint({ buyer, target, baseline, sources: [] });
    expect(rel.value!).toBeLessThan(0.1);
    expect(rel.data.relativeToCohort).toBe(true);
  });
  it('baseline only keeps metros every cohort member has', () => {
    const a = [{ metro: 'X', lat: 0, lon: 0, score: 0.2, cells: 1 }, { metro: 'Y', lat: 0, lon: 0, score: 0.4, cells: 1 }];
    const b = [{ metro: 'X', lat: 0, lon: 0, score: 0.6, cells: 1 }];
    expect([...metroBaseline([a, b]).entries()]).toEqual([['X', 0.4]]);
  });
});
