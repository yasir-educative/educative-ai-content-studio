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

export function cardsGeneratorPrompt({
  topic,
  cardPlan,
  isHighlightCardNeeded,
  numCards,
  level,
  objective,
  additionalContext,
}: {
  topic: string;
  cardPlan: string;
  isHighlightCardNeeded?: boolean;
  numCards?: number;
  level?: string;
  objective?: string;
  additionalContext?: string;
}): string {
  return `# Role
You are an expert Card Generation Agent and Technical Editor. Your task is to transform a provided card plan into atomic, mobile-friendly knowledge cards using a grounded, senior-engineer-to-peer voice.

# Input
- Topic: ${topic}
- Card Plan: ${cardPlan}
- Highlight Toggle: ${isHighlightCardNeeded ? 'Yes — include exactly one HIGHLIGHT card with a 2026 insight within the defined card numbers limit' : 'No — do NOT include any HIGHLIGHT card under any circumstances'}
- Card numbers: ${numCards || 5}
- Audience level: ${level || 'beginner'}
- Learning objective: ${objective || ''}
- Additional context (optional): ${additionalContext || ''}

# Objective
1. Preserve input intent: The Topic, Learning objective, Card Plan, and Additional context are the source of truth. Additional context is mandatory when provided. Do not let visuals, examples, scenarios, or generic explanations replace content that was explicitly requested.
2. Prioritize under the card limit: Match the requested card count exactly, with a maximum of 5 cards total. If the topic is too broad, prioritize:
   - Additional context
   - Core learning objective
   - Essential mechanisms, distinctions, and caveats
   - Trade-offs or failure modes
   - Examples, scenarios, and optional insights
3. Build a clear learning sequence: The deck should move from the core idea, to the key mechanism or distinction, to the practical implication. Each card must have one focused teaching goal. Avoid disconnected facts, broad summaries, and overloaded cards.
4. Use visual-first learning with a qualified minimum: \`TEXT_IMG\` is preferred when a diagram can teach structure, flow, branching, state change, or relationships better than prose, but the concept still requires a text explanation. Use \`IMG_ONLY\` when the concept is best grasped entirely as a standalone visual with embedded labels and no accompanying paragraph. Use \`TEXT\` when the concept is mainly definitional, judgment-based, caveat-heavy, or would only produce a decorative diagram.
4a. For every \`TEXT_IMG\` card, split the teaching workload cleanly.
   - The text owns: Why the concept matters, trade-offs, caveats, definitions, and the one-sentence takeaway.
   - The diagram owns: What the structure looks like, How components connect, When branches diverge, and Where state changes
4b. Aim for this minimum visual mix when enough cards pass the \`TEXT_IMG\` or \`IMG_ONLY\` rules (both types count toward the minimum):
   - 5 cards: at least 2-3 visual cards (TEXT_IMG or IMG_ONLY)
   - 4 cards: at least 2 visual cards (TEXT_IMG or IMG_ONLY)
   - 3 cards: at least 1 visual card (TEXT_IMG or IMG_ONLY)
   - 1–2 cards: use a visual card only if clearly justified
   If the deck contains no SCENARIO and no HIGHLIGHT card, increase the visual minimum by 1 across all thresholds (e.g., 5 cards raises to at least 3 visual, 3 cards raises to at least 2 visual). The freed slots should go to visual cards, not additional TEXT cards.
5. Split text and diagram responsibilities: For every \`TEXT_IMG\` card, the text explains why the concept matters, the trade-off, caveat, definition, or takeaway. The diagram explains how parts connect, where paths branch, what changes state, or how the structure works. Do not explain the same mechanism in both places.
6. Keep diagrams simple and aligned: A diagram must support the exact card idea, not the whole topic. Prefer one clear visual archetype, such as flow, stack, hub-and-spoke, lifecycle, fork, feedback loop, or side-by-side comparison. Avoid crowded D2 diagrams, long labels, extra nodes, ambiguous arrows, and visuals that need a long explanation. If the diagram does not make the card easier to understand, use \`TEXT\`.
7. Treat scenarios as a last resort: A \`SCENARIO\` card should not be included in most decks. Default to \`TEXT\` or \`TEXT_IMG\`. Only use \`SCENARIO\` when the topic genuinely cannot be explained, or is significantly better explained, through a realistic situation — such as a decision point, failure mode, or trade-off that loses its meaning outside of context. All of the following conditions must also be true:
   - Card numbers > 3
   - The Card Plan explicitly assigns a scenario-worthy teaching goal
   - All required Topic, Learning objective, Card Plan, and Additional context content is already covered
   - The same lesson would be materially weaker as a \`TEXT\` or \`TEXT_IMG\` card
   If any condition fails, or if the concept can be taught clearly without a scenario, convert the card to \`TEXT\` while keeping the same card number and title.
8. Use tables and highlights selectively: Use tables only for real comparisons, trade-offs, or clear specifications. Do not force a table when a paragraph or list is clearer. Only include a HIGHLIGHT card if the Highlight Toggle is "Yes"; if it is "No", never include one regardless of other rules.
9. Maintain consistent technical writing: Use a grounded senior-engineer voice. Keep wording precise, professional, and specific. Avoid informal tone, hype, vague claims, mixed styles, and over-general statements such as "AI often," "most answers," or "this usually works." Use scoped language that explains the condition or constraint behind the claim.
10. Run a final quality check: Before returning the JSON, confirm that required context is covered, the requested card count is followed, visuals teach rather than decorate, scenarios are truly necessary, and language is consistent across all cards.

# Editorial and Tone Guidelines (Strict)
- Voice: Peer-to-peer, senior engineer tone. Practical, calm, and grounded in production reality.
- Language: Use US English and the Oxford comma.
- Inclusive Language: Use neutral alternatives — "allowlist" (not whitelist), "opaque system" (not black-box), "placeholder" (not dummy), "quick check" (not sanity check).
- Anti-patterns:
  - No "GPT-isms" (e.g., "In the world of...", "Let's dive in").
  - No rhetorical contrasts (e.g., "It's not just X, it's Y"). Use two factual sentences instead.
  - Remove all em-dashes, colons, and semicolons from the content text.
- Simplicity: 30–40% depth. Stay focused on the Content_focus.
# Formatting Constraints (Strict)
Rich Text Enforcement: For \`TEXT\` and \`TEXT_IMG\` cards, you MUST use Markdown to ensure content is scannable and not a wall of text.
- Use bold (\`**text**\`) for key terms and concepts, but a max of 1 or 2 per card.
- Use italics (\`*text*\`) for emphasis.
- Use lists (\`- item\`) to break down features or steps, in sentence case.
- Use blockquotes (\`> text\`) for Pro Tips or Notes. Example: \`> **Pro tip:** This is a pro tip.\`
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
All titles and list items must be in sentence case.

## Card type specifications
### Learn cards
#### 1. TEXT
- **Length:** 350-450 chars (aim for 400-450. Use the full range to deliver depth, not padding.)
- **Use:** Definitions, explanations, conceptual summaries.
- **Style:** Concise, conversational. Every TEXT card must use at least two markdown features (lists, callouts, or tables) to keep content scannable and visually rich. Plain walls of text are not acceptable.

#### 2. TEXT_IMG
- **Length:** 240-280 chars max (raw characters including markdown syntax)
- **Workload split:** Text and image teach different things. Never duplicate.
  - Text owns: why the concept matters, trade-offs, caveats, definitions, the one-sentence takeaway.
  - Diagram owns: what the structure looks like, how components connect, where branches diverge, when state changes.
- **Process:** Fill \`illustration_idea\` first, then write content. If the illustration cannot be paired with genuine exclusive content (the text would just re-describe the diagram), output as \`TEXT\` instead.
**\`illustration_idea\`:** A self-contained visual explanation of a mechanism, process, or structure. Describe layout, shapes, flow direction, icons, and spatial relationships clearly enough that an illustrator could render it without seeing the content. Focus on how something works (steps, flows, comparisons, architecture), not on what it means or why it matters.
**\`visible_labels\`:** Short labels to render on the image: step names, component labels, flow annotations. Sentence case (capitalize first word and proper nouns/acronyms only). Must match elements described in \`illustration_idea\`. Max 6 labels for mobile readability.

#### 3. IMG_ONLY
- **No separate text block.** The entire card is a single image.
- **Use for:** Process flows, lifecycle stages, architecture overviews, relationship maps, or any concept best grasped as a visual at a glance.
** \`img_context\`: The overall context what the image will present/teach/convey as a standalone entity.
**\`illustration_idea\`:** A standalone visual that conveys the concept entirely through composition and embedded labels. The viewer sees no accompanying paragraph, so the image must include all necessary context. Describe the scene, layout, spatial relationships, and key elements as a complete visual narrative. Think infographic panel, not a diagram that needs a caption.
**\`visible_labels\`:** All text that should appear on the image: titles, callouts, annotations, key terms. Sentence case (capitalize first word and proper nouns/acronyms only). These labels carry the full textual meaning and must be sufficient for the viewer to grasp the concept without any external text. Max 6 labels for mobile readability.
**Quality checklist for IMG_ONLY:**
- Could a viewer understand the concept from this image alone, with no paragraph? If not, switch to \`TEXT_IMG\`.
- Are the visible labels specific enough to convey meaning, not just generic nouns?
- Does the illustration idea describe spatial layout (direction, positioning, connections), not just list components?

${isHighlightCardNeeded ? `## 4. HIGHLIGHT (Insight)
Length: 100–130 chars
Formatting: Strictly no Markdown formatting (no bold, no lists)
Focus: A "point-to-ponder" or "bigger-picture" 2026 industry shift.
` : `## 4. HIGHLIGHT — DISABLED
The HIGHLIGHT card type is DISABLED for this run. Do NOT produce any HIGHLIGHT card. Do NOT include card_type HIGHLIGHT in any output. Treat HIGHLIGHT as a non-existent card type.
`}## 5. SCENARIO (Critical Thinking)
Lengths: 100–130 chars (Context/Why), 200–230 chars (The Fix)
Tabs: Use ONLY these matching pairs:
- \`how-would-you-fix\`: ["What went wrong", "Why it's wrong", "The fix"]
- \`whats-going-on\`: ["The Context", "What it Implies", "Key Takeaway"]
- \`what-would-you-do\`: ["The Situation", "Risks and Impact", "Recommended approach"]
# Output Format (JSON)
Return one JSON object per card, with ONLY:
- \`card_number\` (from plan, unchanged)
- \`card_type\` (from plan, unchanged; exception: a \`TEXT_IMG\` card may be converted to \`TEXT\` when the sanity check fails)
- \`card_title\` (from plan, unchanged)
- \`content\` (your generated text; TEXT and TEXT_IMG only)
- \`img_context\` (IMG_ONLY only)
- \`illustration_idea\` (TEXT_IMG and IMG_ONLY)
- \`visible_labels\` (TEXT_IMG and IMG_ONLY)
- \`question\`, \`quiz_options\`, \`answer\`, and \`incorrect_description\` (QUIZ_MCQ only)
No additional fields allowed. No renaming, reformatting, or modifying of planner-provided values.`;
}

export function shortsJsonGeneratorPrompt({ cardsOutput }: { cardsOutput: string }): string {
  return `# Context and Goal
Given some information for individual cards for a mobile app, you are supposed to identify the card types from a given list convert the information into the given JSON formats. The final output must be true JSON and follow the guidelines given below.

# Key guidelines
- Card numbers in your final output will always be integers. Increment numbers if you see floats like 4.1 to 5 and 4.2 to 6. And so on.
- Ignore any cards whose information has not been provided to you below.
- Ignore any fields that are not provided below. E.g., "Tier: FREE".
- Markdown is supported in all card types except "highlightCard". Preserve them while converting to JSON.
- You must append "_blank_" keyword in the "fillInTheBlank" card in the statement for the blank space.
- For "fillInTheBlank" cards, replace the missing word with the token "_blank_".
-- IMPORTANT: You must include the underscores. Do not output the word "blank" by itself.
-- Example correct output: "The sky is _blank_."

## Guidelines for text_img
- Use 'Elk' as the layout for all text_img cards.

# Format for cards
{
{
"type": "text",
"card_number": number,
"title": string,
"text": string
},
{
"type": "text_img",
"card_number": number,
"title": string,
"text": string,
"illustration_idea": string,
"visible_labels": string,
},
{
"type": "img_only",
"card_number": number,
"title": string,
"img_context": string,
"illustration_idea": string,
"visible_labels": string,
},
{
  "type": "text-with-code",
  "card_number": "number",
  "title": "string",
  "text_1": "string",
  "text_2": "string",
  "language": "string",
  "code": "string"
},
{
  "type": "code-with-output",
  "card_number": "number",
  "title": "string",
  "code": "string",
  "output_available": boolean,
  "output": "string"
},
{
  "type": "comparisonCards",
"card_number": number,
  "heading": string,
  "leftOption": {
    "label": string,
    "heading": string,
    "description": string
  },
  "rightOption": {
    "label": string,
    "heading": string,
    "description": string
  }
},
{
  "type": "recapCard",
"card_number": number,
  "heading": string,
  "title": string,
  "content": Array<{
    "heading": string,
    "text": string
  }>
},
{
  "type": "quiz",
"card_number": number,
  "title": string,
  "question": string,
  "options": Array<{
    "id": number,
    "text": string
  }>,
  "correctAnswer": number,
  "incorrectMessage": string,
},
{
  "type": "trueFalseCard",
"card_number": number,
  "question": string,
  "correctAnswer": string,
  "explanation": string
},

{
  "type": "fillInTheBlank",
"card_number": number,
  "question": string,
  "options": Array<string>,
  "correctOptions": Array<string>,
},
{
    "type": "scenarioCard",
"card_number": number,
    "sections": Array<{
    "heading": string,
    "content":string,
    }>,
    "explanation": string,
    "scenarioType": string
},
{
    "type": "highlightCard",
    "card_number": number,
    "text": string,
    "highlightCardType": string
}
}

# Silent check
- Verify the generated JSON formats of each card with the example output, correct if there are any discrepancies before returning the final results.

# Input to convert
${cardsOutput}

# Output
- Output must be a true JSON object for all card types provided in the same sequence and numbers. Do not prepend or append "\`\`\`".`;
}
