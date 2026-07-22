import { NextRequest } from 'next/server';
import { startMobileShortRun, subscribeMobileShort } from '@/lib/mobileShortsRunManager';
import { listMobileShorts } from '@/lib/mobileShortsStorage';

export const runtime = 'nodejs';
export const maxDuration = 600;

// GET /api/mobile-short — list all shorts
export async function GET() {
  const shorts = await listMobileShorts();
  return Response.json({ shorts });
}

// POST /api/mobile-short — start a new run and stream events
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { topic, domain, level, objective, additionalContext, isHighlightCardNeeded, numCards, authorId } = body;

  if (!topic) {
    return Response.json({ error: 'topic is required' }, { status: 400 });
  }

  const handle = startMobileShortRun({
    topic: String(topic),
    domain: domain ? String(domain) : undefined,
    level: level ? String(level) : undefined,
    objective: objective ? String(objective) : undefined,
    additionalContext: additionalContext ? String(additionalContext) : undefined,
    isHighlightCardNeeded: isHighlightCardNeeded !== undefined ? Boolean(isHighlightCardNeeded) : undefined,
    numCards: numCards !== undefined ? Number(numCards) : undefined,
    authorId: String(authorId || process.env.EDUCATIVE_AUTHOR_ID || ''),
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

      const sub = subscribeMobileShort(handle.id, send)!;
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
      const real = subscribeMobileShort(handle.id, wrap)!;

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
      'X-Short-Id': handle.id,
    },
  });
}
