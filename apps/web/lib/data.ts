import type { FlagHit, MetricKey, MetricResult } from '@simpatico/core';
import type { Mandate, RunState, RunSummary } from '@simpatico/engine';
import type { QlooEvidence } from '@simpatico/qloo';
import type { ClaimRecord, MemoRecord, OutreachRecord, RunRecord, StoredEvidenceRow, TargetRecord } from '@simpatico/store';
import { getStore } from './runtime';

export type Run = RunRecord<Mandate, RunState, RunSummary>;

export interface RunView {
  run: Run;
  targets: TargetRecord[];
  shortlist: TargetRecord[];
  memos: MemoRecord[];
  drafts: OutreachRecord[];
}

export async function loadRun(id: string): Promise<RunView | null> {
  const store = await getStore();
  const [run, targets, memos, drafts] = await Promise.all([
    store.runs.get<Mandate, RunState, RunSummary>(id),
    store.targets.list(id),
    store.memos.list(id),
    store.outreach.listForRun(id),
  ]);
  if (!run) return null;
  const ids = new Set(run.state.shortlist ?? []);
  const shortlist = targets.filter((t) => ids.has(t.targetId));
  return { run, targets, shortlist, memos, drafts };
}

export interface DealRoom {
  run: Run;
  target: TargetRecord;
  metrics: Record<MetricKey, MetricResult> | null;
  flags: FlagHit[];
  rows: StoredEvidenceRow[];
  claims: ClaimRecord[];
  memo: MemoRecord | null;
  qloo: QlooEvidence[];
  rank: number;
  shortlistSize: number;
}

export async function loadDealRoom(runId: string, targetId: string): Promise<DealRoom | null> {
  const store = await getStore();
  const [run, target, rows, claims, memos, all, targets] = await Promise.all([
    store.runs.get<Mandate, RunState, RunSummary>(runId),
    store.targets.get(runId, targetId),
    store.evidence.list(runId, targetId),
    store.claims.list(runId, targetId),
    store.memos.list(runId),
    store.qlooEvidence.listByRun(runId),
    store.targets.list(runId),
  ]);
  if (!run || !target) return null;
  const sourceIds = new Set(rows.flatMap((r) => r.sources));
  const qloo = all.filter((e) => sourceIds.has(e.id) || e.subjects.includes(targetId));
  const shortlist = targets.filter((t) => (run.state.shortlist ?? []).includes(t.targetId));
  const ranked = [...shortlist].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return {
    run,
    target,
    metrics: (target.metrics as unknown as Record<MetricKey, MetricResult>) ?? null,
    flags: (target.flags ?? []) as FlagHit[],
    rows,
    claims,
    memo: memos.find((m) => m.targetId === targetId) ?? null,
    qloo,
    rank: ranked.findIndex((t) => t.targetId === targetId) + 1,
    shortlistSize: ranked.length,
  };
}
