// LLM client layer. Exposes provider-agnostic helpers so the orchestrator (pipeline.ts /
// standalonePipeline.ts) doesn't depend on a specific vendor SDK. Backend: OpenAI via LangChain.
//
// Public API:
//   - generateText / generateTextStream  → drafting & rewriting (default model)
//   - reviewText   / reviewTextStream    → review/critique passes
//   - openaiSearch / openaiJSON          → web search, JSON-mode
//   - parseJsonLoose                     → tolerant JSON extractor for LLM outputs
//
// Model selection (all via Chat Completions API):
//   - Default / review / streaming → OPENAI_MODEL_DEFAULT (gpt-4o)
//   - Text-generator stage         → OPENAI_MODEL_TEXTGEN  (gpt-4o, override via env)
// Override via OPENAI_MODEL_DEFAULT / OPENAI_MODEL_TEXTGEN env vars.

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { jsonrepair } from 'jsonrepair';
import { getAbortSignal } from './abortContext';

const OPENAI_DEFAULT = process.env.OPENAI_MODEL_DEFAULT || 'gpt-5.4';
export const TEXT_GENERATOR_MODEL = process.env.OPENAI_MODEL_TEXTGEN || 'gpt-5.4';
export const OPENAI_LIGHT = process.env.OPENAI_MODEL_LIGHT || 'gpt-4o';
const OPENAI_SEARCH = process.env.OPENAI_SEARCH_MODEL || 'gpt-5-search-api';

const modelCache = new Map<string, ChatOpenAI>();

function getOpenAIModel(model: string): ChatOpenAI {
  let m = modelCache.get(model);
  if (!m) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    m = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY, model, maxRetries: 3 });
    modelCache.set(model, m);
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
  const model = opts.model || OPENAI_DEFAULT;
  const messages: BaseMessage[] = [];
  if (opts.system) messages.push(new SystemMessage(opts.system));
  messages.push(new HumanMessage(prompt));
  const res = await getOpenAIModel(model).invoke(messages, { signal: getAbortSignal() });
  return extractText(res.content);
}

export async function generateTextStream(
  prompt: string,
  onChunk: (chunk: string, accumulated: string) => void,
  opts: { model?: string; maxTokens?: number; system?: string; noThinking?: boolean } = {},
): Promise<string> {
  const model = opts.model || OPENAI_DEFAULT;
  const messages: BaseMessage[] = [];
  if (opts.system) messages.push(new SystemMessage(opts.system));
  messages.push(new HumanMessage(prompt));

  let accumulated = '';
  const stream = await getOpenAIModel(model).stream(messages, { signal: getAbortSignal() });
  for await (const chunk of stream) {
    const text = extractText(chunk.content);
    if (text) { accumulated += text; onChunk(text, accumulated); }
  }
  return accumulated;
}

export async function reviewText(prompt: string, maxTokens = 16000, _noThinking = false): Promise<string> {
  return generateText(prompt, { model: OPENAI_DEFAULT, maxTokens });
}

export async function reviewTextStream(
  prompt: string,
  onChunk: (chunk: string, accumulated: string) => void,
  maxTokens = 16000,
): Promise<string> {
  return generateTextStream(prompt, onChunk, { model: OPENAI_DEFAULT, maxTokens });
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
