import { NextRequest } from 'next/server';
import { startNewsletterRun, subscribe } from '@/lib/runManager';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const handle = startNewsletterRun(body);

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (e: any) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const sub = subscribe(handle.id, send)!;
      for (const e of sub.backlog) send(e);
      if (sub.done) {
        closed = true;
        try { controller.close(); } catch {}
        return;
      }

      const wrap = (e: any) => {
        send(e);
        if (e?.type === 'done' || e?.type === 'error' || e?.type === 'cancelled') {
          closed = true;
          sub.unsubscribe();
          try { controller.close(); } catch {}
        }
      };
      sub.unsubscribe();
      const real = subscribe(handle.id, wrap)!;

      req.signal.addEventListener('abort', () => {
        closed = true;
        real.unsubscribe();
        try { controller.close(); } catch {}
      });
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
