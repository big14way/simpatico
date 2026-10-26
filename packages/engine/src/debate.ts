import type { CallMeta } from '@simpatico/agents';
import { decideVerdict, judgeClaims, modelView, type Claim, type EvidenceRow, type FlagHit, type RedFlag } from '@simpatico/core';
import { newId } from '@simpatico/qloo';
import type { ClaimRecord, TargetRecord } from '@simpatico/store';
import { scoringConfig } from './context';
import type { RunCtx } from './run-context';

/**
 * Stage 7: bull and bear argue each scored target from the same evidence; the code judge
 * rules. Resumable: targets already debated are skipped, and it stops between targets when
 * the worker's time budget is spent ('partial').
 */
export async function stageDebate(ctx: RunCtx): Promise<void | 'partial'> {
  const agents = ctx.deps.agents;
  if (!agents) {
    await ctx.emit('warn', 'No LLM is configured, so the bull/bear debate was skipped. Verdicts come from the code rules alone (no mitigations).');
    return;
  }
  const cfg = await scoringConfig(ctx.deps);
  const shortlist = ctx.state.shortlist ?? [];
  const buyerName = ctx.state.buyer!.name;
  const targets = (await Promise.all(shortlist.map((id) => ctx.deps.store.targets.get(ctx.runId, id)))).filter(
    (t): t is TargetRecord => !!t && t.score !== null && t.stage !== 'debated',
  );
  if (targets.length === 0) return;
  await ctx.emit('stage', `Debating ${targets.length} target(s): bull vs bear, judged in code against the ledger...`);

  // a few targets at a time keeps model rate limits happy
  const queue = [...targets];
  const answers = { total: 0, cached: 0 };
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      if (ctx.shouldYield()) {
        queue.unshift(t);
        return;
      }
      await debateOne(ctx, t, buyerName, cfg, answers);
      ctx.progress();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (answers.cached > 0) {
    await ctx.emit('info', `${answers.cached} of ${answers.total} debate answers were replayed from stored Claude answers (same model, prompt and evidence); the judge re-checked every claim.`);
  }
  return queue.length > 0 ? 'partial' : undefined;
}

async function debateOne(
  ctx: RunCtx,
  t: TargetRecord,
  buyerName: string,
  cfg: Awaited<ReturnType<typeof scoringConfig>>,
  answers: { total: number; cached: number },
): Promise<void> {
  const agents = ctx.deps.agents!;
  const pack = (await ctx.deps.store.evidence.list(ctx.runId, t.targetId)) as EvidenceRow[];
  const flags = (t.flags ?? []) as FlagHit[];
  const computedFlags = flags.map((f) => f.flag);
  const evidence = pack.map(modelView);
  const base = {
    dealType: ctx.mandate.dealType,
    buyerName,
    targetName: t.name,
    evidence,
    flags: flags.map((f) => ({ flag: f.flag, rule: f.rule })),
    score: { F: t.score, coverage: t.coverage ?? 0 },
  };

  const argue = async (side: 'bull' | 'bear'): Promise<Claim[]> => {
    const meta: CallMeta = {};
    try {
      const claims = await agents.argue({ ...base, side }, meta);
      answers.total++;
      if (meta.cached) answers.cached++;
      return claims;
    } catch (err) {
      await ctx.emit('warn', `${side} agent failed for ${t.name}: ${(err as Error).message}`);
      return [];
    }
  };
  const [bullClaims, bearClaims] = await Promise.all([argue('bull'), argue('bear')]);
  const bull = judgeClaims({ side: 'bull', claims: bullClaims, pack, computedFlags });
  const bear = judgeClaims({ side: 'bear', claims: bearClaims, pack, computedFlags });

  const records: ClaimRecord[] = [];
  const add = (side: 'bull' | 'bear', claim: Claim, accepted: boolean, reason: string | null) =>
    records.push({
      id: newId('cl'),
      runId: ctx.runId,
      targetId: t.targetId,
      side,
      text: String(claim.text ?? ''),
      direction: claim.direction === '-' ? '-' : '+',
      flag: (claim.flag as RedFlag | null | undefined) ?? null,
      cites: Array.isArray(claim.cites) ? claim.cites : [],
      accepted,
      reason,
      model: agents.model,
    });
  for (const c of bull.accepted) add('bull', c, true, null);
  for (const r of bull.rejected) add('bull', r.claim, false, r.reason);
  for (const c of bear.accepted) add('bear', c, true, null);
  for (const r of bear.rejected) add('bear', r.claim, false, r.reason);
  await ctx.deps.store.claims.replaceForTarget(ctx.runId, t.targetId, records);

  const verdict = decideVerdict({ F: t.score, coverage: t.coverage ?? 0, flags, mitigated: bull.mitigates }, cfg.bands);
  await ctx.deps.store.targets.upsert({ ...t, stage: 'debated', verdict: verdict.verdict, why: verdict.why });

  const total = bullClaims.length + bearClaims.length;
  const rejected = bull.rejected.length + bear.rejected.length;
  await ctx.emit('progress', `${t.name}: ${total - rejected} of ${total} claims validated -> ${verdict.verdict}.`, { targetId: t.targetId });
  for (const r of [...bull.rejected.map((x) => ({ side: 'Bull', ...x })), ...bear.rejected.map((x) => ({ side: 'Bear', ...x }))].slice(0, 3)) {
    await ctx.emit('claim', `${r.side} claim rejected for ${t.name}: ${r.reason}`, { targetId: t.targetId });
  }
}
