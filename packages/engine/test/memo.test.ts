import { describe, expect, it } from 'vitest';
import type { EvidenceRow } from '@simpatico/core';
import { allowedNumbers, runChecks } from '../src/memo';

const row: EvidenceRow = {
  id: 't2-m2',
  targetId: 'T',
  kind: 'metric',
  metric: 'm2',
  label: 'Taste overlap',
  data: { value: 0.19, buyerTop20MissingShare: 0.6 },
  polarity: { value: 1, buyerTop20MissingShare: -1 },
  ref: { value: 0.2611, buyerTop20MissingShare: 0.475 },
  sources: [],
};

describe('memo number check', () => {
  it('allows the shortlist averages the writer is shown, not only the row data', () => {
    const allowed = allowedNumbers([row], [67]);
    expect(allowed).toEqual(expect.arrayContaining([0.19, 0.6, 0.2611, 0.475, 67]));
    const memo = 'Overlap is thin at 0.19 versus 0.26; 60% of the leading buyer tags are missing, against a 0.475 average.';
    expect(runChecks(memo, allowed, ['2026-10-24'], 12).unverifiedNumbers).toEqual([]);
    expect(runChecks('Overlap is 0.31.', allowed, ['2026-10-24'], 12).unverifiedNumbers).toEqual(['0.31']);
  });
});
