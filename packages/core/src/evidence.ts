// Turns computed metrics into the evidence rows bull, bear and the judge all work from.
// Row ids are short and stable within a run ("t3-m1") so models can cite them reliably.

import { numericLeaves } from './paths';
import { standing, wildcardPath } from './judge';
import type { Composite } from './score';
import type { EvidenceRow, FlagHit, MetricKey, MetricResult } from './types';
import { METRIC_KEYS, METRIC_LABELS } from './types';
import { mean } from './stats';

/** Direction of "better" for each numeric path a claim may cite. Unlisted paths are descriptive (0). */
export const POLARITY: Record<MetricKey | 'score', Record<string, 1 | -1 | 0>> = {
  m1: { value: 1, a: 1, b: 1, ratio: 1 },
  m2: { value: 1, sharedCount: 1, buyerTop20MissingShare: -1 },
  m3: { value: 1, 'domains[].score': 1 },
  m4: { value: 1, cosine: 1 },
  m5: { value: 1, correlation: 1 },
  m6: { value: 1, z: 1 },
  // coverage is descriptive: below 1 it is a fair weakness on its own, whatever the shortlist average
  score: { F: 1 },
};

/** Bulky arrays the models don't need to read (the judge still resolves against full data). */
const HIDDEN_FROM_MODELS: Record<string, string[]> = {
  m5: ['perMetro'],
  m6: ['weeks'],
  m4: [],
};

export interface TargetEvidenceInput {
  /** short per-run key, e.g. "t3" */
  targetKey: string;
  targetId: string;
  targetName: string;
  metrics: Record<MetricKey, MetricResult>;
  composite: Composite;
  flags: FlagHit[];
  profile?: Record<string, unknown> | null;
  profileSources?: string[];
}

export function rowId(targetKey: string, part: MetricKey | 'score' | 'flags' | 'profile'): string {
  return `${targetKey}-${part}`;
}

function polarityFor(group: MetricKey | 'score', path: string): 1 | -1 | 0 {
  const table = POLARITY[group];
  return table[path] ?? table[wildcardPath(path)] ?? 0;
}

export function buildEvidenceRows(targets: readonly TargetEvidenceInput[]): Map<string, EvidenceRow[]> {
  // shortlist means for every polarised path, per metric group
  const refValues = new Map<string, number[]>();
  const refKey = (group: string, path: string) => `${group}|${path}`;
  const collect = (group: MetricKey | 'score', data: Record<string, unknown>) => {
    for (const [path, v] of numericLeaves(data)) {
      if (polarityFor(group, path) === 0) continue;
      const k = refKey(group, path);
      const arr = refValues.get(k) ?? [];
      arr.push(v);
      refValues.set(k, arr);
    }
  };
  const scoreData = (t: TargetEvidenceInput) => ({
    F: t.composite.F,
    coverage: t.composite.coverage,
    points: Object.fromEntries(t.composite.contributions.map((c) => [c.key, c.points])),
  });
  for (const t of targets) {
    for (const k of METRIC_KEYS) if (t.metrics[k].coverage > 0) collect(k, t.metrics[k].data);
    collect('score', scoreData(t));
  }

  const rowFor = (t: TargetEvidenceInput, group: MetricKey | 'score', data: Record<string, unknown>, base: Omit<EvidenceRow, 'polarity' | 'ref' | 'data'>): EvidenceRow => {
    const polarity: Record<string, 1 | -1 | 0> = {};
    const ref: Record<string, number> = {};
    for (const [path] of numericLeaves(data)) {
      const p = polarityFor(group, path);
      if (p === 0) continue;
      polarity[path] = p;
      const vals = refValues.get(refKey(group, path));
      if (vals && vals.length > 0) ref[path] = mean(vals);
    }
    return { ...base, data, polarity, ref };
  };

  const out = new Map<string, EvidenceRow[]>();
  for (const t of targets) {
    const rows: EvidenceRow[] = [];
    for (const k of METRIC_KEYS) {
      const m = t.metrics[k];
      rows.push(
        rowFor(t, k, { ...m.data, value: m.value, coverage: m.coverage, ...(m.note ? { note: m.note } : {}) }, {
          id: rowId(t.targetKey, k),
          targetId: t.targetId,
          kind: 'metric',
          metric: k,
          label: `${k} ${METRIC_LABELS[k]}`,
          sources: m.sources,
        }),
      );
    }
    rows.push(
      rowFor(t, 'score', scoreData(t), {
        id: rowId(t.targetKey, 'score'),
        targetId: t.targetId,
        kind: 'score',
        metric: null,
        label: 'Composite score',
        sources: [],
      }),
    );
    rows.push({
      id: rowId(t.targetKey, 'flags'),
      targetId: t.targetId,
      kind: 'flags',
      metric: null,
      label: 'Red flags (code rules)',
      data: { flags: t.flags.map((f) => ({ flag: f.flag, rule: f.rule, ...f.observed })) },
      polarity: {},
      ref: {},
      sources: [],
    });
    if (t.profile) {
      rows.push({
        id: rowId(t.targetKey, 'profile'),
        targetId: t.targetId,
        kind: 'profile',
        metric: null,
        label: `Qloo entity profile: ${t.targetName}`,
        data: t.profile,
        polarity: {},
        ref: {},
        sources: t.profileSources ?? [],
      });
    }
    out.set(t.targetId, rows);
  }
  return out;
}

export type Reading = 'strength' | 'weakness' | 'average';

/**
 * The view of a row the models get: same id/data, minus bulky arrays, plus the code's reading
 * of each compared path (the same comparison the judge makes), so no model has to do it.
 */
export function modelView(row: EvidenceRow): {
  id: string;
  label: string;
  data: Record<string, unknown>;
  shortlistAverages?: Record<string, number>;
  reading?: Record<string, Reading>;
} {
  const hidden = row.metric ? HIDDEN_FROM_MODELS[row.metric] ?? [] : [];
  const data = Object.fromEntries(Object.entries(row.data).filter(([k]) => !hidden.includes(k)));
  if (Object.keys(row.ref).length === 0) return { id: row.id, label: row.label, data };
  const reading: Record<string, Reading> = {};
  for (const path of Object.keys(row.ref)) {
    if (hidden.includes(path.split(/[.[]/)[0]!)) continue;
    const s = standing(row, path);
    if (s !== null) reading[path] = s === 1 ? 'strength' : s === -1 ? 'weakness' : 'average';
  }
  return Object.keys(reading).length > 0
    ? { id: row.id, label: row.label, data, shortlistAverages: row.ref, reading }
    : { id: row.id, label: row.label, data, shortlistAverages: row.ref };
}
