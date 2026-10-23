import { scoringConfig } from '@simpatico/engine';
import { SettingsForm } from '@/components/SettingsForm';
import { getDeps } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const scoring = await scoringConfig(await getDeps());
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Scoring settings</h1>
        <p className="text-sm text-ink-2">Every threshold the code uses is visible and editable. Models never see or change these.</p>
      </div>
      <SettingsForm initial={JSON.parse(JSON.stringify(scoring))} locked={process.env.SETTINGS_LOCKED === '1'} />
    </div>
  );
}
