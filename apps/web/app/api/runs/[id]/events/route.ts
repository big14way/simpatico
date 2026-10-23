import { getStore } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(['done', 'failed', 'needs_input']);

/** Server-sent events: the run's progress log, polled from the database (works across processes). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const after = Number(new URL(req.url).searchParams.get('after') ?? 0) || 0;
  const store = await getStore();
  const enc = new TextEncoder();
  let closed = false;
  req.signal.addEventListener('abort', () => {
    closed = true;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => {
        if (!closed) controller.enqueue(enc.encode(s));
      };
      let seq = after;
      let ticks = 0;
      const flush = async () => {
        for (const e of await store.runs.events(id, seq)) {
          seq = e.seq;
          send(`id: ${e.seq}\nevent: log\ndata: ${JSON.stringify(e)}\n\n`);
        }
      };
      try {
        const started = Date.now();
        while (!closed && Date.now() - started < 15 * 60_000) {
          await flush();
          const run = await store.runs.get(id);
          if (!run) {
            send('event: gone\ndata: {}\n\n');
            break;
          }
          if (TERMINAL.has(run.status)) {
            await flush();
            send(`event: status\ndata: ${JSON.stringify({ status: run.status, error: run.error })}\n\n`);
            break;
          }
          if (++ticks % 20 === 0) send(': keep-alive\n\n');
          await sleep(700);
        }
      } catch (err) {
        send(`event: status\ndata: ${JSON.stringify({ status: 'stream_error', error: (err as Error).message })}\n\n`);
      } finally {
        if (!closed) controller.close();
        closed = true;
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
