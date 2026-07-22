import { NextRequest } from 'next/server';
import { startBlogRun, subscribe } from '@/lib/runManager';

export const runtime = 'nodejs';
export const maxDuration = 600;

// POST /api/blog kicks off a background run and streams its events. The run is owned by the
// server (not by the request) — if the client closes the fetch, the pipeline keeps running and
// the on-disk record at data/blogs/{id}.json keeps updating. Use POST /api/blog/{id}/cancel to
// actually stop a run, and GET /api/blog/{id}/stream to re-attach from another tab.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const handle = startBlogRun(body);

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
      // Replay any events that already happened between startBlogRun() and subscribe().
      for (const e of sub.backlog) send(e);
      if (sub.done) {
        closed = true;
        try { controller.close(); } catch {}
        return;
      }

      // Forward terminal events to close the stream cleanly.
      const wrap = (e: any) => {
        send(e);
        if (e?.type === 'done' || e?.type === 'error' || e?.type === 'cancelled') {
          closed = true;
          sub.unsubscribe();
          try { controller.close(); } catch {}
        }
      };
      // Re-subscribe with the wrapper so we can intercept terminal events.
      sub.unsubscribe();
      const real = subscribe(handle.id, wrap)!;

      // If the client navigates away, just detach — DO NOT cancel the run.
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
