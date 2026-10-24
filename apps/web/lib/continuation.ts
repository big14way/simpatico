// Serverless functions stop at 300 s; a screen with a full debate can take longer. Runs are
// driven in budgeted slices and each slice hands the rest to a fresh invocation through a
// signed POST to /api/runs/[id]/continue. On a long-running server none of this is needed.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DriveOptions } from '@simpatico/engine';

export const SERVERLESS = !!process.env.VERCEL;
const BUDGET_MS = 230_000;

function sign(runId: string, ts: string): string | null {
  const secret = process.env.JOB_HMAC_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update(`continue.${runId}.${ts}`).digest('hex');
}

export function verifyContinue(req: Request, runId: string): boolean {
  const ts = req.headers.get('x-simpatico-timestamp') ?? '';
  const sig = req.headers.get('x-simpatico-signature') ?? '';
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = sign(runId, ts);
  if (!expected) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function appOrigin(req: Request): string {
  return (process.env.APP_URL || new URL(req.url).origin).replace(/\/+$/, '');
}

export async function triggerContinue(origin: string, runId: string): Promise<void> {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign(runId, ts);
  if (!sig) return;
  await fetch(`${origin}/api/runs/${runId}/continue`, {
    method: 'POST',
    headers: { 'x-simpatico-timestamp': ts, 'x-simpatico-signature': sig },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {});
}

/** Budgeted slices on serverless; undefined (run to completion in-process) elsewhere. */
export function driveOptions(origin: string): DriveOptions | undefined {
  if (!SERVERLESS) return undefined;
  return { budgetMs: BUDGET_MS, onYield: (id) => triggerContinue(origin, id) };
}

const lastNudge = new Map<string, number>();

/** A run nobody is working on (lease expired, no recent progress) gets restarted. */
export async function nudgeIfStalled(
  origin: string,
  run: { id: string; status: string; leaseUntil: string | null; updatedAt: string },
): Promise<void> {
  if (!SERVERLESS || run.status !== 'running') return;
  const now = Date.now();
  const leased = run.leaseUntil !== null && Date.parse(run.leaseUntil) > now;
  if (leased || now - Date.parse(run.updatedAt) < 20_000) return;
  if (now - (lastNudge.get(run.id) ?? 0) < 60_000) return;
  lastNudge.set(run.id, now);
  await triggerContinue(origin, run.id);
}
