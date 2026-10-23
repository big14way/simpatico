import {
  MOMENTUM_WEEKS,
  composite,
  computeMomentum,
  decideVerdict,
  harmonic,
  momentumMetric,
  redFlags,
  trendingWindow,
  type FlagHit,
  type MetricKey,
  type MetricResult,
  type RedFlag,
} from '@simpatico/core';
import { QlooRequiredError, newId, type InsightEntity } from '@simpatico/qloo';
import type { AlertRecord, PipelineRecord } from '@simpatico/store';
import { qlooForRun, scoringConfig, today, type EngineDeps } from './context';
import type { Mandate } from './mandate';
import type { RunState } from './state';

export const RANK_MOVE_ALERT = 2;
export const MOMENTUM_ALERT_Z = 1.5;

export interface DealSnapshot {
  F: number | null;
  verdict: string;
  shortlistRank: number | null;
  forwardAffinity: number | null;
  momentumZ: number | null;
  asOf: string;
}

export interface DealOutcome {
  dealId: string;
  targetName: string;
  before: DealSnapshot | null;
  after: DealSnapshot;
  alerts: { kind: 'rank_move' | 'momentum' | 'verdict_change'; message: string }[];
}

export interface MonitorResult {
  id: string;
  asOf: string;
  trigger: string;
  deals: DealOutcome[];
  alerts: number;
  notes: string[];
}

export interface MonitorOptions {
  trigger: 'manual' | 'cron' | 'replay';
  asOf?: string;
  /** replay: compute and report, but leave the pipeline untouched */
  dryRun?: boolean;
  /** replay: compare against these snapshots instead of the stored ones */
  baseline?: Map<string, DealSnapshot>;
  /** replay baseline step: record nothing, alert on nothing */
  silent?: boolean;
}

function snapshotOf(deal: PipelineRecord): DealSnapshot | null {
  const s = deal.lastSnapshot;
  if (!s) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    F: n(s.F),
    verdict: typeof s.verdict === 'string' ? s.verdict : deal.verdict,
    shortlistRank: n(s.shortlistRank),
    forwardAffinity: n(s.forwardAffinity),
    momentumZ: n(s.momentumZ),
    asOf: typeof s.asOf === 'string' ? s.asOf : '',
  };
}

const fmtZ = (z: number | null) => (z === null ? 'n/a' : z.toFixed(2));

/**
 * Re-score every monitored deal: one rank call per buyer (fresh forward affinity) and a
 * trending refresh for the momentum cohort. Other metrics are kept from the deal's run.
 */
export async function runMonitor(deps: EngineDeps, opts: MonitorOptions): Promise<MonitorResult> {
  const asOf = opts.asOf ?? today(deps);
  const historical = asOf < today(deps);
  const id = newId('mon');
  if (!deps.transport && deps.mode !== 'replay') throw new QlooRequiredError();
  if (!opts.silent) await deps.store.monitor.start(id, opts.trigger, asOf);
  const cfg = await scoringConfig(deps);
  const notes: string[] = [];
  if (historical) notes.push(`Momentum uses Qloo trending history to ${asOf}; affinity uses today's taste graph.`);
  const outcomes: DealOutcome[] = [];

  try {
    const deals = (await deps.store.pipeline.list()).filter((d) => d.monitored);
    const byRun = new Map<string, PipelineRecord[]>();
    for (const d of deals) byRun.set(d.lastRunId, [...(byRun.get(d.lastRunId) ?? []), d]);

    for (const [runId, group] of byRun) {
      const run = await deps.store.runs.get<Mandate, RunState>(runId);
      if (!run?.state.buyer || !run.state.shortlist) continue;
      const buyer = run.state.buyer;
      const shortlist = run.state.shortlist;
      const q = qlooForRun(deps, null);
      const fresh = !historical && opts.trigger !== 'replay';

      const rank = await q.rank(
        { filterType: 'urn:entity:brand', signalEntities: buyer.signalIds, candidates: shortlist, take: shortlist.length },
        { runId: null, purpose: `monitor: re-rank (${opts.trigger})`, subjects: shortlist, bypassCache: fresh },
      );
      if (rank.status === 'error') throw new Error(`Qloo re-rank failed: ${rank.error?.message}`);
      const aNow = new Map(rank.results.map((e: InsightEntity) => [e.id, e.affinity]));
      const order = [...shortlist].filter((t) => aNow.has(t)).sort((x, y) => aNow.get(y)! - aNow.get(x)!);

      const window = trendingWindow(asOf, MOMENTUM_WEEKS);
      const cohort = [...new Set([...buyer.brandIds, ...shortlist])];
      const series = await Promise.all(
        cohort.map(async (eid) => {
          const env = await q.trending(
            { filterType: 'urn:entity:brand', entity: eid, startDate: window.startDate, endDate: window.endDate, take: 50 },
            { runId: null, purpose: `monitor: trending (${opts.trigger})`, subjects: [eid], bypassCache: fresh },
          );
          return { entityId: eid, points: env.status === 'error' ? [] : env.results, evidenceId: env.evidenceId };
        }),
      );
      const momentum = computeMomentum(series, asOf, MOMENTUM_WEEKS);
      const targets = await deps.store.targets.list(runId);
      const claims = await deps.store.claims.list(runId);

      for (const deal of group) {
        const t = targets.find((x) => x.targetId === deal.targetId);
        if (!t?.metrics) continue;
        const metrics = structuredClone(t.metrics) as unknown as Record<MetricKey, MetricResult>;
        const a = aNow.get(deal.targetId) ?? null;
        const b = typeof metrics.m1.data.b === 'number' ? metrics.m1.data.b : null;
        if (a !== null && b !== null) {
          const v = harmonic(a, b);
          metrics.m1 = { ...metrics.m1, value: v, data: { ...metrics.m1.data, a, value: v, ratio: Math.min(a, b) / Math.max(a, b) } };
        }
        metrics.m6 = momentumMetric(momentum.get(deal.targetId), series.map((s) => s.evidenceId));
        const comp = composite(metrics, cfg.weights[run.mandate.dealType], cfg.bands.minCoverage);
        const flags: FlagHit[] = comp.F === null ? [] : redFlags(metrics, run.mandate.dealType, cfg.flags);
        const mitigated = claims.filter((c) => c.targetId === deal.targetId && c.side === 'bull' && c.accepted && c.flag).map((c) => c.flag as RedFlag);
        const verdict = decideVerdict({ F: comp.F, coverage: comp.coverage, flags, mitigated }, cfg.bands);
        const after: DealSnapshot = {
          F: comp.F,
          verdict: verdict.verdict,
          shortlistRank: order.indexOf(deal.targetId) >= 0 ? order.indexOf(deal.targetId) + 1 : null,
          forwardAffinity: a,
          momentumZ: (metrics.m6.data.z as number | null | undefined) ?? null,
          asOf,
        };
        const before = opts.baseline?.get(deal.id) ?? snapshotOf(deal);
        const alerts: DealOutcome['alerts'] = [];
        if (before) {
          if (before.shortlistRank !== null && after.shortlistRank !== null && Math.abs(after.shortlistRank - before.shortlistRank) >= RANK_MOVE_ALERT) {
            alerts.push({ kind: 'rank_move', message: `${deal.targetName} moved from #${before.shortlistRank} to #${after.shortlistRank} on buyer-audience affinity.` });
          }
          const z0 = before.momentumZ;
          const z1 = after.momentumZ;
          if (z1 !== null && z1 <= -MOMENTUM_ALERT_Z && !(z0 !== null && z0 <= -MOMENTUM_ALERT_Z)) {
            alerts.push({ kind: 'momentum', message: `${deal.targetName} momentum fell below -${MOMENTUM_ALERT_Z} (z ${fmtZ(z0)} -> ${fmtZ(z1)}).` });
          }
          if (z1 !== null && z1 >= MOMENTUM_ALERT_Z && !(z0 !== null && z0 >= MOMENTUM_ALERT_Z)) {
            alerts.push({ kind: 'momentum', message: `${deal.targetName} momentum rose above +${MOMENTUM_ALERT_Z} (z ${fmtZ(z0)} -> ${fmtZ(z1)}).` });
          }
          if (before.verdict !== after.verdict) {
            alerts.push({ kind: 'verdict_change', message: `${deal.targetName}: ${before.verdict} -> ${after.verdict} (${verdict.why})` });
          }
        }
        outcomes.push({ dealId: deal.id, targetName: deal.targetName, before, after, alerts: opts.silent ? [] : alerts });
        if (!opts.dryRun) {
          await deps.store.pipeline.update(deal.id, { verdict: after.verdict, score: after.F, lastSnapshot: { ...after, runId, at: new Date().toISOString() } });
        }
        if (!opts.silent) {
          for (const al of alerts) {
            const alertId = newId('al');
            const text = opts.trigger === 'replay' ? `[replay as of ${asOf}] ${al.message}` : al.message;
            await deps.store.monitor.addAlert({ id: alertId, monitorRunId: id, pipelineId: deal.id, targetName: deal.targetName, kind: al.kind, message: text, data: { before, after } });
            const delivery = deps.notifier ? await deps.notifier.alert(`Simpatico: ${text}`) : { slack: 'not configured' };
            await deps.store.monitor.setDelivery(alertId, delivery);
          }
        }
      }
    }
    const result: MonitorResult = { id, asOf, trigger: opts.trigger, deals: outcomes, alerts: outcomes.reduce((n, o) => n + o.alerts.length, 0), notes };
    if (!opts.silent) {
      await deps.store.monitor.finish(id, 'done', { asOf, deals: outcomes.length, alerts: result.alerts, notes, dryRun: !!opts.dryRun });
    }
    return result;
  } catch (err) {
    if (!opts.silent) await deps.store.monitor.finish(id, 'failed', null, (err as Error).message);
    throw err;
  }
}

/**
 * Historical replay: walk the as-of date forward week by week and report what the monitor
 * would have flagged, using Qloo's trending history. Dry run: the pipeline is not changed.
 */
export async function replayMonitor(deps: EngineDeps, opts: { from: string; to: string; stepDays?: number; maxSteps?: number }): Promise<MonitorResult[]> {
  const step = (opts.stepDays ?? 7) * 86_400_000;
  const start = Date.parse(`${opts.from}T00:00:00Z`);
  const end = Date.parse(`${opts.to}T00:00:00Z`);
  if (!(start < end)) throw new Error('replay: "from" must be before "to"');
  const dates: string[] = [];
  for (let t = start; t <= end && dates.length < (opts.maxSteps ?? 12) + 1; t += step) dates.push(new Date(t).toISOString().slice(0, 10));
  const results: MonitorResult[] = [];
  // first date is the baseline: computed, not reported
  let baseline: Map<string, DealSnapshot> | undefined;
  for (const [i, asOf] of dates.entries()) {
    const r = await runMonitor(deps, { trigger: 'replay', asOf, dryRun: true, baseline, silent: i === 0 });
    baseline = new Map(r.deals.map((d) => [d.dealId, d.after]));
    if (i > 0) results.push(r);
  }
  return results;
}

export type { AlertRecord };
