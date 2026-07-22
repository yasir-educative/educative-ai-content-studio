// File-backed persona registry. Mirrors the shape of lib/promptStore.ts but for voice prompts.
//
// Source of truth at runtime is the union of:
//   - built-in personas (seeded from lib/personas.ts on module load)
//   - user-created or user-edited personas in data/personas/{slug}.json
//
// Built-ins can be edited (saved as an override on disk) and reset (delete the override file).
// They cannot be deleted from the list — resetting brings the original body back. User-created
// personas can be deleted freely.

import { promises as fs, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { PERSONA_NAMES, getPersonaPrompt } from './personas';

export interface StoredPersona {
  slug: string;
  name: string;
  body: string;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

const DIR = path.join(process.cwd(), 'data', 'personas');

function ensureDirSync() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'persona';
}

function filePath(slug: string): string {
  if (!/^[a-z0-9_-]+$/.test(slug)) throw new Error(`invalid persona slug: ${slug}`);
  return path.join(DIR, `${slug}.json`);
}

// Built-in personas, materialized once. Bodies come from getPersonaPrompt() at module load — keeps
// the canonical text in one place (lib/personas.ts) so editing the source still updates defaults.
const BUILTINS: Map<string, { name: string; body: string }> = new Map(
  PERSONA_NAMES.map((name) => [slugify(name), { name, body: getPersonaPrompt(name) }]),
);

function loadOverride(slug: string): StoredPersona | null {
  try {
    const raw = readFileSync(filePath(slug), 'utf8');
    return JSON.parse(raw) as StoredPersona;
  } catch {
    return null;
  }
}

function writeOverride(p: StoredPersona) {
  ensureDirSync();
  const tmp = filePath(p.slug) + '.tmp';
  writeFileSync(tmp, JSON.stringify(p, null, 2), 'utf8');
  require('fs').renameSync(tmp, filePath(p.slug));
}

export function listPersonas(): StoredPersona[] {
  ensureDirSync();
  const overrides = new Map<string, StoredPersona>();
  for (const f of readdirSync(DIR)) {
    if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
    const slug = f.replace(/\.json$/, '');
    const p = loadOverride(slug);
    if (p) overrides.set(slug, p);
  }
  const out: StoredPersona[] = [];
  // built-ins first, in their original order
  for (const [slug, b] of BUILTINS) {
    const o = overrides.get(slug);
    out.push(
      o
        ? { ...o, name: b.name, builtin: true }
        : { slug, name: b.name, body: b.body, builtin: true, createdAt: '', updatedAt: '' },
    );
    overrides.delete(slug);
  }
  // user-created (non-builtin) personas after, alphabetical
  const userCreated = Array.from(overrides.values()).sort((a, b) => a.name.localeCompare(b.name));
  out.push(...userCreated);
  return out;
}

export function getPersona(slug: string): StoredPersona | null {
  const o = loadOverride(slug);
  const builtin = BUILTINS.get(slug);
  if (o) return { ...o, name: builtin ? builtin.name : o.name, builtin: !!builtin };
  if (builtin) {
    return { slug, name: builtin.name, body: builtin.body, builtin: true, createdAt: '', updatedAt: '' };
  }
  return null;
}

// Used by the pipeline. Looks up the live (possibly user-edited) body by display name.
export function getPersonaBody(name: string): string {
  // Try slug-from-name first; fall back to scanning the list (handles renames).
  const direct = getPersona(slugify(name));
  if (direct && direct.name === name) return direct.body;
  const all = listPersonas();
  const match = all.find((p) => p.name === name);
  return match?.body || '';
}

export async function createPersona(name: string, body: string): Promise<StoredPersona> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('name is required');
  let slug = slugify(trimmedName);
  // disambiguate if a built-in or another override already owns this slug
  if (BUILTINS.has(slug) || existsSync(filePath(slug))) {
    let i = 2;
    while (BUILTINS.has(`${slug}-${i}`) || existsSync(filePath(`${slug}-${i}`))) i++;
    slug = `${slug}-${i}`;
  }
  const now = new Date().toISOString();
  const p: StoredPersona = {
    slug,
    name: trimmedName,
    body: body || '',
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  writeOverride(p);
  return p;
}

export async function savePersona(slug: string, patch: { body?: string; name?: string }): Promise<StoredPersona> {
  const existing = getPersona(slug);
  if (!existing) throw new Error(`unknown persona: ${slug}`);
  const now = new Date().toISOString();
  const next: StoredPersona = {
    slug,
    // built-in display names are immutable so the dropdown stays stable
    name: existing.builtin ? existing.name : (patch.name?.trim() || existing.name),
    body: patch.body !== undefined ? patch.body : existing.body,
    builtin: existing.builtin,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
  writeOverride(next);
  return next;
}

export async function resetPersona(slug: string): Promise<StoredPersona | null> {
  // Only meaningful for built-ins — deletes the override so the seeded body returns.
  const builtin = BUILTINS.get(slug);
  if (!builtin) throw new Error('only built-in personas can be reset; user personas should be deleted instead');
  try {
    await fs.unlink(filePath(slug));
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e;
  }
  return getPersona(slug);
}

export async function deletePersona(slug: string): Promise<void> {
  if (BUILTINS.has(slug)) throw new Error('built-in personas cannot be deleted; use reset instead');
  try {
    await fs.unlink(filePath(slug));
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e;
  }
}
