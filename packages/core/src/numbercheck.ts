// Memo checks. Every number in an IC memo must trace to the ledger; the memo can't be
// exported while any number is unverified or the language guard fires.

export interface CheckedNumber {
  raw: string;
  value: number;
  index: number;
  ok: boolean;
}

export interface NumberCheckInput {
  text: string;
  /** every numeric value in the evidence the memo was written from */
  allowed: readonly number[];
  /** ISO dates the memo may mention (run date, data dates, momentum window) */
  allowedDates?: readonly string[];
  /** small integers 1..maxCount are allowed as ranks and counts */
  maxCount?: number;
}

export interface NumberCheckResult {
  numbers: CheckedNumber[];
  unverified: CheckedNumber[];
  ok: boolean;
}

const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
// A number not glued to a preceding letter/digit/underscore/period (so "m1", "v2" and
// version strings are skipped). Leading minus (ascii or unicode), thousands separators,
// decimals and a trailing % are captured.
const NUM_RE = /(?<![A-Za-z0-9_.])([-−]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(%?)/g;

function decimals(s: string | undefined): number {
  return s ? s.length - 1 : 0;
}

export function numberMatches(token: { value: number; decimals: number; percent: boolean }, allowed: readonly number[]): boolean {
  const tol = 0.5 * 10 ** -token.decimals + 1e-9;
  const x = Math.abs(token.value);
  for (const v of allowed) {
    const a = Math.abs(v);
    if (Math.abs(x - a) <= tol) return true;
    if (Math.abs(x - a * 100) <= tol) return true;
  }
  return false;
}

export function checkNumbers(inp: NumberCheckInput): NumberCheckResult {
  const dates = new Set(inp.allowedDates ?? []);
  const numbers: CheckedNumber[] = [];
  // mask dates so their parts aren't re-read as numbers
  let masked = inp.text;
  for (const m of inp.text.matchAll(DATE_RE)) {
    numbers.push({ raw: m[0], value: NaN, index: m.index!, ok: dates.has(m[0]) });
    masked = masked.slice(0, m.index!) + ' '.repeat(m[0].length) + masked.slice(m.index! + m[0].length);
  }
  const maxCount = inp.maxCount ?? 0;
  for (const m of masked.matchAll(NUM_RE)) {
    const intPart = m[2]!.replace(/,/g, '');
    const value = Number(`${intPart}${m[3] ?? ''}`);
    if (!Number.isFinite(value)) continue;
    const token = { value, decimals: decimals(m[3]), percent: m[4] === '%' };
    const isSmallCount = token.decimals === 0 && !token.percent && value >= 0 && value <= maxCount;
    const ok = isSmallCount || numberMatches(token, inp.allowed);
    numbers.push({ raw: m[0], value: m[1] ? -value : value, index: m.index!, ok });
  }
  numbers.sort((a, b) => a.index - b.index);
  const unverified = numbers.filter((n) => !n.ok);
  return { numbers, unverified, ok: unverified.length === 0 };
}

/** Wording that turns aggregate affinity into claims about individuals or causation. */
export const BANNED_PHRASES: readonly { re: RegExp; label: string; suggestion: string }[] = [
  { re: /\bwill buy\b/gi, label: 'will buy', suggestion: 'over-indexes on / shows audience affinity for' },
  { re: /\b(?:customers|consumers|shoppers|fans) will\b/gi, label: 'customers will', suggestion: 'the audience over-indexes on' },
  { re: /\bcaus(?:e|es|ed|ing)\b/gi, label: 'causes', suggestion: 'is associated with' },
  { re: /\bprobability that (?:a|any|each|the) (?:person|consumer|customer|individual|shopper)\b/gi, label: 'probability that a person', suggestion: 'aggregate audience affinity' },
  { re: /\bguarantee(?:s|d)?\b/gi, label: 'guarantee', suggestion: 'suggests' },
];

export interface LanguageViolation {
  phrase: string;
  match: string;
  index: number;
  suggestion: string;
}

export function languageGuard(text: string): LanguageViolation[] {
  const out: LanguageViolation[] = [];
  for (const b of BANNED_PHRASES) {
    for (const m of text.matchAll(b.re)) out.push({ phrase: b.label, match: m[0], index: m.index!, suggestion: b.suggestion });
  }
  return out.sort((a, b) => a.index - b.index);
}
