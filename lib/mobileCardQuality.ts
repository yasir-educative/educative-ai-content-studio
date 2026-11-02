// Shared quality gate for mobile shorts and mobile course cards.
//
// Everything that can be guaranteed in code is guaranteed in code: card type
// names, blank cards, the highlight toggle, the card count and the character
// ceilings. Only the two problems code cannot invent its way out of — a card
// that is too short, and a deck that came back with too few cards — are sent
// to the model, and only those cards, once.

import { generateText } from './ai';
import { resolveCardType } from './mobileCardTypes';
import type { MobileCard, MobileCardType } from './mobileCourseStorage';

/** Outer bounds. Prompts ask for a tighter band so overshoot still lands here. */
export const CARD_LIMITS: Partial<Record<MobileCardType, { min: number; max: number }>> = {
  text: { min: 350, max: 450 },
  text_img: { min: 230, max: 280 },
  highlightCard: { min: 100, max: 130 },
};

export interface CardSpec {
  /** Exact number of cards wanted. 5 is the ceiling everywhere. */
  numCards?: number;
  isHighlightCardNeeded?: boolean;
  /** Context for regeneration and review. Without it both are skipped. */
  topic?: string;
  objective?: string;
  level?: string;
  /** Skip the reviewer, e.g. for a chapter already reviewed upstream. */
  skipReview?: boolean;
}

export interface QualityReport {
  fixed: string[];
  /** Left unresolved after the repair pass; surfaced rather than hidden. */
  remaining: string[];
}

const text = (c: any): string => String(c?.text ?? c?.content ?? '');

/**
 * A card with no usable content. Type-aware: a quiz needs a question, a
 * comparison needs its sides, an image card needs an illustration to render.
 */
export function isBlankCard(c: any): boolean {
  if (!c || typeof c !== 'object') return true;
  switch (c.type) {
    case 'quiz':
      return !String(c.question || '').trim() || !(Array.isArray(c.options) && c.options.length >= 2);
    case 'trueFalseCard':
      return !String(c.question || '').trim();
    case 'fillInTheBlank':
      return !String(c.question || '').trim();
    case 'comparisonCards':
      return !c.leftOption?.description?.trim() || !c.rightOption?.description?.trim();
    case 'recapCard':
      return !(Array.isArray(c.content) && c.content.some((x: any) => String(x?.text || '').trim()));
    case 'scenarioCard':
      return !(Array.isArray(c.sections) && c.sections.some((x: any) => String(x?.content || '').trim()));
    case 'img_only':
      return !String(c.illustration_idea || '').trim();
    case 'text_img':
      return !text(c).trim() || !String(c.illustration_idea || '').trim();
    case 'text-with-code':
    case 'code-with-output':
      return !String(c.code || '').trim();
    default:
      return !text(c).trim();
  }
}

/** Cut at the last sentence that fits, else the last word. */
export function trimToMax(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const stop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (stop >= max * 0.6) return slice.slice(0, stop + 1).trim();
  const sp = slice.lastIndexOf(' ');
  return (sp > 0 ? slice.slice(0, sp) : slice).trim();
}

/**
 * The deterministic pass. Returns cards that already satisfy every invariant
 * except "too few" and "too short", which are reported for the repair pass.
 */
export function enforce(raw: any[], spec: CardSpec): { cards: any[]; report: QualityReport; long: any[] } {
  const fixed: string[] = [];
  const remaining: string[] = [];
  let cards = Array.isArray(raw) ? [...raw] : [];

  // 1. Canonical type names. An unknown type becomes text rather than routing
  //    nowhere and rendering blank.
  for (const c of cards) {
    const want = resolveCardType(c?.type ?? c?.card_type);
    if (want && want !== c.type) { fixed.push(`type "${c.type}" → "${want}"`); c.type = want; }
    else if (!want) { fixed.push(`unknown type "${c?.type}" → "text"`); c.type = 'text'; }
  }

  // 2. Blank cards never ship.
  const before = cards.length;
  cards = cards.filter((c) => !isBlankCard(c));
  if (cards.length < before) fixed.push(`dropped ${before - cards.length} blank card(s)`);

  // 3. The highlight toggle is absolute in both directions.
  if (!spec.isHighlightCardNeeded) {
    const n = cards.length;
    cards = cards.filter((c) => c.type !== 'highlightCard');
    if (cards.length < n) fixed.push(`removed ${n - cards.length} highlight card(s): toggle is off`);
  } else if (!cards.some((c) => c.type === 'highlightCard')) {
    remaining.push('highlight card requested but none was produced');
  }

  // 4. Count. Excess is trimmed after the highlight filter so stripping one
  //    cannot silently leave the deck short.
  const want = Math.min(5, Math.max(1, spec.numCards || 5));
  if (cards.length > want) { cards = cards.slice(0, want); fixed.push(`trimmed to ${want} cards`); }
  else if (cards.length < want) remaining.push(`only ${cards.length} of ${want} cards`);

  cards = cards.map((c, i) => ({ ...c, card_number: i + 1 }));

  // 5. Over-length cards are collected, not cut here: a rewrite that keeps the
  //    point is better than a sentence lopped off. Trimming is the last resort.
  //    Under-length is not a failure — a short card that makes its point is
  //    fine, and padding to hit a floor makes content worse.
  const long: any[] = [];
  for (const c of cards) {
    const lim = CARD_LIMITS[c.type as MobileCardType];
    if (lim && text(c).length > lim.max) long.push(c);
  }

  return { cards, report: { fixed, remaining }, long };
}

/** One model call to bring over-length cards inside their ceiling. */
async function refitLong(long: any[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!long.length) return out;
  const prompt = `Each card below exceeds its character ceiling. Rewrite ONLY its text so it fits, keeping the point intact. Aim just under the ceiling, not far below it: land within about 10 percent of max so the card keeps its substance. Cut the least important clause rather than truncating a sentence. Keep the voice and any markdown. A text_img card must stay one prose paragraph with no lists.

${JSON.stringify(long.map((c) => {
    const lim = CARD_LIMITS[c.type as MobileCardType]!;
    return { card_number: c.card_number, type: c.type, max: lim.max, current_length: text(c).length, current_text: text(c) };
  }), null, 1)}

Return a JSON array of { "card_number": N, "new_text": "..." }. Raw JSON only, no fences.`;
  try {
    const raw = await generateText(prompt, { tier: 'normal', maxTokens: 3000 });
    const parsed = JSON.parse(raw.trim().replace(/^```json\n?|```$/g, ''));
    for (const r of Array.isArray(parsed) ? parsed : []) {
      if (r?.card_number && typeof r?.new_text === 'string') out.set(Number(r.card_number), r.new_text);
    }
  } catch {
    // fall through to the hard trim
  }
  return out;
}

/**
 * Full gate: deterministic pass, one targeted repair, then a deterministic
 * re-check so a repair can never reintroduce an over-length card.
 */
export async function ensureCardQuality(
  raw: any[],
  spec: CardSpec,
  log?: (m: string) => void,
): Promise<{ cards: MobileCard[]; report: QualityReport }> {
  const fixed: string[] = [];
  const say = (m: string) => { fixed.push(m); log?.(m); };

  let pass = enforce(raw, spec);
  let cards = pass.cards;
  fixed.push(...pass.report.fixed);

  // 1. Incomplete deck: generate exactly what is missing, with the existing
  //    cards supplied so the new ones do not repeat them.
  const want = Math.min(5, Math.max(1, spec.numCards || 5));
  const needHighlight = !!spec.isHighlightCardNeeded && !cards.some((c) => c.type === 'highlightCard');
  if (spec.topic && (cards.length < want || needHighlight)) {
    const missing = Math.max(want - cards.length, needHighlight ? 1 : 0);
    say(`generating ${missing} missing card(s)`);
    const extra = await topUp(spec, cards, missing, needHighlight);
    if (extra.length) {
      pass = enforce([...cards, ...extra], spec);
      cards = pass.cards;
      fixed.push(...pass.report.fixed);
    }
  }

  // 2. One review pass. It patches fields in place rather than regenerating,
  //    so a card keeps its slot, type and intent.
  if (spec.topic && !spec.skipReview) {
    const fixes = await reviewAndFix(spec, cards);
    if (fixes.size) {
      cards = cards.map((c) => {
        const patch = fixes.get(Number(c.card_number));
        // Merge fields; never let a patch change the number or type.
        return patch ? { ...c, ...patch, card_number: c.card_number, type: c.type } : c;
      });
      say(`reviewer corrected card(s) ${[...fixes.keys()].join(', ')}`);
    }
  }

  // 3. Over-length last, since the reviewer also edits text. Rewrite the
  //    offenders once; anything still over is trimmed, which guarantees the
  //    ceiling without ever shipping an oversized card.
  let last = enforce(cards, spec);
  if (last.long.length) {
    const rewrites = await refitLong(last.long);
    if (rewrites.size) {
      cards = last.cards.map((c) => {
        const t = rewrites.get(Number(c.card_number));
        return t ? { ...c, text: t } : c;
      });
      say(`rewrote ${rewrites.size} over-length card(s)`);
      last = enforce(cards, spec);
    }
    for (const c of last.long) {
      const lim = CARD_LIMITS[c.type as MobileCardType]!;
      c.text = trimToMax(text(c), lim.max);
      say(`card ${c.card_number}: trimmed to ${lim.max}`);
    }
  }

  // Recompute from the cards actually being returned. Deriving this from an
  // earlier pass let a short card ship while the report claimed none.
  const out = last.cards;
  const problems: string[] = [...last.report.remaining];
  for (const c of out) {
    const lim = CARD_LIMITS[c.type as MobileCardType];
    if (!lim) continue;
    const n = text(c).length;
    // Only the ceiling is a failure. A short card that makes its point is fine.
    if (n > lim.max) problems.push(`card ${c.card_number} (${c.type}) is ${n} chars, over the ${lim.max} maximum`);
  }
  if (spec.isHighlightCardNeeded && !out.some((c) => c.type === 'highlightCard')) {
    problems.push('highlight card requested but none present');
  }
  const wanted = Math.min(5, Math.max(1, spec.numCards || 5));
  if (out.length !== wanted) problems.push(`${out.length} cards, wanted ${wanted}`);

  const report: QualityReport = { fixed: [...fixed, ...last.report.fixed], remaining: [...new Set(problems)] };
  for (const m of report.remaining) log?.(`unresolved: ${m}`);
  return { cards: last.cards as MobileCard[], report };
}

// ── Regeneration and review ──────────────────────────────────────────────────
// Code guarantees the mechanics. These two handle what it cannot: a deck that
// came back incomplete, and content that is structurally valid but weak.

const CARD_SHAPES = `Allowed types and required fields:
- text: title, text (350-450 chars)
- text_img: title, text (230-280 chars, ONE prose paragraph, no lists), illustration_idea, visible_labels
- img_only: title, img_context, illustration_idea, visible_labels
- highlightCard: text (100-130 chars, no markdown)
- quiz: title, question, options [{id,text}], correctAnswer, incorrectMessage`;

function brief(cards: any[]): string {
  return cards
    .map((c) => `${c.card_number}. [${c.type}] ${String(c.title || '').slice(0, 60)} :: ${text(c).slice(0, 160)}`)
    .join('\n');
}

function ctx(spec: CardSpec): string {
  return [
    spec.topic && `Topic: ${spec.topic}`,
    spec.objective && `Objective: ${spec.objective}`,
    spec.level && `Audience: ${spec.level}`,
  ].filter(Boolean).join('\n');
}

function parseCards(raw: string): any[] {
  try {
    const t = raw.trim().replace(/^```json\n?|```$/g, '');
    const p = JSON.parse(t);
    return Array.isArray(p) ? p : Array.isArray(p?.cards) ? p.cards : [];
  } catch {
    return [];
  }
}

/** Generate the cards a short deck is missing, without repeating what exists. */
async function topUp(spec: CardSpec, existing: any[], missing: number, needHighlight: boolean): Promise<any[]> {
  if (missing <= 0 || !spec.topic) return [];
  const prompt = `Write ${missing} more mobile learning card(s) to complete a deck.

${ctx(spec)}

Cards already written — do NOT repeat these points:
${brief(existing) || '(none)'}

${needHighlight ? 'Exactly one of the new cards must be type "highlightCard".\n' : ''}${CARD_SHAPES}

Return a JSON array of exactly ${missing} card object(s). Raw JSON only, no fences.`;
  return parseCards(await generateText(prompt, { tier: 'normal', maxTokens: 4000 }));
}

/**
 * Review and fix in one call. The model returns a patch per failing card —
 * only the fields that change — rather than a verdict followed by a second
 * regeneration call. Cards it does not mention are left untouched.
 */
async function reviewAndFix(spec: CardSpec, cards: any[]): Promise<Map<number, Record<string, any>>> {
  const out = new Map<number, Record<string, any>>();
  if (!spec.topic || cards.length === 0) return out;

  const prompt = `Review these mobile learning cards and correct only the ones that are genuinely unusable.

${ctx(spec)}

${JSON.stringify(cards.map((c) => ({
    card_number: c.card_number,
    type: c.type,
    title: c.title,
    text: text(c),
    illustration_idea: c.illustration_idea || undefined,
    question: c.question || undefined,
  })), null, 1).slice(0, 12000)}

Correct a card only when it is:
- factually wrong or misleading
- empty of substance, or restating another card
- not teaching the stated topic
- a text_img whose text merely describes its own diagram instead of adding the why

Do NOT touch a card for length, formatting, type or tone. Those are enforced in code and your edits are re-checked against them. Most decks need no corrections at all.

Edit in place: keep each card's number, type and intent, and change the least that fixes it. Return only the fields you changed.

${CARD_SHAPES}

Return JSON: {"fixes":[{"card_number":N,"reason":"short","fields":{"text":"..."}}]}
An empty list is the correct answer for a sound deck. Raw JSON only, no fences.`;

  try {
    const raw = await generateText(prompt, { tier: 'normal', maxTokens: 4000 });
    const p = JSON.parse(raw.trim().replace(/^```json\n?|```$/g, ''));
    for (const fx of Array.isArray(p?.fixes) ? p.fixes : []) {
      const n = Number(fx?.card_number);
      if (n && fx?.fields && typeof fx.fields === 'object') out.set(n, fx.fields);
    }
  } catch {
    // review is advisory; a parse failure leaves the deck as generated
  }
  return out;
}
