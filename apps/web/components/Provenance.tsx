'use client';

import { useState } from 'react';

interface Row {
  id: string;
  purpose: string;
  path: string;
  status: string;
  fromCache: boolean;
  durationMs: number;
  summary: string;
  fetchedAt: string | null;
}

interface Detail {
  request: string;
  header: string;
  response: { fetchedAt: string; pinned: boolean; preview: string | null } | null;
  evidence: { error: { message: string } | null };
}

/** Every Qloo call behind this target: redacted request, status, and a response excerpt on demand. */
export function Provenance({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, Detail>>({});

  async function toggle(id: string) {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (!detail[id]) {
      const d = (await (await fetch(`/api/qloo/evidence/${id}`)).json()) as Detail;
      setDetail((x) => ({ ...x, [id]: d }));
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-1.5 pr-2">Purpose</th>
            <th className="py-1.5 pr-2">Endpoint</th>
            <th className="py-1.5 pr-2">Status</th>
            <th className="py-1.5 pr-2">Result</th>
            <th className="py-1.5 pr-2 text-right">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <FragmentRow key={r.id} r={r} open={open === r.id} detail={detail[r.id]} onToggle={() => toggle(r.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({ r, open, detail, onToggle }: { r: Row; open: boolean; detail?: Detail; onToggle: () => void }) {
  return (
    <>
      <tr className="border-b border-line">
        <td className="py-1.5 pr-2">
          <button type="button" className="text-left text-link underline" onClick={onToggle} aria-expanded={open}>
            {r.purpose}
          </button>
        </td>
        <td className="py-1.5 pr-2 font-mono text-xs">{r.path}</td>
        <td className={`py-1.5 pr-2 text-xs ${r.status === 'error' ? 'text-critical' : 'text-ink-2'}`}>{r.status}</td>
        <td className="py-1.5 pr-2 text-xs text-ink-2">{r.summary}</td>
        <td className="num py-1.5 pr-2 text-right text-xs text-muted">{r.fromCache ? 'cache' : `live ${r.durationMs} ms`}</td>
      </tr>
      {open && (
        <tr className="border-b border-line bg-surface-2">
          <td colSpan={5} className="p-2">
            {!detail ? (
              <span className="text-xs text-muted">Loading...</span>
            ) : (
              <div className="space-y-1 text-xs">
                <div className="break-all font-mono">{detail.request}</div>
                <div className="font-mono text-muted">{detail.header}</div>
                {detail.response && (
                  <div className="text-muted">
                    Fetched {detail.response.fetchedAt.slice(0, 19).replace('T', ' ')} UTC{detail.response.pinned ? ' · recorded for replay' : ''}
                  </div>
                )}
                {detail.evidence.error && <div className="text-critical">{detail.evidence.error.message}</div>}
                {detail.response?.preview && <pre className="max-h-64 overflow-auto rounded border border-line bg-surface p-2 font-mono text-[11px] leading-snug">{detail.response.preview}</pre>}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
