// Geographic footprint helpers. Qloo's US heatmap comes back as ~5,000 geohash-4 cells,
// each with the local audience's affinity for the signal. We summarise cells into the
// metros below (public city-centre coordinates) so the footprint reads as places.

import type { HeatCell } from '@simpatico/qloo';

export interface Metro {
  name: string;
  lat: number;
  lon: number;
}

export const US_METROS: readonly Metro[] = [
  { name: 'New York', lat: 40.7128, lon: -74.006 },
  { name: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
  { name: 'Chicago', lat: 41.8781, lon: -87.6298 },
  { name: 'Dallas', lat: 32.7767, lon: -96.797 },
  { name: 'Houston', lat: 29.7604, lon: -95.3698 },
  { name: 'Washington, DC', lat: 38.9072, lon: -77.0369 },
  { name: 'Philadelphia', lat: 39.9526, lon: -75.1652 },
  { name: 'Miami', lat: 25.7617, lon: -80.1918 },
  { name: 'Atlanta', lat: 33.749, lon: -84.388 },
  { name: 'Boston', lat: 42.3601, lon: -71.0589 },
  { name: 'Phoenix', lat: 33.4484, lon: -112.074 },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194 },
  { name: 'Detroit', lat: 42.3314, lon: -83.0458 },
  { name: 'Seattle', lat: 47.6062, lon: -122.3321 },
  { name: 'Minneapolis', lat: 44.9778, lon: -93.265 },
  { name: 'San Diego', lat: 32.7157, lon: -117.1611 },
  { name: 'Tampa', lat: 27.9506, lon: -82.4572 },
  { name: 'Denver', lat: 39.7392, lon: -104.9903 },
  { name: 'Baltimore', lat: 39.2904, lon: -76.6122 },
  { name: 'St. Louis', lat: 38.627, lon: -90.1994 },
  { name: 'Orlando', lat: 28.5383, lon: -81.3792 },
  { name: 'Charlotte', lat: 35.2271, lon: -80.8431 },
  { name: 'San Antonio', lat: 29.4241, lon: -98.4936 },
  { name: 'Portland', lat: 45.5152, lon: -122.6784 },
  { name: 'Sacramento', lat: 38.5816, lon: -121.4944 },
  { name: 'Pittsburgh', lat: 40.4406, lon: -79.9959 },
  { name: 'Austin', lat: 30.2672, lon: -97.7431 },
  { name: 'Las Vegas', lat: 36.1699, lon: -115.1398 },
  { name: 'Cincinnati', lat: 39.1031, lon: -84.512 },
  { name: 'Kansas City', lat: 39.0997, lon: -94.5786 },
  { name: 'Columbus', lat: 39.9612, lon: -82.9988 },
  { name: 'Indianapolis', lat: 39.7684, lon: -86.1581 },
  { name: 'Cleveland', lat: 41.4993, lon: -81.6944 },
  { name: 'San Jose', lat: 37.3382, lon: -121.8863 },
  { name: 'Nashville', lat: 36.1627, lon: -86.7816 },
  { name: 'Virginia Beach', lat: 36.8529, lon: -75.978 },
  { name: 'Providence', lat: 41.824, lon: -71.4128 },
  { name: 'Jacksonville', lat: 30.3322, lon: -81.6557 },
  { name: 'Milwaukee', lat: 43.0389, lon: -87.9065 },
  { name: 'Raleigh', lat: 35.7796, lon: -78.6382 },
  { name: 'Oklahoma City', lat: 35.4676, lon: -97.5164 },
  { name: 'Memphis', lat: 35.1495, lon: -90.049 },
  { name: 'Richmond', lat: 37.5407, lon: -77.436 },
  { name: 'Louisville', lat: 38.2527, lon: -85.7585 },
  { name: 'New Orleans', lat: 29.9511, lon: -90.0715 },
  { name: 'Salt Lake City', lat: 40.7608, lon: -111.891 },
  { name: 'Hartford', lat: 41.7658, lon: -72.6734 },
  { name: 'Buffalo', lat: 42.8864, lon: -78.8784 },
  { name: 'Birmingham', lat: 33.5186, lon: -86.8104 },
  { name: 'Albuquerque', lat: 35.0844, lon: -106.6504 },
  { name: 'Tucson', lat: 32.2226, lon: -110.9747 },
  { name: 'Omaha', lat: 41.2565, lon: -95.9345 },
  { name: 'Boise', lat: 43.615, lon: -116.2023 },
  { name: 'Honolulu', lat: 21.3069, lon: -157.8583 },
  { name: 'Anchorage', lat: 61.2181, lon: -149.9003 },
];

export const METRO_RADIUS_KM = 60;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface MetroScore {
  metro: string;
  lat: number;
  lon: number;
  /** popularity-weighted mean of Qloo's per-cell affinity_rank (0-1 percentile) */
  score: number;
  cells: number;
}

/**
 * Summarise heatmap cells into metro scores. A cell belongs to its nearest metro if that
 * metro is within METRO_RADIUS_KM. Cells are weighted by Qloo's cell popularity so sparse
 * cells count for less.
 */
export function metroScores(cells: readonly HeatCell[], metros: readonly Metro[] = US_METROS): MetroScore[] {
  const acc = new Map<string, { w: number; s: number; n: number; m: Metro }>();
  for (const c of cells) {
    let best: Metro | null = null;
    let bestD = Infinity;
    for (const m of metros) {
      const d = haversineKm(c.lat, c.lon, m.lat, m.lon);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (!best || bestD > METRO_RADIUS_KM) continue;
    const w = Math.max(c.popularity, 1e-6);
    const cur = acc.get(best.name) ?? { w: 0, s: 0, n: 0, m: best };
    cur.w += w;
    cur.s += w * c.affinityRank;
    cur.n += 1;
    acc.set(best.name, cur);
  }
  return [...acc.values()]
    .map((v) => ({ metro: v.m.name, lat: v.m.lat, lon: v.m.lon, score: v.s / v.w, cells: v.n }))
    .sort((a, b) => b.score - a.score);
}
