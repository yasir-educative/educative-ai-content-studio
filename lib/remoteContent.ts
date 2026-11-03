import { createHash } from 'crypto';

/** Stable key order, so the same content always hashes the same. */
function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJSON((value as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The components payload of an Educative page, however the API wrapped it. */
export function pageContent(page: any): any {
  const body = page?.body || page;
  const raw = body?.page_content ?? body;
  const content = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!content || !Array.isArray(content.components)) throw new Error('Educative returned unreadable page content');
  return content;
}

/**
 * Fingerprint of a page as we last read or wrote it. Lets a later save tell
 * "unchanged since we imported it" from "someone edited this in Educative".
 */
export function remoteContentHash(content: unknown): string {
  return createHash('sha256').update(canonicalJSON(content)).digest('hex');
}
