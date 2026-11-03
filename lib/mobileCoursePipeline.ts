// Mobile Course Card Generation Pipeline
// Mirrors the n8n "Mobile Course - GPT Image" workflow:
//   1. Fetch Educative collection structure (TOC only, or use previewed chapters)
//   2. Per chapter: structured plan → type decision → generator → structured refiner → course limits
//   3. Generate portrait AI images for text_img and img_only cards

import { generateText, generateJSON, parseJsonLoose } from './ai';
import { fetchCollectionWithContent, fetchLessonContent, CollectionChapterData } from './courseEducative';
import { generateGptImage, slugify } from './imageGen';
import type { MobileCard, MobileCardType, MobileChapter } from './mobileCourseStorage';
import { normalizeCardType, normalizeHighlightCardType, isHighlightCardType, coursePlannerToCardType, type CoursePlannerType } from './mobileCardTypes';
import {
  registeredCardPlannerPrompt,
  registeredCardsGeneratorPrompt,
  registeredCardTextRefinerPrompt,
} from './mobileCoursePromptsRegistry';

import { COURSE_PROFILE, chapterContainsCode, decideTypes, type PlannedCourseCard } from './cardTypeDecider';
import { COURSE_PLANNER_SCHEMA, SHORTS_CARDS_SCHEMA } from './mobileShortsSchemas';
import { enforceTextImgProse, enforceCharLimits } from './mobileShortsPipeline';
import { COURSE_CARD_LIMITS, checkCards } from './mobileCardLimits';
import { finishCards } from './mobileCardRepair';

interface CoursePlanCard {
  card_number: number;
  card_type: CoursePlannerType;
  card_title: string;
  content_focus: string;
  illustration_idea: string | null;
}

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
// Spelling variants are folded to canonical names in ./mobileCardTypes, shared
// with the shorts pipeline.

function normalizeType(raw: string): MobileCardType {
  return normalizeCardType(raw, 'mobileCoursePipeline');
}

// The generator writes practice cards in its own shape (quiz_options as strings, answer as text,
// statement/answers for true-false and blanks). Convert that in code before the refiner sees it:
// asking the refiner to do the conversion lost quiz options and scenario tabs in a live run.
export function canonicalizeGeneratorCard(raw: any, index: number): MobileCard {
  const type = normalizeType(String(raw.card_type || raw.type || 'text'));
  const out: any = { ...raw, type };
  const opts = raw.options ?? raw.quiz_options;
  const answer = raw.correctAnswer ?? raw.correct_answer ?? raw.answer;
  const prose = typeof raw.content === 'string' ? raw.content : '';
  if (type === 'quiz' && Array.isArray(opts)) {
    const options = opts.map((o: any, i: number) => typeof o === 'string'
      ? { id: i + 1, text: o }
      : { id: Number(o?.id) || i + 1, text: String(o?.text ?? '') });
    const key = String(answer ?? '').trim().toLowerCase();
    const hit = options.find((o: { id: number }) => o.id === Number(answer))
      || options.find((o: { text: string }) => o.text.trim().toLowerCase() === key);
    out.options = options;
    out.correctAnswer = hit?.id;
    out.incorrectMessage = raw.incorrectMessage || raw.incorrect_message || raw.incorrect_description || '';
  }
  if ((type === 'text-with-code' || type === 'code-with-output') && raw.content && typeof raw.content === 'object') {
    const c = raw.content;
    out.text_1 = raw.text_1 || c.text_before || c.text_1 || '';
    out.text_2 = raw.text_2 || c.text_after || c.text_2 || '';
    out.code = raw.code || c.code || '';
    out.language = raw.language || c.language || '';
    out.output = raw.output || c.output || '';
    out.output_available = raw.output_available ?? c.output_available ?? (out.output ? true : undefined);
    out.content = undefined;
  }
  if (type === 'trueFalseCard') {
    out.question = raw.question || raw.statement || prose;
    out.correctAnswer = String(answer ?? '').trim().toLowerCase();
  }
  if (type === 'fillInTheBlank') {
    out.question = raw.question || raw.statement || raw.sentence || prose;
    out.options = opts;
    const correct = raw.correctOptions ?? raw.correct_options ?? raw.correct_answers ?? raw.answers ?? answer;
    out.correctOptions = correct === undefined ? undefined : [].concat(correct);
  }
  return mapRawCard(out, index);
}

const REFINABLE_TEXT = ['title', 'text', 'text_1', 'text_2', 'question', 'incorrectMessage', 'explanation',
  'heading', 'output', 'illustration_idea', 'visible_labels', 'img_context'] as const;

function filled(items: unknown, keys: string[]): boolean {
  return Array.isArray(items) && items.every((it: any) => keys.every((k) => String(it?.[k] ?? '').trim()));
}

// Take the refiner's wording, never its structure: a structured field is accepted only when it keeps the
// same number of items and none of them is blank. Code, answers, and types always stay as generated.
export function mergeRefined(base: MobileCard, refined: any): MobileCard {
  const out: any = { ...base };
  for (const k of REFINABLE_TEXT) {
    if (typeof refined?.[k] === 'string' && refined[k].trim()) out[k] = refined[k];
  }
  const sameShape = (k: string, keys: string[]) =>
    filled(refined?.[k], keys) && (refined[k] as unknown[]).length === ((base as any)[k]?.length ?? -1);
  if (sameShape('sections', ['heading', 'content'])) out.sections = refined.sections;
  if (sameShape('content', ['heading', 'text'])) out.content = refined.content;
  if (base.type === 'quiz' && sameShape('options', ['text'])) {
    out.options = (refined.options as any[]).map((o, i) => ({ id: (base.options as any[])[i].id, text: o.text }));
  }
  // The refiner's schema restricts highlightCardType to the enum; use it when the free-text generator's value isn't valid.
  if (base.type === 'highlightCard' && !isHighlightCardType(base.highlightCardType) && isHighlightCardType(refined?.highlightCardType)) {
    out.highlightCardType = refined.highlightCardType;
  }
  for (const side of ['leftOption', 'rightOption'] as const) {
    if (filled([refined?.[side]], ['label', 'description'])) out[side] = { ...(base as any)[side], ...refined[side] };
  }
  return out;
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

  // Plain text content for text/text_img/highlightCard cards.
  // Guard: AI sometimes returns content as {text: "..."} instead of a plain string.
  const text = (isRecap || isScenario || isCompare)
    ? undefined
    : (
        typeof raw.content === 'string'
          ? raw.content
          : typeof raw.content?.text === 'string' && raw.content.text
            ? raw.content.text
            : raw.text || ''
      );

  // recapCard: content must be [{heading, text}].
  // Guard: AI sometimes wraps it as {items:[...]} / {content:[...]} or returns a plain string.
  const recapContent = isRecap
    ? (() => {
        if (Array.isArray(raw.content)) return raw.content;
        if (Array.isArray(raw.content?.items)) return raw.content.items;
        if (Array.isArray(raw.content?.content)) return raw.content.content;
        if (Array.isArray(raw.items)) return raw.items;
        if (typeof raw.content === 'string' && raw.content.trim())
          return [{ heading: '', text: raw.content.trim() }];
        return undefined;
      })()
    : undefined;

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
    highlightCardType: normalizeHighlightCardType(raw.highlightCardType || raw.highlight_card_type),
  };
}

// ── Image prompt builder ─────────────────────────────────────────────────────

// Shared with the shorts pipeline, and drawn in the style the author chose.
import { buildMobileCardImagePrompt } from './mobileCardImagePrompt';
export { buildMobileCardImagePrompt as buildCardImagePrompt } from './mobileCardImagePrompt';

// ── Image generation ──────────────────────────────────────────────────────────

export async function generateCardImage(
  card: any,
  order: number,
  courseId: string,
  chapterId: string,
  /** Style text to draw in; the chosen mobile style when left out. */
  styleBody?: string,
): Promise<string | null> {
  try {
    const subfolder = `mobile-courses/${slugify(courseId)}/${slugify(chapterId)}`;
    const rawPrompt = buildMobileCardImagePrompt(card, styleBody);
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
  const plannerOut = await generateJSON<{ cards: CoursePlanCard[] }>(
    registeredCardPlannerPrompt({ courseTitle, chapterTitle, lessonList: lessonTitles.join(', '), content: content.slice(0, 6000) }),
    COURSE_PLANNER_SCHEMA, { name: 'course_card_plan', tier: 'main', maxTokens: 8000 },
  );
  const cardPlan = [...plannerOut.cards].sort((a, b) => a.card_number - b.card_number)
    .map((card, index) => ({ ...card, card_number: index + 1 }));
  emit({ type: 'data', name: `${chapterId}-card-planner`, payload: cardPlan });
  emit({ type: 'stage', name: `${chapterId}-card-planner`, status: 'done' });

  if (!cardPlan.length) {
    emit({ type: 'log', name: chapterId, message: 'Card planner returned empty plan — skipping chapter' });
    return [];
  }

  const log = (message: string) => emit({ type: 'log', name: chapterId, message });
  emit({ type: 'stage', name: `${chapterId}-card-type-decision`, status: 'start' });
  const plan: PlannedCourseCard[] = cardPlan.map((card) => ({
    card_number: card.card_number, title: card.card_title, teaching_goal: card.content_focus,
    proposed_type: card.card_type, visual_idea: card.illustration_idea,
  }));
  const decided = await decideTypes(plan, {
    topic: `${courseTitle}: ${chapterTitle}`, additionalContext: lessonTitles.join(', '),
    sourceHasCode: chapterContainsCode(content),
  }, log, COURSE_PROFILE);
  emit({ type: 'data', name: `${chapterId}-card-type-decision`, payload: { cards: decided } });
  emit({ type: 'stage', name: `${chapterId}-card-type-decision`, status: 'done' });
  const fixedPlan = cardPlan.map((card, index) => ({ ...card, card_type: decided[index].decision.chosen }));

  // Stage 2: Cards Generator
  emit({ type: 'stage', name: `${chapterId}-cards-generator`, status: 'start' });
  const generatorOut = await generateText(
    registeredCardsGeneratorPrompt({ planStr: JSON.stringify(fixedPlan) }),
    { tier: 'main', maxTokens: 8000, noThinking: true },
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
    emit({ type: 'log', name: chapterId, message: 'Cards generator returned empty — skipping chapter' });
    return [];
  }

  // Shapes are converted in code first; the refiner only edits wording (mergeRefined enforces that).
  const canonical = generatedCards.map((raw, index) => canonicalizeGeneratorCard(raw, index));
  emit({ type: 'stage', name: `${chapterId}-text-refiner`, status: 'start' });
  // The refiner only rewords cards that are already canonical, so a bad response
  // is never worth failing the chapter over. Retry, then fall back to the
  // generator's own wording: `decided` stays the authority on count and type,
  // and finishCards repairs whatever is left.
  const refinerPrompt = `${registeredCardTextRefinerPrompt({ cards: JSON.stringify(canonical) })}
Return an object with a cards array: the same cards in the same canonical shape, with only the wording refined.
Keep every field's structure: same quiz options in the same order, same scenario sections, same recap items,
same comparison tabs, unchanged code. Use null for unused fields.
Keep exactly one card per decided plan item, with its number and fixed canonical type:
${JSON.stringify(decided.map((card) => ({ card_number: card.card_number, type: coursePlannerToCardType[card.decision.chosen] })))}`;
  const refinedByNumber = new Map<number, any>();
  for (let attempt = 1; attempt <= 3; attempt++) {
    refinedByNumber.clear();
    try {
      const refined = await generateJSON<{ cards: any[] }>(
        refinerPrompt, SHORTS_CARDS_SCHEMA,
        { name: 'course_refined_cards', tier: 'normal', maxTokens: 16000 },
      );
      for (const card of Array.isArray(refined.cards) ? refined.cards : []) {
        const n = Number(card?.card_number);
        if (decided.some((item) => item.card_number === n) && !refinedByNumber.has(n)) refinedByNumber.set(n, card);
      }
    } catch (error: any) {
      log(`text-refiner: attempt ${attempt} failed — ${error?.message || error}`);
    }
    if (refinedByNumber.size === decided.length) break;
    log(`text-refiner: refined ${refinedByNumber.size} of ${decided.length} cards on attempt ${attempt}`);
    if (attempt === 3) log('text-refiner: keeping the generator wording for the cards it did not return');
  }
  // Built from the plan, not from the refiner's array: a card the refiner dropped
  // keeps its canonical version instead of shifting every later card up one slot.
  let finalCards: MobileCard[] = decided.map((planned, index) => {
    const expected = coursePlannerToCardType[planned.decision.chosen];
    const base = canonical.find((card) => card.card_number === planned.card_number)
      ?? mapRawCard({ card_number: planned.card_number, type: expected, title: planned.title, text: '' }, index);
    const raw = refinedByNumber.get(planned.card_number);
    if (raw && raw.type !== expected) log(`card ${planned.card_number}: corrected type ${raw.type} to decided ${expected}`);
    const merged = raw ? mergeRefined({ ...base, type: expected }, raw) : { ...base, type: expected };
    return { ...merged, card_number: planned.card_number, decision: planned.decision };
  });
  emit({ type: 'data', name: `${chapterId}-text-refiner`, payload: { cards: finalCards } });
  emit({ type: 'stage', name: `${chapterId}-text-refiner`, status: 'done' });


  emit({ type: 'stage', name: `${chapterId}-limits`, status: 'start' });
  finalCards = await enforceTextImgProse(finalCards, COURSE_CARD_LIMITS);
  finalCards = await enforceCharLimits(finalCards, emit, 'course');
  emit({ type: 'data', name: `${chapterId}-limits`, payload: { cards: finalCards } });
  emit({ type: 'stage', name: `${chapterId}-limits`, status: 'done' });

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


  // Repair anything the gate rejects, then one technical-accuracy review. Runs
  // after images so a missing imageUrl counts as a real failure.
  emit({ type: 'stage', name: `${chapterId}-repair-review`, status: 'start' });
  const finished = await finishCards(finalCards as MobileCard[], 'course',
    { courseName: courseTitle, chapterTitle, topic: chapterTitle },
    (event) => emit({ ...event, name: event.name ?? chapterId } as any));
  finalCards = finished.cards;
  emit({ type: 'data', name: `${chapterId}-repair-review`, payload: { issues: finished.issues } });
  emit({ type: 'stage', name: `${chapterId}-repair-review`, status: 'done' });

  emit({ type: 'stage', name: `${chapterId}-gate`, status: 'start' });
  const gate = checkCards(finalCards, 'course');
  emit({ type: 'data', name: `${chapterId}-gate`, payload: gate });
  emit({ type: 'stage', name: `${chapterId}-gate`, status: gate.blocking ? 'error' : 'done' });
  if (gate.blocking) log('Course cards still need repair before publishing; saved locally with gate issues');
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
        summary: rawChapter.summary,
        lessonOutline: rawChapter.lessons.map((lesson) => lesson.title).filter(Boolean),
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
