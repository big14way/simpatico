# Simpatico

**An agentic deal desk for brand acquisitions, licensing and co-branding, built on Qloo's taste graph.**

> Every deal model has a spreadsheet for revenue. Nobody has one for whether the customers will get along. Simpatico does, and it shows its work.

- **Live demo:** https://simpatico-nine.vercel.app
- **Showcase screens:** [M&A bolt-on](https://simpatico-nine.vercel.app/scenarios/bfy-bolt-on) · [Licensing / co-brand](https://simpatico-nine.vercel.app/scenarios/dodgers-collab) · [VC thesis](https://simpatico-nine.vercel.app/scenarios/run-club-thesis)
- **How it scores:** https://simpatico-nine.vercel.app/method
- Built from scratch during the Qloo LLM Hackathon 2026 submission period. MIT licence.

## The problem

When a consumer company buys a brand, licenses one or co-brands with one, the model covers revenue, margins and synergies. Whether the two customer bases actually like each other, care about the same things, live in the same places and are heading the same way is left to gut feel. That is exactly what Qloo's taste graph measures, across music, film, TV, podcasts, places and brands.

## What Simpatico does

1. **Mandate.** You name a buyer (a brand plus a few flagship brands it owns), a deal type (M&A bolt-on, licensing / co-brand, or VC thesis) and a universe of candidate brands (pasted, CSV, or discovered by Qloo).
2. **Resolve.** Every name is resolved to a Qloo brand entity. Qloo's search returns no relevance score, so Simpatico decides from the names; anything ambiguous ("PepsiCo" → Pepsi?) becomes a confirm chip for a human. It never silently takes the first hit.
3. **Screen.** One Qloo rank call scores the whole universe for the buyer's audience; the top k (plus pinned brands) go to full analysis. Qloo's entity data also flags brands the buyer's parent already owns.
4. **Analyse.** About nine Qloo calls per target compute six audience-fit metrics **in code**: two-way affinity, taste-profile overlap, cross-domain agreement, demographics, geographic footprint and momentum.
5. **Debate.** A bull agent and a bear agent argue each target from the same evidence pack. A **code judge** checks every number they cite against the evidence ledger and rejects claims that don't match, misread the data or invent red flags. Rejected claims stay visible.
6. **Act.** Simpatico writes a number-checked IC memo, updates the pipeline board, drafts outreach that is only sent after a human approves it (sandboxed), and re-scores watched deals every week, alerting on rank moves, momentum shifts and verdict changes.

**Without Qloo it refuses to score anything.** With no key and nothing recorded, every scoring path throws `QlooRequiredError` and the UI says: *Simpatico doesn't guess. Connect Qloo.*

## How Qloo is used

All calls go to `https://hackathon.api.qloo.com` with the `X-Api-Key` header, through one rate-limited, retrying gateway that logs every call as an evidence row (the key is a header and is never logged).

| Endpoint | Key parameters | What Simpatico derives |
|---|---|---|
| `/search` | `query`, `types=urn:entity:brand` | Entity resolution and confirm chips |
| `/v2/tags` | `filter.query`, `filter.tag.types=urn:tag:genre:brand` | Category tags for discovery |
| `/v2/insights` | `filter.type=urn:entity:brand`, `signal.interests.entities=<buyer>`, `filter.tags`, `filter.exclude.entities`, `filter.popularity.max`, `feature.explainability` | Discovery: brands the buyer's audience already over-indexes on |
| `/v2/insights` | `signal.interests.entities=<buyer>`, `filter.results.entities=<universe>`, `feature.explainability` | Stage-1 screen: forward affinity *a* for every candidate in one call, plus corporate profile (parent, positioning, competitors, partnerships) |
| `/v2/insights` | `signal.interests.entities=<target>`, `filter.results.entities=<buyer brands>` | Reverse affinity *b* (m1) |
| `/v2/insights` | `filter.type=urn:tag`, `filter.tag.types=<music/media/place genres>`, `take=50` | Taste profiles (m2) |
| `/v2/insights` | `filter.type=artist / tv_show / movie / podcast`, buyer signal, `take=25`; then target signal with `filter.results.entities=<buyer's top 25>` | Cross-domain agreement (m3) |
| `/v2/insights` | `filter.type=urn:demographics`, buyer + shortlist in one call | Age × gender over-index (m4) |
| `/v2/insights` | `filter.type=urn:heatmap`, `filter.location.query=United States` | Metro footprint and white space (m5) |
| `/v2/trending` | `signal.interests.entities=<brand>`, `filter.start_date`, `filter.end_date` | Momentum (m6), per brand in the cohort |
| `/v2/analysis/compare` | `a.signal.interests.entities=<buyer>`, `b.signal.interests.entities=<target>` | Shared catalogue categories (debate context) |

A fresh screen of ~30 brands with a shortlist of 8–10 makes about 120–140 Qloo calls; cached re-runs make almost none. Responses are cached **privately on the server** (24 h, 6 h for trending); recorded showcase responses are pinned so the demo keeps working, and momentum uses the 24 weeks to 1 Oct 2025, the latest window in which Qloo's trending series moves, so a re-run sees the same evidence. No Qloo response data is stored in this repository.

### Request to result, one target

Buyer audience = Los Angeles Dodgers (one Qloo brand id). Universe = 25 apparel and streetwear labels (one ambiguous name was dropped at the confirm chip). Target = Mitchell & Ness.

1. `GET /v2/insights?filter.type=urn:entity:brand&signal.interests.entities=<Dodgers>&filter.results.entities=<25 universe ids>&feature.explainability=true` → Mitchell & Ness's forward affinity *a* = 0.80, fourth of 25 behind '47, New Era and Nike. The same response carries Qloo's corporate profile: founded 1904, parent Fanatics, competitors New Era, Starter, Champion and Nike.
2. `GET /v2/insights?filter.type=urn:entity:brand&signal.interests.entities=<Mitchell & Ness>&filter.results.entities=<Dodgers>` → reverse affinity *b* = 0.80, the same as *a*: between two single brands Qloo's affinity is symmetric, so the two-way check only adds information when the buyer audience is several brands. m1 = 2ab / (a + b) = 0.80.
3. Tag profiles give m2 = 0.35 (26 shared tags of 74). Cross-ranks of the Dodgers audience's top 25 titles give m3 = 0.89: music 0.94 (Curren$y, Cam'ron), TV 0.90 (Ballers, Brockmire), film 0.86 (Coach Carter, Glory Road), podcasts 0.84. One shared demographics call gives m4 = 0.91; two heatmaps give m5 = 0.33, with white space in Philadelphia, New York, Chicago, Memphis, Atlanta, Detroit, Cleveland and Baltimore. Trending has no history for the window, so m6 is not measured.
4. Code computes F = 68.5 with 95% of the weighted evidence measured and no red flags → **ADVANCE** (F ≥ 67), first of the 8 on the shortlist. The judge validates all 10 bull and bear claims, the memo passes the number check, and an outreach draft waits in the approval inbox.

Every step is visible in the deal room's provenance drawer.

## Scoring (code, never the model)

| # | Metric | Formula |
|---|---|---|
| m1 | Two-way audience affinity | *a* = buyer audience → target, *b* = mean target audience → buyer brands; m1 = 2ab/(a+b), so one-sided love scores low |
| m2 | Taste-profile overlap | Weighted Jaccard Σmin/Σmax over both top-50 cultural tag profiles. Qloo's tag affinities cluster at 0.98–1.00, so each tag is weighted by its position (top 1 → 50th 0.02) |
| m3 | Cross-domain agreement | For music, TV, film and podcasts: mean affinity of the target's audience for the buyer audience's top-25 titles; mean over domains |
| m4 | Demographic alignment | Cosine of the age × gender over-index vectors, (cos+1)/2 |
| m5 | Geographic footprint | Heatmap cells summarised into 55 US metros, minus the cohort mean per metro, then correlated: (r+1)/2. White space = target top quartile, buyer bottom half |
| m6 | Momentum | −log10(trending rank) per week minus the cohort median; z = (last 4 weeks − prior 8)/sd(prior 8), clipped ±3; (z+3)/6. A window where nothing moved is "not measured", never neutral |

**Composite** F = 100 · Σ w·c·x / Σ w·c with coverage c ∈ {1, 0.5, 0}; unmeasured metrics drop out rather than counting as zero. Below 60% weighted coverage there is **no score** (INSUFFICIENT_COVERAGE). Weights by deal type:

| Deal type | m1 | m2 | m3 | m4 | m5 | m6 |
|---|---|---|---|---|---|---|
| M&A bolt-on | .30 | .20 | .15 | .15 | .10 | .10 |
| Licensing / co-brand | .35 | .10 | .20 | .10 | .20 | .05 |
| VC thesis | .25 | .15 | .10 | .10 | .10 | .30 |

**Red flags** (code rules): AUDIENCE_ONE_SIDED (min(a,b)/max(a,b) < 0.4), TASTE_CLASH (>50% of the buyer's top-20 tags missing and m2 < 0.15), DEMOGRAPHIC_MISMATCH (m4 < 0.35), FADING (z < −1.5), NO_GEO_OVERLAP (m5 < 0.2, licensing only).

**Verdicts:** ADVANCE when F ≥ 67 and no red flag; WATCH when F ≥ 62 with no flag, or exactly one FADING / NO_GEO_OVERLAP flag mitigated by a validated bull claim; otherwise PASS. The bands were calibrated once from the pooled F distribution of the three showcase screens (70th and 40th percentiles of 26 targets), not per scenario. Everything is editable on the settings page.

**The judge** rejects a bull or bear claim when its evidence id isn't in this target's ledger, the cited path doesn't resolve to a number, the value is off by more than 0.01, a strength is cited below the shortlist average (or a weakness above it), or a flag is invented. **The memo checker** blocks export while any number in the memo is missing from the ledger, and a language guard rejects causal or individual-level wording ("will buy", "customers will", "causes").

## Proof that Qloo is load-bearing

The `/ablation` page runs any finished screen four ways and reports Kendall τ against the full model, top-5 overlap, verdict flips and fame bias (Spearman between a ranking and Qloo popularity):

| Variant | What changes |
|---|---|
| Full | everything |
| No Qloo (LLM-only) | the same model ranks the same universe from general knowledge |
| Qloo minus cross-domain | m3 removed |
| Qloo minus two-way | m1 uses forward affinity only, so the one-sided flag can't fire |

The LLM-only variant also cannot produce white space, demographics or momentum, and cannot check its own claims.

Results on the three showcase screens (Claude Opus 5.5 at low effort, 26 Oct 2026):

| | Better-for-you bolt-on | Dodgers licensing | Run-club thesis |
|---|---|---|---|
| Universe | 29 brands | 25 brands | 23 brands |
| Kendall τ, LLM-only vs Qloo forward affinity (whole universe) | −0.02 | 0.46 | 0.56 |
| Top-5 overlap, same comparison | 0 of 5 | 4 of 5 | 3 of 5 |
| Kendall τ, LLM-only vs full model (shortlist) | −0.06 | 0.64 | 0.05 |
| Verdicts that change without cross-domain (m3) | 2 | 5, incl. the only ADVANCE | 5, incl. 3 ADVANCE |
| Verdicts that change without two-way affinity | 0 | 0 | 0 |

Where the fit is famous (MLB's existing licensees), general knowledge lands close to Qloo's audience data; where it isn't (better-for-you brands against the PepsiCo audience), the LLM-only ranking is unrelated to it. Cross-domain agreement is the metric that moves verdicts. The two-way check changed no ranking or verdict on these three screens: for the Dodgers' single-brand audience it equals forward affinity (Qloo's pairwise affinity is symmetric), and on the two multi-brand screens no target was one-sided. Fame bias did not separate the two approaches here (Spearman with Qloo popularity, Qloo vs LLM-only: 0.17 vs −0.17, 0.48 vs 0.01, −0.28 vs −0.40).

## Actions and safety

- **Approval-gated outreach.** Drafts are created for ADVANCE targets; nothing sends until a human approves it. The approval is bound to the draft, recipient, subject and SHA-256 of the body; any edit voids it. Sandbox mode is forced on in production, so every email goes to the builder's inbox and names the intended recipient, who is never contacted.
- **Weekly monitor.** A signed GitHub Actions cron calls `/api/jobs/rescore` (HMAC-SHA256 over timestamp and body). "Run monitor now" and a historical replay over Qloo's trending history are on the monitor page.
- **Safe use.** Only brand and cultural-entity names and ids go to Qloo; no personal data, and outreach recipients never do. Results are aggregate audience affinities, never claims about individuals or causation. Not investment advice. Showcase scenarios are illustrative public-data examples and make no claim about any company's plans.

## Known limitations

- Qloo's `/v2/trending` series on the hackathon dataset has not moved since mid-October 2025, and earlier history has universe-wide rank shifts. Momentum is therefore measured relative to the screened cohort, defaults to the window ending 1 Oct 2025 (a later as-of date reports it as *not measured*), and the weekly monitor's live momentum alerts can't fire until the series moves again; its historical replay uses 2024–2025 history.
- `/v2/analysis/compare` compares catalogue tags rather than audiences, so cross-domain agreement is built from cross-rank calls.
- Between two single brands Qloo's affinity is symmetric (the reverse call returns the forward value), so two-way affinity only differs from forward affinity when the buyer audience is several brands. That is why removing it changed nothing in the ablation above.
- Qloo's graph is today's graph. The M&A showcase pins two brands PepsiCo has since agreed to buy (Siete, announced Oct 2024; poppi, Mar 2025) as a sanity check; that is look-ahead biased, not a prediction.
- Small or new brands can have thin coverage; Simpatico reports that instead of guessing. Geographic footprint covers 55 US metros.

## Architecture

```
apps/web            Next.js 16 app: UI, API routes, server-sent run progress
packages/qloo       Qloo gateway: REST transport, private cache, evidence ledger, limiter, retries
packages/core       metrics, composite, red flags, verdicts, judge, memo number checker (pure, tested)
packages/store      Postgres (Neon) or embedded PGlite: runs, evidence, claims, memos, pipeline, outreach, alerts
packages/engine     the run pipeline, monitor and ablation
packages/agents     Claude agents: bull, bear, memo writer, outreach drafter, no-Qloo ranker
packages/actions    approvals, sandboxed email (Resend), Slack alerts
```

The agents use the Anthropic TypeScript SDK on `claude-opus-5-5` with structured outputs and server-side refusal fallbacks. The live demo runs them at `LLM_EFFORT=low`: on a real evidence pack, one target's bull and bear cost about $0.09 at low effort against $0.13 at high, and the code judge accepted all ten claims either way. Answers are stored in Postgres keyed by a hash of model, effort, prompts and output schema, so re-running a showcase replays the same debate without another model call; the judge and the memo number checker still run on every replay, and the run log and memo say when an answer was stored. Without `ANTHROPIC_API_KEY` the debate is skipped and memos are written from a ledger template.

**Hosting.** The live demo runs on Vercel (functions pinned to `cle1`, next to the Neon Postgres database in us-east-2). Serverless functions stop at 300 seconds, so a screen runs in budgeted slices: each worker holds a database lease, stops between stages (and between targets in the debate and memo stages) when its budget is spent, and hands the rest to a fresh invocation through a signed internal call; a stalled run restarts when someone views it. The same app also runs as one long-lived container (`Dockerfile`, built in CI), where none of that is needed.

## Run it locally

Requires Node 22+ and pnpm 10.

```bash
git clone https://github.com/big14way/simpatico && cd simpatico
pnpm install
cp .env.example .env          # add QLOO_API_KEY (and optionally ANTHROPIC_API_KEY, DATABASE_URL)
ln -s ../../.env apps/web/.env
pnpm test                     # 131 unit and integration tests, no network needed
pnpm dev                      # http://localhost:3000
```

Without `DATABASE_URL` an embedded PGlite database is created in `.data/`. `pnpm tsx scripts/run-scenario.ts bfy-bolt-on --auto-confirm` runs a showcase screen from the command line.

## Licence

MIT. See [LICENSE](LICENSE).
