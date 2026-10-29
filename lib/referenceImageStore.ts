// The style reference image for the Educative image generator.
//
// One image at a time, kept on disk so it survives reloads and is reused
// across generations until it is replaced or removed.

import { promises as fs, existsSync, readdirSync } from 'fs';
import path from 'path';

const DIR = path.join(process.cwd(), 'data', 'images', 'educative');
const STEM = '_reference';

export interface StoredReference {
  filename: string;
  url: string;
}

/** The saved reference, or null when none is set. */
export function getReference(): StoredReference | null {
  try {
    if (!existsSync(DIR)) return null;
    const hit = readdirSync(DIR).find((f) => f.startsWith(`${STEM}.`));
    if (!hit) return null;
    return { filename: hit, url: `/api/images/educative/${hit}` };
  } catch {
    return null;
  }
}

export async function readReferenceBytes(): Promise<{ buf: Buffer; type: string } | null> {
  const ref = getReference();
  if (!ref) return null;
  try {
    const buf = await fs.readFile(path.join(DIR, ref.filename));
    const ext = ref.filename.split('.').pop() || 'png';
    return { buf, type: `image/${ext === 'jpg' ? 'jpeg' : ext}` };
  } catch {
    return null;
  }
}

export async function saveReference(buf: Buffer, ext: string): Promise<StoredReference> {
  const clean = /^(png|jpe?g|webp)$/i.test(ext) ? ext.toLowerCase() : 'png';
  await fs.mkdir(DIR, { recursive: true });
  await clearReference(); // only one reference at a time
  const filename = `${STEM}.${clean}`;
  await fs.writeFile(path.join(DIR, filename), buf);
  return { filename, url: `/api/images/educative/${filename}` };
}

export async function clearReference(): Promise<void> {
  try {
    for (const f of readdirSync(DIR)) {
      if (f.startsWith(`${STEM}.`)) await fs.unlink(path.join(DIR, f));
    }
  } catch {
    // nothing saved
  }
}
