import Link from 'next/link';
import { notFound } from 'next/navigation';
import { METRIC_KEYS, METRIC_LABELS, type MetricKey, type MetricResult } from '@simpatico/core';
import { MemoView } from '@/components/MemoView';
import { RunLive } from '@/components/RunLive';
import { StartScenario } from '@/components/StartScenario';
import { VerdictBadge } from '@/components/VerdictBadge';
import { loadRun } from '@/lib/data';
import { dealTypeLabel, f1, f2, pct, when } from '@/lib/format';
import { getStore, qlooConfigured } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

const OWNERSHIP: Record<string, string> = {
  owned_by_buyer: "Owned by the buyer's parent",
  part_of_other: 'Part of another group',
  independent: 'Independent',
  unknown: 'Owner unknown',
};

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  const [view, events] = await Promise.all([loadRun(id), store.runs.events(id)]);
  if (!view) notFound();
  const { run, targets, shortlist, memos, drafts } = view;
  const ranked = [...shortlist].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const summaryMemo = memos.find((m) => m.targetId === null);
  const m = run.mandate;
  const s = run.summary;
  const buyer = run.state.buyer;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">{dealTypeLabel(m.dealType)}{run.scenario ? ' · showcase' : ''}</p>
          <h1 className="text-2xl font-bold">{m.title ?? `${m.buyer.name} screen`}</h1>
          <p className="text-sm text-ink-2">
            Buyer audience: {buyer ? buyer.entities.map((e) => e.name).join(' + ') : m.buyer.name}
            {buyer?.parent ? ` (parent: ${buyer.parent})` : ''} · started {when(run.createdAt)} · Qloo calls: {run.callsLive} live, {run.callsCached} from cache
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/pipeline" className="btn btn-ghost">
            Pipeline
          </Link>
          {run.status === 'done' && (
            <Link href={`/ablation?runId=${run.id}`} className="btn btn-ghost">
              Ablation
            </Link>
          )}
          {run.scenario && qlooConfigured() && run.status !== 'running' && <StartScenario slug={run.scenario} label="Re-run live" />}
        </div>
      </div>

      {run.demoMode !== 'live' && run.status === 'done' && run.callsLive === 0 && (
        <p className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-2">
          Replayed from Qloo responses recorded in the private server-side cache. &ldquo;Re-run live&rdquo; re-queries Qloo.
        </p>
      )}

      {run.status === 'failed' && (
        <div className="card border-critical p-4">
          <h2 className="font-bold text-critical">The screen stopped</h2>
          <p className="text-sm">{run.error}</p>
        </div>
      )}

      {run.status !== 'done' && (
        <RunLive
          runId={run.id}
          initialStatus={run.status}
          initialEvents={events.map((e) => ({ seq: e.seq, kind: e.kind, message: e.message, at: e.at }))}
          initialPending={(run.state.pending ?? []) as never}
        />
      )}

      {run.status === 'done' && s && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Screened', String(s.screened)],
            ['Analysed', String(s.shortlisted)],
            ['Verdicts', Object.entries(s.verdicts).map(([v, n]) => `${n} ${v.toLowerCase().replace('_', ' ')}`).join(', ') || 'none'],
            ['Claims judged', `${s.claimsAccepted} kept, ${s.claimsRejected} rejected`],
            ['Outreach drafts', `${s.outreachDrafts} awaiting approval`],
          ].map(([k, v]) => (
            <div key={k} className="card p-3">
              <div className="label">{k}</div>
              <div className="mt-1 text-sm font-semibold">{v}</div>
            </div>
          ))}
        </section>
      )}

      {ranked.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-bold">Ranked shortlist</h2>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-3 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">Target</th>
                  <th className="px-3 py-2 text-right font-semibold">F</th>
                  <th className="px-3 py-2 font-semibold">Verdict</th>
                  {METRIC_KEYS.map((k) => (
                    <th key={k} className="px-2 py-2 text-right font-semibold" title={METRIC_LABELS[k]}>
                      {k}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((t, i) => {
                  const metrics = (t.metrics ?? {}) as unknown as Partial<Record<MetricKey, MetricResult>>;
                  const own = String(t.profile?.ownership ?? 'unknown');
                  return (
                    <tr key={t.targetId} className="border-b border-line last:border-0">
                      <td className="num px-3 py-2 text-ink-2">{i + 1}</td>
                      <td className="px-3 py-2">
                        <Link href={`/runs/${run.id}/targets/${t.targetId}`} className="font-semibold">
                          {t.name}
                        </Link>
                        <div className="text-xs text-muted">
                          {OWNERSHIP[own] ?? own}
                          {own !== 'unknown' && own !== 'independent' && t.profile?.ultimateParent ? `: ${String(t.profile.ultimateParent)}` : ''}
                          {t.pinned ? ' · pinned' : ''}
                        </div>
                      </td>
                      <td className="num px-3 py-2 text-right font-semibold">{f1(t.score)}</td>
                      <td className="px-3 py-2">
                        <VerdictBadge verdict={t.verdict} />
                      </td>
                      {METRIC_KEYS.map((k) => {
                        const mm = metrics[k];
                        return (
                          <td key={k} className={`num px-2 py-2 text-right ${mm && mm.coverage === 0 ? 'text-muted' : ''}`} title={mm?.note ?? METRIC_LABELS[k]}>
                            {mm && mm.value !== null ? f2(mm.value) : '–'}
                          </td>
                        );
                      })}
                      <td className="num px-3 py-2 text-right text-ink-2">{pct(t.coverage)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            m1 two-way affinity · m2 taste overlap · m3 cross-domain agreement · m4 demographics · m5 geographic footprint · m6 momentum. &ldquo;–&rdquo; = Qloo
            could not measure it; it drops out of F rather than counting as zero.
          </p>
        </section>
      )}

      {summaryMemo && (
        <section className="card p-4">
          <MemoView markdown={summaryMemo.markdown} checks={summaryMemo.checks} model={summaryMemo.model} filename={`simpatico-${run.id}-summary.md`} />
        </section>
      )}

      {drafts.length > 0 && (
        <section className="card p-4 text-sm">
          <h2 className="font-bold">Outreach</h2>
          <p className="text-ink-2">
            {drafts.filter((d) => d.status === 'pending').length} draft(s) waiting for human approval in the <Link href="/approvals">approvals inbox</Link>. Nothing sends
            without it.
          </p>
        </section>
      )}

      {targets.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer font-bold">Whole universe: stage-1 screen ({targets.length} brands)</summary>
          <p className="mt-2 text-xs text-muted">One Qloo rank call scores every candidate for the buyer&rsquo;s audience (forward affinity). The top {m.shortlistSize} plus pinned brands get the full analysis.</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Brand</th>
                  <th className="px-2 py-1.5 text-right">Forward affinity</th>
                  <th className="px-2 py-1.5 text-right">Qloo popularity</th>
                  <th className="px-2 py-1.5">Ownership</th>
                  <th className="px-2 py-1.5">Analysed</th>
                </tr>
              </thead>
              <tbody>
                {[...targets]
                  .sort((a, b) => (a.screenRank ?? 999) - (b.screenRank ?? 999))
                  .map((t) => (
                    <tr key={t.targetId} className="border-b border-line last:border-0">
                      <td className="num px-2 py-1.5 text-ink-2">{t.screenRank ?? '–'}</td>
                      <td className="px-2 py-1.5">{t.name}</td>
                      <td className="num px-2 py-1.5 text-right">{f2(t.forwardAffinity)}</td>
                      <td className="num px-2 py-1.5 text-right text-ink-2">{f2(t.popularity)}</td>
                      <td className="px-2 py-1.5 text-ink-2">{OWNERSHIP[String(t.profile?.ownership ?? 'unknown')]}</td>
                      <td className="px-2 py-1.5 text-ink-2">{(run.state.shortlist ?? []).includes(t.targetId) ? 'yes' : t.why ?? ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {(run.state.unresolved ?? []).length > 0 && (
            <p className="mt-2 text-xs text-ink-2">Not in Qloo&rsquo;s brand catalogue: {(run.state.unresolved ?? []).map((u) => u.query).join(', ')}.</p>
          )}
          {(run.state.notes ?? []).map((n) => (
            <p key={n} className="mt-1 text-xs text-muted">
              {n}
            </p>
          ))}
        </details>
      )}

      {run.status === 'done' && (
        <details className="card p-4">
          <summary className="cursor-pointer font-bold">Run log</summary>
          <ol className="mt-2 space-y-1 text-sm text-ink-2">
            {events.map((e) => (
              <li key={e.seq}>{e.message}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
