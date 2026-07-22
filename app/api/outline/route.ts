import { NextRequest } from 'next/server';
import { runOutlinePipeline } from '@/lib/pipeline';
import { runWithAbort, isAbortError } from '@/lib/abortContext';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();

  const abortCtl = new AbortController();
  const onClientAbort = () => abortCtl.abort();
  req.signal.addEventListener('abort', onClientAbort);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (e: any) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { closed = true; }
      };
      try {
        await runWithAbort(abortCtl.signal, () => runOutlinePipeline(body, send));
        send({ type: 'done' });
      } catch (err: any) {
        if (isAbortError(err) || abortCtl.signal.aborted) {
          send({ type: 'cancelled' });
        } else {
          send({ type: 'error', message: err?.message || String(err) });
        }
      } finally {
        req.signal.removeEventListener('abort', onClientAbort);
        closed = true;
        try { controller.close(); } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
