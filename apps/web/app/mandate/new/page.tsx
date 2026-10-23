import { SCENARIOS } from '@simpatico/engine';
import { MandateForm } from '@/components/MandateForm';
import { qlooConfigured } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export default function NewMandate() {
  const examples = SCENARIOS.map((s) => ({ slug: s.slug, label: s.label, mandate: JSON.parse(JSON.stringify(s.mandate)) }));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">New mandate</h1>
        <p className="text-sm text-ink-2">
          Name the buyer and the candidates. Simpatico resolves every name in Qloo, ranks the universe against the buyer&rsquo;s audience, analyses the
          shortlist on six metrics, debates it and acts. Only brand names are sent to Qloo: no personal data, ever.
        </p>
      </div>
      <MandateForm examples={examples} qlooReady={qlooConfigured()} />
    </div>
  );
}
