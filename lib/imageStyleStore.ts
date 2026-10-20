// File-backed override for the Educative image style block.
//
// The default lives in lib/educativeImageStyle.ts. An edit saved from the
// generator page is written to data/educative-image-style.json and takes
// precedence; resetting deletes that file so the default applies again.

import { promises as fs, existsSync, readFileSync } from 'fs';
import path from 'path';
import { EDUCATIVE_IMAGE_STYLE } from './educativeImageStyle';

const FILE = path.join(process.cwd(), 'data', 'educative-image-style.json');

/** The style currently in effect, plus whether it is still the shipped default. */
export function getImageStyle(): { style: string; isDefault: boolean } {
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
      const style = typeof parsed?.style === 'string' ? parsed.style : '';
      if (style.trim()) return { style, isDefault: false };
    }
  } catch {
    // unreadable or malformed override — fall back to the default
  }
  return { style: EDUCATIVE_IMAGE_STYLE, isDefault: true };
}

export async function saveImageStyle(style: string): Promise<{ style: string; isDefault: boolean }> {
  const clean = String(style ?? '').trim();
  if (!clean) throw new Error('style cannot be empty');
  // An edit identical to the default is a reset, so no override file is kept.
  if (clean === EDUCATIVE_IMAGE_STYLE.trim()) return resetImageStyle();
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ style: clean, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  return { style: clean, isDefault: false };
}

export async function resetImageStyle(): Promise<{ style: string; isDefault: boolean }> {
  try {
    await fs.unlink(FILE);
  } catch {
    // already absent — already on the default
  }
  return { style: EDUCATIVE_IMAGE_STYLE, isDefault: true };
}
