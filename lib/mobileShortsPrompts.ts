import { CARD_LIMITS } from './mobileCardLimits';
import { PLANNER_CARD_TYPES, highlightCardTypeGuide, plannerToCardType, scenarioCardTypeGuide, type MobileCardType } from './mobileCardTypes';

function targetBand(type: MobileCardType, index = 0, separator = '–'): string {
  return CARD_LIMITS[type]![index].target!.join(separator);
}

export function topicDetailerPrompt({
  topic,
  domain,
  additionalContext,
}: {
  topic: string;
  domain?: string;
  additionalContext?: string;
}): string {
  return `Act as an expert curriculum designer and learning specialist. I will provide a [TOPIC].

Strictly follow these output rules:
- No conversational filler (e.g., "Sure, here is...")
- No links or URLs.
- No introductory or concluding remarks.

Output Format:
1. **Foundational Summary**: Provide a 3-4 line concise summary of the core concepts a learner must master to understand this topic deeply.
2. **The "Card Pillars"**: List 4-5 specific sub-themes or "pillars" that a card planner should use to categorize study cards (e.g., Definitions, Mechanisms, Common Misconceptions, Real-world Applications).
3. **2026 Insight**: Share one "latest insight" or modern application of this topic (current as of 2026) to ensure the learner stays ahead of the curve.

TOPIC: ${topic}
Topic's domain: ${domain || ''}
Additional context: ${additionalContext || ''}`;
}

export function shortsCardPlannerPrompt({
  topic, topicDetails, level, objective, additionalContext, numCards, typeRules,
}: {
  topic: string; topicDetails: string; level?: string; objective?: string;
  additionalContext?: string; numCards: number; typeRules: string;
}): string {
  return `Plan exactly ${numCards} mobile learning cards, numbered consecutively from 1.
Topic: ${topic}
Topic details (background): ${topicDetails}
Audience level: ${level || 'beginner'}
Learning objective: ${objective || ''}
Additional context (mandatory when provided): ${additionalContext || ''}

Type-choice rules:
${typeRules}

Return { "cards": [ { "card_number": 1, "title": "...", "teaching_goal": "...", "proposed_type": "...", "visual_idea": null } ] }.
Use the allowed enum types only. Give visual cards a specific visual idea. Sequence one atomic teaching goal per card.
Every title must be 2–5 words. Do not write the card content yet.`;
}

export function cardsGeneratorPrompt({
  topic,
  cardPlan,
  topicDetails,
  highlightInstructions,
  scenarioInstructions,
  isHighlightCardNeeded,
  numCards,
  level,
  objective,
  additionalContext,
}: {
  topic: string;
  cardPlan: string;
  topicDetails?: string;
  highlightInstructions?: string;
  scenarioInstructions?: string;
  isHighlightCardNeeded?: boolean;
  isScenarioCardNeeded?: boolean;
  numCards?: number;
  level?: string;
  objective?: string;
  additionalContext?: string;
}): string {
  return `# Role
You are an expert Card Generation Agent and Technical Editor. Your task is to transform a provided card plan into atomic, mobile-friendly knowledge cards using a grounded, senior-engineer-to-peer voice.

# Input
- Topic: ${topic}
- Fixed decided plan (number, title, card_type, teaching_goal, visual_idea): ${cardPlan}
- Topic details (background only): ${topicDetails || ''}
- Highlight instructions: ${highlightInstructions || (isHighlightCardNeeded ? 'Follow the fixed plan; at most one highlight.' : 'HIGHLIGHT is disabled.')}
- Card numbers: ${numCards || 5}
- Audience level: ${level || 'beginner'}
- Learning objective: ${objective || ''}
- Additional context (optional): ${additionalContext || ''}

# Hard constraint — TEXT_IMG format
The \`content\` field of every TEXT_IMG card must be a **single prose paragraph**. No bullet lists. No blockquotes. No tables. This applies even when the concept involves multiple steps — weave them into prose or focus only on the why and the takeaway. A TEXT_IMG card with any line starting with \`-\`, \`>\`, or \`|\` is wrong and must be rewritten before output.

# Objective
1. Preserve input intent: The Topic, Learning objective, Card Plan, and Additional context are the source of truth. Additional context is mandatory when provided. Do not let visuals, examples, scenarios, or generic explanations replace content that was explicitly requested.
2. Prioritize under the card limit: Match the requested card count exactly, with a maximum of 5 cards total. If the topic is too broad, prioritize:
   - Additional context
   - Core learning objective
   - Essential mechanisms, distinctions, and caveats
   - Trade-offs or failure modes
   - Examples, scenarios, and optional insights
3. Build a clear learning sequence: The deck should move from the core idea, to the key mechanism or distinction, to the practical implication. Each card must have one focused teaching goal. Avoid disconnected facts, broad summaries, and overloaded cards. Where the concept shifts significantly from the previous card, open with one implicit bridging sentence that connects the two ideas — not a meta-reference ("as we covered"), just a natural conceptual link that makes the transition feel earned.
4. Type choice is already complete. Follow the fixed plan exactly; never change card_type, number, or title. The planner and decision stages own visual minimums, scenario eligibility, and the highlight toggle.
5. Split text and diagram responsibilities: For every \`TEXT_IMG\` card, the text explains why the concept matters, the trade-off, caveat, definition, or takeaway. The diagram explains how parts connect, where paths branch, what changes state, or how the structure works. Do not explain the same mechanism in both places. **Self-review step:** before finalizing a TEXT_IMG card, read the text and \`illustration_idea\` side by side. If any sentence in the text names a component, step, or flow that also appears in the diagram, delete that sentence and replace it with the trade-off, failure mode, or implication of that structure. The test: if the text could serve as a caption for the image, it is repeating — rewrite it to add the dimension the image cannot show (the *why*, the *consequence*, or the *decision criteria*).
6. Keep diagrams simple and aligned: A diagram must support the exact card idea, not the whole topic. Prefer one clear visual archetype, such as flow, stack, hub-and-spoke, lifecycle, fork, feedback loop, or side-by-side comparison. Avoid crowded D2 diagrams, long labels, extra nodes, ambiguous arrows, and visuals that need a long explanation. Make the diagram support the assigned teaching goal.
7. Write all assigned SCENARIO sections completely. Keep the assigned type.
8. Use tables only for real comparisons, trade-offs, or clear specifications.
9. Maintain consistent technical writing: Use a grounded senior-engineer voice. Keep wording precise, professional, and specific. Avoid informal tone, hype, vague claims, mixed styles, and over-general statements such as "AI often," "most answers," or "this usually works." Use scoped language that explains the condition or constraint behind the claim.
10. Run a final quality check: Before returning the JSON, confirm that required context is covered, the requested card count is followed, visuals teach rather than decorate, scenarios are truly necessary, and language is consistent across all cards.
11. STRICT CHARACTER LIMIT ENFORCEMENT: Count raw characters in every text field before returning. Include all markdown syntax characters (asterisks, hyphens, backticks, etc.) in the count. Rewrite any field that falls outside its type's exact range — truncate if over the maximum, expand with meaningful depth if under the minimum. These are hard limits, not targets:
    - TEXT → content: ${targetBand('text')} chars
    - TEXT_IMG → content: ${targetBand('text_img')} chars
    - HIGHLIGHT → content: ${targetBand('highlightCard')} chars
    - SCENARIO → tabs 1 and 2: ${targetBand('scenarioCard')} chars each; tab 3: ${targetBand('scenarioCard', 1)} chars. Every tab has a minimum, not just a maximum.

# Editorial and Tone Guidelines (Strict)
- Voice: Peer-to-peer, senior engineer tone. Practical, calm, and grounded in production reality.
- Language: Use US English and the Oxford comma.
- Inclusive Language: Use neutral alternatives — "allowlist" (not whitelist), "opaque system" (not black-box), "placeholder" (not dummy), "quick check" (not sanity check).
- Abbreviations: Expand all acronyms and abbreviations on first use within each card — write the full form followed by the abbreviation in parentheses (e.g., "Learned Perceptual Image Patch Similarity (LPIPS)", "Query (Q), Key (K), Value (V)"). For beginner-level decks, never use an acronym anywhere in a card without the full form appearing first on that same card. Apply this to every technical abbreviation, metric name, and framework shorthand — no exceptions.
- Anti-patterns:
  - No "GPT-isms" (e.g., "In the world of...", "Let's dive in").
  - No rhetorical contrasts (e.g., "It's not just X, it's Y"). Use two factual sentences instead.
  - Remove all em-dashes, colons, and semicolons from the content text.
- Simplicity: 30–40% depth. Stay focused on the Content_focus.
# Formatting Constraints (Strict)

## TEXT cards (these rules do NOT apply to TEXT_IMG)
Rich text for \`TEXT\` cards only: Use Markdown where it genuinely aids scanning.
- Use bold (\`**text**\`) for key terms and concepts. Max 1–2 per card.
- Use italics (\`*text*\`) for emphasis.
- Use lists (\`- item\`) **only** when content has 3+ discrete, parallel items with no natural connective tissue. If items join naturally with "and," "then," or "because," write as prose. **Never open a list immediately after the first sentence** — add a bridging sentence before any bullets.
- Use blockquotes (\`> text\`) for Pro Tips or Notes. Example: \`> **Pro tip:** This is a pro tip.\`

## TEXT_IMG cards — completely different format
TEXT_IMG cards do NOT use the TEXT card formatting rules above. They use their own format defined in the card spec section.
Use short and concise tables where necessary or relevant, in \`TEXT\` cards only, using this format:
\`\`\`
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Value A1 | Value A2 | Value A3 |
| Value B1 | Value B2 | Value B3 |
\`\`\`
Do NOT apply rich formatting to \`HIGHLIGHT\` cards (keep them clean).
Do not use em-dashes anywhere in any card's content.
Character counting: all character limits are measured against the raw text including markdown syntax characters. Bold markers, asterisks, and list hyphens all count toward the limit.
Spacing and layout:
- Use \`\\n\\n\` between paragraphs.
- Use \`\\n\\n\` to separate a paragraph and a list.
- Use \`\\n\\n\` to separate a list and a paragraph.
- Use \`\\n\` between individual list items.
All titles must be 2–5 words. All titles and list items must be in sentence case.

## Card type specifications
### Learn cards
#### 1. TEXT
- **Length:** ${targetBand('text', 0, '-')} chars (aim for 380-${CARD_LIMITS.text![0].target![1]}. Use the full range to deliver depth, not padding.)
- **Use:** Definitions, explanations, conceptual summaries.
- **Style:** Concise, conversational. Every TEXT card must use at least two markdown features (lists, callouts, or tables) to keep content scannable and visually rich. Plain walls of text are not acceptable.

#### 2. TEXT_IMG
- **Length:** ${targetBand('text_img', 0, '-')} chars max (raw characters including markdown syntax)
- **FORMAT — ABSOLUTE: one prose paragraph only. Zero hyphens starting a line. Zero blockquotes. Zero tables.**
  - If you feel the urge to write a bullet list, stop. The diagram shows the steps. The text field must say WHY those steps matter or what goes wrong — not the steps themselves.
  - If your text starts with a bold term followed by a colon and bullets, that is a TEXT card pattern, not a TEXT_IMG pattern. Rewrite as a single flowing sentence.
- **Workload split:**
  - Diagram owns: the steps, components, flow, and structure.
  - Text owns: the insight those steps produce — the trade-off, the failure mode, the consequence, the definition, the "so what."
  - Neither repeats the other. Between them they teach one concept; alone, each is incomplete.
  - The text stands on its own. It never refers to the picture — no "as shown above", "the diagram below", "see the figure", "this illustrates". A reader with no picture must still get a complete thought.
  - The text is never a caption for the picture, and the picture is never the text set in a box.
- **How to convert steps to prose (required technique):**
  1. List the steps mentally (do NOT write them out).
  2. Ask: "What is the key insight or consequence when all these steps complete?"
  3. Write that insight as one sentence. Add one sentence of context or trade-off.
  4. That two-sentence result is your content field.
- **Concrete example of the required transformation:**
  - Topic: How attention computes context (Q/K/V)
  - WRONG — never produce this: "- It compares its query to every key\n- Softmax turns scores into weights\n- It mixes the matching values"
  - RIGHT — produce this: "Attention gives each token a representation shaped by the full context around it, not just its position — so the same word carries different meaning depending on what surrounds it."
  - The diagram shows Q→K→V. The text explains the consequence. They do not overlap.
- **Repeat check:** Write illustration_idea first. Then ask: "Could my text serve as a caption for the diagram?" If yes, rewrite — the text must add the dimension the diagram cannot show.
**\`illustration_idea\`:** A self-contained visual explanation of a mechanism, process, or structure. Describe layout, shapes, flow direction, icons, and spatial relationships clearly enough that an illustrator could render it without seeing the content. Focus on how something works (steps, flows, comparisons, architecture), not on what it means or why it matters.
**\`visible_labels\`:** Short labels to render on the image: step names, component labels, flow annotations. Sentence case (capitalize first word and proper nouns/acronyms only). Must match elements described in \`illustration_idea\`. Max 6 labels for mobile readability.

#### 3. IMG_ONLY
- **No separate text block.** The entire card is a single image.
- **Use for:** Process flows, lifecycle stages, architecture overviews, relationship maps, or any concept best grasped as a visual at a glance.
** \`img_context\`: The overall context what the image will present/teach/convey as a standalone entity.
**\`illustration_idea\`:** A standalone visual that conveys the concept entirely through composition and embedded labels. The viewer sees no accompanying paragraph, so the image must include all necessary context. Describe the scene, layout, spatial relationships, and key elements as a complete visual narrative. Think infographic panel, not a diagram that needs a caption.
**\`visible_labels\`:** All text that should appear on the image: titles, callouts, annotations, key terms. Sentence case (capitalize first word and proper nouns/acronyms only). These labels carry the full textual meaning and must be sufficient for the viewer to grasp the concept without any external text. Max 6 labels for mobile readability.
**Quality checklist for IMG_ONLY:**
- Could a viewer understand the concept from this image alone? If not, improve the image concept and labels while keeping the assigned type.
- Are the visible labels specific enough to convey meaning, not just generic nouns?
- Does the illustration idea describe spatial layout (direction, positioning, connections), not just list components?

## 4. HIGHLIGHT (only when assigned in the fixed plan)
Length: ${targetBand('highlightCard')} chars. No Markdown. A concise modern insight.
Set \`highlightCardType\` to exactly one of:
${highlightCardTypeGuide()}
${highlightInstructions || (isHighlightCardNeeded ? 'Follow the fixed plan; at most one highlight.' : 'HIGHLIGHT is disabled.')}
## 5. SCENARIO (Critical Thinking)
Lengths, counted per tab and all three mandatory:
- Tab 1: ${targetBand('scenarioCard')} chars
- Tab 2: ${targetBand('scenarioCard')} chars
- Tab 3: ${targetBand('scenarioCard', 1)} chars — the longest tab, roughly twice either of the first two
A tab of one short sentence is wrong. Tabs 1 and 2 are two or three sentences each; tab 3 states the
fix or recommendation and says why it works. Count the characters of each tab before returning it.
Set \`scenarioType\` to exactly one of the three below, and use that type's three tab headings,
in that order, spelled exactly as written. Never mix headings across types, and never invent one.
${scenarioCardTypeGuide()}
${scenarioInstructions || 'Follow the fixed plan.'}
# Output Format (JSON)
Return one JSON object per card, with ONLY:
- \`card_number\` (from plan, unchanged)
- \`card_type\` (from plan, unchanged)
- \`card_title\` (from plan, unchanged)
- \`content\` (your generated text; TEXT and TEXT_IMG only)
- \`img_context\` (IMG_ONLY only)
- \`illustration_idea\` (TEXT_IMG and IMG_ONLY)
- \`visible_labels\` (TEXT_IMG and IMG_ONLY)
- \`sections\` (heading and content), \`explanation\`, and \`scenarioType\` (SCENARIO only)
- \`content\` and \`highlightCardType\` (HIGHLIGHT only)
- \`question\`, \`quiz_options\`, \`answer\`, and \`incorrect_description\` (QUIZ_MCQ only)
No additional fields allowed. No renaming, reformatting, or modifying of planner-provided values.

# Final validation (run before returning output)
For every TEXT_IMG card in your output:
1. Does the \`content\` field contain any line starting with \`-\`, \`>\`, or \`|\`? If yes → rewrite as a single prose paragraph.
2. Does the \`content\` field describe any component, step, or flow that also appears in \`illustration_idea\`? If yes → replace that sentence with the trade-off, failure mode, or real-world implication the diagram cannot show.
If both checks pass, the card is ready to output.`;
}

export function shortsJsonGeneratorPrompt({
  cardsOutput, isHighlightCardNeeded, highlightInstructions, isScenarioCardNeeded, scenarioInstructions,
}: {
  cardsOutput: string;
  isHighlightCardNeeded?: boolean;
  highlightInstructions?: string;
  isScenarioCardNeeded?: boolean;
  scenarioInstructions?: string;
}): string {
  return `Convert the supplied cards into { "cards": [...] } using the strict response schema.
Preserve card_number, title, and exact content. Do not add, drop, expand, summarize, or rewrite cards.
Use canonical types from the schema; the input's planner names map to their canonical equivalents.
${PLANNER_CARD_TYPES.map((type) => `${type} becomes ${plannerToCardType[type]}`).join(', ')}.
Put content in text for text, text_img, and highlightCard. Preserve scenario sections and scenarioType.
Scenario tab headings belong to the scenarioType and must be copied through unchanged.
Use null for unused fields, not invented content. Preserve Markdown and raw characters exactly.
For text-with-code preserve text_1, text_2, language, and code. For code-with-output preserve output_available and output.
For comparisons preserve heading and both options. For recaps preserve content as heading/text pairs.
For quizzes map quiz_options to options (id/text), answer to correctAnswer, and incorrect_description to incorrectMessage.
For true/false preserve correctAnswer and explanation. For fillInTheBlank preserve options and correctOptions and use the literal token "_blank_" in the question.
For highlights preserve highlightCardType. For scenarios preserve sections, explanation, and scenarioType.
${highlightInstructions || (isHighlightCardNeeded ? 'Keep any assigned HIGHLIGHT card.' : 'HIGHLIGHT is disabled.')}
${scenarioInstructions || (isScenarioCardNeeded ? 'Keep any assigned SCENARIO card.' : 'SCENARIO is disabled.')}
Input to convert:
${cardsOutput}`;
}
