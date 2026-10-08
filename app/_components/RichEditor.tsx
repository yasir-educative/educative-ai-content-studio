'use client';

// Rich editor for a generated article.
//
// Replaces the plain contenteditable: a formatting bar, markdown input rules (typing `## `
// turns into an H2, `> ` into a callout, ``` into a code block), and image insertion by drag,
// paste or file picker.
//
// The document round-trips the pipeline's HTML, including the `<figure class="widget-image">`
// and `<pre class="widget-code">` widgets — see richEditorNodes.ts for why that needs custom
// nodes rather than the stock schema.

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
// StarterKit v3 already bundles Link — importing it separately duplicates the extension.
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { WidgetFigure, WidgetCode, WidgetTable, restoreWidgetCaptions } from './richEditorNodes';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

async function uploadImage(file: File, blogId?: string): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  if (blogId) fd.append('blogId', blogId);
  const res = await fetch('/api/images/upload', { method: 'POST', body: fd });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || 'Upload failed');
  return json.url;
}

function Btn({
  onClick, active, disabled, title, children,
}: { onClick: () => void; active?: boolean; disabled?: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={!!active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the selection while clicking the toolbar
      onClick={onClick}
      className="rounded px-2 py-1 text-xs transition-colors disabled:opacity-40"
      style={{
        color: active ? '#fff' : 'var(--text-dim)',
        background: active ? 'var(--accent)' : 'transparent',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0" style={{ background: 'var(--border)' }} />;
}

function Toolbar({ editor, blogId, onError }: { editor: Editor; blogId?: string; onError: (m: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Toolbar state must re-render on every selection/content change, which `useEditor` alone
  // does not trigger for button active states.
  const [, force] = useState(0);
  useEffect(() => {
    const bump = () => force((n) => n + 1);
    editor.on('selectionUpdate', bump);
    editor.on('transaction', bump);
    return () => { editor.off('selectionUpdate', bump); editor.off('transaction', bump); };
  }, [editor]);

  const pickImage = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const url = await uploadImage(file, blogId);
      editor.chain().focus().insertContent({ type: 'widgetFigure', attrs: { src: url, alt: '', caption: '' } }).run();
    } catch (e: any) {
      onError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [editor, blogId, onError]);

  const setLink = useCallback(() => {
    const prev = editor.getAttributes('link').href || '';
    const url = window.prompt('Link URL (empty to remove)', prev);
    if (url === null) return;
    if (!url) { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  return (
    <div
      className="sticky top-0 z-10 flex flex-wrap items-center gap-1 rounded-t-xl border-b px-3 py-2"
      style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
    >
      {([1, 2, 3] as const).map((level) => (
        <Btn key={level} title={`Heading ${level}`} active={editor.isActive('heading', { level })}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}>
          H{level}
        </Btn>
      ))}
      <Btn title="Paragraph" active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()}>¶</Btn>
      <Divider />
      <Btn title="Bold (⌘B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></Btn>
      <Btn title="Italic (⌘I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></Btn>
      <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></Btn>
      <Btn title="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>{'<>'}</Btn>
      <Btn title="Link" active={editor.isActive('link')} onClick={setLink}>🔗</Btn>
      <Divider />
      <Btn title="Callout / blockquote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</Btn>
      <Btn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</Btn>
      <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</Btn>
      <Btn title="Code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{'{ }'}</Btn>
      <Btn title="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}>―</Btn>
      <Divider />
      <Btn title="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</Btn>
      <Btn title="Add row" disabled={!editor.can().addRowAfter()} onClick={() => editor.chain().focus().addRowAfter().run()}>+Row</Btn>
      <Btn title="Add column" disabled={!editor.can().addColumnAfter()} onClick={() => editor.chain().focus().addColumnAfter().run()}>+Col</Btn>
      <Btn title="Delete table" disabled={!editor.can().deleteTable()} onClick={() => editor.chain().focus().deleteTable().run()}>✕▦</Btn>
      <Divider />
      <Btn title="Insert image — or drag one in / paste from the clipboard" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? 'Uploading…' : '🖼 Image'}
      </Btn>
      <input
        ref={fileRef} type="file" accept={ACCEPT} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickImage(f); }}
      />
      <Divider />
      <Btn title="Undo (⌘Z)" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>↶</Btn>
      <Btn title="Redo (⇧⌘Z)" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>↷</Btn>
    </div>
  );
}

export interface RichEditorHandle { getHTML: () => string }

export function RichEditor({
  html, blogId, onReady, onError,
}: {
  html: string;
  blogId?: string;
  /** Receives a getter for the current HTML — call it when saving. */
  onReady?: (handle: RichEditorHandle) => void;
  onError?: (message: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [localErr, setLocalErr] = useState('');
  const report = useCallback((m: string) => { setLocalErr(m); onError?.(m); }, [onError]);

  const editor = useEditor({
    // Next hydrates this on the client only; rendering it on the server warns and flickers.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // Input rules come from StarterKit: "## " → H2, "> " → blockquote, "- " → list,
        // "```" → code block, "**bold**", "1. " → ordered list, "---" → divider.
        heading: { levels: [1, 2, 3, 4] },
        codeBlock: { HTMLAttributes: { class: 'editor-code' } },
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener', target: '_blank' } },
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      WidgetFigure,
      WidgetCode,
      WidgetTable,
    ],
    content: html,
    editorProps: {
      attributes: { class: 'article-prose focus:outline-none min-h-[420px] px-6 py-5' },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        void (async () => {
          for (const f of files) {
            try {
              const url = await uploadImage(f, blogId);
              editorRef.current?.chain().focus().insertContent({ type: 'widgetFigure', attrs: { src: url, alt: '', caption: '' } }).run();
            } catch (e: any) { report(e?.message || String(e)); }
          }
        })();
        return true;
      },
      handleDrop: (view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        // Drop at the cursor position rather than appending at the end.
        const pos = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos;
        void (async () => {
          for (const f of files) {
            try {
              const url = await uploadImage(f, blogId);
              const chain = editorRef.current?.chain().focus();
              if (pos != null) chain?.insertContentAt(pos, { type: 'widgetFigure', attrs: { src: url, alt: '', caption: '' } }).run();
              else chain?.insertContent({ type: 'widgetFigure', attrs: { src: url, alt: '', caption: '' } }).run();
            } catch (e: any) { report(e?.message || String(e)); }
          }
        })();
        return true;
      },
    },
  });

  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    if (!editor || !onReady) return;
    // Captions live in a node attribute, so the code-widget shape is restored on the way out.
    onReady({ getHTML: () => restoreWidgetCaptions(editor.getHTML()) });
  }, [editor, onReady]);

  if (!editor) return <div className="card p-8 text-sm" style={{ color: 'var(--text-dim)' }}>Loading editor…</div>;

  return (
    <div
      className="card overflow-hidden p-0"
      style={{ borderColor: dragging ? 'var(--accent)' : 'var(--border)' }}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={() => setDragging(false)}
    >
      <Toolbar editor={editor} blogId={blogId} onError={report} />
      {dragging && (
        <div className="px-6 py-2 text-xs" style={{ color: 'var(--accent)', background: 'var(--accent-soft)' }}>
          Drop to insert the image here
        </div>
      )}
      {localErr && (
        <div className="px-6 py-2 text-xs" style={{ color: 'var(--danger-text)' }}>{localErr}</div>
      )}
      <EditorContent editor={editor} />
      <div className="border-t px-6 py-2 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}>
        Markdown shortcuts work as you type — <code># </code> heading, <code>&gt; </code> callout,
        <code> - </code> list, <code>```</code> code, <code>**bold**</code>. Drag or paste an image anywhere.
      </div>
    </div>
  );
}
