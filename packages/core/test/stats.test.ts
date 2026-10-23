import { describe, expect, it } from 'vitest';
import { cosine, harmonic, kendallTauB, mean, median, pearson, quantile, ranks, sd, spearman, topKOverlap } from '../src/stats';
import { parsePath, resolvePath, numericLeaves } from '../src/paths';

describe('stats', () => {
  it('basic moments', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(sd([5])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.75)).toBe(4);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it('harmonic mean penalises one-sided pairs', () => {
    expect(harmonic(0.8, 0.8)).toBeCloseTo(0.8);
    expect(harmonic(0.9, 0.1)).toBeCloseTo(0.18);
    expect(harmonic(0, 0.5)).toBe(0);
  });

  it('cosine and pearson', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([0, 0], [1, 1])).toBeNull();
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it('ranks share ties', () => {
    expect(ranks([10, 30, 20, 30])).toEqual([4, 1.5, 3, 1.5]);
  });

  it('kendall tau-b and spearman', () => {
    expect(kendallTauB([1, 2, 3, 4], [1, 2, 3, 4])).toBe(1);
    expect(kendallTauB([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    // one swap among 4 items: (6 - 2*1)/6
    expect(kendallTauB([1, 2, 3, 4], [1, 3, 2, 4])).toBeCloseTo(4 / 6);
    expect(kendallTauB([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
  });

  it('top-k overlap', () => {
    expect(topKOverlap(['a', 'b', 'c', 'd'], ['b', 'a', 'x', 'y'], 2)).toBe(1);
    expect(topKOverlap(['a', 'b', 'c'], ['x', 'y', 'a'], 3)).toBeCloseTo(1 / 3);
  });
});

describe('paths', () => {
  const data = { value: 0.5, domains: [{ score: 0.7, shared: [{ name: 'X', affinity: 0.9 }] }] };
  it('parses and resolves', () => {
    expect(parsePath('domains[0].shared[0].affinity')).toEqual(['domains', 0, 'shared', 0, 'affinity']);
    expect(resolvePath(data, 'domains[0].shared[0].affinity')).toBe(0.9);
    expect(resolvePath(data, 'value')).toBe(0.5);
    expect(resolvePath(data, 'domains[3].score')).toBeUndefined();
    expect(resolvePath(data, 'constructor')).toBeUndefined();
    expect(resolvePath(data, 'domains..x')).toBeUndefined();
    expect(parsePath('a[x]')).toBeNull();
  });
  it('lists numeric leaves', () => {
    expect(numericLeaves(data)).toEqual([
      ['value', 0.5],
      ['domains[0].score', 0.7],
      ['domains[0].shared[0].affinity', 0.9],
    ]);
  });
});
