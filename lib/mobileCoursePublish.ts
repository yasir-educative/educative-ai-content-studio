// Builders and parser for a published mobile card page.
//
// The builder turns a MobileCard into Educative FlashCard components; the
// parser turns those components back into a MobileCard. They live together
// deliberately: they are inverses, and splitting them is how they drift.
//
// Both course publish routes used their own copy of these builders and had
// already diverged — the chapter route published a blank card where the
// whole-course route skipped it. This is the whole-course version.

import { uploadLessonImageFromUrl } from './courseEducative';
import { applyScenarioHeadings, normalizeScenarioCardType, scenarioHeadings } from './mobileCardTypes';
import type { MobileCard } from './mobileCourseStorage';
import { pageContent, remoteContentHash } from './remoteContent';

function uid(prefix = '') {
  return `${prefix}${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

export function safeStr(v: any): string {
  return String(v ?? '').trim();
}

function firstNonEmpty(arr: any[]): string {
  for (const v of arr) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

function resolveComponentTitle(card: MobileCard, pageTitle: string, fallback: string): string {
  return firstNonEmpty([pageTitle, card.title, (card as any).heading, (card as any).summary?.title, fallback]);
}

export function makeFlashCard(
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

export function makeSlateHTML(withId = false): any {
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

// ── Per-type builders (non-image cards) ───────────────────────────────────────

export function buildCardComponents(
  card: MobileCard,
  pageTitle: string,
): { components: any[]; summary: any } | null {
  switch (card.type) {
    case 'text': {
      const t = resolveComponentTitle(card, pageTitle, 'Text Card');
      const body = safeStr(card.text);
      if (!body) return null; // no content — skip rather than publish blank
      return {
        components: [makeFlashCard(t, 'text-only', body, '', 6, 1), makeSlateHTML(true)],
        summary: { title: t, titleUpdated: true },
      };
    }

    case 'highlightCard': {
      const t = resolveComponentTitle(card, pageTitle, 'Highlight Card');
      const body = safeStr(card.text);
      if (!body) return null; // no content — skip rather than publish blank
      const payload: any = { type: 'highlightCard', title: t, text: body };
      if (card.highlightCardType) payload.highlightCardType = card.highlightCardType;
      return {
        components: [makeFlashCard(t, 'custom', '', JSON.stringify(payload), 3, 1), makeSlateHTML(false)],
        summary: { title: t, titleUpdated: true },
      };
    }

    case 'comparisonCards': {
      const heading = safeStr(card.heading);
      const t = resolveComponentTitle(card, pageTitle, heading || 'Comparison');
      const leftDesc = safeStr(card.leftOption?.description);
      const rightDesc = safeStr(card.rightOption?.description);
      if (!leftDesc && !rightDesc) return null; // both sides empty — skip rather than publish blank
      const payload = {
        type: 'comparisonCards',
        title: t,
        heading,
        leftOption: {
          label: safeStr(card.leftOption?.label),
          heading: safeStr(card.leftOption?.heading),
          description: leftDesc,
        },
        rightOption: {
          label: safeStr(card.rightOption?.label),
          heading: safeStr(card.rightOption?.heading),
          description: rightDesc,
        },
      };
      return {
        components: [makeFlashCard(t, 'custom', '', JSON.stringify(payload), 6, 2), makeSlateHTML(true)],
        summary: { title: t, titleUpdated: true },
      };
    }

    case 'quiz': {
      const t = resolveComponentTitle(card, pageTitle, 'Quiz');
      const payload = {
        type: 'quiz',
        title: t,
        question: safeStr(card.question),
        options: normalizeOptions((card.options as any[]) || []),
        correctAnswer: Number(card.correctAnswer ?? 0) || 0,
        incorrectMessage: safeStr(card.incorrectMessage),
      };
      return {
        components: [makeFlashCard(t, 'custom', '', JSON.stringify(payload), 6, 1), makeSlateHTML(false)],
        summary: { title: t, titleUpdated: true },
      };
    }

    case 'recapCard': {
      const t = resolveComponentTitle(card, pageTitle, 'Recap');
      const payload = {
        type: 'recapCard',
        title: t,
        heading: safeStr(card.heading),
        content: (card.content || [])
          .map((i) => ({ heading: safeStr(i.heading), text: safeStr(i.text) }))
          .filter((i) => i.heading || i.text),
      };
      return {
        components: [makeFlashCard(t, 'custom', '', JSON.stringify(payload), 3, 3), makeSlateHTML(false)],
        summary: { title: t, titleUpdated: true },
      };
    }

    case 'fillInTheBlank': {
      const t = resolveComponentTitle(card, pageTitle, 'Fill in the Blank');
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
        components: [makeFlashCard(t, 'custom', '', JSON.stringify(payload), 1, 8), makeSlateHTML(true)],
        summary: { title: t, titleUpdated: true },
      };
    }

    case 'scenarioCard': {
      const t = resolveComponentTitle(card, pageTitle, 'Scenario Card');
      // The variant owns the headings, so publish them from it rather than from
      // whatever the card happens to carry.
      const scenarioType = normalizeScenarioCardType(card.scenarioType, card.sections);
      const headings = scenarioHeadings(scenarioType);
      const payload: any = {
        type: 'scenarioCard',
        title: t,
        sections: (card.sections || [])
          .map((s, i) => ({ heading: safeStr(headings?.[i] ?? s.heading), content: safeStr(s.content) }))
          .filter((s) => s.heading || s.content),
        explanation: safeStr(card.explanation),
      };
      if (scenarioType) payload.scenarioType = scenarioType;
      return {
        components: [makeFlashCard(t, 'custom', '', JSON.stringify(payload), 1, 3), makeSlateHTML(true)],
        summary: { title: t, titleUpdated: true },
      };
    }

    case 'text-with-code': {
      const t = resolveComponentTitle(card, pageTitle, safeStr(card.title) || 'Custom Card');
      const payload = {
        type: 'text-with-code',
        card_number: card.card_number,
        title: t,
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
      const t = resolveComponentTitle(card, pageTitle, 'True / False');
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
      const t = resolveComponentTitle(card, pageTitle, safeStr(card.title) || 'Code With Output');
      const payload = {
        type: 'code-with-output',
        card_number: safeStr(card.card_number ?? ''),
        title: t,
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

// ── Image card builder — mirrors n8n "Format Card Widget" exactly ─────────────
// Image is embedded inside the FlashCard (cardType: "image-with-text"), not a
// separate Image block. img_only gets imageOnly:true and empty text.

export function buildMobileImageFlashCard(
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

// ── Title derivation ──────────────────────────────────────────────────────────

export function deriveCardTitle(card: MobileCard): string {
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

/**
 * Inverse of the builders above: a published page back into a card we can show
 * and edit. Anything we cannot parse becomes a readOnly card that keeps its raw
 * content, so an unexpected page is visible rather than silently dropped, and
 * is never republished.
 */
export function parseMobileCard(
  page: any,
  identity: { id: string; pageId?: string; card_number?: number },
): MobileCard {
  let content: any;
  try {
    content = pageContent(page);
  } catch (e: any) {
    return {
      ...identity, type: 'text', readOnly: e.message, rawRemoteContent: page,
      remoteHash: remoteContentHash(page), remoteSyncedAt: new Date().toISOString(),
    };
  }
  const base = {
    ...identity,
    remoteHash: remoteContentHash(content),
    remoteSyncedAt: new Date().toISOString(),
  };
  try {
    const flash = content.components.filter((c: any) => c.type === 'FlashCard');
    if (flash.length !== 1 || content.components.some((c: any) => !['FlashCard', 'SlateHTML'].includes(c.type))) {
      throw new Error('Unsupported page widgets');
    }
    const c = flash[0].content;
    const title = c.title || content.summary?.title || '';

    if (c.cardType === 'text-only') return { ...base, type: 'text', title, text: c.text };

    if (c.cardType === 'image-with-text') {
      if (!c.image_file_download_url) throw new Error('Missing image URL');
      // The image stays on Educative; nothing is re-uploaded on import.
      return {
        ...base,
        type: c.imageOnly ? 'img_only' : 'text_img',
        title,
        ...(c.imageOnly ? { img_context: title } : { text: c.text }),
        imageUrl: c.image_file_download_url,
        illustration_idea: title,
      };
    }

    // Kinds Educative supports but this app does not author. The prose is the
    // bulk of the card, so keep it readable; readOnly stops a save from
    // rebuilding the page as plain text and dropping the animation or diagram.
    if (c.cardType === 'text-with-animation') {
      return {
        ...base, type: 'text', title, text: c.text || '',
        remoteKind: 'text-with-animation',
        lottieUrl: c.lottieFile?.downloadUrl || '',
        lottieName: c.lottieFile?.name || '',
        readOnly: 'Animated card. Edit it in Educative; saving here would drop the animation.',
      };
    }
    if (c.cardType === 'd2-card') {
      return {
        ...base, type: 'text', title, text: c.text || '',
        remoteKind: 'd2-card',
        d2Code: c.d2Code || '',
        d2Url: c.d2File?.downloadUrl || '',
        readOnly: 'Diagram card. Edit it in Educative; saving here would drop the diagram.',
      };
    }

    if (c.cardType !== 'custom') throw new Error('Unknown FlashCard format');
    const payload = JSON.parse(c.customContent);
    // The builder is the authority on which custom formats exist.
    if (!buildCardComponents({ ...payload, id: identity.id }, title)) throw new Error('Unknown custom card type');
    if (payload.type === 'code-with-output') {
      payload.output_available = String(payload.output_available) === 'true';
      if (payload.card_number !== '' && payload.card_number !== undefined) payload.card_number = Number(payload.card_number);
      else delete payload.card_number;
    }
    // A published scenario can carry a variant this app no longer offers, or
    // none at all. Read it back from the headings before the editor sees it.
    if (payload.type === 'scenarioCard') {
      payload.scenarioType = normalizeScenarioCardType(payload.scenarioType, payload.sections);
      Object.assign(payload, applyScenarioHeadings(payload));
    }
    return { ...payload, ...base, title };
  } catch (e: any) {
    return {
      ...base, type: 'text', title: content.summary?.title || 'Unsupported page',
      readOnly: e.message, rawRemoteContent: content,
    };
  }
}

/**
 * Build the page body for one card, uploading its image first when it has one.
 *
 * shortcut: the whole-course and per-card publish routes still carry their own
 * copies of this; fold them in when one of them next needs a change.
 */
export async function buildCardPage(
  card: MobileCard,
  title: string,
  ctx: { authorId: string; collectionId: string; pageId: string },
): Promise<{ components: any[]; summary: any }> {
  if (card.type !== 'text_img' && card.type !== 'img_only') {
    const built = buildCardComponents(card, title);
    if (!built) throw new Error(`Unsupported card type: ${card.type}`);
    return built;
  }
  if (card.imageUrl) {
    const uploaded = await uploadLessonImageFromUrl(ctx.authorId, ctx.collectionId, ctx.pageId, card.imageUrl);
    if (uploaded) {
      return buildMobileImageFlashCard(
        title, safeStr(card.text), card.type === 'img_only',
        uploaded.imageId, uploaded.imageFileDownloadUrl, uploaded.sizeInBytes,
      );
    }
    if (card.type === 'img_only') throw new Error('Image upload failed');
  }
  // A text_img card without a usable image still teaches; an img_only one is empty.
  if (card.type === 'text_img' && card.text) {
    return {
      components: [makeFlashCard(title, 'text-only', safeStr(card.text), '', 6, 1), makeSlateHTML(true)],
      summary: { title, titleUpdated: true },
    };
  }
  throw new Error('This image card has no usable image');
}
