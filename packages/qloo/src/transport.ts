import { Agent, fetch } from 'undici';
import type { QueryParams } from './canonical';
import { canonicalParams } from './canonical';
import type { Surface } from './types';

export interface TransportResponse {
  httpStatus: number;
  body: unknown;
  durationMs: number;
}

export class TransportError extends Error {
  constructor(
    readonly code: 'network' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

export interface Transport {
  readonly surface: Surface;
  request(path: string, params: QueryParams): Promise<TransportResponse>;
}

export interface RestTransportOptions {
  apiKey: string;
  baseUrl?: string;
  /** per-attempt timeout; the US heatmap alone takes ~30 s */
  timeoutMs?: number;
}

/**
 * Direct REST against the hackathon host with the X-Api-Key header (never Bearer, never a
 * query param). One keep-alive pool: TLS handshakes to this host take 2-5 s, so reusing
 * connections matters more than anything else for latency.
 */
export class RestTransport implements Transport {
  readonly surface = 'rest' as const;
  private readonly baseUrl: string;
  private readonly dispatcher: Agent;
  private readonly timeoutMs: number;

  constructor(private readonly opts: RestTransportOptions) {
    if (!opts.apiKey) throw new Error('RestTransport needs an API key');
    this.baseUrl = (opts.baseUrl ?? 'https://hackathon.api.qloo.com').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 90_000;
    this.dispatcher = new Agent({
      connect: { timeout: 30_000 },
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 300_000,
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
      connections: 8,
      allowH2: false,
    });
  }

  async request(path: string, params: QueryParams): Promise<TransportResponse> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(canonicalParams(params))) url.searchParams.set(k, v);
    const started = Date.now();
    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'X-Api-Key': this.opts.apiKey, accept: 'application/json' },
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw toTransportError(err);
    }
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      throw toTransportError(err);
    }
    let body: unknown;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 500) };
    }
    return { httpStatus: res.status, body, durationMs: Date.now() - started };
  }
}

function toTransportError(err: unknown): TransportError {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const isTimeout =
    e?.name === 'TimeoutError' ||
    e?.name === 'AbortError' ||
    e?.cause?.code === 'UND_ERR_HEADERS_TIMEOUT' ||
    e?.cause?.code === 'UND_ERR_BODY_TIMEOUT';
  const detail = e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(err);
  return new TransportError(isTimeout ? 'timeout' : 'network', `Qloo request failed: ${detail}`);
}
