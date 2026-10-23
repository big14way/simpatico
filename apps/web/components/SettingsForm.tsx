'use client';

import { useState } from 'react';

type Weights = Record<'m1' | 'm2' | 'm3' | 'm4' | 'm5' | 'm6', number>;
interface Scoring {
  weights: Record<'ma_bolt_on' | 'licensing' | 'vc_thesis', Weights>;
  flags: { oneSidedRatio: number; tasteMissingShare: number; tasteOverlapMax: number; demographicMin: number; fadingZ: number; geoMin: number };
  bands: { advanceMin: number; watchMin: number; minCoverage: number };
}

const DEALS = [
  ['ma_bolt_on', 'M&A bolt-on'],
  ['licensing', 'Licensing / co-brand'],
  ['vc_thesis', 'VC thesis'],
] as const;
const METRICS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'] as const;
const FLAG_LABELS: Record<keyof Scoring['flags'], string> = {
  oneSidedRatio: 'AUDIENCE_ONE_SIDED when min(a,b)/max(a,b) <',
  tasteMissingShare: 'TASTE_CLASH when buyer top-20 tags missing >',
  tasteOverlapMax: '... and m2 <',
  demographicMin: 'DEMOGRAPHIC_MISMATCH when m4 <',
  fadingZ: 'FADING when momentum z <',
  geoMin: 'NO_GEO_OVERLAP (licensing) when m5 <',
};

export function SettingsForm({ initial, locked }: { initial: Scoring; locked: boolean }) {
  const [s, setS] = useState<Scoring>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const setW = (d: (typeof DEALS)[number][0], m: (typeof METRICS)[number], v: number) => setS({ ...s, weights: { ...s.weights, [d]: { ...s.weights[d], [m]: v } } });

  async function save(reset = false) {
    setMsg(null);
    const res = await fetch('/api/settings/scoring', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reset ? { reset: true } : s) });
    const data = (await res.json()) as { scoring?: Scoring; error?: string };
    if (data.scoring) {
      setS(data.scoring);
      setMsg(reset ? 'Reset to defaults. New runs use them.' : 'Saved. New runs and the monitor use these settings.');
    } else setMsg(data.error ?? 'Could not save.');
  }

  const numInput = (value: number, onChange: (v: number) => void, step = 0.05) => (
    <input className="input num !w-20 !py-1 text-right" type="number" step={step} value={value} disabled={locked} onChange={(e) => onChange(Number(e.target.value))} />
  );

  return (
    <div className="space-y-5">
      <section className="card overflow-x-auto p-4">
        <h2 className="font-bold">Composite weights</h2>
        <p className="text-xs text-muted">Per deal type; renormalised over the metrics Qloo could measure.</p>
        <table className="mt-2 text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 pr-3">Deal type</th>
              {METRICS.map((m) => (
                <th key={m} className="px-1 py-1 text-right">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DEALS.map(([d, label]) => (
              <tr key={d}>
                <td className="py-1 pr-3">{label}</td>
                {METRICS.map((m) => (
                  <td key={m} className="px-1 py-1">
                    {numInput(s.weights[d][m], (v) => setW(d, m, v))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-2 p-4">
          <h2 className="font-bold">Red-flag rules</h2>
          {(Object.keys(FLAG_LABELS) as (keyof Scoring['flags'])[]).map((k) => (
            <label key={k} className="flex items-center justify-between gap-3 text-sm">
              <span>{FLAG_LABELS[k]}</span>
              {numInput(s.flags[k], (v) => setS({ ...s, flags: { ...s.flags, [k]: v } }), k === 'fadingZ' ? 0.1 : 0.05)}
            </label>
          ))}
        </div>
        <div className="card space-y-2 p-4">
          <h2 className="font-bold">Verdict bands</h2>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>ADVANCE when F ≥ (and no red flag)</span>
            {numInput(s.bands.advanceMin, (v) => setS({ ...s, bands: { ...s.bands, advanceMin: v } }), 1)}
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>WATCH when F ≥</span>
            {numInput(s.bands.watchMin, (v) => setS({ ...s, bands: { ...s.bands, watchMin: v } }), 1)}
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>No score below weighted coverage</span>
            {numInput(s.bands.minCoverage, (v) => setS({ ...s, bands: { ...s.bands, minCoverage: v } }))}
          </label>
        </div>
      </section>
      {locked ? (
        <p className="text-sm text-muted">Settings are read-only on this public deployment.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={() => save()}>
            Save
          </button>
          <button className="btn btn-ghost" onClick={() => save(true)}>
            Reset to defaults
          </button>
          {msg && <span className="text-sm text-ink-2">{msg}</span>}
        </div>
      )}
    </div>
  );
}
