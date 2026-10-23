/** Parse "a.b[0].c" into ["a", "b", 0, "c"]. Returns null for malformed paths. */
export function parsePath(path: string): (string | number)[] | null {
  if (typeof path !== 'string' || path.trim() === '') return null;
  const out: (string | number)[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let consumed = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
    else out.push(Number(m[2]));
    consumed += m[0];
  }
  // reject anything the tokenizer skipped other than dots
  if (consumed.length + (path.match(/\./g)?.length ?? 0) !== path.length) return null;
  return out;
}

export function resolvePath(root: unknown, path: string): unknown {
  const parts = parsePath(path);
  if (!parts) return undefined;
  let cur: unknown = root;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof p === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[p];
    } else {
      if (typeof cur !== 'object' || Array.isArray(cur)) return undefined;
      if (!Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
  }
  return cur;
}

/** Every numeric leaf as [path, value], e.g. ["domains[0].score", 0.78]. */
export function numericLeaves(root: unknown, prefix = ''): [string, number][] {
  const out: [string, number][] = [];
  const walk = (v: unknown, p: string) => {
    if (typeof v === 'number' && Number.isFinite(v)) out.push([p, v]);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
  };
  walk(root, prefix);
  return out;
}
