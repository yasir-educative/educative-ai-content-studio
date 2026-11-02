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
export function enforce(raw: any[], spec: CardSpec): { cards: any[]; report: QualityReport; short: any[] } {
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

  // 5. Character ceilings, last, so `short` references the cards actually
  //    returned rather than copies discarded by the renumber.
  const short: any[] = [];
  for (const c of cards) {
    const lim = CARD_LIMITS[c.type as MobileCardType];
    if (!lim) continue;
    const body = text(c);
    if (body.length > lim.max) { c.text = trimToMax(body, lim.max); fixed.push(`card ${c.card_number}: trimmed to ${lim.max}`); }
    else if (body.length < lim.min) short.push(c);
  }

  return { cards, report: { fixed, remaining }, short };
}

/** One model call to lengthen only the cards that came back too short. */
async function expandShort(short: any[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!short.length) return out;
  const prompt = `Each card below is under its minimum length. Rewrite ONLY its text so it lands inside the range, adding real substance rather than padding. Keep the meaning, voice and any markdown. text_img cards must stay one prose paragraph with no lists.

${JSON.stringify(short.map((c) => {
  const lim = CARD_LIMITS[c.type as MobileCardType]!;
  return { card_number: c.card_number, type: c.type, min: lim.min, max: lim.max, current_length: text(c).length, current_text: text(c) };
}), null, 1)}

Return a JSON array of { "card_number": N, "new_text": "..." }. Raw JSON only, no fences.`;
  try {
    const raw = await generateText(prompt, { tier: 'normal', maxTokens: 3000 });
    const parsed = JSON.parse(raw.trim().replace(/^```json\n?|```$/g, ''));
    for (const r of Array.isArray(parsed) ? parsed : []) {
      if (r?.card_number && typeof r?.new_text === 'string') out.set(Number(r.card_number), r.new_text);
    }
  } catch {
    // keep the short text rather than failing the run
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

  // 2. Lengthen anything still under its minimum.
  if (pass.short.length) {
    const rewrites = await expandShort(pass.short);
    if (rewrites.size) {
      cards = cards.map((c) => {
        const t = rewrites.get(Number(c.card_number));
        return t ? { ...c, text: t } : c;
      });
      say(`expanded ${rewrites.size} short card(s)`);
    }
  }

  // 3. Review substance, then rewrite only what fails. One round: a second
  //    reviewer pass on its own output tends to churn rather than improve.
  if (spec.topic && !spec.skipReview) {
    const failing = await review(spec, cards);
    if (failing.length) {
      say(`reviewer rejected card(s) ${failing.join(', ')}`);
      const fresh = await regenerate(spec, cards, failing);
      if (fresh.size) {
        cards = cards.map((c) => fresh.get(Number(c.card_number)) ?? c);
        say(`rewrote ${fresh.size} card(s)`);
      }
    }
  }

  // 4. Final deterministic pass. Everything above is model output and must be
  //    bounded again: a rewrite can be blank, over-length or wrongly typed.
  const last = enforce(cards, spec);
  const report: QualityReport = {
    fixed: [...fixed, ...last.report.fixed],
    remaining: [
      ...new Set([
        ...last.report.remaining,
        ...last.short.map((c) => `card ${c.card_number} still under minimum`),
      ]),
    ],
  };
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

/** Judge substance only; length, type and blankness are already guaranteed. */
async function review(spec: CardSpec, cards: any[]): Promise<number[]> {
  if (!spec.topic || cards.length === 0) return [];
  const prompt = `Review these mobile learning cards and name only the ones that must be rewritten.

${ctx(spec)}

${brief(cards)}

A card fails only if it is genuinely unusable:
- factually wrong or misleading
- says nothing concrete, or restates another card
- does not teach the stated topic
- a text_img whose text just describes its own diagram instead of adding the why

Do NOT fail a card for length, formatting, type or tone. Those are handled elsewhere. Most decks should return an empty list.

Return JSON: {"failing":[card_number,...]}. Raw JSON only, no fences.`;
  try {
    const raw = await generateText(prompt, { tier: 'edit', maxTokens: 400 });
    const p = JSON.parse(raw.trim().replace(/^```json\n?|```$/g, ''));
    return Array.isArray(p?.failing) ? p.failing.map(Number).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Rewrite the cards the reviewer rejected, keeping their type and slot. */
async function regenerate(spec: CardSpec, cards: any[], failing: number[]): Promise<Map<number, any>> {
  const out = new Map<number, any>();
  const bad = cards.filter((c) => failing.includes(Number(c.card_number)));
  if (!bad.length || !spec.topic) return out;
  const keep = cards.filter((c) => !failing.includes(Number(c.card_number)));
  const prompt = `Rewrite these mobile learning cards. Each was rejected as unusable: wrong, empty of substance, redundant, or off-topic.

${ctx(spec)}

Keep each card's card_number and type. Do not duplicate the cards being kept:
${brief(keep) || '(none)'}

Rewrite these:
${JSON.stringify(bad, null, 1).slice(0, 6000)}

${CARD_SHAPES}

Return a JSON array of the rewritten card objects. Raw JSON only, no fences.`;
  for (const c of parseCards(await generateText(prompt, { tier: 'normal', maxTokens: 4000 }))) {
    if (c?.card_number) out.set(Number(c.card_number), c);
  }
  return out;
}
