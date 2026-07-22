// Mobile Course Card Generation Pipeline
// Mirrors the n8n "Mobile Course - GPT Image" workflow:
//   1. Fetch Educative collection structure (TOC only, or use previewed chapters)
//   2. Per chapter: fetch lesson content → Card Planner → Cards Generator → Card Text Refiner → JSON Generator
//   3. Generate portrait AI images for text_img and img_only cards

import { generateText, parseJsonLoose } from './ai';
import { fetchCollectionWithContent, fetchLessonContent, CollectionChapterData } from './courseEducative';
import { generateGptImage, slugify } from './imageGen';
import type { MobileCard, MobileCardType, MobileChapter } from './mobileCourseStorage';
import {
  registeredCardPlannerPrompt,
  registeredCardsGeneratorPrompt,
  registeredCardTextRefinerPrompt,
  registeredJsonGeneratorPrompt,
} from './mobileCoursePromptsRegistry';

export interface PreviewedLesson {
  pageId: string;
  title: string;
  content?: string;
}

export interface PreviewedChapter {
  id: string;
  title: string;
  lessons: PreviewedLesson[];
}

export interface MobileCourseInput {
  collectionId: string;
  authorId: string;
  courseTitle?: string;
  targetCollectionId?: string;
  previewedChapters?: PreviewedChapter[];
}

export interface MobileCourseEvent {
  type: 'meta' | 'stage' | 'data' | 'log' | 'done' | 'error' | 'cancelled';
  name?: string;
  status?: 'start' | 'done' | 'error';
  message?: string;
  payload?: any;
  courseId?: string;
}

export type MobileCourseEmit = (e: MobileCourseEvent) => void;

// ── Image prompt builder (exact n8n template) ─────────────────────────────────

function buildCardImagePrompt(card: any): string {
  const illustrationIdea = String(card.illustration_idea || '');
  const visibleLabels = String(card.visible_labels || '');
  const title = String(card.title || '');
  const hasLabels = visibleLabels.trim().length > 0;

  if (card.type === 'img_only') {
    const imgContext = String(card.img_context || '');
    const labelsBlock = hasLabels
      ? `Render these labels, each exactly once: "${visibleLabels}". Add short annotations (2–8 words) where they clarify.`
      : `Derive labels and annotations from the illustration idea and context. Label every key element with short phrases (2–8 words).`;
    return `Self-contained technical infographic, portrait 640×1024, white (#FFF) background. No external text — viewer must fully understand the concept from this diagram and annotations alone.\n\nLayout: 24px margins. Top-to-bottom or left-to-right flow. Center-aligned. 5–10 primary elements — rich but not cluttered. Generous whitespace. Arrows, connector lines, numbered steps for hierarchy.\n\nStyle: Flat 2D vector only. 2px uniform stroke, 8px rounded corners. Outlined shapes with white or pale tinted fill. Consistent icon size per tier. No 3D, no perspective, no shadows, no gradients, no cartoon characters, no hand-drawn or sketch style.\n\nColors: Only these — #4A90D9 (blue), #3AAFA9 (teal) as primary. #48BB78 (green), #E6A817 (amber) sparingly as accent. All text #2D3748. No reds, no grays, no off-palette colors.\n\nAnnotations: Callouts, labeled arrows, step numbers on elements. Enough detail for zero prior knowledge. Every annotation carries weight.\n\nText: ${labelsBlock} Capitalize first word of every label, rest lowercase unless acronym. Example: "API gateway" not "api gateway" or "API Gateway". Geometric sans-serif, medium weight. No paragraphs, no title. No misspellings.\n\nIllustration idea: "${illustrationIdea}"\nContext (do NOT render as text): "${title} — ${imgContext}"`;
  }

  // text_img
  const content = String(card.text || '');
  const labelsBlock = hasLabels
    ? `Render ONLY these labels, each exactly once: "${visibleLabels}". Short clarifying labels (2–5 words) on connectors allowed.`
    : `Derive concise labels (2–5 words each) from the illustration idea and context. Label every key element.`;
  return `Technical infographic, portrait 640×1024, white (#FFF) background. Diagram-only — no title, no heading, no paragraphs.\n\nLayout: 24px margins. Top-to-bottom or left-to-right flow. Center-aligned. 4–8 primary elements maximum — not too sparse, not cluttered. Generous whitespace between logical groups. Arrows and connector lines for hierarchy.\n\nStyle: Flat 2D vector only. 2px uniform stroke, 8px rounded corners. Outlined shapes with white or pale tinted fill. Consistent icon size per tier. Absolutely no 3D, no perspective, no shadows, no gradients, no cartoon characters, no hand-drawn or sketch style, no textures.\n\nColors: Only these — #4A90D9 (blue) and #3AAFA9 (teal) as primary. #48BB78 (green) and #E6A817 (amber) sparingly as accent. All text #2D3748. No reds, no grays, no off-palette colors.\n\nText: ${labelsBlock} Capitalize first word of every label, rest lowercase unless acronym. Example: "API gateway" not "api gateway" or "API Gateway". Geometric sans-serif, medium weight. No misspellings.\n\nIllustration idea: "${illustrationIdea}"\nContext (do NOT render as text): "${title} — ${content}"`;
}

// ── Image generation ──────────────────────────────────────────────────────────

async function generateCardImage(
  card: any,
  order: number,
  courseId: string,
  chapterId: string,
): Promise<string | null> {
  try {
    const subfolder = `mobile-courses/${slugify(courseId)}/${slugify(chapterId)}`;
    const rawPrompt = buildCardImagePrompt(card);
    const result = await generateGptImage(card.illustration_idea || '', order, subfolder, {
      size: '1024x1536',
      rawPrompt,
    });
    return result.url;
  } catch (e: any) {
    console.warn('[mobileCoursePipeline] image gen failed:', e?.message);
    return null;
  }
}

// ── Per-chapter processing ────────────────────────────────────────────────────

async function processChapter(
  courseTitle: string,
  chapterTitle: string,
  lessonTitles: string[],
  content: string,
  courseId: string,
  chapterId: string,
  emit: MobileCourseEmit,
): Promise<MobileCard[]> {
  // Stage 1: Card Planner
  emit({ type: 'stage', name: `${chapterId}-card-planner`, status: 'start' });
  const plannerOut = await generateText(
    registeredCardPlannerPrompt({ courseTitle, chapterTitle, lessonList: lessonTitles.join(', '), content: content.slice(0, 6000) }),
    { maxTokens: 4000, noThinking: true },
  );
  let cardPlan: any[] = [];
  try {
    cardPlan = parseJsonLoose(plannerOut);
    if (!Array.isArray(cardPlan)) cardPlan = [];
  } catch {
    cardPlan = [];
  }
  emit({ type: 'data', name: `${chapterId}-card-planner`, payload: cardPlan });
  emit({ type: 'stage', name: `${chapterId}-card-planner`, status: 'done' });

  if (!cardPlan.length) {
    emit({ type: 'log', name: chapterId, message: 'Card planner returned empty plan — skipping chapter' });
    return [];
  }

  // Stage 2: Cards Generator
  emit({ type: 'stage', name: `${chapterId}-cards-generator`, status: 'start' });
  const generatorOut = await generateText(
    registeredCardsGeneratorPrompt({ planStr: JSON.stringify(cardPlan) }),
    { maxTokens: 8000, noThinking: true },
  );
  let generatedCards: any[] = [];
  try {
    generatedCards = parseJsonLoose(generatorOut);
    if (!Array.isArray(generatedCards)) generatedCards = [];
  } catch {
    generatedCards = [];
  }
  emit({ type: 'data', name: `${chapterId}-cards-generator`, payload: generatedCards });
  emit({ type: 'stage', name: `${chapterId}-cards-generator`, status: 'done' });

  if (!generatedCards.length) {
    emit({ type: 'log', name: chapterId, message: 'Cards generator returned empty — using plan as fallback' });
    return [];
  }

  // Stage 3: Card Text Refiner
  emit({ type: 'stage', name: `${chapterId}-text-refiner`, status: 'start' });
  const refinerOut = await generateText(
    registeredCardTextRefinerPrompt({ cards: JSON.stringify(generatedCards) }),
    { maxTokens: 8000, noThinking: true },
  );
  let refinedCards: any[] = [];
  try {
    refinedCards = parseJsonLoose(refinerOut);
    if (!Array.isArray(refinedCards)) refinedCards = generatedCards;
  } catch {
    refinedCards = generatedCards;
  }
  emit({ type: 'stage', name: `${chapterId}-text-refiner`, status: 'done' });

  // Stage 4: JSON Generator (format normalization)
  emit({ type: 'stage', name: `${chapterId}-json-generator`, status: 'start' });
  const jsonGenOut = await generateText(
    registeredJsonGeneratorPrompt({ refinedInput: JSON.stringify(refinedCards) }),
    { maxTokens: 8000, noThinking: true },
  );
  let finalCards: any[] = [];
  try {
    finalCards = parseJsonLoose(jsonGenOut);
    if (!Array.isArray(finalCards)) finalCards = refinedCards;
  } catch {
    finalCards = refinedCards;
  }
  emit({ type: 'stage', name: `${chapterId}-json-generator`, status: 'done' });

  // Sort by card_number (JSON Generator assigns these as sequential integers)
  finalCards = [...finalCards].sort((a: any, b: any) => (a.card_number || 0) - (b.card_number || 0));

  // Assign stable IDs
  finalCards = finalCards.map((c: any, i: number) => ({
    ...c,
    id: c.id || `card-${i + 1}`,
  }));

  // Stage 5: Generate images for text_img and img_only cards
  const imageCards = finalCards.filter(
    (c: any) => (c.type === 'text_img' || c.type === 'img_only') && c.illustration_idea,
  );
  if (imageCards.length > 0) {
    emit({ type: 'stage', name: `${chapterId}-images`, status: 'start' });
    await Promise.all(
      finalCards.map(async (card, idx) => {
        if ((card.type === 'text_img' || card.type === 'img_only') && card.illustration_idea) {
          const url = await generateCardImage(card, idx, courseId, chapterId);
          if (url) card.imageUrl = url;
        }
      }),
    );
    emit({ type: 'stage', name: `${chapterId}-images`, status: 'done' });
  }

  return finalCards as MobileCard[];
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runMobileCoursePipeline(
  input: MobileCourseInput,
  courseId: string,
  onChapterDone: (chapter: MobileChapter) => void,
  emit: MobileCourseEmit,
): Promise<{ title: string; chapters: MobileChapter[] }> {
  let courseTitle = input.courseTitle || '';
  let chaptersToProcess: CollectionChapterData[];

  if (input.previewedChapters && input.previewedChapters.length > 0) {
    // Step 1: Fetch only lesson content for user-selected chapters (skip TOC)
    emit({ type: 'stage', name: 'fetch-content', status: 'start' });
    chaptersToProcess = await Promise.all(
      input.previewedChapters.map(async (ch) => {
        const lessons = await Promise.all(
          ch.lessons.map(async (l) => {
            const content = l.content !== undefined
              ? l.content
              : await fetchLessonContent(input.authorId, input.collectionId, l.pageId);
            return { pageId: l.pageId, title: l.title, content };
          }),
        );
        return { id: ch.id, title: ch.title, summary: '', lessons };
      }),
    );
    emit({ type: 'data', name: 'fetch-content', payload: { chapterCount: chaptersToProcess.length } });
    emit({ type: 'stage', name: 'fetch-content', status: 'done' });
  } else {
    // Step 1: Fetch full collection (TOC + content)
    emit({ type: 'stage', name: 'fetch-collection', status: 'start' });
    const { title, chapters } = await fetchCollectionWithContent(input.authorId, input.collectionId);
    courseTitle = courseTitle || title;
    chaptersToProcess = chapters;
    emit({ type: 'data', name: 'fetch-collection', payload: { title, chapterCount: chapters.length } });
    emit({ type: 'stage', name: 'fetch-collection', status: 'done' });
  }

  // Step 2: Process all chapters in parallel
  const processedChapters: MobileChapter[] = await Promise.all(
    chaptersToProcess.map(async (rawChapter, i) => {
      const chapterId = rawChapter.id || `ch-${i + 1}`;

      const chapter: MobileChapter = {
        id: chapterId,
        title: rawChapter.title || `Chapter ${i + 1}`,
        cards: [],
        status: 'processing',
      };

      emit({ type: 'stage', name: `chapter-${i + 1}`, status: 'start', message: rawChapter.title });

      try {
        const lessonTitles = rawChapter.lessons.map((l) => l.title).filter(Boolean);
        const combinedContent = rawChapter.lessons
          .map((l) => (l.title ? `### ${l.title}\n\n${l.content}` : l.content))
          .join('\n\n---\n\n');

        if (!combinedContent.trim()) {
          emit({ type: 'log', name: `chapter-${i + 1}`, message: 'Empty chapter content — skipping' });
          chapter.status = 'done';
          onChapterDone(chapter);
          emit({ type: 'stage', name: `chapter-${i + 1}`, status: 'done' });
          return chapter;
        }

        const cards = await processChapter(
          courseTitle,
          rawChapter.title,
          lessonTitles,
          combinedContent,
          courseId,
          chapterId,
          emit,
        );

        chapter.cards = cards;
        chapter.status = 'done';
        onChapterDone(chapter);
        emit({
          type: 'data',
          name: `chapter-${i + 1}-cards`,
          payload: { chapterTitle: rawChapter.title, cardCount: cards.length },
        });
        emit({ type: 'stage', name: `chapter-${i + 1}`, status: 'done' });
      } catch (e: any) {
        chapter.status = 'failed';
        chapter.errorMessage = e?.message;
        onChapterDone(chapter);
        emit({ type: 'log', name: `chapter-${i + 1}`, message: `Chapter failed: ${e?.message}` });
        emit({ type: 'stage', name: `chapter-${i + 1}`, status: 'error', message: e?.message });
      }

      return chapter;
    }),
  );

  return { title: courseTitle, chapters: processedChapters };
}
