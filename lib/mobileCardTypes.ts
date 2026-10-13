import type { MobileCardType } from './mobileCourseStorage';

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

export const CANONICAL_CARD_TYPES: MobileCardType[] = [
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
];

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
