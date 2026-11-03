import { NextRequest } from 'next/server';
import { mediaModeFor, replaceCardMedia, type MediaMode } from '@/lib/mobileCourseMedia';
import { getMobileCourse, updateMobileCourse } from '@/lib/mobileCourseStorage';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Replace a card's Educative-authored media with an image of our own.
 *
 * mode 'd2'       — draw the D2 diagram as an illustration
 * mode 'recreate' — redraw a hosted PNG or JPEG in the card style
 * mode 'fresh'    — illustrate the card's own words, for a Lottie animation
 *                   there is no way to read
 *
 * Both make a read-only card editable, which also means a later save rebuilds
 * the page without the original diagram. Local only: the card is not published.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; chapterId: string; cardId: string } },
) {
  const course = await getMobileCourse(params.id);
  if (!course) return Response.json({ error: 'Course not found' }, { status: 404 });

  const chapter = course.chapters.find((c) => c.id === params.chapterId);
  const card = chapter?.cards.find((c) => c.id === params.cardId);
  if (!chapter || !card) return Response.json({ error: 'Card not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const asked = ['d2', 'recreate', 'fresh'].includes(body.mode) ? (body.mode as MediaMode) : undefined;
  const mode = asked || mediaModeFor(card);
  const note = String(body.note || '').slice(0, 1000);
  const order = chapter.cards.indexOf(card);

  if (!mode) {
    return Response.json({ error: 'This card has no media to replace' }, { status: 422 });
  }
  if (mode === 'd2' && !card.d2Code) {
    return Response.json({ error: 'This card has no D2 source' }, { status: 422 });
  }
  if (mode === 'recreate' && !/^https?:\/\//.test(String(card.imageUrl || ''))) {
    return Response.json({ error: 'This card has no hosted image to recreate' }, { status: 422 });
  }

  try {
    const updated = await replaceCardMedia(card, course.id, chapter.id, order, mode, note);
    await updateMobileCourse(params.id, {
      chapters: course.chapters.map((c) => c.id !== chapter.id ? c : {
        ...c, cards: c.cards.map((k) => k.id === card.id ? updated : k),
      }),
    });
    return Response.json({ ok: true, card: updated });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Image generation failed' }, { status: 502 });
  }
}
