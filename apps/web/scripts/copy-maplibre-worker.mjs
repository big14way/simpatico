// MapLibre loads its web worker by URL; bundlers can't rewrite that, and workers must be
// same-origin. Serve the package's self-contained worker module from /public.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'));
mkdirSync('public', { recursive: true });
copyFileSync(path.join(dist, 'maplibre-gl-worker.mjs'), path.join('public', 'maplibre-gl-worker.js'));
console.log('copied the maplibre worker to public/maplibre-gl-worker.js');
