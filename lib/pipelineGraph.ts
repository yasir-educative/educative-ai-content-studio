// Declarative graph of every pipeline in the app. The /graph page renders this verbatim,
// laid out top-to-bottom (vertical).
//
// **Single source of truth.** When you add a stage to `lib/pipeline.ts` or `runOutlinePipeline`:
//   1. Append a Node here. The `id` MUST equal the `emit({ type:'stage', name })` value so the
//      live progress tracker and this static graph stay aligned.
//   2. Connect it with Edge entries. Use `when` to label conditional branches (e.g. `isGenAI`,
//      `isProjects`, `seoMode != none`). Edges WITHOUT `when` are unconditional flow.
//   3. Set `rank` = depth from top (0 at the top). Set `lane` = horizontal column (0 = center,
//      negatives go left, positives go right). Same `(rank, lane)` cell = collision; the
//      renderer assumes one node per cell.
//
// Conventions:
// - `agent` describes the worker that handles the node so the visualizer can color/badge it.
// - `prompt` is the registry name from `lib/promptsRegistry.ts` — the visualizer links it to
//   `/prompts/{name}` so registry edits flow back into the live pipeline.

export type AgentKind =
  | 'openai-search' // GPT search-preview / search-api (web research)
  | 'gemini-text'   // Google Gemini (drafting / rewriting)
  | 'gemini-review' // Google Gemini (review/critique)
  | 'transform'     // Pure code (no LLM): regex, parsing, formatting
  | 'http'          // External HTTP call (e.g. d2 svg upload, Educative publish)
  | 'fanout'        // Logical join/split node (no work, just wiring)
  | 'terminal';     // start / end / final

export interface GraphNode {
  id: string;
  label: string;
  agent: AgentKind;
  prompt?: string;
  model?: string;
  notes?: string;
  rank: number;   // 0 = top
  lane: number;   // 0 = center, negative = left, positive = right
}

export interface GraphEdge {
  from: string;
  to: string;
  when?: string;          // condition label drawn on the edge (e.g. "isGenAI")
  style?: 'solid' | 'dashed';
}

export interface PipelineGraph {
  id: string;
  title: string;
  description: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Outline pipeline (lib/pipeline.ts → runOutlinePipeline)
// ---------------------------------------------------------------------------
export const outlineGraph: PipelineGraph = {
  id: 'outline',
  title: 'Outline pipeline',
  description: 'Two-step research → Markdown outline. Used by /outline.',
  nodes: [
    { id: 'start',    label: 'Start',         agent: 'terminal',      rank: 0, lane: 0 },
    { id: 'research', label: 'Web research',  agent: 'openai-search', prompt: 'outline-search',     model: 'gpt search-preview', rank: 1, lane: 0 },
    { id: 'outline',  label: 'Outline draft', agent: 'gemini-text',   prompt: 'outline-generator',  model: 'gemini-2.5-flash',   rank: 2, lane: 0 },
    { id: 'end',      label: 'Done',          agent: 'terminal',      rank: 3, lane: 0 },
  ],
  edges: [
    { from: 'start',    to: 'research' },
    { from: 'research', to: 'outline' },
    { from: 'outline',  to: 'end' },
  ],
};

// ---------------------------------------------------------------------------
// Blog pipeline (lib/pipeline.ts → runBlogPipeline)
// ---------------------------------------------------------------------------
//
//                                          start
//                                            │
//                            ┌───────────────┴───────────────┐
//                       (else)                          (isGenAI)
//                       topic-research                   genai-search
//                            │                               │
//                       json-outline                    genai-json-outline
//                            └───────────────┬───────────────┘
//                                            │
//                       ┌────────────────────┼────────────────────┐
//                  (isCIP / else)                            (isProjects)
//                            │                                    │
//                       text-generator                    projects-text-generator
//                            │                                    │
//             ┌──────────────┴──────────┐                         │
//        (isCIP)                   (else)                         │
//        medium-dna                     │                  projects-reviewer
//            │                          │                         │
//       cip-final-pass                  │                         │
//            └──────────────┬───────────┘                         │
//                           │                                     │
//                           └──────────────────┬──────────────────┘
//                                              │
//                                          seed-draft (fan-out)
//                              ┌───────────────┴───────────────┐
//                              ▼                               ▼
//                         editorial branch                widget branch
//                         zachgpt-review                  widgets-extract
//                         zachgpt-incorporate             widgets-generate (fan-out per tag)
//                            │                               (code / table / image …)
//                  ┌─────────┴─────────┐                       │
//             (seoMode != none)    (else)                      │
//                  │                  │                        │
//             seo-keywords            │                        │
//                  │                  │                        │
//             seo-editor              │                        │
//                  └─────────┬────────┘                        │
//                       pr-reviewer                            │
//                            │                                 │
//                       markdown-to-html                       │
//                       structure-output                       │
//                       sanitize-format                        │
//                            └────────────────┬────────────────┘
//                                              ▼
//                                       editor-blocks
//                                          publish
//                                            end
//
export const blogGraph: PipelineGraph = {
  id: 'blog',
  title: 'Blog pipeline',
  description:
    'Vertical-aware research → JSON outline → vertical-specific drafting (1, 2, or 3 agents) → ' +
    'parallel editorial + widget branches (code, table, GPT image) → merge into Educative editor blocks.',
  nodes: [
    // Header
    { id: 'start',                 label: 'Start',                       agent: 'terminal',                                                              rank: 0,  lane: 0 },

    // Research (isGenAI switch)
    { id: 'topic-research',        label: 'Topic research',              agent: 'openai-search',  prompt: 'initial-topic-search', notes: 'Default web research agent.',                                rank: 1,  lane: -1 },
    { id: 'genai-search',          label: 'GenAI websearch',             agent: 'openai-search',  prompt: 'genai-search',         notes: 'Used when vertical = Generative AI / AI/ML.',                rank: 1,  lane: 1 },

    // JSON outline (same isGenAI switch)
    { id: 'json-outline',          label: 'JSON outline',                agent: 'gemini-text',    prompt: 'json-outline',                                                                              rank: 2,  lane: -1 },
    { id: 'genai-json-outline',    label: 'GenAI JSON outline',          agent: 'gemini-text',    prompt: 'genai-json-outline',                                                                        rank: 2,  lane: 1 },

    // Drafting fan-in/fan-out point (purely visual — both outline branches converge here in flow)
    { id: 'outline-join',          label: 'Outline (joined)',            agent: 'fanout',                                                                                                              rank: 3,  lane: 0 },

    // Drafting (vertical switch: default/CIP share text-generator; Projects has its own pair)
    { id: 'text-generator',        label: 'Text generator',              agent: 'gemini-text',    prompt: 'text-generator',           notes: 'Default + CIP path. Projects uses its own generator.',   rank: 4,  lane: -1 },
    { id: 'projects-text-generator', label: 'Projects content generator', agent: 'gemini-text',  prompt: 'projects-text-generator',  notes: 'Projects vertical only. First of two agents.',           rank: 4,  lane: 2 },

    // CIP-only passes
    { id: 'medium-dna',            label: 'Medium structural DNA',       agent: 'openai-search',  prompt: 'medium-dna-analysis',  notes: 'CIP only — runs only when isCIP.',                            rank: 5,  lane: -2 },
    { id: 'cip-final-pass',        label: 'CIP final pass',              agent: 'gemini-text',    prompt: 'cip-final-pass',       notes: 'CIP only — runs only when isCIP.',                            rank: 6,  lane: -2 },

    // Projects-only second agent
    { id: 'projects-reviewer',     label: 'Projects reviewer',           agent: 'gemini-text',    prompt: 'projects-reviewer',    notes: 'Projects only — second of two agents.',                       rank: 5,  lane: 2 },

    // Drafting fan-in
    { id: 'seed-draft',            label: 'Seed draft (fan-out)',        agent: 'fanout',                                                                                                              rank: 7,  lane: 0 },

    // Editorial branch (left lane = -2)
    { id: 'zachgpt-review',        label: 'ZachGPT review',              agent: 'gemini-review',  prompt: 'zachgpt-review',                                                                            rank: 8,  lane: -2 },
    { id: 'zachgpt-incorporate',   label: 'ZachGPT incorporate',         agent: 'gemini-text',    prompt: 'zachgpt-incorporate',                                                                       rank: 9,  lane: -2 },
    { id: 'seo-keywords',          label: 'SEO keywords',                agent: 'openai-search',  prompt: 'seo-keywords',         notes: 'Optional — runs only when seoMode != none.',                  rank: 10, lane: -3 },
    { id: 'seo-editor',            label: 'SEO editor',                  agent: 'gemini-text',    prompt: 'seo-editor',           notes: 'Mode mapped: optimize→STRICT, rewrite→FLEXIBLE.',             rank: 11, lane: -3 },
    { id: 'pr-reviewer',           label: 'PR reviewer',                 agent: 'gemini-review',  prompt: 'pr-reviewer',          notes: 'Always runs. Receives SEO output if SEO ran, else ZachGPT output directly.', rank: 12, lane: -2 },
    { id: 'markdown-to-html',      label: 'Markdown → HTML',             agent: 'transform',                                                                                                           rank: 13, lane: -2 },
    { id: 'structure-output',      label: 'Structure output',            agent: 'transform',                                                                                                           rank: 14, lane: -2 },
    { id: 'sanitize-format',       label: 'Sanitize & format',           agent: 'transform',                                            notes: 'Final cleaned HTML — fed straight into editor-blocks (the real fan-in).', rank: 15, lane: -2 },

    // Widget branch (right lane = +2)
    { id: 'widgets-extract',       label: 'Widgets extract',             agent: 'transform',                                                                                                           rank: 8,  lane: 2 },
    { id: 'widgets-generate',      label: 'Widgets generate',            agent: 'fanout',         notes: 'Spawns code-generator, table-research+generator, image-generate per tag in parallel.',     rank: 9,  lane: 2 },
    { id: 'code-generator',        label: 'Code generator',              agent: 'gemini-text',    prompt: 'code-generator',       notes: 'Per [code] tag.',                                             rank: 10, lane: 1 },
    { id: 'table-research',        label: 'Table research',              agent: 'openai-search',  prompt: 'table-research',       notes: 'Per [table] tag.',                                            rank: 10, lane: 2 },
    { id: 'table-generator',       label: 'Table generator',             agent: 'gemini-text',    prompt: 'table-generator',                                                                            rank: 11, lane: 2 },
    { id: 'image-generate',        label: 'Image generate',              agent: 'http',                                           notes: 'Per [image] tag — GPT Image.',                                rank: 10, lane: 3 },

    // Join + publish — editor-blocks is the single fan-in node where the editorial and widget
    // branches actually combine into the final Educative payload. (A throwaway HTML-preview
    // string is built here too, but it isn't its own pipeline stage.)
    { id: 'editor-blocks',         label: 'Editor blocks (Educative)',   agent: 'transform',                                      notes: 'Fan-in: walks cleanedHtml from editorial branch, replaces [code]/[table]/[image] tags with the corresponding widget blocks in extraction order.', rank: 16, lane: 0 },
    { id: 'publish',               label: 'Publish to Educative',        agent: 'http',                                           notes: 'Optional — fired from /history detail.',                      rank: 17, lane: 0 },
    { id: 'end',                   label: 'Done',                        agent: 'terminal',                                                                                                            rank: 18, lane: 0 },
  ],
  edges: [
    // Research split (isGenAI)
    { from: 'start',                to: 'topic-research',           when: 'else' },
    { from: 'start',                to: 'genai-search',             when: 'isGenAI' },
    { from: 'topic-research',       to: 'json-outline' },
    { from: 'genai-search',         to: 'genai-json-outline' },
    { from: 'json-outline',         to: 'outline-join' },
    { from: 'genai-json-outline',   to: 'outline-join' },

    // Drafting split (vertical switch)
    { from: 'outline-join',         to: 'text-generator',           when: 'isCIP / else' },
    { from: 'outline-join',         to: 'projects-text-generator',  when: 'isProjects' },

    // CIP-only second/third pass (gated by isCIP)
    { from: 'text-generator',       to: 'medium-dna',               when: 'isCIP' },
    { from: 'medium-dna',           to: 'cip-final-pass' },
    { from: 'cip-final-pass',       to: 'seed-draft' },
    // Default path bypasses CIP passes
    { from: 'text-generator',       to: 'seed-draft',               when: 'else' },

    // Projects two-agent path (no text-generator involvement)
    { from: 'projects-text-generator', to: 'projects-reviewer' },
    { from: 'projects-reviewer',    to: 'seed-draft' },

    // Editorial branch
    { from: 'seed-draft',           to: 'zachgpt-review' },
    { from: 'zachgpt-review',       to: 'zachgpt-incorporate' },
    // SEO conditional — incorporate either flows into SEO or skips straight to PR reviewer
    { from: 'zachgpt-incorporate',  to: 'seo-keywords',             when: 'seoMode != none' },
    { from: 'seo-keywords',         to: 'seo-editor' },
    { from: 'seo-editor',           to: 'pr-reviewer' },
    { from: 'zachgpt-incorporate',  to: 'pr-reviewer',              when: 'seoMode == none' },
    { from: 'pr-reviewer',          to: 'markdown-to-html' },
    { from: 'markdown-to-html',     to: 'structure-output' },
    { from: 'structure-output',     to: 'sanitize-format' },
    { from: 'sanitize-format',      to: 'editor-blocks' },

    // Widget branch
    { from: 'seed-draft',           to: 'widgets-extract' },
    { from: 'widgets-extract',      to: 'widgets-generate' },
    { from: 'widgets-generate',     to: 'code-generator',           when: '[code] tags' },
    { from: 'code-generator',       to: 'editor-blocks' },
    { from: 'widgets-generate',     to: 'table-research',           when: '[table] tags' },
    { from: 'table-research',       to: 'table-generator' },
    { from: 'table-generator',      to: 'editor-blocks' },
    { from: 'widgets-generate',     to: 'image-generate',           when: '[image] tags' },
    { from: 'image-generate',       to: 'editor-blocks' },

    // Join + publish
    { from: 'editor-blocks',        to: 'publish' },
    { from: 'publish',              to: 'end' },
  ],
};

// ---------------------------------------------------------------------------
// Newsletter pipeline (lib/pipeline.ts → runNewsletterPipeline)
// ---------------------------------------------------------------------------
//
//    start
//      │
//   topic-research
//      │
//   json-outline  (newsletter-json-outline)
//      │
//   outline-review (gate — auto-continues after 65s)
//      │
//   text-generator (newsletter-text-generator)
//      │
//   seed-draft (fan-out)
//    ┌───────────────────────────────┐
//    ▼                               ▼
//  editorial branch              widget branch
//  zachgpt-review                widgets-extract
//  zachgpt-incorporate           widgets-generate
//    ├─(seoMode != none)──►seo-keywords    ├─[code]──►code-generator
//    │                     seo-editor      ├─[table]─►table-research → table-generator
//    └─(seoMode == none)──►pr-reviewer     └─[image]─►image-generate
//  markdown-to-html                    │
//  structure-output                    │
//  sanitize-format                     │
//    └───────────────────┬─────────────┘
//                    editor-blocks
//                       publish
//                         end
//
export const newsletterGraph: PipelineGraph = {
  id: 'newsletter',
  title: 'Newsletter pipeline',
  description:
    'Linear research → outline → text generation (no vertical branching, no persona) → ' +
    'parallel editorial + widget branches → merge into Educative editor blocks.',
  nodes: [
    { id: 'nl-start',               label: 'Start',                    agent: 'terminal',                                                                  rank: 0,  lane: 0 },
    { id: 'nl-topic-research',      label: 'Topic research',           agent: 'openai-search',  prompt: 'initial-topic-search',                            rank: 1,  lane: 0 },
    { id: 'nl-json-outline',        label: 'JSON outline',             agent: 'gemini-text',    prompt: 'newsletter-json-outline',                         rank: 2,  lane: 0 },
    { id: 'nl-outline-review',      label: 'Outline review (gate)',    agent: 'terminal',       notes: 'Pauses 65s for user edit; auto-continues.',        rank: 3,  lane: 0 },
    { id: 'nl-text-generator',      label: 'Text generator',           agent: 'gemini-text',    prompt: 'newsletter-text-generator', model: 'gemini-2.5-pro (streaming)', rank: 4, lane: 0 },
    { id: 'nl-seed-draft',          label: 'Seed draft (fan-out)',     agent: 'fanout',                                                                    rank: 5,  lane: 0 },

    // Editorial branch (left)
    { id: 'nl-zachgpt-review',      label: 'ZachGPT review',           agent: 'gemini-review',  prompt: 'zachgpt-review',                                 rank: 6,  lane: -2 },
    { id: 'nl-zachgpt-incorporate', label: 'ZachGPT incorporate',      agent: 'gemini-text',    prompt: 'zachgpt-incorporate',                             rank: 7,  lane: -2 },
    { id: 'nl-seo-keywords',        label: 'SEO keywords',             agent: 'openai-search',  prompt: 'seo-keywords',          notes: 'Optional — seoMode != none.', rank: 8, lane: -3 },
    { id: 'nl-seo-editor',          label: 'SEO editor',               agent: 'gemini-text',    prompt: 'seo-editor',                                      rank: 9,  lane: -3 },
    { id: 'nl-pr-reviewer',         label: 'PR reviewer',              agent: 'gemini-review',  prompt: 'pr-reviewer',                                     rank: 10, lane: -2 },
    { id: 'nl-markdown-to-html',    label: 'Markdown → HTML',          agent: 'transform',                                                                 rank: 11, lane: -2 },
    { id: 'nl-structure-output',    label: 'Structure output',         agent: 'transform',                                                                 rank: 12, lane: -2 },
    { id: 'nl-sanitize-format',     label: 'Sanitize & format',        agent: 'transform',                                                                 rank: 13, lane: -2 },

    // Widget branch (right)
    { id: 'nl-widgets-extract',     label: 'Widgets extract',          agent: 'transform',                                                                 rank: 6,  lane: 2 },
    { id: 'nl-widgets-generate',    label: 'Widgets generate',         agent: 'fanout',         notes: 'Spawns code/table/image generators per tag.',      rank: 7,  lane: 2 },
    { id: 'nl-code-generator',      label: 'Code generator',           agent: 'gemini-text',    prompt: 'code-generator',        notes: 'Per [code] tag.',  rank: 8,  lane: 1 },
    { id: 'nl-table-research',      label: 'Table research',           agent: 'openai-search',  prompt: 'table-research',        notes: 'Per [table] tag.', rank: 8,  lane: 2 },
    { id: 'nl-table-generator',     label: 'Table generator',          agent: 'gemini-text',    prompt: 'table-generator',                                 rank: 9,  lane: 2 },
    { id: 'nl-image-generate',      label: 'Image generate',           agent: 'http',           notes: 'Per [image] tag — GPT Image.',                     rank: 8,  lane: 3 },

    // Join + publish
    { id: 'nl-editor-blocks',       label: 'Editor blocks (Educative)',agent: 'transform',      notes: 'Fan-in: editorial + all widget branches.',         rank: 14, lane: 0 },
    { id: 'nl-publish',             label: 'Publish to Educative',     agent: 'http',           notes: 'Optional — fired from /blogs detail.',             rank: 15, lane: 0 },
    { id: 'nl-end',                 label: 'Done',                     agent: 'terminal',                                                                  rank: 16, lane: 0 },
  ],
  edges: [
    { from: 'nl-start',               to: 'nl-topic-research' },
    { from: 'nl-topic-research',      to: 'nl-json-outline' },
    { from: 'nl-json-outline',        to: 'nl-outline-review' },
    { from: 'nl-outline-review',      to: 'nl-text-generator' },
    { from: 'nl-text-generator',      to: 'nl-seed-draft' },

    // Editorial branch
    { from: 'nl-seed-draft',          to: 'nl-zachgpt-review' },
    { from: 'nl-zachgpt-review',      to: 'nl-zachgpt-incorporate' },
    { from: 'nl-zachgpt-incorporate', to: 'nl-seo-keywords',          when: 'seoMode != none' },
    { from: 'nl-seo-keywords',        to: 'nl-seo-editor' },
    { from: 'nl-seo-editor',          to: 'nl-pr-reviewer' },
    { from: 'nl-zachgpt-incorporate', to: 'nl-pr-reviewer',           when: 'seoMode == none' },
    { from: 'nl-pr-reviewer',         to: 'nl-markdown-to-html' },
    { from: 'nl-markdown-to-html',    to: 'nl-structure-output' },
    { from: 'nl-structure-output',    to: 'nl-sanitize-format' },
    { from: 'nl-sanitize-format',     to: 'nl-editor-blocks' },

    // Widget branch
    { from: 'nl-seed-draft',          to: 'nl-widgets-extract' },
    { from: 'nl-widgets-extract',     to: 'nl-widgets-generate' },
    { from: 'nl-widgets-generate',    to: 'nl-code-generator',        when: '[code] tags' },
    { from: 'nl-code-generator',      to: 'nl-editor-blocks' },
    { from: 'nl-widgets-generate',    to: 'nl-table-research',        when: '[table] tags' },
    { from: 'nl-table-research',      to: 'nl-table-generator' },
    { from: 'nl-table-generator',     to: 'nl-editor-blocks' },
    { from: 'nl-widgets-generate',    to: 'nl-image-generate',        when: '[image] tags' },
    { from: 'nl-image-generate',      to: 'nl-editor-blocks' },

    // Join + publish
    { from: 'nl-editor-blocks',       to: 'nl-publish' },
    { from: 'nl-publish',             to: 'nl-end' },
  ],
};

// ---------------------------------------------------------------------------
// Course pipeline (lib/coursePipeline.ts → runCourseLessonPipeline)
// ---------------------------------------------------------------------------
//
//    start
//      │
//   web-research  (openai-search)
//      │
//   json-outline  (gemini-text: course-outline-generator)
//      │
//   content-creator (gemini-text: course-content-creator)
//      │
//   summary-elements (gemini-text: course-summary-elements)
//      │
//   pr-reviewer (gemini-review: course-pr-reviewer)
//      │
//   widget-fanout (fan-out — parallel)
//    ├──► widget-code    (gemini-text)      [code]
//    ├──► widget-table   (gemini-text)      [table]
//    ├──► widget-runjs   (gemini-text+http) [runjs]
//    └──► widget-images  (http: GPT)        [image]
//      │ (all join at editor-blocks)
//   editor-blocks (transform)
//      │
//   save-lesson (http: POST Educative)
//      │
//   save-chapter (http: add page to chapter)
//      │
//   publish (http)
//      │
//    end
//
export const courseGraph: PipelineGraph = {
  id: 'course',
  title: 'Course lesson pipeline',
  description:
    'Web research → JSON lesson outline → content draft → summary elements → PR review → ' +
    'parallel widget generation (code, table, RunJS, images) → merge into Educative course editor blocks.',
  nodes: [
    { id: 'cs-start',            label: 'Start',                   agent: 'terminal',                                                                        rank: 0,  lane: 0 },
    { id: 'cs-web-research',     label: 'Web research',            agent: 'openai-search', prompt: 'course-web-research',    model: 'gpt search-preview',    rank: 1,  lane: 0 },
    { id: 'cs-json-outline',     label: 'Lesson JSON outline',     agent: 'gemini-text',   prompt: 'course-outline-generator', model: 'gemini-2.5-flash',    rank: 2,  lane: 0 },
    { id: 'cs-content-creator',  label: 'Content creator',         agent: 'gemini-text',   prompt: 'course-content-creator',                                 rank: 3,  lane: 0 },
    { id: 'cs-summary-elements', label: 'Summary elements',        agent: 'gemini-text',   prompt: 'course-summary-elements', notes: 'Generates quiz, AI assessment, markmap, hint.', rank: 4, lane: 0 },
    { id: 'cs-pr-reviewer',      label: 'PR reviewer',             agent: 'gemini-review', prompt: 'course-pr-reviewer',                                     rank: 5,  lane: 0 },
    { id: 'cs-widget-fanout',    label: 'Widget fan-out',          agent: 'fanout',        notes: 'Spawns widget generators in parallel.',                   rank: 6,  lane: 0 },

    // Widget branch — parallel lanes
    { id: 'cs-widget-code',      label: 'Widget: code',            agent: 'gemini-text',   prompt: 'course-code-generator',  notes: 'Per [code] tag.',        rank: 7,  lane: -2 },
    { id: 'cs-widget-table',     label: 'Widget: table',           agent: 'gemini-text',   prompt: 'course-table-generator', notes: 'Per [table] tag.',       rank: 7,  lane: -1 },
    { id: 'cs-widget-runjs',     label: 'Widget: RunJS',           agent: 'gemini-text',   prompt: 'course-runjs-creator',   notes: 'Per [runjs] tag. Two-step: elaborate → HTML creator.', rank: 7, lane: 1 },
    { id: 'cs-widget-images',    label: 'Widget: images',          agent: 'http',          notes: 'Per [image] tag — GPT Image.',                            rank: 7,  lane: 2  },

    // Join + save
    { id: 'cs-editor-blocks',    label: 'Editor blocks (Educative)', agent: 'transform',   notes: 'Fan-in: merges all widget outputs into final blocks array. Appends quiz, AI assessment, markmap, hint.', rank: 8, lane: 0 },
    { id: 'cs-save-lesson',      label: 'Save lesson',             agent: 'http',          notes: 'POST → PUT to Educative course page API.',                rank: 9,  lane: 0 },
    { id: 'cs-save-chapter',     label: 'Save chapter',            agent: 'http',          notes: 'Adds page to chapter section in collection (non-fatal).',  rank: 10, lane: 0 },
    { id: 'cs-publish',          label: 'Publish',                 agent: 'http',          notes: 'Optional — publishes course collection.',                  rank: 11, lane: 0 },
    { id: 'cs-end',              label: 'Done',                    agent: 'terminal',                                                                        rank: 12, lane: 0 },
  ],
  edges: [
    { from: 'cs-start',            to: 'cs-web-research' },
    { from: 'cs-web-research',     to: 'cs-json-outline' },
    { from: 'cs-json-outline',     to: 'cs-content-creator' },
    { from: 'cs-content-creator',  to: 'cs-summary-elements' },
    { from: 'cs-summary-elements', to: 'cs-pr-reviewer' },
    { from: 'cs-pr-reviewer',      to: 'cs-widget-fanout' },

    // Widget fan-out
    { from: 'cs-widget-fanout',    to: 'cs-widget-code',    when: '[code] tags' },
    { from: 'cs-widget-fanout',    to: 'cs-widget-table',   when: '[table] tags' },
    { from: 'cs-widget-fanout',    to: 'cs-widget-runjs',   when: '[runjs] tags' },
    { from: 'cs-widget-fanout',    to: 'cs-widget-images',  when: '[image] tags' },

    // Widget fan-in
    { from: 'cs-widget-code',      to: 'cs-editor-blocks' },
    { from: 'cs-widget-table',     to: 'cs-editor-blocks' },
    { from: 'cs-widget-runjs',     to: 'cs-editor-blocks' },
    { from: 'cs-widget-images',    to: 'cs-editor-blocks' },

    // Save + publish
    { from: 'cs-editor-blocks',    to: 'cs-save-lesson' },
    { from: 'cs-save-lesson',      to: 'cs-save-chapter' },
    { from: 'cs-save-chapter',     to: 'cs-publish' },
    { from: 'cs-publish',          to: 'cs-end' },
  ],
};

// ---------------------------------------------------------------------------
// Mobile Course pipeline (lib/mobileCoursePipeline.ts → runMobileCoursePipeline)
// ---------------------------------------------------------------------------
//
//                     start
//                       │
//          ┌────────────┴────────────┐
//   (previewedChapters)           (else)
//   fetch-content           fetch-collection
//          └────────────┬────────────┘
//                chapters-fanout  (N chapters in parallel)
//                       │
//                  card-planner      (gemini-text)
//                       │
//                 cards-generator    (gemini-text)
//                       │
//                  text-refiner      (gemini-text)
//                       │
//                 json-generator     (gemini-text)
//                       │
//           ┌───────────┴────────────┐
//       (visual cards)          (else)
//         mc-images                  │
//           └───────────┬────────────┘
//                chapters-fanin  (Promise.all join)
//                       │
//                    mc-save
//                       │
//                    mc-end
//
export const mobileCourseGraph: PipelineGraph = {
  id: 'mobile-course',
  title: 'Mobile course pipeline',
  description:
    'Fetches an Educative collection, processes chapters in parallel through 4 Gemini agents ' +
    '(card planner → cards generator → text refiner → JSON generator) and generates portrait AI images for visual cards.',
  nodes: [
    { id: 'mc-start',            label: 'Start',                  agent: 'terminal',                                                                                 rank: 0,  lane: 0 },
    { id: 'mc-fetch-content',    label: 'Fetch previewed content', agent: 'http',      notes: 'Fetches lesson content for user-selected chapters only.',              rank: 1,  lane: -1 },
    { id: 'mc-fetch-collection', label: 'Fetch full collection',  agent: 'http',       notes: 'Fetches full TOC + lesson content when no chapters are pre-selected.', rank: 1,  lane: 1 },
    { id: 'mc-chapters-fanout',  label: 'Chapters (parallel)',    agent: 'fanout',     notes: 'Dispatches N chapters in parallel via Promise.all.',                   rank: 2,  lane: 0 },
    { id: 'mc-card-planner',     label: 'Card planner',           agent: 'gemini-text', prompt: 'mobile-card-planner',    model: 'gemini-2.5-flash',                  rank: 3,  lane: 0 },
    { id: 'mc-cards-generator',  label: 'Cards generator',        agent: 'gemini-text', prompt: 'mobile-cards-generator', model: 'gemini-2.5-flash',                  rank: 4,  lane: 0 },
    { id: 'mc-text-refiner',     label: 'Text refiner',           agent: 'gemini-text', prompt: 'mobile-text-refiner',    model: 'gemini-2.5-flash',                  rank: 5,  lane: 0 },
    { id: 'mc-json-generator',   label: 'JSON generator',         agent: 'gemini-text', prompt: 'mobile-json-generator',  model: 'gemini-2.5-flash',                  rank: 6,  lane: 0 },
    { id: 'mc-images',           label: 'AI image generation',    agent: 'http',       notes: 'GPT Image — portrait 640×1024 for text_img and img_only cards.',       rank: 7,  lane: 1 },
    { id: 'mc-chapters-fanin',   label: 'Chapters (join)',        agent: 'fanout',     notes: 'Promise.all join — waits for all chapter processing to complete.',     rank: 8,  lane: 0 },
    { id: 'mc-save',             label: 'Save to storage',        agent: 'http',       notes: 'Persists course JSON to data/mobile-courses/{id}.json.',               rank: 9,  lane: 0 },
    { id: 'mc-end',              label: 'Done',                   agent: 'terminal',                                                                                  rank: 10, lane: 0 },
  ],
  edges: [
    { from: 'mc-start',            to: 'mc-fetch-content',    when: 'previewedChapters' },
    { from: 'mc-start',            to: 'mc-fetch-collection', when: 'else' },
    { from: 'mc-fetch-content',    to: 'mc-chapters-fanout' },
    { from: 'mc-fetch-collection', to: 'mc-chapters-fanout' },
    { from: 'mc-chapters-fanout',  to: 'mc-card-planner' },
    { from: 'mc-card-planner',     to: 'mc-cards-generator' },
    { from: 'mc-cards-generator',  to: 'mc-text-refiner' },
    { from: 'mc-text-refiner',     to: 'mc-json-generator' },
    { from: 'mc-json-generator',   to: 'mc-images',           when: 'visual cards' },
    { from: 'mc-json-generator',   to: 'mc-chapters-fanin',   when: 'else' },
    { from: 'mc-images',           to: 'mc-chapters-fanin' },
    { from: 'mc-chapters-fanin',   to: 'mc-save' },
    { from: 'mc-save',             to: 'mc-end' },
  ],
};

// ---------------------------------------------------------------------------
// Mobile Short pipeline (app/api/mobile-short → runMobileShortPipeline)
// ---------------------------------------------------------------------------
//
//                              start
//                                │
//                       create-collection
//                                │
//                         topic-detailer   (openai-search)
//                                │
//                        cards-generator   (gemini-text)
//                                │
//                         json-generator   (gemini-text)
//                                │
//                           split-cards    (transform)
//                                │
//                            card-loop     (fanout)
//                   ┌──────────────────────────┐
//           (text_img / img_only)           (else)
//              image-generate           create-lesson
//              image-upload                  │
//                   └──────────────────────────┘
//                             create-lesson ◄─ (image-upload)
//                                │
//                           build-widget   (transform)
//                                │
//                           save-content   (http)
//                                │
//                            update-chp    (http)
//                   ┌──────────────────────────┐
//              (more cards)              (all done)
//             card-loop ◄──             publish
//                                          │
//                                         end
//
export const mobileShortGraph: PipelineGraph = {
  id: 'mobile-short',
  title: 'Mobile short pipeline',
  description:
    'Creates an Educative flash-card-shot collection: topic research → card content generation → ' +
    'JSON structuring → per-card loop (optional AI portrait image) → build FlashCard widget → ' +
    'save content → update collection structure → publish.',
  nodes: [
    { id: 'ms-start',             label: 'Start',                      agent: 'terminal',                                                                                                          rank: 0,  lane: 0 },
    { id: 'ms-create-collection', label: 'Create collection',          agent: 'http',          notes: 'Creates flash-card-shot collection via Educative API.',                                    rank: 1,  lane: 0 },
    { id: 'ms-topic-detailer',    label: 'Topic detailer',             agent: 'openai-search', prompt: 'shorts-topic-detailer',   model: 'gpt-4o-search-preview', notes: 'Foundational summary, card pillars, 2026 insight.', rank: 2, lane: 0 },
    { id: 'ms-cards-generator',   label: 'Cards generator',            agent: 'gemini-text',   prompt: 'shorts-cards-generator',  model: 'gemini-2.5-pro',        notes: 'Generates atomic card content with visual mix rules.', rank: 3, lane: 0 },
    { id: 'ms-json-generator',    label: 'JSON generator',             agent: 'gemini-text',   prompt: 'shorts-json-generator',   model: 'gemini-2.5-pro',        notes: 'Converts to structured JSON per card type.',          rank: 4, lane: 0 },
    { id: 'ms-split-cards',       label: 'Split cards',                agent: 'transform',     notes: 'Parse and split into individual card objects.',                                            rank: 5,  lane: 0 },
    { id: 'ms-card-loop',         label: 'Per-card loop',              agent: 'fanout',        notes: 'Iterates over each card independently.',                                                   rank: 6,  lane: 0 },

    // Image branch (left lane)
    { id: 'ms-image-generate',    label: 'Image generate',             agent: 'http',          notes: 'gpt-image-2 portrait 640x1024 — text_img and img_only only.',                             rank: 7,  lane: -1 },
    { id: 'ms-image-upload',      label: 'Image upload',               agent: 'http',          notes: 'Upload image to Educative bucket, get image_id + download URL.',                          rank: 8,  lane: -1 },

    // Create + build branch (right lane)
    { id: 'ms-create-lesson',     label: 'Create lesson',              agent: 'http',          notes: 'POST /api/author/{id}/collection/{cid}/page.',                                             rank: 7,  lane: 1 },
    { id: 'ms-build-widget',      label: 'Build FlashCard widget',     agent: 'transform',     notes: 'Format card into Educative FlashCard component JSON.',                                    rank: 8,  lane: 1 },

    // Save + loop back / publish
    { id: 'ms-save-content',      label: 'Save content',               agent: 'http',          notes: 'PUT page content to Educative.',                                                           rank: 9,  lane: 0 },
    { id: 'ms-update-chp',        label: 'Update CHP',                 agent: 'http',          notes: 'Fetch → extract → append page → save collection structure.',                              rank: 10, lane: 0 },
    { id: 'ms-publish',           label: 'Publish short',              agent: 'http',          notes: 'POST /api/author/{id}/collection/{cid}/publish?work_type=collection.',                    rank: 11, lane: 0 },
    { id: 'ms-end',               label: 'Done',                       agent: 'terminal',                                                                                                         rank: 12, lane: 0 },
  ],
  edges: [
    { from: 'ms-start',             to: 'ms-create-collection' },
    { from: 'ms-create-collection', to: 'ms-topic-detailer' },
    { from: 'ms-topic-detailer',    to: 'ms-cards-generator' },
    { from: 'ms-cards-generator',   to: 'ms-json-generator' },
    { from: 'ms-json-generator',    to: 'ms-split-cards' },
    { from: 'ms-split-cards',       to: 'ms-card-loop' },

    // Card loop branches
    { from: 'ms-card-loop',         to: 'ms-image-generate',   when: 'text_img / img_only' },
    { from: 'ms-card-loop',         to: 'ms-create-lesson',    when: 'else' },

    // Image branch → rejoin at create-lesson
    { from: 'ms-image-generate',    to: 'ms-image-upload' },
    { from: 'ms-image-upload',      to: 'ms-create-lesson' },

    // Create + build → save
    { from: 'ms-create-lesson',     to: 'ms-build-widget' },
    { from: 'ms-build-widget',      to: 'ms-save-content' },
    { from: 'ms-save-content',      to: 'ms-update-chp' },

    // Loop-back or proceed to publish
    { from: 'ms-update-chp',        to: 'ms-card-loop',        when: 'more cards', style: 'dashed' },
    { from: 'ms-update-chp',        to: 'ms-publish',          when: 'all done' },
    { from: 'ms-publish',           to: 'ms-end' },
  ],
};

export const ALL_GRAPHS: PipelineGraph[] = [outlineGraph, blogGraph, newsletterGraph, courseGraph, mobileCourseGraph, mobileShortGraph];
