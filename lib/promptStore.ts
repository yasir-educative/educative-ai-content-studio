// File-backed prompt registry with versioning.
//
// Design:
//   - Each prompt function in lib/prompts.ts is wrapped with `registerPrompt(name, fn)`.
//   - At registration time, we replay the function with a Proxy that returns `{{key}}` placeholders
//     for every accessed property. The resulting string IS the editable template body.
//   - The default template is kept in memory; the user-edited version (if any) lives in
//     data/prompts/{name}.json. On every call the wrapped function reads the disk version (cached
//     for a short TTL) and substitutes `{{var}}` placeholders with the real args. Save in the UI
//     bumps the version and archives the previous body to history[].
//   - If Proxy capture fails (rare — only for prompts with control-flow logic), the prompt stays
//     code-only and is excluded from the editor UI.
//
// File schema (data/prompts/{name}.json):
//   { name, version, body, default, variables, updatedAt, history: [{ version, body, updatedAt }] }

import { promises as fs, existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';

export interface StoredPrompt {
  name: string;
  version: number;
  body: string;
  default: string;
  variables: string[];
  updatedAt: string;
  history: { version: number; body: string; updatedAt: string }[];
  // Whether this prompt was successfully template-extracted (false → editor UI hides it).
  editable: boolean;
}

export type PromptPipeline = 'outline' | 'blog' | 'newsletter' | 'course' | 'shared' | 'mobile-course' | 'mobile-short';

interface RegistryEntry {
  name: string;
  defaultBody: string;
  variables: string[];
  fn: (args: any) => string;
  editable: boolean;
  pipeline: PromptPipeline;
}

const PROMPTS_DIR = path.join(process.cwd(), 'data', 'prompts');
const REGISTRY = new Map<string, RegistryEntry>();
const CACHE = new Map<string, { body: string; expires: number }>();
const CACHE_TTL_MS = 2_000; // short — UI saves should reflect on next call.

function ensureDirSync() {
  if (!existsSync(PROMPTS_DIR)) mkdirSync(PROMPTS_DIR, { recursive: true });
}

function filePath(name: string): string {
  if (!/^[a-z0-9_-]+$/.test(name)) throw new Error(`invalid prompt name: ${name}`);
  return path.join(PROMPTS_DIR, `${name}.json`);
}

function captureTemplate(fn: (args: any) => string): { template: string; variables: string[] } | null {
  const seen = new Set<string>();
  // Proxy returns the same {{key}} placeholder regardless of how the property is used.
  // It also tolerates nested access like `args.x.y` by returning self for any get.
  function makeProxy(prefix: string): any {
    return new Proxy(function () {}, {
      get(_t, key: string | symbol) {
        if (typeof key === 'symbol' || key === 'toString' || key === 'valueOf') {
          return () => `{{${prefix || 'value'}}}`;
        }
        const next = prefix ? `${prefix}.${key}` : key;
        seen.add(next.split('.')[0]);
        return makeProxy(next);
      },
      apply() {
        return `{{${prefix || 'value'}}}`;
      },
    });
  }
  try {
    const template = fn(makeProxy(''));
    if (typeof template !== 'string') return null;
    return { template, variables: Array.from(seen) };
  } catch {
    return null;
  }
}

function loadFromDisk(name: string): StoredPrompt | null {
  try {
    const buf = readFileSync(filePath(name), 'utf8');
    return JSON.parse(buf) as StoredPrompt;
  } catch {
    return null;
  }
}

function writeToDisk(prompt: StoredPrompt) {
  ensureDirSync();
  const tmp = filePath(prompt.name) + '.tmp';
  writeFileSync(tmp, JSON.stringify(prompt, null, 2), 'utf8');
  renameSync(tmp, filePath(prompt.name));
}

function getActiveBody(name: string, defaultBody: string): string {
  const cached = CACHE.get(name);
  const now = Date.now();
  if (cached && cached.expires > now) return cached.body;
  const stored = loadFromDisk(name);
  const body = stored?.body || defaultBody;
  CACHE.set(name, { body, expires: now + CACHE_TTL_MS });
  return body;
}

function render(template: string, args: any): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_m, key: string) => {
    const parts = key.split('.');
    let v: any = args;
    for (const p of parts) v = v?.[p];
    return v == null ? '' : String(v);
  });
}

export function registerPrompt<T>(name: string, fn: (args: T) => string, pipeline: PromptPipeline = 'shared'): (args: T) => string {
  const captured = captureTemplate(fn as (a: any) => string);
  const editable = !!captured && captured.template.length > 0;
  const defaultBody = captured?.template || '';
  const variables = captured?.variables || [];
  REGISTRY.set(name, { name, defaultBody, variables, fn: fn as any, editable, pipeline });

  return (args: T) => {
    const entry = REGISTRY.get(name)!;
    if (!entry.editable) return entry.fn(args);
    const body = getActiveBody(name, entry.defaultBody);
    // Scalar args (string/number) are captured as {{value}} by the Proxy. Wrap them so render()
    // can substitute the value — otherwise args['value'] is undefined and the content vanishes.
    const renderArgs = (typeof args === 'string' || typeof args === 'number')
      ? { value: String(args) }
      : args;
    return render(body, renderArgs as any);
  };
}

// ---- Public API used by routes/UI ----

export function listPrompts(): { name: string; variables: string[]; editable: boolean; version: number; updatedAt?: string; pipeline: PromptPipeline }[] {
  const out: { name: string; variables: string[]; editable: boolean; version: number; updatedAt?: string; pipeline: PromptPipeline }[] = [];
  for (const e of REGISTRY.values()) {
    const stored = loadFromDisk(e.name);
    out.push({
      name: e.name,
      variables: e.variables,
      editable: e.editable,
      version: stored?.version ?? 0,
      updatedAt: stored?.updatedAt,
      pipeline: e.pipeline,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function getPromptDetail(name: string): StoredPrompt | null {
  const entry = REGISTRY.get(name);
  if (!entry) return null;
  const stored = loadFromDisk(name);
  if (stored) return { ...stored, default: entry.defaultBody, variables: entry.variables, editable: entry.editable };
  // Synthesize an "as-default" record so the editor has something to show even if no save yet.
  return {
    name,
    version: 0,
    body: entry.defaultBody,
    default: entry.defaultBody,
    variables: entry.variables,
    updatedAt: '',
    history: [],
    editable: entry.editable,
  };
}

export async function savePrompt(name: string, newBody: string): Promise<StoredPrompt> {
  const entry = REGISTRY.get(name);
  if (!entry) throw new Error(`unknown prompt: ${name}`);
  if (!entry.editable) throw new Error(`prompt is not editable (code-only): ${name}`);
  const current = loadFromDisk(name);
  const nextVersion = (current?.version || 0) + 1;
  const now = new Date().toISOString();
  const history = current
    ? [...(current.history || []), { version: current.version, body: current.body, updatedAt: current.updatedAt }]
    : [];
  // cap history at 30 entries
  while (history.length > 30) history.shift();
  const updated: StoredPrompt = {
    name,
    version: nextVersion,
    body: newBody,
    default: entry.defaultBody,
    variables: entry.variables,
    updatedAt: now,
    history,
    editable: true,
  };
  writeToDisk(updated);
  CACHE.delete(name);
  return updated;
}

export async function resetPrompt(name: string): Promise<void> {
  // Delete the override; default body is restored automatically.
  try {
    await fs.unlink(filePath(name));
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e;
  }
  CACHE.delete(name);
}

export async function rollbackPrompt(name: string, toVersion: number): Promise<StoredPrompt> {
  const current = loadFromDisk(name);
  if (!current) throw new Error('no saved version to roll back from');
  const target = current.history.find((h) => h.version === toVersion);
  if (!target) throw new Error(`version ${toVersion} not in history`);
  return savePrompt(name, target.body);
}
