// Fetch a lesson's authored content for answering content queries.
//
// Ported from the n8n "HTTP Request6 → Content cleaner → Markdown" chain. A
// page is a component tree carrying far more than prose — quizzes, notepads,
// lazy-load placeholders — so only the parts a reader actually reads are kept,
// in document order, then converted to markdown for the model.

import { htmlToMarkdown } from './publishers/htmlToMarkdown';

const BASE = 'https://www.educative.io';

function pickAuth(authorId: string): string {
  const own = (process.env.EDUCATIVE_AUTHOR_ID || '').trim();
  const flask = (process.env.EDUCATIVE_FLASK_AUTH || '').trim();
  const course = (process.env.EDUCATIVE_COURSE_FLASK_AUTH || '').trim();
  // Collections owned by the configured author use the course cookie; everything
  // else uses the general one. Matches the rule in courseEducative.
  if (own && authorId === own) return course || flask;
  return flask || course;
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function imgSrc(path: unknown): string {
  const clean = String(path || '').split('?')[0];
  if (!clean) return '';
  return `${BASE}${clean.startsWith('/') ? clean : `/${clean}`}`;
}

function htmlTable(rows: unknown): string {
  if (!Array.isArray(rows) || !rows.length) return '';
  const body = rows
    .filter((r): r is unknown[] => Array.isArray(r))
    .map((r) => `<tr>${r.map((c) => `<td>${typeof c === 'string' ? c : ''}</td>`).join('')}</tr>`)
    .join('');
  return body ? `<table>${body}</table>` : '';
}

function imagePlaceholder(src: string, caption: unknown): string {
  const cap = String(caption ?? '').trim();
  return `[image]${src}${cap ? `\n${cap}` : ''}[/image]`;
}

/** Keep SlateHTML, Table, DrawIO images, and Slate-ish widgets nested in Columns. */
export function extractLessonHtml(page: any): string {
  const components: any[] = Array.isArray(page?.components) ? page.components : [];
  const out: string[] = [];

  const drawio = (w: any) => {
    const src = imgSrc(w?.content?.path);
    if (!src) return;
    const caption =
      w?.content?.caption ||
      (Array.isArray(w?.content?.slidesCaption) ? w.content.slidesCaption.join('\n') : '') ||
      '';
    out.push(imagePlaceholder(src, caption));
  };

  const take = (w: any) => {
    if (!w || typeof w !== 'object') return;

    if (w.type === 'SlateHTML' && nonEmpty(w?.content?.html)) return void out.push(w.content.html.trim());
    if (w.type === 'Table' && Array.isArray(w?.content?.data)) {
      const t = htmlTable(w.content.data);
      if (t) out.push(t);
      return;
    }
    if (w.type === 'DrawIOWidget') return drawio(w);

    if (w.type === 'Columns' && Array.isArray(w?.content?.comps)) {
      for (const c of w.content.comps) {
        if (c?.type === 'MarkdownEditor' && nonEmpty(c?.content?.mdHtml)) { out.push(c.content.mdHtml.trim()); continue; }
        if (c?.type === 'DrawIOWidget') { drawio(c); continue; }
        if (c?.type === 'SlateHTML' && nonEmpty(c?.content?.html)) { out.push(c.content.html.trim()); continue; }
        if (c?.type === 'Table' && Array.isArray(c?.content?.data)) {
          const t = htmlTable(c.content.data);
          if (t) out.push(t);
        }
      }
    }
  };

  for (const w of components) take(w);
  return out.join('\n\n');
}

export interface LessonImage {
  src: string;
  caption: string;
}

export interface LessonContent {
  title: string;
  markdown: string;
  url: string;
  images: LessonImage[];
}

/** Pull the [image]src\ncaption[/image] placeholders the cleaner emits. */
export function extractLessonImages(html: string): LessonImage[] {
  const out: LessonImage[] = [];
  const re = /\[image\]([^\n\[]+)(?:\n([\s\S]*?))?\[\/image\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const src = (m[1] || '').trim();
    if (src) out.push({ src, caption: (m[2] || '').trim() });
  }
  return out;
}

/**
 * Download a lesson image and return it as a data URL. Educative assets sit
 * behind the same cookie as the page, so they cannot simply be handed to the
 * model as a link.
 */
export async function fetchImageAsDataUrl(src: string, authorId: string): Promise<string | null> {
  const auth = pickAuth(authorId);
  if (!auth) return null;
  try {
    const res = await fetch(src, {
      headers: {
        Cookie: `flask-auth=${auth}`,
        'User-Agent': 'EducativeContentStudio/1.0 (+https://www.educative.io)',
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/png';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Keep well under the request ceiling; a huge diagram adds nothing legible.
    if (buf.length > 4_500_000) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Load one lesson as markdown. Returns null when the ids are incomplete or the
 * page cannot be read, so callers can fall back to answering without it.
 */
export async function fetchLessonMarkdown(
  authorId: string,
  collectionId: string,
  pageId: string,
): Promise<LessonContent | null> {
  if (!authorId || !collectionId || !pageId) return null;
  const auth = pickAuth(authorId);
  if (!auth) throw new Error('EDUCATIVE_FLASK_AUTH is not set');

  // The n8n flow uses /api/collection/...; older code uses /api/author/...
  // Try both so a shape change on either side does not break the lookup.
  const urls = [
    `${BASE}/api/collection/${authorId}/${collectionId}/page/${pageId}`,
    `${BASE}/api/author/${authorId}/collection/${collectionId}/page/${pageId}`,
  ];

  for (const url of urls) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Cookie: `flask-auth=${auth}`,
          Accept: 'application/json',
          'User-Agent': 'EducativeContentStudio/1.0 (+https://www.educative.io)',
        },
      });
    } catch {
      continue;
    }
    if (!res.ok) continue;

    let json: any;
    try {
      json = await res.json();
    } catch {
      continue;
    }

    const body = json?.body || json;
    let content = body?.page_content ?? body;
    if (typeof content === 'string') {
      try { content = JSON.parse(content); } catch { continue; }
    }

    const html = extractLessonHtml(content);
    if (!html) continue;

    return {
      title: body?.page_title || '',
      markdown: htmlToMarkdown(html).trim(),
      url: `${BASE}/collection/page/${authorId}/${collectionId}/${pageId}`,
      images: extractLessonImages(html),
    };
  }
  return null;
}
