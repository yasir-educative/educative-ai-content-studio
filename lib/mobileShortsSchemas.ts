import { CARD_TYPES, COURSE_PLANNER_TYPES, HIGHLIGHT_CARD_TYPES, HIGHLIGHT_CARD_TYPE_IDS, shortsPlannerTypes } from './mobileCardTypes';

function object(properties: Record<string, unknown>) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
const text = { type: ['string', 'null'] };
const nullableArray = (items: unknown) => ({ type: ['array', 'null'], items });

export function shortsPlannerSchema(numCards: number, highlight: boolean) {
  return object({ cards: { type: 'array', minItems: numCards, maxItems: numCards, items: object({
    card_number: { type: 'integer' }, title: { type: 'string' }, teaching_goal: { type: 'string' },
    proposed_type: { type: 'string', enum: shortsPlannerTypes(highlight) }, visual_idea: text,
  }) } });
}

// Every property is required in strict mode; unused content fields are null.
export const SHORTS_CARD_SCHEMA = object({
  type: { type: 'string', enum: [...CARD_TYPES] },
  card_number: { type: 'integer' }, title: text, text,
  illustration_idea: text, visible_labels: text, img_context: text,
  text_1: text, text_2: text, language: text, code: text,
  output_available: { type: ['boolean', 'null'] }, output: text, heading: text,
  leftOption: { ...object({ label: text, heading: text, description: text }), type: ['object', 'null'] },
  rightOption: { ...object({ label: text, heading: text, description: text }), type: ['object', 'null'] },
  content: nullableArray(object({ heading: text, text })),
  question: text,
  options: { anyOf: [nullableArray(object({ id: { type: 'integer' }, text: { type: 'string' } })),
    { type: 'array', items: { type: 'string' } }] },
  correctAnswer: { type: ['number', 'string', 'null'] }, incorrectMessage: text, explanation: text,
  correctOptions: nullableArray({ type: 'string' }),
  sections: nullableArray(object({ heading: { type: 'string' }, content: { type: 'string' } })),
  scenarioType: text,
  // Strict mode can only return one of these ids (null for non-highlight cards).
  highlightCardType: { type: ['string', 'null'], enum: [...HIGHLIGHT_CARD_TYPE_IDS, null],
    description: `highlightCard only, otherwise null. ${HIGHLIGHT_CARD_TYPES.map((type) => `${type.id}: ${type.meaning}`).join(' ')}` },
});
export const SHORTS_CARDS_SCHEMA = object({ cards: { type: 'array', items: SHORTS_CARD_SCHEMA } });

export const COURSE_PLANNER_SCHEMA = object({ cards: { type: 'array', minItems: 3, items: object({
  card_number: { type: 'integer' }, card_type: { type: 'string', enum: [...COURSE_PLANNER_TYPES] },
  card_title: { type: 'string' }, content_focus: { type: 'string' }, illustration_idea: text,
}) } });
