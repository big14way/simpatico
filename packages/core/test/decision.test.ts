import { describe, expect, it } from 'vitest';
import { DEFAULT_BANDS, DEFAULT_FLAG_THRESHOLDS, DEFAULT_WEIGHTS, defaultMomentumAsOf } from '../src/config';
import { composite } from '../src/score';
import { redFlags } from '../src/flags';
import { decideVerdict } from '../src/verdict';
import { judgeClaims } from '../src/judge';
import { buildEvidenceRows, modelView } from '../src/evidence';
import { checkNumbers, languageGuard } from '../src/numbercheck';
import type { Claim, MetricKey, MetricResult } from '../src/types';

function metrics(values: Partial<Record<MetricKey, number | null>>, data: Partial<Record<MetricKey, Record<string, unknown>>> = {}): Record<MetricKey, MetricResult> {
  const keys: MetricKey[] = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  return Object.fromEntries(
    keys.map((k) => {
      const v = values[k] ?? null;
      return [k, { key: k, value: v, coverage: v === null ? 0 : 1, note: null, data: { value: v, ...(data[k] ?? {}) }, sources: [] }];
    }),
  ) as unknown as Record<MetricKey, MetricResult>;
}

describe('composite', () => {
  it('is a weighted mean over covered metrics only', () => {
    const m = metrics({ m1: 0.8, m2: 0.4, m3: 0.6, m4: 0.5, m5: 0.7, m6: null });
    const c = composite(m, DEFAULT_WEIGHTS.ma_bolt_on, 0.6);
    // weights .30 .20 .15 .15 .10 (m6 .10 dropped) -> den .90
    const num = 0.3 * 0.8 + 0.2 * 0.4 + 0.15 * 0.6 + 0.15 * 0.5 + 0.1 * 0.7;
    expect(c.coverage).toBeCloseTo(0.9);
    expect(c.F).toBeCloseTo((100 * num) / 0.9);
    expect(c.contributions.reduce((a, x) => a + x.points, 0)).toBeCloseTo(c.F!);
  });
  it('gives no score below the coverage floor', () => {
    const c = composite(metrics({ m1: 0.9, m2: 0.9 }), DEFAULT_WEIGHTS.ma_bolt_on, 0.6);
    expect(c.coverage).toBeCloseTo(0.5);
    expect(c.F).toBeNull();
  });
  it('treats exactly 0.6 coverage as enough despite float error', () => {
    const c = composite(metrics({ m1: 0.5, m2: 0.5, m6: 0.5 }), DEFAULT_WEIGHTS.ma_bolt_on, 0.6);
    expect(c.F).not.toBeNull();
  });
  it('half coverage halves the weight', () => {
    const m = metrics({ m1: 1, m2: 0 , m3: 0, m4: 0, m5: 0, m6: 0 });
    m.m1.coverage = 0.5;
    const c = composite(m, DEFAULT_WEIGHTS.ma_bolt_on, 0.6);
    expect(c.coverage).toBeCloseTo(0.85);
    expect(c.F).toBeCloseTo((100 * 0.15) / 0.85);
  });
});

describe('red flags', () => {
  const t = DEFAULT_FLAG_THRESHOLDS;
  it('raises each flag from its rule', () => {
    const m = metrics(
      { m1: 0.3, m2: 0.1, m4: 0.2, m5: 0.1, m6: 0.1 },
      { m1: { a: 0.8, b: 0.2, ratio: 0.25 }, m2: { buyerTop20MissingShare: 0.7 }, m6: { z: -2.4 } },
    );
    expect(redFlags(m, 'licensing', t).map((f) => f.flag)).toEqual(['AUDIENCE_ONE_SIDED', 'TASTE_CLASH', 'DEMOGRAPHIC_MISMATCH', 'FADING', 'NO_GEO_OVERLAP']);
    expect(redFlags(m, 'ma_bolt_on', t).map((f) => f.flag)).not.toContain('NO_GEO_OVERLAP');
  });
  it('raises nothing for uncovered metrics', () => {
    expect(redFlags(metrics({}), 'licensing', t)).toEqual([]);
  });
  it('TASTE_CLASH needs both conditions', () => {
    const m = metrics({ m2: 0.3 }, { m2: { buyerTop20MissingShare: 0.9 } });
    expect(redFlags(m, 'ma_bolt_on', t)).toEqual([]);
  });
});

describe('verdict', () => {
  // explicit bands so these rules don't move when the defaults are recalibrated
  const b = { ...DEFAULT_BANDS, advanceMin: 70, watchMin: 55 };
  const flag = (f: 'FADING' | 'TASTE_CLASH') => ({ flag: f, rule: '', observed: {} });
  it('ADVANCE / WATCH / PASS bands without flags', () => {
    expect(decideVerdict({ F: 72, coverage: 1, flags: [], mitigated: [] }, b).verdict).toBe('ADVANCE');
    expect(decideVerdict({ F: 60, coverage: 1, flags: [], mitigated: [] }, b).verdict).toBe('WATCH');
    expect(decideVerdict({ F: 40, coverage: 1, flags: [], mitigated: [] }, b).verdict).toBe('PASS');
  });
  it('any flag blocks ADVANCE; one mitigated mitigable flag allows WATCH', () => {
    expect(decideVerdict({ F: 80, coverage: 1, flags: [flag('FADING')], mitigated: [] }, b).verdict).toBe('PASS');
    expect(decideVerdict({ F: 80, coverage: 1, flags: [flag('FADING')], mitigated: ['FADING'] }, b).verdict).toBe('WATCH');
    expect(decideVerdict({ F: 80, coverage: 1, flags: [flag('TASTE_CLASH')], mitigated: ['TASTE_CLASH'] }, b).verdict).toBe('PASS');
    expect(decideVerdict({ F: 50, coverage: 1, flags: [flag('FADING')], mitigated: ['FADING'] }, b).verdict).toBe('PASS');
  });
  it('insufficient coverage has no score', () => {
    const v = decideVerdict({ F: null, coverage: 0.4, flags: [], mitigated: [] }, b);
    expect(v.verdict).toBe('INSUFFICIENT_COVERAGE');
    expect(v.why).toMatch(/can't see this brand/);
  });
});

describe('evidence rows and the judge', () => {
  const tA = metrics({ m1: 0.7, m2: 0.3, m3: 0.8, m4: 0.6, m5: 0.5, m6: 0.2 }, { m1: { a: 0.75, b: 0.66, ratio: 0.88 }, m6: { z: -1.8 } });
  const tB = metrics({ m1: 0.5, m2: 0.1, m3: 0.7, m4: 0.4, m5: 0.6, m6: 0.6 }, { m1: { a: 0.6, b: 0.42, ratio: 0.7 }, m6: { z: 0.6 } });
  const rows = buildEvidenceRows([
    { targetKey: 't1', targetId: 'A', targetName: 'Brand A', metrics: tA, composite: composite(tA, DEFAULT_WEIGHTS.ma_bolt_on, 0.6), flags: [{ flag: 'FADING', rule: 'z < -1.5', observed: { z: -1.8 } }], profile: { foundedYear: 2017 } },
    { targetKey: 't2', targetId: 'B', targetName: 'Brand B', metrics: tB, composite: composite(tB, DEFAULT_WEIGHTS.ma_bolt_on, 0.6), flags: [] },
  ]);
  const packA = rows.get('A')!;

  it('builds short ids, polarity and shortlist means', () => {
    expect(packA.map((r) => r.id)).toEqual(['t1-m1', 't1-m2', 't1-m3', 't1-m4', 't1-m5', 't1-m6', 't1-score', 't1-flags', 't1-profile']);
    const m1 = packA[0]!;
    expect(m1.polarity.value).toBe(1);
    expect(m1.ref.value).toBeCloseTo(0.6);
    expect(m1.ref.a).toBeCloseTo(0.675);
    expect(modelView(packA[5]!).data).not.toHaveProperty('weeks');
  });

  const cite = (evidenceId: string, path: string, value: number) => ({ evidenceId, path, value });
  const bull = (text: string, cites: Claim['cites'], flag?: Claim['flag']): Claim => ({ text, direction: '+', cites, flag: flag ?? null });
  const bear = (text: string, cites: Claim['cites'], flag?: Claim['flag']): Claim => ({ text, direction: '-', cites, flag: flag ?? null });

  it('accepts claims whose cited values match the ledger', () => {
    const out = judgeClaims({ side: 'bull', claims: [bull('Strong two-way affinity', [cite('t1-m1', 'value', 0.7)])], pack: packA, computedFlags: ['FADING'] });
    expect(out.accepted).toHaveLength(1);
    expect(out.rejected).toHaveLength(0);
  });

  it('rejects wrong values, unknown evidence, bad paths and other targets\' rows', () => {
    const out = judgeClaims({
      side: 'bear',
      claims: [
        bear('made-up number', [cite('t1-m2', 'value', 0.05)]),
        bear('unknown row', [cite('t9-m1', 'value', 0.5)]),
        bear('bad path', [cite('t1-m2', 'nope', 0.3)]),
        bear('other target', [cite('t2-m2', 'value', 0.1)]),
      ],
      pack: packA,
      computedFlags: [],
    });
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected.map((r) => r.reason)).toEqual([
      'cited 0.05 for m2 Taste-profile overlap "value", but the ledger says 0.3',
      'cited evidence "t9-m1" is not in this target\'s ledger',
      '"nope" does not resolve to a number in t1-m2',
      'cited evidence "t2-m2" is not in this target\'s ledger',
    ]);
  });

  it('lets a bear call incomplete coverage a weakness even when it beats the shortlist average', () => {
    const tC = metrics({ m1: 0.7, m2: 0.3, m3: 0.8, m4: 0.6, m5: 0.5, m6: null });
    const tD = metrics({ m1: 0.6, m2: 0.3, m3: 0.7, m4: 0.6, m5: null, m6: null });
    const r = buildEvidenceRows([
      { targetKey: 't1', targetId: 'C', targetName: 'Brand C', metrics: tC, composite: composite(tC, DEFAULT_WEIGHTS.ma_bolt_on, 0.6), flags: [] },
      { targetKey: 't2', targetId: 'D', targetName: 'Brand D', metrics: tD, composite: composite(tD, DEFAULT_WEIGHTS.ma_bolt_on, 0.6), flags: [] },
    ]);
    const packC = r.get('C')!;
    const score = packC.find((x) => x.id === 't1-score')!;
    expect(score.polarity).not.toHaveProperty('coverage');
    const out = judgeClaims({ side: 'bear', claims: [bear('Momentum is unmeasured, so coverage is incomplete', [cite('t1-score', 'coverage', 0.9)])], pack: packC, computedFlags: [] });
    expect(out.accepted).toHaveLength(1);
  });

  it('enforces direction and polarity', () => {
    const wrongSide = judgeClaims({ side: 'bull', claims: [bear('x', [cite('t1-m1', 'value', 0.7)])], pack: packA, computedFlags: [] });
    expect(wrongSide.rejected[0]!.reason).toMatch(/must have direction "\+"/);
    // m6 value 0.2 is below the shortlist mean 0.4: can't be a bull strength
    const misuse = judgeClaims({ side: 'bull', claims: [bull('great momentum', [cite('t1-m6', 'value', 0.2)])], pack: packA, computedFlags: [] });
    expect(misuse.rejected[0]!.reason).toMatch(/below the shortlist average/);
    // m3 0.8 is above the mean 0.75: can't be a bear weakness
    const misuse2 = judgeClaims({ side: 'bear', claims: [bear('weak culture', [cite('t1-m3', 'value', 0.8)])], pack: packA, computedFlags: [] });
    expect(misuse2.rejected[0]!.reason).toMatch(/above the shortlist average/);
  });

  it('bear cannot invent a flag; bull can only mitigate FADING / NO_GEO_OVERLAP that were raised', () => {
    const invented = judgeClaims({ side: 'bear', claims: [bear('clash', [cite('t1-m2', 'value', 0.3)], 'TASTE_CLASH')], pack: packA, computedFlags: ['FADING'] });
    expect(invented.rejected[0]!.reason).toBe('bear cannot invent a flag: the code rules did not raise TASTE_CLASH');
    const real = judgeClaims({ side: 'bear', claims: [bear('fading', [cite('t1-m6', 'z', -1.8)], 'FADING')], pack: packA, computedFlags: ['FADING'] });
    expect(real.accepted).toHaveLength(1);
    const mitigation = judgeClaims({ side: 'bull', claims: [bull('affinity offsets the dip', [cite('t1-m1', 'value', 0.7)], 'FADING')], pack: packA, computedFlags: ['FADING'] });
    expect(mitigation.mitigates).toEqual(['FADING']);
    const cannot = judgeClaims({ side: 'bull', claims: [bull('x', [cite('t1-m1', 'value', 0.7)], 'TASTE_CLASH')], pack: packA, computedFlags: ['TASTE_CLASH'] });
    expect(cannot.rejected[0]!.reason).toMatch(/cannot be mitigated/);
  });

  it('caps claims per side and drops duplicates', () => {
    const c = bull('a', [cite('t1-m1', 'value', 0.7)]);
    const many = Array.from({ length: 6 }, (_, i) => ({ ...c, text: `claim ${i}` }));
    const out = judgeClaims({ side: 'bull', claims: [...many.slice(0, 2), { ...c, text: 'claim 0' }, ...many.slice(2)], pack: packA, computedFlags: [] });
    expect(out.accepted).toHaveLength(4);
    expect(out.rejected.map((r) => r.reason)).toEqual(['duplicate of an earlier claim', 'over the 5-claim limit', 'over the 5-claim limit']);
  });
});

describe('number checker and language guard', () => {
  it('verifies numbers against the ledger with formatting tolerance', () => {
    const r = checkNumbers({
      text: 'Brand A scores F 72.4 with two-way affinity 0.70 (70%) and z of -1.8; m1 leads. Ranked #2 of 8. Founded 2017. Claims 93% overlap.',
      allowed: [72.43, 0.7012, -1.8, 2017],
      maxCount: 8,
    });
    expect(r.unverified.map((n) => n.raw)).toEqual(['93%']);
    expect(r.ok).toBe(false);
  });
  it('checks ISO dates separately', () => {
    const r = checkNumbers({ text: 'As of 2026-10-23, window to 2024-10-28.', allowed: [], allowedDates: ['2026-10-23'] });
    expect(r.unverified.map((n) => n.raw)).toEqual(['2024-10-28']);
  });
  it('handles thousands separators', () => {
    expect(checkNumbers({ text: 'rank 18,446', allowed: [18446] }).ok).toBe(true);
  });
  it('flags causal and individual-level language but not "because"', () => {
    const v = languageGuard('Customers will love it because it causes joy; we guarantee the probability that a person buys.');
    expect(v.map((x) => x.phrase)).toEqual(['customers will', 'causes', 'guarantee', 'probability that a person']);
    expect(languageGuard('The audience over-indexes on indie rock because of shared taste.')).toEqual([]);
  });
});

describe('number checker and names with digits', () => {
  it('ignores digits inside known names', () => {
    const r = checkNumbers({ text: 'Both audiences love Maroon 5 and 7UP; affinity 0.62.', allowed: [0.62], knownNames: ['Maroon 5', '7UP'] });
    expect(r.ok).toBe(true);
    const r2 = checkNumbers({ text: 'Both audiences love Maroon 5; affinity 0.62.', allowed: [0.62] });
    expect(r2.unverified.map((n) => n.raw)).toEqual(['5']);
  });
});

describe('number checker never masks bare numbers', () => {
  it('still checks other numbers, and treats a numeric brand name as a known value', () => {
    const r = checkNumbers({ text: 'Brand 47 scores F 52.1.', allowed: [], knownNames: ['47'] });
    expect(r.unverified.map((n) => n.raw)).toEqual(['52.1']);
    expect(checkNumbers({ text: 'Brand 47 scores F 52.1.', allowed: [], knownNames: [] }).unverified.map((n) => n.raw)).toEqual(['47', '52.1']);
  });
});

describe('momentum window', () => {
  it('defaults to the last date Qloo\'s trending series moves, or the run date if earlier', () => {
    expect(defaultMomentumAsOf('2026-10-26')).toBe('2025-10-01');
    expect(defaultMomentumAsOf('2025-06-30')).toBe('2025-06-30');
  });
});
