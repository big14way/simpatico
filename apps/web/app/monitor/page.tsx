import Link from 'next/link';
import { MonitorPanel } from '@/components/MonitorPanel';
import { VerdictBadge } from '@/components/VerdictBadge';
import { f1, when } from '@/lib/format';
import { getDeps, qlooConfigured } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export default async function MonitorPage() {
  const deps = await getDeps();
  const deals = (await deps.store.pipeline.list()).filter((d) => d.monitored);
  const runs = await deps.store.monitor.listRuns(15);
  const alerts = await deps.store.monitor.listAlerts(40);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Monitor</h1>
        <p className="text-sm text-ink-2">
          ADVANCE and WATCH deals are re-scored every Monday 06:00 UTC by a signed GitHub Actions job.{' '}
          {deps.notifier ? 'Alerts go to Slack and appear below.' : 'Slack is not configured here; alerts appear below.'}
        </p>
      </div>
      {qlooConfigured() ? <MonitorPanel today={today} /> : <p className="text-sm text-muted">Qloo is not configured on this deployment, so the monitor cannot run.</p>}

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Watched deals ({deals.length})</h2>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Buyer</th>
                <th className="px-3 py-2 text-right">F</th>
                <th className="px-3 py-2">Verdict</th>
                <th className="px-3 py-2 text-right">Momentum z</th>
                <th className="px-3 py-2">Last checked</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => {
                const s = d.lastSnapshot ?? {};
                return (
                  <tr key={d.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/runs/${d.lastRunId}/targets/${d.targetId}`}>{d.targetName}</Link>
                    </td>
                    <td className="px-3 py-2 text-ink-2">{d.buyerName}</td>
                    <td className="num px-3 py-2 text-right">{f1(d.score)}</td>
                    <td className="px-3 py-2">
                      <VerdictBadge verdict={d.verdict} />
                    </td>
                    <td className="num px-3 py-2 text-right text-ink-2">{typeof s.momentumZ === 'number' ? s.momentumZ.toFixed(2) : 'n/a'}</td>
                    <td className="num px-3 py-2 text-ink-2">{typeof s.at === 'string' ? when(s.at) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-lg font-bold">Alerts</h2>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted">No alerts yet.</p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a) => (
                <li key={a.id} className="card p-3 text-sm">
                  <div className="flex justify-between gap-2 text-xs text-muted">
                    <span>{a.kind.replace('_', ' ')}</span>
                    <span>{when(a.createdAt)}</span>
                  </div>
                  <p>{a.message}</p>
                  <p className="text-xs text-muted">Delivery: {a.delivery ? Object.entries(a.delivery).map(([k, v]) => `${k} ${String(v)}`).join(', ') : 'pending'}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-bold">Monitor runs</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-muted">The monitor has not run yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex justify-between gap-2 border-b border-line py-1">
                  <span>
                    {r.trigger} · as of {r.asOf}
                  </span>
                  <span className="text-ink-2">
                    {r.status === 'done' ? `${String(r.summary?.deals ?? 0)} deals, ${String(r.summary?.alerts ?? 0)} alerts` : r.status}
                    {r.error ? `: ${r.error}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
