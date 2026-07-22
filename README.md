# Educative AI Content Studio

An internal Next.js tool for generating persona-driven blogs, newsletters, course lessons, and mobile courses via multi-stage AI pipelines. Features real-time streaming, parallel image generation, and direct publishing to Educative CMS.

## Clone the repo

```bash
git clone https://github.com/yasir-educative/educative-ai-content-studio.git
cd educative-ai-content-studio
```

## Run locally

```bash
cp .env.example .env.local   # fill in your API keys (see below)
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — no login required.

## Required environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Google Gemini — drives all text generation and review stages |
| `OPENAI_API_KEY` | OpenAI — used for web research (`gpt-4o-search-preview`) |
| `EDUCATIVE_FLASK_AUTH` | Cookie value for Educative CMS publishing (blog/newsletter) |
| `EDUCATIVE_COURSE_FLASK_AUTH` | Cookie value for course/collection API |
| `EDUCATIVE_AUTHOR_ID` | Your Educative author ID |

Optional model overrides (defaults shown):

```
GEMINI_MODEL_DEFAULT=gemini-2.5-flash
GEMINI_MODEL_REVIEW=gemini-2.5-flash
GEMINI_MODEL_TEXTGEN=gemini-2.5-pro
OPENAI_SEARCH_MODEL=gpt-4o-search-preview
```

## What's inside

| Tool | Route | Description |
|---|---|---|
| Blogs | `/blogs` | Generate and publish long-form technical blogs |
| Newsletter | `/newsletter` | AI-drafted newsletters with persona voice |
| Course | `/course` | Full course lesson generation from Educative collections |
| Mobile | `/mobile-course` | Flash-card mobile courses and bite-sized shorts |
| Pipeline Graph | `/graph` | Visual DAG of every pipeline stage |
| Personas | `/personas` | Manage author voice personas |
| Prompts | `/prompts` | Edit prompt templates for every pipeline stage |

## Hosting notes

Vercel's 60s function timeout won't hold the longer pipelines. Recommended alternatives:

- **Railway** — supports long-running Node processes
- **Render** — `npm run build && npm start`
- **Fly.io** — `fly launch` with Next.js preset
- **Local + Cloudflare Tunnel** — run locally, expose via `cloudflared`
