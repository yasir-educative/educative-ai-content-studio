// LLM client layer. Exposes provider-agnostic helpers so the orchestrator (pipeline.ts /
// standalonePipeline.ts) doesn't depend on a specific vendor SDK.
// Backend: OpenAI Responses API (supports gpt-5.4, luna, terra, and all future models).
//
// Public API:
//   - generateText / generateTextStream  → drafting & rewriting (default model)
//   - reviewText   / reviewTextStream    → review/critique passes
//   - openaiSearch / openaiJSON          → web search, JSON-mode
//   - parseJsonLoose                     → tolerant JSON extractor for LLM outputs
//
// Model selection (all via Responses API):
//   - Default / review / streaming → OPENAI_MODEL_DEFAULT env var (default: gpt-5.4)
//   - Text-generator stage         → OPENAI_MODEL_TEXTGEN  env var (default: gpt-5.4)
//   - Light / fast calls           → OPENAI_MODEL_LIGHT    env var (default: gpt-5.4-mini)
//   - Web search                   → OPENAI_SEARCH_MODEL   env var (default: gpt-5-search-api)

import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import { getAbortSignal } from './abortContext';

const OPENAI_DEFAULT = process.env.OPENAI_MODEL_DEFAULT || 'gpt-5.4';
export const TEXT_GENERATOR_MODEL = process.env.OPENAI_MODEL_TEXTGEN || 'gpt-5.4';
export const OPENAI_LIGHT = process.env.OPENAI_MODEL_LIGHT || 'gpt-5.4-mini';
const OPENAI_SEARCH = process.env.OPENAI_SEARCH_MODEL || 'gpt-5-search-api';

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 3 });
  }
  return _client;
}

function buildInput(prompt: string, system?: string): OpenAI.Responses.ResponseInput {
  if (system) {
    return [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ] as OpenAI.Responses.ResponseInput;
  }
  return [{ role: 'user', content: prompt }] as OpenAI.Responses.ResponseInput;
}

export async function generateText(
  prompt: string,
  opts: { model?: string; maxTokens?: number; system?: string; noThinking?: boolean } = {},
): Promise<string> {
  const res = await getClient().responses.create({
    model: opts.model || OPENAI_DEFAULT,
    input: buildInput(prompt, opts.system),
    max_output_tokens: opts.maxTokens,
  }, { signal: getAbortSignal() ?? undefined });
  return (res as any).output_text ?? '';
}

export async function generateTextStream(
  prompt: string,
  onChunk: (chunk: string, accumulated: string) => void,
  opts: { model?: string; maxTokens?: number; system?: string; noThinking?: boolean } = {},
): Promise<string> {
  const stream = getClient().responses.stream({
    model: opts.model || OPENAI_DEFAULT,
    input: buildInput(prompt, opts.system),
    max_output_tokens: opts.maxTokens,
  }, { signal: getAbortSignal() ?? undefined });

  let accumulated = '';
  for await (const event of stream) {
    if ((event as any).type === 'response.output_text.delta') {
      const delta: string = (event as any).delta ?? '';
      if (delta) { accumulated += delta; onChunk(delta, accumulated); }
    }
  }
  // finalResponse() gives the completed response with output_text
  const final = await stream.finalResponse();
  return (final as any).output_text ?? accumulated;
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
  const res = await getClient().responses.create({
    model: OPENAI_SEARCH,
    input: prompt,
  }, { signal: getAbortSignal() ?? undefined });
  return (res as any).output_text ?? '';
}

export async function openaiJSON(prompt: string, model = OPENAI_DEFAULT): Promise<string> {
  const res = await getClient().responses.create({
    model,
    input: prompt,
    text: { format: { type: 'json_object' } },
  } as any, { signal: getAbortSignal() ?? undefined });
  return (res as any).output_text ?? '';
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
