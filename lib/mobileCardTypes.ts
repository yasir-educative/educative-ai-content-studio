
// Card type normalisation.
//
// The planner and JSON-generator stages are free-text LLM calls, so the same
// card arrives under many spellings: the planner emits SCREAMING_SNAKE
// (HIGHLIGHT, TEXT_IMG, QUIZ_MCQ) while the UI and MobileCard type expect
// camelCase canonical names (highlightCard, text_img, quiz). A mismatch used to
// silently drop cards, so every spelling is folded down to a canonical name here.
//
// Lookup keys are reduced to lowercase alphanumerics, so hyphens, underscores,
// spaces, and casing are all irrelevant — "TEXT_IMG", "text-img", and
// "Text Img" all resolve to the same entry.

export const CARD_TYPES = [
  'text',
  'text_img',
  'img_only',
  'text-with-code',
  'code-with-output',
  'comparisonCards',
  'recapCard',
  'quiz',
  'trueFalseCard',
  'fillInTheBlank',
  'scenarioCard',
  'highlightCard',
] as const;

export type MobileCardType = (typeof CARD_TYPES)[number];
export const CANONICAL_CARD_TYPES = CARD_TYPES;

export function isCardType(x: unknown): x is MobileCardType {
  return typeof x === 'string' && CARD_TYPES.some((type) => type === x);
}

// ── Planner vocabularies ──────────────────────────────────────────────────────
// The planner picks from a small enum, not the full canonical set: it decides the
// teaching shape, and the generator fills it in. Keeping the enums here lets the
// JSON schemas, the Decisions call and the prompts all build from one list.

export const PLANNER_CARD_TYPES = ['TEXT', 'TEXT_IMG', 'IMG_ONLY', 'HIGHLIGHT', 'SCENARIO', 'QUIZ_MCQ'] as const;
export type PlannerCardType = (typeof PLANNER_CARD_TYPES)[number];
export const plannerToCardType: Record<PlannerCardType, MobileCardType> = {
  TEXT: 'text',
  TEXT_IMG: 'text_img',
  IMG_ONLY: 'img_only',
  HIGHLIGHT: 'highlightCard',
  SCENARIO: 'scenarioCard',
  QUIZ_MCQ: 'quiz',
};

// Shorts exclude quizzes; derive the menu from the shared planner enum.
export const SHORTS_PLANNER_TYPES = PLANNER_CARD_TYPES.filter((type) => type !== 'QUIZ_MCQ');
export type ShortsPlannerType = (typeof SHORTS_PLANNER_TYPES)[number];
export function shortsPlannerTypes(highlight: boolean): ShortsPlannerType[] {
  return SHORTS_PLANNER_TYPES.filter((type) => highlight || type !== 'HIGHLIGHT');
}

export const COURSE_PLANNER_TYPES = ['text', 'highlight', 'text_img', 'img_only', 'text_code',
  'code_output', 'compare', 'scenario', 'quiz', 'true_false', 'fill_in_the_blanks', 'recap'] as const;
export type CoursePlannerType = (typeof COURSE_PLANNER_TYPES)[number];
export const coursePlannerToCardType: Record<CoursePlannerType, MobileCardType> = {
  text: 'text', highlight: 'highlightCard', text_img: 'text_img', img_only: 'img_only',
  text_code: 'text-with-code', code_output: 'code-with-output', compare: 'comparisonCards',
  scenario: 'scenarioCard', quiz: 'quiz', true_false: 'trueFalseCard',
  fill_in_the_blanks: 'fillInTheBlank', recap: 'recapCard',
};

// Regeneration offers the same shorts type set as the planner, in canonical order.
export const SHORTS_CARD_TYPES = CARD_TYPES.filter((type) =>
  SHORTS_PLANNER_TYPES.some((planner) => plannerToCardType[planner] === type));

function foldKey(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Semantic aliases only — exact canonical names are registered automatically below.
const SEMANTIC_ALIASES: Record<string, MobileCardType> = {
  // text
  textcard: 'text',
  plaintext: 'text',
  textonly: 'text',
  prose: 'text',

  // text_img
  textimage: 'text_img',
  textandimage: 'text_img',
  textwithimage: 'text_img',
  textwithimg: 'text_img',
  imgtext: 'text_img',
  imagetext: 'text_img',
  textimgcard: 'text_img',

  // img_only
  imageonly: 'img_only',
  imgonlycard: 'img_only',
  imageonlycard: 'img_only',
  onlyimage: 'img_only',
  onlyimg: 'img_only',
  image: 'img_only',
  img: 'img_only',

  // highlightCard
  highlight: 'highlightCard',
  highlights: 'highlightCard',
  highlightcards: 'highlightCard',
  insight: 'highlightCard',
  insightcard: 'highlightCard',
  keyinsight: 'highlightCard',
  takeaway: 'highlightCard',

  // scenarioCard
  scenario: 'scenarioCard',
  scenarios: 'scenarioCard',
  scenariocards: 'scenarioCard',
  criticalthinking: 'scenarioCard',

  // comparisonCards
  compare: 'comparisonCards',
  comparison: 'comparisonCards',
  comparisoncard: 'comparisonCards',
  comparecards: 'comparisonCards',
  sidebyside: 'comparisonCards',

  // recapCard
  recap: 'recapCard',
  recapcards: 'recapCard',
  summary: 'recapCard',
  summarycard: 'recapCard',

  // quiz
  quizmcq: 'quiz',
  mcq: 'quiz',
  quizcard: 'quiz',
  multiplechoice: 'quiz',
  multiplechoicequestion: 'quiz',
  knowledgecheck: 'quiz',

  // trueFalseCard
  truefalse: 'trueFalseCard',
  truefalsequestion: 'trueFalseCard',
  tf: 'trueFalseCard',

  // fillInTheBlank
  fillintheblanks: 'fillInTheBlank',
  fillblank: 'fillInTheBlank',
  fillblanks: 'fillInTheBlank',
  blank: 'fillInTheBlank',
  clozed: 'fillInTheBlank',
  cloze: 'fillInTheBlank',

  // text-with-code
  codewithtext: 'text-with-code',
  textcode: 'text-with-code',
  codetext: 'text-with-code',

  // code-with-output
  codeoutput: 'code-with-output',
  outputcode: 'code-with-output',
  codeandoutput: 'code-with-output',
};

const ALIAS_MAP: Record<string, MobileCardType> = (() => {
  const m: Record<string, MobileCardType> = {};
  // Canonical names always resolve to themselves.
  for (const t of CANONICAL_CARD_TYPES) m[foldKey(t)] = t;
  // Semantic aliases never override a canonical name.
  for (const [k, v] of Object.entries(SEMANTIC_ALIASES)) {
    if (!(k in m)) m[k] = v;
  }
  return m;
})();

// Resolve any spelling to a canonical card type. Returns null when nothing matches,
// so callers can decide between a default and dropping the card.
export function resolveCardType(raw: unknown): MobileCardType | null {
  const key = foldKey(String(raw ?? ''));
  if (!key) return null;
  if (ALIAS_MAP[key]) return ALIAS_MAP[key];
  // Trailing "card"/"cards" is noise: "highlightcard" → "highlight".
  const stripped = key.replace(/cards?$/, '');
  if (stripped && ALIAS_MAP[stripped]) return ALIAS_MAP[stripped];
  return null;
}

// Same as resolveCardType but falls back to 'text' and warns, for call sites
// that must always produce a card.
export function normalizeCardType(raw: unknown, context = 'mobile'): MobileCardType {
  const resolved = resolveCardType(raw);
  if (!resolved) {
    console.warn(`[${context}] unknown card type "${String(raw)}" — defaulting to "text"`);
    return 'text';
  }
  return resolved;
}

// ── Highlight variants ────────────────────────────────────────────────────────
// One must be chosen before a highlight card can be published. The JSON schema
// enum and both generator prompts are built from this list, so the model can
// only return these ids.

export const HIGHLIGHT_CARD_TYPES = [
  { id: 'key-insight', label: 'Key insight', meaning: 'A hard-earned truth.' },
  { id: 'point-to-ponder', label: 'Point to ponder', meaning: 'A provocative question.' },
  { id: 'bigger-picture', label: 'Bigger picture', meaning: 'A zoomed-out perspective.' },
] as const;
export const HIGHLIGHT_CARD_TYPE_IDS = HIGHLIGHT_CARD_TYPES.map((type) => type.id);
export const highlightCardTypeGuide = () =>
  HIGHLIGHT_CARD_TYPES.map((type) => `- \`${type.id}\`: ${type.meaning}`).join('\n');
export type HighlightCardType = (typeof HIGHLIGHT_CARD_TYPES)[number]['id'];
export function isHighlightCardType(x: unknown): x is HighlightCardType {
  return HIGHLIGHT_CARD_TYPES.some((type) => type.id === x);
}
// Model output varies ("Key Insight", "key_insight"); anything unrecognised stays unselected.
export function normalizeHighlightCardType(x: unknown): HighlightCardType | undefined {
  const id = String(x || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return isHighlightCardType(id) ? id : undefined;
}
