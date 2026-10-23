// Live smoke test of every gateway method. Needs QLOO_API_KEY in the environment.
// Prints statuses and counts only (no response data is written anywhere).
import { MemoryCache, MemoryLedger, QlooClient, RestTransport } from '@simpatico/qloo';

const apiKey = process.env.QLOO_API_KEY;
if (!apiKey) {
  console.error('QLOO_API_KEY is not set');
  process.exit(1);
}
const client = new QlooClient({
  transport: new RestTransport({ apiKey, baseUrl: process.env.QLOO_BASE_URL }),
  cache: new MemoryCache(),
  ledger: new MemoryLedger(),
  onCall: (e) => console.log(`  ${e.status.padEnd(7)} ${String(e.durationMs).padStart(6)}ms ${e.path} (${e.purpose})`),
});
const meta = (purpose: string) => ({ purpose });

const pepsi = await client.search('Pepsi', { types: ['urn:entity:brand'], take: 3 }, meta('search'));
const doritos = await client.search('Doritos', { types: ['urn:entity:brand'], take: 3 }, meta('search'));
const olipop = await client.search('Olipop', { types: ['urn:entity:brand'], take: 3 }, meta('search'));
const buyer = [pepsi.results[0]!.id, doritos.results[0]!.id];
const target = olipop.results[0]!.id;
console.log('resolved', pepsi.results[0]?.name, doritos.results[0]?.name, olipop.results[0]?.name);

const tags = await client.tags('snack', { tagTypes: ['urn:tag:genre:brand'] }, meta('tags'));
console.log('tag', tags.results[0]?.id);
const rank = await client.rank({ filterType: 'urn:entity:brand', signalEntities: buyer, candidates: [target], explainability: true }, meta('rank'));
console.log('rank', rank.status, rank.results[0]?.affinity, rank.results[0]?.explainability.length);
const prof = await client.rankProfiles({ filterType: 'urn:entity:brand', signalEntities: buyer, candidates: [target], explainability: true }, meta('rank-profile'));
console.log('profile (cached)', prof.fromCache, prof.results[0]?.competitorBrands.slice(0, 2));
const tp = await client.tagProfile({ signalEntities: [target], tagTypes: ['urn:tag:genre:music', 'urn:tag:keyword:media'], take: 10 }, meta('tag-profile'));
console.log('tagProfile', tp.status, tp.results.length);
const demo = await client.demographics([...buyer, target], meta('demographics'));
console.log('demographics', demo.status, demo.results.length);
const cmp = await client.compare(buyer, [target], meta('compare'));
console.log('compare', cmp.status, cmp.results.shared.map((t) => t.name).join(', '));
const tr = await client.trending({ filterType: 'urn:entity:brand', entity: target, startDate: '2024-05-01', endDate: '2024-10-31' }, meta('trending'));
console.log('trending', tr.status, tr.results.length, tr.results[0]?.date, tr.results.at(-1)?.date);
const hm = await client.heatmap({ signalEntities: [target], location: 'United States' }, meta('heatmap'));
console.log('heatmap', hm.status, hm.results.length);
