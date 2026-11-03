import { NextRequest } from 'next/server';
import { checkCourse } from '@/lib/mobileCardLimits';
import { buildCardComponents, buildMobileImageFlashCard, deriveCardTitle, makeFlashCard, makeSlateHTML, safeStr } from '@/lib/mobileCoursePublish';
import { getMobileCourse, updateMobileCourse } from '@/lib/mobileCourseStorage';
import {
  createLesson,
  saveMobileCardPage,
  addPageToChapter,
  uploadLessonImageFromUrl,
  lessonUrlForIds,
  setCollectionTitle,
  publishCourse,
} from '@/lib/courseEducative';
import type { MobileCard } from '@/lib/mobileCourseStorage';

export const runtime = 'nodejs';
export const maxDuration = 600;

// ── Low-level helpers ─────────────────────────────────────────────────────────

// ── POST /api/mobile-course/[id]/publish ──────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const course = await getMobileCourse(id);
  if (!course) return Response.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const targetCollectionId = body.targetCollectionId || course.targetCollectionId || '';
  const authorId = course.authorId || process.env.EDUCATIVE_AUTHOR_ID || '';

  if (!authorId) return Response.json({ error: 'authorId is not configured' }, { status: 400 });
  if (!targetCollectionId) return Response.json({ error: 'targetCollectionId is required' }, { status: 400 });

  const results: Array<{ chapterId: string; chapterTitle: string; cardId: string; cardTitle: string; url: string }> = [];
  const errors: Array<{ cardId: string; cardTitle: string; error: string }> = [];

  // Errors block the publish; warnings (under a minimum) are returned for display only.
  const gate = checkCourse(course.title || '', course.chapters.flatMap((c) => c.cards));
  if (gate.blocking) {
    return Response.json({ ok: false, error: 'Some cards break the publishing rules', issues: gate.issues }, { status: 422 });
  }

  const updatedChapters = [...course.chapters];

  for (let ci = 0; ci < updatedChapters.length; ci++) {
    const chapter = { ...updatedChapters[ci], cards: [...updatedChapters[ci].cards] };
    updatedChapters[ci] = chapter;

    for (let ki = 0; ki < chapter.cards.length; ki++) {
      const card = { ...chapter.cards[ki] };
      chapter.cards[ki] = card;

      const cardTitle = deriveCardTitle(card) || `Card ${ki + 1}`;

      try {
        const { page_id: pageId, collection_id: resolvedCollectionId } = await createLesson(
          authorId,
          targetCollectionId,
        );
        if (!pageId) throw new Error('createLesson returned no page_id');
        const cid = resolvedCollectionId || targetCollectionId;

        let built: { components: any[]; summary: any } | null;

        if (card.type === 'text_img' || card.type === 'img_only') {
          if (card.imageUrl) {
            const uploaded = await uploadLessonImageFromUrl(authorId, cid, pageId, card.imageUrl);
            if (!uploaded) {
              errors.push({ cardId: card.id, cardTitle, error: 'Image upload failed — skipped' });
              continue;
            }
            built = buildMobileImageFlashCard(
              cardTitle,
              safeStr(card.text),
              card.type === 'img_only',
              uploaded.imageId,
              uploaded.imageFileDownloadUrl,
              uploaded.sizeInBytes,
            );
          } else if (card.type === 'text_img' && card.text) {
            // text_img without image — fall back to text-only card
            built = {
              components: [
                makeFlashCard(cardTitle, 'text-only', safeStr(card.text), '', 6, 1),
                makeSlateHTML(true),
              ],
              summary: { title: cardTitle, titleUpdated: true },
            };
          } else {
            errors.push({ cardId: card.id, cardTitle, error: 'img_only card has no imageUrl — skipped' });
            continue;
          }
        } else {
          built = buildCardComponents(card, cardTitle);
        }

        if (!built) {
          errors.push({ cardId: card.id, cardTitle, error: `Unsupported card type: ${card.type}` });
          continue;
        }

        await saveMobileCardPage(authorId, cid, pageId, {
          title: cardTitle,
          components: built.components,
          summary: built.summary,
        });

        await addPageToChapter(authorId, cid, pageId, chapter.title, cardTitle);

        const url = lessonUrlForIds(authorId, cid, pageId);
        card.pageId = pageId;
        card.publishedUrl = url;
        results.push({ chapterId: chapter.id, chapterTitle: chapter.title, cardId: card.id, cardTitle, url });
      } catch (e: any) {
        const msg = e?.message || 'unknown error';
        console.error(`[publish] card ${card.id} (${cardTitle}) failed:`, msg);
        errors.push({ cardId: card.id, cardTitle, error: msg });
      }
    }
  }

  if (results.length > 0) {
    await setCollectionTitle(authorId, targetCollectionId, course.title || 'Mobile Course', course.title || 'Mobile Course');
    await publishCourse(authorId, targetCollectionId);
  }

  const publishedUrl = results.length > 0
    ? `https://www.educative.io/collection/${authorId}/${targetCollectionId}`
    : undefined;

  const updated = await updateMobileCourse(id, {
    chapters: updatedChapters,
    status: results.length > 0 ? 'published' : 'draft',
    publishedUrl: publishedUrl || results[0]?.url,
    targetCollectionId,
  });

  return Response.json({ ok: errors.length === 0, published: results.length, errors, results, course: updated });
}
