import Link from 'next/link';
import { AblationPanel, type Ablation } from '@/components/AblationPanel';
import { getStore } from '@/lib/runtime';
import type { Run } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function AblationPage({ searchParams }: { searchParams: Promise<{ runId?: string }> }) {
  const { runId } = await searchParams;
  const store = await getStore();
  const runs = ((await store.runs.list(40)) as Run[]).filter((r) => r.status === 'done');
  const selected = runs.find((r) => r.id === runId) ?? runs.find((r) => r.scenario) ?? runs[0];
  const latest = selected ? await store.ablations.latestForRun<Ablation>(selected.id) : null;
  const names = selected ? Object.fromEntries((await store.targets.list(selected.id)).map((t) => [t.targetId, t.name])) : {};
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Ablation: is Qloo load-bearing?</h1>
        <p className="max-w-3xl text-sm text-ink-2">
          The same screen, four ways: the full model; the same LLM ranking the same universe from general knowledge alone; Qloo without the cross-domain metric; and
          Qloo with one-way affinity only. If Simpatico worked the same without Qloo, it would be the wrong product.
        </p>
      </div>
      {runs.length === 0 ? (
        <p className="text-sm text-muted">Run a screen first.</p>
      ) : (
        <>
          <nav className="flex flex-wrap gap-2 text-sm" aria-label="Choose a screen">
            {runs.slice(0, 8).map((r) => (
              <Link key={r.id} href={`/ablation?runId=${r.id}`} className={`rounded-full border px-3 py-1 no-underline ${r.id === selected?.id ? 'border-s1 font-semibold text-ink' : 'border-line text-ink-2'}`}>
                {r.mandate.title ?? r.mandate.buyer.name}
              </Link>
            ))}
          </nav>
          {selected && <AblationPanel key={selected.id} runId={selected.id} initial={latest?.result ?? null} names={names} />}
        </>
      )}
    </div>
  );
}
