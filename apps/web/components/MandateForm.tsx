'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type DealType = 'ma_bolt_on' | 'licensing' | 'vc_thesis';
interface Example {
  slug: string;
  label: string;
  mandate: {
    title?: string;
    dealType: DealType;
    buyer: { name: string };
    proxies?: { name: string }[];
    universe?: { name: string; pin?: boolean }[];
    excludeOwned?: boolean;
    shortlistSize?: number;
  };
}

const DEAL_TYPES: { id: DealType; label: string; blurb: string }[] = [
  { id: 'ma_bolt_on', label: 'M&A bolt-on', blurb: 'Two-way affinity and taste overlap weigh most.' },
  { id: 'licensing', label: 'Licensing / co-brand', blurb: 'Cross-domain culture and geographic footprint weigh more.' },
  { id: 'vc_thesis', label: 'VC thesis', blurb: 'Momentum carries 30% of the score.' },
];

const splitNames = (s: string) =>
  [...new Set(s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean))];

export function MandateForm({ examples, qlooReady }: { examples: Example[]; qlooReady: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [dealType, setDealType] = useState<DealType>('ma_bolt_on');
  const [buyer, setBuyer] = useState('');
  const [proxies, setProxies] = useState('');
  const [universe, setUniverse] = useState('');
  const [pinned, setPinned] = useState<string[]>([]);
  const [discover, setDiscover] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [tagHits, setTagHits] = useState<{ id: string; name: string }[]>([]);
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);
  const [popMax, setPopMax] = useState('');
  const [take, setTake] = useState(15);
  const [shortlistSize, setShortlistSize] = useState(8);
  const [excludeOwned, setExcludeOwned] = useState(true);
  // null = follow the deal type (skip group-owned brands for M&A and VC, keep them for licensing)
  const [excludeGroup, setExcludeGroup] = useState<boolean | null>(null);
  const groupDefault = dealType !== 'licensing';
  const [asOf, setAsOf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const universeNames = splitNames(universe);
  const proxyNames = splitNames(proxies);

  function load(ex: Example) {
    const m = ex.mandate;
    setTitle(m.title ?? '');
    setDealType(m.dealType);
    setBuyer(m.buyer.name);
    setProxies((m.proxies ?? []).map((p) => p.name).join('\n'));
    setUniverse((m.universe ?? []).map((u) => u.name).join('\n'));
    setPinned((m.universe ?? []).filter((u) => u.pin).map((u) => u.name));
    setExcludeOwned(m.excludeOwned ?? true);
    setExcludeGroup(null);
    setShortlistSize(m.shortlistSize ?? 8);
    setDiscover(false);
    setTags([]);
  }

  async function searchTags() {
    if (tagQuery.trim().length < 2) return;
    const res = await fetch(`/api/qloo/tags?q=${encodeURIComponent(tagQuery.trim())}`);
    const data = (await res.json()) as { tags?: { id: string; name: string }[]; error?: string };
    if (data.error) setError(data.error);
    setTagHits(data.tags ?? []);
  }

  async function onCsv(file: File) {
    const text = await file.text();
    const names = text
      .split(/\r?\n/)
      .map((line) => line.split(',')[0]!.replace(/^"|"$/g, '').trim())
      .filter((n, i) => n && !(i === 0 && /^(name|brand|company)$/i.test(n)));
    setUniverse([...new Set([...universeNames, ...names])].join('\n'));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!buyer.trim()) return setError('Name the buyer (a brand Qloo knows).');
    if (universeNames.length === 0 && !discover) return setError('Add candidate brands, or turn on Qloo discovery.');
    if (universeNames.length > 60) return setError('The universe is capped at 60 brands.');
    if (discover && tags.length === 0) return setError('Pick at least one category tag for discovery.');
    setBusy(true);
    const mandate = {
      title: title.trim() || undefined,
      dealType,
      buyer: { name: buyer.trim() },
      proxies: proxyNames.slice(0, 6).map((name) => ({ name })),
      universe: universeNames.map((name) => (pinned.includes(name) ? { name, pin: true } : { name })),
      discover: { enabled: discover, categoryTags: tags, popularityMax: popMax ? Number(popMax) : undefined, take },
      excludeOwned,
      excludeGroupOwned: excludeGroup ?? groupDefault,
      shortlistSize,
      momentumAsOf: asOf || undefined,
    };
    const res = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mandate }) });
    const data = (await res.json()) as { runId?: string; error?: string };
    if (data.runId) router.push(`/runs/${data.runId}`);
    else {
      setError(data.error ?? 'Could not start the screen.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Load an example:</span>
        {examples.map((ex) => (
          <button type="button" key={ex.slug} className="btn btn-ghost !py-1" onClick={() => load(ex)}>
            {ex.label}
          </button>
        ))}
      </div>

      <fieldset className="card space-y-3 p-4">
        <legend className="label px-1">Deal type</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {DEAL_TYPES.map((d) => (
            <label key={d.id} className={`cursor-pointer rounded-lg border p-3 ${dealType === d.id ? 'border-s1 bg-surface-2' : 'border-line'}`}>
              <input type="radio" name="dealType" className="sr-only" checked={dealType === d.id} onChange={() => setDealType(d.id)} />
              <div className="font-semibold">{d.label}</div>
              <div className="text-xs text-ink-2">{d.blurb}</div>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="card grid gap-4 p-4 md:grid-cols-2">
        <legend className="label px-1">Buyer audience</legend>
        <label className="space-y-1">
          <span className="label">Buyer brand</span>
          <input className="input" value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="e.g. PepsiCo or Los Angeles Dodgers" maxLength={120} />
          <span className="block text-xs text-muted">Resolved against Qloo&rsquo;s brand catalogue; ambiguous names come back as confirm chips.</span>
        </label>
        <label className="space-y-1">
          <span className="label">Proxies (optional, up to 6)</span>
          <textarea className="input min-h-[84px]" value={proxies} onChange={(e) => setProxies(e.target.value)} placeholder={'Owned or flagship brands, one per line\nDoritos\nGatorade'} />
          <span className="block text-xs text-muted">A brand alone is a thin signal; its flagship brands enrich the audience.</span>
        </label>
        <label className="space-y-1 md:col-span-2">
          <span className="label">Title (optional)</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Better-for-you bolt-on screen" />
        </label>
      </fieldset>

      <fieldset className="card space-y-3 p-4">
        <legend className="label px-1">Universe</legend>
        <textarea className="input min-h-[140px]" value={universe} onChange={(e) => setUniverse(e.target.value)} placeholder="Candidate brands, one per line or comma separated (up to 60)" />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="btn btn-ghost !py-1">
            Upload CSV (first column)
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])} />
          </label>
          <span className="num text-muted">{universeNames.length} brand(s)</span>
          {pinned.length > 0 && <span className="text-muted">Pinned for full analysis: {pinned.join(', ')}</span>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={discover} onChange={(e) => setDiscover(e.target.checked)} />
          Also let Qloo discover brands the buyer&rsquo;s audience already over-indexes on
        </label>
        {discover && (
          <div className="space-y-3 rounded-lg border border-line p-3">
            <div className="flex gap-2">
              <input className="input" value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchTags())} placeholder="Category, e.g. snacks, beverage, apparel" />
              <button type="button" className="btn btn-ghost" onClick={searchTags} disabled={!qlooReady}>
                Search Qloo tags
              </button>
            </div>
            {tagHits.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tagHits.map((t) => (
                  <button type="button" key={t.id} className="rounded-full border border-line px-2 py-0.5 text-xs hover:bg-surface-2" title={t.id} onClick={() => tags.length < 5 && !tags.some((x) => x.id === t.id) && setTags([...tags, t])}>
                    + {t.name} <span className="text-muted">{t.id.split(':').slice(-2).join(':')}</span>
                  </button>
                ))}
              </div>
            )}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 text-sm">
                {tags.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5">
                    {t.name}
                    <button type="button" aria-label={`Remove ${t.name}`} onClick={() => setTags(tags.filter((x) => x.id !== t.id))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="label">Max Qloo popularity (0-1, optional)</span>
                <input className="input" type="number" min={0} max={1} step={0.05} value={popMax} onChange={(e) => setPopMax(e.target.value)} placeholder="e.g. 0.85 to surface emerging brands" />
              </label>
              <label className="space-y-1">
                <span className="label">Brands to discover</span>
                <input className="input" type="number" min={1} max={30} value={take} onChange={(e) => setTake(Math.max(1, Math.min(30, Number(e.target.value) || 15)))} />
              </label>
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="card grid gap-4 p-4 sm:grid-cols-3">
        <legend className="label px-1">Screen settings</legend>
        <label className="space-y-1">
          <span className="label">Shortlist size</span>
          <input className="input" type="number" min={1} max={12} value={shortlistSize} onChange={(e) => setShortlistSize(Math.max(1, Math.min(12, Number(e.target.value) || 8)))} />
        </label>
        <label className="space-y-1">
          <span className="label">Momentum as-of (optional)</span>
          <input className="input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          <span className="block text-xs text-muted">Defaults to 1 Oct 2025: Qloo&rsquo;s trending series is flat after mid-October 2025, so a later date shows momentum as not measured.</span>
        </label>
        <div className="space-y-2 pt-6 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={excludeOwned} onChange={(e) => setExcludeOwned(e.target.checked)} />
            Skip brands Qloo lists under the buyer&rsquo;s parent company
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={excludeGroup ?? groupDefault} onChange={(e) => setExcludeGroup(e.target.checked)} />
            Skip brands owned by another group (not acquirable or venture-stage; off by default for licensing)
          </label>
        </div>
      </fieldset>

      {error && <p className="rounded-lg border border-critical px-3 py-2 text-sm text-critical">{error}</p>}
      <div className="flex items-center gap-3">
        <button className="btn" type="submit" disabled={busy || !qlooReady}>
          {busy ? 'Starting...' : 'Screen the universe'}
        </button>
        {!qlooReady && <span className="text-sm text-muted">Qloo is not configured on this deployment, so new screens can&rsquo;t run. Simpatico doesn&rsquo;t guess.</span>}
      </div>
    </form>
  );
}
