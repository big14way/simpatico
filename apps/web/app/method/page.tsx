import Link from 'next/link';
import { DEAL_TYPE_LABELS, METRIC_KEYS, METRIC_LABELS, type DealType } from '@simpatico/core';
import { scoringConfig } from '@simpatico/engine';
import { getDeps } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

const CALLS: [string, string, string][] = [
  ['/search', 'query, types=urn:entity:brand', 'Resolve buyer, proxies and candidates. Ambiguous names become confirm chips.'],
  ['/v2/tags', 'filter.query, filter.tag.types=urn:tag:genre:brand', 'Category tags for discovery.'],
  ['/v2/insights', 'filter.type=urn:entity:brand, signal.interests.entities=buyer, filter.tags, filter.exclude.entities, filter.popularity.max, feature.explainability', 'Discover brands the buyer audience already over-indexes on.'],
  ['/v2/insights', 'filter.type=urn:entity:brand, signal.interests.entities=buyer, filter.results.entities=universe, feature.explainability', 'Stage-1 screen: forward affinity a for every candidate (one call), plus corporate profile (parent, positioning, competitors).'],
  ['/v2/insights', 'signal.interests.entities=target, filter.results.entities=buyer brands', 'Reverse affinity b (m1).'],
  ['/v2/insights', 'filter.type=urn:tag, filter.tag.types=music/media/place genres, take=50', 'Taste profiles (m2).'],
  ['/v2/insights', 'filter.type=artist|tv_show|movie|podcast, signal=buyer, take=25; then the same types with signal=target, filter.results.entities=buyer top 25', 'Cross-domain agreement (m3).'],
  ['/v2/insights', 'filter.type=urn:demographics, signal.interests.entities=buyer + shortlist', 'Age and gender over-index (m4), one call for everyone.'],
  ['/v2/insights', 'filter.type=urn:heatmap, filter.location.query=United States', 'Geographic footprint and white space (m5).'],
  ['/v2/trending', 'filter.type=urn:entity:brand, signal.interests.entities=one brand, filter.start_date, filter.end_date', 'Momentum (m6) for the buyer brands and every target.'],
  ['/v2/analysis/compare', 'a.signal.interests.entities=buyer, b.signal.interests.entities=target', 'Shared catalogue categories (context for the debate).'],
];

const FORMULAS: Record<string, string> = {
  m1: 'a = buyer audience → target affinity; b = mean target audience → buyer-brand affinity; m1 = 2ab / (a + b). The harmonic mean punishes one-sided love.',
  m2: 'Weighted Jaccard Σ min(w) / Σ max(w) over both top-50 cultural tag profiles. Qloo’s tag affinities cluster at 0.98–1.00, so each tag is weighted by its position (top tag 1, 50th 0.02).',
  m3: 'For music, TV, film and podcasts: the mean affinity of the target’s audience for the buyer audience’s top-25 titles; m3 = mean over domains. Shows the titles both audiences embrace and the ones they don’t.',
  m4: 'Cosine of the age × gender over-index vectors (already centred), mapped to [0, 1] by (cos + 1) / 2.',
  m5: 'Heatmap cells summarised into 55 US metros (popularity-weighted affinity rank), minus the cohort mean per metro, then correlated: (r + 1) / 2. White space = metros in the target’s top quartile and the buyer’s bottom half.',
  m6: '−log10(trending rank) per week, minus the cohort median that week; z = (mean last 4 weeks − mean prior 8) / sd(prior 8), clipped to ±3; m6 = (z + 3) / 6. A window where nothing moved is “not measured”, never neutral.',
};

export default async function MethodPage() {
  const cfg = await scoringConfig(await getDeps());
  return (
    <div className="max-w-4xl space-y-8 text-sm leading-relaxed">
      <section className="space-y-2">
        <h1 className="text-2xl font-bold">How Simpatico scores</h1>
        <p className="text-ink-2">
          Every number is computed in code from logged Qloo responses. Models argue and write; they never set a score or a verdict. Without Qloo, Simpatico refuses to score
          (&ldquo;Simpatico doesn&rsquo;t guess. Connect Qloo.&rdquo;).
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Resolve every name to a Qloo brand entity; ambiguous ones wait for a human.</li>
          <li>Optionally discover candidates the buyer&rsquo;s audience already over-indexes on.</li>
          <li>Screen the whole universe with one rank call; keep the top k (plus pinned brands).</li>
          <li>Analyse the shortlist on six metrics (about nine Qloo calls per target).</li>
          <li>Score in code: composite F, coverage, red flags, verdict.</li>
          <li>Bull and bear agents argue from the same evidence pack; a code judge validates every citation.</li>
          <li>Write the IC memo; a number checker blocks any figure not in the ledger.</li>
          <li>Act: pipeline board, approval-gated outreach, weekly monitor with alerts.</li>
        </ol>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Qloo calls</h2>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-3 py-2">Endpoint</th>
                <th className="px-3 py-2">Key parameters</th>
                <th className="px-3 py-2">What Simpatico derives</th>
              </tr>
            </thead>
            <tbody>
              {CALLS.map(([e, p, d], i) => (
                <tr key={i} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{e}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-2">{p}</td>
                  <td className="px-3 py-2">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          REST against the hackathon host with the X-Api-Key header. Calls are rate-limited (4/s, 4 in flight), retried on 429/5xx/network errors with jittered backoff, and never
          replaced by a guess. Every call writes an evidence row; responses are cached privately on the server (24 h; 6 h for trending).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">The six metrics</h2>
        <dl className="space-y-2">
          {METRIC_KEYS.map((k) => (
            <div key={k}>
              <dt className="font-semibold">
                {k} {METRIC_LABELS[k]}
              </dt>
              <dd className="text-ink-2">{FORMULAS[k]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Composite, coverage and verdicts</h2>
        <p>
          F = 100 × Σ w·c·x / Σ w·c, where c is coverage (1 measured, 0.5 partial, 0 not measured). Unmeasured metrics drop out instead of counting as zero. If Σ w·c &lt;{' '}
          {cfg.bands.minCoverage}, the verdict is INSUFFICIENT_COVERAGE and there is no score.
        </p>
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="px-3 py-2">Weights</th>
                {METRIC_KEYS.map((k) => (
                  <th key={k} className="px-2 py-2 text-right">
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(cfg.weights) as DealType[]).map((d) => (
                <tr key={d} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5">{DEAL_TYPE_LABELS[d]}</td>
                  {METRIC_KEYS.map((k) => (
                    <td key={k} className="num px-2 py-1.5 text-right">
                      {cfg.weights[d][k].toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="list-disc space-y-1 pl-5">
          <li>ADVANCE: F ≥ {cfg.bands.advanceMin} and no red flag.</li>
          <li>
            WATCH: F ≥ {cfg.bands.watchMin}, with no flag or exactly one FADING / NO_GEO_OVERLAP flag mitigated by a validated bull claim.
          </li>
          <li>PASS: anything else.</li>
        </ul>
        <p className="font-semibold">Red flags (code rules)</p>
        <ul className="list-disc space-y-1 pl-5 text-ink-2">
          <li>AUDIENCE_ONE_SIDED: min(a, b) / max(a, b) &lt; {cfg.flags.oneSidedRatio}</li>
          <li>
            TASTE_CLASH: more than {Math.round(cfg.flags.tasteMissingShare * 100)}% of the buyer&rsquo;s top-20 tags missing from the target&rsquo;s top 50, and m2 &lt; {cfg.flags.tasteOverlapMax}
          </li>
          <li>DEMOGRAPHIC_MISMATCH: m4 &lt; {cfg.flags.demographicMin}</li>
          <li>FADING: momentum z &lt; {cfg.flags.fadingZ}</li>
          <li>NO_GEO_OVERLAP: m5 &lt; {cfg.flags.geoMin} (licensing only)</li>
        </ul>
        <p className="text-xs text-muted">
          Editable on the <Link href="/settings">settings</Link> page.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Debate and the code judge</h2>
        <p>
          Bull and bear get the same evidence pack (metric rows with ids such as <code>t3-m1</code>, the composite, the code&rsquo;s flags and Qloo&rsquo;s entity profile) and nothing else:
          no web search. Each writes up to five claims, and each claim cites numbers as <code>evidenceId.path = value</code>. The judge rejects a claim when the evidence id is not in
          this target&rsquo;s ledger, the path does not resolve to a number, the value differs by more than 0.01, a strength is cited below the shortlist average (or a weakness
          above it), or a flag is invented. A shortlist average may be cited too, checked the same way, but only next to one of the target&rsquo;s own values. Each side is
          given the code&rsquo;s reading of every compared value (strength, weakness or average) and only the flags the code raised, so it doesn&rsquo;t have to guess.
          Rejected claims stay visible with the reason. Validated bear claims become diligence questions.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Memo checks</h2>
        <p>
          Every number in a memo must match a ledger value (to the precision written, or as a percentage) or be a small rank or count. Unmatched numbers are highlighted and the memo
          cannot be exported. A language guard rejects causal or individual-level wording (&ldquo;will buy&rdquo;, &ldquo;customers will&rdquo;, &ldquo;causes&rdquo;,
          &ldquo;probability that a person&rdquo;). An LLM memo gets one repair pass; without an LLM, memos are written from the ledger template.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Actions and safety</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Outreach is drafted for ADVANCE targets and sends only after a human approves it. The approval is bound to the recipient, subject and SHA-256 of the body; any edit voids it.</li>
          <li>Sandbox mode is forced on in production: every email goes to the builder&rsquo;s inbox and names the intended recipient, who is never contacted.</li>
          <li>The monitor re-scores watched deals weekly (signed GitHub Actions cron) and alerts on rank moves, momentum crossings and verdict changes.</li>
          <li>Only brand and cultural-entity names and ids go to Qloo: no personal data. Outreach recipients never go to Qloo.</li>
          <li>Results are aggregate audience affinities, not predictions about individuals and not causal claims.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Known limitations</h2>
        <ul className="list-disc space-y-1 pl-5 text-ink-2">
          <li>
            Qloo&rsquo;s /v2/trending series on the hackathon dataset has not moved since mid-October 2025, and earlier history has universe-wide rank shifts. Momentum is therefore
            cohort-relative and reported as not measured for flat windows; the monitor&rsquo;s historical replay uses 2024 history.
          </li>
          <li>/v2/analysis/compare compares catalogue tags, not audiences, so cross-domain agreement (m3) is built from cross-rank calls instead.</li>
          <li>Qloo&rsquo;s graph is today&rsquo;s graph: any back-test (e.g. brands PepsiCo has since bought) is look-ahead biased. It is a sanity check, not a prediction.</li>
          <li>Small or new brands can have thin coverage; Simpatico reports that instead of guessing.</li>
          <li>Verdict bands were set once from the pooled score distribution of the showcase screens, not tuned per scenario.</li>
          <li>Geographic footprint covers 55 US metros. Not investment advice.</li>
        </ul>
      </section>
    </div>
  );
}
