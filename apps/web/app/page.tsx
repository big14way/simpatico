import Link from 'next/link';
import { SCENARIOS } from '@simpatico/engine';
import { StartScenario } from '@/components/StartScenario';
import { VerdictBadge } from '@/components/VerdictBadge';
import { dealTypeLabel, day, when } from '@/lib/format';
import { demoMode, getDeps, qlooConfigured } from '@/lib/runtime';
import type { Run } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function Desk() {
  const deps = await getDeps();
  const [runsRaw, cache] = await Promise.all([deps.store.runs.list(25), deps.store.cache.stats()]);
  const runs = runsRaw as Run[];
  const latest = new Map<string, Run>();
  for (const r of runs) if (r.scenario && r.status === 'done' && !latest.has(r.scenario)) latest.set(r.scenario, r);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="label">Brand M&amp;A · licensing · co-branding · VC theses</p>
        <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Every deal model has a spreadsheet for revenue. Nobody has one for whether the customers will get along.
        </h1>
        <p className="max-w-3xl text-ink-2">
          Simpatico screens a universe of brands against a buyer&rsquo;s audience using Qloo&rsquo;s taste graph, computes six audience-fit metrics in
          code, has a bull and a bear agent argue each target while a code judge rejects any claim the evidence ledger doesn&rsquo;t back, then
          writes the IC memo, updates the pipeline, drafts outreach for human approval and keeps watching. Without Qloo it refuses to score.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/mandate/new" className="btn">
            New mandate
          </Link>
          <Link href="/method" className="btn btn-ghost">
            How it scores
          </Link>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-label="System status">
          <li>Qloo: {qlooConfigured() ? 'connected' : 'not configured (replay only)'}</li>
          <li>Mode: {demoMode()}</li>
          <li>Agents: {deps.agents ? deps.agents.model : 'none (debate off, template memos)'}</li>
          <li>Recorded Qloo responses: {cache.pinned}</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Showcase screens</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {SCENARIOS.map((s) => {
            const run = latest.get(s.slug);
            const sum = run?.summary;
            return (
              <article key={s.slug} className="card flex flex-col gap-3 p-4">
                <div>
                  <div className="label">{dealTypeLabel(s.mandate.dealType)}</div>
                  <h3 className="mt-1 font-bold">{s.label}</h3>
                  <p className="mt-1 text-sm text-ink-2">{s.blurb}</p>
                </div>
                {sum ? (
                  <div className="space-y-2 text-sm">
                    <ol className="space-y-1">
                      {sum.topTargets.slice(0, 3).map((t, i) => (
                        <li key={t.id} className="flex items-center justify-between gap-2">
                          <span className="truncate">
                            {i + 1}. {t.name}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="num text-xs text-ink-2">{t.F === null ? 'n/a' : `F ${t.F.toFixed(1)}`}</span>
                            <VerdictBadge verdict={t.verdict} />
                          </span>
                        </li>
                      ))}
                    </ol>
                    <p className="text-xs text-muted">
                      Recorded {day(run!.createdAt)} from Qloo responses kept in the private server-side cache.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted">Not run yet on this deployment.</p>
                )}
                <div className="mt-auto flex flex-wrap gap-2">
                  {run && (
                    <Link href={`/runs/${run.id}`} className="btn">
                      Open deal desk
                    </Link>
                  )}
                  {qlooConfigured() && <StartScenario slug={s.slug} label={run ? 'Re-run live' : 'Run live'} />}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Recent screens</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted">No runs yet. Start with a showcase screen or a new mandate.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-3 py-2 font-semibold">Screen</th>
                  <th className="px-3 py-2 font-semibold">Deal type</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/runs/${r.id}`}>{r.mandate.title ?? `${r.mandate.buyer.name} screen`}</Link>
                    </td>
                    <td className="px-3 py-2 text-ink-2">{dealTypeLabel(r.mandate.dealType)}</td>
                    <td className="px-3 py-2 text-ink-2">{r.status === 'running' ? `running: ${r.stage}` : r.status.replace('_', ' ')}</td>
                    <td className="num px-3 py-2 text-ink-2">{when(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
