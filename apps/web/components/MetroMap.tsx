'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';

export interface MetroPoint {
  metro: string;
  lat: number;
  lon: number;
  target: number;
  buyer: number;
  targetRel?: number;
  buyerRel?: number;
}

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Footprint map. Orange = white space (the target's audience is distinctively strong there,
 * the buyer's isn't); blue = shared strongholds; grey = the rest. Size = the target's metro
 * affinity. Lists below carry the same information without the map.
 */
export function MetroMap({ points, whiteSpace, strongholds, targetName }: { points: MetroPoint[]; whiteSpace: string[]; strongholds: string[]; targetName: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let map: import('maplibre-gl').Map | null = null;
    let cancelled = false;
    (async () => {
      try {
        const maplibregl = await import('maplibre-gl');
        if (cancelled || !ref.current) return;
        maplibregl.setWorkerUrl('/maplibre-gl-worker.js');
        const css = getComputedStyle(document.documentElement);
        const c1 = css.getPropertyValue('--series-1').trim() || '#2a78d6';
        const c2 = css.getPropertyValue('--series-2').trim() || '#eb6834';
        const ring = css.getPropertyValue('--surface-1').trim() || '#fcfcfb';
        const m = new maplibregl.Map({
          container: ref.current,
          style: STYLE_URL,
          center: [-97, 38.5],
          zoom: 2.6,
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
        map = m;
        m.on('error', () => undefined);
        m.on('load', () => {
          const map = m;
          const features = points.map((p) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
            properties: {
              metro: p.metro,
              cls: whiteSpace.includes(p.metro) ? 'white' : strongholds.includes(p.metro) ? 'strong' : 'other',
              size: 4 + Math.max(0, Math.min(1, p.target)) * 8,
              target: p.target,
              buyer: p.buyer,
            },
          }));
          map.addSource('metros', { type: 'geojson', data: { type: 'FeatureCollection', features } });
          map.addLayer({
            id: 'metros',
            type: 'circle',
            source: 'metros',
            paint: {
              'circle-radius': ['get', 'size'],
              'circle-color': ['match', ['get', 'cls'], 'white', c2, 'strong', c1, '#9a998f'],
              'circle-opacity': ['match', ['get', 'cls'], 'other', 0.55, 0.95],
              'circle-stroke-color': ring,
              'circle-stroke-width': 2,
            },
          });
          const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
          map.on('mousemove', 'metros', (e) => {
            const f = e.features?.[0];
            if (!f || !map) return;
            map.getCanvas().style.cursor = 'pointer';
            const pr = f.properties as { metro: string; target: number; buyer: number; cls: string };
            const label = pr.cls === 'white' ? 'white space' : pr.cls === 'strong' ? 'shared stronghold' : '';
            popup
              .setLngLat((f.geometry as unknown as { coordinates: [number, number] }).coordinates)
              .setHTML(
                `<div style="font:12px system-ui;color:#0b0b0b"><b>${escapeHtml(pr.metro)}</b>${label ? ` · ${label}` : ''}<br/>${escapeHtml(targetName)}: ${Number(pr.target).toFixed(2)}<br/>buyer: ${Number(pr.buyer).toFixed(2)}</div>`,
              )
              .addTo(map);
          });
          map.on('mouseleave', 'metros', () => {
            if (map) map.getCanvas().style.cursor = '';
            popup.remove();
          });
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points, whiteSpace, strongholds, targetName]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4 text-xs" aria-label="Legend">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-s2" aria-hidden /> White space: {targetName} strong, buyer weak
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-s1" aria-hidden /> Shared stronghold
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-muted" aria-hidden /> Other metros
        </span>
      </div>
      {failed ? (
        <p className="rounded-lg border border-line p-3 text-sm text-muted">The map could not load here; the lists below carry the same information.</p>
      ) : (
        <div ref={ref} className="h-72 w-full overflow-hidden rounded-lg border border-line" role="img" aria-label={`Metro footprint map for ${targetName}`} />
      )}
    </div>
  );
}
