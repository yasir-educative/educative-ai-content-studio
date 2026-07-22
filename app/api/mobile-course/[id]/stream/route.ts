import { NextRequest } from 'next/server';
import { subscribeMobileCourse } from '@/lib/mobileCourseRunManager';
import { getMobileCourse } from '@/lib/mobileCourseStorage';

export const runtime = 'nodejs';
export const maxDuration = 600;

// GET /api/mobile-course/[id]/stream — re-attach to a live run
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (e: any) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { closed = true; }
      };

      const sub = subscribeMobileCourse(id, send);
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
        const real = subscribeMobileCourse(id, wrap)!;
        req.signal.addEventListener('abort', () => {
          closed = true;
          real.unsubscribe();
          try { controller.close(); } catch {}
        });
        return;
      }

      // Not live — replay from disk
      const rec = await getMobileCourse(id);
      if (!rec) {
        send({ type: 'error', message: 'run not found' });
        closed = true;
        try { controller.close(); } catch {}
        return;
      }
      send({ type: 'meta', courseId: rec.id });
      for (const [name, payload] of Object.entries(rec.stageOutputs || {})) {
        send({ type: 'data', name, payload });
      }
      const term =
        rec.status === 'cancelled' ? { type: 'cancelled', courseId: id } :
        rec.status === 'failed' ? { type: 'error', message: rec.errorMessage || 'failed' } :
        { type: 'done', courseId: id };
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
