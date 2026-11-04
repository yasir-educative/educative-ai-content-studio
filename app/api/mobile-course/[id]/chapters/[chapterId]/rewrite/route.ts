import { NextRequest } from 'next/server';
import { getMobileCourse, saveMobileCourse, type MobileCard } from '@/lib/mobileCourseStorage';
import { rewriteCard } from '@/lib/cardRewriteAgent';
import { checkCard } from '@/lib/mobileCardLimits';

export const runtime = 'nodejs';
export const maxDuration = 900;

/**
 * Rewrite the text of every card in one chapter.
 *
 * The counterpart of the images route: one sweep, no analysis, no new cards.
 * Each card goes through the same rewrite agent a single card does, so the
 * character gate and the type rules apply exactly as they do everywhere else.
 * A card is saved as it finishes, so a failure halfway keeps what is done.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; chapterId: string } },
) {
  const course = await getMobileCourse(params.id);
  if (!course) return Response.json({ error: 'Course not found' }, { status: 404 });
  const chapter = course.chapters.find((c) => c.id === params.chapterId);
  if (!chapter) return Response.json({ error: 'Chapter not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const note = String(body.note || '').slice(0, 1000);
  // 'failing' touches only the cards the gate rejects; 'all' rewrites the lot.
  const only = body.only === 'failing' ? 'failing' : 'all';

  const targets = chapter.cards
    .map((card, order) => ({ card, order }))
    // A read-only card cannot be rebuilt; its media has to be replaced first.
    .filter(({ card }) => !card.readOnly)
    .filter(({ card }) => only === 'all'
      || checkCard(card, 'course').some((issue) => issue.severity === 'error'));

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const send = (data: object) => writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  (async () => {
    let done = 0;
    let failed = 0;
    send({ type: 'start', total: targets.length });
    for (const { card, order } of targets) {
      const label = card.title || `card ${order + 1}`;
      try {
        send({ type: 'card', status: 'start', cardId: card.id, title: label, done, total: targets.length });
        const { candidate: rewritten } = await rewriteCard({
          product: 'course',
          card,
          note,
          context: {
            // The cards either side keep the rewrite in step with the chapter.
            neighbours: chapter.cards.slice(Math.max(0, order - 2), order + 3),
            courseName: course.title,
            chapterTitle: chapter.title,
            chapterSummary: chapter.summary,
            lessonOutline: chapter.lessonOutline,
          },
        });

        const latest = await getMobileCourse(params.id);
        if (!latest) throw new Error('Course disappeared while rewriting');
        await saveMobileCourse({
          ...latest,
          chapters: latest.chapters.map((c) => c.id !== chapter.id ? c : {
            ...c,
            cards: c.cards.map((k) => (k.id === card.id ? { ...k, ...rewritten } as MobileCard : k)),
          }),
          updatedAt: new Date().toISOString(),
        });
        done++;
        send({ type: 'card', status: 'done', cardId: card.id, title: label, done, total: targets.length });
      } catch (e: any) {
        // One card that will not come back clean must not cost the chapter.
        failed++;
        send({ type: 'card', status: 'error', cardId: card.id, title: label, message: e?.message || 'failed', done, total: targets.length });
      }
    }
    send({ type: 'done', done, failed, total: targets.length });
    writer.close();
  })();

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
