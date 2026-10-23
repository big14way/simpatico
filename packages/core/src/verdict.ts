import type { VerdictBands } from './config';
import type { FlagHit, RedFlag, Verdict } from './types';
import { MITIGABLE_FLAGS } from './types';

export interface VerdictInput {
  F: number | null;
  coverage: number;
  flags: FlagHit[];
  /** flags a validated bull claim addressed (only FADING / NO_GEO_OVERLAP count) */
  mitigated: RedFlag[];
}

export interface VerdictOutcome {
  verdict: Verdict;
  /** the rule that decided it, in words, shown as "why this verdict" */
  why: string;
  unmitigatedFlags: RedFlag[];
  mitigatedFlags: RedFlag[];
}

/**
 * ADVANCE: F >= advanceMin and no red flag.
 * WATCH:   F >= watchMin and either no flag, or exactly one flag that is mitigable
 *          (FADING / NO_GEO_OVERLAP) and mitigated by a validated bull claim.
 * PASS:    anything else.
 * INSUFFICIENT_COVERAGE: weighted coverage below the minimum; there is no score.
 * Models never set F or the verdict; they can only supply claims the judge validates.
 */
export function decideVerdict(inp: VerdictInput, bands: VerdictBands): VerdictOutcome {
  const flags = inp.flags.map((f) => f.flag);
  const mitigatedFlags = flags.filter((f) => MITIGABLE_FLAGS.includes(f) && inp.mitigated.includes(f));
  const unmitigatedFlags = flags.filter((f) => !mitigatedFlags.includes(f));
  const covPct = Math.round(inp.coverage * 100);

  if (inp.F === null || inp.coverage + 1e-9 < bands.minCoverage) {
    return {
      verdict: 'INSUFFICIENT_COVERAGE',
      why: `Qloo measured ${covPct}% of the weighted evidence (minimum ${Math.round(bands.minCoverage * 100)}%). Qloo can't see this brand well enough, so there is no score.`,
      unmitigatedFlags,
      mitigatedFlags,
    };
  }
  const F = inp.F;
  const f1 = F.toFixed(1);
  if (flags.length === 0 && F >= bands.advanceMin) {
    return { verdict: 'ADVANCE', why: `F ${f1} >= ${bands.advanceMin} and no red flags.`, unmitigatedFlags, mitigatedFlags };
  }
  if (flags.length === 0 && F >= bands.watchMin) {
    return { verdict: 'WATCH', why: `F ${f1} is between ${bands.watchMin} and ${bands.advanceMin}, no red flags.`, unmitigatedFlags, mitigatedFlags };
  }
  if (flags.length === 1 && mitigatedFlags.length === 1 && F >= bands.watchMin) {
    return {
      verdict: 'WATCH',
      why: `F ${f1} >= ${bands.watchMin}; one red flag (${mitigatedFlags[0]}) mitigated by a validated bull claim.`,
      unmitigatedFlags,
      mitigatedFlags,
    };
  }
  if (flags.length === 0) {
    return { verdict: 'PASS', why: `F ${f1} < ${bands.watchMin}.`, unmitigatedFlags, mitigatedFlags };
  }
  const flagText = unmitigatedFlags.length > 0 ? `unmitigated red flag(s): ${unmitigatedFlags.join(', ')}` : `${flags.length} red flags`;
  return {
    verdict: 'PASS',
    why: F >= bands.watchMin ? `F ${f1}, but ${flagText}.` : `F ${f1} < ${bands.watchMin} and ${flagText}.`,
    unmitigatedFlags,
    mitigatedFlags,
  };
}
