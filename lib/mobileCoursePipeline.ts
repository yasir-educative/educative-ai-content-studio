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

// ── Raw card normaliser ───────────────────────────────────────────────────────
// The JSON generator returns snake_case aliases; the UI / MobileCard type uses
// camelCase names and expanded type strings (e.g. "compare" → "comparisonCards").

const TYPE_ALIAS: Record<string, MobileCardType> = {
  text:              'text',
  text_img:          'text_img',
  img_only:          'img_only',
  scenario:          'scenarioCard',
  scenariocard:      'scenarioCard',
  compare:           'comparisonCards',
  comparisoncards:   'comparisonCards',
  recap:             'recapCard',
  recapcard:         'recapCard',
  quiz:              'quiz',
  highlight:         'highlightCard',
  highlightcard:     'highlightCard',
  truefalse:         'trueFalseCard',
  true_false:        'trueFalseCard',
  truefalsecard:     'trueFalseCard',
  fillintheblank:    'fillInTheBlank',
  fill_in_the_blank: 'fillInTheBlank',
  'text-with-code':  'text-with-code',
  textwithcode:      'text-with-code',
  'code-with-output':'code-with-output',
  codewithoutput:    'code-with-output',
};

function normalizeType(raw: string): MobileCardType {
  const key = raw.toLowerCase().replace(/[\s-]/g, '_');
  return TYPE_ALIAS[key] || TYPE_ALIAS[raw.toLowerCase()] || 'text';
}

function mapRawCard(raw: any, index: number): MobileCard {
  const type = normalizeType(String(raw.card_type || raw.type || 'text'));
  const isRecap = type === 'recapCard';
  const isScenario = type === 'scenarioCard';
  const isCompare = type === 'comparisonCards';

  // The model wraps scenario/compare content in a content.tabs array:
  // { label, text } pairs — first two become left/right for compare,
  // all become sections for scenario.
  const tabs: Array<{ label: string; text: string }> = Array.isArray(raw.content?.tabs)
    ? raw.content.tabs
    : [];

  // scenarioCard: tabs → sections[{heading, content}], scenario_type
  const sections: Array<{ heading: string; content: string }> = isScenario
    ? (raw.sections || tabs.map((t: any) => ({ heading: t.label || '', content: t.text || '' })))
    : raw.sections;

  // comparisonCards: tabs[0] → leftOption, tabs[1] → rightOption
  const leftOption = isCompare
    ? (raw.leftOption || raw.left_option || (tabs[0] ? { label: tabs[0].label, heading: '', description: tabs[0].text } : undefined))
    : (raw.leftOption || raw.left_option);
  const rightOption = isCompare
    ? (raw.rightOption || raw.right_option || (tabs[1] ? { label: tabs[1].label, heading: '', description: tabs[1].text } : undefined))
    : (raw.rightOption || raw.right_option);

  // Plain text content for text/text_img cards
  const text = (isRecap || isScenario || isCompare)
    ? undefined
    : (typeof raw.content === 'string' ? raw.content : raw.text || '');

  // recapCard: content is [{heading, text}]
  const recapContent = isRecap ? (Array.isArray(raw.content) ? raw.content : undefined) : undefined;

  return {
    id: raw.id || `card-${index + 1}`,
    type,
    card_number: Number(raw.card_number || index + 1),
    title: raw.title || raw.card_title || '',
    text,
    illustration_idea: raw.illustration_idea || '',
    visible_labels: raw.visible_labels || '',
    imageUrl: raw.imageUrl || raw.image_url || '',
    img_context: raw.img_context || '',
    text_1: raw.text_1 || '',
    text_2: raw.text_2 || '',
    language: raw.language || '',
    code: raw.code || '',
    output_available: raw.output_available,
    output: raw.output || '',
    heading: raw.heading || '',
    leftOption,
    rightOption,
    content: recapContent,
    question: raw.question || '',
    options: raw.options,
    correctAnswer: raw.correctAnswer ?? raw.correct_answer,
    incorrectMessage: raw.incorrectMessage || raw.incorrect_message || '',
    explanation: raw.explanation || '',
    correctOptions: raw.correctOptions || raw.correct_options,
    sections,
    scenarioType: raw.scenarioType || raw.scenario_type || raw.content?.scenario_type || '',
    highlightCardType: raw.highlightCardType || raw.highlight_card_type || '',
  };
}

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

// ── TEXT_IMG prose enforcer ───────────────────────────────────────────────────

function hasListViolation(text: string): boolean {
  return String(text || '')
    .split('\n')
    .some((l) => l.trim().startsWith('-') || l.trim().startsWith('>') || l.trim().startsWith('|'));
}

async function enforceTextImgProse(cards: any[]): Promise<any[]> {
  const textField = (c: any) => c.content || c.text || '';
  const violators = cards.filter((c) => c.card_type === 'TEXT_IMG' && hasListViolation(textField(c)));
  if (violators.length === 0) return cards;

  const prompt = `You are a prose editor fixing TEXT_IMG card content. Each card below has bullet lists or blockquotes that must be removed. Rewrite ONLY the content field of each card as a single prose paragraph of 1-2 sentences (240-280 chars). The prose must state the key insight or consequence — NOT the steps. The diagram already shows the steps. Ask: "What does completing all these steps achieve? Why does it matter?" — write that as prose.

Cards to fix:
${JSON.stringify(
  violators.map((c) => ({
    card_number: c.card_number,
    current_content: textField(c),
    illustration_idea: c.illustration_idea,
  })),
)}

Rules:
- Return a JSON array with objects: { "card_number": N, "new_content": "..." }
- new_content must be a single prose paragraph, 240-280 chars
- No hyphens at line start, no blockquotes, no tables
- Describe consequence/insight, not steps
- Raw JSON only, no markdown fences`;

  try {
    const raw = await generateText(prompt, { maxTokens: 4000, noThinking: true });
    const parsed = JSON.parse(raw.trim().replace(/^```json\n?|```$/g, ''));
    const rewrites: Record<number, string> = {};
    for (const r of (Array.isArray(parsed) ? parsed : [])) {
      if (r.card_number && r.new_content) rewrites[Number(r.card_number)] = r.new_content;
    }
    return cards.map((c) => {
      const rewritten = c.card_type === 'TEXT_IMG' ? rewrites[Number(c.card_number)] : undefined;
      return rewritten ? { ...c, content: rewritten } : c;
    });
  } catch {
    return cards;
  }
}

// ── Per-chapter processing ────────────────────────────────────────────────────

export async function processChapter(
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

  // Post-process: enforce prose-only content on TEXT_IMG cards before refiner sees them
  generatedCards = await enforceTextImgProse(generatedCards);

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

  // Sort by card_number, then normalize all raw fields to MobileCard shape.
  finalCards = [...finalCards]
    .sort((a: any, b: any) => (a.card_number || 0) - (b.card_number || 0))
    .map((c: any, i: number) => mapRawCard(c, i));

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
