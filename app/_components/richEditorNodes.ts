// Custom TipTap nodes for the widget HTML the pipelines emit.
//
// TipTap parses HTML into its own schema and SILENTLY DROPS anything it has no node for. The
// generated articles contain `<figure class="widget-image">` and `<pre class="widget-code">`
// blocks, so without these the first save would delete every image and code widget.

import { Node, mergeAttributes } from '@tiptap/core';

/**
 * `<figure class="widget-image"><img …><figcaption>…</figcaption></figure>`
 *
 * Modelled as a leaf node with the caption as an attribute rather than editable content: the
 * caption is a single line, and keeping it out of the document avoids the cursor getting
 * trapped inside a figure.
 */
export const WidgetFigure = Node.create({
  name: 'widgetFigure',
  // Must outrank StarterKit's image/paragraph handling of <figure>.
  priority: 1000,
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      caption: { default: '' },
      order: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure',
        // Only claim figures that actually wrap an image — table figures are handled by the
        // table extensions, and claiming them here would swallow the table.
        getAttrs: (el) => {
          const node = el as HTMLElement;
          const img = node.querySelector('img');
          if (!img) return false;
          return {
            src: img.getAttribute('src') || '',
            alt: img.getAttribute('alt') || '',
            caption: node.querySelector('figcaption')?.textContent?.trim() || '',
            order: node.getAttribute('data-order'),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { src, alt, caption, order } = HTMLAttributes as Record<string, any>;
    const figAttrs: Record<string, any> = { class: 'widget-image' };
    if (order) figAttrs['data-order'] = order;
    const children: any[] = [
      ['img', { src, alt: alt || caption || '', style: 'max-width:100%;border-radius:8px;' }],
    ];
    if (caption) children.push(['figcaption', {}, caption]);
    return ['figure', mergeAttributes(figAttrs), ...children];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('figure');
      dom.className = 'widget-image';
      dom.contentEditable = 'false';

      const img = document.createElement('img');
      img.src = node.attrs.src;
      img.alt = node.attrs.alt || node.attrs.caption || '';
      img.style.cssText = 'max-width:100%;border-radius:8px;';
      dom.appendChild(img);

      // The caption stays editable in place — click it and type.
      const cap = document.createElement('figcaption');
      cap.textContent = node.attrs.caption || '';
      cap.contentEditable = 'true';
      cap.dataset.placeholder = 'Add a caption…';
      cap.addEventListener('blur', () => {
        if (typeof getPos !== 'function') return;
        const text = cap.textContent?.trim() || '';
        if (text === node.attrs.caption) return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, caption: text }));
      });
      dom.appendChild(cap);

      return { dom, ignoreMutation: (m) => m.target === cap || cap.contains(m.target as any) };
    };
  },
});

/**
 * `<pre class="widget-code" data-language="…"><code>…</code><figcaption>…</figcaption></pre>`
 *
 * StarterKit's codeBlock only understands `<pre><code>`, so the language and caption would be
 * lost. This keeps both as attributes and re-emits the original shape.
 */
export const WidgetCode = Node.create({
  name: 'widgetCode',
  // Must outrank StarterKit's codeBlock, which otherwise claims <pre> and drops the
  // data-language attribute and the caption.
  priority: 1000,
  group: 'block',
  code: true,
  marks: '',
  content: 'text*',
  defining: true,

  addAttributes() {
    return {
      language: { default: 'text' },
      caption: { default: '' },
      order: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'pre.widget-code',
        preserveWhitespace: 'full',
        getAttrs: (el) => {
          const node = el as HTMLElement;
          return {
            language: node.getAttribute('data-language') || 'text',
            caption: node.querySelector('figcaption')?.textContent?.trim() || '',
            order: node.getAttribute('data-order'),
          };
        },
        // Take only the <code> text; the figcaption is captured as an attribute above and must
        // not end up inside the code body.
        contentElement: (el) => (el as HTMLElement).querySelector('code') || (el as HTMLElement),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, any> = { class: 'widget-code' };
    if (HTMLAttributes.language) attrs['data-language'] = HTMLAttributes.language;
    if (HTMLAttributes.order) attrs['data-order'] = HTMLAttributes.order;
    const children: any[] = [['code', {}, 0]];
    // renderHTML cannot emit a sibling after the content hole, so the caption rides along as a
    // data attribute and is restored by `restoreCodeCaptions` on save.
    if (node.attrs.caption) attrs['data-caption'] = node.attrs.caption;
    return ['pre', mergeAttributes(attrs), ...children];
  },
});

/**
 * `<figure class="widget-table"><figcaption>…</figcaption><table>…</table></figure>`
 *
 * Without this the figure wrapper is discarded and the table's title goes with it. The caption
 * travels as an attribute because ProseMirror requires the content hole to be its parent's only
 * child — `restoreWidgetCaptions` turns it back into a <figcaption>.
 */
export const WidgetTable = Node.create({
  name: 'widgetTable',
  priority: 1000,
  group: 'block',
  // `block+` rather than `table`: a partly-failed widget can leave stray paragraphs beside the
  // table inside the figure, and a stricter schema would silently delete them.
  content: 'block+',
  isolating: true,

  addAttributes() {
    return { caption: { default: '' }, order: { default: null } };
  },

  parseHTML() {
    return [
      // The caption is captured as an attribute below, so it must not also be parsed as
      // content — otherwise it reappears as a paragraph inside the figure.
      { tag: 'figure.widget-table > figcaption', ignore: true },
      {
        tag: 'figure.widget-table',
        // Only claim a figure that really wraps a table. A failed table widget leaves the
        // figure holding raw text instead, which cannot satisfy `content: 'table'` — claiming
        // it would silently delete that text.
        getAttrs: (el) => {
          const node = el as HTMLElement;
          if (!node.querySelector('table')) return false;
          return {
            caption: node.querySelector('figcaption')?.textContent?.trim() || '',
            order: node.getAttribute('data-order'),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs: Record<string, any> = { class: 'widget-table' };
    if (HTMLAttributes.order) attrs['data-order'] = HTMLAttributes.order;
    if (HTMLAttributes.caption) attrs['data-caption'] = HTMLAttributes.caption;
    return ['figure', mergeAttributes(attrs), 0];
  },
});

/**
 * Put widget captions back as `<figcaption>` children.
 *
 * ProseMirror's renderer cannot place a node after the content hole, so WidgetCode serialises
 * its caption to `data-caption`. This runs on the saved HTML to restore the shape the rest of
 * the pipeline (and the dev.to/WordPress publishers) expect.
 */
export function restoreWidgetCaptions(html: string): string {
  // Code widgets: caption goes after the <code>, matching the pipeline's output.
  let out = html.replace(
    /<pre([^>]*?)\sdata-caption="([^"]*)"([^>]*)>([\s\S]*?)<\/pre>/gi,
    (_full, before, caption, after, inner) =>
      `<pre${before}${after}>${inner}<figcaption>${caption}</figcaption></pre>`,
  );
  // Table widgets: caption is a title, so it goes first.
  out = out.replace(
    /<figure([^>]*?)\sdata-caption="([^"]*)"([^>]*)>/gi,
    (_full, before, caption, after) => `<figure${before}${after}><figcaption>${caption}</figcaption>`,
  );
  return out;
}

/** @deprecated use restoreWidgetCaptions */
export const restoreCodeCaptions = restoreWidgetCaptions;
