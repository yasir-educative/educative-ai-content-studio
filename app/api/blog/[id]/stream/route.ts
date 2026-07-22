import { NextRequest } from 'next/server';
import { subscribe } from '@/lib/runManager';
import { getBlog } from '@/lib/storage';

export const runtime = 'nodejs';
export const maxDuration = 600;

// GET /api/blog/{id}/stream — re-attach to a live run from another tab. Returns the buffered
// event log first, then any future events. If the run isn't live, falls back to a one-shot SSE
// burst from the on-disk record so callers can still inspect a finished run.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (e: any) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { closed = true; }
      };

      const sub = subscribe(id, send);
      if (sub) {
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
        const real = subscribe(id, wrap)!;
        req.signal.addEventListener('abort', () => {
          closed = true;
          real.unsubscribe();
          try { controller.close(); } catch {}
        });
        return;
      }

      // Not live — replay from disk so the client at least gets a snapshot.
      const rec = await getBlog(id);
      if (!rec) {
        send({ type: 'error', message: 'run not found' });
        closed = true;
        try { controller.close(); } catch {}
        return;
      }
      send({ type: 'meta', blogId: rec.id });
      for (const [name, payload] of Object.entries(rec.stageOutputs || {})) {
        send({ type: 'data', name, payload });
      }
      for (const [name, entries] of Object.entries(rec.stageLogs || {})) {
        for (const payload of entries as any[]) {
          send({ type: 'log', name, payload });
        }
      }
      if (rec.markdown || rec.html || rec.editorBlocks) {
        send({ type: 'final', payload: { title: rec.finalTitle, markdown: rec.markdown, html: rec.html, editorBlocks: rec.editorBlocks, widgets: rec.widgets } });
      }
      const term =
        rec.status === 'cancelled' ? { type: 'cancelled', blogId: id } :
        rec.status === 'failed' ? { type: 'error', message: rec.errorMessage || 'failed' } :
        { type: 'done', blogId: id };
      send(term);
      closed = true;
      try { controller.close(); } catch {}
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
