# Persona Blogs — Architecture & Developer Guide

A self-hosted Next.js application that generates persona-driven, long-form articles via multi-stage AI pipelines. Originally a faithful port of an n8n workflow, now a standalone system with a web UI, live pipeline visualization, prompt editing, persona management, and Educative CMS publishing.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Environment Variables](#environment-variables)
4. [Getting Started](#getting-started)
5. [Authentication](#authentication)
6. [Architecture Overview](#architecture-overview)
7. [Pipeline System](#pipeline-system)
8. [Standalone Pipeline](#standalone-pipeline)
9. [LLM Client Layer](#llm-client-layer)
10. [Prompt System](#prompt-system)
11. [Persona System](#persona-system)
12. [Data Storage](#data-storage)
13. [Run Manager & Abort](#run-manager--abort)
14. [Widget System](#widget-system)
15. [Image Generation](#image-generation)
16. [Educative Publishing](#educative-publishing)
17. [Frontend Components](#frontend-components)
18. [Blog Reader & Streaming](#blog-reader--streaming)
19. [API Routes](#api-routes)
20. [Pages](#pages)
21. [Pipeline Graph Visualization](#pipeline-graph-visualization)
22. [Key Patterns & Conventions](#key-patterns--conventions)
23. [Common Tasks](#common-tasks)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14.2 (App Router) |
| Language | TypeScript (strict: false) |
| Styling | Tailwind CSS 3.4, CSS variables for theming |
| LLM Orchestration | LangChain (`@langchain/google-genai`, `@langchain/openai`) |
| LLM Providers | Google Gemini (gemini-2.5-flash / gemini-2.5-pro), OpenAI GPT-4o |
| Image Generation | OpenAI gpt-image-2 (webp output) |
| Auth | NextAuth.js v4 (Google OAuth, JWT strategy, domain restriction) |
| Markdown | `marked` (server-side HTML), `react-markdown` + `remark-gfm` + `rehype-raw` (client preview) |
| Charts | Chart.js + react-chartjs-2 |
| Publishing | Educative CMS API |
| Data | Filesystem JSON (no database) |

---

## Project Structure

```
.
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout: header, nav, SessionProvider, ThemeToggle, UserMenu
│   ├── page.tsx                  # Home page (public) — task selector with pipeline overview
│   ├── globals.css               # Global styles, CSS variables, dark/light themes, widget styles, skeletons
│   ├── _components/              # Shared UI components
│   │   ├── Field.tsx             # Form field wrapper (label + hint)
│   │   ├── NavLinks.tsx          # Nav bar links (Home, Outline, Blog, Standalone, Blogs)
│   │   ├── Stages.tsx            # Pipeline progress tracker (collapsible stage list with status dots)
│   │   ├── StageOutputs.tsx      # Tabbed stage output inspector (content + logs view, widget sub-tabs)
│   │   ├── SessionWrapper.tsx    # Client-side NextAuth SessionProvider wrapper
│   │   ├── ThemeToggle.tsx       # Dark/light theme toggle
│   │   └── UserMenu.tsx          # Avatar dropdown: sign-out, admin links (History, Graph, Prompts, Personas)
│   ├── auth/                     # Auth pages
│   │   ├── signin/page.tsx       # Custom Google sign-in page
│   │   └── error/page.tsx        # Auth error page (domain denied, config error)
│   ├── outline/page.tsx          # Outline generator UI (Step 1)
│   ├── blog/page.tsx             # Full blog generator UI (Step 2) with outline review popup
│   ├── standalone/page.tsx       # Standalone blog generator form — redirects to /blogs/{slug} on submit
│   ├── blogs/
│   │   ├── page.tsx              # Blog gallery — tiles of all standalone blogs (delete, status labels)
│   │   └── [slug]/page.tsx       # Blog reader: streaming, TOC sidebar, code windows, image captions
│   ├── history/
│   │   ├── page.tsx              # Saved blog runs list (filter by status/persona, search, delete)
│   │   └── [id]/page.tsx         # Single run detail (re-render all stage outputs, re-publish)
│   ├── graph/page.tsx            # Interactive DAG visualization of all 3 pipelines
│   ├── prompts/
│   │   ├── page.tsx              # Prompt template list (grouped by pipeline: Shared, Blog, Standalone, Outline)
│   │   └── [name]/page.tsx       # Single prompt editor (edit body, reset, rollback to version)
│   ├── personas/
│   │   ├── page.tsx              # Persona list (built-in + custom, create/delete)
│   │   └── [slug]/page.tsx       # Single persona editor (edit body, reset built-ins)
│   └── api/                      # API routes
│       ├── auth/[...nextauth]/route.ts  # NextAuth handler
│       ├── blog/                        # Original blog pipeline
│       │   ├── route.ts                 # POST: start blog pipeline run, stream SSE
│       │   └── [id]/
│       │       ├── cancel/route.ts      # POST: cancel in-flight run
│       │       ├── resume/route.ts      # POST: resume paused pipeline gate (outline review)
│       │       └── stream/route.ts      # GET: re-attach to live run SSE stream
│       ├── standalone/                  # Standalone blog pipeline
│       │   ├── route.ts                 # POST: start standalone pipeline, stream SSE (meta event → redirect)
│       │   ├── [id]/
│       │   │   ├── cancel/route.ts      # POST: cancel in-flight run
│       │   │   ├── resume/route.ts      # POST: resume paused pipeline gate (unused, kept for parity)
│       │   │   ├── retry/route.ts       # POST: retry failed pipeline from a specific stage
│       │   │   └── subscribe/route.ts   # GET: SSE stream for live run (blog reader subscribes here)
│       │   ├── blogs/
│       │   │   ├── route.ts             # GET: list all standalone blogs (with orphan reconciliation)
│       │   │   └── [id]/route.ts        # GET/DELETE: single blog (resolves both id and slug)
│       │   └── images/
│       │       └── [filename]/route.ts  # GET: serve generated webp images with immutable caching
│       ├── outline/route.ts             # POST: run outline pipeline, stream SSE
│       ├── history/
│       │   ├── route.ts                 # GET: list all saved blog runs
│       │   └── [id]/route.ts            # GET/DELETE: single blog record
│       ├── publish/route.ts             # POST: create + upload to Educative CMS
│       ├── personas/
│       │   ├── route.ts                 # GET: list all, POST: create new
│       │   └── [slug]/route.ts          # GET/PUT/DELETE: single persona
│       └── prompts/
│           ├── route.ts                 # GET: list all registered prompts (includes pipeline tag)
│           └── [name]/route.ts          # GET/PUT: single prompt (edit, reset, rollback)
├── lib/                          # Core server-side logic
│   ├── ai.ts                     # LLM client layer (LangChain wrappers, model caching, streaming support)
│   ├── auth.ts                   # NextAuth config (Google provider, JWT, domain validation, multi-admin)
│   ├── pipeline.ts               # Pipeline definitions: runOutlinePipeline, runBlogPipeline, StageEvent types
│   ├── standalonePipeline.ts     # Standalone blog pipeline (no widgets, inline code/tables, image placeholders)
│   ├── runManager.ts             # Background run registry for original blog pipeline
│   ├── standaloneRunManager.ts   # Background run registry for standalone pipeline (slug generation)
│   ├── standaloneStorage.ts      # File-backed standalone blog CRUD (slug, id, slug-based lookup)
│   ├── abortContext.ts           # AsyncLocalStorage-based abort signal propagation
│   ├── promptsRegistry.ts        # Wires lib/prompts.ts through file-backed prompt store (pipeline-tagged)
│   ├── promptStore.ts            # File-backed prompt CRUD with versioning, template extraction, pipeline tags
│   ├── personaStore.ts           # File-backed persona CRUD (built-in + custom, override on disk)
│   ├── personas.ts               # Built-in persona definitions (22 voices, ported from n8n)
│   ├── prompts.ts                # All prompt templates (including standaloneTextGeneratorPrompt)
│   ├── prompts.d2.ts             # D2 diagram generator prompt (separate file due to size)
│   ├── storage.ts                # Blog run persistence for original pipeline (JSON files in data/blogs/)
│   ├── transforms.ts             # Text sanitization, widget tag extraction/building, merge
│   ├── educative.ts              # Educative CMS: markdown-to-HTML, editor block factories, HTTP API
│   ├── imageGen.ts               # OpenAI gpt-image-2 image generation, extraction, and placeholder replacement
│   └── pipelineGraph.ts          # Declarative graph definitions for all 3 pipelines
├── middleware.ts                 # Auth middleware (protects all routes except / and /auth/*)
├── types/
│   └── next-auth.d.ts            # TypeScript augmentation for isAdmin on session
├── data/                         # Filesystem storage (gitignored)
│   ├── blogs/                    # One JSON file per original pipeline run
│   ├── standalone/               # One JSON file per standalone pipeline run
│   ├── standalone-images/        # Generated webp images from gpt-image-2
│   ├── personas/                 # User-edited persona overrides
│   └── prompts/                  # User-edited prompt overrides
├── .env.example                  # Template for all environment variables
├── .env.local                    # Active env vars (gitignored)
├── next.config.js                # Next.js config (serverActions bodySizeLimit: 5mb)
├── tailwind.config.ts            # Tailwind config
├── tsconfig.json                 # TypeScript config (bundler module resolution, @/* path alias)
└── package.json                  # Dependencies and scripts
```

---

## Environment Variables

All variables are documented in `.env.example`. Copy to `.env.local` and fill in values.

### LLM Providers

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Generative AI API key. Drives every `generateText` / `reviewText` / `generateTextStream` / `reviewTextStream` call. |
| `GEMINI_MODEL_DEFAULT` | No | Default model for non-drafting stages. Default: `gemini-2.5-flash`. |
| `GEMINI_MODEL_REVIEW` | No | Model for review/critique stages (zachgpt-review, pr-reviewer). Default: `gemini-2.5-flash`. |
| `GEMINI_MODEL_TEXTGEN` | No | Heavy drafting model (text-generator stage, both main + custom blog). Default: `gemini-2.5-pro`. |
| `OPENAI_API_KEY` | Yes | Used for web search (gpt-4o-search-preview), JSON output, and image generation (gpt-image-2) |
| `OPENAI_SEARCH_MODEL` | No | Default: `gpt-4o-search-preview` |

### Authentication

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth 2.0 client secret |
| `NEXTAUTH_SECRET` | Yes | Random string for JWT encryption. Generate: `openssl rand -base64 32` |
| `ALLOWED_DOMAIN` | No | Email domain restriction (e.g. `educative.io`). Empty = allow all. |
| `ADMIN_EMAILS` | No | Comma-separated list of admin emails (e.g. `a@co.com,b@co.com`) |

### Educative Publishing

| Variable | Required | Description |
|----------|----------|-------------|
| `EDUCATIVE_FLASK_AUTH` | For publish | Cookie value for Educative API auth |
| `EDUCATIVE_TEMPLATE_ID` | No | Blog template ID (default: 5002) |
| `EDUCATIVE_D2_PATH` | No | API path for D2 SVG rendering |

---

## Getting Started

```bash
# Install dependencies
npm install

# Copy and fill environment variables
cp .env.example .env.local

# Start dev server
npm run dev

# Build for production
npm run build && npm start
```

Google OAuth callback URL (add in Google Cloud Console):
```
http://localhost:3000/api/auth/callback/google
```

---

## Authentication

Authentication uses **NextAuth.js v4** with Google OAuth and JWT strategy (no database).

### How it works

1. **`middleware.ts`** — runs on every request. Public paths: `/`, `/auth/*`, `/api/auth/*`. Everything else requires a valid JWT cookie. Unauthenticated browser requests redirect to `/auth/signin`; API requests get 401 JSON. **Admin-only routes** (`/history`, `/prompts`, `/personas`, `/graph` and their API counterparts) return 403 / redirect to home for non-admin users.

2. **`lib/auth.ts`** — NextAuth configuration. The `signIn` callback validates the user's email ends with `@{ALLOWED_DOMAIN}`. The `jwt` callback writes `isAdmin = true` when the email is in the `ADMIN_EMAILS` list. The `session` callback exposes `isAdmin` to the client.

3. **`app/_components/NavLinks.tsx`** — shows public nav links (Home, Outline, Blog, Standalone, Blogs). When unauthenticated, clicking any protected link triggers `signIn('google', { callbackUrl: targetPage })`.

4. **`app/_components/UserMenu.tsx`** — header component showing sign-in button or user avatar dropdown. For admin users, the dropdown includes links to History, Pipeline Graph, Prompts, and Personas.

5. **`types/next-auth.d.ts`** — TypeScript augmentation adding `isAdmin` to the Session and JWT types.

### Session lifecycle

- JWT cookie persists 30 days (NextAuth default)
- No re-login required during that period unless user signs out or clears cookies

### Files involved

| File | Role |
|------|------|
| `lib/auth.ts` | NextAuth config (provider, callbacks, pages) |
| `middleware.ts` | Route protection |
| `app/api/auth/[...nextauth]/route.ts` | NextAuth handler |
| `app/auth/signin/page.tsx` | Custom sign-in page |
| `app/auth/error/page.tsx` | Auth error page |
| `app/_components/SessionWrapper.tsx` | SessionProvider wrapper |
| `app/_components/UserMenu.tsx` | Sign-in / avatar + admin links UI |
| `app/_components/NavLinks.tsx` | Auth-aware navigation |
| `types/next-auth.d.ts` | Type augmentation |

---

## Architecture Overview

```
Browser ──SSE──> API Route ──> runManager ──> pipeline.ts ──> ai.ts ──> LangChain ──> Gemini / OpenAI
                   │                │
                   │         emits StageEvents ──> SSE stream ──> Browser updates
                   │                │
                   │         storage.ts ──> data/blogs/{id}.json
                   │
                   └──> promptsRegistry.ts ──> promptStore.ts ──> data/prompts/{name}.json
                                                personaStore.ts ──> data/personas/{slug}.json

Standalone:
Browser ──POST──> /api/standalone ──> standaloneRunManager ──> standalonePipeline.ts ──> ai.ts
   │                                        │
   │ (redirect to /blogs/{slug})       emits StageEvents (incl. stream/stream-content)
   │                                        │
   └──GET /subscribe──> SSE ──> Blog reader page (streaming markdown, skeletons, TOC)
                                        │
                                  standaloneStorage.ts ──> data/standalone/{id}.json
                                  imageGen.ts ──> data/standalone-images/{blogId}-img{n}.webp

Retry (on failure):
Browser ──POST──> /api/standalone/{id}/retry ──> retryStandaloneRun(id, fromStage)
   │                                                  │
   │ (reset UI, fresh SSE)                     loads saved stageOutputs from disk
   │                                                  │
   └──GET /subscribe──> SSE ──>              standalonePipeline.ts (skips stages before fromStage)
```

### Request flow (original blog generation)

1. User fills form on `/blog` and submits
2. `POST /api/blog` receives the request
3. `runManager.startBlogRun(input)` creates a `RunHandle`, starts a detached async pipeline
4. The API route returns an SSE stream; the browser reads events in real-time
5. `pipeline.runBlogPipeline(input, emit, waitForResume)` executes stages sequentially
6. Each stage calls `emit()` which broadcasts to SSE subscribers and persists to disk
7. After `json-outline`, the pipeline pauses at the `outline-review` gate (60s auto-timeout)
8. The browser shows a popup; user reviews/edits, clicks Continue (or it auto-continues)
9. `POST /api/blog/{id}/resume` resolves the gate promise, pipeline continues
10. Final result is emitted, saved to disk, and shown in the UI

### Request flow (standalone blog generation)

1. User fills form on `/standalone` and submits
2. `POST /api/standalone` starts the run, returns SSE stream
3. Frontend reads just the `meta` event (contains `blogId` and `slug`), then redirects to `/blogs/{slug}`
4. Blog reader page at `/blogs/{slug}` fetches the blog record, sees `status: 'running'`
5. Blog reader subscribes to `GET /api/standalone/{id}/subscribe` for live SSE events
6. **Phase 1 (Hints)**: Contextual strikethrough messages while pre-content stages run
7. **Phase 2 (Streaming)**: `stream` events from `text-generator` and `pr-reviewer` render markdown progressively
8. **Phase 3 (Content)**: `stream-content` events show near-final markdown with image skeleton placeholders
9. Skeletons are replaced one by one as each `gpt-image-2` call completes
10. **Phase 4 (Done)**: `final` event renders the completed blog with TOC sidebar

---

## Pipeline System

Defined in **`lib/pipeline.ts`**. Two pipelines:

### Outline Pipeline (`runOutlinePipeline`)

Simple 2-stage pipeline:
1. **Web research** — `openaiSearch()` with `outlineSearchPrompt`
2. **Outline draft** — `generateText()` with `outlineGeneratorPrompt`

### Blog Pipeline (`runBlogPipeline`)

Complex 15+ stage pipeline with vertical-specific branching and parallel execution:

```
Topic Research ──> JSON Outline ──> Outline Review Gate ──> Drafting ──> Fan-out
                                                                          │
                                                         ┌────────────────┴────────────────┐
                                                    Editorial Branch                  Widget Branch
                                                    (sequential)                     (parallel per tag)
                                                         │                                │
                                                    ZachGPT Review                   Extract [code]/[table]/[image]
                                                    ZachGPT Incorporate              Code Generator (per tag)
                                                    SEO Keywords (optional)          Table Research + Generator (per tag)
                                                    SEO Editor (optional)            Image Enhancer → D2 or Chart (per tag)
                                                    PR Reviewer                           │
                                                    Markdown → HTML                       │
                                                    Structure Output                      │
                                                    Sanitize & Format                     │
                                                         └────────────────┬───────────────┘
                                                                     Editor Blocks (fan-in)
                                                                          │
                                                                     Final Output
```

### Vertical-specific paths

- **Default**: text-generator → editorial/widget branches
- **CIP** (Coding Interview Patterns): text-generator → medium-dna → cip-final-pass → branches
- **Projects**: projects-text-generator → projects-reviewer → branches (skips default text-generator)
- **GenAI/AI-ML**: genai-search → genai-json-outline (then standard drafting)

### Event system

The pipeline communicates via `StageEvent` objects:

```typescript
type StageEvent =
  | { type: 'stage'; name: string; status: 'start' | 'done' | 'error' }
  | { type: 'data'; name: string; payload: any }
  | { type: 'log'; name?: string; message: string; payload?: any }
  | { type: 'awaiting-input'; gate: string; payload: any }
  | { type: 'resumed'; gate: string; edited?: boolean }
  | { type: 'stream'; name: string; payload: string }          // LLM token-by-token streaming
  | { type: 'stream-content'; payload: string }                 // near-final markdown (with image skeletons)
  | { type: 'final'; payload: any };
```

### Outline Review Gate (original blog pipeline only)

After `json-outline` completes, the pipeline:
1. Formats the JSON outline into readable markdown via `formatOutlineForDisplay()`
2. Emits `awaiting-input` event with the display markdown and raw JSON
3. Awaits user response via `waitForResume('outline-review', payload)`
4. Server-side 65s timeout auto-continues if no response
5. Frontend shows a popup with 60s countdown, formatted preview, JSON editor toggle
6. User can review/edit the outline, then click Continue

---

## Standalone Pipeline

Defined in **`lib/standalonePipeline.ts`**. A streamlined pipeline focused on speed and real-time streaming.

### Differences from original blog pipeline

| Aspect | Blog Pipeline | Standalone Pipeline |
|--------|--------------|-------------------|
| Text generator prompt | `textGeneratorPrompt` (widget placeholders) | `standaloneTextGeneratorPrompt` (inline code/tables, `[image]` JSON placeholders) |
| Widgets | Full widget branch (code, table, D2, Chart.js) | No widgets — code and tables render inline as markdown |
| Images | `imageEnhancerPrompt` → D2 or Chart.js | `gpt-image-2` API for real illustrations (parallel) |
| Outline review | Pauses for human input (60s gate) | Auto-continues (no gate) |
| Research + Outline | Sequential | Parallel via `Promise.all` (outline uses gpt-4o JSON mode) |
| Streaming | No token streaming | Token-by-token streaming on `text-generator` and `pr-reviewer` stages |
| Retry | Not supported | Retry from any failed stage using saved intermediate outputs |
| Output | Educative editor blocks | Standalone HTML blog page |
| Publishing | Educative CMS | No publishing — renders at `/blogs/{slug}` |
| Storage | `data/blogs/` | `data/standalone/` + `data/standalone-images/` |
| URL | `/history/{id}` | `/blogs/{slug}` (SEO-friendly) |

### Pipeline stages

```
Topic Research ──┐
                 ├── (parallel, Promise.all) ──> Text Generator (streamed) ──> PR Reviewer (streamed)
JSON Outline   ──┘                                      │
                                                        ├──> Image Generation (parallel per image, gpt-image-2)
                                                        └──> Markdown → HTML → Done
```

### Stage order and retry

The pipeline defines `STAGE_ORDER` — a canonical list of stages used for retry-from-error:

```typescript
export const STAGE_ORDER = [
  'topic-research',    // parallel group with json-outline
  'json-outline',      // parallel group with topic-research
  'text-generator',    // streamed via generateTextStream
  'pr-reviewer',       // streamed via reviewTextStream
  'image-generation',  // parallel per image via gpt-image-2
  'markdown-to-html',  // synchronous, via marked
] as const;
```

When retrying from a stage (e.g. `pr-reviewer`), all earlier stages are skipped using saved `stageOutputs` from the blog record. The pipeline accepts `PipelineOptions`:

```typescript
interface PipelineOptions {
  startFromStage?: string;       // skip all stages before this one
  savedOutputs?: Record<string, any>;  // outputs from previously completed stages
}
```

### Image placeholder format

The standalone text generator outputs `[image]...[/image]` blocks with JSON:

```json
{
  "title": "Short, descriptive caption (displayed as figcaption)",
  "content": "Brief context from surrounding text (never rendered visually)",
  "illustration_idea": "Art-direction prompt for gpt-image-2"
}
```

During streaming, these blocks render as skeleton placeholders (shimmer animation). As each `gpt-image-2` call completes, the skeleton is replaced with the real image.

---

## LLM Client Layer

Defined in **`lib/ai.ts`**. Wraps LangChain chat models with a provider-agnostic interface.

### Exported functions

| Function | Provider | Purpose |
|----------|----------|---------|
| `generateText(prompt, opts?)` | Google Gemini | Standard text generation (`GEMINI_MODEL_DEFAULT`, default `gemini-2.5-flash`). Pass `model: TEXT_GENERATOR_MODEL` to pin to `gemini-2.5-pro` for heavy drafting. |
| `generateTextStream(prompt, onChunk, opts?)` | Google Gemini | Streaming text generation — calls `onChunk(chunk, accumulated)` per token |
| `reviewText(prompt, maxTokens?)` | Google Gemini | Review/critique (`GEMINI_MODEL_REVIEW`, default `gemini-2.5-flash`) |
| `reviewTextStream(prompt, onChunk, maxTokens?)` | Google Gemini | Streaming review |
| `TEXT_GENERATOR_MODEL` | const | Exported model id for the heavy text-generator stage (`gemini-2.5-pro` by default; `GEMINI_MODEL_TEXTGEN` overrides). |
| `openaiSearch(prompt)` | OpenAI | Web search via gpt-4o-search-preview |
| `openaiJSON(prompt, model?)` | OpenAI | JSON-mode output |
| `parseJsonLoose(s)` | — | Robust JSON parser (strips fences, finds first `{`/`[`) |

### Model caching

LangChain model instances are pooled by `(provider, model, maxTokens)` key to avoid reconnecting on every call.

### Streaming

`generateTextStream` and `reviewTextStream` use LangChain's `.stream()` method (against Gemini's streaming endpoint) to get token-by-token output. Both the standalone (`text-generator`, `pr-reviewer`) and the main blog (`text-generator`) pipelines emit throttled `stream` events (30ms throttle) to the SSE connection. `runManager` keeps only the latest payload per stage in memory and replays it once on subscribe — late re-attaches see the in-progress draft, not a flooded backlog.

### Abort propagation

`lib/abortContext.ts` uses `AsyncLocalStorage` to carry an `AbortSignal` through the entire pipeline call stack. API routes wrap the pipeline in `runWithAbort(signal, fn)`, and every LangChain `.invoke()` / `.stream()` call reads the signal via `getAbortSignal()`.

---

## Prompt System

### Three-layer architecture

1. **`lib/prompts.ts`** — Pure template functions. Each takes args and returns a prompt string. Also includes `lib/prompts.d2.ts` for D2 prompts and `standaloneTextGeneratorPrompt` for the standalone pipeline.

2. **`lib/promptsRegistry.ts`** — Wraps each template with `registerPrompt(name, fn, pipeline)`. The wrapped version checks disk for user edits before rendering. Each prompt is tagged with a pipeline (`outline`, `blog`, `standalone`, or `shared`).

3. **`lib/promptStore.ts`** — File-backed CRUD. On registration, uses a `Proxy` to capture `{{variable}}` placeholders from the template. User edits save to `data/prompts/{name}.json` with version history (max 30). Supports reset-to-default and rollback.

### Pipeline tags

Prompts are grouped by which pipeline uses them:

| Tag | Description | Examples |
|-----|-------------|---------|
| `shared` | Used by both Blog and Standalone | initial-topic-search, json-outline, zachgpt-review, pr-reviewer |
| `blog` | Blog pipeline only (widgets, Educative) | text-generator, code-generator, table-generator, image-enhancer, d2-generator |
| `standalone` | Standalone pipeline only | standalone-text-generator |
| `outline` | Outline pipeline | outline-search, outline-generator |

The `/prompts` page groups prompts by these tags with distinct accent colors.

### How prompt editing works

1. `registerPrompt(name, fn, pipeline)` runs the function with a Proxy arg to extract the template
2. The template body (with `{{var}}` placeholders) becomes editable in the UI
3. User edits are saved to `data/prompts/{name}.json` with versioning
4. On next pipeline call, the wrapped function loads the edited body and substitutes vars
5. Prompts with control-flow logic (e.g. `audienceVoiceGuidance`) can't be template-extracted and are marked code-only

### Adding a new prompt

1. Write the template function in `lib/prompts.ts`
2. Register it in `lib/promptsRegistry.ts`: `export const myPrompt = registerPrompt('my-prompt', P.myPrompt, 'blog');`
3. Import from `promptsRegistry` in your pipeline — never from `prompts.ts` directly

---

## Persona System

### Two-layer architecture

1. **`lib/personas.ts`** — 22 built-in persona definitions (name + voice prompt body)
2. **`lib/personaStore.ts`** — File-backed CRUD. Built-ins can be edited (override saved to disk) and reset. Custom personas can be created and deleted. The pipeline calls `getPersonaBody(name)` to get the active voice prompt.

### Adding a new built-in persona

1. Add name to `PERSONA_NAMES` array in `lib/personas.ts`
2. Add the `case` with the persona body in `getPersonaPrompt()` in the same file
3. It automatically appears in the persona dropdown and the /personas page

---

## Data Storage

All data lives in the `data/` directory (gitignored). No database required.

| Path | Contents | Manager |
|------|----------|---------|
| `data/blogs/{id}.json` | Full pipeline run record (original blog pipeline) | `lib/storage.ts` |
| `data/standalone/{id}.json` | Standalone blog record (slug, status, markdown, html, images) | `lib/standaloneStorage.ts` |
| `data/standalone-images/{blogId}-img{n}-{hex}.webp` | Generated images from gpt-image-2 | `lib/imageGen.ts` |
| `data/prompts/{name}.json` | User-edited prompt body + version history | `lib/promptStore.ts` |
| `data/personas/{slug}.json` | User-edited persona body overrides | `lib/personaStore.ts` |

### Standalone blog record (`StandaloneBlog`)

```typescript
interface StandaloneBlog {
  id: string;                    // internal ID (sa-{ts}-{hex})
  slug: string;                  // SEO-friendly URL slug (title-based + 6-char suffix)
  createdAt: string;
  updatedAt: string;
  status: 'running' | 'retrying' | 'draft' | 'failed' | 'cancelled';
  request: { vertical, blogTitle, persona, targetAudience, blogSummary, wordsLength, outline? };
  finalTitle?: string;
  markdown?: string;             // final markdown with images
  html?: string;                 // final HTML
  images?: string[];             // array of image URL paths
  stageOutputs?: Record<string, any>;  // output per stage (used for retry)
  stageLogs?: Record<string, any[]>;   // prompt/output logs per stage (debug panel)
  errorMessage?: string;
  failedStage?: string;          // which stage the pipeline was executing when it failed
}
```

The `retrying` status indicates a retry-in-progress (distinct from a fresh `running` run). The `failedStage` field records which stage caused the failure, enabling the "Retry from [stage]" feature.

### Slug generation

Slugs are generated from the blog title at creation time: lowercase, non-alphanumeric chars replaced with hyphens, truncated to 80 chars, with a 6-char random hex suffix for uniqueness. Example: `sustainable-living-for-crisis-resilience-a3f1b2`. The blog API resolves both slugs and internal IDs transparently.

---

## Run Manager & Abort

Two run managers with identical patterns:

- **`lib/runManager.ts`** — for original blog pipeline
- **`lib/standaloneRunManager.ts`** — for standalone pipeline (also generates slug)

### Key concepts

- **Detached runs**: The pipeline runs as a detached promise. Closing the browser tab unsubscribes from SSE but does NOT cancel the run.
- **Event buffering**: All emitted events are stored so a re-attaching client can replay the full history.
- **Throttled persistence**: Disk writes are coalesced to at most every 750ms to avoid thrashing.
- **Gate management**: Pipeline gates (like outline-review) create promises that `resumeRun()` resolves. (Standalone pipeline has no gates.)
- **Finished TTL**: Completed runs stay in memory for 60s so late re-attaches see terminal events.

### API

| Function | Purpose |
|----------|---------|
| `startBlogRun(input)` / `startStandaloneRun(input)` | Creates RunHandle, starts pipeline, returns handle |
| `retryStandaloneRun(blogId, fromStage)` | Load failed blog, reset status to `retrying`, re-run pipeline from `fromStage` using saved `stageOutputs` |
| `subscribe(id, listener)` / `subscribeStandalone(id, listener)` | Subscribe to live events, returns backlog + unsubscribe |
| `cancelRun(id)` / `cancelStandaloneRun(id)` | Abort a running pipeline |
| `resumeRun(id, gate, value?, edited?)` | Resume a paused pipeline gate (blog pipeline only) |
| `getRun(id)` / `getStandaloneRun(id)` | Get RunHandle by ID |
| `isLive(id)` / `isStandaloneLive(id)` | Check if run is still in-flight |
| `reconcileOrphan(id)` / `reconcileStandaloneOrphan(id)` | Mark stuck 'running'/'retrying' records as failed after server restart |

### Retry from error (standalone only)

When a pipeline fails, the run manager records `failedStage` (the stage that was executing when the error occurred) and saves all `stageOutputs` accumulated up to that point.

`retryStandaloneRun(blogId, fromStage)`:
1. Loads the existing blog record from disk
2. Validates status is `failed` or `cancelled`
3. Resets status to `retrying`, clears `errorMessage` and `failedStage`
4. Creates a fresh `RunHandle` keyed on the **same blog ID** (same URL continues to work)
5. Calls `runStandalonePipeline(input, emit, { startFromStage, savedOutputs })` 
6. Skipped stages emit their saved outputs instantly; the target stage and beyond run normally

The emit function is extracted into a shared `createEmit(handle)` helper used by both `startStandaloneRun` and `retryStandaloneRun`, which tracks `currentStage` for error attribution.

### RunHandle fields

```typescript
interface RunHandle {
  id: string;
  abort: AbortController;
  events: any[];           // all emitted events (backlog for late subscribers)
  subscribers: Set<Subscriber>;
  done: boolean;
  record: StandaloneBlog;
  pendingFlush: NodeJS.Timeout | null;
  lastFlushAt: number;
  gates: Map<string, GateResolver>;
  currentStage?: string;   // tracks which stage is running (for failedStage attribution)
}
```

---

## Widget System

The **original blog pipeline** supports four widget types embedded in article text via tags:

| Tag | Widget | Generator | Output |
|-----|--------|-----------|--------|
| `[code]...[/code]` | Code snippet | `codeGeneratorPrompt` → `generateText` | Educative Code block (v8.0 schema) |
| `[table]...[/table]` | Data table | `tableResearchPrompt` → `openaiSearch`, then `tableGeneratorPrompt` → `generateText` | Educative Table block (v2.0 schema) |
| `[image]...[/image]` (diagram) | D2 diagram | `imageEnhancerPrompt` → `d2GeneratorPrompt` → `generateText` → `generateD2Svg` | Educative D2Diagram block |
| `[image]...[/image]` (chart) | Chart.js chart | `imageEnhancerPrompt` → `chartjsGeneratorPrompt` → `generateText` | Educative Chart block |

The **standalone pipeline** does NOT use widgets — code and tables are rendered inline as markdown, and images use `gpt-image-2`.

### Widget flow (original pipeline only)

1. **Extract** (`transforms.extractWidgetTags`) — regex-finds all `[code]`, `[table]`, `[image]` tags in the seed draft
2. **Protect** — sentinel tokens replace tags in the editorial branch so ZachGPT/SEO don't mangle them
3. **Generate** — each widget tag is processed in parallel (code, table, image sub-branches)
4. **Merge** (`educative.mergeBlocks`) — walks the final cleaned HTML, replaces placeholders with generated editor blocks in extraction order

---

## Image Generation

Defined in **`lib/imageGen.ts`**. Used by the standalone pipeline only.

### How it works

1. `extractImageCards(draft)` — regex extracts `[image]...[/image]` blocks, parses JSON to get `title`, `content`, `illustration_idea`
2. `generateImage(card, order, blogId)` — calls OpenAI `gpt-image-2` API:
   - Model: `gpt-image-2`
   - Size: `1536x1024` (landscape)
   - Quality: `low`
   - Format: `webp` (60% compression)
   - Saves to `data/standalone-images/{blogId}-img{n}-{hex}.webp`
   - Returns URL path: `/api/standalone/images/{filename}`
3. `replaceImagePlaceholders(draft, imageUrls, cards?)` — replaces `[image]` blocks with `![alt](url)` markdown. The alt text comes from the card title (rendered as a centered figcaption by the `MarkdownImg` component). No duplicate italic caption is generated.

### Image serving

`GET /api/standalone/images/[filename]` serves webp files from `data/standalone-images/` with `Cache-Control: public, max-age=31536000, immutable`.

---

## Educative Publishing

**`lib/educative.ts`** handles the full Educative CMS integration (original pipeline only):

1. `markdownToHtml(md)` — converts markdown to HTML (marked with GFM)
2. `structureOutput(html)` — passthrough (preserved for n8n parity)
3. `sanitizeAndFormat(args)` — transforms quotes/dashes, wraps image placeholders, extracts title
4. `makeCodeBlock(payload)` / `makeTableBlock(payload)` / `makeD2Block(d2Code, caption, svgUrl)` / `makeChartBlock(config, caption)` — Educative block factories
5. `mergeBlocks(args)` — fan-in: combines cleanedHtml + widget blocks into final block array
6. `createBlog()` — POST to Educative API to create a new blog page
7. `uploadBlog(args)` — PUT to Educative API with the full block payload
8. `generateD2Svg(d2Code, compId)` — POST to Educative D2 renderer, returns SVG URL

---

## Frontend Components

### Shared Components (`app/_components/`)

| Component | Purpose |
|-----------|---------|
| `Field` | Form field wrapper with label and optional hint text |
| `NavLinks` | Navigation bar with links: Home, Outline, Blog, Standalone, Blogs. Auth-aware: unauthenticated clicks trigger sign-in |
| `Stages` | Pipeline progress card. Collapses widget/image sub-stages into one row. Shows running/done/error status |
| `StageOutputs` | Tabbed inspector for pipeline stage data. Supports content view (markdown/JSON/text auto-detect) and logs view |
| `SessionWrapper` | Client-side `<SessionProvider>` wrapper (needed because root layout is a Server Component) |
| `ThemeToggle` | Dark/light theme toggle. Persists to localStorage |
| `UserMenu` | Auth UI: "Sign in" button when unauthenticated, avatar dropdown with sign-out + admin links (History, Graph, Prompts, Personas) when authenticated |

### Stage labels

Human-friendly stage names are defined in `Stages.tsx` (`STAGE_LABELS` / `PRETTY` map). Add an entry there when creating a new pipeline stage.

---

## Blog Reader & Streaming

The blog reader at `/blogs/[slug]` handles static viewing, live streaming, error display, and retry.

### Five phases

| Phase | Trigger | UI |
|-------|---------|-----|
| **Loading** | Initial page load | Loading card |
| **Hints** | Blog status is `running` or `retrying`, SSE connected | 8 cycling strikethrough messages (3s interval): "Searching the web…", "Analyzing top-ranking articles…", etc. |
| **Streaming** | `text-generator` or `pr-reviewer` starts emitting `stream` events | Live markdown rendering (ReactMarkdown), `[image]` blocks shown as skeleton cards |
| **Content** | `stream-content` event received (post-editorial, pre-images) | Near-final markdown with skeleton placeholders that replace one-by-one as images generate |
| **Done** | `final` event received | Complete blog with TOC sidebar, code windows, image captions |
| **Error** | Pipeline failed or cancelled | Error banner with message; admin retry button; debug panel |

### SSE connection lifecycle

The SSE subscription is driven by a `sseTarget` state (set once when blog loads as `running`/`retrying`). Phase changes do NOT tear down the SSE connection — this is critical for streaming to work. The `sseGeneration` counter ensures retries get fresh connections.

**Backlog handling**: When subscribing to an in-progress run, the server sends all previously emitted events as a burst (backlog). The client detects this burst and skips incremental rendering of `stream` events during backlog replay — only the final accumulated text is applied. This prevents the "dump all at once" effect that would destroy the streaming experience.

**SSE 404 fallback**: If the run finished and was cleaned up before the client connects (TTL expired or server restarted), the SSE endpoint returns 404. The client then re-fetches the blog record to get the actual final state, preventing the "stuck on IN PROGRESS" bug.

### TOC sidebar

- Extracted from markdown headings (h1, h2) via regex
- Fixed sidebar on the left (260px) on `xl` screens, hidden on mobile
- Active heading highlighted via `IntersectionObserver` as user scrolls
- Headings get `id` attributes for anchor linking
- Reading progress bar at bottom of TOC (done phase only)
- Header, error banner, and debug panel shift right (`xl:pl-[284px]`) when TOC is visible

### Skeleton placeholders

During streaming, `[image]...[/image]` blocks are replaced with skeleton HTML:
- Dashed border card (260px height)
- Image icon + shimmer animation
- Title from the JSON block displayed as label
- CSS: `.skeleton-image`, `.skeleton-shimmer` in `globals.css`

### Code windows

Fenced code blocks render with macOS-style window chrome (red/yellow/green dots), monospace font, scrollable body (max-height 600px). The `MarkdownPre` component detects already-wrapped content to prevent nesting. CSS: `.code-window`, `.code-window-bar`, `.code-window-dot`, `.code-window-body`.

### Image captions

Images render in `<figure>` with `<figcaption>`. The alt text from `![alt](url)` becomes the caption (via the `MarkdownImg` component). The `replaceImagePlaceholders` function outputs `![image](url)` — no duplicate italic caption below.

### Debug panel (admin only)

Available for completed, failed, and cancelled blogs. Shows:
- Accordion per pipeline stage with prompt and output (truncated to 2000 chars)
- Green dot for successful stages, red dot + "(failed here)" label for the failed stage
- "Retry from [stage]" button when `failedStage` is set

### Retry from error (admin only)

When a blog fails, admins see a retry button in the error banner, debug panel, and failed-state card. Clicking it:
1. POSTs to `/api/standalone/{id}/retry` with `{ fromStage }`
2. Resets UI to hints phase, starts hint cycling
3. Increments `sseGeneration` and sets a new `sseTarget` to establish a fresh SSE connection
4. The pipeline runs from the failed stage, streaming new content to the blog reader

### Auto-updating

The All Blogs page (`/blogs`) polls every 5 seconds when any blog has `running` or `retrying` status, so status changes (in-progress → completed, failed) appear without manual refresh.

---

## API Routes

All routes are in `app/api/`. Protected by middleware (require auth), except `/api/auth/*`.

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET/POST | `/api/auth/[...nextauth]` | NextAuth | OAuth flow |
| POST | `/api/blog` | `startBlogRun` → SSE | Start blog pipeline, stream events |
| POST | `/api/blog/[id]/cancel` | `cancelRun` | Abort running pipeline |
| POST | `/api/blog/[id]/resume` | `resumeRun` | Resume paused gate (outline review) |
| GET | `/api/blog/[id]/stream` | `subscribe` → SSE | Re-attach to live run |
| POST | `/api/standalone` | `startStandaloneRun` → SSE | Start standalone pipeline (meta event has slug for redirect) |
| POST | `/api/standalone/[id]/cancel` | `cancelStandaloneRun` | Abort running standalone pipeline |
| POST | `/api/standalone/[id]/retry` | `retryStandaloneRun` | Retry failed pipeline from a specific stage |
| GET | `/api/standalone/[id]/subscribe` | `subscribeStandalone` → SSE | SSE stream for blog reader page |
| GET | `/api/standalone/blogs` | `listStandalone` | List all standalone blogs (with orphan reconciliation) |
| GET/DELETE | `/api/standalone/blogs/[id]` | `resolve` (id or slug) | Get or delete a standalone blog |
| GET | `/api/standalone/images/[filename]` | static file serve | Serve generated webp images |
| POST | `/api/outline` | inline pipeline → SSE | Run outline pipeline, stream events |
| GET | `/api/history` | `listBlogs` | List all saved runs (original pipeline) |
| GET/DELETE | `/api/history/[id]` | `getBlog`/`deleteBlog` | Get or delete a run |
| POST | `/api/publish` | `createBlog` + `uploadBlog` | Publish to Educative CMS |
| GET | `/api/personas` | `listPersonas` | List all personas |
| POST | `/api/personas` | `createPersona` | Create new persona |
| GET/PUT/DELETE | `/api/personas/[slug]` | CRUD | Single persona operations |
| GET | `/api/prompts` | `listPrompts` | List all registered prompts (includes pipeline tag) |
| GET/PUT | `/api/prompts/[name]` | CRUD | Get/edit prompt, reset, rollback |

---

## Pages

| Path | Access | Purpose |
|------|--------|---------|
| `/` | Public | Home page — task selector showing pipeline overview |
| `/auth/signin` | Public | Google sign-in page |
| `/auth/error` | Public | Auth error page |
| `/outline` | Protected | Outline generator form + streaming results |
| `/blog` | Protected | Full blog generator form + streaming results + outline review popup + publish |
| `/standalone` | Protected | Standalone blog generator form — redirects to `/blogs/{slug}` on submit |
| `/blogs` | Protected | Gallery of standalone blogs (tile layout, delete, status labels) |
| `/blogs/[slug]` | Protected | Blog reader: live streaming with hints/skeletons, TOC sidebar, code windows, image captions |
| `/history` | Admin | List of all original pipeline runs with filters |
| `/history/[id]` | Admin | Detail view of a single run (all stage outputs, re-publish) |
| `/graph` | Admin | Interactive DAG visualization of all 3 pipelines (outline, blog, standalone) |
| `/prompts` | Admin | Prompt templates grouped by pipeline (Shared, Blog, Standalone, Outline) |
| `/prompts/[name]` | Admin | Prompt template editor with version history |
| `/personas` | Admin | List of all personas (built-in + custom) |
| `/personas/[slug]` | Admin | Persona voice prompt editor |

---

## Pipeline Graph Visualization

**`lib/pipelineGraph.ts`** defines a declarative graph for each pipeline. The `/graph` page renders these as interactive top-down DAGs.

Three graphs are defined:
- **Outline pipeline** (`outlineGraph`) — 4 nodes, 3 edges
- **Blog pipeline** (`blogGraph`) — 25+ nodes, complex branching
- **Standalone pipeline** (`standaloneGraph`) — 18 nodes, linear editorial + image generation

### Adding a new stage to the graph

1. Add a `GraphNode` with `id` matching the `emit({ type:'stage', name })` value in the pipeline
2. Set `rank` (depth from top, 0-based) and `lane` (column, 0=center, negative=left, positive=right)
3. Connect with `GraphEdge` entries. Use `when` for conditional labels.
4. The graph page auto-renders the new node on reload.

### Agent kinds (node coloring)

`openai-search`, `gemini-text`, `gemini-review`, `transform`, `http`, `fanout`, `terminal`

---

## Key Patterns & Conventions

### SSE streaming

All pipeline-running API routes use Server-Sent Events. The pattern:
- Server: `ReadableStream` → `controller.enqueue(enc.encode('data: ${JSON.stringify(evt)}\n\n'))`
- Client: `fetch` → `reader.read()` loop → parse `data: ` lines → update React state

### LLM streaming

The standalone pipeline uses token-by-token streaming for `text-generator` and `pr-reviewer` stages:
- Server: `generateTextStream()` / `reviewTextStream()` with `onChunk` callback
- Chunks are throttled (30ms) for near-real-time streaming feel
- Client: `stream` events update `streamMarkdown` state → re-rendered by ReactMarkdown
- Backlog detection: when SSE replays buffered events, `stream` events are collected but not rendered incrementally — only the final accumulated text is applied, then live events stream normally

### File-backed persistence

No database. All data is JSON files in `data/`. Writes use atomic rename (`write .tmp` → `rename`).

### Provider abstraction

`lib/ai.ts` wraps the Google Gemini provider. Pipeline code never touches provider-specific APIs — it calls `generateText()`, `reviewText()`, `openaiSearch()`. The helpers are deliberately provider-agnostic so swapping the underlying provider is a one-file change.

### Widget sentinel protection (original pipeline)

Before editorial passes (ZachGPT, SEO, PR reviewer), widget tags are replaced with `WIDGETSENTINEL{n}TOKEN` strings. After editorial passes, sentinels are restored.

### Slug-based URLs

Standalone blogs use SEO-friendly slug URLs (`/blogs/{slug}`). The API resolves both slugs and internal IDs, so SSE subscribe (which needs the internal ID) and page fetch (which uses the slug) both work through the same endpoint.

### Path alias

`tsconfig.json` defines `@/*` → `./*`, so imports like `@/lib/auth` resolve to `./lib/auth.ts`.

---

## Common Tasks

### Add a new prompt template

1. Write `export function myPrompt(args: { ... }): string { ... }` in `lib/prompts.ts`
2. Register: `export const myPrompt = registerPrompt('my-prompt', P.myPrompt, 'blog');` in `lib/promptsRegistry.ts`
3. Import from `promptsRegistry` in your pipeline
4. The prompt automatically appears in the /prompts UI grouped under its pipeline tag

### Add a new persona

1. Add name to `PERSONA_NAMES` in `lib/personas.ts`
2. Add the persona body in `getPersonaPrompt()` switch/case
3. Auto-appears in dropdowns and /personas page

### Add a new API route

1. Create `app/api/{path}/route.ts`
2. It's automatically protected by `middleware.ts` (no per-route auth needed)
3. Export `GET`, `POST`, `PUT`, or `DELETE` handlers

### Add a new page

1. Create `app/{path}/page.tsx`
2. Add to `items` array in `app/_components/NavLinks.tsx` for navigation
3. It's automatically protected by `middleware.ts`

### Change the allowed email domain

Set `ALLOWED_DOMAIN` in `.env.local`. Empty string = allow all domains.

### Change admin accounts

Set `ADMIN_EMAILS` in `.env.local` as a comma-separated list (e.g. `a@co.com,b@co.com`). Admin users see admin links in the profile dropdown and get access to History, Graph, Prompts, and Personas pages. Non-admin authenticated users see Home, Outline, Blog, Standalone, and Blogs. The middleware enforces this at both the page and API level.

### Debug a pipeline run

1. For original pipeline: open `/history` and click into the run, use stage output tabs
2. For standalone pipeline: open `/blogs/{slug}` — if live, watch streaming; if done, view final output
3. Click the **Debug** button (admin only) to see an accordion of all pipeline stages with prompt/output logs
4. Failed stages show a red dot and "(failed here)" label
5. Server console also shows `[stage:name]` / `[standalone:name]` trace logs

### Retry a failed standalone blog

1. Open the failed blog at `/blogs/{slug}`
2. The error banner shows the error message and a "Retry from [stage]" button (admin only)
3. The Debug panel also has a retry button at the top
4. Clicking retry calls `POST /api/standalone/{id}/retry` with `{ fromStage }`
5. The pipeline re-runs from the failed stage, reusing saved intermediate outputs from `stageOutputs`
6. The blog page streams the new content in real-time via a fresh SSE connection

### Add a new pipeline stage

1. Add the LLM call + `emit()` calls in `lib/pipeline.ts` or `lib/standalonePipeline.ts`
2. For standalone: add the stage name to `STAGE_ORDER` in `lib/standalonePipeline.ts` and add skip/run conditional
3. Add a stage label in `app/_components/Stages.tsx` (`PRETTY` map)
4. Add a node + edges in `lib/pipelineGraph.ts`
5. If the stage uses a new prompt, create it in `lib/prompts.ts` and register in `lib/promptsRegistry.ts`
