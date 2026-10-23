// Name -> Qloo entity resolution. /search returns no relevance score, so "confident" is
// decided from the names themselves; anything else becomes a confirm chip for a human.
// We never silently take the first hit.

import type { EntityHit } from '@simpatico/qloo';
import type { RunCtx } from './run-context';
import { QlooCallError } from './run-context';
import type { PendingResolution, ResolvedEntity, Role, UniverseItem } from './state';

const SUFFIXES = new Set(['co', 'company', 'inc', 'llc', 'ltd', 'corp', 'corporation', 'brand', 'brands']);

export function normalizeName(s: string): string {
  const base = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’'`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const words = base.split(' ').filter(Boolean);
  if (words[0] === 'the' && words.length > 1) words.shift();
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(' ');
}

function tokens(s: string): Set<string> {
  return new Set(normalizeName(s).split(' ').filter(Boolean));
}

function subset(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return a.size > 0;
}

/** a name-compatible hit wins outright when it is this much more popular than the next one */
export const POPULARITY_MARGIN = 0.25;

export type Resolution =
  | { decision: 'resolved'; hit: EntityHit; reason: 'exact' | 'contains' | 'popularity' }
  | { decision: 'ambiguous'; candidates: EntityHit[] }
  | { decision: 'none' };

export function chooseHit(query: string, hits: readonly EntityHit[]): Resolution {
  if (hits.length === 0) return { decision: 'none' };
  const q = normalizeName(query);
  const squash = (x: string) => x.replace(/ /g, '');
  const exact = hits.filter((h) => normalizeName(h.name) === q);
  const exactLoose = exact.length > 0 ? exact : hits.filter((h) => squash(normalizeName(h.name)) === squash(q));
  if (exactLoose.length === 1) return { decision: 'resolved', hit: exactLoose[0]!, reason: 'exact' };
  if (exactLoose.length > 1) return { decision: 'ambiguous', candidates: exactLoose.slice(0, 3) };
  const qt = tokens(query);
  const lead = q.split(' ')[0] ?? '';
  // query inside the hit ("Siete" -> "Siete Family Foods"), or a shorter hit that keeps the
  // query's lead word and at least half of its words ("On Running" -> "On"). "Aime Leon Dore"
  // must match neither "DORÉ" (no lead word) nor "Aime" (one word of three).
  const containing = hits.filter((h) => {
    const ht = tokens(h.name);
    return subset(qt, ht) || (subset(ht, qt) && ht.has(lead) && ht.size * 2 >= qt.size);
  });
  // exactly one name-compatible hit ("Spindrift" -> "Spindrift Sparkling Water")
  if (containing.length === 1) return { decision: 'resolved', hit: containing[0]!, reason: 'contains' };
  // several compatible hits, but one is far better known ("Quaker" -> Quaker Oats, not Quaker Steak & Lube)
  if (containing.length > 1) {
    const byPop = [...containing].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    if ((byPop[0]!.popularity ?? 0) - (byPop[1]!.popularity ?? 0) >= POPULARITY_MARGIN) {
      return { decision: 'resolved', hit: byPop[0]!, reason: 'popularity' };
    }
    return { decision: 'ambiguous', candidates: byPop.slice(0, 3) };
  }
  return { decision: 'ambiguous', candidates: hits.slice(0, 3) };
}

/** Ultimate-parent comparison ("PepsiCo, Inc." vs "PepsiCo"). */
export function sameParent(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeName(a) === normalizeName(b);
}

export type Ownership = 'owned_by_buyer' | 'independent' | 'part_of_other' | 'unknown';

/**
 * Who owns a target, from Qloo's entity data. "independent" when the parent's name shares a
 * distinctive word with the brand ("Chobani" / "Chobani, LLC").
 */
export function ownershipOf(brandName: string, parent: string | null | undefined, buyerParents: readonly string[]): Ownership {
  if (!parent) return 'unknown';
  if (buyerParents.some((b) => sameParent(parent, b))) return 'owned_by_buyer';
  const bt = [...tokens(brandName)].filter((t) => t.length >= 3);
  const pt = tokens(parent);
  return bt.some((t) => pt.has(t)) ? 'independent' : 'part_of_other';
}

// ------------------------------------------------------------------ stage

interface Job {
  role: Role;
  index: number;
  query: string;
  entityId?: string;
  pin?: boolean;
}

export async function stageResolve(ctx: RunCtx): Promise<'continue' | 'needs_input'> {
  const { mandate } = ctx;
  const jobs: Job[] = [
    { role: 'buyer', index: 0, query: mandate.buyer.name, entityId: mandate.buyer.entityId },
    ...mandate.proxies.map((p, i) => ({ role: 'proxy' as const, index: i, query: p.name, entityId: p.entityId })),
    ...mandate.universe.map((u, i) => ({ role: 'universe' as const, index: i, query: u.name, entityId: u.entityId, pin: u.pin })),
  ];
  const toSearch = jobs.filter((j) => !j.entityId);
  await ctx.emit('stage', `Resolving ${toSearch.length} name(s) against Qloo's brand catalogue...`);

  // results are written by job position so the order never depends on network timing
  const outcome: ({ kind: 'resolved'; e: ResolvedEntity } | { kind: 'pending'; p: PendingResolution } | { kind: 'none'; u: { role: Role; query: string; reason: string } })[] = [];

  await Promise.all(
    jobs.map(async (job, pos) => {
      if (job.entityId) {
        outcome[pos] = { kind: 'resolved', e: { id: job.entityId, name: job.query, query: job.query, role: job.role, imageUrl: null, pin: job.pin } };
        return;
      }
      const env = await ctx.qloo.search(job.query, { types: ['urn:entity:brand'], take: 5 }, { runId: ctx.runId, purpose: `resolve ${job.role}` });
      if (env.status === 'error') throw new QlooCallError(`Qloo search failed for "${job.query}": ${env.error?.message ?? 'unknown error'}`);
      const r = chooseHit(job.query, env.results);
      if (r.decision === 'resolved') {
        outcome[pos] = { kind: 'resolved', e: { id: r.hit.id, name: r.hit.name, query: job.query, role: job.role, imageUrl: r.hit.imageUrl, pin: job.pin } };
      } else if (r.decision === 'ambiguous') {
        outcome[pos] = { kind: 'pending', p: {
          role: job.role,
          index: job.index,
          query: job.query,
          candidates: r.candidates.map((c) => ({
            id: c.id,
            name: c.name,
            popularity: c.popularity,
            disambiguation: c.disambiguation,
            description: c.description,
            imageUrl: c.imageUrl,
          })),
        } };
      } else {
        outcome[pos] = { kind: 'none', u: { role: job.role, query: job.query, reason: 'Qloo has no brand entity with this name' } };
      }
    }),
  );

  const resolved = outcome.flatMap((o) => (o.kind === 'resolved' ? [o.e] : []));
  const pending = outcome.flatMap((o) => (o.kind === 'pending' ? [o.p] : []));
  const unresolved = outcome.flatMap((o) => (o.kind === 'none' ? [o.u] : []));

  if (unresolved.some((u) => u.role === 'buyer')) {
    throw new QlooCallError(`Qloo has no brand entity for the buyer "${mandate.buyer.name}". Try the brand name customers know (e.g. a flagship brand).`);
  }
  if (pending.length > 0) {
    ctx.state.pending = pending;
    ctx.state.unresolved = unresolved;
    await ctx.save();
    await ctx.emit('needs_input', `${pending.length} name(s) are ambiguous in Qloo. Confirm them to continue.`, { pending });
    return 'needs_input';
  }

  const buyer = resolved.find((r) => r.role === 'buyer')!;
  const proxies = resolved.filter((r) => r.role === 'proxy');
  const signalIds = [...new Set([buyer.id, ...proxies.map((p) => p.id)])];

  // corporate parents of the buyer's brands (insights results carry them; /search does not)
  const prof = await ctx.qloo.rankProfiles(
    { filterType: 'urn:entity:brand', signalEntities: [buyer.id], candidates: signalIds, take: signalIds.length },
    { runId: ctx.runId, purpose: 'buyer corporate profile', subjects: signalIds },
  );
  const parents = [...new Set(prof.results.map((p) => p.ultimateParent ?? p.immediateParent ?? p.ownedBy).filter((x): x is string => !!x))];
  const own = prof.results.find((p) => p.id === buyer.id);
  const parent = (own ? own.ultimateParent ?? own.immediateParent ?? own.ownedBy : null) ?? parents[0] ?? null;

  const seen = new Set(signalIds);
  const universe: UniverseItem[] = [];
  for (const r of resolved.filter((x) => x.role === 'universe')) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    universe.push({ id: r.id, name: r.name, source: 'list', imageUrl: r.imageUrl, pinned: !!r.pin });
  }

  ctx.state.buyer = { name: buyer.name, entities: [buyer, ...proxies], signalIds, brandIds: signalIds, parent, parents };
  ctx.state.universe = universe;
  ctx.state.pending = [];
  ctx.state.unresolved = unresolved;
  await ctx.save();
  const notFound = unresolved.length > 0 ? `; not in Qloo: ${unresolved.map((u) => u.query).join(', ')}` : '';
  await ctx.emit('info', `Buyer signal: ${[buyer, ...proxies].map((e) => e.name).join(' + ')}${parent ? ` (parent: ${parent})` : ''}. Universe: ${universe.length} brands${notFound}.`);
  return 'continue';
}
