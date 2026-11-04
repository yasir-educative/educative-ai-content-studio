// Mobile Shorts Pipeline
// Mirrors the n8n "Mobile shorts - GPT Images" workflow — AI generation only.
// Collection creation and publishing happen separately via the /publish API route.
//
//   1. Topic Detailer (OpenAI search)
//   2. Card Planner (normal tier, structured output)
//   3. Card-type Decision (OpenAI Decisions API, gpt-6-luna)
//   4. Cards Generator (main tier)
//   5. JSON Generator (normal tier, structured output)
//   6. Image generation for text_img / img_only cards

import { openaiSearch, generateText, generateJSON, parseJsonLoose } from './ai';
import { generateGptImage, slugify } from './imageGen';
import { getMobileStyle, readStyleReference } from './imageStyleStore';
import type { MobileCard } from './mobileCourseStorage';
import { applyScenarioHeadings, normalizeCardType, normalizeHighlightCardType, normalizeScenarioCardType,
  resolveCardType, isCardType, plannerToCardType, shortsPlannerTypes, type MobileCardType } from './mobileCardTypes';
import { decideCardTypes, type PlannedShortCard } from './cardTypeDecider';
import { shortsPlannerSchema, SHORTS_CARDS_SCHEMA } from './mobileShortsSchemas';
import { CARD_LIMITS, COURSE_CARD_LIMITS, checkCard, type CardProduct } from './mobileCardLimits';
import { finishCards } from './mobileCardRepair';
import {
  registeredTopicDetailerPrompt,
  registeredShortsCardPlannerPrompt,
  registeredShortsCardsGeneratorPrompt,
  registeredShortsJsonGeneratorPrompt,
} from './mobileShortsPromptsRegistry';

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface MobileShortInput {
  topic: string;
  domain?: string;
  level?: string;
  objective?: string;
  additionalContext?: string;
  isHighlightCardNeeded?: boolean;
  /** Scenario cards are opt-in and default off; nothing in the sheet sets this. */
  isScenarioCardNeeded?: boolean;
  numCards?: number;
  sheetUrl?: string;
  rowIdx?: number;
  authorId?: string;
}

export interface MobileShortEvent {
  type: 'meta' | 'stage' | 'data' | 'log' | 'done' | 'error' | 'cancelled';
  name?: string;
  status?: 'start' | 'done' | 'error';
  message?: string;
  payload?: any;
  shortId?: string;
}

export type MobileShortEmit = (e: MobileShortEvent) => void;

// ── Image prompt builder ─────────────────────────────────────────────────────

// Shared with the course pipeline: a short card and a course card are drawn by
// the same rules, in the style the author chose.
import { buildMobileCardImagePrompt } from './mobileCardImagePrompt';
export { buildMobileCardImagePrompt as buildShortCardImagePrompt } from './mobileCardImagePrompt';

export async function generateCardImage(card: any, order: number, shortId: string, product: 'short' | 'course' = 'short', styleBody?: string): Promise<string | null> {
  try {
    const subfolder = `${product === 'course' ? 'mobile-courses' : 'mobile-shorts'}/${slugify(shortId)}`;
    const style = getMobileStyle();
    const rawPrompt = buildMobileCardImagePrompt(card, styleBody ?? style.body);
    const result = await generateGptImage(card.illustration_idea || '', order, subfolder, {
      size: '1024x1536',
      rawPrompt,
      // Only the chosen style's own picture; an explicit styleBody overrides it.
      reference: styleBody === undefined ? await readStyleReference(style.id) : null,
    });
    return result.url;
  } catch (e: any) {
    console.warn('[mobileShortsPipeline] image gen failed:', e?.message);
    return null;
  }
}

// ── Raw card → MobileCard mapping ────────────────────────────────────────────

export function mapRawCard(raw: any, index: number): MobileCard {
  const type = normalizeCardType(raw.type ?? raw.card_type, 'mobileShortsPipeline');
  const card: MobileCard = {
    id: raw.id || `card-${index + 1}`,
    type,
    decision: raw.decision,
    typeWarning: raw.typeWarning || (!resolveCardType(raw.type ?? raw.card_type)
      ? `unknown type "${raw.type ?? raw.card_type}" — defaulted to text` : undefined),
    card_number: Number(raw.card_number || index + 1),
    title: raw.title || raw.card_title || '',
    text: raw.text || raw.content || '',
    illustration_idea: raw.illustration_idea || '',
    // Generators return the labels either as a comma-separated string or as an
    // array; everything downstream splits a string, so settle it here.
    visible_labels: Array.isArray(raw.visible_labels) ? raw.visible_labels.join(', ') : (raw.visible_labels || ''),
    img_context: raw.img_context || '',
    imageUrl: raw.imageUrl || '',
    text_1: raw.text_1 || '',
    text_2: raw.text_2 || '',
    language: raw.language || '',
    code: raw.code || '',
    output_available: raw.output_available,
    output: raw.output || '',
    heading: raw.heading || '',
    leftOption: raw.leftOption,
    rightOption: raw.rightOption,
    content: raw.content && Array.isArray(raw.content) ? raw.content : undefined,
    question: raw.question || '',
    options: raw.options,
    correctAnswer: raw.correctAnswer,
    incorrectMessage: raw.incorrectMessage || '',
    explanation: raw.explanation || '',
    correctOptions: raw.correctOptions,
    sections: raw.sections,
    scenarioType: normalizeScenarioCardType(raw.scenarioType || raw.scenariotype, raw.sections),
    highlightCardType: normalizeHighlightCardType(raw.highlightCardType),
  };
  return applyScenarioHeadings(card);
}

// ── TEXT_IMG prose enforcer ───────────────────────────────────────────────────

function hasListViolation(text: string): boolean {
  return String(text || '')
    .split('\n')
    .some((l) => l.trim().startsWith('-') || l.trim().startsWith('>') || l.trim().startsWith('|'));
}

export async function enforceTextImgProse(cards: any[], limits = CARD_LIMITS): Promise<any[]> {
  const violators = cards.filter((c) => c.type === 'text_img' && hasListViolation(c.text || c.content || ''));
  if (violators.length === 0) return cards;

  const prompt = `You are a prose editor fixing TEXT_IMG card content. Each card below has bullet lists or blockquotes, which must be removed. Rewrite ONLY the content/text field of each card as a single prose paragraph of 1-2 sentences (${limits.text_img![0].target!.join('-')} chars). The prose must state the key insight or consequence — NOT the steps. The diagram already shows the steps. Ask: "What does completing all these steps achieve? Why does it matter?" — write that as prose.

Cards to fix:
${JSON.stringify(
  violators.map((c) => ({
    card_number: c.card_number,
    current_text: c.text || c.content,
    illustration_idea: c.illustration_idea,
  })),
)}

Rules:
- Return a JSON array with objects: { "card_number": N, "new_text": "..." }
- new_text must be a single prose paragraph, ${limits.text_img![0].target!.join('-')} chars
- No hyphens at line start, no blockquotes, no tables
- Describe consequence/insight, not steps
- Raw JSON only, no markdown fences`;

  try {
    const raw = await generateText(prompt, { tier: 'normal', maxTokens: 4000 });
    const parsed = JSON.parse(raw.trim().replace(/^```json\n?|```$/g, ''));
    const rewrites: Record<number, string> = {};
    for (const r of (Array.isArray(parsed) ? parsed : [])) {
      if (r.card_number && r.new_text) rewrites[Number(r.card_number)] = r.new_text;
    }
    return cards.map((c) => {
      const rewritten = c.type === 'text_img' ? rewrites[Number(c.card_number)] : undefined;
      return rewritten ? { ...c, text: rewritten } : c;
    });
  } catch {
    return cards;
  }
}

// ── Character limit enforcement ───────────────────────────────────────────────
// Prompt maxima are hard caps. Rewrite outside them, then trim prose as a last resort.
function cardText(c: any): string {
  return String(c?.text ?? c?.content ?? '');
}

/** End of the last complete sentence in `text`, or -1. */
function lastSentenceEnd(text: string): number {
  let end = -1;
  // A sentence can be closed by a quote or bracket, and is ended by whitespace
  // or by the end of the block — a full stop before a newline counts, which is
  // how a markdown card normally finishes a paragraph.
  const re = /[.!?]["')\]]?(?=\s|$)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) end = m.index + m[0].length;
  return end;
}

/**
 * Does `text` stop in the middle of a sentence?
 *
 * Only prose can: a table row, a heading and a short bullet are fragments by
 * design and carry no full stop, so a card that ends on one is finished. What
 * this catches is the real failure — a paragraph that runs out of characters
 * and stops on "and".
 */
export function endsMidSentence(text: string): boolean {
  const last = text.trimEnd().split('\n').pop()?.trim() || '';
  if (!last || last.endsWith('|') || /^#{1,6}\s/.test(last)) return false;
  const body = last.replace(/^([-*+]|\d+[.)]|>)\s*/, '').trim();
  if (!body || /[.!?:;)"'\]`*_]$/.test(body)) return false;
  return body.split(/\s+/).length > 8;
}

/**
 * Cut `text` to at most `max` characters without ending mid-sentence.
 *
 * A card is markdown, so the cheapest thing to lose is a whole block — the
 * closing note, the last table, a bullet list. Dropping one leaves every
 * sentence that remains intact, which is what a reader sees; a cut made inside
 * a sentence is what they see first. Only when one block is left does this fall
 * back to cutting the prose, and then at a sentence end.
 *
 * `min` is the card's lower limit. A block can be most of a card, so dropping
 * one can leave far too little — a 460-character card down to 200 against a
 * 350 minimum. Below `min`, cutting the prose keeps more of the card, so that
 * is what happens instead.
 */
export function trimToMax(text: string, max: number, min = 0): string {
  if (text.length <= max) return text;

  const blocks = text.split(/\n\s*\n/);
  if (blocks.length > 1) {
    const kept = [...blocks];
    while (kept.length > 1 && kept.join('\n\n').trim().length > max) kept.pop();
    const joined = kept.join('\n\n').trim();
    if (joined.length >= min && (kept.length > 1 || joined.length <= max)) {
      return trimToMax(joined, max, min);
    }
  }

  const slice = text.slice(0, max);
  const sentence = lastSentenceEnd(slice);
  if (sentence > 0) return slice.slice(0, sentence).trim();
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
}

// Rewrite titles as complete phrases; failed repairs stay visible to the gate.
export async function enforceTitleLimits(cards: any[], emit: MobileShortEmit, product: CardProduct = 'short'): Promise<any[]> {
  let fixed = cards;
  for (let attempt = 0; attempt < 3; attempt++) {
    const offending = fixed.map((card, index) => ({ card, index }))
      .filter(({ card }) => checkCard(card, product).some((issue) => issue.path === 'title' && issue.severity === 'error'));
    if (!offending.length) break;
    emit({ type: 'log', message: `title limits: rewriting ${offending.length} title(s), attempt ${attempt + 1}` });
    try {
      const raw = await generateText(`Rewrite each failing mobile card title as a coherent 2–5-word phrase. Preserve its teaching intent. Return a JSON array of { "card_number": N, "new_title": "..." }. Change no other content.
Cards: ${JSON.stringify(offending.map(({ card, index }) => ({ card_number: index + 1, title: card.title, text: cardText(card), sections: card.sections })))}`, { tier: 'normal', maxTokens: 2000 });
      const parsed = parseJsonLoose<any>(raw);
      const rewrites = new Map<number, string>();
      for (const item of (Array.isArray(parsed) ? parsed : [])) {
        if (typeof item?.new_title === 'string' && item.new_title.trim()) rewrites.set(Number(item.card_number) - 1, item.new_title);
      }
      fixed = fixed.map((card, index) => {
        const title = rewrites.get(index);
        if (!title || !offending.some((item) => item.index === index)) return card;
        const candidate = { ...card, title };
        return checkCard(candidate, product).some((issue) => issue.path === 'title') ? card : candidate;
      });
    } catch (error: any) {
      emit({ type: 'log', message: `title limit rewrite failed: ${error?.message || 'unknown error'}` });
    }
  }
  return fixed;
}

/**
 * One card's entry in the rewrite request.
 *
 * A card well under its minimum cannot be expanded out of its own sentence, so
 * this carries what the card is for. A scenario tab carries more still: on its
 * own it reads as a stray fragment, which is why those came back far short.
 */
export function charLimitRequest(c: any, text: string, rejectedBecause: string) {
  const lim = c.limit;
  return {
    card_number: c.card_number,
    card_type: c.type,
    card_title: c.title || undefined,
    card_context: c.img_context || c.illustration_idea || c.explanation || undefined,
    part_of_card: c.part,
    other_tabs: c.siblings?.length ? c.siblings : undefined,
    current_length: text.length,
    required_min: lim.min,
    required_max: lim.max,
    action: text.length > lim.max ? 'SHORTEN' : 'EXPAND with meaningful depth, not padding',
    rejected_because: rejectedBecause,
    current_text: text,
  };
}

/** The work items a card breaks into: a scenario is three, everything else is one. */
export function charLimitUnits(cards: any[], product: CardProduct = 'short') {
  const limits = product === 'course' ? COURSE_CARD_LIMITS : CARD_LIMITS;
  return cards.flatMap((card, cardIndex) => card.type === 'scenarioCard'
    ? (card.sections || []).map((section: any, sectionIndex: number) => ({
      cardIndex, sectionIndex, text: section.content || '',
      limit: limits.scenarioCard![sectionIndex === card.sections.length - 1 ? 1 : 0],
      part: `tab ${sectionIndex + 1} of ${card.sections.length}, headed "${section.heading || ''}"`,
      siblings: (card.sections || [])
        .map((other: any, i: number) => i === sectionIndex ? null : `${other.heading || `tab ${i + 1}`}: ${other.content || ''}`)
        .filter(Boolean) as string[],
    }))
    : [{ cardIndex, sectionIndex: -1, text: cardText(card),
      limit: limits[card.type as MobileCardType]?.find((limit) => limit.field === 'text'),
      part: undefined as string | undefined, siblings: undefined as string[] | undefined }]);
}

export async function enforceCharLimits(cards: any[], emit: MobileShortEmit, product: CardProduct = 'short'): Promise<any[]> {
  cards = await enforceTitleLimits(cards, emit, product);
  const units = charLimitUnits(cards, product);
  // Unique internal numbers let the existing rewrite contract handle sections too.
  const workCards = units.map((unit, i) => ({
    ...cards[unit.cardIndex], text: unit.text, card_number: i + 1, limit: unit.limit,
    part: unit.part, siblings: unit.siblings,
  }));
  // A rewrite that lands in range but stops mid-sentence is the failure this
  // whole step used to produce, so it counts as unfinished work too.
  const unusable = (c: any, text = cardText(c)) => {
    const lim = c.limit;
    if (!lim) return '';
    if (text.length > lim.max) return `${text.length} characters, over the ${lim.max} maximum`;
    if (text.length < lim.min) return `${text.length} characters, under the ${lim.min} minimum`;
    if (endsMidSentence(text)) {
      return 'it stops mid-sentence; the last sentence has no closing punctuation';
    }
    return '';
  };

  let offending = workCards.filter((c) => unusable(c));
  if (offending.length === 0) return cards;

  emit({
    type: 'log',
    message: `char limits: ${offending.length} card(s) out of range, rewriting`,
  });

  const rewrites: Record<number, string> = {};
  const buildPrompt = (batch: any[]) => `You are a technical editor enforcing strict character limits on mobile learning cards. Rewrite ONLY the text of each card below so it lands inside its required character range. Preserve the meaning, voice, and any markdown. Stay on the card's own subject: card_title and card_context say what it is about.

Cards to fix:
${JSON.stringify(
  batch.map((c) => {
    const text = rewrites[Number(c.card_number)] ?? cardText(c);
    return charLimitRequest(c, text, unusable(c, text));
  }),
  null,
  2,
)}

Rules:
- Return a JSON array of objects: { "card_number": N, "new_text": "..." }
- Count raw characters including markdown syntax. Stay inside required_min..required_max.
- Finish what you start. The text must end on a complete sentence, with its closing
  punctuation. Never stop mid-sentence, mid-clause or mid-word to hit the character count,
  and never leave a bullet, a table row or a note half-written.
- To SHORTEN, drop a whole sentence, bullet or table row, or say the same thing in fewer
  words. Cutting the tail off the last sentence is not shortening.
- Keep the card's structure. A card that arrives with bullets leaves with bullets, a bold key
  term stays bold, a table stays a table, a blockquote callout stays a callout. Shorten the
  items; never flatten a structured card into one block of prose to make it fit, and never add
  structure to a card that is plain prose.
- Markdown syntax counts toward the length, so a structured card has fewer words to spend. That
  is expected: lose a bullet before you lose the formatting.
- To EXPAND, add substance: the mechanism behind the point, what it costs or buys, or one
  concrete case of it. Write whole new sentences on the card's own subject. Restating the
  same point in more words, or adding a sentence that teaches nothing, is padding and is
  worse than being short. Never invent a number, product name or claim the card's subject
  does not already support.
- required_min matters as much as required_max. A card far under its minimum is half a card.
- Where part_of_card is given, this is one tab of a three-tab scenario and other_tabs holds the
  rest of it. Write the tab out in full for its own heading: the first two tabs set up the
  situation and what it costs, the third gives the fix or recommendation and is the longest of
  the three. Do not repeat what another tab already says, and do not answer the scenario early.
- text_img cards must remain a single prose paragraph with no lists, blockquotes, or tables.
- A text_img card's words and its picture teach one concept between them and never repeat each
  other: the picture owns the structure and the steps, the words own the reasoning — why it
  matters, what it costs, when it fails. Do not describe the picture, do not caption it, and
  never refer to it ("as shown above", "the diagram below", "see the figure"). The words must
  read as a complete thought to someone who cannot see it.
- highlightCard text must contain no markdown at all.
- Raw JSON only, no markdown fences.`;

  // Two attempts: the second is told exactly why the first was rejected. A
  // rewrite that is still wrong is kept only when it is no worse than what it
  // replaced, so a bad attempt cannot make a card worse than the generator left it.
  for (let attempt = 1; attempt <= 2 && offending.length; attempt++) {
    if (attempt > 1) {
      emit({ type: 'log', message: `char limits: ${offending.length} card(s) still unusable, asking again` });
    }
    try {
      const raw = await generateText(buildPrompt(offending), { tier: 'normal', maxTokens: 4000 });
      const parsed = parseJsonLoose<any>(raw);
      for (const r of (Array.isArray(parsed) ? parsed : [])) {
        const n = Number(r?.card_number);
        if (!n || typeof r?.new_text !== 'string' || !r.new_text.trim()) continue;
        const card = workCards.find((c) => Number(c.card_number) === n);
        if (!card) continue;
        const current = rewrites[n] ?? cardText(card);
        // Keep the attempt unless it is worse than what we already have.
        if (!unusable(card, r.new_text) || unusable(card, current)) rewrites[n] = r.new_text;
      }
    } catch (e: any) {
      console.warn('[mobileShortsPipeline] char limit rewrite failed:', e?.message);
      break;
    }
    offending = offending.filter((c) => unusable(c, rewrites[Number(c.card_number)] ?? cardText(c)));
  }
  if (offending.length) {
    // Being short is a warning the author sees, not a failure, so say which it is.
    const short = offending.filter((c) => (rewrites[Number(c.card_number)] ?? cardText(c)).length < c.limit.min).length;
    const over = offending.length - short;
    const parts = [over && `${over} trimmed to fit`, short && `${short} still under the minimum`].filter(Boolean);
    emit({ type: 'log', message: `char limits: ${parts.join(', ')} after 2 attempts` });
  }

  const fixed = workCards.map((c) => {
    const lim = c.limit;
    if (!lim) return c;
    const rewritten = rewrites[Number(c.card_number)];
    let text = typeof rewritten === 'string' && rewritten.trim() ? rewritten : cardText(c);
    // Hard guarantee on the ceiling; an under-length card is left as-is since
    // truncation cannot fix it and the content is still usable.
    if (text.length > lim.max) text = trimToMax(text, lim.max, lim.min);
    // Whatever the length, never ship a sentence that stops halfway. Ending
    // short is a warning the author can see; ending mid-clause reads as broken.
    if (endsMidSentence(text)) {
      const end = lastSentenceEnd(text);
      if (end > 0) text = text.slice(0, end).trim();
    }
    if (text === cardText(c)) return c;
    return { ...c, text };
  });
  return cards.map((card, cardIndex) => {
    const indices = units.map((unit, i) => unit.cardIndex === cardIndex ? i : -1).filter((i) => i >= 0);
    if (card.type === 'scenarioCard') {
      return { ...card, sections: (card.sections || []).map((section: any, i: number) => ({
        ...section, content: fixed[indices[i]].text,
      })) };
    }
    return indices.length && units[indices[0]].limit ? { ...card, text: fixed[indices[0]].text } : card;
  });
}

// Reuse the deck's editorial rules while requesting one canonical schema object.
export function buildShortCardRegenerationPrompt(
  input: MobileShortInput,
  card: MobileCard,
  neighbours: MobileCard[],
  type: MobileCardType,
  note = '',
): string {
  return `${registeredShortsCardsGeneratorPrompt({
    ...input,
    numCards: 1,
    isHighlightCardNeeded: type === 'highlightCard' || input.isHighlightCardNeeded,
    cardPlan: JSON.stringify([{ card_number: card.card_number, title: card.title, card_type: type }]),
  })}

Single-card regeneration instructions (override the deck output format above):
Return exactly ONE canonical card object matching the response schema, with type "${type}".
Put prose in text, not content. Use null for unused fields. Keep the original number and title.
Rewrite only this card. Preserve its teaching intent and avoid repeating neighbouring cards.
Current card: ${JSON.stringify(card)}
Neighbouring cards (context only): ${JSON.stringify(neighbours)}
Current limit issues to fix: ${JSON.stringify(checkCard(card))}
Required limits for the requested type: ${JSON.stringify(CARD_LIMITS[type] || [])}
User note: ${note}`;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runMobileShortPipeline(
  input: MobileShortInput,
  shortId: string,
  onCard: (card: MobileCard) => void,
  emit: MobileShortEmit,
): Promise<{ cards: MobileCard[] }> {
  // Stage 1: Topic Detailer (GPT-4o search)
  emit({ type: 'stage', name: 'topic-detailer', status: 'start' });
  const topicDetails = await openaiSearch(
    registeredTopicDetailerPrompt({
      topic: input.topic,
      domain: input.domain,
      additionalContext: input.additionalContext,
    }),
  );
  emit({ type: 'data', name: 'topic-detailer', payload: { topicDetails } });
  emit({ type: 'stage', name: 'topic-detailer', status: 'done' });

  const wanted = Math.min(5, Math.max(1, Math.floor(input.numCards || 5)));
  emit({ type: 'stage', name: 'card-planner', status: 'start' });
  const allowed = shortsPlannerTypes(!!input.isHighlightCardNeeded, !!input.isScenarioCardNeeded);
  // The schema already pins the count, but a model can still mis-number or pick a
  // type outside the enum. Retry rather than failing the run: a short that comes
  // back wrong twice is repaired below, never abandoned.
  const planValid = (cards: PlannedShortCard[] | undefined) => Array.isArray(cards) && cards.length === wanted
    && !cards.some((card, i) => card.card_number !== i + 1 || !allowed.includes(card.proposed_type));
  let plan: PlannedShortCard[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const planned = await generateJSON<{ cards: PlannedShortCard[] }>(
      registeredShortsCardPlannerPrompt({ ...input, numCards: wanted, topicDetails }),
      shortsPlannerSchema(wanted, !!input.isHighlightCardNeeded, !!input.isScenarioCardNeeded),
      // Shorts planning is intentionally cheaper than the shared card-planner main-tier default.
      { name: 'shorts_card_plan', tier: 'normal', maxTokens: 8000 },
    );
    if (planValid(planned.cards)) { plan = planned.cards; break; }
    emit({ type: 'log', message: `card-planner: invalid plan on attempt ${attempt}; retrying` });
    if (attempt === 3) {
      // Last resort: keep whatever came back, renumbered, and coerce stray types.
      plan = (planned.cards || []).slice(0, wanted).map((card, i) => ({
        ...card, card_number: i + 1,
        proposed_type: allowed.includes(card.proposed_type) ? card.proposed_type : 'TEXT',
      }));
      while (plan.length < wanted) {
        plan.push({ card_number: plan.length + 1, title: `${input.topic} ${plan.length + 1}`,
          teaching_goal: input.objective || input.topic, proposed_type: 'TEXT', visual_idea: null });
      }
      emit({ type: 'log', message: 'card-planner: using a coerced plan after 3 invalid attempts' });
    }
  }
  emit({ type: 'data', name: 'card-planner', payload: { cards: plan } });
  emit({ type: 'stage', name: 'card-planner', status: 'done' });


  emit({ type: 'stage', name: 'card-type-decision', status: 'start' });
  const decidedPlan = await decideCardTypes(plan, input, (message) => emit({ type: 'log', message }));
  emit({ type: 'data', name: 'card-type-decision', payload: { cards: decidedPlan } });
  emit({ type: 'stage', name: 'card-type-decision', status: 'done' });
  const cardPlan = JSON.stringify(decidedPlan.map((card) => ({
    card_number: card.card_number, title: card.title, card_type: card.decision.chosen,
    teaching_goal: card.teaching_goal, visual_idea: card.visual_idea,
  })));


  emit({ type: 'stage', name: 'cards-generator', status: 'start' });
  const cardsRaw = await generateText(
    registeredShortsCardsGeneratorPrompt({
      topic: input.topic,
      cardPlan,
      topicDetails,
      isHighlightCardNeeded: input.isHighlightCardNeeded,
      numCards: wanted,
      level: input.level,
      objective: input.objective,
      additionalContext: input.additionalContext,
    }),
    { tier: 'main', maxTokens: 32000 },
  );
  emit({ type: 'data', name: 'cards-generator', payload: { cardsRaw } });
  emit({ type: 'stage', name: 'cards-generator', status: 'done' });

  // Stage 3: JSON Generator — format normalisation, not authoring
  emit({ type: 'stage', name: 'json-generator', status: 'start' });
  // A missing or duplicated card used to abort the whole run, which is how a deck
  // came back empty. Retry, then fill any still-missing slot from the plan so the
  // deck always has exactly `wanted` cards for the repair pass to work on.
  let parsedCards: any[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const parsed = await generateJSON<{ cards: any[] }>(
      registeredShortsJsonGeneratorPrompt({
        cardsOutput: cardsRaw,
        isHighlightCardNeeded: input.isHighlightCardNeeded,
      }),
      SHORTS_CARDS_SCHEMA,
      { name: 'shorts_cards', tier: 'normal', maxTokens: 32000 },
    );
    emit({ type: 'data', name: 'json-generator', payload: { jsonRaw: JSON.stringify(parsed) } });
    const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
    const byNumber = new Map<number, any>();
    for (const card of cards) {
      const n = Number(card?.card_number);
      if (n >= 1 && n <= wanted && !byNumber.has(n)) byNumber.set(n, card);
    }
    if (byNumber.size === wanted) { parsedCards = [...byNumber.values()]; break; }
    emit({ type: 'log', message: `json-generator: got ${byNumber.size} of ${wanted} cards on attempt ${attempt}` });
    if (attempt === 3) {
      // Build the deck from the plan for any slot the model never returned; those
      // cards are blank on purpose and the repair pass below writes them.
      parsedCards = decidedPlan.map((planned) => byNumber.get(planned.card_number) ?? {
        card_number: planned.card_number,
        type: plannerToCardType[planned.decision.chosen],
        title: planned.title,
        text: '',
        illustration_idea: planned.visual_idea || '',
      });
      emit({ type: 'log', message: 'json-generator: filled missing slots from the plan; repair will write them' });
    }
  }
  emit({ type: 'stage', name: 'json-generator', status: 'done' });

  let rawCards = parsedCards.sort((a, b) => a.card_number - b.card_number).map((card, i) => {
    const plannedCard = decidedPlan.find((item) => item.card_number === card.card_number) ?? decidedPlan[i];
    const expectedType = plannerToCardType[plannedCard.decision.chosen];
    if (card.type !== expectedType) {
      emit({ type: 'log', message: `card ${card.card_number}: corrected type "${card.type}" to plan type "${expectedType}"` });
      card.type = expectedType;
    }
    // Canonical structured output normally bypasses alias repair entirely.
    if (!isCardType(card.type)) card.type = resolveCardType(card.type) || normalizeCardType(card.type);
    return { ...card, id: `card-${i + 1}`, decision: plannedCard.decision };
  });

  // Post-process: enforce prose-only content on TEXT_IMG cards
  rawCards = await enforceTextImgProse(rawCards);

  // Post-process: enforce character limits on text-bearing cards
  rawCards = await enforceCharLimits(rawCards, emit);

  // Stage 4: Image generation for visual cards
  const imageCards = rawCards.filter(
    (c: any) => (c.type === 'text_img' || c.type === 'img_only') && c.illustration_idea,
  );
  if (imageCards.length > 0) {
    emit({ type: 'stage', name: 'images', status: 'start' });
    await Promise.all(
      rawCards.map(async (card: any, idx: number) => {
        if ((card.type === 'text_img' || card.type === 'img_only') && card.illustration_idea) {
          const url = await generateCardImage(card, idx, shortId);
          if (url) card.imageUrl = url;
        }
      }),
    );
    emit({ type: 'stage', name: 'images', status: 'done' });
  }

  let cards: MobileCard[] = rawCards.map((raw: any, i: number) => mapRawCard(raw, i));

  // Stage 5: repair anything the gate still rejects, then one technical-accuracy
  // review. Runs after images so a missing imageUrl counts as a real failure.
  emit({ type: 'stage', name: 'repair-review', status: 'start' });
  const finished = await finishCards(cards, 'short',
    { topic: input.topic, level: input.level, objective: input.objective }, emit);
  cards = finished.cards;
  emit({ type: 'data', name: 'repair-review', payload: { issues: finished.issues } });
  emit({ type: 'stage', name: 'repair-review', status: 'done' });

  for (const card of cards) onCard(card);

  return { cards };
}

// Alias for run manager compatibility
export { runMobileShortPipeline as runMobileShortsPipeline };
