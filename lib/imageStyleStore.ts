// Named image styles for the Educative image generator.
//
// The shipped house style is always present and cannot be deleted; saved
// styles live in data/educative-image-styles.json. One is the default and is
// used when a generation does not name one.

import { promises as fs, existsSync, readFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EDUCATIVE_IMAGE_STYLE } from './educativeImageStyle';

const FILE = path.join(process.cwd(), 'data', 'educative-image-styles.json');
const LEGACY = path.join(process.cwd(), 'data', 'educative-image-style.json');

export const BUILTIN_ID = 'builtin';

export interface ImageStyle {
  id: string;
  name: string;
  body: string;
  /** The shipped style: editable as a copy, never deletable. */
  builtin: boolean;
  updatedAt: string;
}

interface Store {
  styles: ImageStyle[];
  defaultId: string;
}

function builtin(): ImageStyle {
  return {
    id: BUILTIN_ID,
    name: 'Educative house style',
    body: EDUCATIVE_IMAGE_STYLE,
    builtin: true,
    updatedAt: '',
  };
}

function read(): Store {
  let saved: ImageStyle[] = [];
  let defaultId = BUILTIN_ID;
  try {
    if (existsSync(FILE)) {
      const p = JSON.parse(readFileSync(FILE, 'utf8'));
      if (Array.isArray(p?.styles)) saved = p.styles.filter((s: any) => s?.id && typeof s.body === 'string');
      if (typeof p?.defaultId === 'string') defaultId = p.defaultId;
    } else if (existsSync(LEGACY)) {
      // Carry over the single override the generator used to keep.
      const p = JSON.parse(readFileSync(LEGACY, 'utf8'));
      if (typeof p?.style === 'string' && p.style.trim()) {
        saved = [{ id: 'migrated', name: 'Saved style', body: p.style, builtin: false, updatedAt: p.updatedAt || '' }];
        defaultId = 'migrated';
      }
    }
  } catch {
    // unreadable file — fall back to the shipped style alone
  }
  const styles = [builtin(), ...saved.filter((s) => s.id !== BUILTIN_ID)];
  if (!styles.some((s) => s.id === defaultId)) defaultId = BUILTIN_ID;
  return { styles, defaultId };
}

async function write(s: Store): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  // The builtin is code, not data; only overrides are persisted.
  const styles = s.styles.filter((x) => x.id !== BUILTIN_ID);
  await fs.writeFile(FILE, JSON.stringify({ styles, defaultId: s.defaultId }, null, 2), 'utf8');
}

export function listStyles(): Store {
  return read();
}

export function getStyleById(id?: string): ImageStyle {
  const { styles, defaultId } = read();
  return styles.find((s) => s.id === (id || defaultId)) || styles.find((s) => s.id === defaultId) || builtin();
}

/** Back-compat for callers that just want the active style text. */
export function getImageStyle(id?: string): { style: string; isDefault: boolean } {
  const { defaultId } = read();
  const s = getStyleById(id);
  return { style: s.body, isDefault: s.id === defaultId };
}

export async function saveStyle(input: { id?: string; name?: string; body: string }): Promise<ImageStyle> {
  const body = String(input.body || '').trim();
  if (!body) throw new Error('style body cannot be empty');
  const store = read();

  // Editing the builtin forks it, so the shipped text stays recoverable.
  const editingBuiltin = input.id === BUILTIN_ID;
  const id = editingBuiltin || !input.id ? 'st-' + crypto.randomBytes(5).toString('hex') : input.id;
  const existing = store.styles.find((s) => s.id === id && !s.builtin);

  const style: ImageStyle = {
    id,
    name: String(input.name || existing?.name || (editingBuiltin ? 'House style (edited)' : 'Untitled style')).trim(),
    body,
    builtin: false,
    updatedAt: new Date().toISOString(),
  };

  const rest = store.styles.filter((s) => s.id !== id && !s.builtin);
  await write({ styles: [...rest, style], defaultId: store.defaultId });
  return style;
}

export async function deleteStyle(id: string): Promise<void> {
  if (id === BUILTIN_ID) throw new Error('the house style cannot be deleted');
  const store = read();
  const styles = store.styles.filter((s) => s.id !== id);
  const defaultId = store.defaultId === id ? BUILTIN_ID : store.defaultId;
  await write({ styles, defaultId });
}

export async function setDefaultStyle(id: string): Promise<void> {
  const store = read();
  if (!store.styles.some((s) => s.id === id)) throw new Error('style not found');
  await write({ styles: store.styles, defaultId: id });
}
