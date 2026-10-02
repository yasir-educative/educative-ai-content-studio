// Minimal HTML → Markdown converter for the dev.to publisher.
//
// dev.to's API takes `body_markdown`, and its renderer only allows a narrow subset of inline HTML
// (<figure>, <figcaption> and friends are stripped). Our HTML comes out of `marked`, so the input
// shape is predictable and a focused regex converter is enough — no extra dependency for one
// destination. Anything unrecognised has its tags dropped rather than passed through, which keeps
// stray markup out of the published article.

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Decoded `<` / `>` inside an inline code span would be eaten by the final "strip anything still
// tagged" pass. Park them on private sentinels and restore once that pass has run.
const LT = '\u0001';
const GT = '\u0002';

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

/** Inline-level conversion: runs on the contents of a block, never on block tags themselves. */
function inline(html: string): string {
  let s = html;
  s = s.replace(/<br\s*\/?>/gi, '  \n');
  s = s.replace(/<img\s[^>]*>/gi, (tag) => {
    const src = attr(tag, 'src');
    if (!src) return '';
    return `![${attr(tag, 'alt')}](${src})`;
  });
  s = s.replace(/<a\s[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_f, href, text) => {
    const label = inline(text).trim();
    return label ? `[${label}](${href})` : href;
  });
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_f, c) => {
    const text = decodeEntities(String(c).replace(/<[^>]+>/g, '')).split('<').join(LT).split('>').join(GT);
    // Widen the fence when the snippet itself contains a backtick.
    const fence = text.includes('`') ? '``' : '`';
    return `${fence}${text}${fence}`;
  });
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_f, _t, c) => `**${inline(c).trim()}**`);
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_f, _t, c) => `*${inline(c).trim()}*`);
  s = s.replace(/<(del|s|strike)[^>]*>([\s\S]*?)<\/\1>/gi, (_f, _t, c) => `~~${inline(c).trim()}~~`);
  s = s.replace(/<\/?(span|small|sub|sup|u|mark|font)[^>]*>/gi, '');
  return s;
}

function cells(rowHtml: string): string[] {
  const out: string[] = [];
  const re = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml)) !== null) {
    out.push(inline(m[1]).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
  }
  return out;
}

function convertTable(tableHtml: string): string {
  const rows: string[][] = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tableHtml)) !== null) {
    const c = cells(m[1]);
    if (c.length) rows.push(c);
  }
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const lines = [
    `| ${pad(rows[0]).join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`),
  ];
  return lines.join('\n');
}

/**
 * Split a list's HTML into its top-level <li> bodies.
 *
 * A non-greedy /<li>(.*?)<\/li>/ stops at the first closing tag, which for a nested list is the
 * inner item's — so the nested markup leaks out and the sublist is lost. Walk the tags and track
 * depth instead.
 */
function splitListItems(listHtml: string): string[] {
  const items: string[] = [];
  const tagRe = /<(\/?)li\b[^>]*>/gi;
  let depth = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(listHtml)) !== null) {
    const closing = m[1] === '/';
    if (!closing) {
      if (depth === 0) start = m.index + m[0].length;
      depth++;
    } else {
      depth--;
      if (depth === 0 && start >= 0) {
        items.push(listHtml.slice(start, m.index));
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  // Unclosed final <li> — HTML allows omitting the closing tag.
  if (depth > 0 && start >= 0) items.push(listHtml.slice(start));
  return items;
}

function convertList(listHtml: string, ordered: boolean, depth: number): string {
  const items: string[] = [];
  let n = 1;
  for (const raw of splitListItems(listHtml)) {
    const nested: string[] = [];
    const body = raw.replace(/<(ul|ol)[^>]*>[\s\S]*?<\/\1>/gi, (sub) => {
      nested.push(convertList(sub, /^<ol/i.test(sub), depth + 1));
      return '';
    });
    const marker = ordered ? `${n}.` : '-';
    const indent = '  '.repeat(depth);
    const text = inline(body.replace(/<\/?p[^>]*>/gi, ' ')).replace(/\s+/g, ' ').trim();
    items.push(`${indent}${marker} ${text}${nested.length ? '\n' + nested.join('\n') : ''}`);
    n++;
  }
  return items.join('\n');
}

export function htmlToMarkdown(html: string, nested = false): string {
  let s = html;

  // Drop things that never belong in an article body.
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');

  // Fenced code blocks first — their contents must not be touched by any later rule.
  //
  // The pipeline's code widget is `<pre class="widget-code" data-language="x"><code>…</code>
  // <figcaption>…</figcaption></pre>`: the language lives on the <pre>, and a <figcaption> sits
  // between </code> and </pre>. Both are handled here, otherwise the caption text gets swept
  // into the code body and the fence loses its language.
  const codeBlocks: string[] = [];
  s = s.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/gi, (_f, preAttrs: string, body: string) => {
    const inner = String(body);
    const caption = decodeEntities(
      (inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] || '').replace(/<[^>]+>/g, ''),
    ).trim();
    const withoutCaption = inner.replace(/<figcaption[^>]*>[\s\S]*?<\/figcaption>/gi, '');

    const codeM = withoutCaption.match(/<code([^>]*)>([\s\S]*?)<\/code>/i);
    const codeAttrs = codeM?.[1] || '';
    const rawCode = codeM ? codeM[2] : withoutCaption;

    const lang = (
      attr(`<code${codeAttrs}>`, 'class').match(/language-([\w+#-]+)/i)?.[1] ||
      attr(`<pre${preAttrs}>`, 'data-language') ||
      ''
    ).toLowerCase();
    // "text" is the widget's placeholder for "unknown" — an empty fence reads better.
    const fenceLang = lang === 'text' ? '' : lang;

    const code = decodeEntities(String(rawCode).replace(/<[^>]+>/g, '')).replace(/\s+$/, '');
    codeBlocks.push(`\`\`\`${fenceLang}\n${code}\n\`\`\``);
    const token = `HTMLMDCODE${codeBlocks.length - 1}TOKEN`;
    return caption ? `\n\n${token}\n*${caption}*\n\n` : `\n\n${token}\n\n`;
  });

  // Tables.
  s = s.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, (t) => `\n\n${convertTable(t)}\n\n`);

  // Figures → image (or whatever else they wrap) plus an italic caption; dev.to strips <figure>.
  //
  // Tables run above this, so a `<figure class="widget-table">` reaches here already holding a
  // converted markdown table. Discarding non-image inner content would silently delete it, so
  // anything that is not the image or the caption is preserved.
  s = s.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (_f, inner: string) => {
    const imgTag = inner.match(/<img\s[^>]*>/i)?.[0] || '';
    const src = attr(imgTag, 'src');
    const caption = decodeEntities(
      (inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] || '').replace(/<[^>]+>/g, ''),
    ).trim();

    let rest = inner.replace(/<figcaption[^>]*>[\s\S]*?<\/figcaption>/gi, '');
    if (imgTag) rest = rest.replace(imgTag, '');
    rest = rest.trim();

    if (src) {
      const alt = attr(imgTag, 'alt') || caption;
      const body = `![${alt}](${src})${caption ? `\n*${caption}*` : ''}`;
      return `\n\n${body}${rest ? `\n\n${rest}` : ''}\n\n`;
    }
    // No image: a table or other block. Its caption is a title, so it reads better above.
    if (!rest) return caption ? `\n\n*${caption}*\n\n` : '';
    return `\n\n${caption ? `*${caption}*\n\n` : ''}${rest}\n\n`;
  });

  // Lists (outermost first — convertList recurses into nested ones).
  s = s.replace(/<(ul|ol)[^>]*>[\s\S]*?<\/\1>/gi, (list, tag: string) => `\n\n${convertList(list, tag.toLowerCase() === 'ol', 0)}\n\n`);

  // Blockquotes — prefix every line with "> ".
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_f, inner: string) => {
    const text = htmlToMarkdown(inner, true).trim();
    return `\n\n${text.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')}\n\n`;
  });

  // Headings.
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_f, level: string, inner: string) => {
    const text = inline(inner).replace(/\s+/g, ' ').trim();
    return text ? `\n\n${'#'.repeat(Number(level))} ${text}\n\n` : '';
  });

  s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // Paragraphs and leftover block wrappers.
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_f, inner: string) => `\n\n${inline(inner).trim()}\n\n`);
  s = s.replace(/<\/?(div|section|article|main|header|footer|aside)[^>]*>/gi, '\n\n');

  s = inline(s);

  // Anything still tagged is markup we do not translate — drop the tags, keep the text.
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);

  codeBlocks.forEach((block, i) => {
    s = s.split(`HTMLMDCODE${i}TOKEN`).join(block);
  });

  // Only the outermost call restores — a nested call's output is re-scanned by its parent.
  if (!nested) s = s.split(LT).join('<').split(GT).join('>');

  return s
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
