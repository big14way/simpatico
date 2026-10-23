import {
  CROSS_DOMAINS,
  CROSS_DOMAIN_TAKE,
  MOMENTUM_WEEKS,
  TASTE_PROFILE_TAKE,
  TASTE_TAG_TYPES,
  computeMomentum,
  crossDomain,
  demographicAlignment,
  geoFootprint,
  metroBaseline,
  metroScores,
  type MetroScore,
  momentumMetric,
  tasteOverlap,
  trendingWindow,
  twoWayAffinity,
  type MetricKey,
  type MetricResult,
} from '@simpatico/core';
import type { EntityUrn, Envelope, InsightEntity } from '@simpatico/qloo';
import type { RunCtx } from './run-context';
import type { BuyerProfile } from './state';

function uncovered(key: MetricKey, env: Envelope<unknown>, sources: string[]): MetricResult {
  return {
    key,
    value: null,
    coverage: 0,
    note: env.status === 'error' ? `Qloo error: ${env.error?.message ?? 'unknown'}` : 'Qloo returned no data for this call.',
    data: {},
    sources,
  };
}

/** Coverage 0.5 when Qloo flagged the response as partial/degraded (blueprint rule). */
function degrade(m: MetricResult, env: Envelope<unknown>): MetricResult {
  if ((env.status === 'partial' || env.status === 'degraded') && m.coverage === 1) {
    return { ...m, coverage: 0.5, note: m.note ?? `Qloo marked this response ${env.status}.` };
  }
  return m;
}

/** Stage 5: the six metrics for every shortlisted target. */
export async function stageAnalyze(ctx: RunCtx): Promise<void> {
  const buyer = ctx.state.buyer!;
  const shortlist = ctx.state.shortlist ?? [];
  const q = ctx.qloo;
  const runId = ctx.runId;
  const region = ctx.mandate.region;
  const asOf = ctx.state.asOf;
  await ctx.emit('stage', `Analysing ${shortlist.length} target(s) on six audience metrics (asking Qloo ~${shortlist.length * 9 + 8} questions)...`);

  // ---- buyer-level calls (shared by every target)
  const [buyerTags, buyerDomains, buyerHeat, demo] = await Promise.all([
    q.tagProfile({ signalEntities: buyer.signalIds, tagTypes: [...TASTE_TAG_TYPES], take: TASTE_PROFILE_TAKE }, { runId, purpose: 'm2 taste profile: buyer', subjects: buyer.signalIds }),
    Promise.all(
      CROSS_DOMAINS.map((d) =>
        q.recommend(
          { filterType: d.type as EntityUrn, signalEntities: buyer.signalIds, take: CROSS_DOMAIN_TAKE },
          { runId, purpose: `m3 ${d.label} favourites: buyer`, subjects: buyer.signalIds },
        ),
      ),
    ),
    q.heatmap({ signalEntities: buyer.signalIds, location: region }, { runId, purpose: 'm5 heatmap: buyer', subjects: buyer.signalIds }),
    q.demographics([...buyer.signalIds, ...shortlist], { runId, purpose: 'm4 demographics', subjects: [...buyer.signalIds, ...shortlist] }),
  ]);
  const buyerMetros = buyerHeat.status === 'ok' || buyerHeat.status === 'partial' ? metroScores(buyerHeat.results) : [];

  // ---- momentum cohort: buyer brands + shortlist
  const window = trendingWindow(asOf, MOMENTUM_WEEKS);
  const cohortIds = [...new Set([...buyer.brandIds, ...shortlist])];
  const trend = new Map(
    await Promise.all(
      cohortIds.map(async (id) => {
        const env = await q.trending(
          { filterType: 'urn:entity:brand', entity: id, startDate: window.startDate, endDate: window.endDate, take: 50 },
          { runId, purpose: 'm6 trending', subjects: [id] },
        );
        return [id, env] as const;
      }),
    ),
  );
  const momentum = computeMomentum(
    cohortIds.map((id) => ({ entityId: id, points: trend.get(id)!.status === 'error' ? [] : trend.get(id)!.results })),
    asOf,
    MOMENTUM_WEEKS,
  );

  ctx.state.notes = [
    ...(ctx.state.notes ?? []).filter((n) => !n.startsWith('Momentum')),
    `Momentum window: ${MOMENTUM_WEEKS} weeks to ${asOf}, relative to a cohort of ${cohortIds.length} brands.`,
  ];
  const buyerProfile: BuyerProfile = {
    topTags: buyerTags.results.slice(0, 12).map((t) => ({ name: t.name, subtype: t.subtype })),
    domains: CROSS_DOMAINS.map((d, i) => ({ label: d.label, top: buyerDomains[i]!.results.slice(0, 6).map((e) => e.name) })),
    metros: buyerMetros,
  };
  ctx.state.buyerProfile = buyerProfile;
  await ctx.save();

  // ---- per target
  let done = 0;
  let fetched = 0;
  const analysed = await Promise.all(
    shortlist.map(async (id) => {
      const target = await ctx.deps.store.targets.get(runId, id);
      if (!target) return null;
      const subjects = [id];
      const [reverse, tags, cross, heat, cmp] = await Promise.all([
        q.rank(
          { filterType: 'urn:entity:brand', signalEntities: [id], candidates: buyer.brandIds, take: buyer.brandIds.length },
          { runId, purpose: 'm1 reverse affinity', subjects },
        ),
        q.tagProfile({ signalEntities: [id], tagTypes: [...TASTE_TAG_TYPES], take: TASTE_PROFILE_TAKE }, { runId, purpose: 'm2 taste profile: target', subjects }),
        Promise.all(
          CROSS_DOMAINS.map((d, i) => {
            const list = buyerDomains[i]!;
            if (list.status === 'error' || list.results.length === 0) return Promise.resolve(null);
            return q.rank(
              { filterType: d.type as EntityUrn, signalEntities: [id], candidates: list.results.map((e) => e.id), take: list.results.length },
              { runId, purpose: `m3 ${d.label} cross-rank`, subjects },
            );
          }),
        ),
        q.heatmap({ signalEntities: [id], location: region }, { runId, purpose: 'm5 heatmap: target', subjects }),
        q.compare(buyer.signalIds, [id], { runId, purpose: 'category adjacency', subjects }),
      ]);

      // m1
      const m1Sources = [...(ctx.state.screenEvidenceIds ?? []), reverse.evidenceId];
      const m1 =
        reverse.status === 'error'
          ? uncovered('m1', reverse, m1Sources)
          : twoWayAffinity({
              a: target.forwardAffinity,
              reverse: reverse.results.map((r: InsightEntity) => ({ id: r.id, name: r.name, affinity: r.affinity })),
              reverseExpected: buyer.brandIds.length,
              sources: m1Sources,
            });

      // m2
      const m2Sources = [buyerTags.evidenceId, tags.evidenceId];
      const m2 =
        buyerTags.status === 'error' ? uncovered('m2', buyerTags, m2Sources)
        : tags.status === 'error' ? uncovered('m2', tags, m2Sources)
        : tasteOverlap({ buyer: buyerTags.results, target: tags.results, sources: m2Sources });

      // m3
      const m3Sources = [...buyerDomains.map((d) => d.evidenceId), ...cross.flatMap((c) => (c ? [c.evidenceId] : []))];
      const m3 = crossDomain({
        domains: CROSS_DOMAINS.map((d, i) => ({
          type: d.type,
          label: d.label,
          buyerTop: buyerDomains[i]!.status === 'error' ? [] : buyerDomains[i]!.results.map((e) => ({ id: e.id, name: e.name })),
          targetAffinity: cross[i] && cross[i]!.status !== 'error' ? cross[i]!.results.map((e) => ({ id: e.id, affinity: e.affinity })) : [],
        })),
        sources: m3Sources,
      });

      // m4
      const m4 =
        demo.status === 'error'
          ? uncovered('m4', demo, [demo.evidenceId])
          : demographicAlignment({
              buyer: demo.results.filter((r) => buyer.signalIds.includes(r.entityId)),
              target: demo.results.find((r) => r.entityId === id) ?? null,
              sources: [demo.evidenceId],
            });

      // m6
      const m6 = momentumMetric(momentum.get(id), cohortIds.map((c) => trend.get(c)!.evidenceId));

      const sharedCategories = cmp.status === 'error' ? [] : cmp.results.shared.slice(0, 6).map((t) => ({ name: t.name, score: t.score }));
      fetched++;
      await ctx.emit('progress', `Qloo evidence in for ${target.name} (${fetched}/${shortlist.length}).`, { targetId: id, fetched, total: shortlist.length });
      return {
        target,
        partial: { m1: degrade(m1, reverse), m2: degrade(m2, tags), m3, m4: degrade(m4, demo), m6 },
        heat,
        metros: heat.status === 'error' ? null : metroScores(heat.results),
        sharedCategories,
        compareEvidenceId: cmp.evidenceId,
      };
    }),
  );

  // ---- m5 needs every heatmap: footprints are compared relative to the cohort mean
  const ready = analysed.filter((a): a is NonNullable<typeof a> => a !== null);
  const cohortMetros: MetroScore[][] = [buyerMetros, ...ready.flatMap((a) => (a.metros && a.metros.length > 0 ? [a.metros] : []))];
  const baseline = buyerMetros.length > 0 && cohortMetros.length >= 3 ? metroBaseline(cohortMetros) : undefined;
  await Promise.all(ready.map(async (a) => {
    const m5Sources = [buyerHeat.evidenceId, a.heat.evidenceId];
    const m5 =
      buyerHeat.status === 'error' ? uncovered('m5', buyerHeat, m5Sources)
      : a.heat.status === 'error' ? uncovered('m5', a.heat, m5Sources)
      : geoFootprint({ buyer: buyerMetros, target: a.metros ?? [], baseline, sources: m5Sources });
    const metrics: Record<MetricKey, MetricResult> = { ...a.partial, m5: degrade(m5, a.heat) };
    await ctx.deps.store.targets.upsert({
      ...a.target,
      stage: 'analysed',
      metrics,
      profile: { ...(a.target.profile ?? {}), sharedCategories: a.sharedCategories, compareEvidenceId: a.compareEvidenceId },
    });
    done++;
    const coveredCount = Object.values(metrics).filter((m) => m.coverage > 0).length;
    await ctx.emit('progress', `Analysed ${a.target.name} (${done}/${ready.length}): ${coveredCount}/6 metrics measured.`, { targetId: a.target.targetId, done, total: ready.length });
  }));
}
