'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Re-runs a showcase scenario live against Qloo (fresh calls, not the recorded cache). */
export function StartScenario({ slug, label = 'Run live' }: { slug: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        className="btn btn-ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: slug, refresh: true }) });
          const data = (await res.json()) as { runId?: string; error?: string };
          if (data.runId) router.push(`/runs/${data.runId}`);
          else {
            setError(data.error ?? 'Could not start the run.');
            setBusy(false);
          }
        }}
      >
        {busy ? 'Starting...' : label}
      </button>
      {error && <span className="text-xs text-critical">{error}</span>}
    </span>
  );
}
