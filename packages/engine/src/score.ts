import {
  buildEvidenceRows,
  composite,
  decideVerdict,
  redFlags,
  type EvidenceRow,
  type FlagHit,
  type MetricKey,
  type MetricResult,
} from '@simpatico/core';
import type { TargetRecord } from '@simpatico/store';
import { scoringConfig } from './context';
import type { RunCtx } from './run-context';

/** The numeric/descriptive slice of a target's Qloo profile that bull and bear may cite. */
export function profileForEvidence(t: TargetRecord): Record<string, unknown> {
  const p = t.profile ?? {};
  const pick = (k: string) => (p[k] === undefined ? null : p[k]);
  return {
    name: t.name,
    screenRank: t.screenRank,
    forwardAffinity: t.forwardAffinity,
    popularity: t.popularity,
    foundedYear: pick('foundedYear'),
    ultimateParent: pick('ultimateParent'),
    ownership: pick('ownership'),
    marketPositioning: pick('marketPositioning'),
    keyMarkets: pick('keyMarkets'),
    knownPartnerships: pick('knownPartnerships'),
    competitorBrands: pick('competitorBrands'),
    priceRangeUsd: pick('priceRangeUsd'),
    /** which buyer signal entities drive the forward affinity (Qloo explainability) */
    drivers: pick('drivers'),
    sharedCategories: pick('sharedCategories'),
  };
}

/** Stage 6: composite score, red flags and the pre-debate verdict; writes the evidence rows. */
export async function stageScore(ctx: RunCtx): Promise<void> {
  const cfg = await scoringConfig(ctx.deps);
  const weights = cfg.weights[ctx.mandate.dealType];
  const shortlist = ctx.state.shortlist ?? [];
  const keys = ctx.state.keys ?? {};
  await ctx.emit('stage', 'Scoring in code: composite, coverage, red flags...');

  const targets = (await Promise.all(shortlist.map((id) => ctx.deps.store.targets.get(ctx.runId, id)))).filter((t): t is TargetRecord => !!t && !!t.metrics);
  const computed = targets.map((t) => {
    const metrics = t.metrics as unknown as Record<MetricKey, MetricResult>;
    const comp = composite(metrics, weights, cfg.bands.minCoverage);
    const flags: FlagHit[] = comp.F === null ? [] : redFlags(metrics, ctx.mandate.dealType, cfg.flags);
    const verdict = decideVerdict({ F: comp.F, coverage: comp.coverage, flags, mitigated: [] }, cfg.bands);
    return { t, metrics, comp, flags, verdict };
  });

  const rows = buildEvidenceRows(
    computed.map((c) => ({
      targetKey: keys[c.t.targetId] ?? c.t.targetId,
      targetId: c.t.targetId,
      targetName: c.t.name,
      metrics: c.metrics,
      composite: c.comp,
      flags: c.flags,
      profile: profileForEvidence(c.t),
      profileSources: [...(ctx.state.screenEvidenceIds ?? []), ...(typeof c.t.profile?.compareEvidenceId === 'string' ? [c.t.profile.compareEvidenceId] : [])],
    })),
  );

  await Promise.all(
    computed.map(async (c) => {
      await ctx.deps.store.evidence.replaceForTarget(ctx.runId, c.t.targetId, rows.get(c.t.targetId) as EvidenceRow[]);
      await ctx.deps.store.targets.upsert({
        ...c.t,
        stage: 'scored',
        composite: c.comp as unknown as Record<string, unknown>,
        flags: c.flags,
        verdict: c.verdict.verdict,
        why: c.verdict.why,
        score: c.comp.F,
        coverage: c.comp.coverage,
      });
    }),
  );
  const counts = computed.reduce<Record<string, number>>((acc, c) => ((acc[c.verdict.verdict] = (acc[c.verdict.verdict] ?? 0) + 1), acc), {});
  await ctx.emit('info', `Scored ${computed.length} target(s): ${Object.entries(counts).map(([v, n]) => `${n} ${v}`).join(', ')} (before debate).`);
}
