import { createHash, randomUUID } from 'node:crypto';

export type QueryParams = Record<string, string>;

/** Sorted, string-valued params with empties dropped; list values are already comma-joined. */
export function canonicalParams(params: QueryParams): QueryParams {
  const out: QueryParams = {};
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

export function cacheKey(method: string, path: string, params: QueryParams): string {
  const qs = Object.entries(canonicalParams(params)).map(([k, v]) => `${k}=${v}`).join('&');
  return createHash('sha256').update(`${method.toUpperCase()}|${path}|${qs}`).digest('hex');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}
