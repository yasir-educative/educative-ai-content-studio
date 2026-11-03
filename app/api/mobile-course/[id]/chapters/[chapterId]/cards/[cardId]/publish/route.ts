import { NextRequest } from 'next/server';
import { getMobileCourse, updateMobileCourse } from '@/lib/mobileCourseStorage';
import { checkCard } from '@/lib/mobileCardLimits';
import {
  buildCardComponents,
  buildMobileImageFlashCard,
  deriveCardTitle,
  makeFlashCard,
  makeSlateHTML,
  safeStr,
} from '@/lib/mobileCoursePublish';
import { pageContent, remoteContentHash } from '@/lib/remoteContent';
import {
  fetchRemotePage,
  saveMobileCardPage,
  uploadLessonImageFromUrl,
  lessonUrlForIds,
} from '@/lib/courseEducative';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Save one card back into the lesson page it already occupies.
 *
 * In place only: without a pageId there is nothing to update, and creating a
 * page here would give the card a second URL. Returns 409 instead, so a card
 * can never be duplicated by a save.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; chapterId: string; cardId: string } },
) {
  const course = await getMobileCourse(params.id);
  if (!course) return Response.json({ error: 'Course not found' }, { status: 404 });

  const chapter = course.chapters.find((c) => c.id === params.chapterId);
  const card = chapter?.cards.find((c) => c.id === params.cardId);
  if (!chapter || !card) return Response.json({ error: 'Card not found' }, { status: 404 });

  const collectionId = course.targetCollectionId || '';
  const authorId = course.authorId || process.env.EDUCATIVE_AUTHOR_ID || '';
  if (!card.pageId || !collectionId || !authorId) {
    return Response.json({
      error: 'This card has no published page yet. Publish the chapter first; saving never creates a page.',
    }, { status: 409 });
  }
  if (card.readOnly) {
    return Response.json({ error: `This card cannot be edited: ${card.readOnly}` }, { status: 409 });
  }

  const issues = checkCard(card, 'course');
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    return Response.json({
      error: `Fix ${errors.length === 1 ? 'this' : 'these'} before saving: ${errors.map((i) => i.message).join('; ')}`,
      issues,
    }, { status: 422 });
  }

  const body = await req.json().catch(() => ({}));
  const title = deriveCardTitle(card) || `Card ${card.card_number ?? ''}`.trim();

  try {
    // Refuse to clobber an edit made in Educative since we last read the page.
    const current = await fetchRemotePage(authorId, collectionId, card.pageId);
    if (!current) {
      return Response.json({ error: 'That page no longer exists in Educative' }, { status: 409 });
    }
    if (card.remoteHash && !body.force) {
      const liveHash = remoteContentHash(pageContent(current));
      if (liveHash !== card.remoteHash) {
        return Response.json({
          error: 'This page changed in Educative since it was imported. Saving would overwrite that change.',
          conflict: true,
        }, { status: 409 });
      }
    }

    let built: { components: any[]; summary: any } | null = null;
    if (card.type === 'text_img' || card.type === 'img_only') {
      // A locally generated image has to be uploaded into the page; an image
      // already hosted by Educative is left exactly where it is.
      const local = card.imageUrl && card.imageUrl.startsWith('/');
      if (local) {
        const uploaded = await uploadLessonImageFromUrl(authorId, collectionId, card.pageId, card.imageUrl!);
        if (uploaded) {
          built = buildMobileImageFlashCard(
            title, safeStr(card.text), card.type === 'img_only',
            uploaded.imageId, uploaded.imageFileDownloadUrl, uploaded.sizeInBytes,
          );
        }
      }
      if (!built && card.type === 'text_img' && card.text) {
        built = {
          components: [makeFlashCard(title, 'text-only', safeStr(card.text), '', 6, 1), makeSlateHTML(true)],
          summary: { title, titleUpdated: true },
        };
      }
      if (!built) return Response.json({ error: 'This image card has no usable image' }, { status: 422 });
    } else {
      built = buildCardComponents(card, title);
      if (!built) return Response.json({ error: `Cannot build a ${card.type} card` }, { status: 422 });
    }

    await saveMobileCardPage(authorId, collectionId, card.pageId, {
      title, components: built.components, summary: built.summary,
    });

    // Re-read so the stored hash matches what Educative actually holds, not
    // what we believe we sent.
    const saved = await fetchRemotePage(authorId, collectionId, card.pageId);
    const url = lessonUrlForIds(authorId, collectionId, card.pageId);
    const updated = {
      ...card,
      publishedUrl: url,
      remoteSyncedAt: new Date().toISOString(),
      ...(saved ? { remoteHash: remoteContentHash(pageContent(saved)) } : {}),
    };
    await updateMobileCourse(params.id, {
      chapters: course.chapters.map((c) => c.id !== chapter.id ? c : {
        ...c, cards: c.cards.map((k) => k.id === card.id ? updated : k),
      }),
    });
    return Response.json({ ok: true, card: updated, url, issues });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Save to Educative failed' }, { status: 502 });
  }
}
