// Mobile Shorts Pipeline
// Mirrors the n8n "Mobile shorts - GPT Images" workflow — AI generation only.
// Collection creation and publishing happen separately via the /publish API route.
//
//   1. Topic Detailer  (GPT-4o search)
//   2. Cards Generator (Gemini 2.5 Pro)
//   3. JSON Generator  (Gemini 2.5 Pro)
//   4. Image generation for text_img / img_only cards

import { openaiSearch, generateText, TEXT_GENERATOR_MODEL, parseJsonLoose } from './ai';
import { generateGptImage, slugify } from './imageGen';
import type { MobileCard } from './mobileCourseStorage';
import {
  registeredTopicDetailerPrompt,
  registeredShortsCardsGeneratorPrompt,
  registeredShortsJsonGeneratorPrompt,
} from './mobileShortsPromptsRegistry';

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface MobileShortInput {
  topic: string;
  domain?: string;
  level?: string;
  objective?: string;
  additionalContext?: string;
  isHighlightCardNeeded?: boolean;
  numCards?: number;
  authorId?: string;
}

export interface MobileShortEvent {
  type: 'meta' | 'stage' | 'data' | 'log' | 'done' | 'error' | 'cancelled';
  name?: string;
  status?: 'start' | 'done' | 'error';
  message?: string;
  payload?: any;
  shortId?: string;
}

export type MobileShortEmit = (e: MobileShortEvent) => void;

// ── Image prompt builder (exact n8n "Img/textImg prompt" node) ────────────────

function buildShortCardImagePrompt(card: any): string {
  const illustrationIdea = String(card.illustration_idea || '');
  const visibleLabels = String(card.visible_labels || '');
  const title = String(card.title || '');
  const hasLabels = visibleLabels.trim().length > 0;

  if (card.type === 'img_only') {
    const imgContext = String(card.img_context || '');
    const labelsBlock = hasLabels
      ? `Render these labels, each exactly once: "${visibleLabels}". Add short annotations (2–8 words) where they clarify.`
      : `Derive labels and annotations from the illustration idea and context. Label every key element with short phrases (2–8 words).`;
    return `Self-contained technical infographic, portrait 640×1024, white (#FFF) background. No external text — viewer must fully understand the concept from this diagram and annotations alone.\n\nLayout: 24px margins. Top-to-bottom or left-to-right flow. Center-aligned. 5–10 primary elements — rich but not cluttered. Generous whitespace. Arrows, connector lines, numbered steps for hierarchy.\n\nStyle: Flat 2D vector only. 2px uniform stroke, 8px rounded corners. Outlined shapes with white or pale tinted fill. Consistent icon size per tier. No 3D, no perspective, no shadows, no gradients, no cartoon characters, no hand-drawn or sketch style.\n\nColors: Only these — #4A90D9 (blue), #3AAFA9 (teal) as primary. #48BB78 (green), #E6A817 (amber) sparingly as accent. All text #2D3748. No reds, no grays, no off-palette colors.\n\nAnnotations: Callouts, labeled arrows, step numbers on elements. Enough detail for zero prior knowledge. Every annotation carries weight.\n\nText: ${labelsBlock} Capitalize first word of every label, rest lowercase unless acronym. Example: "API gateway" not "api gateway" or "API Gateway". Geometric sans-serif, medium weight. No paragraphs, no title. No misspellings.\n\nIllustration idea: "${illustrationIdea}"\nContext (do NOT render as text): "${title} — ${imgContext}"`;
  }

  // text_img
  const content = String(card.text || '');
  const labelsBlock = hasLabels
    ? `Render ONLY these labels, each exactly once: "${visibleLabels}". Short clarifying labels (2–5 words) on connectors allowed.`
    : `Derive concise labels (2–5 words each) from the illustration idea and context. Label every key element.`;
  return `Technical infographic, portrait 640×1024, white (#FFF) background. Diagram-only — no title, no heading, no paragraphs.\n\nLayout: 24px margins. Top-to-bottom or left-to-right flow. Center-aligned. 4–8 primary elements maximum — not too sparse, not cluttered. Generous whitespace between logical groups. Arrows and connector lines for hierarchy.\n\nStyle: Flat 2D vector only. 2px uniform stroke, 8px rounded corners. Outlined shapes with white or pale tinted fill. Consistent icon size per tier. Absolutely no 3D, no perspective, no shadows, no gradients, no cartoon characters, no hand-drawn or sketch style, no textures.\n\nColors: Only these — #4A90D9 (blue) and #3AAFA9 (teal) as primary. #48BB78 (green) and #E6A817 (amber) sparingly as accent. All text #2D3748. No reds, no grays, no off-palette colors.\n\nText: ${labelsBlock} Capitalize first word of every label, rest lowercase unless acronym. Example: "API gateway" not "api gateway" or "API Gateway". Geometric sans-serif, medium weight. No misspellings.\n\nIllustration idea: "${illustrationIdea}"\nContext (do NOT render as text): "${title} — ${content}"`;
}

async function generateCardImage(card: any, order: number, shortId: string): Promise<string | null> {
  try {
    const subfolder = `mobile-shorts/${slugify(shortId)}`;
    const rawPrompt = buildShortCardImagePrompt(card);
    const result = await generateGptImage(card.illustration_idea || '', order, subfolder, {
      size: '1024x1536',
      rawPrompt,
    });
    return result.url;
  } catch (e: any) {
    console.warn('[mobileShortsPipeline] image gen failed:', e?.message);
    return null;
  }
}

// ── Raw card → MobileCard mapping ────────────────────────────────────────────

function mapRawCard(raw: any, index: number): MobileCard {
  const type = String(raw.type || 'text') as MobileCard['type'];
  const card: MobileCard = {
    id: raw.id || `card-${index + 1}`,
    type,
    card_number: Number(raw.card_number || index + 1),
    title: raw.title || raw.card_title || '',
    text: raw.text || raw.content || '',
    illustration_idea: raw.illustration_idea || '',
    visible_labels: raw.visible_labels || '',
    img_context: raw.img_context || '',
    imageUrl: raw.imageUrl || '',
    text_1: raw.text_1 || '',
    text_2: raw.text_2 || '',
    language: raw.language || '',
    code: raw.code || '',
    output_available: raw.output_available,
    output: raw.output || '',
    heading: raw.heading || '',
    leftOption: raw.leftOption,
    rightOption: raw.rightOption,
    content: raw.content && Array.isArray(raw.content) ? raw.content : undefined,
    question: raw.question || '',
    options: raw.options,
    correctAnswer: raw.correctAnswer,
    incorrectMessage: raw.incorrectMessage || '',
    explanation: raw.explanation || '',
    correctOptions: raw.correctOptions,
    sections: raw.sections,
    scenarioType: raw.scenarioType || raw.scenariotype || '',
    highlightCardType: raw.highlightCardType,
  };
  return card;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runMobileShortPipeline(
  input: MobileShortInput,
  shortId: string,
  onCard: (card: MobileCard) => void,
  emit: MobileShortEmit,
): Promise<{ cards: MobileCard[] }> {
  // Stage 1: Topic Detailer (GPT-4o search)
  emit({ type: 'stage', name: 'topic-detailer', status: 'start' });
  const topicDetails = await openaiSearch(
    registeredTopicDetailerPrompt({
      topic: input.topic,
      domain: input.domain,
      additionalContext: input.additionalContext,
    }),
  );
  emit({ type: 'data', name: 'topic-detailer', payload: { topicDetails } });
  emit({ type: 'stage', name: 'topic-detailer', status: 'done' });

  // Stage 2: Cards Generator (Gemini 2.5 Pro)
  emit({ type: 'stage', name: 'cards-generator', status: 'start' });
  const cardsRaw = await generateText(
    registeredShortsCardsGeneratorPrompt({
      topic: input.topic,
      cardPlan: topicDetails,
      isHighlightCardNeeded: input.isHighlightCardNeeded,
      numCards: input.numCards,
      level: input.level,
      objective: input.objective,
      additionalContext: input.additionalContext,
    }),
    { model: TEXT_GENERATOR_MODEL, maxTokens: 32000 },
  );
  emit({ type: 'data', name: 'cards-generator', payload: { cardsRaw } });
  emit({ type: 'stage', name: 'cards-generator', status: 'done' });

  // Stage 3: JSON Generator (Gemini 2.5 Pro)
  emit({ type: 'stage', name: 'json-generator', status: 'start' });
  const jsonRaw = await generateText(
    registeredShortsJsonGeneratorPrompt({ cardsOutput: cardsRaw }),
    { model: TEXT_GENERATOR_MODEL, maxTokens: 32000 },
  );
  emit({ type: 'data', name: 'json-generator', payload: { jsonRaw } });
  emit({ type: 'stage', name: 'json-generator', status: 'done' });

  // Parse cards
  let rawCards: any[] = [];
  try {
    const parsed = parseJsonLoose(jsonRaw);
    rawCards = Array.isArray(parsed) ? parsed : [];
  } catch {
    rawCards = [];
  }
  rawCards = rawCards
    .sort((a: any, b: any) => (a.card_number || 0) - (b.card_number || 0))
    .map((c: any, i: number) => ({ ...c, id: c.id || `card-${i + 1}` }));

  // Stage 4: Image generation for visual cards
  const imageCards = rawCards.filter(
    (c: any) => (c.type === 'text_img' || c.type === 'img_only') && c.illustration_idea,
  );
  if (imageCards.length > 0) {
    emit({ type: 'stage', name: 'images', status: 'start' });
    await Promise.all(
      rawCards.map(async (card: any, idx: number) => {
        if ((card.type === 'text_img' || card.type === 'img_only') && card.illustration_idea) {
          const url = await generateCardImage(card, idx, shortId);
          if (url) card.imageUrl = url;
        }
      }),
    );
    emit({ type: 'stage', name: 'images', status: 'done' });
  }

  const cards: MobileCard[] = rawCards.map((raw: any, i: number) => mapRawCard(raw, i));
  for (const card of cards) onCard(card);

  return { cards };
}

// Alias for run manager compatibility
export { runMobileShortPipeline as runMobileShortsPipeline };
