import { NextRequest } from 'next/server';
import { getMobileShort, updateMobileShort } from '@/lib/mobileShortsStorage';
import {
  createFlashCardShotCollection,
  createLesson,
  saveMobileCardPage,
  addPageToChapter,
  uploadLessonImageFromUrl,
  setCollectionTitle,
  publishCourse,
  lessonUrlForIds,
} from '@/lib/courseEducative';
import type { MobileCard } from '@/lib/mobileCourseStorage';

export const runtime = 'nodejs';
export const maxDuration = 600;

// ── Low-level helpers (mirrors mobile-course publish route) ───────────────────

function uid(prefix = ''): string {
  return `${prefix}${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function safeStr(v: any): string {
  return String(v ?? '').trim();
}

function firstNonEmpty(arr: any[]): string {
  for (const v of arr) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

function makeFlashCard(
  title: string,
  cardType: 'text-only' | 'custom',
  text: string,
  customContent: string,
  iteration: number,
  saveVersion: number,
): any {
  return {
    type: 'FlashCard',
    mode: 'edit',
    content: {
      title,
      cardType,
      text,
      customContent,
      animationTypeForward: 'full-screen-scroll',
      animationTypeBackward: 'full-screen-scroll',
      comp_id: uid('flash_'),
    },
    iteration,
    hash: 0,
    children: [{ text: '' }],
    status: 'normal',
    contentID: uid('content_'),
    saveVersion,
  };
}

function makeSlateHTML(withId = false): any {
  const compId = uid('slate_');
  const html = withId ? `<p id="${compId}"></p>` : '<p></p>';
  return { type: 'SlateHTML', content: { html, comp_id: compId }, hash: 1 };
}

function normalizeOptions(options: any[]): Array<{ id: number; text: string }> {
  return (options || [])
    .map((o, idx) => {
      const id = typeof o === 'object' ? Number(o?.id ?? idx + 1) : idx + 1;
      const text = typeof o === 'object' ? safeStr(o?.text ?? o?.label ?? '') : safeStr(o);
      return text ? { id, text } : null;
    })
    .filter(Boolean) as Array<{ id: number; text: string }>;
}

function buildCardComponents(
  card: MobileCard,
  pageTitle: string,
): { components: any[]; summary: any } | null {
  const resolveTitle = (fallback: string) =>
    firstNonEmpty([pageTitle, card.title, (card as any).heading, (card as any).summary?.title, fallback]);

  switch (card.type) {
    case 'text': {
      const t = resolveTitle('Text Card');
      return {
        components: [makeFlashCard(t, 'text-only', safeStr(card.text), '', 6, 1), makeSlateHTML(true)],
        summary: { title: t, titleUpdated: true },
      };
    }
    case 'highlightCard': {
      const t = resolveTitle('Highlight Card');
      const payload: any = { type: 'highlightCard', title: t, text: safeStr(card.text) };
      if (card.highlightCardType) payload.highlightCardType = card.highlightCardType;
      return {
        components: [makeFlashCard(t, 'custom', '', JSON.stringify(payload), 3, 1), makeSlateHTML(false)],
        summary: { title: t, titleUpdated: true },
      };
    }
    case 'comparisonCards': {
      const heading = safeStr(card.heading);
      const t = resolveTitle(heading || 'Comparison');
      const payload = {
        type: 'comparisonCards',
        title: t,
        heading,
        leftOption: {
          label: safeStr(card.leftOption?.label),
          heading: safeStr(card.leftOption?.heading),
          description: safeStr(card.leftOption?.description),
        },
        rightOption: {
          label: safeStr(card.rightOption?.label),
          heading: safeStr(card.rightOption?.heading),
          description: safeStr(card.rightOption?.description),
        },
      };
      return {
        components: [makeFlashCard('', 'custom', '', JSON.stringify(payload), 6, 2), makeSlateHTML(true)],
        summary: { title: t, titleUpdated: true },
      };
    }
    case 'quiz': {
      const t = resolveTitle('Quiz');
      const payload = {
        type: 'quiz',
        title: safeStr(card.title),
        question: safeStr(card.question),
        options: normalizeOptions((card.options as any[]) || []),
        correctAnswer: Number(card.correctAnswer ?? 0) || 0,
        incorrectMessage: safeStr(card.incorrectMessage),
      };
      return {
        components: [makeFlashCard('', 'custom', '', JSON.stringify(payload), 6, 1), makeSlateHTML(false)],
        summary: { title: t, titleUpdated: true },
      };
    }
    case 'recapCard': {
      const t = resolveTitle('Recap');
      const payload = {
        type: 'recapCard',
        heading: safeStr(card.heading),
        title: safeStr(card.title),
        content: (card.content || [])
          .map((i) => ({ heading: safeStr(i.heading), text: safeStr(i.text) }))
          .filter((i) => i.heading || i.text),
      };
      return {
        components: [makeFlashCard('', 'custom', '', JSON.stringify(payload), 3, 3), makeSlateHTML(false)],
        summary: { title: t, titleUpdated: true },
      };
    }
    case 'fillInTheBlank': {
      const t = resolveTitle('Fill in the Blank');
      const payload = {
        type: 'fillInTheBlank',
        title: t,
        question: safeStr(card.question),
        options: (card.options || [])
          .map((o: unknown) => (typeof o === 'string' ? o : safeStr((o as Record<string, unknown>)?.text)))
          .filter(Boolean),
        correctOptions: (card.correctOptions || []).map(safeStr).filter(Boolean),
      };
      return {
        components: [makeFlashCard('', 'custom', '', JSON.stringify(payload), 1, 8), makeSlateHTML(true)],
        summary: { title: t, titleUpdated: true },
      };
    }
    case 'scenarioCard': {
      const t = resolveTitle('Scenario Card');
      const payload: any = {
        type: 'scenarioCard',
        title: t,
        sections: (card.sections || [])
          .map((s) => ({ heading: safeStr(s.heading), content: safeStr(s.content) }))
          .filter((s) => s.heading || s.content),
        explanation: safeStr(card.explanation),
      };
      if (card.scenarioType) payload.scenarioType = card.scenarioType;
      return {
        components: [makeFlashCard(t, 'custom', '', JSON.stringify(payload), 1, 3), makeSlateHTML(true)],
        summary: { title: t, titleUpdated: true },
      };
    }
    case 'text-with-code': {
      const t = resolveTitle(safeStr(card.title) || 'Custom Card');
      const payload = {
        type: 'text-with-code',
        card_number: card.card_number,
        title: safeStr(card.title),
        text_1: safeStr(card.text_1),
        text_2: safeStr(card.text_2),
        language: safeStr(card.language),
        code: safeStr(card.code),
      };
      return {
        components: [makeFlashCard(t, 'custom', '', JSON.stringify(payload), 2, 1), makeSlateHTML(false)],
        summary: { title: t, titleUpdated: true },
      };
    }
    case 'trueFalseCard': {
      const t = resolveTitle('True / False');
      const payload = {
        type: 'trueFalseCard',
        title: t,
        question: safeStr(card.question),
        correctAnswer: safeStr(card.correctAnswer).toLowerCase() === 'false' ? 'false' : 'true',
        explanation: safeStr(card.explanation),
      };
      return {
        components: [makeFlashCard(t, 'custom', '', JSON.stringify(payload), 2, 2), makeSlateHTML(true)],
        summary: { title: t, titleUpdated: true },
      };
    }
    case 'code-with-output': {
      const t = resolveTitle(safeStr(card.title) || 'Code With Output');
      const payload = {
        type: 'code-with-output',
        card_number: safeStr(card.card_number ?? ''),
        title: safeStr(card.title),
        code: safeStr(card.code),
        output_available: safeStr(card.output_available ?? 'false'),
        output: safeStr(card.output),
      };
      return {
        components: [makeFlashCard(t, 'custom', '', JSON.stringify(payload), 14, 2), makeSlateHTML(true)],
        summary: { title: t, titleUpdated: true },
      };
    }
    default:
      return null;
  }
}

function buildMobileImageFlashCard(
  title: string,
  text: string,
  isImgOnly: boolean,
  imageId: string,
  imageFileDownloadUrl: string,
  sizeInBytes: number,
): { components: any[]; summary: any } {
  const imageMeta = { width: 640, height: 1024, sizeInBytes, name: 'image.png' };
  const comp_id = uid('img_');
  const contentID = uid('content_');
  const slate_comp_id = uid('slate_');
  const contentObj: any = {
    title,
    cardType: 'image-with-text',
    text: isImgOnly ? '' : text,
    customContent: '',
    animationTypeForward: 'full-screen-scroll',
    animationTypeBackward: 'full-screen-scroll',
    comp_id,
    image_id: Number(imageId) || null,
    metadata: imageMeta,
    image_data: imageMeta,
    file: null,
    image_file_download_url: imageFileDownloadUrl,
    fetchFromBucket: true,
    svgString: null,
  };
  if (isImgOnly) contentObj.imageOnly = true;
  return {
    components: [
      {
        type: 'FlashCard',
        mode: 'edit',
        content: contentObj,
        iteration: 2,
        hash: 0,
        children: [{ text: '' }],
        status: 'normal',
        contentID,
        saveVersion: 2,
      },
      { type: 'SlateHTML', content: { html: '<p></p>', comp_id: slate_comp_id }, hash: 1 },
    ],
    summary: { title },
  };
}

function deriveCardTitle(card: MobileCard): string {
  const TYPE_FALLBACK: Record<string, string> = {
    text: 'Text Card',
    highlightCard: 'Highlight Card',
    trueFalseCard: 'True / False',
    fillInTheBlank: 'Fill in the Blank',
    scenarioCard: 'Scenario Card',
    comparisonCards: 'Comparison',
    recapCard: 'Recap',
    quiz: 'Quiz',
    'text-with-code': 'Custom Card',
    'code-with-output': 'Code With Output',
  };
  return firstNonEmpty([card.title, (card as any).heading, TYPE_FALLBACK[card.type]]);
}

// ── POST /api/mobile-short/[id]/publish ───────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const short = await getMobileShort(id);
  if (!short) return Response.json({ error: 'not found' }, { status: 404 });

  if (!short.cards?.length) return Response.json({ error: 'no cards to publish' }, { status: 400 });

  const results: Array<{ cardId: string; cardTitle: string; url: string }> = [];
  const errors: Array<{ cardId: string; cardTitle: string; error: string }> = [];

  // Step 1: Create flash-card-shot collection.
  // Pass any known authorId as a hint; the canonical author_id always comes back in the response.
  const hintAuthorId = short.authorId || process.env.EDUCATIVE_AUTHOR_ID || '';
  const { collectionId, authorId: resolvedAuthorId } = await createFlashCardShotCollection(hintAuthorId);

  // Step 2: Publish each card
  const updatedCards = [...short.cards];

  for (let ki = 0; ki < updatedCards.length; ki++) {
    const card = { ...updatedCards[ki] };
    updatedCards[ki] = card;
    const cardTitle = deriveCardTitle(card) || `Card ${ki + 1}`;

    try {
      const { page_id: pageId, collection_id: cid } = await createLesson(resolvedAuthorId, collectionId);
      const resolvedCid = cid || collectionId;

      let built: { components: any[]; summary: any } | null = null;

      if (card.type === 'text_img' || card.type === 'img_only') {
        if (card.imageUrl) {
          const uploaded = await uploadLessonImageFromUrl(resolvedAuthorId, resolvedCid, pageId, card.imageUrl);
          if (uploaded) {
            built = buildMobileImageFlashCard(
              cardTitle,
              safeStr(card.text),
              card.type === 'img_only',
              uploaded.imageId,
              uploaded.imageFileDownloadUrl,
              uploaded.sizeInBytes,
            );
          }
        }
        // Fallback: text_img with no image → text-only card
        if (!built && card.type === 'text_img' && card.text) {
          built = {
            components: [makeFlashCard(cardTitle, 'text-only', safeStr(card.text), '', 6, 1), makeSlateHTML(true)],
            summary: { title: cardTitle, titleUpdated: true },
          };
        }
        if (!built) {
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

      await saveMobileCardPage(resolvedAuthorId, resolvedCid, pageId, {
        title: cardTitle,
        components: built.components,
        summary: built.summary,
      });

      // Use topic as the chapter name so all cards group under one section
      await addPageToChapter(resolvedAuthorId, resolvedCid, pageId, short.topic, cardTitle);

      const url = lessonUrlForIds(resolvedAuthorId, resolvedCid, pageId);
      card.pageId = pageId;
      card.publishedUrl = url;
      results.push({ cardId: card.id, cardTitle, url });
    } catch (e: any) {
      const msg = e?.message || 'unknown error';
      console.error(`[short-publish] card ${card.id} (${cardTitle}) failed:`, msg);
      errors.push({ cardId: card.id, cardTitle, error: msg });
    }
  }

  if (results.length === 0) {
    return Response.json({ ok: false, errors }, { status: 422 });
  }

  // Step 3: Set the collection title (required — Educative rejects publish without title)
  await setCollectionTitle(resolvedAuthorId, collectionId, short.topic, short.topic);

  // Step 4: Publish the collection
  await publishCourse(resolvedAuthorId, collectionId);

  const publishedUrl = `https://www.educative.io/collection/${resolvedAuthorId}/${collectionId}`;

  // Step 5: Persist updated cards + collection info
  const updated = await updateMobileShort(id, {
    cards: updatedCards,
    collectionId,
    status: 'published',
    publishedUrl,
  });

  return Response.json({ ok: errors.length === 0, published: results.length, errors, results, short: updated });
}
