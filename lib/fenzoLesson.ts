// Fenzo PAL lesson content, for queries raised on the Fenzo Support Board.
//
// FSB tickets carry the lesson's sll_id directly (field "Sll Id", or the
// /pal/<sll_id>/ path in Feedback Url), so the planner and TOC lookups that
// discover ids for a whole collection are not needed here.
//
// Content comes from two log endpoints per lesson. Both return an
// array-of-arrays of log lines; the useful values are prefixed strings, some
// with JSON after the prefix.

export type FenzoPlatform = 'fenzo' | 'master';

export interface FenzoTarget {
  platform: FenzoPlatform;
  /** API base, including /api. */
  base: string;
}

const FENZO_PROD = 'https://fenzo.ai/api';

/**
 * Which platform a ticket points at, read from its Feedback Url. A master or
 * PR environment lives on *.x.eduqative.com and keeps its own host, so the
 * base is taken from the URL rather than assumed.
 */
export function resolveTarget(...texts: (string | undefined)[]): FenzoTarget {
  const text = texts.filter(Boolean).join('\n');
  const m = text.match(/https?:\/\/([a-z0-9._-]*\.x\.eduqative\.com)/i);
  if (m) return { platform: 'master', base: `https://${m[1]}/api` };
  return { platform: 'fenzo', base: (process.env.FENZO_BASE_URL || FENZO_PROD).replace(/\/+$/, '') };
}

/**
 * fenzo.ai uses fenzo-session + magicbox-auth; *.x.eduqative.com uses
 * flask-auth2. Sending the wrong pair reads as an expired session.
 */
function cookieHeader(platform: FenzoPlatform): string {
  if (platform === 'master') {
    const f2 = (process.env.FENZO_FLASK_AUTH2 || '').trim();
    return f2 ? `flask-auth2=${f2}` : '';
  }
  const parts: string[] = [];
  const session = (process.env.FENZO_SESSION || '').trim();
  const magic = (process.env.FENZO_MAGICBOX_AUTH || '').trim();
  if (session) parts.push(`fenzo-session=${session}`);
  if (magic) parts.push(`magicbox-auth=${magic}`);
  return parts.join('; ');
}

export function fenzoConfigured(platform: FenzoPlatform = 'fenzo'): boolean {
  return cookieHeader(platform).length > 0;
}

async function getLog(t: FenzoTarget, path: string): Promise<any[]> {
  const cookie = cookieHeader(t.platform);
  if (!cookie) {
    throw new Error(
      t.platform === 'master'
        ? 'FENZO_FLASK_AUTH2 is not set (needed for *.x.eduqative.com)'
        : 'FENZO_SESSION and FENZO_MAGICBOX_AUTH are not set (needed for fenzo.ai)',
    );
  }
  const res = await fetch(`${t.base}${path}`, {
    headers: {
      Cookie: cookie,
      Accept: 'application/json',
      'User-Agent': 'EducativeContentStudio/1.0 (+https://www.educative.io)',
    },
  });
  // A 401 here means the cookie expired, not that auth was never sent.
  if (res.status === 401) throw new Error(`${t.platform} returned 401 for ${path} — the session cookie has expired`);
  if (!res.ok) throw new Error(`${t.platform} ${res.status} for ${path}`);
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

/** Log payloads nest arrays; flatten to the strings so prefixes can be matched. */
function lines(log: any[]): string[] {
  const out: string[] = [];
  const walk = (v: any) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(log);
  return out;
}

const after = (ls: string[], prefix: string): string | null => {
  const hit = ls.find((l) => l.includes(prefix));
  return hit ? hit.slice(hit.indexOf(prefix) + prefix.length).trim() : null;
};

function jsonAfter<T = any>(ls: string[], prefix: string): T | null {
  const raw = after(ls, prefix);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Some entries wrap the payload in prose; take the first balanced object.
    const i = raw.search(/[[{]/);
    if (i < 0) return null;
    try { return JSON.parse(raw.slice(i)) as T; } catch { return null; }
  }
}

export interface FenzoWidget {
  section_index: number;
  widget_type: string;
  widget_spec: any;
  widget_output: any;
  widget_mode: string;
  resolved_prompt: string;
}

export interface FenzoLesson {
  platform: FenzoPlatform;
  sll_id: string;
  lesson_title: string;
  lesson_content: string;
  components: any[];
  widgets_injected: FenzoWidget[];
}

// Generator responses appear as either "<gen> (fenzo): Response: " or
// "<gen>: Response: " depending on environment. Matching only one shape
// silently yields empty widget output on the other.
const RESPONSE_RE = /^(.*?)(?: \(fenzo\))?: Response:\s*/;
const ILLUSTRATION_RE = /illustration_generator: type:\s*(d2|mermaid|graphviz|svg|ai_image|p5)\s+Response:\s*/;

function parseWidgetSections(log: any[]): FenzoWidget[] {
  const ls = lines(log);
  const marks: number[] = [];
  ls.forEach((l, i) => { if (l.includes('[generate-widget] Received request')) marks.push(i); });
  if (!marks.length) return [];

  const out: FenzoWidget[] = [];
  for (let m = 0; m < marks.length; m++) {
    const seg = ls.slice(marks[m], marks[m + 1] ?? ls.length);
    const req = jsonAfter<any>(seg, '[generate-widget] Received request') || {};
    const inj = jsonAfter<any>(seg, '[interactivity_injector]') || {};

    let output: any = null;
    const ill = seg.find((l) => ILLUSTRATION_RE.test(l));
    if (ill) {
      try { output = JSON.parse(ill.replace(new RegExp(`^.*${ILLUSTRATION_RE.source}`), '')); }
      catch { output = ill.replace(new RegExp(`^.*${ILLUSTRATION_RE.source}`), '').trim(); }
    } else {
      const respLine = seg.find((l) => /: Response:\s*/.test(l) && !l.includes('illustration_enhancer'));
      if (respLine) {
        const body = respLine.slice(respLine.indexOf(': Response:') + ': Response:'.length).trim();
        try { output = JSON.parse(body); } catch { output = body; }
      }
    }

    out.push({
      section_index: Number(req.section_index ?? inj.section_index ?? m) || m,
      widget_type: String(req.widget_type || req.type || inj.widget_type || ''),
      widget_spec: req.widget_spec ?? req.spec ?? req,
      widget_output: output,
      widget_mode: String(inj.widget_mode || inj.mode || req.mode || ''),
      resolved_prompt: after(seg, '[interactivity_injector] Resolved prompt') || '',
    });
  }
  return out.sort((a, b) => a.section_index - b.section_index);
}

/** One Fenzo lesson: its markdown plus the widgets injected into it. */
export async function fetchFenzoLesson(
  sllId: string,
  target: FenzoTarget = { platform: 'fenzo', base: FENZO_PROD },
): Promise<FenzoLesson | null> {
  if (!sllId) return null;
  const [textLog, widgetLog] = await Promise.all([
    getLog(target, `/sll/${encodeURIComponent(sllId)}/logs`),
    getLog(target, `/sll/${encodeURIComponent(sllId)}/widget_log`).catch(() => [] as any[]),
  ]);

  const ls = lines(textLog);
  const props = jsonAfter<any>(ls, 'Got props') || {};
  const content = after(ls, 'content_generator: Response: ') || '';
  if (!content) return null;

  return {
    platform: target.platform,
    sll_id: String(props.sll_id || sllId),
    lesson_title: String(props.user_query || ''),
    lesson_content: content,
    components: jsonAfter<any[]>(ls, 'stream: widgets: ') || [],
    widgets_injected: parseWidgetSections(widgetLog),
  };
}

/** Render a Fenzo lesson as the markdown the analysis step reads. */
export function fenzoLessonToMarkdown(l: FenzoLesson): string {
  const parts = [l.lesson_content.trim()];
  // Sort here too: the parser orders them, but this is a public shape.
  for (const w of [...l.widgets_injected].sort((a, b) => a.section_index - b.section_index)) {
    if (!w.widget_type) continue;
    const body =
      typeof w.widget_output === 'string'
        ? w.widget_output
        : w.widget_output
          ? JSON.stringify(w.widget_output, null, 1).slice(0, 2000)
          : '';
    if (!body) continue;
    parts.push(`### Widget ${w.section_index + 1}: ${w.widget_type}${w.widget_mode ? ` (${w.widget_mode})` : ''}\n${body}`);
  }
  return parts.join('\n\n');
}

/** sll_id from the FSB ticket: the dedicated field, or the /pal/<id>/ URL. */
export function extractSllId(...texts: (string | undefined)[]): string {
  const text = texts.filter(Boolean).join('\n');
  const field = text.match(/\bsll[_ ]?id\b\s*[:=]?\s*(\d{6,})/i);
  if (field) return field[1];
  const url = text.match(/fenzo\.ai\/pal\/(\d{6,})/i);
  return url ? url[1] : '';
}
