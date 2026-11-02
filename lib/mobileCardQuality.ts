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
  const first = enforce(raw, spec);
  let cards = first.cards;

  if (first.short.length) {
    const rewrites = await expandShort(first.short);
    if (rewrites.size) {
      cards = cards.map((c) => {
        const t = rewrites.get(Number(c.card_number));
        return t ? { ...c, text: t } : c;
      });
      first.report.fixed.push(`expanded ${rewrites.size} short card(s)`);
    }
  }

  // Re-run deterministically: the repair is model output and must be bounded.
  const second = enforce(cards, spec);
  const report: QualityReport = {
    fixed: [...first.report.fixed, ...second.report.fixed],
    remaining: [...new Set([...second.report.remaining, ...second.short.map((c) => `card ${c.card_number} still under minimum`)])],
  };
  for (const m of [...report.fixed, ...report.remaining.map((r) => `unresolved: ${r}`)]) log?.(m);
  return { cards: second.cards as MobileCard[], report };
}
