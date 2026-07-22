// Educative publish — mirrors the n8n "Markdown to HTML" → "Structure the Output" → "Sanitize and format"
// → "Make editor blocks" → individual widget builders → "Merge widgets" → create + upload sequence.

import { marked } from 'marked';

const EDUCATIVE_BASE = 'https://www.educative.io';

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${Math.random().toString(16).slice(2)}`;
}

// ---------- 1) Markdown → HTML (n8n "Markdown to HTML", noHeaderId equivalent) ----------
export function markdownToHtml(md: string): string {
  marked.setOptions({ gfm: true, breaks: false });
  const html = marked.parse(String(md ?? ''), { async: false }) as string;
  return html.replace(/\sid="[^"]*"/g, '');
}

// ---------- 2) Structure the Output (currently a passthrough; preserved for parity) ----------
export function structureOutput(text: string): string {
  return String(text ?? '');
}

// ---------- 3) Sanitize and format (the critical step) ----------
function stripPInsideBlockquotes(html: string): string {
  return html.replace(/(<blockquote\b[^>]*>)([\s\S]*?)(<\/blockquote>)/gi, (_, open, inner, close) =>
    open + inner.replace(/<\/?p\b[^>]*>/gi, '') + close,
  );
}

function transformContent(text: string): string {
  let content = String(text ?? '');
  content = content.replace(/\u2014/g, ',');
  content = content.replace(/"([^"]*)"/g, '&ldquo;$1&rdquo;');
  content = content.replace(/([a-zA-Z])'([a-zA-Z])/g, '$1&rsquo;$2');
  content = content.replace(/([sS])'(\s|$)/g, '$1&rsquo;$2');
  content = content.replace(/'([^']*)'/g, '&lsquo;$1&rsquo;');
  content = content.replace(/'/g, '&rsquo;');
  content = content.replace(/"/g, '&rdquo;');
  content = content.replace(/<a\b[^>]*>/gi, (m) => m.replace(/&quot;|"|&ldquo;|&rdquo;|&lsquo;|&rsquo;/gi, ''));
  return content.replace(/(\r\n|\n|\r)/gm, '');
}

function wrapImagePlaceholders(html: string): string {
  // n8n wraps [image]…[/image] inside <code>…</code> so the merge regex can match the placeholder later.
  return html.replace(/\[image\][\s\S]*?\[\/image\]/gi, (m) => `<code>${m}</code>`);
}

function transformTitle(t: string): string {
  if (!t) return t;
  return t
    .replace(/\u2014/g, ',')
    .replace(/"([^"]*)"/g, '&ldquo;$1&rdquo;')
    .replace(/([a-zA-Z])'([a-zA-Z])/g, '$1&rsquo;$2')
    .replace(/'([^']*)'/g, '&lsquo;$1&rsquo;')
    .replace(/"/g, '&rdquo;')
    .replace(/'/g, '&rsquo;');
}

export function sanitizeAndFormat(args: { html: string; rawMarkdown?: string; fallbackTitle?: string }): {
  cleanedHtml: string;
  title: string;
} {
  const noP = stripPInsideBlockquotes(args.html);
  const wrapped = wrapImagePlaceholders(noP);
  const transformed = transformContent(wrapped);
  const cleanedHtml = JSON.stringify(transformed).slice(1, -1);

  // Title: first markdown # heading, or first <h1>, else fallback
  let title = args.fallbackTitle || 'Untitled Blog';
  const md = String(args.rawMarkdown ?? '');
  const lines = md.split('\n');
  const firstLine = lines.length ? lines[0].trim() : '';
  if (firstLine.startsWith('#')) title = firstLine.replace(/^#+\s*/, '').trim();
  else {
    const h1 = (args.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
    if (h1) title = h1.replace(/<\/?[^>]+(>|$)/g, '').trim();
  }
  return { cleanedHtml, title: transformTitle(title) };
}

// ---------- 4) Slate / widget block factories ----------
export function makeSlate(html: string) {
  const trimmed = String(html || '').trim();
  if (!trimmed) return null;
  return { type: 'SlateHTML', content: { html: trimmed, comp_id: uid('slate') }, hash: 0 };
}

// ---------- 5) Code widget — full Educative v8.0 schema ----------
const LANG_MAP: Record<string, string> = {
  js: 'javascript', node: 'javascript', ts: 'typescript', py: 'python',
  cpp: 'c++', csharp: 'c#', golang: 'go', sh: 'bash', shell: 'bash',
  txt: 'text', plaintext: 'text',
};
const KNOWN_LANGS = new Set([
  'sql', 'c++', 'javascript', 'python', 'java', 'go', 'ruby', 'php', 'typescript', 'bash', 'c#', 'text',
]);
const DEFAULT_ENTRY: Record<string, string> = {
  python: 'main.py', 'c++': 'main.cpp', javascript: 'index.js', typescript: 'index.ts',
  java: 'Main.java', go: 'main.go', ruby: 'main.rb', php: 'index.php',
  sql: 'query.sql', bash: 'script.sh', 'c#': 'Program.cs', text: 'main.txt',
};
function normalizeLanguage(g: string): string {
  const guess = String(g || '').trim().toLowerCase();
  const mapped = LANG_MAP[guess] || guess;
  return KNOWN_LANGS.has(mapped) ? mapped : (mapped || 'text');
}
function titleCaseLang(l: string): string {
  if (l === 'c++') return 'C++';
  if (l === 'c#') return 'C#';
  if (l === 'javascript') return 'JavaScript';
  if (l === 'typescript') return 'TypeScript';
  return l ? l.charAt(0).toUpperCase() + l.slice(1) : 'Code';
}

// n8n-style parser — accepts the raw "Language: ... Caption: ... Code: ..." text from the LLM.
export function parseCodeOutput(raw: any): { language: string; caption: string; code: string } | null {
  if (!raw) return null;
  if (typeof raw === 'object' && (raw.language || raw.Language || raw.code || raw.Code)) {
    return {
      language: String(raw.language ?? raw.Language ?? '').trim(),
      caption: String(raw.caption ?? raw.Caption ?? '').trim(),
      code: String(raw.code ?? raw.Code ?? '').trim(),
    };
  }
  let s = String(raw).replace(/\r\n?/g, '\n').trim();
  s = s.replace(/^\s*\{\s*\n?/, '').replace(/\n?\s*\}\s*$/, '');
  const capM = s.match(/^\s*Caption:\s*(.*)\s*$/im);
  const langM = s.match(/^\s*Language:\s*(.*)\s*$/im);
  const fenceM = s.match(/```([a-zA-Z0-9+#_-]*)\s*([\s\S]*?)```/m);
  let codeBody = '';
  let fenceLang = '';
  if (fenceM) {
    fenceLang = (fenceM[1] || '').trim();
    codeBody = (fenceM[2] || '').trim();
  } else {
    const codeLabel = /(^|\n)\s*Code\s*:\s*/i.exec(s);
    if (codeLabel) codeBody = s.slice(codeLabel.index + codeLabel[0].length).trim();
    else codeBody = s.replace(/^\s*Caption:.*$/im, '').replace(/^\s*Language:.*$/im, '').trim();
  }
  const language = (langM ? langM[1].split(/[,\s|/]+/)[0] : fenceLang) || '';
  if (!codeBody) return null;
  return { language, caption: capM ? capM[1].trim() : '', code: codeBody };
}

export function makeCodeBlock(payload: any): any {
  const parsed = (payload && typeof payload === 'object' && (payload.language || payload.code))
    ? { language: String(payload.language || ''), caption: String(payload.caption || ''), code: String(payload.code || '') }
    : parseCodeOutput(payload);
  if (!parsed || !parsed.code.trim()) return null;
  const language = normalizeLanguage(parsed.language);
  const codeBody = parsed.code;
  const caption = parsed.caption;
  const widgetTitle = titleCaseLang(language);
  const entry = DEFAULT_ENTRY[language] || 'main.txt';
  return {
    type: 'Code',
    mode: 'edit',
    content: {
      version: '8.0',
      caption,
      language,
      title: '',
      theme: 'default',
      additionalContent: [],
      selectedIndex: 0,
      runnable: false,
      judge: false,
      staticEntryFileName: true,
      judgeContent: null,
      judgeHints: null,
      allowDownload: false,
      treatOutputAsHTML: false,
      enableHiddenCode: false,
      enableStdin: false,
      evaluateWithoutExecution: false,
      showSolution: false,
      widgetTitle,
      timeLimit: 30,
      stdoutLimit: 3072,
      hiddenCodeContent: { prependCode: '\\n\\n', appendCode: '\\n\\n', codeSelection: 'prependCode' },
      dockerJob: {},
      selectedApiKeys: {},
      selectedEnvVars: {},
      specialInput: 'no-input',
      solutionContent: '\\n\\n\\n',
      judgeContentPrepend: '\\n\\n\\n',
      evaluateLanguage: language,
      isCodeDrawing: false,
      content: codeBody,
      comp_id: uid('code'),
      entryFileName: entry,
      staticEntryName: false,
      defaultSelectedFile: entry,
    },
    iteration: 1,
    hash: 1,
    children: [{ text: '' }],
    status: 'normal',
    contentID: uid('code'),
    saveVersion: 1,
  };
}

// ---------- 6) Table widget ----------
function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function inlineMdToHtml(s: string): string {
  let t = escHtml(String(s ?? ''));
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[\s(])\*(.+?)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  return t;
}
// n8n-style parser — accepts raw "Table title: ... | h1 | h2 |\n|---|---|\n| a | b |" text.
export function parseTableOutput(raw: any): { title: string; rows: string[][] } | null {
  if (!raw) return null;
  if (typeof raw === 'object' && (raw.headers || raw.rows)) {
    const headers = raw.headers || raw.columns || [];
    const rows = [headers, ...(raw.rows || [])].filter((r: any[]) => Array.isArray(r) && r.length);
    if (!rows.length) return null;
    return { title: String(raw.title || raw.caption || ''), rows };
  }
  let s = String(raw).replace(/\r\n?/g, '\n').trim();
  s = s.replace(/^\s*\{\s*\n?/, '').replace(/\n?\s*\}\s*$/, '');
  const titleM = s.match(/^\s*Table title:\s*(.*)\s*$/im);
  const title = titleM ? titleM[1].trim() : '';
  const lines = s.split('\n');
  // A separator cell is all dashes/colons (GFM: at least one dash)
  const isSepCell = (c: string) => /^:?-+:?$/.test(c.trim());
  // A separator row: every non-empty cell is a sep cell (handles with or without leading |)
  const isSepRow = (line: string) => {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()).filter(Boolean);
    return cells.length > 0 && cells.every(isSepCell);
  };
  // A data row: contains at least one | and is not a separator row
  const isDataRow = (line: string) => /\|/.test(line) && !isSepRow(line);
  const splitRow = (line: string) => {
    const t = line.trim();
    const stripped = t.startsWith('|') && t.endsWith('|') ? t.slice(1, -1) : t;
    return stripped.split('|').map((c) => c.trim());
  };
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isDataRow(lines[i]) && i + 1 < lines.length && isSepRow(lines[i + 1])) { start = i; break; }
  }
  if (start === -1) return null;
  const tableLines = [lines[start]];
  for (let j = start + 2; j < lines.length; j++) {
    if (!isDataRow(lines[j])) break;
    tableLines.push(lines[j]);
  }
  const rows = tableLines.map(splitRow);
  if (!rows.length || !rows[0].length) return null;
  return { title, rows };
}

export function makeTableBlock(payload: any): any {
  const parsed = (payload && typeof payload === 'object' && (payload.headers || payload.rows))
    ? parseTableOutput(payload)
    : parseTableOutput(payload);
  if (!parsed) return null;
  const allRows = parsed.rows;
  const cols = allRows[0]?.length || 0;
  return {
    type: 'Table',
    mode: 'edit',
    content: {
      version: '2.0',
      comp_id: uid('table'),
      numberOfRows: allRows.length,
      numberOfColumns: cols,
      columnWidths: Array(cols).fill(250),
      data: allRows.map((r) => r.map((c) => `<p>${inlineMdToHtml(String(c).trim())}</p>`)),
      mergeInfo: {},
      customStyles: allRows.map((r) => r.map(() => ({}))),
      template: 1,
      title: parsed.title,
      titleAlignment: 'align-center',
    },
    iteration: 1,
    hash: 1,
    children: [{ text: '' }],
    status: 'normal',
    contentID: uid('table'),
    saveVersion: 1,
  };
}

// ---------- 7) Image widget (GPT-generated) ----------
export function makeImageBlock(imageUrl: string, caption: string): any {
  return {
    type: 'Image',
    mode: 'edit',
    content: {
      comp_id: uid('img'),
      url: imageUrl,
      alt: caption || '',
      caption: caption || '',
      width: 1536,
      height: 1024,
    },
    iteration: 1,
    hash: 0,
    children: [{ text: '' }],
    status: 'normal',
    saveVersion: 1,
  };
}

// ---------- 8) Chart widget ----------
export function makeChartBlock(config: any, caption: string): any {
  const chartType = config?.type || 'bar';
  const configObj = {
    type: chartType,
    data: config?.data ?? { labels: [], datasets: [] },
    options: config?.options ?? {},
  };
  return {
    type: 'Chart',
    mode: 'edit',
    content: {
      config: JSON.stringify(configObj, null, 2),
      type: chartType,
      comp_id: uid('chart'),
      caption: caption || '',
    },
    iteration: 0,
    hash: 0,
    children: [{ text: '' }],
    status: 'normal',
    saveVersion: 1,
  };
}

// ---------- 9) Merge widgets — n8n "Merge widgets" replicated ----------
// Walks the cleaned HTML (which contains [code]/[table] placeholders and <code>[image]…</code> placeholders),
// inserts widgets in order. Image placeholders are filled by D2 first (keyed by d2OrderIds), then Chart
// (keyed by chartOrderIds), else left as a SlateHTML carrying the placeholder text.
const RE_CODE_TABLE = /\[(table|code)\]\s*([\s\S]*?)\s*\[\/\1\]/gi;
const RE_IMAGE_WRAPPED = /<code>\s*\[image\]\s*([\s\S]*?)\s*\[\/image\]\s*<\/code>/gi;

export function mergeBlocks(args: {
  cleanedHtml: string;
  codeBlocks: any[];
  tableBlocks: any[];
  imageBlocks: any[]; // aligned to image extraction order — each entry is a D2 or Chart block
}): any[] {
  const html = String(args.cleanedHtml || '');

  type Hit = { type: 'ct' | 'img'; index: number; end: number; match: string; tag?: string };
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;
  RE_CODE_TABLE.lastIndex = 0;
  while ((m = RE_CODE_TABLE.exec(html))) hits.push({ type: 'ct', index: m.index, end: RE_CODE_TABLE.lastIndex, match: m[0], tag: m[1].toLowerCase() });
  RE_IMAGE_WRAPPED.lastIndex = 0;
  while ((m = RE_IMAGE_WRAPPED.exec(html))) hits.push({ type: 'img', index: m.index, end: RE_IMAGE_WRAPPED.lastIndex, match: m[0] });
  hits.sort((a, b) => a.index - b.index);

  const blocks: any[] = [];
  let cursor = 0;
  let codeIdx = 0;
  let tableIdx = 0;
  let imageIdx = 0;
  const push = (b: any) => { if (b) blocks.push(b); };

  for (const hit of hits) {
    push(makeSlate(html.slice(cursor, hit.index)));
    if (hit.type === 'ct') {
      if (hit.tag === 'code') {
        if (codeIdx < args.codeBlocks.length) blocks.push(args.codeBlocks[codeIdx++]);
        else push(makeSlate(hit.match));
      } else if (hit.tag === 'table') {
        if (tableIdx < args.tableBlocks.length) blocks.push(args.tableBlocks[tableIdx++]);
        else push(makeSlate(hit.match));
      }
    } else {
      // Image placeholder: pick next image block in extraction order, regardless of d2/chart kind.
      if (imageIdx < args.imageBlocks.length && args.imageBlocks[imageIdx]) {
        blocks.push(args.imageBlocks[imageIdx]);
      } else {
        push(makeSlate(hit.match));
      }
      imageIdx += 1;
    }
    cursor = hit.end;
  }
  push(makeSlate(html.slice(cursor)));

  // Fallback: if sentinels were dropped by an editorial LLM the widgets have no placeholder to
  // land on — append them at the end so they are always included in the published output.
  while (codeIdx < args.codeBlocks.length) push(args.codeBlocks[codeIdx++]);
  while (tableIdx < args.tableBlocks.length) push(args.tableBlocks[tableIdx++]);
  while (imageIdx < args.imageBlocks.length) {
    const imgBlock = args.imageBlocks[imageIdx++];
    if (imgBlock) push(imgBlock);
  }

  return blocks;
}

// ---------- 10) Educative HTTP ----------
interface EducativeEnv {
  flaskAuth: string;
  templateId: string;
}
function readEnv(): EducativeEnv {
  const flaskAuth = process.env.EDUCATIVE_FLASK_AUTH || '';
  if (!flaskAuth) throw new Error('EDUCATIVE_FLASK_AUTH is not set');
  return {
    flaskAuth,
    templateId: process.env.EDUCATIVE_TEMPLATE_ID || '5002',
  };
}

export async function createBlog(templateId?: string): Promise<{ editor_page_id: string; page_id: string }> {
  const env = readEnv();
  const tid = templateId || env.templateId;
  const res = await fetch(`${EDUCATIVE_BASE}/api/page/editor/${tid}/create`, {
    method: 'POST',
    headers: { Cookie: `flask-auth=${env.flaskAuth}` },
  });
  if (!res.ok) throw new Error(`Educative create blog failed: ${res.status} ${await res.text()}`);
  const json: any = await res.json();
  const body = json?.body || json;
  return { editor_page_id: String(body.editor_page_id), page_id: String(body.page_id) };
}

export async function uploadBlog(args: { editorPageId: string; title: string; blocks: any[]; categories?: string }): Promise<void> {
  const env = readEnv();
  const innerObj: any = {
    marketing_page_id: args.editorPageId,
    marketing_page_title: args.title.slice(0, 65),
    marketing_page_summary: '',
    marketing_page_title_eyebrow: '',
    marketing_page_meta_description: '',
    marketing_page_cta: '',
    marketing_page_top_cta: '',
    marketing_page_version: 'v2',
    marketing_page_disable_nav_header: false,
    marketing_page_add_bullet_points: false,
    marketing_page_bullet_points: [''],
    marketing_page_cover_image_alignment: 'center',
    marketing_page_cover_image_url: '',
    marketing_page_hubspot_form_media: {
      formId: '', portalId: '', formBackgroundColor: '#ffffff',
      imageRedirectionUrl: '', imageAltText: '',
      image: { path: '', metadata: { width: 0, height: 0, sizeInBytes: 0, name: '' }, type: 'image/png' },
    },
    marketing_page_cta_button_height: 'h-11',
    marketing_page_bottom_second_cta: '',
    marketing_page_bottom_second_cta_url: '',
    marketing_page_top_cta_button_height: 'h-11',
    marketing_page_cta_button_color: '#5553FF',
    marketing_page_top_cta_button_color: '#5553FF',
    marketing_page_cta_button_alignment: 'align_left',
    marketing_page_top_cta_button_alignment: 'align_left',
    marketing_page_selected_media_type: 'Image',
    marketing_page_video_url: '',
    marketing_page_header_title: '',
    marketing_page_calender_url: '',
    marketing_page_video_autoplay: false,
    marketing_page_video_loop: false,
    marketing_page_video_controls: true,
    marketing_page_mdHtml_title: '',
    marketing_page_mdHtml_summary: '',
    marketing_page_cover_shadow: '',
    marketing_page_cta_redirect_url: '',
    marketing_page_top_cta_redirect_url: '',
    marketing_page_top_cta_email_popup_settings: { heading: '', body: '', borderColor: '' },
    marketing_page_cta_email_popup_settings: { heading: '', body: '', borderColor: '' },
    marketing_page_cta_type: '',
    marketing_page_top_cta_type: '',
    marketing_page_cta_hubspot_modal: {},
    marketing_page_top_cta_hubspot_modal: {},
    marketing_page_summary_background: '',
    tags: '',
    marketing_page_content: args.blocks,
    marketing_page_url: args.title.slice(0, 65),
    parent_url: '',
    canonical_url: '',
    cover_image_alt_text: '',
    enable_cover_image_in_published_mode: false,
    visibility: 8001,
    author_name: '',
    author_email: '',
    author_email_full_name: '',
    profile_image_serving_url: '',
    author_id: '',
    published_date: '',
    redirect_url: '',
    page_cover_image: {},
    api_keys: '[]',
    categories: '[]',
    is_newsletter_unlocked: false,
    scheduled_publish_date: '',
  };
  const outer: any = {
    ...innerObj,
    ...(args.categories ? { categories: args.categories } : {}),
    marketing_page_content: JSON.stringify(innerObj),
  };
  const res = await fetch(`${EDUCATIVE_BASE}/api/page/editor/${args.editorPageId}`, {
    method: 'PUT',
    headers: {
      Cookie: `flask-auth=${env.flaskAuth}`,
      'X-Etag': 'overwrite',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(outer),
  });
  if (!res.ok) throw new Error(`Educative upload blog failed: ${res.status} ${await res.text()}`);
}

// Get the image upload slot for a specific blog page.
// n8n: GET /api/page/editor/{pageId}/image/upload/url → { upload_url, image_id?, ... }
export async function getImageUploadUrl(
  pageId: string,
): Promise<{ uploadUrl: string; imageId: string } | null> {
  const env = readEnv();
  try {
    const res = await fetch(`${EDUCATIVE_BASE}/api/page/editor/${pageId}/image/upload/url`, {
      headers: { Cookie: `flask-auth=${env.flaskAuth}` },
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const uploadUrl = json?.upload_url || json?.uploadUrl;
    if (!uploadUrl) return null;
    return {
      uploadUrl: String(uploadUrl),
      imageId: String(json?.image_id || json?.imageId || ''),
    };
  } catch {
    return null;
  }
}

// Upload image as multipart form-data (field name "file-0", matching n8n workflow).
// Returns { page_id, image_id } from the Educative response, or null on failure.
export async function uploadImageMultipart(
  uploadUrl: string,
  buffer: Buffer,
  filename: string,
): Promise<{ page_id: string; image_id: string } | null> {
  const env = readEnv();
  try {
    const formData = new FormData();
    formData.append('file-0', new Blob([buffer as unknown as ArrayBuffer], { type: 'image/png' }), filename);
    const res = await fetch(`${EDUCATIVE_BASE}${uploadUrl}`, {
      method: 'POST',
      headers: { Cookie: `flask-auth=${env.flaskAuth}`, 'X-Etag': 'overwrite' },
      body: formData,
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    return {
      page_id: String(json?.page_id || json?.pageId || ''),
      image_id: String(json?.image_id || json?.imageId || ''),
    };
  } catch {
    return null;
  }
}

// Build an Educative Image block using the path returned after upload.
// path format: /api/page/{page_id}/image/download/{image_id}
export function makeEducativeImageBlock(imagePath: string, caption: string, sizeInBytes = 0): any {
  return {
    type: 'Image',
    mode: 'edit',
    content: {
      path: imagePath,
      metadata: { width: 1536, height: 1024, sizeInBytes, name: 'image.png' },
      caption: caption || '',
      borderColor: '#000000',
      version: 3,
      alignment: 'center',
      redirectionUrl: '',
      comp_id: uid('img'),
      width: 668,
      imageType: 'data:image/png',
    },
    iteration: 23,
    hash: 0,
    children: [{ text: '' }],
    status: 'normal',
    contentID: uid('img'),
    saveVersion: 1,
  };
}

export function blogUrlForPageId(pageId: string, type: 'blog' | 'newsletter' = 'blog'): string {
  return `${EDUCATIVE_BASE}/editor/editor-page/${type}/${pageId}`;
}
