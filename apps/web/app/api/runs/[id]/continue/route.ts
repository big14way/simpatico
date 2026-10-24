import { after } from 'next/server';
import { drive } from '@simpatico/engine';
import { appOrigin, driveOptions, verifyContinue } from '@/lib/continuation';
import { getDeps } from '@/lib/runtime';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Internal, signed: pick up a run where the previous worker's time budget ran out. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!verifyContinue(req, id)) return json({ error: 'Bad signature.' }, 401);
  const deps = await getDeps();
  const origin = appOrigin(req);
  after(() => drive(deps, id, driveOptions(origin)).then(() => undefined));
  return json({ ok: true }, 202);
}
