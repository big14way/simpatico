import { QlooRequiredError } from '@simpatico/qloo';
import { ZodError } from 'zod';

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function fail(err: unknown, fallbackStatus = 400): Response {
  if (err instanceof QlooRequiredError) return json({ error: err.message, code: 'qloo_required' }, 503);
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return json({ error: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input', code: 'invalid' }, 400);
  }
  const message = err instanceof Error ? err.message : String(err);
  return json({ error: message }, fallbackStatus);
}

export async function body<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error('Request body must be JSON.');
  }
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}
