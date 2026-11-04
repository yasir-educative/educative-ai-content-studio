import { generateJSON } from './ai';
import { SHORTS_CARD_SCHEMA } from './mobileShortsSchemas';
import { cardsGeneratorPrompt as shortPrompt } from './mobileShortsPrompts';
import { cardsGeneratorPrompt as coursePrompt, CARD_FORMATTING_RULES } from './mobilePrompts';
import { enforceCharLimits, enforceTextImgProse, mapRawCard } from './mobileShortsPipeline';
import { CARD_LIMITS, COURSE_CARD_LIMITS, checkCard, type CardProduct } from './mobileCardLimits';
import { applyScenarioHeadings, SHORTS_PLANNER_TYPES, isHighlightCardType, isScenarioCardType,
  plannerToCardType, type MobileCardType } from './mobileCardTypes';
import type { MobileCard } from './mobileCourseStorage';

export type RewriteContext = {
  neighbours: MobileCard[];
  topic?: string; level?: string; objective?: string;
  courseName?: string; chapterTitle?: string; chapterSummary?: string; lessonOutline?: unknown;
};

export async function rewriteCard({ product, card, type = card.type, note = '', context, preserveImageDescription = true }: {
  product: CardProduct; card: MobileCard; type?: MobileCardType; note?: string; context: RewriteContext; preserveImageDescription?: boolean;
}) {
  const plan = JSON.stringify([{ card_number: card.card_number, title: card.title, type }]);
  const spec = product === 'short'
    ? shortPrompt({ topic: context.topic || '', cardPlan: plan, level: context.level, objective: context.objective, isHighlightCardNeeded: type === 'highlightCard' })
    : coursePrompt({ planStr: plan });
  let candidate = card;
  let best: { candidate: MobileCard; issues: ReturnType<typeof checkCard>; attempts: number } | null = null;
  let bestErrors = Infinity;
  const limits = (product === 'short' ? CARD_LIMITS : COURSE_CARD_LIMITS)[type] || [];
  let issues = checkCard({ ...card, type }, product);
  const repairTitle = issues.some((issue) => issue.path === 'title');
  for (let attempts = 1; attempts <= 3; attempts++) {
    const lengthRule = limits.length
      ? limits.map((limit) => `${limit.label} (${limit.field}): write between ${limit.min} and ${limit.max} characters. Count every character, markdown included. Aim for ${Math.round((limit.min + limit.max) / 2)}.`).join('\n')
      : '';
    const lastLength = attempts > 1 ? `\nYour previous attempt was ${String((candidate as any).text ?? '').length} characters. That was rejected. Write a SHORTER version this time.` : '';
    const raw = await generateJSON<any>(`${spec}

# Hard length limits for this card — these override every length mentioned above
${lengthRule || 'No character limits apply to this card type.'}${lastLength}

${['text', 'text_img', 'text-with-code', 'code-with-output', 'comparisonCards', 'recapCard', 'scenarioCard'].includes(type) ? `
# Structure — a rewrite follows the same rules as a first draft
${CARD_FORMATTING_RULES}

Keep the structure the card already has where it was right for the content: a card that earned
its bullets keeps them, a bold key term stays bold, a comparison table stays a table. Do not
flatten a structured card into one block of prose to make it fit — shorten the items instead.
Equally, do not add structure a flat card never needed.
` : ''}
Return exactly ONE canonical card object matching the response schema. Use type "${type}".
Rewrite this card's teaching intent with the supplied context; avoid repeating neighbours.
Context: ${JSON.stringify(context)}
Original: ${JSON.stringify(card)}
User note: ${note}
Product: ${product}. Required limits: ${JSON.stringify(limits)}
Repair ALL errors. Exact failing fields, lengths and limits: ${JSON.stringify(issues)}
Previous candidate: ${JSON.stringify(candidate)}
Keep id and number. ${repairTitle ? 'Rewrite the failing title to 2–5 words; this overrides the fixed-plan title instruction.' : 'Keep the original title exactly.'} Use null for unused fields.
Image URLs are managed separately. Do not invent a URL.${type === 'text_img' || type === 'img_only' ? `
This card has a picture. The words and the picture teach one concept between them and never
repeat each other: the picture owns the structure, the components and the order; the words own
the reasoning — why it matters, what it costs, when it fails. Write the words so they stand
alone as a complete thought, and never point at the picture ("as shown above", "the diagram
below", "see the figure"). Do not caption or describe it.${card.illustration_idea ? `
The picture shows: ${String(card.illustration_idea).slice(0, 600)}
Say something the picture cannot.` : ''}` : ''}`, SHORTS_CARD_SCHEMA, { name: 'rewrite_card', tier: 'normal', maxTokens: 8000 });
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid generated card');
    const [fixed] = await enforceTextImgProse([{ ...raw, type, card_number: card.card_number || 1 }], product === 'course' ? COURSE_CARD_LIMITS : CARD_LIMITS);
    candidate = mapRawCard(fixed, Math.max(0, (card.card_number || 1) - 1));
    if (!repairTitle) candidate.title = card.title;
    candidate.id = card.id;
    candidate.card_number = card.card_number;
    candidate.pageId = card.pageId;
    candidate.publishedUrl = card.publishedUrl;
    candidate.regeneratedAt = new Date().toISOString();
    candidate.decision = card.decision;
    if (candidate.decision && type !== card.type) {
      const chosen = SHORTS_PLANNER_TYPES.find((p) => plannerToCardType[p] === type);
      if (chosen) candidate.decision = { ...candidate.decision, chosen };
    }
    // The variant is a property of the card, not of its wording: keep the
    // author's choice when the model returns null, or the rewrite fails the gate
    // on a field it was never asked to change.
    if (type === 'highlightCard' && !isHighlightCardType(candidate.highlightCardType)
      && isHighlightCardType(card.highlightCardType)) {
      candidate.highlightCardType = card.highlightCardType;
    }
    if (type === 'scenarioCard') {
      if (!isScenarioCardType(candidate.scenarioType) && isScenarioCardType(card.scenarioType)) {
        candidate.scenarioType = card.scenarioType;
      }
      Object.assign(candidate, applyScenarioHeadings(candidate));
    }
    if (type === 'text_img' || type === 'img_only') {
      candidate.imageUrl = card.imageUrl || '';
      // Retain image descriptions when retaining an existing image.
      if (card.imageUrl && preserveImageDescription && type === card.type && !checkCard(card, product).some((issue) =>
        ['illustration_idea', 'visible_labels', 'img_context'].includes(issue.path) && issue.severity === 'error')) {
        candidate.illustration_idea = card.illustration_idea;
        candidate.visible_labels = card.visible_labels;
        candidate.img_context = card.img_context;
      }
    }
    // Asking the model for a length is a request; this is the guarantee. The
    // generation pipeline has always run these two steps and the rewrite agent
    // did not, which is why a regenerated card could come back at 250 characters
    // against a 130 ceiling while a generated one never did.
    if (type === 'highlightCard' && candidate.text) {
      // Markdown is banned on highlights and also inflates the count.
      candidate.text = candidate.text.replace(/[*`#]/g, '').replace(/^\s*(>|-)\s+/gm, '').trim();
    }
    if (limits.length) {
      const [capped] = await enforceCharLimits([candidate], () => {}, product) as MobileCard[];
      if (capped) candidate = { ...candidate, ...capped };
    }

    issues = checkCard(candidate, product);
    const errors = issues.filter((issue) => issue.severity === 'error').length;
    if (!errors) return { candidate, issues, attempts };
    // Attempt 3 is not necessarily the best one; keep whichever had the fewest errors.
    if (errors < bestErrors) { best = { candidate, issues, attempts }; bestErrors = errors; }
    if (attempts === 3) return best!;
  }
  throw new Error('Rewrite attempts exhausted');
}
