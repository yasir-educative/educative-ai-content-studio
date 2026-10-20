// File-backed vertical registry.
//
// The vertical list used to be hardcoded separately in the blog, outline, and
// newsletter forms, which drifted apart and omitted several verticals the n8n
// workflow offered (Cloud computing, Learn to code, Generative AI, …). It lives
// here now so every form reads one list and an admin can extend it at runtime.
//
// Built-ins come from BUILTIN_VERTICALS; anything an admin adds is appended to
// data/verticals.json. Built-ins cannot be removed, only custom ones.

import { promises as fs, existsSync, readFileSync } from 'fs';
import path from 'path';
import { BUILTIN_VERTICALS } from './verticals';

export { BUILTIN_VERTICALS };

const FILE = path.join(process.cwd(), 'data', 'verticals.json');

function readCustom(): string[] {
  try {
    if (!existsSync(FILE)) return [];
    const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Built-ins first, then custom additions. Case-insensitively de-duplicated. */
export function listVerticals(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...BUILTIN_VERTICALS, ...readCustom()]) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

export function isBuiltin(name: string): boolean {
  return BUILTIN_VERTICALS.some((v) => v.toLowerCase() === name.trim().toLowerCase());
}

export async function addVertical(name: string): Promise<string[]> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('vertical name is required');
  if (clean.length > 60) throw new Error('vertical name is too long (max 60 characters)');
  if (listVerticals().some((v) => v.toLowerCase() === clean.toLowerCase())) {
    throw new Error(`"${clean}" already exists`);
  }
  const custom = [...readCustom(), clean];
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(custom, null, 2), 'utf8');
  return listVerticals();
}

export async function removeVertical(name: string): Promise<string[]> {
  const clean = name.trim();
  if (isBuiltin(clean)) throw new Error('built-in verticals cannot be removed');
  const custom = readCustom().filter((v) => v.toLowerCase() !== clean.toLowerCase());
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(custom, null, 2), 'utf8');
  return listVerticals();
}
