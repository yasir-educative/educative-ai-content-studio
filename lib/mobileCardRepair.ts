// Automatic repair, then review.
//
// The gate (mobileCardLimits) says what is wrong; nothing in it writes content.
// This module closes that loop at generation time so a deck reaches the author
// already passing, instead of asking them to fix it by hand:
//
//   1. repair  — rewrite every card the gate rejects, card by card, until the
//                deck is clean or the round budget runs out.
//   2. review  — one technical-accuracy pass over the clean deck, patching text
//                in place.
//   3. re-gate — the review can only edit wording, but wording has a length, so
//                its output goes back through enforce + repair before shipping.
//
// Only cards that actually fail are sent to a model; a clean deck costs one
// review call.

import { generateText, parseJsonLoose } from './ai';
import { checkCard, checkCards, type CardProduct, type LimitIssue } from './mobileCardLimits';
import { rewriteCard } from './cardRewriteAgent';
import { enforceCharLimits, type MobileShortEmit } from './mobileShortsPipeline';
import type { MobileCard } from './mobileCourseStorage';

export interface RepairContext {
  topic?: string;
  level?: string;
  objective?: string;
  courseName?: string;
  chapterTitle?: string;
  chapterSummary?: string;
}

const errorsOf = (issues: LimitIssue[]) => issues.filter((i) => i.severity === 'error');

/** Rewrite each failing card until the gate passes or `rounds` is spent. */
export async function repairCards(
  cards: MobileCard[],
  product: CardProduct,
  context: RepairContext,
  emit: MobileShortEmit,
  rounds = 2,
): Promise<MobileCard[]> {
  let working = [...cards];
  for (let round = 1; round <= rounds; round++) {
    const failing = working
      .map((card, index) => ({ card, index, issues: errorsOf(checkCard(card, product)) }))
      .filter((entry) => entry.issues.length > 0);
    if (!failing.length) break;
    emit({ type: 'log', message: `repair round ${round}: ${failing.length} card(s) failing the gate` });
    for (const { card, index, issues } of failing) {
      try {
        const { candidate } = await rewriteCard({
          product,
          card,
          note: `Fix every listed problem. ${issues.map((i) => i.message).join('; ')}`,
          context: {
            ...context,
            neighbours: working.filter((_, i) => Math.abs(i - index) === 1),
          },
        });
        // The agent keeps the image; only accept a candidate that is no worse.
        if (errorsOf(checkCard(candidate, product)).length < issues.length) {
          working[index] = { ...candidate, imageUrl: card.imageUrl || candidate.imageUrl };
        }
      } catch (error: any) {
        emit({ type: 'log', message: `repair: card ${card.card_number} failed — ${error?.message || error}` });
      }
    }
  }
  const left = errorsOf(checkCards(working, product).issues);
  emit({ type: 'log', message: left.length ? `repair: ${left.length} issue(s) still unresolved` : 'repair: deck passes the gate' });
  return working;
}

// Fields the reviewer may reword. Code, answers, options, images and types are
// never touched: a factual edit to an answer key silently breaks the card.
const REVIEWABLE = ['text', 'text_1', 'text_2', 'title', 'heading', 'explanation', 'question'] as const;

/**
 * Final pass: technical accuracy, not style. Runs once, after the deck already
 * passes the gate, and returns field patches rather than whole cards so it
 * cannot drop a field or change a type.
 */
export async function reviewTechnicalAccuracy(
  cards: MobileCard[],
  product: CardProduct,
  context: RepairContext,
  emit: MobileShortEmit,
): Promise<MobileCard[]> {
  if (!cards.length) return cards;
  const payload = cards.map((card) => ({
    card_number: card.card_number,
    type: card.type,
    ...Object.fromEntries(REVIEWABLE.map((f) => [f, (card as any)[f]]).filter(([, v]) => v)),
    sections: card.sections?.map((s) => ({ heading: s.heading, content: s.content })),
    content: card.content,
  }));
  const prompt = `You are a senior engineer fact-checking a deck of mobile learning cards before publication.

Topic: ${context.topic || context.chapterTitle || ''}
Audience level: ${context.level || 'beginner'}
Learning objective: ${context.objective || ''}

Cards:
${JSON.stringify(payload, null, 1)}

Check each card for technical accuracy only:
- Statements that are wrong, out of date, or true only in a narrower case than stated.
- Mixed-up terminology, wrong units, wrong complexity or cost claims, wrong defaults.
- Claims that contradict another card in this deck.
- A title that misdescribes what its card actually teaches.

Rules:
- Correct only what is technically wrong. Leave wording you merely dislike alone.
- Keep each corrected field within one character of the original length where you can, and never more than 10 percent longer: these fields have hard character limits.
- Never change a card's type, code, quiz options, correct answers, or image fields.
- Preserve markdown. A text_img field must stay a single prose paragraph with no lists.

Return a JSON array of the cards you changed, each as:
{ "card_number": N, "reason": "what was wrong", "fields": { "<field>": "corrected text" } }
For a scenario card use "sections": [{ "heading", "content" }] inside "fields", with the same number of sections.
Return [] if every card is accurate. Raw JSON only, no fences.`;

  let patches: any[] = [];
  try {
    const raw = await generateText(prompt, { tier: 'main', maxTokens: 8000 });
    const parsed = parseJsonLoose<any>(raw);
    patches = Array.isArray(parsed) ? parsed : [];
  } catch (error: any) {
    emit({ type: 'log', message: `technical review failed, keeping the deck as generated: ${error?.message || error}` });
    return cards;
  }
  if (!patches.length) {
    emit({ type: 'log', message: 'technical review: no inaccuracies found' });
    return cards;
  }
  const byNumber = new Map(patches.map((p) => [Number(p?.card_number), p]));
  const reviewed = cards.map((card) => {
    const patch = byNumber.get(Number(card.card_number));
    if (!patch?.fields || typeof patch.fields !== 'object') return card;
    const next: any = { ...card };
    for (const field of REVIEWABLE) {
      const value = patch.fields[field];
      if (typeof value === 'string' && value.trim()) next[field] = value;
    }
    // Structure is the generator's; the reviewer may only reword in place.
    const sections = patch.fields.sections;
    if (Array.isArray(sections) && sections.length === (card.sections?.length ?? -1)) {
      next.sections = card.sections!.map((s, i) => ({
        heading: String(sections[i]?.heading || s.heading),
        content: String(sections[i]?.content || s.content),
      }));
    }
    emit({ type: 'log', message: `technical review: card ${card.card_number} — ${patch.reason || 'corrected'}` });
    return next as MobileCard;
  });
  return reviewed;
}

/**
 * The whole tail of the pipeline: repair, review, then repair again so the
 * review's own edits are held to the same limits.
 */
export async function finishCards(
  cards: MobileCard[],
  product: CardProduct,
  context: RepairContext,
  emit: MobileShortEmit,
): Promise<{ cards: MobileCard[]; issues: LimitIssue[] }> {
  let working = await repairCards(cards, product, context, emit);
  const reviewed = await reviewTechnicalAccuracy(working, product, context, emit);
  if (reviewed !== working) {
    working = await enforceCharLimits(reviewed, emit, product) as MobileCard[];
    working = await repairCards(working, product, context, emit, 1);
  }
  const { issues } = checkCards(working, product);
  return { cards: working, issues };
}
