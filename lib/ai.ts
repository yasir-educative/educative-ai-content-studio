// LLM client layer. Exposes provider-agnostic helpers so the orchestrator (pipeline.ts /
// standalonePipeline.ts) doesn't depend on a specific vendor SDK. The current backend is Google
// Gemini via LangChain's ChatGoogleGenerativeAI; swapping providers is a one-file change.
//
// Public API:
//   - generateText / generateTextStream  → drafting & rewriting (default model)
//   - reviewText   / reviewTextStream    → review/critique passes
//   - openaiSearch / openaiJSON          → OpenAI-only helpers (web search, JSON-mode)
//   - parseJsonLoose                     → tolerant JSON extractor for LLM outputs
//
// Model selection:
//   - Default / review / streaming → gemini-2.5-flash
//   - Text-generator stage         → gemini-2.5-pro (callers pass `model: TEXT_GENERATOR_MODEL`)
// Both are overridable via env (GEMINI_MODEL_DEFAULT / GEMINI_MODEL_REVIEW / GEMINI_MODEL_TEXTGEN).

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { jsonrepair } from 'jsonrepair';
import { getAbortSignal } from './abortContext';

const GEMINI_DEFAULT = process.env.GEMINI_MODEL_DEFAULT || 'gemini-2.5-flash';
const GEMINI_REVIEW = process.env.GEMINI_MODEL_REVIEW || 'gemini-2.5-flash';
// Exposed so pipeline.ts can pin the heavy text-generator stage to 2.5-pro without ai.ts needing
// stage-aware logic.
export const TEXT_GENERATOR_MODEL = process.env.GEMINI_MODEL_TEXTGEN || 'gemini-2.5-pro';
const OPENAI_SEARCH = process.env.OPENAI_SEARCH_MODEL || 'gpt-4o-search-preview';

// Cache LangChain chat model instances by (provider, model, maxTokens). Construction is cheap
// but pooling avoids reconnecting HTTP clients on every prompt.
type ChatModel = ChatGoogleGenerativeAI | ChatOpenAI;
const modelCache = new Map<string, ChatModel>();

// gemini-2.5-pro is a thinking-required model — thinkingBudget: 0 causes a 400 error.
// Flash models support noThinking (budget=0) to avoid consuming output tokens on reasoning.
const THINKING_REQUIRED_MODELS = ['gemini-2.5-pro'];

function buildGemini(model: string, maxTokens: number, noThinking = false): ChatGoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const isThinkingRequired = THINKING_REQUIRED_MODELS.some((m) => model.includes(m));
  return new ChatGoogleGenerativeAI({
    apiKey,
    model,
    maxOutputTokens: maxTokens,
    maxRetries: 3,
    // Disable thinking for long-form rewrite tasks: Gemini 2.5 Flash thinking tokens count
    // against maxOutputTokens, so a complex prompt can consume ~13k tokens on thinking alone,
    // leaving only ~3k for actual blog content and causing severe output truncation.
    // Skip for Pro models — they require thinking mode and reject thinkingBudget: 0.
    ...(noThinking && !isThinkingRequired ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
  });
}

function buildOpenAI(model: string): ChatOpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  // gpt-4o-search-preview rejects temperature, so omit it. Other models accept the default.
  return new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model,
    maxRetries: 3,
  });
}

function getGeminiModel(model: string, maxTokens: number, noThinking = false): ChatGoogleGenerativeAI {
  const key = `gemini|${model}|${maxTokens}|${noThinking}`;
  let m = modelCache.get(key) as ChatGoogleGenerativeAI | undefined;
  if (!m) {
    m = buildGemini(model, maxTokens, noThinking);
    modelCache.set(key, m);
  }
  return m;
}

function getOpenAIModel(model: string): ChatModel {
  const key = `openai|${model}`;
  let m = modelCache.get(key);
  if (!m) {
    m = buildOpenAI(model);
    modelCache.set(key, m);
  }
  return m;
}

function extractText(content: BaseMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === 'string' ? c : c?.type === 'text' ? c.text : ''))
      .filter(Boolean)
      .join('');
  }
  return '';
}

export async function generateText(
  prompt: string,
  opts: { model?: string; maxTokens?: number; system?: string; noThinking?: boolean } = {},
): Promise<string> {
  const maxTokens = opts.maxTokens || 16000;
  const model = opts.model || GEMINI_DEFAULT;
  const chat = getGeminiModel(model, maxTokens, opts.noThinking);
  const messages: BaseMessage[] = [];
  if (opts.system) messages.push(new SystemMessage(opts.system));
  messages.push(new HumanMessage(prompt));
  const res = await chat.invoke(messages, { signal: getAbortSignal() });
  return extractText(res.content);
}

export async function generateTextStream(
  prompt: string,
  onChunk: (chunk: string, accumulated: string) => void,
  opts: { model?: string; maxTokens?: number; system?: string; noThinking?: boolean } = {},
): Promise<string> {
  const maxTokens = opts.maxTokens || 16000;
  const model = opts.model || GEMINI_DEFAULT;
  const chat = getGeminiModel(model, maxTokens, opts.noThinking);
  const messages: BaseMessage[] = [];
  if (opts.system) messages.push(new SystemMessage(opts.system));
  messages.push(new HumanMessage(prompt));

  let accumulated = '';
  const stream = await chat.stream(messages, { signal: getAbortSignal() });
  for await (const chunk of stream) {
    const text = extractText(chunk.content);
    if (text) {
      accumulated += text;
      onChunk(text, accumulated);
    }
  }
  return accumulated;
}

export async function reviewText(prompt: string, maxTokens = 16000, noThinking = false): Promise<string> {
  return generateText(prompt, { model: GEMINI_REVIEW, maxTokens, noThinking });
}

export async function reviewTextStream(
  prompt: string,
  onChunk: (chunk: string, accumulated: string) => void,
  maxTokens = 16000,
): Promise<string> {
  return generateTextStream(prompt, onChunk, { model: GEMINI_REVIEW, maxTokens });
}

export async function openaiSearch(prompt: string): Promise<string> {
  const chat = getOpenAIModel(OPENAI_SEARCH);
  const res = await chat.invoke([new HumanMessage(prompt)], { signal: getAbortSignal() });
  return extractText(res.content);
}

export async function openaiJSON(prompt: string, model = 'gpt-4o'): Promise<string> {
  // Dedicated cached instance with response_format pinned to json_object.
  const key = `openai-json|${model}`;
  let chat = modelCache.get(key) as ChatOpenAI | undefined;
  if (!chat) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    chat = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model,
      maxRetries: 3,
      modelKwargs: { response_format: { type: 'json_object' } },
    });
    modelCache.set(key, chat);
  }
  const res = await chat.invoke([new HumanMessage(prompt)], { signal: getAbortSignal() });
  return extractText(res.content);
}

// Replace literal control characters (newlines, tabs, carriage returns) inside JSON
// string values with their escape equivalents. The AI sometimes breaks long outline
// fields across multiple lines; those literal newlines make JSON.parse fail and
// confuse jsonrepair's state machine, causing spurious "Colon expected" errors.
function escapeControlCharsInStrings(str: string): string {
  const out: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = ch.charCodeAt(0);
    if (escaped) { out.push(ch); escaped = false; continue; }
    if (ch === '\\' && inString) { out.push(ch); escaped = true; continue; }
    if (ch === '"') { inString = !inString; out.push(ch); continue; }
    if (inString) {
      if (code === 0x0a) { out.push('\\n'); continue; }
      if (code === 0x0d) { out.push('\\r'); continue; }
      if (code === 0x09) { out.push('\\t'); continue; }
      if (code < 0x20) continue;
    }
    out.push(ch);
  }
  return out.join('');
}

export function parseJsonLoose<T = any>(s: string): T {
  if (!s) throw new Error('empty json string');
  let str = s.trim();
  if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  const firstBrace = str.indexOf('{');
  const firstBracket = str.indexOf('[');
  let start = -1;
  if (firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)) start = firstBrace;
  else if (firstBracket >= 0) start = firstBracket;
  if (start > 0) str = str.slice(start);
  const lastBrace = str.lastIndexOf('}');
  const lastBracket = str.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);
  if (end > 0 && end < str.length - 1) str = str.slice(0, end + 1);
  try {
    return JSON.parse(str);
  } catch {
    const fixed = escapeControlCharsInStrings(str);
    try {
      return JSON.parse(fixed);
    } catch {
      return JSON.parse(jsonrepair(fixed));
    }
  }
}
