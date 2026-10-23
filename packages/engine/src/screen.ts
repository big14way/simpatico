import type { EntityProfile, InsightEntity } from '@simpatico/qloo';
import { skipsGroupOwned } from './mandate';
import { ownershipOf, type Ownership } from './resolve';
import type { RunCtx } from './run-context';
import { QlooCallError } from './run-context';
import type { UniverseItem } from './state';

const RANK_CHUNK = 50;

/** Stage 3 (optional): brands the buyer's audience already over-indexes on, within chosen categories. */
export async function stageDiscover(ctx: RunCtx): Promise<void> {
  const d = ctx.mandate.discover;
  const buyer = ctx.state.buyer!;
  if (!d.enabled) return;
  const universe = ctx.state.universe ?? [];
  await ctx.emit(
    'stage',
    `Discovering brands the buyer's audience over-indexes on${d.categoryTags.length ? ` in ${d.categoryTags.map((t) => t.name).join(', ')}` : ''}...`,
  );
  const env = await ctx.qloo.recommend(
    {
      filterType: 'urn:entity:brand',
      signalEntities: buyer.signalIds,
      filterTags: d.categoryTags.map((t) => t.id),
      excludeEntities: [...buyer.signalIds, ...universe.map((u) => u.id)],
      popularityMax: d.popularityMax,
      take: d.take,
      explainability: true,
    },
    { runId: ctx.runId, purpose: 'discover', subjects: buyer.signalIds },
  );
  if (env.status === 'error') throw new QlooCallError(`Qloo discovery failed: ${env.error?.message ?? 'unknown error'}`);
  const room = Math.max(0, 60 - universe.length);
  const known = new Set([...buyer.signalIds, ...universe.map((u) => u.id)]);
  const added: UniverseItem[] = [];
  for (const e of env.results) {
    if (added.length >= room || known.has(e.id)) continue;
    known.add(e.id);
    added.push({ id: e.id, name: e.name, source: 'discover', imageUrl: e.imageUrl, discoveredAffinity: e.affinity });
  }
  ctx.state.universe = [...universe, ...added];
  await ctx.save();
  await ctx.emit('info', `Qloo discovery added ${added.length} brand(s): ${added.map((a) => a.name).join(', ') || 'none'}.`);
}

export interface ScreenedCandidate {
  id: string;
  name: string;
  affinity: number | null;
  popularity: number | null;
  imageUrl: string | null;
  explainability: { entityId: string; score: number }[];
  profile: EntityProfile | null;
  parent: string | null;
  ownership: Ownership;
  ownedByBuyer: boolean;
}

/** Stage 4: one rank call scores the whole universe for the buyer's audience; keep the top k. */
export async function stageScreen(ctx: RunCtx): Promise<void> {
  const buyer = ctx.state.buyer!;
  const universe = ctx.state.universe ?? [];
  if (universe.length === 0) throw new QlooCallError('The universe is empty after resolution: nothing to screen.');
  await ctx.emit('stage', `Ranking ${universe.length} brands against the buyer's audience...`);

  const scored = new Map<string, InsightEntity>();
  const profiles = new Map<string, EntityProfile>();
  const evidenceIds: string[] = [];
  for (let i = 0; i < universe.length; i += RANK_CHUNK) {
    const chunk = universe.slice(i, i + RANK_CHUNK).map((u) => u.id);
    const params = { filterType: 'urn:entity:brand' as const, signalEntities: buyer.signalIds, candidates: chunk, take: chunk.length, explainability: true };
    const env = await ctx.qloo.rank(params, { runId: ctx.runId, purpose: 'screen: forward affinity', subjects: chunk });
    if (env.status === 'error') throw new QlooCallError(`Qloo rank failed: ${env.error?.message ?? 'unknown error'}`);
    evidenceIds.push(env.evidenceId);
    for (const e of env.results) scored.set(e.id, e);
    const prof = await ctx.qloo.rankProfiles(params, { runId: ctx.runId, purpose: 'screen: entity profiles', subjects: chunk });
    for (const p of prof.results) profiles.set(p.id, p);
  }

  const candidates: ScreenedCandidate[] = universe.map((u) => {
    const e = scored.get(u.id);
    const p = profiles.get(u.id) ?? null;
    const parent = p ? p.ultimateParent ?? p.immediateParent ?? p.ownedBy : null;
    const ownership = ownershipOf(e?.name ?? u.name, parent, [...buyer.parents, ...(buyer.parent ? [buyer.parent] : [])]);
    return {
      id: u.id,
      name: e?.name ?? u.name,
      affinity: e ? e.affinity : null,
      popularity: e?.popularity ?? null,
      imageUrl: e?.imageUrl ?? u.imageUrl,
      explainability: e?.explainability ?? [],
      profile: p,
      parent,
      ownership,
      ownedByBuyer: ownership === 'owned_by_buyer',
    };
  });
  const ranked = [...candidates].sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1));

  const k = ctx.mandate.shortlistSize;
  const skipGroup = skipsGroupOwned(ctx.mandate);
  const skipped = (c: ScreenedCandidate) => (ctx.mandate.excludeOwned && c.ownedByBuyer) || (skipGroup && c.ownership === 'part_of_other');
  const eligible = ranked.filter((c) => c.affinity !== null && !skipped(c));
  const shortlist = eligible.slice(0, k).map((c) => c.id);
  const pinnedIds = [...ctx.mandate.pinned, ...universe.filter((u) => u.pinned).map((u) => u.id)];
  for (const id of pinnedIds) {
    // pinned brands are analysed even when owned or outside the top k (e.g. a back-test)
    if (!shortlist.includes(id) && candidates.some((c) => c.id === id && c.affinity !== null)) shortlist.push(id);
  }
  const keys: Record<string, string> = {};
  shortlist.forEach((id, i) => (keys[id] = `t${i + 1}`));

  const nameOf = new Map(buyer.entities.map((e) => [e.id, e.name]));
  for (const [i, c] of ranked.entries()) {
    await ctx.deps.store.targets.upsert({
      runId: ctx.runId,
      targetId: c.id,
      key: keys[c.id] ?? null,
      name: c.name,
      stage: shortlist.includes(c.id) ? 'shortlisted' : 'screened',
      screenRank: c.affinity === null ? null : i + 1,
      forwardAffinity: c.affinity,
      popularity: c.popularity,
      imageUrl: c.imageUrl,
      profile: c.profile
        ? {
            ...profileView(c.profile),
            ownership: c.ownership,
            drivers: c.explainability.map((x) => ({ name: nameOf.get(x.entityId) ?? x.entityId, score: x.score })),
            source: universe.find((u) => u.id === c.id)?.source ?? 'list',
          }
        : { ownership: c.ownership, drivers: [], source: universe.find((u) => u.id === c.id)?.source ?? 'list' },
      metrics: null,
      composite: null,
      flags: null,
      verdict: null,
      why:
        c.affinity === null
          ? 'Qloo did not score this brand for the buyer audience.'
          : !shortlist.includes(c.id) && skipped(c)
            ? c.ownedByBuyer
              ? `Already owned by ${String(buyer.parent).replace(/\.$/, '')}.`
              : `Part of ${String(c.parent).replace(/\.$/, '')}: not acquirable or venture-stage for this deal type.`
            : null,
      score: null,
      coverage: null,
      ownedByBuyer: c.ownedByBuyer,
      pinned: pinnedIds.includes(c.id),
    });
  }

  ctx.state.shortlist = shortlist;
  ctx.state.keys = keys;
  ctx.state.screenEvidenceIds = evidenceIds;
  await ctx.save();
  const owned = ranked.filter((c) => c.ownedByBuyer).map((c) => c.name);
  const grouped = ranked.filter((c) => c.ownership === 'part_of_other');
  const unscored = ranked.filter((c) => c.affinity === null).length;
  await ctx.emit(
    'info',
    `Shortlisted ${shortlist.length}: ${shortlist.map((id) => candidates.find((c) => c.id === id)!.name).join(', ')}.` +
      (owned.length ? ` Already owned by ${buyer.parent}: ${owned.join(', ')}${ctx.mandate.excludeOwned ? ' (skipped unless pinned)' : ''}.` : '') +
      (grouped.length && skipGroup
        ? ` Skipped as part of another group (not acquirable or venture-stage): ${grouped.filter((c) => !shortlist.includes(c.id)).map((c) => `${c.name} (${c.parent})`).join(', ')}.`
        : '') +
      (unscored ? ` ${unscored} brand(s) not scored by Qloo.` : ''),
  );
}

/** The corporate fields we keep on a target (all from Qloo's entity data). */
export function profileView(p: EntityProfile): Record<string, unknown> {
  return {
    foundedYear: p.foundedYear,
    ultimateParent: p.ultimateParent ?? p.immediateParent ?? p.ownedBy,
    headquartered: p.headquartered,
    marketPositioning: p.marketPositioning,
    keyMarkets: p.keyMarkets,
    knownPartnerships: p.knownPartnerships,
    competitorBrands: p.competitorBrands,
    priceRangeUsd: p.priceRangeUsd,
    description: p.description,
    officialSite: p.officialSite,
  };
}
