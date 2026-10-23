export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('mean of empty list');
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n - 1). Returns 0 for fewer than two values. */
export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('median of empty list');
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Linear-interpolated quantile, q in [0, 1]. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) throw new Error('quantile of empty list');
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Cosine similarity; null when either vector has zero length. */
export function cosine(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length) throw new Error('cosine: length mismatch');
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! ** 2;
    nb += b[i]! ** 2;
  }
  if (na === 0 || nb === 0) return null;
  return clamp(dot / Math.sqrt(na * nb), -1, 1);
}

/** Pearson correlation (= cosine of mean-centred vectors); null when either side is constant. */
export function pearson(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length) throw new Error('pearson: length mismatch');
  if (a.length < 2) return null;
  const ma = mean(a);
  const mb = mean(b);
  return cosine(a.map((x) => x - ma), b.map((x) => x - mb));
}

/** Harmonic mean of two non-negative numbers; 0 if either is 0. */
export function harmonic(a: number, b: number): number {
  return a + b === 0 ? 0 : (2 * a * b) / (a + b);
}

/** Average ranks (1 = largest), ties share the mean rank. */
export function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((x, i) => ({ x, i })).sort((p, q) => q.x - p.x);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]!.x === idx[i]!.x) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]!.i] = r;
    i = j + 1;
  }
  return out;
}

export function spearman(a: readonly number[], b: readonly number[]): number | null {
  return pearson(ranks(a), ranks(b));
}

/** Kendall tau-b (handles ties). null when either side is constant. */
export function kendallTauB(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length) throw new Error('kendall: length mismatch');
  let concordant = 0;
  let discordant = 0;
  let tiesA = 0;
  let tiesB = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const da = Math.sign(a[i]! - a[j]!);
      const db = Math.sign(b[i]! - b[j]!);
      if (da === 0 && db === 0) continue;
      if (da === 0) tiesA++;
      else if (db === 0) tiesB++;
      else if (da === db) concordant++;
      else discordant++;
    }
  }
  const denom = Math.sqrt((concordant + discordant + tiesA) * (concordant + discordant + tiesB));
  return denom === 0 ? null : (concordant - discordant) / denom;
}

/** |top-k(A) ∩ top-k(B)| / k for two ranked id lists. */
export function topKOverlap(a: readonly string[], b: readonly string[], k: number): number {
  const kk = Math.min(k, a.length, b.length);
  if (kk === 0) return 0;
  const sa = new Set(a.slice(0, kk));
  return b.slice(0, kk).filter((x) => sa.has(x)).length / kk;
}

export function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
