import Link from 'next/link';
import { AblationPanel, type Ablation } from '@/components/AblationPanel';
import { getStore } from '@/lib/runtime';
import type { Run } from '@/lib/data';
import { when } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AblationPage({ searchParams }: { searchParams: Promise<{ runId?: string }> }) {
  const { runId } = await searchParams;
  const store = await getStore();
  const runs = ((await store.runs.list(40)) as Run[]).filter((r) => r.status === 'done');
  // one chip per screen (its latest run); an older run stays reachable by ?runId=
  const title = (r: Run) => r.mandate.title ?? r.mandate.buyer.name;
  const seen = new Set<string>();
  const latestPerScreen = runs.filter((r) => {
    if (seen.has(title(r))) return false;
    seen.add(title(r));
    return true;
  });
  const selected = runs.find((r) => r.id === runId) ?? latestPerScreen.find((r) => r.scenario) ?? latestPerScreen[0];
  const chips = latestPerScreen.slice(0, 8);
  if (selected && !chips.includes(selected)) chips.push(selected);
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
            {chips.map((r) => (
              <Link key={r.id} href={`/ablation?runId=${r.id}`} className={`rounded-full border px-3 py-1 no-underline ${r.id === selected?.id ? 'border-s1 font-semibold text-ink' : 'border-line text-ink-2'}`}>
                {title(r)}
                {!latestPerScreen.includes(r) && <span className="text-muted"> ({when(r.createdAt)})</span>}
              </Link>
            ))}
          </nav>
          {selected && <AblationPanel key={selected.id} runId={selected.id} initial={latest?.result ?? null} names={names} />}
        </>
      )}
    </div>
  );
}
