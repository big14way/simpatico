import { describe, expect, it } from 'vitest';
import { num, tidyNumbers } from '../lib/format';

describe('number display', () => {
  it('shows four significant digits and leaves short numbers alone', () => {
    expect(num(0.8981596499915091)).toBe('0.8982');
    expect(num(70.13423682620956)).toBe('70.13');
    expect(num(0.35)).toBe('0.35');
    expect(num(-0.66)).toBe('-0.66');
    expect(num(8)).toBe('8');
  });

  it('shortens only long decimals inside model text', () => {
    expect(tidyNumbers('Agreement is 0.8981596499915091, F 70.13423682620956, overlap 0.35 in 2026-10-24 for 45-54.')).toBe(
      'Agreement is 0.8982, F 70.13, overlap 0.35 in 2026-10-24 for 45-54.',
    );
  });
});
