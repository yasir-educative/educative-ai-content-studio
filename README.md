# Persona Blogs

A self-hosted Next.js platform for generating persona-driven, long-form articles via multi-stage AI pipelines. Features real-time streaming, parallel image generation, and an admin debug/retry system.

## Two pipelines

1. **Outline Generator** — web research + structured outline draft.
2. **Educative Blog Generator** — the original n8n-ported pipeline with widgets, D2 diagrams, Chart.js, and Educative CMS publishing.
3. **Custom Blog Generator** — a streamlined pipeline: research + outline (parallel) → streamed text generation → editorial polish → parallel AI image generation → final HTML.

All 22 persona voices are included. Prompts are editable via the admin UI.

## Run locally

```bash
cp .env.example .env.local   # fill in keys
npm install
npm run dev
```

Open http://localhost:3000.

## Required env

- `GEMINI_API_KEY` — for Google Gemini. Drives every `generateText` / `reviewText` / `generateTextStream` / `reviewTextStream` call.
- `OPENAI_API_KEY` — for `gpt-4o-search-preview` web research, `gpt-4o` JSON outline, and `gpt-image-2` image generation.

Optional overrides:

- `GEMINI_MODEL_DEFAULT` (default `gemini-2.5-flash`) — used everywhere except heavy drafting
- `GEMINI_MODEL_REVIEW` (default `gemini-2.5-flash`) — review/critique stages
- `GEMINI_MODEL_TEXTGEN` (default `gemini-2.5-pro`) — heavy drafting (text-generator stage, both main + custom blog)
- `OPENAI_SEARCH_MODEL` (default `gpt-4o-search-preview`)

## Custom Blog pipeline

```
Topic Research ──┐
                 ├── (parallel) ──> Text Generator (streamed) ──> PR Reviewer (streamed)
JSON Outline   ──┘                         │
                                           ├──> Image Generation (parallel per image)
                                           └──> Markdown → HTML → Done
```

- **Research + Outline** run in parallel via `Promise.all` (research uses OpenAI search, outline uses gpt-4o JSON mode)
- **Text generator** streams token-by-token via LangChain `.stream()` through SSE to the blog reader
- **PR reviewer** applies editorial polish, also streamed
- **Images** generated in parallel via `gpt-image-2`, replacing skeleton placeholders progressively
- **Retry from error** — if a stage fails, admins can retry from the failed stage, reusing saved intermediate outputs

## Key features

- **Real-time streaming** — blog content streams token-by-token like LLM responses
- **TOC sidebar** — auto-generated from headings, with scroll-tracking and reading progress
- **Code windows** — macOS-style terminal chrome for fenced code blocks
- **Image generation** — `gpt-image-2` produces portrait mobile-friendly illustrations
- **Debug panel** — admin-only accordion showing prompt/output per pipeline stage
- **Retry from error** — failed blogs can be retried from the exact stage that failed
- **Auto-updating UI** — blog list polls for status changes; blog reader auto-refreshes on completion
- **Dark/light theme** — system-aware with manual toggle

## File map

| Path | Purpose |
|------|---------|
| `lib/ai.ts` | LangChain LLM wrappers (Google Gemini + OpenAI), streaming support |
| `lib/pipeline.ts` | Outline + Educative blog pipeline orchestration |
| `lib/standalonePipeline.ts` | Custom blog pipeline with `STAGE_ORDER` and retry support |
| `lib/standaloneRunManager.ts` | Run lifecycle, SSE broadcast, retry from failed stage |
| `lib/standaloneStorage.ts` | File-backed blog CRUD (slug, status, failedStage) |
| `lib/imageGen.ts` | gpt-image-2 generation, extraction, placeholder replacement |
| `lib/promptsRegistry.ts` | Editable prompt templates with pipeline tags |
| `lib/personaStore.ts` | 22 built-in + custom persona voices |
| `app/standalone/page.tsx` | Custom blog generator form |
| `app/blogs/page.tsx` | All Blogs gallery (auto-refreshing) |
| `app/blogs/[slug]/page.tsx` | Blog reader: streaming, TOC, debug, retry |
| `app/api/standalone/[id]/retry/route.ts` | POST: retry pipeline from failed stage |

## Free hosting

Vercel's 60s function limit won't hold these pipelines. Recommended:

- **Railway** — supports long-running Node processes
- **Render** — `npm run build && npm start`
- **Fly.io** — `fly launch` with Next.js preset
- **Local + Cloudflare Tunnel** — `npm start` locally, expose via `cloudflared`
