import { getStore, demoMode, qlooConfigured } from '@/lib/runtime';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = await getStore();
    await store.db.query('SELECT 1');
    return json({ ok: true, db: store.db.kind, qloo: qlooConfigured(), mode: demoMode() });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 503);
  }
}
