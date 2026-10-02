// Locating and rewriting the locally-stored images inside generated HTML.
//
// The pipeline writes GPT images to data/images/** and references them as /api/images/<path>.
// Every remote destination needs those bytes hosted on its own side before the post can go out,
// so each publisher: collects → uploads → rewrites. This module owns the collect and rewrite
// halves; the upload half is destination-specific.

import { promises as fs } from 'fs';
import path from 'path';

const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');
const LOCAL_PREFIX = '/api/images/';

export interface LocalImage {
  /** The src exactly as it appears in the HTML, e.g. /api/images/blogs/foo/img1-ab12.png */
  src: string;
  /** Absolute path on disk. */
  filePath: string;
  fileName: string;
  mimeType: string;
  /** Alt text / caption harvested from the surrounding markup. */
  alt: string;
}

function mimeFor(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

/**
 * Resolve a /api/images/... src to a path inside data/images, rejecting traversal.
 * Returns null for remote srcs or anything that escapes the images directory.
 */
export function resolveLocalImagePath(src: string): string | null {
  if (!src.startsWith(LOCAL_PREFIX)) return null;
  const rel = src.slice(LOCAL_PREFIX.length).split('?')[0].split('#')[0];
  const segments = rel.split('/').filter(Boolean);
  if (!segments.length || segments.some((s) => s === '..')) return null;
  const abs = path.join(IMAGES_DIR, ...segments);
  if (!abs.startsWith(IMAGES_DIR + path.sep)) return null;
  return abs;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Every distinct locally-hosted image referenced by the HTML, in document order. */
export function collectLocalImages(html: string): LocalImage[] {
  const seen = new Set<string>();
  const out: LocalImage[] = [];
  const re = /<img\s[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const src = decodeEntities(tag.match(/\ssrc\s*=\s*["']([^"']+)["']/i)?.[1] || '');
    if (!src || seen.has(src)) continue;
    const filePath = resolveLocalImagePath(src);
    if (!filePath) continue;
    seen.add(src);
    const fileName = path.basename(filePath);
    out.push({
      src,
      filePath,
      fileName,
      mimeType: mimeFor(fileName),
      alt: decodeEntities(tag.match(/\salt\s*=\s*["']([^"']*)["']/i)?.[1] || ''),
    });
  }
  return out;
}

export async function readImage(img: LocalImage): Promise<Buffer> {
  return fs.readFile(img.filePath);
}

function escapeAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Swap every local image reference for its uploaded counterpart.
 *
 * The pipeline emits `<figure class="widget-image">…</figure>` wrappers; those are replaced
 * wholesale with the destination's own figure markup (`figureFor`) so the post uses native
 * block classes. Any loose `<img>` outside such a figure just gets its src rewritten.
 */
export function rewriteImageSrcs(
  html: string,
  urlBySrc: Map<string, string>,
  figureFor?: (url: string, alt: string) => string,
): string {
  let out = html;

  if (figureFor) {
    out = out.replace(
      /<figure[^>]*class="[^"]*widget-image[^"]*"[^>]*>([\s\S]*?)<\/figure>/gi,
      (full, inner: string) => {
        const src = decodeEntities(inner.match(/<img\s[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '');
        const url = urlBySrc.get(src);
        if (!url) return full;
        const caption = decodeEntities(
          inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() ||
            inner.match(/<img\s[^>]*?\balt\s*=\s*["']([^"']*)["']/i)?.[1] ||
            '',
        );
        return figureFor(url, caption);
      },
    );
  }

  // Remaining loose <img> tags: rewrite src in place.
  out = out.replace(/<img\s[^>]*>/gi, (tag) => {
    const src = decodeEntities(tag.match(/\ssrc\s*=\s*["']([^"']+)["']/i)?.[1] || '');
    const url = urlBySrc.get(src);
    if (!url) return tag;
    return tag.replace(/(\ssrc\s*=\s*["'])[^"']+(["'])/i, `$1${escapeAttr(url)}$2`);
  });

  return out;
}

/** Local image srcs still present after a rewrite pass — surfaced as publish warnings. */
export function findUnresolvedImages(html: string): string[] {
  const out = new Set<string>();
  const re = /<img\s[^>]*?\bsrc\s*=\s*["'](\/api\/images\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.add(m[1]);
  // Markdown-style references too, for the dev.to path.
  const mdRe = /!\[[^\]]*\]\((\/api\/images\/[^)\s]+)/g;
  while ((m = mdRe.exec(html)) !== null) out.add(m[1]);
  return [...out];
}
