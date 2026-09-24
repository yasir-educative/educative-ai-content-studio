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

Copy `.env.example` to `.env.local` and fill in every value. See `.env.example` for full instructions on how to obtain each one.

### AI

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | **Yes** | Drives all text generation, outlines, and web research |

### Google OAuth (sign-in)

| Variable | Required | Description |
|---|---|---|
| `NEXTAUTH_SECRET` | **Yes** | Random secret for signing JWT sessions — run `openssl rand -base64 32` |
| `NEXTAUTH_URL` | **Yes** | Base URL of the app, e.g. `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` | **Yes** | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | **Yes** | OAuth 2.0 client secret |
| `ALLOWED_DOMAIN` | No | Restrict login to one domain, e.g. `educative.io` |
| `ADMIN_EMAILS` | No | Comma-separated emails that get admin access |

### Educative publishing (Mobile Shorts & Mobile Course)

| Variable | Required | Description |
|---|---|---|
| `EDUCATIVE_FLASK_AUTH` | **Yes** | `flask-auth` cookie value from your Educative browser session |
| `EDUCATIVE_COURSE_FLASK_AUTH` | **Yes** | `flask-auth` cookie for the SD Path / collection API |
| `EDUCATIVE_AUTHOR_ID` | **Yes** | Your numeric Educative author ID |
| `NEXT_PUBLIC_EDUCATIVE_AUTHOR_ID` | **Yes** | Same value — exposed to browser for the Mobile Course UI |
| `EDUCATIVE_TEMPLATE_ID` | No | Template collection ID (defaults to `5002`) |
| `EDUCATIVE_D2_PATH` | No | Server-side D2 diagram endpoint path |

### Google Sheets (bulk Mobile Shorts write-back)

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | No | Full service account JSON as a single-line string |

### Optional model overrides (defaults shown)

```
OPENAI_MODEL_DEFAULT=gpt-5.4
OPENAI_MODEL_TEXTGEN=gpt-5.4
OPENAI_MODEL_LIGHT=gpt-5.4-mini
OPENAI_SEARCH_MODEL=gpt-5-search-api
```

> **Node.js version:** 20 or later is required.

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
