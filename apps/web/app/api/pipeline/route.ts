import { getStore } from '@/lib/runtime';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const store = await getStore();
  return json({ deals: await store.pipeline.list() });
}
