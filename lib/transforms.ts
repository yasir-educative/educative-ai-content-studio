// Text transforms and widget extraction helpers - replicates the JS code nodes from the n8n workflow.
import { marked } from 'marked';

export function sanitizeText(input: string): string {
  if (!input) return '';
  return input
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ');
}

export interface ExtractedBlock {
  type: 'code' | 'table' | 'image';
  order: number;
  rawTag: string;
  payload: any;
}

// Extract [code]...[/code], [table]...[/table], [image]...[/image] tagged blocks plus their JSON payloads.
export function extractWidgetTags(text: string): { codes: ExtractedBlock[]; tables: ExtractedBlock[]; images: ExtractedBlock[] } {
  const codes: ExtractedBlock[] = [];
  const tables: ExtractedBlock[] = [];
  const images: ExtractedBlock[] = [];
  let order = 0;
  const re = /\[(code|table|image)\]([\s\S]*?)\[\/\1\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    order += 1;
    const inner = match[2].trim();
    let payload: any = inner;
    try {
      payload = JSON.parse(stripFences(inner));
    } catch {
      payload = inner;
    }
    const block: ExtractedBlock = { type: match[1] as any, order, rawTag: match[0], payload };
    if (match[1] === 'code') codes.push(block);
    else if (match[1] === 'table') tables.push(block);
    else images.push(block);
  }
  return { codes, tables, images };
}

export function stripFences(s: string): string {
  let str = (s || '').trim();
  if (str.startsWith('```')) {
    str = str.replace(/^```[a-zA-Z0-9_-]*\s*/, '').replace(/```\s*$/, '');
  }
  return str.trim();
}

// Build the SlateHTML-style widget block produced by the original workflow.
export function buildCodeWidget(payload: any, order: number): { order: number; html: string } {
  let lang = 'text';
  let code = '';
  let caption = '';
  if (typeof payload === 'string') {
    const s = payload;
    const capM = s.match(/^\s*Caption:\s*(.*)\s*$/im);
    const langM = s.match(/^\s*Language:\s*(.*)\s*$/im);
    const fenceM = s.match(/```([a-zA-Z0-9+#_-]*)\s*([\s\S]*?)```/m);
    if (fenceM) {
      lang = (fenceM[1] || '').trim() || (langM ? langM[1].split(/[,\s|/]+/)[0] : 'text') || 'text';
      code = (fenceM[2] || '').trim();
    } else if (langM) {
      lang = langM[1].split(/[,\s|/]+/)[0] || 'text';
      const codeLabel = /(^|\n)\s*Code\s*:\s*/i.exec(s);
      code = codeLabel ? s.slice(codeLabel.index + codeLabel[0].length).trim() : s.replace(/^\s*(Caption|Language):.*/gim, '').trim();
    } else {
      code = s;
    }
    caption = capM ? capM[1].trim() : '';
  } else {
    lang = payload?.language || 'text';
    code = payload?.code || '';
    caption = payload?.caption || '';
  }
  const html = `<pre class="widget-code" data-order="${order}" data-language="${escapeAttr(lang)}"><code>${escapeHtml(code)}</code>${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</pre>`;
  return { order, html };
}

export function buildTableWidget(payload: any, order: number): { order: number; html: string } {
  let caption = '';
  let pipeLines: string[] = [];

  if (typeof payload === 'string') {
    const s = payload;
    const titleM = s.match(/^\s*Table title:\s*(.*)\s*$/im);
    if (titleM) caption = titleM[1].trim();
    // Extract ONLY the pipe-delimited lines — skip {}, title, description text.
    pipeLines = s.split('\n').filter((l) => l.includes('|'));
  } else {
    const headers: string[] = payload?.headers || payload?.columns || [];
    const rows: string[][] = payload?.rows || [];
    caption = payload?.caption || payload?.title || '';
    if (headers.length) {
      pipeLines = [
        `| ${headers.join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...rows.map((r) => `| ${r.map(String).join(' | ')} |`),
      ];
    }
  }

  marked.setOptions({ gfm: true, breaks: false });
  const tableHtml = pipeLines.length
    ? (marked.parse(pipeLines.join('\n'), { async: false }) as string)
    : '';

  const html = `<figure class="widget-table" data-order="${order}">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}${tableHtml}</figure>`;
  return { order, html };
}

export function buildImageWidget(payload: any, order: number, kind: 'gpt' | 'chart'): { order: number; html: string; data: any } {
  const caption = payload?.caption || '';
  if (kind === 'gpt') {
    const url = payload?.url || '';
    const html = `<figure class="widget-image" data-order="${order}"><img src="${escapeAttr(url)}" alt="${escapeAttr(caption)}" style="max-width:100%;border-radius:8px;" />${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
    return { order, html, data: { kind: 'gpt', url, caption } };
  }
  const html = `<figure class="widget-chart" data-order="${order}" data-config='${escapeAttr(JSON.stringify(payload?.config || payload || {}))}'>${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
  return { order, html, data: { kind: 'chart', config: payload?.config || payload, caption } };
}

// Merge the generated widgets back into the draft, replacing each tagged block with the rendered widget HTML.
export function mergeWidgets(draft: string, widgets: { order: number; html: string }[]): string {
  let out = draft;
  let order = 0;
  out = out.replace(/\[(code|table|image)\]([\s\S]*?)\[\/\1\]/g, () => {
    order += 1;
    const w = widgets.find((x) => x.order === order);
    return w ? `\n\n${w.html}\n\n` : '';
  });
  return out;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
}
