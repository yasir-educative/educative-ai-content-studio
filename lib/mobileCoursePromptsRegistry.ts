import { registerPrompt } from './promptStore';
import { mobileCourseArchitectPrompt } from './mobileCourseArchitectPrompt';
import {
  cardPlannerPrompt,
  cardsGeneratorPrompt,
  cardTextRefinerPrompt,
  jsonGeneratorPrompt,
} from './mobilePrompts';

export const registeredArchitectPrompt       = registerPrompt('mobile-architect',       mobileCourseArchitectPrompt, 'mobile-course');
export const registeredCardPlannerPrompt     = registerPrompt('mobile-card-planner',    cardPlannerPrompt,           'mobile-course');
export const registeredCardsGeneratorPrompt  = registerPrompt('mobile-cards-generator', cardsGeneratorPrompt,        'mobile-course');
export const registeredCardTextRefinerPrompt = registerPrompt('mobile-text-refiner',    cardTextRefinerPrompt,       'mobile-course');
export const registeredJsonGeneratorPrompt   = registerPrompt('mobile-json-generator',  jsonGeneratorPrompt,         'mobile-course');
