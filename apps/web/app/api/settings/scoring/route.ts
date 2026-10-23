import { DEAL_TYPES, DEFAULT_SCORING, METRIC_KEYS, type ScoringConfig } from '@simpatico/core';
import { scoringConfig } from '@simpatico/engine';
import { getDeps } from '@/lib/runtime';
import { body, fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  return json({ scoring: await scoringConfig(await getDeps()), defaults: DEFAULT_SCORING });
}

const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Replace the scoring config (weights, flag thresholds, verdict bands). Validated; used by the next run. */
export async function PUT(req: Request) {
  try {
    if (process.env.SETTINGS_LOCKED === '1') return json({ error: 'Settings are locked on this deployment.' }, 403);
    const b = await body<ScoringConfig | { reset: true }>(req);
    const deps = await getDeps();
    if ('reset' in b) {
      await deps.store.settings.set('scoring', DEFAULT_SCORING);
      return json({ scoring: DEFAULT_SCORING });
    }
    for (const d of DEAL_TYPES) {
      const w = b.weights?.[d];
      if (!w || !METRIC_KEYS.every((k) => num(w[k], 0, 1))) return json({ error: `weights.${d} must have m1..m6 in [0, 1]` }, 400);
      if (METRIC_KEYS.reduce((s, k) => s + w[k], 0) <= 0) return json({ error: `weights.${d} must not all be 0` }, 400);
    }
    const f = b.flags;
    if (!f || !num(f.oneSidedRatio, 0, 1) || !num(f.tasteMissingShare, 0, 1) || !num(f.tasteOverlapMax, 0, 1) || !num(f.demographicMin, 0, 1) || !num(f.fadingZ, -3, 0) || !num(f.geoMin, 0, 1)) {
      return json({ error: 'flag thresholds out of range' }, 400);
    }
    const bd = b.bands;
    if (!bd || !num(bd.advanceMin, 0, 100) || !num(bd.watchMin, 0, 100) || !num(bd.minCoverage, 0, 1) || bd.watchMin > bd.advanceMin) {
      return json({ error: 'bands out of range (watchMin must be <= advanceMin)' }, 400);
    }
    const clean: ScoringConfig = {
      weights: Object.fromEntries(DEAL_TYPES.map((d) => [d, Object.fromEntries(METRIC_KEYS.map((k) => [k, b.weights[d][k]]))])) as ScoringConfig['weights'],
      flags: { oneSidedRatio: f.oneSidedRatio, tasteMissingShare: f.tasteMissingShare, tasteOverlapMax: f.tasteOverlapMax, demographicMin: f.demographicMin, fadingZ: f.fadingZ, geoMin: f.geoMin },
      bands: { advanceMin: bd.advanceMin, watchMin: bd.watchMin, minCoverage: bd.minCoverage },
    };
    await deps.store.settings.set('scoring', clean);
    return json({ scoring: clean });
  } catch (err) {
    return fail(err);
  }
}
