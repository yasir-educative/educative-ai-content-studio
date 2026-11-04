// Named image styles for the Educative image generator.
//
// The shipped house style is always present and cannot be deleted; saved
// styles live in data/educative-image-styles.json. One is the default and is
// used when a generation does not name one.

import { promises as fs, existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EDUCATIVE_IMAGE_STYLE } from './educativeImageStyle';
import { MOBILE_CARD_IMAGE_STYLE } from './mobileCardImageStyle';
import { BLOG_IMAGE_STYLE } from './blogImageStyle';
import { COURSE_IMAGE_STYLE } from './courseImageStyle';
import type { StyleScope } from './imageStyleScopes';
import { IMAGE_EXT } from './imageGen';

const FILE = path.join(process.cwd(), 'data', 'educative-image-styles.json');
const LEGACY = path.join(process.cwd(), 'data', 'educative-image-style.json');

export const BUILTIN_ID = 'builtin';
export const MOBILE_BUILTIN_ID = 'mobile';
export const BLOG_BUILTIN_ID = 'blog';
export const COURSE_BUILTIN_ID = 'course';

export type { StyleScope } from './imageStyleScopes';
export { STYLE_SCOPES } from './imageStyleScopes';

export interface ImageStyle {
  id: string;
  name: string;
  body: string;
  /** The shipped style: editable as a copy, never deletable. */
  builtin: boolean;
  updatedAt: string;
  /**
   * A saved style reference picture. Where one is set it replaces the written
   * style at generation time, because sending both pulls the result two ways.
   * It stays until it is replaced or removed.
   */
  referenceUrl?: string;
  /**
   * A sample image drawn in this style, so the style can be recognised at a
   * glance instead of read. Generated on request from the same fixed subject
   * for every style, which is what makes two styles comparable.
   */
  previewUrl?: string;
}

interface Store {
  styles: ImageStyle[];
  /** Used by the Images page's own generator. */
  defaultId: string;
  /** Used by every mobile card illustration, in mobile courses and in shorts. */
  mobileDefaultId: string;
  /** Used by blog and newsletter illustrations. */
  blogDefaultId: string;
  /** Used by Educative course lesson illustrations. */
  courseDefaultId: string;
}

function builtins(): ImageStyle[] {
  return [
    { id: BUILTIN_ID, name: 'Educative house style', body: EDUCATIVE_IMAGE_STYLE, builtin: true, updatedAt: '' },
    { id: MOBILE_BUILTIN_ID, name: 'Mobile card style', body: MOBILE_CARD_IMAGE_STYLE, builtin: true, updatedAt: '' },
    { id: BLOG_BUILTIN_ID, name: 'Blog illustration style', body: BLOG_IMAGE_STYLE, builtin: true, updatedAt: '' },
    { id: COURSE_BUILTIN_ID, name: 'Course illustration style', body: COURSE_IMAGE_STYLE, builtin: true, updatedAt: '' },
  ];
}

const BUILTIN_IDS = [BUILTIN_ID, MOBILE_BUILTIN_ID, BLOG_BUILTIN_ID, COURSE_BUILTIN_ID];

/** The shipped style each scope falls back to. */
const SCOPE_BUILTIN: Record<StyleScope, string> = {
  educative: BUILTIN_ID,
  blog: BLOG_BUILTIN_ID,
  mobile: MOBILE_BUILTIN_ID,
  course: COURSE_BUILTIN_ID,
};
const SCOPE_KEY: Record<StyleScope, keyof Pick<Store, 'defaultId' | 'blogDefaultId' | 'mobileDefaultId' | 'courseDefaultId'>> = {
  educative: 'defaultId',
  blog: 'blogDefaultId',
  mobile: 'mobileDefaultId',
  course: 'courseDefaultId',
};

function read(): Store {
  let saved: ImageStyle[] = [];
  let defaultId = BUILTIN_ID;
  let mobileDefaultId = MOBILE_BUILTIN_ID;
  let blogDefaultId = BLOG_BUILTIN_ID;
  let courseDefaultId = COURSE_BUILTIN_ID;
  try {
    if (existsSync(FILE)) {
      const p = JSON.parse(readFileSync(FILE, 'utf8'));
      if (Array.isArray(p?.styles)) saved = p.styles.filter((s: any) => s?.id && typeof s.body === 'string');
      if (typeof p?.defaultId === 'string') defaultId = p.defaultId;
      if (typeof p?.mobileDefaultId === 'string') mobileDefaultId = p.mobileDefaultId;
      if (typeof p?.blogDefaultId === 'string') blogDefaultId = p.blogDefaultId;
      if (typeof p?.courseDefaultId === 'string') courseDefaultId = p.courseDefaultId;
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
  const styles = [...builtins(), ...saved.filter((s) => !BUILTIN_IDS.includes(s.id))]
    .map((s) => ({ ...s, referenceUrl: styleReferenceUrl(s.id), previewUrl: stylePreviewUrl(s.id) }));
  if (!styles.some((s) => s.id === defaultId)) defaultId = BUILTIN_ID;
  if (!styles.some((s) => s.id === mobileDefaultId)) mobileDefaultId = MOBILE_BUILTIN_ID;
  if (!styles.some((s) => s.id === blogDefaultId)) blogDefaultId = BLOG_BUILTIN_ID;
  if (!styles.some((s) => s.id === courseDefaultId)) courseDefaultId = COURSE_BUILTIN_ID;
  return { styles, defaultId, mobileDefaultId, blogDefaultId, courseDefaultId };
}

async function write(s: Store): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  // The builtins are code, not data; only overrides are persisted.
  // referenceUrl is derived from what is on disk, never stored.
  const styles = s.styles.filter((x) => !BUILTIN_IDS.includes(x.id)).map(({ referenceUrl, previewUrl, ...rest }) => rest);
  await fs.writeFile(
    FILE,
    JSON.stringify({
      styles,
      defaultId: s.defaultId,
      mobileDefaultId: s.mobileDefaultId,
      blogDefaultId: s.blogDefaultId,
      courseDefaultId: s.courseDefaultId,
    }, null, 2),
    'utf8',
  );
}

export function listStyles(): Store {
  return read();
}

export function getStyleById(id?: string, scope: StyleScope = 'educative'): ImageStyle {
  const store = read();
  const fallback = store[SCOPE_KEY[scope]];
  return store.styles.find((s) => s.id === (id || fallback))
    || store.styles.find((s) => s.id === fallback)
    || builtins().find((s) => s.id === SCOPE_BUILTIN[scope])!;
}

/** The style a pipeline draws in, with its saved reference picture if it has one. */
export function getScopeStyle(scope: StyleScope, id?: string): ImageStyle {
  return getStyleById(id, scope);
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
  await clearStyleReference(id);
  await clearStylePreview(id);
  await write({
    styles: store.styles.filter((s) => s.id !== id),
    defaultId: store.defaultId === id ? BUILTIN_ID : store.defaultId,
    mobileDefaultId: store.mobileDefaultId === id ? MOBILE_BUILTIN_ID : store.mobileDefaultId,
    blogDefaultId: store.blogDefaultId === id ? BLOG_BUILTIN_ID : store.blogDefaultId,
    courseDefaultId: store.courseDefaultId === id ? COURSE_BUILTIN_ID : store.courseDefaultId,
  });
}

export async function setDefaultStyle(id: string, scope: StyleScope = 'educative'): Promise<void> {
  const store = read();
  if (!store.styles.some((s) => s.id === id)) throw new Error('style not found');
  await write({ ...store, [SCOPE_KEY[scope]]: id });
}

// ── Style reference pictures ─────────────────────────────────────────────────
// One picture per style, kept on disk beside the styles file so it survives a
// reload and is reused by every generation in that style until it is changed
// or removed.

const REF_DIR = path.join(process.cwd(), 'data', 'images', 'style-references');

function referenceFile(id: string): string | null {
  try {
    if (!existsSync(REF_DIR)) return null;
    return readdirSync(REF_DIR).find((f) => f.startsWith(`${id}.`)) || null;
  } catch {
    return null;
  }
}

export function styleReferenceUrl(id: string): string | undefined {
  const file = referenceFile(id);
  return file ? `/api/images/style-references/${file}` : undefined;
}

/** The bytes to send as the style reference, or null when the style has none. */
export async function readStyleReference(id: string): Promise<{ buf: Buffer; type: string } | null> {
  const file = referenceFile(id);
  if (!file) return null;
  try {
    const buf = await fs.readFile(path.join(REF_DIR, file));
    const ext = file.split('.').pop() || 'png';
    return { buf, type: `image/${ext === 'jpg' ? 'jpeg' : ext}` };
  } catch {
    return null;
  }
}

export async function saveStyleReference(id: string, buf: Buffer, ext: string): Promise<string> {
  if (!read().styles.some((s) => s.id === id)) throw new Error('style not found');
  const clean = /^(png|jpe?g|webp)$/i.test(ext) ? ext.toLowerCase() : 'png';
  await fs.mkdir(REF_DIR, { recursive: true });
  await clearStyleReference(id); // one picture per style
  await fs.writeFile(path.join(REF_DIR, `${id}.${clean}`), buf);
  return `/api/images/style-references/${id}.${clean}`;
}

export async function clearStyleReference(id: string): Promise<void> {
  const file = referenceFile(id);
  if (file) await fs.unlink(path.join(REF_DIR, file)).catch(() => {});
}

// ── Style previews ───────────────────────────────────────────────────────────
// One sample image per style, drawn from the same fixed subject so two styles
// can be told apart by looking. Unlike a reference picture this is output, not
// input: it is never sent to the model.

const PREVIEW_DIR = path.join(process.cwd(), 'data', 'images', 'style-previews');

/** The subject every preview draws, so the difference between two is the style alone. */
export const STYLE_PREVIEW_SUBJECT =
  'three labelled boxes in a row — "Client", "Service", "Database" — joined left to right by two arrows, '
  + 'with a small cache icon above the middle box connected by a short dashed line';

export function stylePreviewUrl(id: string): string | undefined {
  try {
    if (!existsSync(PREVIEW_DIR)) return undefined;
    const file = readdirSync(PREVIEW_DIR).find((f) => f.startsWith(`${id}.`));
    // The name is stable, so a regenerated preview needs a cache-buster.
    if (!file) return undefined;
    const stamp = statSync(path.join(PREVIEW_DIR, file)).mtimeMs;
    return `/api/images/style-previews/${file}?v=${Math.floor(stamp)}`;
  } catch {
    return undefined;
  }
}

export async function saveStylePreview(id: string, buf: Buffer, ext = IMAGE_EXT): Promise<string> {
  if (!read().styles.some((s) => s.id === id)) throw new Error('style not found');
  await fs.mkdir(PREVIEW_DIR, { recursive: true });
  // Clear first: a redraw in a different format must not leave the old file
  // behind for the lookup to find instead.
  await clearStylePreview(id);
  await fs.writeFile(path.join(PREVIEW_DIR, `${id}.${ext}`), buf);
  return stylePreviewUrl(id)!;
}

export async function clearStylePreview(id: string): Promise<void> {
  try {
    for (const f of readdirSync(PREVIEW_DIR)) {
      if (f.startsWith(`${id}.`)) await fs.unlink(path.join(PREVIEW_DIR, f)).catch(() => {});
    }
  } catch {
    // nothing drawn yet
  }
}
