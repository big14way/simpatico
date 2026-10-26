import Link from 'next/link';
import { notFound } from 'next/navigation';
import { METRIC_KEYS, METRIC_LABELS, type MetricKey } from '@simpatico/core';
import type { ClaimRecord } from '@simpatico/store';
import { DemographicsChart } from '@/components/DemographicsChart';
import { MemoView } from '@/components/MemoView';
import { MetricMeter } from '@/components/MetricMeter';
import { MetroMap, type MetroPoint } from '@/components/MetroMap';
import { Provenance } from '@/components/Provenance';
import { Sparkline } from '@/components/Sparkline';
import { VerdictBadge } from '@/components/VerdictBadge';
import { loadDealRoom } from '@/lib/data';
import { dealTypeLabel, f1, f2, num, pct, tidyNumbers } from '@/lib/format';

export const dynamic = 'force-dynamic';

const HINTS: Record<MetricKey, string> = {
  m1: 'Harmonic mean of the buyer audience’s affinity for the target and the target audience’s affinity for the buyer’s brands.',
  m2: 'Rank-weighted overlap of the two audiences’ top-50 cultural taste tags.',
  m3: 'How strongly the target’s audience embraces the buyer audience’s favourite artists, shows, films and podcasts.',
  m4: 'Similarity of the two audiences’ age and gender over-index profiles.',
  m5: 'Correlation of metro-level audience affinity, relative to the screened cohort.',
  m6: 'Trending rank change over the last 4 weeks vs the 8 before, relative to the cohort.',
};

type Named = { name: string; affinity?: number; score?: number | null };
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function ClaimCard({ c }: { c: ClaimRecord }) {
  return (
    <li className={`rounded-lg border p-3 text-sm ${c.accepted ? 'border-line bg-surface' : 'border-dashed border-critical bg-surface-2'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={c.accepted ? 'text-ink' : 'text-ink-2'}>{tidyNumbers(c.text)}</p>
        {c.flag && <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] font-semibold">{c.flag}</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {c.cites.map((x, i) => (
          <code key={i} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2" title={`${x.evidenceId}.${x.path} = ${x.value}`}>
            {x.evidenceId}.{x.path} = {num(x.value)}
          </code>
        ))}
      </div>
      {!c.accepted && <p className="mt-1.5 text-xs font-semibold text-critical">Rejected by the judge: {c.reason}</p>}
    </li>
  );
}

export default async function DealRoomPage({ params }: { params: Promise<{ id: string; targetId: string }> }) {
  const { id, targetId } = await params;
  const room = await loadDealRoom(id, targetId);
  if (!room) notFound();
  const { run, target: t, metrics, flags, rows, claims, memo, qloo, rank, shortlistSize } = room;
  const buyerName = run.state.buyer?.name ?? run.mandate.buyer.name;
  const comp = (t.composite ?? {}) as { contributions?: { key: MetricKey; weight: number; points: number; coverage: number }[] };
  const avg = (k: MetricKey) => {
    const r = rows.find((x) => x.metric === k);
    return r?.ref?.value ?? null;
  };
  const p = t.profile ?? {};
  const bull = claims.filter((c) => c.side === 'bull');
  const bear = claims.filter((c) => c.side === 'bear');
  const rejected = claims.filter((c) => !c.accepted).length;
  const m2 = metrics?.m2.data ?? {};
  const m3 = metrics?.m3.data ?? {};
  const m4 = metrics?.m4.data ?? {};
  const m5 = metrics?.m5.data ?? {};
  const m6 = metrics?.m6.data ?? {};
  const perMetro = arr<MetroPoint>(m5.perMetro);
  const whiteSpace = arr<{ metro: string }>(m5.whiteSpace).map((w) => w.metro);
  const strongholds = arr<{ metro: string }>(m5.strongholds).map((w) => w.metro);

  return (
    <div className="space-y-6">
      <nav className="text-sm">
        <Link href={`/runs/${run.id}`}>&larr; {run.mandate.title ?? 'Screen'}</Link>
      </nav>

      <header className="card flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="space-y-1">
          <p className="label">
            {dealTypeLabel(run.mandate.dealType)} · {buyerName} &rarr; target #{rank} of {shortlistSize}
          </p>
          <h1 className="text-2xl font-bold">{t.name}</h1>
          {typeof p.marketPositioning === 'string' && <p className="max-w-2xl text-sm text-ink-2">{p.marketPositioning}</p>}
          <p className="text-xs text-muted">
            {[
              typeof p.foundedYear === 'number' ? `Founded ${p.foundedYear}` : null,
              typeof p.ultimateParent === 'string' ? `Parent: ${p.ultimateParent}` : null,
              arr<string>(p.competitorBrands).length ? `Competes with ${arr<string>(p.competitorBrands).slice(0, 4).join(', ')}` : null,
              arr<string>(p.knownPartnerships).length ? `Partnerships: ${arr<string>(p.knownPartnerships).slice(0, 3).join(', ')}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="text-xs text-muted">Corporate details are Qloo entity data.</p>
        </div>
        <div className="space-y-2 text-right">
          <VerdictBadge verdict={t.verdict} size="lg" />
          <div>
            <span className="text-3xl font-bold">{f1(t.score)}</span>
            <span className="ml-1 text-sm text-muted">F / 100</span>
          </div>
          <div className="text-xs text-muted">{pct(t.coverage)} of the weighted evidence measured</div>
        </div>
      </header>

      <section className="card p-4">
        <h2 className="font-bold">Why this verdict</h2>
        <p className="text-sm">{t.why}</p>
        {flags.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {flags.map((f) => (
              <li key={f.flag}>
                <span className="font-semibold">{f.flag}</span>: {f.rule}{' '}
                <span className="text-ink-2">
                  (observed {Object.entries(f.observed).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => `${k} ${f2(v)}`).join(', ')})
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Scores, flags and verdicts are computed in code. The agents can only argue with the ledger; they never set the score.</p>
      </section>

      {metrics && (
        <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="card p-4">
            <h2 className="font-bold">Six audience metrics</h2>
            <p className="text-xs text-muted">Bar = this target; tick = shortlist average.</p>
            {METRIC_KEYS.map((k) => (
              <MetricMeter key={k} label={`${k} ${METRIC_LABELS[k]}`} value={metrics[k].value} coverage={metrics[k].coverage} average={avg(k)} note={metrics[k].note} hint={HINTS[k]} />
            ))}
          </div>
          <div className="card p-4">
            <h2 className="font-bold">How F is built</h2>
            <p className="text-xs text-muted">Points each metric adds (weights for {dealTypeLabel(run.mandate.dealType)}, renormalised over what Qloo could measure).</p>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1">Metric</th>
                  <th className="py-1 text-right">Weight</th>
                  <th className="py-1 text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {(comp.contributions ?? []).map((c) => (
                  <tr key={c.key} className="border-b border-line last:border-0">
                    <td className="py-1">{METRIC_LABELS[c.key]}</td>
                    <td className="num py-1 text-right text-ink-2">{c.coverage > 0 ? c.weight.toFixed(2) : 'not measured'}</td>
                    <td className="num py-1 text-right font-semibold">{c.coverage > 0 ? c.points.toFixed(1) : '–'}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-1 font-semibold">F</td>
                  <td />
                  <td className="num py-1 text-right font-bold">{f1(t.score)}</td>
                </tr>
              </tbody>
            </table>
            {arr<Named>(p.drivers).length > 0 && (
              <p className="mt-3 text-xs text-ink-2">
                Qloo explainability: the buyer-side signals driving the forward affinity are{' '}
                {arr<Named>(p.drivers).map((d) => `${d.name} (${f2(d.score)})`).join(', ')}.
              </p>
            )}
            {arr<Named>(p.sharedCategories).length > 0 && (
              <p className="mt-1 text-xs text-ink-2">Shared catalogue categories (Qloo compare): {arr<Named>(p.sharedCategories).map((c) => c.name).join(', ')}.</p>
            )}
          </div>
        </section>
      )}

      {metrics && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <h2 className="font-bold">Where the audiences meet, across culture</h2>
            <p className="text-xs text-muted">The buyer audience&rsquo;s top titles in each domain, ranked by how strongly {t.name}&rsquo;s audience embraces them.</p>
            <div className="mt-2 space-y-3">
              {arr<{ label: string; score: number | null; shared: Named[]; clash: Named[] }>(m3.domains).map((d) => (
                <div key={d.label} className="text-sm">
                  <div className="flex justify-between">
                    <span className="font-semibold">{d.label}</span>
                    <span className="num text-ink-2">{d.score === null ? 'not measured' : f2(d.score)}</span>
                  </div>
                  {d.score !== null && (
                    <div className="text-xs text-ink-2">
                      Embraced: {d.shared.map((s) => s.name).join(', ')} · Least shared: {d.clash.map((s) => s.name).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="card p-4">
            <h2 className="font-bold">Taste profile overlap</h2>
            {metrics.m2.coverage === 0 ? (
              <p className="text-sm text-muted">{metrics.m2.note}</p>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-xs text-muted">
                  {String(m2.sharedCount ?? 0)} of {String(m2.unionCount ?? 0)} top taste tags shared.
                </p>
                <div>
                  <div className="label">Both over-index on</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {arr<Named>(m2.shared).map((x) => (
                      <span key={x.name} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                        {x.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="label">Buyer only</div>
                    <p className="text-xs text-ink-2">{arr<Named>(m2.buyerOnly).map((x) => x.name).join(', ') || 'none'}</p>
                  </div>
                  <div>
                    <div className="label">{t.name} only</div>
                    <p className="text-xs text-ink-2">{arr<Named>(m2.targetOnly).map((x) => x.name).join(', ') || 'none'}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {metrics && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <h2 className="font-bold">Audience shape</h2>
            {metrics.m4.coverage === 0 ? (
              <p className="text-sm text-muted">{metrics.m4.note}</p>
            ) : (
              <DemographicsChart buyer={(m4.buyer ?? {}) as Record<string, number>} target={(m4.target ?? {}) as Record<string, number>} buyerName={buyerName} targetName={t.name} />
            )}
          </div>
          <div className="card p-4">
            <h2 className="font-bold">Momentum</h2>
            {metrics.m6.coverage === 0 ? (
              <p className="text-sm text-ink-2">{metrics.m6.note}</p>
            ) : (
              <>
                <p className="text-sm">
                  z = <span className="num font-semibold">{f2(m6.z)}</span> relative to the screened cohort ({run.state.asOf}).
                </p>
                <Sparkline weeks={arr(m6.weeks)} z={typeof m6.z === 'number' ? m6.z : null} />
              </>
            )}
          </div>
        </section>
      )}

      {metrics && metrics.m5.coverage > 0 && (
        <section className="card space-y-3 p-4">
          <h2 className="font-bold">Footprint overlap for distribution</h2>
          <MetroMap points={perMetro} whiteSpace={whiteSpace} strongholds={strongholds} targetName={t.name} />
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <div className="label">White space</div>
              <p className="text-ink-2">{whiteSpace.join(', ') || 'none'}</p>
            </div>
            <div>
              <div className="label">Shared strongholds</div>
              <p className="text-ink-2">{strongholds.join(', ') || 'none'}</p>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">Bull vs bear</h2>
          <span className="text-sm text-ink-2">
            {claims.length === 0
              ? 'No debate on this run.'
              : `${claims.length - rejected} of ${claims.length} claims survived the judge; ${rejected} rejected for citing numbers not in the ledger or misreading them.`}
          </span>
        </div>
        {claims.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="label mb-2">Bull: for the deal</h3>
              <ul className="space-y-2">{bull.map((c) => <ClaimCard key={c.id} c={c} />)}</ul>
            </div>
            <div>
              <h3 className="label mb-2">Bear: against, or diligence first</h3>
              <ul className="space-y-2">{bear.map((c) => <ClaimCard key={c.id} c={c} />)}</ul>
            </div>
          </div>
        )}
      </section>

      {memo && (
        <section className="card p-4">
          <h2 className="mb-2 text-lg font-bold">IC memo</h2>
          <MemoView markdown={memo.markdown} checks={memo.checks} model={memo.model} filename={`simpatico-${t.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-memo.md`} />
        </section>
      )}

      <details className="card p-4">
        <summary className="cursor-pointer font-bold">Provenance: {qloo.length} Qloo calls behind this target</summary>
        <p className="mt-1 text-xs text-muted">Requests as sent (the API key travels in a header and is never logged). Responses are cached privately on the server.</p>
        <div className="mt-2">
          <Provenance
            rows={qloo.map((e) => ({ id: e.id, purpose: e.purpose, path: e.path, status: e.status, fromCache: e.fromCache, durationMs: e.durationMs, summary: e.summary, fetchedAt: e.fetchedAt }))}
          />
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">Evidence rows (what bull, bear and the judge see)</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded border border-line bg-surface-2 p-2 font-mono text-[11px] leading-snug">
            {JSON.stringify(
              rows.map((r) => ({ id: r.id, label: r.label, data: r.metric === 'm5' || r.metric === 'm6' ? { ...r.data, perMetro: undefined, weeks: undefined } : r.data, shortlistAverages: r.ref })),
              null,
              1,
            )}
          </pre>
        </details>
      </details>
    </div>
  );
}
