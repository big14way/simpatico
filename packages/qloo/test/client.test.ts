import { describe, expect, it } from 'vitest';
import { QlooClient } from '../src/client';
import { QlooRequiredError } from '../src/errors';
import { Limiter } from '../src/limiter';
import { MemoryCache, MemoryLedger } from '../src/stores';
import { cacheKey } from '../src/canonical';
import { FakeTransport, entity, netErr, ok, status } from './fake';

const meta = { purpose: 'test', runId: 'run_1' };
const fastLimiter = () => new Limiter({ ratePerSec: 1000, burst: 1000, concurrency: 8 });

function setup(responder: ConstructorParameters<typeof FakeTransport>[0], mode: 'live' | 'hybrid' | 'replay' = 'live') {
  const transport = new FakeTransport(responder);
  const cache = new MemoryCache();
  const ledger = new MemoryLedger();
  const client = new QlooClient({ transport, cache, ledger, mode, limiter: fastLimiter(), backoffMs: [1, 1, 1] });
  return { transport, cache, ledger, client };
}

describe('QlooClient', () => {
  it('sends rank as filter.results.entities and parses affinities', async () => {
    const { transport, client, ledger } = setup(() =>
      ok({ success: true, results: { entities: [entity('T-1', 'Brand One', 0.78), entity('T-2', 'Brand Two', 0.61)] } }),
    );
    const env = await client.rank(
      { filterType: 'urn:entity:brand', signalEntities: ['SIG-1', 'SIG-2'], candidates: ['T-1', 'T-2'], explainability: true },
      meta,
    );
    expect(env.status).toBe('ok');
    expect(env.results.map((r) => [r.id, r.affinity])).toEqual([['T-1', 0.78], ['T-2', 0.61]]);
    expect(env.results[0]!.explainability).toEqual([{ entityId: 'SIG-1', score: 0.7 }]);
    expect(transport.calls[0]!.params).toMatchObject({
      'filter.type': 'urn:entity:brand',
      'signal.interests.entities': 'SIG-1,SIG-2',
      'filter.results.entities': 'T-1,T-2',
      'feature.explainability': 'true',
      take: '2',
    });
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({ id: env.evidenceId, runId: 'run_1', path: '/v2/insights', status: 'ok', fromCache: false });
    expect(JSON.stringify(ledger.rows[0]!.params)).not.toMatch(/api.?key/i);
  });

  it('marks a rank call partial when some candidates come back missing', async () => {
    const { client } = setup(() => ok({ success: true, results: { entities: [entity('T-1', 'Brand One', 0.7)] } }));
    const env = await client.rank({ filterType: 'urn:entity:brand', signalEntities: ['S'], candidates: ['T-1', 'T-2'] }, meta);
    expect(env.status).toBe('partial');
  });

  it('serves repeat calls from cache and still logs evidence for each', async () => {
    const { transport, client, ledger, cache } = setup(() => ok({ success: true, results: { entities: [entity('T-1', 'Brand One', 0.7)] } }));
    const p = { filterType: 'urn:entity:brand' as const, signalEntities: ['S'], candidates: ['T-1'] };
    const a = await client.rank(p, meta);
    const b = await client.rank(p, meta);
    expect(transport.calls).toHaveLength(1);
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(b.results).toEqual(a.results);
    expect(ledger.rows.map((r) => r.responseId)).toEqual([cache.rows[0]!.id, cache.rows[0]!.id]);
  });

  it('compacts bodies before caching (drops akas and unused properties, keeps corporate fields)', async () => {
    const { client, cache } = setup(() => ok({ success: true, results: { entities: [entity('T-1', 'Brand One', 0.7)] } }));
    const env = await client.rankProfiles({ filterType: 'urn:entity:brand', signalEntities: ['S'], candidates: ['T-1'] }, meta);
    const stored = JSON.stringify(cache.rows[0]!.body);
    expect(stored).not.toContain('akas');
    expect(stored).not.toContain('huge_unused_field');
    expect(stored).not.toContain('wikidata');
    expect(env.results[0]).toMatchObject({ ultimateParent: 'Example Holdings, Inc.', foundedYear: 2015, competitorBrands: ['Brand Z'] });
  });

  it('bypassCache forces a fresh request', async () => {
    const { transport, client } = setup(() => ok({ success: true, results: { entities: [entity('T-1', 'Brand One', 0.7)] } }));
    const p = { filterType: 'urn:entity:brand' as const, signalEntities: ['S'], candidates: ['T-1'] };
    await client.rank(p, meta);
    await client.rank(p, { ...meta, bypassCache: true });
    expect(transport.calls).toHaveLength(2);
  });

  it('retries 429 and network errors, then succeeds', async () => {
    let n = 0;
    const { transport, client } = setup(() => {
      n++;
      if (n === 1) return status(429);
      if (n === 2) return netErr();
      return ok({ success: true, results: { entities: [entity('T-1', 'Brand One', 0.7)] } });
    });
    const env = await client.rank({ filterType: 'urn:entity:brand', signalEntities: ['S'], candidates: ['T-1'] }, meta);
    expect(env.status).toBe('ok');
    expect(transport.calls).toHaveLength(3);
  });

  it('gives up after the retry budget and returns a retryable error envelope (never a guess)', async () => {
    const { transport, client, cache } = setup(() => status(503, { message: 'unavailable' }));
    const env = await client.rank({ filterType: 'urn:entity:brand', signalEntities: ['S'], candidates: ['T-1'] }, meta);
    expect(env.status).toBe('error');
    expect(env.error).toMatchObject({ code: 'server', retryable: true });
    expect(env.results).toEqual([]);
    expect(transport.calls).toHaveLength(4);
    expect(cache.rows).toHaveLength(0);
  });

  it('does not retry a 400 and surfaces the validation message', async () => {
    const { transport, client } = setup(() =>
      status(400, { errors: [{ message: 'take must be an integer value between 1 and 50', path: 'take' }] }),
    );
    const env = await client.trending({ filterType: 'urn:entity:brand', entity: 'T-1', startDate: '2026-01-01', endDate: '2026-02-01', take: 50 }, meta);
    expect(env.status).toBe('error');
    expect(env.error!.message).toContain('take must be an integer');
    expect(transport.calls).toHaveLength(1);
  });

  it('throws QlooRequiredError on a cache miss when no key is configured', async () => {
    const client = new QlooClient({ transport: null, cache: new MemoryCache(), ledger: new MemoryLedger(), mode: 'hybrid' });
    await expect(client.search('Brand One', {}, meta)).rejects.toBeInstanceOf(QlooRequiredError);
    expect(client.canCallLive).toBe(false);
  });

  it('replay mode never touches the network and reports unrecorded calls', async () => {
    const { transport, client } = setup(() => ok({}), 'replay');
    const env = await client.search('Brand One', {}, meta);
    expect(env.status).toBe('error');
    expect(env.error!.code).toBe('not_recorded');
    expect(transport.calls).toHaveLength(0);
  });

  it('hybrid serves pinned rows at any age; live mode does not', async () => {
    const cache = new MemoryCache();
    const params = { query: 'Brand One', take: '5' };
    cache.rows.push({
      id: 'qr_old',
      key: cacheKey('GET', '/search', params),
      method: 'GET',
      path: '/search',
      params,
      httpStatus: 200,
      body: { results: [entity('T-1', 'Brand One', 0)] },
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
      pinned: true,
      surface: 'rest',
    });
    const transport = new FakeTransport(() => ok({ results: [entity('T-9', 'Fresh', 0)] }));
    const hybrid = new QlooClient({ transport, cache, ledger: new MemoryLedger(), mode: 'hybrid', limiter: fastLimiter() });
    const h = await hybrid.search('Brand One', {}, meta);
    expect(h.fromCache).toBe(true);
    expect(h.results[0]!.id).toBe('T-1');
    const live = new QlooClient({ transport, cache, ledger: new MemoryLedger(), mode: 'live', limiter: fastLimiter() });
    const l = await live.search('Brand One', {}, meta);
    expect(l.fromCache).toBe(false);
    expect(l.results[0]!.id).toBe('T-9');
  });

  it('empty results are reported as empty, not as zero affinity', async () => {
    const { client } = setup(() => ok({ success: true, results: { entities: [] } }));
    const env = await client.recommend({ filterType: 'urn:entity:brand', signalEntities: ['S'] }, meta);
    expect(env.status).toBe('empty');
  });
});

describe('Limiter', () => {
  it('never exceeds the concurrency cap', async () => {
    const limiter = new Limiter({ ratePerSec: 1000, burst: 1000, concurrency: 3 });
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        limiter.run(async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });
});

describe('cacheKey', () => {
  it('is independent of param order and ignores empty values', () => {
    const a = cacheKey('GET', '/v2/insights', { 'filter.type': 'urn:entity:brand', take: '5', 'filter.tags': '' });
    const b = cacheKey('get', '/v2/insights', { take: '5', 'filter.type': 'urn:entity:brand' });
    expect(a).toBe(b);
  });
});
