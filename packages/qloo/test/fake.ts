// Synthetic bodies shaped like live Qloo responses. Names and ids are invented: Qloo's terms
// don't allow storing real response data in a public repository.
import type { Transport, TransportResponse } from '../src/transport';
import { TransportError } from '../src/transport';

export type Responder = (path: string, params: Record<string, string>) => TransportResponse | Error;

export class FakeTransport implements Transport {
  readonly surface = 'rest' as const;
  readonly calls: { path: string; params: Record<string, string> }[] = [];
  constructor(private readonly responder: Responder) {}
  async request(path: string, params: Record<string, string>): Promise<TransportResponse> {
    this.calls.push({ path, params });
    const r = this.responder(path, params);
    if (r instanceof Error) throw r;
    return r;
  }
}

export const ok = (body: unknown): TransportResponse => ({ httpStatus: 200, body, durationMs: 5 });
export const status = (code: number, body: unknown = {}): TransportResponse => ({ httpStatus: code, body, durationMs: 5 });
export const netErr = () => new TransportError('network', 'Qloo request failed: UND_ERR_CONNECT_TIMEOUT');

export const entity = (id: string, name: string, affinity: number, extra: Record<string, unknown> = {}) => ({
  entity_id: id,
  name,
  type: 'urn:entity',
  subtype: 'urn:entity:brand',
  popularity: 0.5,
  disambiguation: '',
  properties: {
    akas: [{ language: 'xx', value: name }],
    image: { url: `https://example.invalid/${id}.jpg` },
    ultimate_parent: 'Example Holdings, Inc.',
    founded_year: 2015,
    market_positioning: 'Synthetic test positioning.',
    competitor_brands: ['Brand Z'],
    huge_unused_field: 'x'.repeat(100),
  },
  external: { wikidata: { id: 'Q0' } },
  tags: [
    { id: 'urn:tag:genre:brand:food_and_beverage', name: 'Food & Beverage', type: 'urn:tag:genre:brand' },
    { id: 'urn:tag:aesthetic_property:qloo:teal_palette', name: 'Teal Palette', type: 'urn:tag:aesthetic_property:qloo' },
  ],
  query: {
    affinity,
    measurements: { audience_growth: 0 },
    explainability: { 'signal.interests.entities': [{ entity_id: 'SIG-1', score: 0.7 }] },
  },
  ...extra,
});
