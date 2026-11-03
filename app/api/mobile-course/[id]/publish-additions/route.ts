import { NextRequest } from 'next/server';
import { checkCard } from '@/lib/mobileCardLimits';
import { placeNewPagesInToc } from '@/lib/mobileCourseAugment';
import { buildCardPage, deriveCardTitle } from '@/lib/mobileCoursePublish';
import { getMobileCourse, saveMobileCourse, type MobileCard } from '@/lib/mobileCourseStorage';
import { pageContent, remoteContentHash } from '@/lib/remoteContent';
import {
  createLesson,
  fetchCollectionCategories,
  fetchRemotePage,
  lessonUrlForIds,
  saveCollectionCategories,
  saveMobileCardPage,
} from '@/lib/courseEducative';

export const runtime = 'nodejs';
export const maxDuration = 600;

/**
 * Publish the cards added to an existing course, each at its exact position.
 *
 * A card with no pageId has never been published, which is what marks it as an
 * addition. Pages are created first, then the table of contents is written
 * once: a page created but not placed is invisible, while a table of contents
 * naming a page that does not exist breaks the course for readers.
 *
 * Positions come from the local order. A new card is placed directly after the
 * published card before it, so an insertion lands where the author put it even
 * if the chapter has gained pages in Educative since the import.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const course = await getMobileCourse(params.id);
  if (!course) return Response.json({ error: 'Course not found' }, { status: 404 });

  const collectionId = course.targetCollectionId || course.collectionId || '';
  const authorId = course.authorId || process.env.EDUCATIVE_AUTHOR_ID || '';
  if (!collectionId || !authorId) {
    return Response.json({ error: 'This course has no collection to publish into' }, { status: 400 });
  }

  const pending = course.chapters.flatMap((chapter) =>
    chapter.cards.filter((card) => !card.pageId && !card.readOnly).map((card) => ({ chapter, card })));
  if (!pending.length) return Response.json({ error: 'Nothing new to publish' }, { status: 400 });

  // Errors block the whole run: a half-published insertion leaves the chapter
  // reading as if a card is missing, which is worse than publishing nothing.
  const blocked = pending.flatMap(({ card }) =>
    checkCard(card, 'course').filter((i) => i.severity === 'error').map((i) => ({ cardId: card.id, message: i.message })));
  if (blocked.length) {
    return Response.json({ error: 'Some new cards break the publishing rules', issues: blocked }, { status: 422 });
  }

  const results: Array<{ cardId: string; title: string; url: string }> = [];
  const errors: Array<{ cardId: string; title: string; error: string }> = [];
  const published = new Map<string, { pageId: string; title: string; url: string; hash?: string }>();

  // 1. Create and fill a page per new card.
  for (const { card } of pending) {
    const title = deriveCardTitle(card) || `Card ${card.card_number ?? ''}`.trim() || 'Card';
    try {
      const { page_id: pageId, collection_id: resolved } = await createLesson(authorId, collectionId);
      if (!pageId) throw new Error('createLesson returned no page_id');
      const cid = resolved || collectionId;
      const built = await buildCardPage(card, title, { authorId, collectionId: cid, pageId });
      await saveMobileCardPage(authorId, cid, pageId, { title, components: built.components, summary: built.summary });
      const url = lessonUrlForIds(authorId, cid, pageId);
      published.set(card.id, { pageId, title, url });
      results.push({ cardId: card.id, title, url });
    } catch (e: any) {
      errors.push({ cardId: card.id, title, error: e?.message || 'Publish failed' });
    }
  }

  if (!published.size) {
    return Response.json({ ok: false, published: 0, errors }, { status: 502 });
  }

  // 2. Place every new page, and every new chapter, in one table of contents write.
  const categories = await fetchCollectionCategories(authorId, collectionId);
  const chapters = course.chapters.map((c) => ({ ...c, cards: [...c.cards] }));
  const { chapterCategoryIds } = placeNewPagesInToc(categories, chapters, published, { authorId, collectionId });
  for (const [index, categoryId] of Object.entries(chapterCategoryIds)) {
    chapters[Number(index)].remoteCategoryId = categoryId;
  }

  try {
    await saveCollectionCategories(authorId, collectionId, categories);
  } catch (e: any) {
    return Response.json({
      ok: false,
      published: results.length,
      results,
      errors,
      error: `Pages were created but the table of contents could not be saved: ${e?.message}. The new pages exist in the collection and are not yet listed.`,
    }, { status: 502 });
  }

  // 3. Store what Educative now holds, so a later edit can detect a conflict.
  await Promise.all([...published.entries()].map(async ([cardId, info]) => {
    try {
      const page = await fetchRemotePage(authorId, collectionId, info.pageId);
      if (page) info.hash = remoteContentHash(pageContent(page));
    } catch {
      // A missing hash only means the next save skips its conflict check.
    }
  }));

  const now = new Date().toISOString();
  await saveMobileCourse({
    ...course,
    updatedAt: now,
    targetCollectionId: collectionId,
    chapters: chapters.map((chapter) => ({
      ...chapter,
      cards: chapter.cards.map((card): MobileCard => {
        const fresh = published.get(card.id);
        if (!fresh) return card;
        return {
          ...card,
          pageId: fresh.pageId,
          publishedUrl: fresh.url,
          remoteSyncedAt: now,
          ...(fresh.hash ? { remoteHash: fresh.hash } : {}),
        };
      }),
    })),
  });

  return Response.json({
    ok: errors.length === 0,
    published: results.length,
    results,
    errors,
    course: await getMobileCourse(params.id),
  });
}
