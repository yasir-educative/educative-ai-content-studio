// The prompt behind every mobile card illustration, for courses and shorts
// alike. One builder: a short and a course card are drawn by the same rules,
// and keeping two copies meant a fix only ever landed in one of them.
//
// The treatment comes from the chosen style (the shipped mobile style unless
// the author picks another); everything else here is structural and fixed,
// because the card renderer depends on the portrait format and on the labels
// being drawn into the picture.

import { getMobileStyle } from './imageStyleStore';

export { MOBILE_CARD_IMAGE_STYLE } from './mobileCardImageStyle';

export function buildMobileCardImagePrompt(card: any, styleBody?: string): string {
  const style = String(styleBody ?? getMobileStyle().body).trim();
  const illustrationIdea = String(card.illustration_idea || '');
  const visibleLabels = String(card.visible_labels || '');
  const title = String(card.title || '');
  const hasLabels = visibleLabels.trim().length > 0;

  if (card.type === 'img_only') {
    const imgContext = String(card.img_context || '');
    const labelsBlock = hasLabels
      ? `Render these labels, each exactly once: "${visibleLabels}". Add short annotations (2–8 words) where they clarify.`
      : `Derive labels and annotations from the illustration idea and context. Label every key element with short phrases (2–8 words).`;
    return `Self-contained technical infographic, portrait 640×1024. No external text — viewer must fully understand the concept from this diagram and annotations alone.

Layout: 24px margins. Top-to-bottom or left-to-right flow. Center-aligned. 5–10 primary elements — rich but not cluttered. Generous whitespace. Arrows, connector lines, numbered steps for hierarchy.

${style}

Annotations: Callouts, labeled arrows, step numbers on elements. Enough detail for zero prior knowledge. Every annotation carries weight.

Text: ${labelsBlock} Capitalize first word of every label, rest lowercase unless acronym. Example: "API gateway" not "api gateway" or "API Gateway". No paragraphs, no title. No misspellings.

Illustration idea: "${illustrationIdea}"
Context (do NOT render as text): "${title} — ${imgContext}"`;
  }

  // text_img
  const content = String(card.text || '');
  const labelsBlock = hasLabels
    ? `Render ONLY these labels, each exactly once: "${visibleLabels}". Short clarifying labels (2–5 words) on connectors allowed.`
    : `Derive concise labels (2–5 words each) from the illustration idea and context. Label every key element.`;
  return `Technical infographic, portrait 640×1024. Diagram-only — no title, no heading, no paragraphs.

Layout:
- Fill the canvas. Content spans about 85% of the width and 80% of the height, with 24px margins, visually centered and balanced. No large empty bands at the top, bottom, or sides.
- Never use a single horizontal line or a single vertical column of components.
- Arrange components in 3–4 horizontal rows, with 2–3 components per row, rows spaced evenly from top to bottom.
- Flow zigzags: row 1 reads left to right; a short connector turns down to row 2, which reads right to left; then down again to row 3, and so on. Every turn is a clear rounded bend, so the reading path is obvious.
- Parallel items (workers, replicas, renditions, fan-out targets) sit side by side in one row, never stacked in a column.
- A component that many others connect to sits in the center row, with the others arranged around it.
- 4–8 primary elements maximum. Generous whitespace between logical groups, tight spacing within a group.
- Size for mobile reading: icons about 110–140px wide; labels at least 26px high; all icons in the same row share one size. Arrows are short, about 40–80px between icons.

${style}

Text: ${labelsBlock} Capitalize first word of every label, rest lowercase unless acronym. Example: "API gateway" not "api gateway" or "API Gateway". No misspellings.

Illustration idea: "${illustrationIdea}"
Context (do NOT render as text): "${title} — ${content}"`;
}
