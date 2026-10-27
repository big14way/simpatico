// The judge is code. It validates every bull/bear claim against the evidence ledger and
// keeps the rejected ones (with the reason) so the UI can show them.

import { resolvePath } from './paths';
import type { Claim, EvidenceRow, RedFlag } from './types';
import { MITIGABLE_FLAGS, RED_FLAGS } from './types';

export const MAX_CLAIMS_PER_SIDE = 5;
export const MAX_CITES_PER_CLAIM = 4;
export const VALUE_TOLERANCE = 0.01;
export const RANK_TOLERANCE = 1;
/** a cite into the row's shortlist means rather than its data, e.g. "shortlistAverages.F" */
const AVERAGES_PREFIX = 'shortlistAverages.';

export interface RejectedClaim {
  claim: Claim;
  reason: string;
}

export interface JudgeOutcome {
  accepted: Claim[];
  rejected: RejectedClaim[];
  /** flags a validated bull claim addressed */
  mitigates: RedFlag[];
}

export interface JudgeInput {
  side: 'bull' | 'bear';
  claims: Claim[];
  /** this target's evidence rows only */
  pack: EvidenceRow[];
  /** flags the code rules raised for this target */
  computedFlags: RedFlag[];
  maxClaims?: number;
}

/** "domains[2].score" -> "domains[].score", for polarity rules that apply to every element. */
export function wildcardPath(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

/**
 * Where the value at `path` stands for this target against the shortlist average, with
 * lower-is-better paths flipped: +1 better, -1 worse, 0 level; null when the judge has no
 * direction rule for the path. Bull may not cite -1, bear may not cite +1.
 */
export function standing(row: EvidenceRow, path: string): 1 | -1 | 0 | null {
  const polarity = row.polarity[path] ?? row.polarity[wildcardPath(path)] ?? 0;
  const ref = row.ref[path];
  const actual = resolvePath(row.data, path);
  if (polarity === 0 || ref === undefined || typeof actual !== 'number' || !Number.isFinite(actual)) return null;
  const better = polarity * (actual - ref);
  return better > 1e-9 ? 1 : better < -1e-9 ? -1 : 0;
}

function lastSegment(path: string): string {
  const parts = path.split('.');
  return (parts[parts.length - 1] ?? '').replace(/\[\d+\]$/, '');
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 10_000) / 10_000);
}

function checkClaim(claim: Claim, side: 'bull' | 'bear', rows: Map<string, EvidenceRow>, computed: Set<RedFlag>): string | null {
  const want = side === 'bull' ? '+' : '-';
  if (claim.direction !== want) return `a ${side} claim must have direction "${want}"`;
  if (typeof claim.text !== 'string' || claim.text.trim().length === 0) return 'claim has no text';
  if (claim.text.length > 500) return 'claim text is over 500 characters';
  if (!Array.isArray(claim.cites) || claim.cites.length === 0) return 'claim cites no evidence';
  if (claim.cites.length > MAX_CITES_PER_CLAIM) return `claim cites more than ${MAX_CITES_PER_CLAIM} values`;

  // flags first: inventing a flag is a worse failure than a bad citation
  if (claim.flag !== undefined && claim.flag !== null) {
    if (!RED_FLAGS.includes(claim.flag)) return `"${String(claim.flag)}" is not a known red flag`;
    if (!computed.has(claim.flag)) {
      return side === 'bear'
        ? `bear cannot invent a flag: the code rules did not raise ${claim.flag}`
        : `nothing to mitigate: the code rules did not raise ${claim.flag}`;
    }
    if (side === 'bull' && !MITIGABLE_FLAGS.includes(claim.flag)) {
      return `${claim.flag} cannot be mitigated (only ${MITIGABLE_FLAGS.join(' and ')} can)`;
    }
  }

  if (claim.cites.every((c) => typeof c.path === 'string' && c.path.startsWith(AVERAGES_PREFIX))) {
    return 'claim cites only shortlist averages, no value of this target';
  }
  for (const cite of claim.cites) {
    const row = rows.get(cite.evidenceId);
    if (!row) return `cited evidence "${cite.evidenceId}" is not in this target's ledger`;
    // a shortlist mean is a ledger value too: checked for accuracy, with no direction rule
    const avg = typeof cite.path === 'string' && cite.path.startsWith(AVERAGES_PREFIX) ? cite.path.slice(AVERAGES_PREFIX.length) : null;
    if (avg !== null) {
      const ref = row.ref[avg];
      if (ref === undefined) return `"${cite.path}" is not a shortlist average in ${cite.evidenceId}`;
      if (typeof cite.value !== 'number' || Math.abs(cite.value - ref) > VALUE_TOLERANCE + 1e-12) {
        return `cited ${fmt(Number(cite.value))} for the shortlist average of ${row.label} "${avg}", but the ledger says ${fmt(ref)}`;
      }
      continue;
    }
    const actual = resolvePath(row.data, cite.path);
    if (typeof actual !== 'number' || !Number.isFinite(actual)) return `"${cite.path}" does not resolve to a number in ${cite.evidenceId}`;
    if (typeof cite.value !== 'number' || !Number.isFinite(cite.value)) return `cited value for "${cite.path}" is not a number`;
    const tol = /rank/i.test(lastSegment(cite.path)) ? RANK_TOLERANCE : VALUE_TOLERANCE;
    if (Math.abs(cite.value - actual) > tol + 1e-12) {
      return `cited ${fmt(cite.value)} for ${row.label} "${cite.path}", but the ledger says ${fmt(actual)}`;
    }
    const s = standing(row, cite.path);
    if (want === '+' && s === -1) {
      return `cites ${row.label} "${cite.path}" = ${fmt(actual)} as a strength, but it is below the shortlist average (${fmt(row.ref[cite.path]!)})`;
    }
    if (want === '-' && s === 1) {
      return `cites ${row.label} "${cite.path}" = ${fmt(actual)} as a weakness, but it is above the shortlist average (${fmt(row.ref[cite.path]!)})`;
    }
  }

  return null;
}

export function judgeClaims(inp: JudgeInput): JudgeOutcome {
  const max = inp.maxClaims ?? MAX_CLAIMS_PER_SIDE;
  const rows = new Map(inp.pack.map((r) => [r.id, r]));
  const computed = new Set(inp.computedFlags);
  const accepted: Claim[] = [];
  const rejected: RejectedClaim[] = [];
  const mitigates = new Set<RedFlag>();
  const seen = new Set<string>();

  inp.claims.forEach((claim, i) => {
    if (i >= max) {
      rejected.push({ claim, reason: `over the ${max}-claim limit` });
      return;
    }
    const key = (claim.text ?? '').trim().toLowerCase();
    if (seen.has(key)) {
      rejected.push({ claim, reason: 'duplicate of an earlier claim' });
      return;
    }
    seen.add(key);
    const reason = checkClaim(claim, inp.side, rows, computed);
    if (reason) {
      rejected.push({ claim, reason });
      return;
    }
    accepted.push(claim);
    if (inp.side === 'bull' && claim.flag) mitigates.add(claim.flag);
  });

  return { accepted, rejected, mitigates: [...mitigates] };
}
