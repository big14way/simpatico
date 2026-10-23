import { Board } from '@/components/Board';
import { getStore } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export default async function PipelinePage() {
  const store = await getStore();
  const deals = await store.pipeline.list();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Pipeline</h1>
          <p className="text-sm text-ink-2">Every screened target lands here with its code-computed verdict. Drag cards between stages; the weekly monitor re-scores watched deals.</p>
        </div>
        <a className="btn btn-ghost" href="/api/pipeline/export">
          Export CSV
        </a>
      </div>
      {deals.length === 0 ? (
        <p className="text-sm text-muted">No deals yet. Run a screen first.</p>
      ) : (
        <Board
          initial={deals.map((d) => ({
            id: d.id,
            buyerName: d.buyerName,
            dealType: d.dealType,
            targetName: d.targetName,
            targetId: d.targetId,
            score: d.score,
            verdict: d.verdict,
            stage: d.stage,
            nextStep: d.nextStep,
            lastRunId: d.lastRunId,
            monitored: d.monitored,
          }))}
        />
      )}
    </div>
  );
}
