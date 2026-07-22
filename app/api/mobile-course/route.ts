import { NextRequest } from 'next/server';
import { startMobileCourseRun, subscribeMobileCourse } from '@/lib/mobileCourseRunManager';
import { listMobileCourses } from '@/lib/mobileCourseStorage';

export const runtime = 'nodejs';
export const maxDuration = 600;

// GET /api/mobile-course — list all runs
export async function GET() {
  const courses = await listMobileCourses();
  return Response.json({ courses });
}

// POST /api/mobile-course — start a new run and stream events
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { collectionId, authorId, targetCollectionId, courseTitle, previewedChapters } = body;

  if (!collectionId) {
    return Response.json({ error: 'collectionId is required' }, { status: 400 });
  }

  const handle = startMobileCourseRun({
    collectionId: String(collectionId),
    authorId: String(authorId || process.env.EDUCATIVE_AUTHOR_ID || ''),
    targetCollectionId: targetCollectionId ? String(targetCollectionId) : undefined,
    courseTitle: courseTitle ? String(courseTitle) : undefined,
    previewedChapters: Array.isArray(previewedChapters) ? previewedChapters : undefined,
  });

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

      const sub = subscribeMobileCourse(handle.id, send)!;
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
      const real = subscribeMobileCourse(handle.id, wrap)!;

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
      'X-Course-Id': handle.id,
    },
  });
}
