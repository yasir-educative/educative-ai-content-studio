// Analyse an existing course and extend it where it is thin.
//
// Two steps, deliberately separate: analyseCourse only reads and proposes, and
// materializeProposals only writes locally. Nothing here touches Educative —
// the new cards land in the local course with no pageId, and the author
// publishes them from the page when they are happy with them.

import { generateJSON, generateText, parseJsonLoose } from './ai';
import {
  fetchCollectionStructure,
  fetchLessonContent,
  makeChpCategory,
  makeChpPage,
  type ChpCategory,
} from './courseEducative';
import { COURSE_PROFILE, decideTypes, type CardTypeProfile, type PlannedCourseCard } from './cardTypeDecider';
import { COURSE_CARD_LIMITS, checkCard, checkCards } from './mobileCardLimits';
import { coursePlannerToCardType, COURSE_PLANNER_TYPES, type CoursePlannerType } from './mobileCardTypes';
import { rewriteCard } from './cardRewriteAgent';
import { finishCards } from './mobileCardRepair';
import { canonicalizeGeneratorCard, generateCardImage } from './mobileCoursePipeline';
import { mediaModeFor, replaceCardMedia, type MediaMode } from './mobileCourseMedia';
import { registeredCardsGeneratorPrompt } from './mobileCoursePromptsRegistry';
import { enforceCharLimits, enforceTextImgProse } from './mobileShortsPipeline';
import type { MobileCard, MobileChapter, MobileCourse } from './mobileCourseStorage';

export interface ProposedCard {
  card_type: CoursePlannerType;
  card_title: string;
  content_focus: string;
  illustration_idea: string | null;
}

export interface Proposal {
  id: string;
  /**
   * 'cards'   adds cards to an existing chapter
   * 'chapter' adds a whole new chapter
   * 'rewrite' rewrites a card that is already there
   * 'media'   replaces a card's picture with an illustration of our own
   */
  kind: 'cards' | 'chapter' | 'rewrite' | 'media';
  /** Index into course.chapters: the chapter to work on, or the slot a new chapter takes. */
  chapter_index: number;
  /** Index within that chapter's cards: where new cards go, or which card to rewrite. */
  insert_at: number;
  /** Title of the new chapter; empty otherwise. */
  chapter_title: string;
  /** What the rewrite has to change; empty otherwise. */
  note: string;
  reason: string;
  cards: ProposedCard[];
  /** How a 'media' proposal gets its new picture. */
  media?: MediaMode;
}

export interface ChapterPlan {
  mobileIndex: number;
  chapterTitle: string;
  /** Web chapters this was compared against, by title. */
  comparedWith: string[];
  summary: string;
  proposals: Proposal[];
}

// ── The source course on the web ─────────────────────────────────────────────

export interface WebLesson {
  pageId: string;
  title: string;
}

export interface WebChapter {
  index: number;
  id: string;
  title: string;
  lessons: WebLesson[];
}

/**
 * One mobile chapter's source material.
 *
 * `pageIds` empty means the whole web chapter. The two courses rarely line up
 * one to one — a mobile chapter can merge three web chapters, or cover half of
 * one — so the unit here is the lesson, not the chapter.
 */
export interface WebSelection {
  chapterIndex: number;
  pageIds: string[];
}

/** Chapter and lesson titles of the web course. One request, no page reads. */
export async function fetchWebOutline(
  authorId: string,
  collectionId: string,
): Promise<{ title: string; chapters: WebChapter[] }> {
  const structure = await fetchCollectionStructure(authorId, collectionId);
  return {
    title: structure.title,
    chapters: structure.chapters.map((c, index) => ({
      index, id: c.id, title: c.title,
      lessons: c.lessons.map((l) => ({ pageId: l.pageId, title: l.title })),
    })),
  };
}

export interface ChapterMatch {
  mobileIndex: number;
  selection: WebSelection[];
  note: string;
}

const MAPPING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['matches'],
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['mobile_index', 'web_chapters', 'note'],
        properties: {
          mobile_index: { type: 'integer' },
          web_chapters: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['chapter_index', 'lesson_indexes'],
              properties: {
                chapter_index: { type: 'integer' },
                // Empty means the whole chapter.
                lesson_indexes: { type: 'array', items: { type: 'integer' } },
              },
            },
          },
          note: { type: 'string' },
        },
      },
    },
  },
} as const;

/**
 * Pair each mobile chapter with the web material it was built from.
 *
 * The two courses do not line up by position, and not always by chapter
 * either: one mobile chapter often merges several web chapters, and a long web
 * chapter is sometimes split across two mobile ones. So a match names
 * chapters, and within a chapter may name only the lessons that belong.
 */
export async function mapChapters(
  course: MobileCourse,
  web: { title: string; chapters: WebChapter[] },
  mobileIndexes?: number[],
): Promise<ChapterMatch[]> {
  const wanted = mobileIndexes?.length ? mobileIndexes : course.chapters.map((_, i) => i);
  const mobileList = wanted
    .map((i) => {
      const chapter = course.chapters[i];
      const cards = chapter?.cards.map((c) => c.title || c.type).join(', ') || '';
      return `${i}: ${chapter?.title || ''} (${chapter?.cards.length || 0} cards)\n     ${cards}`;
    })
    .join('\n');
  const webList = web.chapters
    .map((c) => `${c.index}: ${c.title}\n${c.lessons.map((l, li) => `     [${li}] ${l.title}`).join('\n')}`)
    .join('\n');

  const out = await generateJSON<{
    matches: Array<{ mobile_index: number; web_chapters: Array<{ chapter_index: number; lesson_indexes: number[] }>; note: string }>;
  }>(
    `Two versions of the same course: a mobile card course, and the web course it came from.
The web course is the one that gets updated, so it is the reference.

Mobile chapters ("${course.title}"), with their card titles:
${mobileList}

Web chapters ("${web.title}"), with their lessons numbered inside each chapter:
${webList}

For each mobile chapter listed, name the web material that covers the same ground.

The two do not line up one to one. A mobile chapter often merges two or three web chapters:
name all of them. A long web chapter is sometimes split across several mobile chapters: name
that chapter once per mobile chapter, and in \`lesson_indexes\` give only the lessons that
belong to this one. Leave \`lesson_indexes\` empty to mean the whole chapter.

Match on what is taught, not on position or wording. Introductory, overview and closing
chapters count: if the mobile chapter opens with the course's framing material, name the web
course's introduction chapter too. A web chapter added since the mobile course was built
simply goes unmatched. Leave \`web_chapters\` empty when nothing matches, and
say why in \`note\`. Keep \`note\` to one short sentence.`,
    MAPPING_SCHEMA as any,
    { name: 'chapter_mapping', tier: 'main', maxTokens: 8000 },
  );

  const byMobile = new Map<number, ChapterMatch>();
  for (const match of out.matches || []) {
    const mobileIndex = Number(match.mobile_index);
    if (!course.chapters[mobileIndex] || !wanted.includes(mobileIndex)) continue;
    const selection: WebSelection[] = [];
    for (const entry of match.web_chapters || []) {
      const chapter = web.chapters[Number(entry.chapter_index)];
      if (!chapter) continue;
      const pageIds = (entry.lesson_indexes || [])
        .map((li) => chapter.lessons[Number(li)]?.pageId)
        .filter((id): id is string => !!id);
      // Every lesson named is the same as naming none: keep it as the whole chapter.
      selection.push({
        chapterIndex: chapter.index,
        pageIds: pageIds.length === chapter.lessons.length ? [] : pageIds,
      });
    }
    byMobile.set(mobileIndex, { mobileIndex, selection, note: match.note || '' });
  }
  return wanted.map((i) => byMobile.get(i) ?? { mobileIndex: i, selection: [], note: 'No match proposed' });
}

/** Lesson text of the selected web material, trimmed to fit a prompt. */
export async function fetchWebChapterContent(
  authorId: string,
  collectionId: string,
  selection: WebSelection[],
  perLessonChars = 4000,
): Promise<Array<{ title: string; lessons: Array<{ title: string; content: string }> }>> {
  if (!selection.length) return [];
  const structure = await fetchCollectionStructure(authorId, collectionId);

  const chapters = selection
    .map((sel) => {
      const chapter = structure.chapters[sel.chapterIndex];
      if (!chapter) return null;
      const lessons = sel.pageIds.length
        ? chapter.lessons.filter((l) => sel.pageIds.includes(l.pageId))
        : chapter.lessons;
      return lessons.length ? { title: chapter.title, lessons } : null;
    })
    .filter((c): c is { title: string; lessons: Array<{ pageId: string; title: string }> } => !!c);

  const jobs = chapters.flatMap((chapter) => chapter.lessons);
  const texts = new Map<string, string>();
  // A chapter can hold dozens of lessons; eight at a time keeps the read quick
  // without hammering Educative.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const lesson = jobs[cursor++];
      try {
        const content = await fetchLessonContent(authorId, collectionId, lesson.pageId);
        texts.set(lesson.pageId, String(content || '').slice(0, perLessonChars));
      } catch {
        texts.set(lesson.pageId, '');
      }
    }
  }));

  return chapters.map((chapter) => ({
    title: chapter.title,
    lessons: chapter.lessons.map((lesson) => ({
      title: lesson.title,
      content: texts.get(lesson.pageId) || '',
    })),
  }));
}

// ── Analysing one chapter ────────────────────────────────────────────────────

/** One mobile chapter, in full: this is what the analyst judges. */
export function chapterOutline(chapter: MobileChapter): string {
  return chapter.cards.map((card, i) => {
    // Every field that carries teaching, not just the prose. The analyser is
    // asked to catch a quiz whose answer is wrong and a scenario that does not
    // resolve, which it cannot do if the options, the answer and the tabs are
    // left out of what it is shown.
    const extra: string[] = [];
    const options = Array.isArray(card.options) ? card.options : [];
    if (options.length) {
      extra.push(`options: ${options.map((o: any, oi: number) =>
        `${typeof o === 'object' ? `${o?.id ?? oi + 1}. ${o?.text ?? ''}` : o}`).join(' | ')}`);
    }
    if (card.correctAnswer !== undefined && card.correctAnswer !== null && card.correctAnswer !== '') {
      extra.push(`correct: ${card.correctAnswer}`);
    }
    if (Array.isArray(card.correctOptions) && card.correctOptions.length) {
      extra.push(`answers: ${card.correctOptions.join(', ')}`);
    }
    if (Array.isArray(card.sections) && card.sections.length) {
      extra.push(`tabs: ${card.sections.map((s) => `${s.heading}: ${s.content}`).join(' | ')}`);
    }
    if (card.leftOption || card.rightOption) {
      extra.push(`sides: ${card.leftOption?.label || 'left'}: ${card.leftOption?.description || ''} | ${card.rightOption?.label || 'right'}: ${card.rightOption?.description || ''}`);
    }
    if (Array.isArray(card.content) && card.content.length) {
      extra.push(`items: ${card.content.map((x: any) => `${x?.heading}: ${x?.text}`).join(' | ')}`);
    }
    if (card.code) extra.push(`code: ${String(card.code).slice(0, 600)}`);
    if (card.illustration_idea) extra.push(`picture: ${card.illustration_idea}`);

    const body = [card.text, card.question, card.heading, card.text_1, card.text_2, card.explanation, ...extra]
      .filter(Boolean).join(' / ').replace(/\s+/g, ' ').slice(0, 1200);
    const mode = mediaModeFor(card);
    const media = mode === 'd2' ? ' (D2 diagram)'
      : mode === 'fresh' ? ' (Lottie animation)'
      : mode === 'recreate' ? ' (uploaded image)' : '';
    return `[${i}] ${card.type}${media}${card.readOnly ? ' (read-only)' : ''} — ${card.title || 'untitled'}${body ? `: ${body}` : ''}`;
  }).join('\n');
}

/**
 * The most new cards one chapter may gain in a single update: 30% of what it
 * already has, rounded up, and at least one.
 *
 * Without a ceiling the analyst proposes a dozen cards per chapter and a
 * thirty-chapter course grows past 800 cards in one pass. A gap that genuinely
 * needs more than this is a new chapter, not an addition.
 */
export function newCardBudget(existing: number): number {
  return Math.max(1, Math.ceil(existing * 0.3));
}

/**
 * Hold the plan to its budget, keeping the proposals the analyst ranked first.
 *
 * Whole proposals are kept while they fit, because half an idea teaches worse
 * than none. The exception is a single proposal larger than the whole budget:
 * that one is trimmed rather than dropped, or the chapter gains nothing at all.
 */
export function capNewCards(proposals: Proposal[], budget: number): { proposals: Proposal[]; dropped: number } {
  let left = budget;
  let dropped = 0;
  const out: Proposal[] = [];
  for (const p of proposals) {
    if (p.kind !== 'cards') { out.push(p); continue; }
    if (left <= 0) { dropped += p.cards.length; continue; }
    if (p.cards.length <= left) {
      left -= p.cards.length;
      out.push(p);
      continue;
    }
    dropped += p.cards.length - left;
    out.push({ ...p, cards: p.cards.slice(0, left) });
    left = 0;
  }
  return { proposals: out, dropped };
}

/** Whole-course outline, for the overview the dialog shows before analysing. */
export function courseOutline(course: MobileCourse): string {
  return course.chapters
    .map((chapter, ci) => `Chapter ${ci}: ${chapter.title} (${chapter.cards.length} cards)`)
    .join('\n');
}

const nullableText = { type: ['string', 'null'] } as const;

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'proposals'],
  properties: {
    summary: { type: 'string' },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'insert_at', 'chapter_title', 'note', 'reason', 'cards'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['cards', 'chapter', 'rewrite'] },
          insert_at: { type: 'integer' },
          chapter_title: { type: 'string' },
          note: { type: 'string' },
          reason: { type: 'string' },
          cards: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['card_type', 'card_title', 'content_focus', 'illustration_idea'],
              properties: {
                card_type: { type: 'string', enum: [...COURSE_PLANNER_TYPES] },
                card_title: { type: 'string' },
                content_focus: { type: 'string' },
                illustration_idea: nullableText,
              },
            },
          },
        },
      },
    },
  },
} as const;

export interface AnalyseChapterInput {
  mobileIndex: number;
  instruction?: string;
  /**
   * 'gaps'        review the chapter and plan whatever it needs
   * 'refresh'     bring the cards it already has up to standard, and nothing else
   * 'new-chapter' plan one new chapter to follow it, and nothing else
   */
  intent?: 'gaps' | 'refresh' | 'new-chapter';
  /**
   * What a refresh is allowed to touch. Either half alone is a complete job:
   * rewriting the words, or redrawing the pictures. Both is the old behaviour,
   * and neither means there is nothing to do. Ignored for the other intents.
   */
  refresh?: { text: boolean; media: boolean };
  web?: {
    courseTitle: string;
    chapters: Array<{ title: string; lessons: Array<{ title: string; content: string }> }>;
  };
}

/**
 * Compare one mobile chapter against the web chapters it came from, and plan
 * what to change. Reads only; the proposals are executed separately.
 */
export async function analyseChapter(
  course: MobileCourse,
  input: AnalyseChapterInput,
): Promise<ChapterPlan> {
  const chapter = course.chapters[input.mobileIndex];
  if (!chapter) throw new Error(`There is no chapter ${input.mobileIndex}`);

  // The analysis always runs, whatever the toggles say. A card it names is
  // changed, and the gate's failing checks are applied to every other card;
  // the toggles decide what work is added on top, never what is skipped.
  const refresh = input.refresh ?? { text: true, media: true };
  const budget = newCardBudget(chapter.cards.length);

  const webBlock = (input.web?.chapters || [])
    .map((c) => `### Web chapter: ${c.title}\n${c.lessons.map((l) => `#### ${l.title}\n${l.content}`).join('\n\n')}`)
    .join('\n\n');

  const prompt = `# Course update planner

You are updating one chapter of a mobile card course${input.web ? ', against the web course it was built from' : ''}.

## The mobile chapter
Course: ${course.title}
Chapter ${input.mobileIndex}: ${chapter.title} — ${chapter.cards.length} cards

${chapterOutline(chapter)}

${input.web ? `## The web course, as it stands today
Course: ${input.web.courseTitle}
The web course is kept up to date, so where the two disagree the web course is right.

${webBlock}
` : ''}${input.instruction ? `## What the author asked for\n${input.instruction}\n` : ''}
## Your job

Work the chapter card by card, then${input.web ? ' lesson by lesson' : ' idea by idea'}. Do not skim: a
proposal you do not make is a defect that ships. Before judging anything, note to yourself what each
card actually teaches, so you neither miss a gap nor report one that is already covered elsewhere in
the list.

Three things are being asked of you, in this order. Everything else is someone else's job:
the wording pass and the pictures are separate sweeps the author runs, so do not propose work
for either.

You are reviewing this chapter on four counts, in this order:

1. **Correctness.** Is what these cards say true, current and precise? Wrong facts, stale numbers,
   outdated names, a definition that no longer holds, a quiz whose stated answer is not the right
   one, a scenario whose fix does not follow from its setup, a comparison that misstates a side,
   a code sample that would not run or does not do what the text claims, a picture whose labels
   contradict the prose.
2. **Coverage.** What does the subject require that these cards never mention${input.web ? ', and the web course covers' : ''}?
   Go through${input.web ? ' every web lesson above' : ' the chapter\'s own promise'} in order and account for each
   substantive idea: covered here, deliberately out of scope, or missing. Report the missing ones.
   Include the unglamorous kinds: a term used but never defined, a constraint or limit never stated,
   the failure case of a happy path, the "when not to use this", the cost or trade-off of a
   recommendation, and the worked example an abstract rule needs.
3. **Connections.** A chapter is a sequence, not a pile. Look for the joins that are missing:
   - a card that depends on an idea the reader has not met yet, or meets only later
   - two cards that teach the same thing twice, or that disagree with each other
   - a jump in difficulty with no bridging card between them
   - a term introduced in one card and silently renamed in another
   - an opening that does not say what the chapter is for, or an ending that does not close it
   - a practice card testing something the chapter never taught, or teaching with nothing to practise
   Order problems are real problems: say so, and propose the card or rewrite that fixes the join.
4. **Checks.** Which cards fail the course's own rules — a character limit, a missing required
   field, a card typed wrongly for what it carries? Those are facts, not opinions: name them.

${input.intent === 'new-chapter' ? `Propose exactly one new chapter, to be placed directly after the chapter above.
Use kind \`chapter\`, give it a \`chapter_title\` and its full set of cards, and propose nothing else:
no \`cards\` and no \`rewrite\` proposals, however tempting. The new chapter carries the material that
comes next${input.web ? ' in the web course' : ''} and does not belong inside the chapter above. Give it enough
cards to teach that material properly — usually between 8 and 16, opening with a text or text_img card and
closing with a recap.` : input.intent === 'refresh' ? `Work only on the cards that are already there. Propose no new cards and no new chapter,
however tempting a gap looks: the author opened this to bring these cards up to standard.

Use kind \`rewrite\`, one per card that needs it. \`insert_at\` is that card's index in the list
above, and \`note\` is the instruction the writer follows: say what is wrong and what the card
should say instead, in enough detail that it can be rewritten without reading this plan twice.
Leave \`cards\` empty. A card marked read-only cannot be rewritten; propose nothing for it.

Leave a card alone when it is correct, clear and on topic.${refresh.media
  ? ' The pictures are handled separately\nand automatically — never propose a rewrite only to change an illustration.'
  : ' The pictures are not being touched on this\nrun: never propose a rewrite to change an illustration, and do not comment on the pictures.'}${refresh.text
  ? ''
  : `

The author did not ask for a wording pass, so hold a higher bar: propose a rewrite only where a card
is actually wrong, out of date, contradicts another card, or cannot be understood as written. Do not
propose one to tighten prose, improve flow or vary a phrase. What you do propose is still carried
out, so propose it only when leaving it would be a mistake.`}` : `Plan what this chapter needs. Three kinds of proposal:

- \`cards\`: add cards. \`insert_at\` is the position the first new card takes in the list above
  (0 puts them first, ${chapter.cards.length} puts them last). Give the cards.
- \`rewrite\`: an existing card is wrong, out of date or weak. \`insert_at\` is that card's index,
  and \`note\` says exactly what has to change and what the correct content is. Leave \`cards\`
  empty. A card marked read-only cannot be rewritten; propose nothing for it.
- \`chapter\`: this chapter carries material that deserves a chapter of its own. \`chapter_title\`
  names it, and the new chapter goes directly after this one.`}

Rules:
${input.web ? `- The web course is the reference for all four: where the two disagree it is right, and
  material it teaches that these cards never mention is a gap. Name the web lesson each
  proposal comes from in \`reason\`.
- The web course is the version that has been updated. Treat anything in it that these cards
  contradict as a correctness problem, not a difference of wording, and anything added to it since
  as the most likely gap.
- Do not propose a card for web material that is already covered here, in any wording. Check the
  whole card list before calling something missing, not just the cards near where it would go.
` : `- Judge correctness against what you know of the subject, and say in \`reason\` what is wrong.
- Propose a card only where it teaches something the surrounding cards leave out.
`}${input.web ? `- A web lesson with no counterpart in the card list is new material. Work it into the chapter where
  it belongs in the teaching order — after what it depends on, before what depends on it — not at the
  end because that is where it sits in the web course. Say in \`reason\` which card it follows and why
  that is the right place.
- New material arriving mid-chapter usually needs a join as well as cards: if the card before it now
  leads nowhere, or the card after it assumes something the new cards displaced, propose the rewrite
  that reconnects them in the same plan. Cards added without their joins read as an interruption.
- Match what is already there: a chapter of short text_img cards does not want three dense text cards
  dropped into it. Follow the chapter's own card mix, depth and voice.
` : ''}- **Budget: at most ${budget} new card${budget === 1 ? '' : 's'} for this chapter, across all your \`cards\`
  proposals put together.** It has ${chapter.cards.length} already. This is a hard ceiling, not a target:
  none is a perfectly good answer, and a chapter that is complete should get none. Anything past
  ${budget} is discarded unread, so spend the budget on the gaps that matter most and leave the rest.
  Where a gap genuinely needs more cards than that, it is a chapter of its own — say so in
  \`summary\` rather than proposing it here.
- A rewrite costs nothing against the budget. Where an existing card could carry the missing
  point with a better brief, prefer rewriting it to adding a card beside it.
- \`content_focus\` is the brief a writer works from: state the idea, its scope and the facts to use.
- \`illustration_idea\` only for the image types, otherwise null.
- Each proposal needs a short unique \`id\`.
- A correctness problem outranks a gap, a gap outranks a broken connection, and that outranks a
  polish: say which of the four a proposal answers in \`reason\`, and keep them in that order.
- \`reason\` is evidence, not a verdict. Quote or name the exact card, line, option or lesson that
  shows the problem. "Card 4 could be clearer" is not a reason; "card 4 uses 'quorum' before card 7
  defines it" is.
- Say in \`summary\` what you checked and what you found: how many cards you read, the ideas the
  chapter covers well, and the single most important thing wrong with it.
- Propose nothing rather than padding. An empty list is a valid answer, and the right one for a
  chapter that is correct, complete and in order.
${input.instruction ? `- The author's request above governs, over your own reading of the chapter.
` : ''}`;

  const out = await generateJSON<{ summary: string; proposals: any[] }>(prompt, PLAN_SCHEMA as any, {
    name: 'chapter_update_plan', tier: 'main', maxTokens: 16000,
  });

  const proposals: Proposal[] = (out.proposals || [])
    .map((p, i): Proposal => ({
      id: p.id || `c${input.mobileIndex}-p${i + 1}`,
      kind: p.kind === 'chapter' ? 'chapter' : p.kind === 'rewrite' ? 'rewrite' : 'cards',
      chapter_index: input.mobileIndex,
      insert_at: Math.max(0, Number(p.insert_at) || 0),
      chapter_title: p.chapter_title || '',
      note: p.note || '',
      reason: p.reason || '',
      cards: Array.isArray(p.cards) ? p.cards : [],
    }))
    // 'refresh' works on the cards that are already there, and nothing else.
    .filter((p) => input.intent !== 'refresh' || p.kind === 'rewrite')
    // Asked for one new chapter, take only that: anything else would edit a
    // chapter the author did not open this for.
    .filter((p) => input.intent !== 'new-chapter' || p.kind === 'chapter')
    // A rewrite needs a card that exists and can be rebuilt; the rest need cards
    // to write. A read-only card becomes rebuildable once its media is replaced,
    // which is exactly what a refresh does, so it is allowed through there.
    .filter((p) => {
      if (p.kind !== 'rewrite') return p.cards.length > 0;
      const card = chapter.cards[p.insert_at];
      if (!card) return false;
      return !card.readOnly || (input.intent === 'refresh' && !!mediaModeFor(card));
    })
    .map((p) => (p.kind === 'cards'
      ? { ...p, insert_at: Math.min(p.insert_at, chapter.cards.length) }
      : p));

  // The prompt states the budget; this holds it to it. A model that proposes
  // twelve cards for a fifteen-card chapter is not a model to take on trust.
  const capped = input.intent === 'refresh'
    ? { proposals: withRefreshWork(chapter, input.mobileIndex, proposals, refresh), dropped: 0 }
    : capNewCards(proposals, budget);

  return {
    mobileIndex: input.mobileIndex,
    chapterTitle: chapter.title,
    comparedWith: (input.web?.chapters || []).map((c) => `${c.title} (${c.lessons.length} lesson${c.lessons.length === 1 ? '' : 's'})`),
    summary: capped.dropped
      ? `${out.summary || ''}\n\nOver budget: ${capped.dropped} further card${capped.dropped === 1 ? '' : 's'} were proposed and dropped. This chapter may gain at most ${budget}.`.trim()
      : out.summary || '',
    proposals: capped.proposals,
  };
}


/**
 * Fold the deterministic half of a refresh into the analyst's proposals.
 *
 * Two things need no judgement. A card drawn by Educative — a Lottie
 * animation, a D2 diagram, an uploaded raster — gets an illustration of our
 * own instead, which is also what makes it editable. And a card the gate
 * already rejects has to be rewritten whatever the analyst thought of it.
 *
 * One proposal per card: a card that needs both gets a single rewrite that
 * also carries its new picture, because two proposals for one card would each
 * overwrite the other.
 */
export function withRefreshWork(
  chapter: MobileChapter,
  chapterIndex: number,
  proposals: Proposal[],
  opts: { text: boolean; media: boolean } = { text: true, media: true },
): Proposal[] {
  // A card the analysis named is rewritten whatever the toggles say, and the
  // gate's failing checks apply to every remaining card. `opts` only decides
  // what is added on top: the full wording review, and the pictures.
  const byCard = new Map<number, Proposal>();
  for (const p of proposals) if (p.kind === 'rewrite') byCard.set(p.insert_at, p);

  const out: Proposal[] = [];
  chapter.cards.forEach((card, i) => {
    const media = opts.media ? (mediaModeFor(card) ?? undefined) : undefined;
    const failing = checkCard(card, 'course').filter((issue) => issue.severity === 'error');
    const planned = byCard.get(i);
    if (!media && !failing.length && !planned) return;
    // Nothing can be done for a read-only card we cannot re-illustrate either.
    if (card.readOnly && !media) return;

    const notes = [
      planned?.note,
      failing.length ? `These checks fail and must pass: ${failing.map((f) => f.message).join('; ')}.` : '',
    ].filter(Boolean).join('\n\n');
    const reasons = [
      planned?.reason,
      media === 'd2' ? 'Its D2 diagram is redrawn as an illustration.'
        : media === 'fresh' ? 'Its Lottie animation is replaced by an illustration.'
          : media === 'recreate' ? 'Its uploaded image is redrawn in the card style.' : '',
      failing.length ? `${failing.length} check${failing.length === 1 ? '' : 's'} currently fail.` : '',
    ].filter(Boolean).join(' ');

    out.push({
      id: planned?.id || `c${chapterIndex}-r${i}`,
      kind: planned || failing.length ? 'rewrite' : 'media',
      chapter_index: chapterIndex,
      insert_at: i,
      chapter_title: '',
      note: notes,
      reason: reasons,
      cards: [],
      media,
    });
  });
  return out;
}

// ── Writing the proposed cards ────────────────────────────────────────────────

// The course profile's hard rules describe a whole chapter: first card an
// introduction, a recap last, one standalone image somewhere. Applied to two
// cards dropped into the middle of a chapter they would turn the last one into
// a recap. Only the code rule still holds for an insertion.
const INSERT_PROFILE: CardTypeProfile<CoursePlannerType> = {
  ...COURSE_PROFILE,
  rulesText: `Code types require code in the surrounding chapter. These cards are being inserted into the
middle of an existing chapter, so no introduction or recap is wanted: choose the type that teaches each
card's goal best on its own.`,
  applyHardRules(cards, ctx) {
    for (const card of cards) {
      if (!ctx.sourceHasCode && ['text_code', 'code_output'].includes(card.decision.chosen)) {
        card.decision.chosen = 'text';
      }
    }
  },
};

function chapterHasCode(chapter: MobileChapter | undefined): boolean {
  return !!chapter?.cards.some((c) => c.type === 'text-with-code' || c.type === 'code-with-output' || !!c.code);
}

/** Turn one proposal into finished cards: typed, written, imaged and gated. */
export async function writeProposalCards(
  course: MobileCourse,
  proposal: Proposal,
  log: (message: string) => void = () => {},
): Promise<MobileCard[]> {
  const chapter = course.chapters[proposal.chapter_index];
  const chapterTitle = proposal.kind === 'chapter' ? proposal.chapter_title : chapter?.title || '';
  const neighbours = (chapter?.cards || [])
    .slice(Math.max(0, proposal.insert_at - 2), proposal.insert_at + 2)
    .map((c) => `${c.type}: ${c.title || ''} — ${String(c.text || '').slice(0, 160)}`)
    .join('\n');

  const plan: PlannedCourseCard[] = proposal.cards.map((card, i) => ({
    card_number: i + 1,
    title: card.card_title,
    teaching_goal: card.content_focus,
    proposed_type: card.card_type,
    visual_idea: card.illustration_idea,
  }));
  const decided = await decideTypes(plan, {
    topic: `${course.title}: ${chapterTitle}`,
    additionalContext: neighbours,
    sourceHasCode: chapterHasCode(chapter),
  }, log, INSERT_PROFILE);

  const planForGenerator = proposal.cards.map((card, i) => ({
    card_number: i + 1,
    card_type: decided[i].decision.chosen,
    card_title: card.card_title,
    content_focus: card.content_focus,
    illustration_idea: card.illustration_idea,
  }));

  const raw = await generateText(
    `${registeredCardsGeneratorPrompt({ planStr: JSON.stringify(planForGenerator) })}

These cards are being inserted into the chapter "${chapterTitle}" of "${course.title}".
Cards already around the insertion point (do not repeat them, do not refer to them):
${neighbours || '(none)'}`,
    { tier: 'main', maxTokens: 8000, noThinking: true },
  );
  let generated: any[] = [];
  try {
    const parsed = parseJsonLoose(raw);
    generated = Array.isArray(parsed) ? parsed : [];
  } catch {
    generated = [];
  }
  if (!generated.length) throw new Error('The card generator returned nothing usable');

  const stamp = Date.now().toString(36);
  // Built from the decided plan, not the generator's array, so a card it
  // skipped leaves a slot to repair rather than shifting the rest up one.
  let cards: MobileCard[] = decided.map((planned, i) => {
    const expected = coursePlannerToCardType[planned.decision.chosen];
    const source = generated[i] ?? { card_type: expected, card_title: planned.title, text: '' };
    const card = canonicalizeGeneratorCard(source, i);
    return {
      ...card,
      id: `add-${stamp}-${i}`,
      type: expected,
      title: card.title || planned.title,
      card_number: i + 1,
      decision: planned.decision,
      illustration_idea: card.illustration_idea || proposal.cards[i]?.illustration_idea || undefined,
    };
  });

  cards = await enforceTextImgProse(cards, COURSE_CARD_LIMITS);
  cards = await enforceCharLimits(cards, () => {}, 'course') as MobileCard[];

  await Promise.all(cards.map(async (card, i) => {
    if ((card.type === 'text_img' || card.type === 'img_only') && card.illustration_idea) {
      const url = await generateCardImage(card, i, course.id, chapter?.id || proposal.id);
      if (url) card.imageUrl = url;
    }
  }));

  const finished = await finishCards(cards, 'course',
    { courseName: course.title, chapterTitle, topic: chapterTitle },
    (event) => log(event.message || ''));
  const gate = checkCards(finished.cards, 'course');
  if (gate.blocking) log(`${proposal.id}: cards still have blocking issues after repair; they stay unpublished`);
  return finished.cards;
}


/** Rewrite one existing card in place, keeping its id and its page. */
export async function rewriteExistingCard(
  course: MobileCourse,
  proposal: Proposal,
  log: (message: string) => void = () => {},
  /** The card to work from, when it has already been re-illustrated. */
  from?: MobileCard,
): Promise<MobileCard[]> {
  const chapter = course.chapters[proposal.chapter_index];
  const card = from || chapter?.cards[proposal.insert_at];
  if (!card) throw new Error(`There is no card ${proposal.insert_at} in chapter ${proposal.chapter_index}`);
  if (card.readOnly) throw new Error(`That card cannot be rewritten: ${card.readOnly}`);

  const neighbours = chapter.cards.slice(Math.max(0, proposal.insert_at - 1), proposal.insert_at + 2)
    .filter((c) => c.id !== card.id);
  const { candidate, issues } = await rewriteCard({
    product: 'course',
    card,
    note: `${proposal.note}\n\nWhy: ${proposal.reason}`,
    context: { neighbours, courseName: course.title, chapterTitle: chapter.title, topic: chapter.title },
  });
  const errors = issues.filter((i) => i.severity === 'error').length;
  if (errors) log(`${proposal.id}: rewritten card still has ${errors} blocking issue(s)`);
  return [candidate];
}

/**
 * Run one accepted proposal, whichever kind it is.
 *
 * The picture goes first: replacing a card's Educative-authored media is what
 * makes the card editable, so a read-only card can only be rewritten after it.
 */
export async function executeProposal(
  course: MobileCourse,
  proposal: Proposal,
  log: (message: string) => void = () => {},
): Promise<MobileCard[]> {
  if (proposal.kind !== 'rewrite' && proposal.kind !== 'media') {
    return writeProposalCards(course, proposal, log);
  }

  const chapter = course.chapters[proposal.chapter_index];
  let card = chapter?.cards[proposal.insert_at];
  if (!card) throw new Error(`There is no card ${proposal.insert_at} in chapter ${proposal.chapter_index}`);

  if (proposal.media) {
    log(`${proposal.id}: replacing the picture (${proposal.media})`);
    card = await replaceCardMedia(card, course.id, chapter.id, proposal.insert_at, proposal.media);
  }
  if (proposal.kind === 'media') return [card];
  return rewriteExistingCard(course, proposal, log, card);
}

// ── Placing them in the course ────────────────────────────────────────────────

function renumber(cards: MobileCard[]): MobileCard[] {
  return cards.map((card, i) => ({ ...card, card_number: i + 1 }));
}

/**
 * Insert finished cards into a copy of the course.
 *
 * Proposals are applied from the bottom up, so an earlier proposal's indices
 * still point at the cards the analyst saw when a later one has already run.
 */
export function placeProposals(
  course: MobileCourse,
  placements: Array<{ proposal: Proposal; cards: MobileCard[] }>,
): MobileChapter[] {
  const chapters = course.chapters.map((c) => ({ ...c, cards: [...c.cards] }));
  const ordered = [...placements].sort((a, b) =>
    (b.proposal.chapter_index - a.proposal.chapter_index) || (b.proposal.insert_at - a.proposal.insert_at));

  for (const { proposal, cards } of ordered) {
    if (!cards.length) continue;
    if (proposal.kind === 'rewrite' || proposal.kind === 'media') {
      // A rewrite replaces one card and shifts nothing: same id, same page.
      const chapter = chapters[proposal.chapter_index];
      if (chapter?.cards[proposal.insert_at]) chapter.cards[proposal.insert_at] = cards[0];
      continue;
    }
    if (proposal.kind === 'chapter') {
      // The planner works on one chapter, so a new chapter it proposes follows that one.
      const at = Math.max(0, Math.min(proposal.chapter_index + 1, chapters.length));
      chapters.splice(at, 0, {
        id: `added-${Date.now().toString(36)}-${at}`,
        title: proposal.chapter_title || 'New chapter',
        status: 'done',
        cards: renumber(cards),
      });
      continue;
    }
    const chapter = chapters[proposal.chapter_index];
    if (!chapter) continue;
    const at = Math.max(0, Math.min(proposal.insert_at, chapter.cards.length));
    chapter.cards.splice(at, 0, ...cards);
    chapter.cards = renumber(chapter.cards);
  }
  return chapters;
}

// ── Placing new pages in the published table of contents ─────────────────────

export interface TocChapterRef {
  remoteCategoryId?: string;
  title: string;
  cards: Array<{ id: string; pageId?: string }>;
}

/**
 * Work out where each newly created page belongs in the collection's table of
 * contents, and splice it in.
 *
 * Position comes from the local order: a new card is placed directly after the
 * published card that precedes it locally, so an insertion lands where the
 * author put it even when the chapter has gained pages in Educative since the
 * import. A chapter with no remote category yet is created immediately after
 * the previous chapter's category.
 *
 * `categories` is mutated and returned. `chapterCategoryIds` maps the index of
 * each chapter that got a new category to that category's id, so the caller
 * can store it.
 */
export function placeNewPagesInToc(
  categories: ChpCategory[],
  chapters: TocChapterRef[],
  published: Map<string, { pageId: string; title: string }>,
  ids: { authorId: string; collectionId: string },
): { categories: ChpCategory[]; chapterCategoryIds: Record<number, string> } {
  const chapterCategoryIds: Record<number, string> = {};
  let afterCategory = -1;

  chapters.forEach((chapter, chapterIndex) => {
    let catIdx = chapter.remoteCategoryId
      ? categories.findIndex((c) => String(c.id) === String(chapter.remoteCategoryId))
      : -1;
    if (catIdx === -1) {
      if (!chapter.cards.some((card) => published.has(card.id))) return;
      const category = makeChpCategory(chapter.title, categories);
      catIdx = Math.min(afterCategory + 1, categories.length);
      categories.splice(catIdx, 0, category);
      chapterCategoryIds[chapterIndex] = category.id;
    }
    afterCategory = catIdx;

    const pages = categories[catIdx].pages;
    let afterPage = -1;
    for (const card of chapter.cards) {
      const fresh = published.get(card.id);
      if (!fresh) {
        if (card.pageId) {
          const at = pages.findIndex((p) => String(p.page_id ?? p.id) === String(card.pageId));
          if (at !== -1) afterPage = at;
        }
        continue;
      }
      const at = Math.min(afterPage + 1, pages.length);
      pages.splice(at, 0, makeChpPage(ids.authorId, ids.collectionId, fresh.pageId, fresh.title));
      afterPage = at;
    }
  });

  return { categories, chapterCategoryIds };
}
