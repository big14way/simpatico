import {
  DEAL_TYPE_LABELS,
  METRIC_KEYS,
  METRIC_LABELS,
  checkNumbers,
  languageGuard,
  modelView,
  numericLeaves,
  stringLeaves,
  type EvidenceRow,
  type FlagHit,
  type MetricKey,
  type MetricResult,
} from '@simpatico/core';
import type { MemoInput } from '@simpatico/agents';
import type { ClaimRecord, TargetRecord } from '@simpatico/store';
import { scoringConfig } from './context';
import type { RunCtx } from './run-context';

const f2 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const covWord = (c: number) => (c >= 1 ? 'full' : c > 0 ? 'partial' : 'not measured');

type Named = { name: string };
const names = (xs: unknown, n: number) =>
  Array.isArray(xs) ? (xs as Named[]).slice(0, n).map((x) => x.name).filter(Boolean) : [];

export interface MemoChecks {
  ok: boolean;
  unverifiedNumbers: string[];
  language: { phrase: string; match: string; suggestion: string }[];
  numbersChecked: number;
  repaired: boolean;
  source: 'llm' | 'template';
}

/** Numbers a memo may use: everything in the target's evidence, plus the rules it is judged by. */
export function allowedNumbers(pack: EvidenceRow[], extra: number[]): number[] {
  const out = new Set<number>(extra);
  for (const r of pack) for (const [, v] of numericLeaves(r.data)) out.add(v);
  return [...out];
}

export function runChecks(markdown: string, allowed: number[], dates: string[], maxCount: number, knownNames: string[] = []): Omit<MemoChecks, 'repaired' | 'source'> {
  const nums = checkNumbers({ text: markdown, allowed, allowedDates: dates, maxCount, knownNames });
  const language = languageGuard(markdown).map((v) => ({ phrase: v.phrase, match: v.match, suggestion: v.suggestion }));
  return {
    ok: nums.ok && language.length === 0,
    unverifiedNumbers: nums.unverified.map((n) => n.raw),
    language,
    numbersChecked: nums.numbers.length,
  };
}

/** Deterministic memo built straight from the ledger (used when no LLM is configured). */
export function templateMemo(input: MemoInput, metrics: Record<MetricKey, MetricResult>, flags: FlagHit[], bull: ClaimRecord[], bear: ClaimRecord[]): string {
  const t = input.target;
  const lines: string[] = [];
  lines.push(`## ${t.name}: ${t.verdict}`);
  lines.push('');
  lines.push(`**${DEAL_TYPE_LABELS[input.dealType]} screen for ${input.buyerName}.** Ranked #${t.rank} of ${input.shortlistSize} on composite audience fit.`);
  lines.push(`Composite fit F ${t.F === null ? 'n/a' : t.F.toFixed(1)}. Rule: ${t.why}`);
  lines.push('');
  lines.push('| Metric | Value | Coverage |');
  lines.push('|---|---|---|');
  for (const k of METRIC_KEYS) {
    const m = metrics[k];
    lines.push(`| ${METRIC_LABELS[k]} | ${m.value === null ? 'n/a' : f2(m.value)} | ${covWord(m.coverage)} |`);
  }
  lines.push('');
  const m2 = metrics.m2.data;
  const shared = names(m2.shared, 5);
  if (shared.length) lines.push(`**Shared taste.** Both audiences over-index on: ${shared.join(', ')}.`);
  const domains = Array.isArray(metrics.m3.data.domains) ? (metrics.m3.data.domains as { label: string; score: number | null; shared: Named[] }[]) : [];
  const dl = domains.filter((d) => d.score !== null && d.shared.length > 0).map((d) => `${d.label}: ${d.shared.slice(0, 2).map((s) => s.name).join(', ')}`);
  if (dl.length) lines.push(`**Across culture.** The buyer audience's favourites this audience embraces most. ${dl.join('; ')}.`);
  const ws = Array.isArray(metrics.m5.data.whiteSpace) ? (metrics.m5.data.whiteSpace as { metro: string }[]).slice(0, 5).map((w) => w.metro) : [];
  if (ws.length) lines.push(`**Footprint white space.** Metros where the target's audience over-indexes and the buyer's doesn't: ${ws.join(', ')}.`);
  lines.push('');
  lines.push(`**Red flags.** ${flags.length === 0 ? 'None raised by the code rules.' : flags.map((f) => `${f.flag} (${f.rule})`).join('; ')}`);
  if (bull.length) {
    lines.push('');
    lines.push('**Validated bull case**');
    for (const c of bull) lines.push(`- ${c.text}`);
  }
  if (bear.length) {
    lines.push('');
    lines.push('**Validated bear case**');
    for (const c of bear) lines.push(`- ${c.text}`);
  }
  if (t.diligenceQuestions.length) {
    lines.push('');
    lines.push('**Diligence questions**');
    for (const q of t.diligenceQuestions) lines.push(`- ${q}`);
  }
  lines.push('');
  lines.push('_Aggregate audience affinities from Qloo, not predictions about individuals. Not investment advice._');
  return lines.join('\n');
}

export function diligenceQuestions(bear: ClaimRecord[], flags: FlagHit[], target: string, buyer: string): string[] {
  const qs = bear.map((c) => `Test before committing: ${c.text.replace(/\.$/, '')}. What would a co-branded pilot between ${buyer} and ${target} show?`);
  for (const f of flags) {
    if (!bear.some((c) => c.flag === f.flag)) qs.push(`Resolve ${f.flag}: the rule "${f.rule}" fired. What would change it?`);
  }
  return qs.slice(0, 5);
}

/** Stage 8: one IC memo per ADVANCE/WATCH target; every number is checked against the ledger. */
export async function stageMemo(ctx: RunCtx): Promise<void> {
  const cfg = await scoringConfig(ctx.deps);
  const shortlist = ctx.state.shortlist ?? [];
  const buyerName = ctx.state.buyer!.name;
  const all = (await ctx.deps.store.targets.list(ctx.runId)).filter((t) => shortlist.includes(t.targetId));
  const ranked = [...all].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const chosen = ranked.filter((t) => t.verdict === 'ADVANCE' || t.verdict === 'WATCH');
  await ctx.emit('stage', `Writing ${chosen.length} IC memo(s); every number is checked against the ledger...`);
  const weights = cfg.weights[ctx.mandate.dealType];
  const extra = [
    cfg.bands.advanceMin, cfg.bands.watchMin, cfg.bands.minCoverage,
    ...Object.values(weights),
    ...Object.values(cfg.flags),
  ];
  const dates = [ctx.state.runDate, ctx.state.asOf];
  const maxCount = Math.max(12, (ctx.state.universe ?? []).length);

  for (const t of chosen) {
    const pack = (await ctx.deps.store.evidence.list(ctx.runId, t.targetId)) as EvidenceRow[];
    const claims = await ctx.deps.store.claims.list(ctx.runId, t.targetId);
    const bull = claims.filter((c) => c.accepted && c.side === 'bull');
    const bear = claims.filter((c) => c.accepted && c.side === 'bear');
    const flags = (t.flags ?? []) as FlagHit[];
    const metrics = t.metrics as unknown as Record<MetricKey, MetricResult>;
    const rank = ranked.indexOf(t) + 1;
    const input: MemoInput = {
      dealType: ctx.mandate.dealType,
      buyerName,
      title: ctx.mandate.title ?? `${buyerName} screen`,
      runDate: ctx.state.runDate,
      momentumAsOf: ctx.state.asOf,
      shortlistSize: ranked.length,
      target: {
        key: t.key ?? t.targetId,
        name: t.name,
        verdict: t.verdict ?? 'PASS',
        why: t.why ?? '',
        F: t.score,
        rank,
        evidence: pack.map(modelView),
        acceptedClaims: [...bull, ...bear].map((c) => ({ side: c.side, text: c.text, flag: (c.flag as never) ?? null })),
        diligenceQuestions: diligenceQuestions(bear, flags, t.name, buyerName),
      },
    };
    const allowed = allowedNumbers(pack, [...extra, rank, ranked.length, ...(t.score !== null ? [t.score] : [])]);
    const knownNames = [...pack.flatMap((r) => stringLeaves(r.data)), t.name, buyerName, ...ctx.state.buyer!.entities.map((e) => e.name)];

    let markdown: string;
    let source: MemoChecks['source'] = 'template';
    let repaired = false;
    let checks;
    if (ctx.deps.agents) {
      try {
        markdown = await ctx.deps.agents.writeMemo(input);
        source = 'llm';
        checks = runChecks(markdown, allowed, dates, maxCount, knownNames);
        if (!checks.ok) {
          // one repair attempt: tell the writer exactly what failed
          const fixed = await ctx.deps.agents.writeMemo({
            ...input,
            repair: { previous: markdown, unverifiedNumbers: checks.unverifiedNumbers, language: checks.language.map((l) => l.match) },
          });
          const fixedChecks = runChecks(fixed, allowed, dates, maxCount, knownNames);
          repaired = true;
          if (fixedChecks.unverifiedNumbers.length + fixedChecks.language.length <= checks.unverifiedNumbers.length + checks.language.length) {
            markdown = fixed;
            checks = fixedChecks;
          }
        }
      } catch (err) {
        await ctx.emit('warn', `Memo writer failed for ${t.name} (${(err as Error).message}); using the ledger template.`);
        markdown = templateMemo(input, metrics, flags, bull, bear);
        source = 'template';
        checks = runChecks(markdown, allowed, dates, maxCount, knownNames);
      }
    } else {
      markdown = templateMemo(input, metrics, flags, bull, bear);
      checks = runChecks(markdown, allowed, dates, maxCount, knownNames);
    }
    const full: MemoChecks = { ...checks, repaired, source };
    await ctx.deps.store.memos.upsert({
      id: `memo_${ctx.runId}_${t.key ?? t.targetId}`,
      runId: ctx.runId,
      targetId: t.targetId,
      markdown,
      checks: full as unknown as Record<string, unknown>,
      ok: full.ok,
      model: source === 'llm' ? ctx.deps.agents!.model : null,
    });
    await ctx.emit(
      full.ok ? 'progress' : 'warn',
      full.ok
        ? `Memo for ${t.name}: ${full.numbersChecked} numbers checked, all in the ledger.`
        : `Memo for ${t.name} is blocked: ${full.unverifiedNumbers.length} unverified number(s)${full.language.length ? `, ${full.language.length} wording issue(s)` : ''}.`,
      { targetId: t.targetId },
    );
  }

  // ranked summary (code-written)
  const lines = [
    `# ${ctx.mandate.title ?? `${buyerName}: ${DEAL_TYPE_LABELS[ctx.mandate.dealType]} screen`}`,
    '',
    `Buyer audience: ${ctx.state.buyer!.entities.map((e) => e.name).join(' + ')}. Run ${ctx.state.runDate}; momentum window to ${ctx.state.asOf}.`,
    '',
    '| # | Target | F | Verdict | Coverage |',
    '|---|---|---|---|---|',
    ...ranked.map((t, i) => `| ${i + 1} | ${t.name} | ${t.score === null ? 'n/a' : t.score.toFixed(1)} | ${t.verdict ?? 'n/a'} | ${t.coverage === null ? 'n/a' : `${Math.round(t.coverage * 100)}%`} |`),
  ];
  const summary = lines.join('\n');
  const summaryAllowed = [
    ...extra,
    ...ranked.flatMap((t) => [t.score ?? 0, t.coverage ?? 0]),
  ];
  const summaryNames = [...ranked.map((t) => t.name), ...ctx.state.buyer!.entities.map((e) => e.name), ctx.mandate.title ?? ''];
  const summaryChecks = runChecks(summary, summaryAllowed, dates, Math.max(maxCount, ranked.length), summaryNames);
  await ctx.deps.store.memos.upsert({
    id: `memo_${ctx.runId}_summary`,
    runId: ctx.runId,
    targetId: null,
    markdown: summary,
    checks: { ...summaryChecks, repaired: false, source: 'template' },
    ok: summaryChecks.ok,
    model: null,
  });
}
