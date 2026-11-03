// Named image styles for the Educative image generator.
//
// The shipped house style is always present and cannot be deleted; saved
// styles live in data/educative-image-styles.json. One is the default and is
// used when a generation does not name one.

import { promises as fs, existsSync, readFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EDUCATIVE_IMAGE_STYLE } from './educativeImageStyle';
import { MOBILE_CARD_IMAGE_STYLE } from './mobileCardImageStyle';

const FILE = path.join(process.cwd(), 'data', 'educative-image-styles.json');
const LEGACY = path.join(process.cwd(), 'data', 'educative-image-style.json');

export const BUILTIN_ID = 'builtin';
export const MOBILE_BUILTIN_ID = 'mobile';

/**
 * Where a style is used. The two are picked separately: an Educative article
 * image and a mobile card are drawn to different rules, and the same saved
 * style can serve both.
 */
export type StyleScope = 'educative' | 'mobile';

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
  /** Used by the Educative image generator. */
  defaultId: string;
  /** Used by every mobile card illustration, in courses and in shorts. */
  mobileDefaultId: string;
}

function builtins(): ImageStyle[] {
  return [
    { id: BUILTIN_ID, name: 'Educative house style', body: EDUCATIVE_IMAGE_STYLE, builtin: true, updatedAt: '' },
    { id: MOBILE_BUILTIN_ID, name: 'Mobile card style', body: MOBILE_CARD_IMAGE_STYLE, builtin: true, updatedAt: '' },
  ];
}

const BUILTIN_IDS = [BUILTIN_ID, MOBILE_BUILTIN_ID];

function read(): Store {
  let saved: ImageStyle[] = [];
  let defaultId = BUILTIN_ID;
  let mobileDefaultId = MOBILE_BUILTIN_ID;
  try {
    if (existsSync(FILE)) {
      const p = JSON.parse(readFileSync(FILE, 'utf8'));
      if (Array.isArray(p?.styles)) saved = p.styles.filter((s: any) => s?.id && typeof s.body === 'string');
      if (typeof p?.defaultId === 'string') defaultId = p.defaultId;
      if (typeof p?.mobileDefaultId === 'string') mobileDefaultId = p.mobileDefaultId;
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
  const styles = [...builtins(), ...saved.filter((s) => !BUILTIN_IDS.includes(s.id))];
  if (!styles.some((s) => s.id === defaultId)) defaultId = BUILTIN_ID;
  if (!styles.some((s) => s.id === mobileDefaultId)) mobileDefaultId = MOBILE_BUILTIN_ID;
  return { styles, defaultId, mobileDefaultId };
}

async function write(s: Store): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  // The builtins are code, not data; only overrides are persisted.
  const styles = s.styles.filter((x) => !BUILTIN_IDS.includes(x.id));
  await fs.writeFile(
    FILE,
    JSON.stringify({ styles, defaultId: s.defaultId, mobileDefaultId: s.mobileDefaultId }, null, 2),
    'utf8',
  );
}

export function listStyles(): Store {
  return read();
}

export function getStyleById(id?: string, scope: StyleScope = 'educative'): ImageStyle {
  const store = read();
  const fallback = scope === 'mobile' ? store.mobileDefaultId : store.defaultId;
  return store.styles.find((s) => s.id === (id || fallback))
    || store.styles.find((s) => s.id === fallback)
    || builtins()[scope === 'mobile' ? 1 : 0];
}

/** The style every mobile card illustration is drawn in. */
export function getMobileStyle(id?: string): ImageStyle {
  return getStyleById(id, 'mobile');
}

/** Back-compat for callers that just want the active style text. */
export function getImageStyle(id?: string): { style: string; name: string; isDefault: boolean } {
  const { defaultId } = read();
  const s = getStyleById(id);
  return { style: s.body, name: s.name, isDefault: s.id === defaultId };
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
  await write({ ...store, styles: [...rest, style] });
  return style;
}

export async function deleteStyle(id: string): Promise<void> {
  if (BUILTIN_IDS.includes(id)) throw new Error('a shipped style cannot be deleted');
  const store = read();
  await write({
    styles: store.styles.filter((s) => s.id !== id),
    defaultId: store.defaultId === id ? BUILTIN_ID : store.defaultId,
    mobileDefaultId: store.mobileDefaultId === id ? MOBILE_BUILTIN_ID : store.mobileDefaultId,
  });
}

export async function setDefaultStyle(id: string, scope: StyleScope = 'educative'): Promise<void> {
  const store = read();
  if (!store.styles.some((s) => s.id === id)) throw new Error('style not found');
  await write(scope === 'mobile' ? { ...store, mobileDefaultId: id } : { ...store, defaultId: id });
}
