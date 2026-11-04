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

Layout: 24px margins minimum. Choose the shape the idea actually has — a flow, a stack, a hub, a comparison, a cycle, a branch, or one labelled object — rather than defaulting to the same arrangement every time. Centred and balanced; do not fill the canvas for its own sake. Keep it high-level: 4–8 primary elements, generous whitespace, arrows and connector lines only where they carry meaning.

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

Layout — choose the one shape that fits this idea, and commit to it:
- Pick from: left-to-right flow; top-to-bottom pipeline; layered stack; hub with spokes; two columns
  compared side by side; a cycle; a branch or decision; a before-and-after pair; a single labelled
  object with callouts. The idea decides which — a comparison is two columns, a sequence is a flow,
  a central service is a hub. Do not force a shape the content does not have.
- Stay high-level. Draw only the elements the idea needs, usually 3 to 6, and leave the rest out.
  An uncrowded picture that teaches one thing beats a dense one that teaches everything.
- Do not fill the canvas for the sake of it. Generous margins and empty space are fine; the drawing
  sits centred and balanced at whatever size suits it, with at least 24px margins.
- Parallel items (workers, replicas, renditions, fan-out targets) sit side by side, never stacked.
- Size for mobile reading: labels at least 26px high, icons large enough to read at arm's length,
  and icons that belong to the same tier share one size.

${style}

Text: ${labelsBlock} Capitalize first word of every label, rest lowercase unless acronym. Example: "API gateway" not "api gateway" or "API Gateway". No misspellings.

What the picture is for: the card's prose and this picture teach one concept between them. The
prose carries the reasoning — why it matters, what it costs, when it does not hold. The picture
carries what prose is bad at: the structure, the order, the relationship, the comparison. Draw
that. Do not set the prose in the picture, do not caption it, and do not illustrate a sentence
literally. Someone who reads only the prose should still be missing something, and this is it.

Illustration idea: "${illustrationIdea}"
Context, for understanding only — never rendered as text, never restated in the drawing:
"${title} — ${content}"`;
}
