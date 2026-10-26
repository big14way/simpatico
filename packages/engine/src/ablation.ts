// Proof that Qloo is load-bearing: run the same screen four ways and compare.
//   Full                 the run as scored
//   No Qloo (LLM-only)   the same model ranks the same universe from general knowledge
//   minus cross-domain   m3 removed from the composite
//   minus two-way        m1 uses forward affinity only (b dropped; one-sided flag can't fire)

import {
  composite,
  decideVerdict,
  kendallTauB,
  redFlags,
  spearman,
  topKOverlap,
  type FlagHit,
  type MetricKey,
  type MetricResult,
  type RedFlag,
  type Weights,
} from '@simpatico/core';
import { newId } from '@simpatico/qloo';
import type { TargetRecord } from '@simpatico/store';
import { scoringConfig, type EngineDeps } from './context';
import type { Mandate } from './mandate';
import type { RunState } from './state';

export interface VariantResult {
  key: 'full' | 'llm_only' | 'minus_cross_domain' | 'minus_two_way';
  label: string;
  available: boolean;
  note: string | null;
  /** target ids, best first */
  ranking: string[];
  tauVsFull: number | null;
  top5Overlap: number | null;
  verdictFlips: { targetId: string; name: string; from: string; to: string }[];
  advanceFlips: number;
  /** Spearman between ranking position (best = highest) and Qloo popularity: fame bias */
  fameRho: number | null;
}

export interface AblationResult {
  runId: string;
  createdAt: string;
  model: string | null;
  shortlist: { id: string; name: string; popularity: number | null }[];
  variants: VariantResult[];
  /** stage-1 view over the whole universe: Qloo forward affinity vs LLM-only */
  universe: {
    size: number;
    tauQlooVsLlm: number | null;
    top5Overlap: number | null;
    fameRhoQloo: number | null;
    fameRhoLlm: number | null;
    llmRanking: string[];
    qlooRanking: string[];
  } | null;
}

function fameRho(ranking: string[], pop: Map<string, number | null>): number | null {
  const ids = ranking.filter((id) => typeof pop.get(id) === 'number');
  if (ids.length < 3) return null;
  return spearman(
    ids.map((_, i) => ids.length - i),
    ids.map((id) => pop.get(id)!),
  );
}

function tau(a: string[], b: string[]): number | null {
  const common = a.filter((id) => b.includes(id));
  if (common.length < 3) return null;
  return kendallTauB(
    common.map((id) => common.length - a.indexOf(id)),
    common.map((id) => common.length - b.indexOf(id)),
  );
}

interface Scored {
  t: TargetRecord;
  F: number | null;
  verdict: string;
}

function rescore(
  targets: TargetRecord[],
  dealType: Mandate['dealType'],
  weights: Weights,
  cfg: Awaited<ReturnType<typeof scoringConfig>>,
  mitigated: Map<string, RedFlag[]>,
  edit: (m: Record<MetricKey, MetricResult>) => Record<MetricKey, MetricResult>,
): Scored[] {
  return targets.map((t) => {
    const metrics = edit(structuredClone(t.metrics) as unknown as Record<MetricKey, MetricResult>);
    const comp = composite(metrics, weights, cfg.bands.minCoverage);
    const flags: FlagHit[] = comp.F === null ? [] : redFlags(metrics, dealType, cfg.flags);
    const v = decideVerdict({ F: comp.F, coverage: comp.coverage, flags, mitigated: mitigated.get(t.targetId) ?? [] }, cfg.bands);
    return { t, F: comp.F, verdict: v.verdict };
  });
}

const rankOf = (xs: Scored[]) => [...xs].filter((x) => x.F !== null).sort((p, q) => q.F! - p.F!).map((x) => x.t.targetId);

export async function runAblation(deps: EngineDeps, runId: string): Promise<AblationResult> {
  const run = await deps.store.runs.get<Mandate, RunState>(runId);
  if (!run || run.status !== 'done') throw new Error('Ablation needs a finished run.');
  const cfg = await scoringConfig(deps);
  const shortlistIds = run.state.shortlist ?? [];
  const all = await deps.store.targets.list(runId);
  const targets = all.filter((t) => shortlistIds.includes(t.targetId) && t.metrics);
  const pop = new Map(all.map((t) => [t.targetId, t.popularity]));
  const claims = await deps.store.claims.list(runId);
  const mitigated = new Map<string, RedFlag[]>();
  for (const c of claims) if (c.side === 'bull' && c.accepted && c.flag) mitigated.set(c.targetId, [...(mitigated.get(c.targetId) ?? []), c.flag as RedFlag]);
  const dealType = run.mandate.dealType;
  const weights = cfg.weights[dealType];

  const full = rescore(targets, dealType, weights, cfg, mitigated, (m) => m);
  const fullRank = rankOf(full);
  const fullVerdict = new Map(full.map((x) => [x.t.targetId, x.verdict]));

  const variant = (key: VariantResult['key'], label: string, scored: Scored[] | null, ranking: string[] | null, note: string | null): VariantResult => {
    if (!ranking) return { key, label, available: false, note, ranking: [], tauVsFull: null, top5Overlap: null, verdictFlips: [], advanceFlips: 0, fameRho: null };
    const flips = (scored ?? [])
      .filter((x) => fullVerdict.get(x.t.targetId) !== x.verdict)
      .map((x) => ({ targetId: x.t.targetId, name: x.t.name, from: fullVerdict.get(x.t.targetId)!, to: x.verdict }));
    return {
      key,
      label,
      available: true,
      note,
      ranking,
      tauVsFull: key === 'full' ? 1 : tau(fullRank, ranking),
      top5Overlap: key === 'full' ? 1 : topKOverlap(fullRank, ranking, 5),
      verdictFlips: flips,
      advanceFlips: flips.filter((f) => f.from === 'ADVANCE' || f.to === 'ADVANCE').length,
      fameRho: fameRho(ranking, pop),
    };
  };

  const minusM3 = rescore(targets, dealType, { ...weights, m3: 0 }, cfg, mitigated, (m) => m);
  const minusTwoWay = rescore(targets, dealType, weights, cfg, mitigated, (m) => {
    const a = m.m1.data.a;
    if (typeof a !== 'number') return { ...m, m1: { ...m.m1, value: null, coverage: 0 } };
    // forward only: the one-sided flag needs b, so it can't fire
    return { ...m, m1: { ...m.m1, value: a, data: { a, value: a } } };
  });

  // LLM-only: the same model, no Qloo data, over the whole screened universe
  let llmRanking: string[] | null = null;
  let llmNote: string | null = null;
  const universe = all.filter((t) => t.forwardAffinity !== null);
  if (deps.agents) {
    try {
      const names = universe.map((t) => t.name);
      const out = await deps.agents.rankWithoutQloo({
        dealType,
        buyerName: run.state.buyer!.name,
        proxies: run.state.buyer!.entities.filter((e) => e.role === 'proxy').map((e) => e.name),
        candidates: names,
      });
      const idByName = new Map(universe.map((t) => [t.name, t.targetId]));
      llmRanking = out.ranking.map((n) => idByName.get(n)!).filter(Boolean);
      llmNote = out.notes;
    } catch (err) {
      llmNote = `LLM ranking failed: ${(err as Error).message}`;
    }
  } else {
    llmNote = 'No LLM configured (set ANTHROPIC_API_KEY).';
  }
  const llmShortlist = llmRanking ? llmRanking.filter((id) => shortlistIds.includes(id)) : null;
  const qlooUniverse = [...universe].sort((p, q) => q.forwardAffinity! - p.forwardAffinity!).map((t) => t.targetId);

  const result: AblationResult = {
    runId,
    createdAt: new Date().toISOString(),
    model: deps.agents ? (deps.agents.rankerModel ?? deps.agents.model) : null,
    shortlist: targets.map((t) => ({ id: t.targetId, name: t.name, popularity: t.popularity })),
    variants: [
      variant('full', 'Full (Qloo, six metrics)', full, fullRank, null),
      variant('llm_only', 'No Qloo (LLM-only ranking)', null, llmShortlist, llmNote),
      variant('minus_cross_domain', 'Qloo minus cross-domain (m3)', minusM3, rankOf(minusM3), 'm3 weight set to 0; the others renormalise.'),
      variant('minus_two_way', 'Qloo minus two-way (forward affinity only)', minusTwoWay, rankOf(minusTwoWay), 'm1 = forward affinity a; AUDIENCE_ONE_SIDED cannot fire.'),
    ],
    universe: llmRanking
      ? {
          size: universe.length,
          tauQlooVsLlm: tau(qlooUniverse, llmRanking),
          top5Overlap: topKOverlap(qlooUniverse, llmRanking, 5),
          fameRhoQloo: fameRho(qlooUniverse, pop),
          fameRhoLlm: fameRho(llmRanking, pop),
          llmRanking,
          qlooRanking: qlooUniverse,
        }
      : null,
  };
  await deps.store.ablations.save(newId('abl'), runId, result);
  return result;
}
