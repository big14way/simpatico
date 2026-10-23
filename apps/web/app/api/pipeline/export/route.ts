import { getStore } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // neutralise spreadsheet formulas and quote everything
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET() {
  const store = await getStore();
  const deals = await store.pipeline.list();
  const head = ['buyer', 'deal_type', 'target', 'score_F', 'verdict', 'stage', 'owner', 'next_step', 'monitored', 'last_run', 'updated_at'];
  const lines = [head.map(cell).join(',')];
  for (const d of deals) {
    lines.push([d.buyerName, d.dealType, d.targetName, d.score === null ? '' : d.score.toFixed(1), d.verdict, d.stage, d.owner, d.nextStep, d.monitored, d.lastRunId, d.updatedAt].map(cell).join(','));
  }
  return new Response(lines.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="simpatico-pipeline.csv"', 'Cache-Control': 'no-store' },
  });
}
