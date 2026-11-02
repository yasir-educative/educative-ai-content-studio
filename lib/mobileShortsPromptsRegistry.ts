import { registerPrompt } from './promptStore';
import {
  topicDetailerPrompt,
  shortsCardPlannerPrompt,
  cardsGeneratorPrompt,
  shortsJsonGeneratorPrompt,
} from './mobileShortsPrompts';
import { cardTypeRules } from './cardTypeDecider';

export const registeredTopicDetailerPrompt = registerPrompt('shorts-topic-detailer', topicDetailerPrompt, 'mobile-short');
const cardsPrompt = registerPrompt('shorts-cards-generator',   cardsGeneratorPrompt,         'mobile-short');
const jsonPrompt = registerPrompt('shorts-json-generator',    shortsJsonGeneratorPrompt,    'mobile-short');

const plannerPrompt = registerPrompt('shorts-card-planner', shortsCardPlannerPrompt, 'mobile-short');
export const registeredShortsCardPlannerPrompt = (
  args: Omit<Parameters<typeof shortsCardPlannerPrompt>[0], 'typeRules'> & { isHighlightCardNeeded?: boolean },
) => plannerPrompt({ ...args, typeRules: cardTypeRules(!!args.isHighlightCardNeeded) });

// Dynamic instructions must be variables: template capture cannot evaluate boolean branches per run.
function highlightInstructions(enabled?: boolean): string {
  return enabled ? 'HIGHLIGHT is allowed at most once, only if assigned in the fixed plan.' : 'HIGHLIGHT is disabled. Never add a highlight card.';
}
export const registeredShortsCardsGeneratorPrompt = (args: Parameters<typeof cardsGeneratorPrompt>[0]) =>
  cardsPrompt({ ...args, highlightInstructions: highlightInstructions(args.isHighlightCardNeeded) });
export const registeredShortsJsonGeneratorPrompt = (args: Parameters<typeof shortsJsonGeneratorPrompt>[0]) =>
  jsonPrompt({ ...args, highlightInstructions: highlightInstructions(args.isHighlightCardNeeded) });
