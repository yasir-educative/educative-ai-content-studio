import { registerPrompt } from './promptStore';
import {
  topicDetailerPrompt,
  cardsGeneratorPrompt,
  shortsJsonGeneratorPrompt,
} from './mobileShortsPrompts';

export const registeredTopicDetailerPrompt            = registerPrompt('shorts-topic-detailer',    topicDetailerPrompt,          'mobile-short');
export const registeredShortsCardsGeneratorPrompt     = registerPrompt('shorts-cards-generator',   cardsGeneratorPrompt,         'mobile-short');
export const registeredShortsJsonGeneratorPrompt      = registerPrompt('shorts-json-generator',    shortsJsonGeneratorPrompt,    'mobile-short');
