import { createHash } from 'node:crypto';
import { DEAL_TYPE_LABELS, languageGuard, type MetricKey, type MetricResult } from '@simpatico/core';
import { newId } from '@simpatico/qloo';
import type { PipelineStage, TargetRecord } from '@simpatico/store';
import type { RunCtx } from './run-context';

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const STAGE_FOR: Record<string, PipelineStage> = {
  ADVANCE: 'IC',
  WATCH: 'Debated',
  PASS: 'Screened',
  INSUFFICIENT_COVERAGE: 'Sourced',
};

const NEXT_STEP: Record<string, string> = {
  ADVANCE: 'Review the IC memo and approve the outreach draft',
  WATCH: 'Monitor: re-scored weekly',
  PASS: 'No action',
  INSUFFICIENT_COVERAGE: "Qloo can't see this brand well enough yet",
};

/** partnerships@<site domain> when Qloo has the official site; empty means "add a recipient". */
export function intendedRecipient(profile: Record<string, unknown> | null): string {
  const site = profile?.officialSite;
  if (typeof site !== 'string' || site.trim() === '') return '';
  try {
    const host = new URL(site.startsWith('http') ? site : `https://${site}`).hostname.replace(/^www\./, '');
    return host.includes('.') ? `partnerships@${host}` : '';
  } catch {
    return '';
  }
}

export function templateOutreach(dealType: keyof typeof DEAL_TYPE_LABELS, buyerName: string, targetName: string, facts: string[]): { subject: string; body: string } {
  const purpose =
    dealType === 'licensing' ? 'a licensing or co-branded collaboration' : dealType === 'vc_thesis' ? 'an introductory conversation about your plans' : 'a strategic partnership conversation';
  const body = [
    `Hi ${targetName} team,`,
    '',
    `I work with ${buyerName} on partnerships. Our audience research shows a strong overlap in what our two audiences care about, and we'd welcome ${purpose}.`,
    ...(facts.length ? ['', 'A few things that stood out:', ...facts.slice(0, 3).map((f) => `- ${f}`)] : []),
    '',
    'Would you be open to a 30-minute call in the next few weeks?',
    '',
    'Best regards,',
    `${buyerName} partnerships`,
  ].join('\n');
  return { subject: `${buyerName} x ${targetName}: exploring a partnership`, body };
}

/** Stage 9: update the pipeline, draft approval-gated outreach, register targets with the monitor. */
export async function stageAct(ctx: RunCtx): Promise<void> {
  const buyer = ctx.state.buyer!;
  const shortlist = ctx.state.shortlist ?? [];
  const targets = (await ctx.deps.store.targets.list(ctx.runId)).filter((t) => shortlist.includes(t.targetId));
  await ctx.emit('stage', 'Acting: pipeline board, outreach drafts (human approval required), monitor registration...');

  const byAffinity = [...targets].sort((p, q) => (q.forwardAffinity ?? -1) - (p.forwardAffinity ?? -1)).map((t) => t.targetId);
  let drafts = 0;
  await Promise.all(targets.map(async (t) => {
    const verdict = t.verdict ?? 'PASS';
    const metrics = (t.metrics ?? {}) as unknown as Partial<Record<MetricKey, MetricResult>>;
    const deal = await ctx.deps.store.pipeline.upsert({
      buyerKey: buyer.signalIds[0]!,
      buyerName: buyer.name,
      dealType: ctx.mandate.dealType,
      targetId: t.targetId,
      targetName: t.name,
      imageUrl: t.imageUrl,
      score: t.score,
      verdict,
      stage: STAGE_FOR[verdict] ?? 'Screened',
      nextStep: NEXT_STEP[verdict] ?? null,
      lastRunId: ctx.runId,
      monitored: verdict === 'ADVANCE' || verdict === 'WATCH',
      lastSnapshot: {
        runId: ctx.runId,
        F: t.score,
        verdict,
        screenRank: t.screenRank,
        shortlistRank: byAffinity.indexOf(t.targetId) + 1,
        forwardAffinity: t.forwardAffinity,
        momentumZ: (metrics.m6?.data?.z as number | null | undefined) ?? null,
        asOf: ctx.state.asOf,
        at: new Date().toISOString(),
      },
    });
    if (ctx.deps.mirror) {
      await ctx.deps.mirror.upsertDeal(deal as unknown as Record<string, unknown>).catch((err: Error) => ctx.emit('warn', `Pipeline mirror failed: ${err.message}`));
    }
    if (verdict === 'ADVANCE') {
      await draftFor(ctx, t, deal.id);
      drafts++;
    }
  }));

  if (ctx.deps.store && (await ctx.deps.store.runs.get(ctx.runId))?.scenario) {
    const pinned = await ctx.deps.store.cache.pinForRun(ctx.runId);
    await ctx.emit('info', `Pinned ${pinned} Qloo responses for replay of this showcase scenario (private server-side cache).`);
  }
  await ctx.emit('info', `Pipeline updated for ${targets.length} target(s); ${drafts} outreach draft(s) waiting for approval.`);
}

async function draftFor(ctx: RunCtx, t: TargetRecord, pipelineId: string): Promise<void> {
  const buyer = ctx.state.buyer!;
  const claims = await ctx.deps.store.claims.list(ctx.runId, t.targetId);
  const facts = claims.filter((c) => c.accepted && c.side === 'bull').slice(0, 3).map((c) => c.text);
  let draft = templateOutreach(ctx.mandate.dealType, buyer.name, t.name, facts);
  let model: string | null = null;
  if (ctx.deps.agents) {
    try {
      const d = await ctx.deps.agents.draftOutreach({ dealType: ctx.mandate.dealType, buyerName: buyer.name, targetName: t.name, facts });
      if (languageGuard(`${d.subject}\n${d.body}`).length === 0 && d.body.trim().length > 0) {
        draft = d;
        model = ctx.deps.agents.model;
      } else {
        await ctx.emit('warn', `Outreach draft for ${t.name} tripped the language guard; using the plain template.`);
      }
    } catch (err) {
      await ctx.emit('warn', `Outreach drafter failed for ${t.name} (${(err as Error).message}); using the plain template.`);
    }
  }
  await ctx.deps.store.outreach.create({
    id: newId('draft'),
    runId: ctx.runId,
    pipelineId,
    targetId: t.targetId,
    targetName: t.name,
    intendedRecipient: intendedRecipient(t.profile),
    subject: draft.subject,
    body: draft.body,
    bodySha256: sha256(draft.body),
    model,
  });
}
