import { NextRequest } from 'next/server';
import { getMobileCourse, saveMobileCourse, type MobileCard } from '@/lib/mobileCourseStorage';
import { hasPicture, mediaModeFor, redrawCardImage, replaceCardMedia } from '@/lib/mobileCourseMedia';

export const runtime = 'nodejs';
export const maxDuration = 900;

/**
 * Draw every picture in one chapter again.
 *
 * Two kinds of card, one pass. A card still carrying Educative's own media —
 * a D2 diagram, a Lottie animation, an SVG, an uploaded raster — is replaced
 * the way the single-card route replaces it. A card already carrying a picture
 * of ours is simply redrawn from the brief it has, which is what a style or
 * prompt change calls for.
 *
 * Each card is saved as it finishes, so a failure halfway leaves the pictures
 * already drawn in place. Nothing is published.
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
  // 'converted' leaves our own pictures alone and only replaces Educative's.
  const only = body.only === 'converted' ? 'converted' : 'all';

  const targets = chapter.cards
    .map((card, order) => ({ card, order }))
    .filter(({ card }) => (only === 'converted' ? !!mediaModeFor(card) : hasPicture(card)))
    // A read-only card can only be dealt with by replacing its media.
    .filter(({ card }) => !card.readOnly || !!mediaModeFor(card));

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
      const mode = mediaModeFor(card);
      try {
        send({ type: 'card', status: 'start', cardId: card.id, title: label, mode: mode || 'redraw', done, total: targets.length });
        const updated: MobileCard = mode
          ? await replaceCardMedia(card, course.id, chapter.id, order, mode, note)
          : await redrawCardImage(card, course.id, chapter.id, order, note);

        // Re-read each time: this loop is long and the author may be editing.
        const latest = await getMobileCourse(params.id);
        if (!latest) throw new Error('Course disappeared while drawing');
        await saveMobileCourse({
          ...latest,
          chapters: latest.chapters.map((c) => c.id !== chapter.id ? c : {
            ...c, cards: c.cards.map((k) => (k.id === card.id ? { ...k, ...updated } : k)),
          }),
          updatedAt: new Date().toISOString(),
        });
        done++;
        send({ type: 'card', status: 'done', cardId: card.id, title: label, done, total: targets.length });
      } catch (e: any) {
        // One bad card must not cost the rest of the chapter.
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
