import { COURSE_PLANNER_TYPES, shortsPlannerTypes, type CoursePlannerType, type ShortsPlannerType } from './mobileCardTypes';
import { COURSE_TYPE_DESCRIPTIONS } from './mobilePrompts';
import { getAbortSignal } from './abortContext';

export interface PlannedCard<T extends string> {
  card_number: number;
  title: string;
  teaching_goal: string;
  proposed_type: T;
  visual_idea: string | null;
}

export type PlannedShortCard = PlannedCard<ShortsPlannerType>;
export type PlannedCourseCard = PlannedCard<CoursePlannerType>;

export interface CardTypeDecision<T extends string = ShortsPlannerType | CoursePlannerType> {
  planner: T;
  chosen: T;
  probabilities: Partial<Record<T, number>>;
  backend: 'decisions' | 'planner-fallback';
}

export type DecidedCard<T extends string> = PlannedCard<T> & { decision: CardTypeDecision<T> };
export type DecidedShortCard = DecidedCard<ShortsPlannerType>;
export interface DecisionContext {
  topic: string; level?: string; objective?: string; additionalContext?: string;
  isHighlightCardNeeded?: boolean; sourceHasCode?: boolean;
}
export interface CardTypeProfile<T extends string> {
  types: readonly T[];
  descriptions: Record<T, string>;
  rulesText: string;
  applyHardRules(cards: DecidedCard<T>[], ctx: DecisionContext, log: (message: string) => void): void;
}

export interface DecisionAnswer {
  name: string;
  type: string;
  choice?: string;
  probabilities?: { value: string; probability: number }[];
}

export const CARD_TYPE_DESCRIPTIONS: Record<ShortsPlannerType, string> = {
  TEXT: 'Definitions, judgment, caveats, or concepts whose diagram would be decorative.',
  TEXT_IMG: 'A diagram teaches structure, flow, branching, state changes, or relationships; prose adds why it matters.',
  IMG_ONLY: 'A standalone visual teaches the whole concept through layout and embedded labels, without a paragraph.',
  SCENARIO: 'Last resort for a realistic decision, failure, or trade-off that loses meaning without context; only above 3 cards.',
  HIGHLIGHT: 'One concise modern insight; allowed only when the highlight toggle is on, at most one per short.',
};

export function cardTypeRules(highlight: boolean): string {
  return `${shortsPlannerTypes(highlight).map((type) => `${type}: ${CARD_TYPE_DESCRIPTIONS[type]}`).join('\n')}
Highlight toggle: ${highlight ? 'on; at most one HIGHLIGHT' : 'off; never HIGHLIGHT'}.
SCENARIO is a last resort, only when there are more than 3 cards, all required content is covered, and TEXT or TEXT_IMG would teach it materially less well.
Visual minimum: 5 cards need at least 2 visual cards, 4 need at least 2, 3 need at least 1; 1–2 have no minimum. TEXT_IMG and IMG_ONLY count as visual.
Keep one focused teaching goal per card and cover the objective and additional context before optional insights.`;
}

/** Pure selection and ordered hard rules, shared with the offline checks. */
export function chooseTypes<T extends string>(
  plan: PlannedCard<T>[], answers: DecisionAnswer[], profile: CardTypeProfile<T>,
  ctx: DecisionContext, log: (message: string) => void = () => {},
): DecidedCard<T>[] {
  const allowed = profile.types;
  const cards: DecidedCard<T>[] = plan.map((card) => {
    const answer = answers.find((a) => a.name === `card${card.card_number}`);
    const probabilities: CardTypeDecision<T>['probabilities'] = {};
    const valid = answer?.type === 'choice' && Array.isArray(answer.probabilities);
    if (valid) {
      for (const entry of answer.probabilities!) {
        if (allowed.includes(entry.value as T) && Number.isFinite(entry.probability)
          && entry.probability >= 0 && entry.probability <= 1) {
          probabilities[entry.value as T] = entry.probability;
        }
      }
    }
    const usable = valid && Object.keys(probabilities).length > 0;
    let chosen = card.proposed_type;
    if (usable) {
      // The floor biases close calls toward the planner; raw probabilities stay available for audit.
      const score = (type: T) => Math.max(probabilities[type] ?? 0, type === card.proposed_type ? 0.2 : 0);
      chosen = allowed.reduce((best, type) => score(type) > score(best) ? type : best,
        allowed.includes(card.proposed_type) ? card.proposed_type : allowed[0]);
    }
    return { ...card, decision: { planner: card.proposed_type, chosen, probabilities,
      backend: usable ? 'decisions' : 'planner-fallback' } };
  });
  profile.applyHardRules(cards, ctx, log);
  return cards;
}

export function shortsProfile(highlight: boolean): CardTypeProfile<ShortsPlannerType> {
  return { types: shortsPlannerTypes(highlight), descriptions: CARD_TYPE_DESCRIPTIONS,
    rulesText: cardTypeRules(highlight), applyHardRules(cards) {
      let highlights = 0;
      for (const card of cards) {
        if (card.decision.chosen === 'HIGHLIGHT' && (!highlight || highlights++ >= 1)) card.decision.chosen = 'TEXT';
      }
      for (const card of cards) {
        if (card.decision.chosen === 'SCENARIO' && cards.length <= 3) card.decision.chosen = 'TEXT';
      }
      const minimum = cards.length === 5 || cards.length === 4 ? 2 : cards.length === 3 ? 1 : 0;
      let visuals = cards.filter((card) => ['TEXT_IMG', 'IMG_ONLY'].includes(card.decision.chosen)).length;
      const candidates = cards.filter((card) => card.decision.chosen === 'TEXT')
        .sort((a, b) => (b.decision.probabilities.TEXT_IMG ?? 0) - (a.decision.probabilities.TEXT_IMG ?? 0));
      for (const card of candidates) {
        if (visuals >= minimum) break;
        card.decision.chosen = 'TEXT_IMG';
        visuals++;
      }
      // Only TEXT cards are upgraded, so a SCENARIO/HIGHLIGHT-heavy short can still fall short. Keep the decisions
      // (they are still better than the planner's guesses) and let the caller log it.
      if (visuals < minimum) {
        for (const card of cards) (card.decision as any).visualMinimumMissed = true;
      }
    },
  };
}

export function chooseCardTypes(plan: PlannedShortCard[], answers: DecisionAnswer[], highlight: boolean): DecidedShortCard[] {
  return chooseTypes(plan, answers, shortsProfile(highlight), { topic: '' });
}

export function chapterContainsCode(source: string): boolean {
  // Educative's Code widgets are rendered as fenced blocks by fetchLessonContent.
  return /```[\s\S]*?```|~~~[\s\S]*?~~~|"type"\s*:\s*"(?:Code|CodeSnippet|CodeExercise|CodeRunnable)"|<code\b/i.test(source);
}

export const COURSE_PROFILE: CardTypeProfile<CoursePlannerType> = {
  types: COURSE_PLANNER_TYPES,
  descriptions: COURSE_TYPE_DESCRIPTIONS,
  rulesText: `Code types require code in the chapter source. First card must be text or text_img.
Recap appears exactly once, as the last card. Include at least one img_only after the introduction.
Without code, aim for at least 50% text_img + img_only; this is a preference, not a minimum.`,
  applyHardRules(cards, ctx, log) {
    // A short plan cannot carry the introduction/image/recap shape, but failing
    // here kills the chapter: the remaining rules still apply to what we have.
    if (cards.length < 3) log(`card-type-decision: only ${cards.length} card(s); the introduction/image/recap shape cannot be applied in full`);
    for (const card of cards) {
      if (!ctx.sourceHasCode && ['text_code', 'code_output'].includes(card.decision.chosen)) card.decision.chosen = 'text';
    }
    const first = cards[0];
    if (!['text', 'text_img'].includes(first.decision.chosen)) {
      first.decision.chosen = first.visual_idea?.trim() ? 'text_img' : 'text';
    }
    for (const card of cards.slice(0, -1)) {
      if (card.decision.chosen === 'recap') card.decision.chosen = 'text';
    }
    cards[cards.length - 1].decision.chosen = 'recap';
    if (!cards.some((card) => card.decision.chosen === 'img_only')) {
      // Preserve the introduction and recap when adding the standalone visual.
      const candidate = cards.slice(1, -1).filter((card) => ['text_img', 'text'].includes(card.decision.chosen))
        .sort((a, b) => (b.decision.probabilities.img_only ?? 0) - (a.decision.probabilities.img_only ?? 0))[0];
      // img_only is a target, not a requirement: a chapter with no eligible
      // interior text card still publishes, so log it rather than failing.
      if (candidate) candidate.decision.chosen = 'img_only';
      else log('card-type-decision: no eligible interior text card for the img_only minimum');
    }
    if (!ctx.sourceHasCode && cards.filter((card) => ['text_img', 'img_only'].includes(card.decision.chosen)).length / cards.length < 0.5) {
      log('card-type-decision: visual share under 50% without code (soft target)');
    }
  },
};

export async function decideTypes<T extends string>(
  plan: PlannedCard<T>[], context: DecisionContext, log: (message: string) => void,
  profile: CardTypeProfile<T>, applyFallbackRules = true,
): Promise<DecidedCard<T>[]> {
  const fallback = () => {
    const cards = plan.map((card): DecidedCard<T> => ({ ...card,
      decision: { planner: card.proposed_type, chosen: card.proposed_type, probabilities: {}, backend: 'planner-fallback' } }));
    if (applyFallbackRules) profile.applyHardRules(cards, context, log);
    return cards;
  };
  const mode = process.env.CARD_TYPE_DECISION || 'decisions';
  if (mode === 'planner' || mode === 'off') {
    log(`card-type-decision: ${mode} mode; keeping planner types`);
    return fallback();
  }
  try {
    if (mode !== 'decisions') throw new Error(`unknown CARD_TYPE_DECISION mode: ${mode}`);
    const answers = await requestDecisions({
      model: 'gpt-6-luna',
      input: `Topic: ${context.topic}\nLevel: ${context.level || 'beginner'}\nObjective: ${context.objective || ''}\nContext: ${context.additionalContext || ''}\n${context.sourceHasCode === undefined ? '' : `Chapter source contains code: ${context.sourceHasCode ? 'yes' : 'no'}\n`}Full plan: ${JSON.stringify(plan)}\nType rules:\n${profile.rulesText}`,
      questions: plan.map((card) => ({ type: 'choice', name: `card${card.card_number}`,
        instructions: `Which card type teaches CARD ${card.card_number}'s teaching goal best on a phone screen? Follow the rules in the input.`,
        choices: profile.types.map((value) => ({ value, description: profile.descriptions[value] })),
      })),
    }, log);
    const decided = chooseTypes(plan, answers, profile, context, log);
    if ((decided[0]?.decision as any)?.visualMinimumMissed) log('card-type-decision: visual minimum not met after upgrading TEXT cards');
    return decided;
  } catch (error) {
    log(`card-type-decision: planner fallback — ${error instanceof Error ? error.message : String(error)}`);
    return fallback();
  }
}

// Keep the original shorts entry point and fallback semantics for existing callers.
export function decideCardTypes(plan: PlannedShortCard[], context: DecisionContext, log: (message: string) => void): Promise<DecidedShortCard[]> {
  return decideTypes(plan, context, log, shortsProfile(!!context.isHighlightCardNeeded), false);
}

// Shared Decisions transport; callers retain their own fallback policy.
export async function requestDecisions(body: { model: string; input: string; questions: any[] },
  log: (message: string) => void = () => {}): Promise<DecisionAnswer[]> {
  const controller = new AbortController();
  const signal = getAbortSignal();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 30_000);
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    const response = await fetch('https://api.openai.com/v1/decisions', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Decisions API HTTP ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.answers)) throw new Error('Decisions API returned no answers array');
    log(`card-type-decision: ${result.usage?.input_tokens ?? 'unknown'} input tokens`);
    return result.answers.filter((answer: any) => answer && typeof answer.name === 'string');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
