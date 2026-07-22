'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
const MarkdownRenderer = dynamic(() => import('@/app/_components/MarkdownRenderer'), { ssr: false });
const StageOutputs = dynamic(() => import('@/app/_components/StageOutputs').then((m) => m.StageOutputs), { ssr: false });

const STAGE_ORDER = [
  'topic-research',
  'json-outline',
  'text-generator',
  'medium-dna',
  'cip-final-pass',
  'projects-text-generator',
  'projects-reviewer',
  'zachgpt-review',
  'zachgpt-incorporate',
  'seo-keywords',
  'seo-editor',
  'pr-reviewer',
  'widgets-extract',
  'markdown-to-html',
  'structure-output',
  'sanitize-format',
  'widgets-generate',
  'editor-blocks',
  'publish',
];

// Split raw HTML into segments around <img> tags so we can inject edit overlays.
type HtmlSegment =
  | { type: 'html'; content: string }
  | { type: 'image'; src: string; alt: string; full: string };

function parseHtmlSegments(html: string): HtmlSegment[] {
  const parts: HtmlSegment[] = [];
  const re = /<img\s[^>]*>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'html', content: html.slice(lastIndex, match.index) });
    }
    const fullTag = match[0];
    const srcM = fullTag.match(/src="([^"]*)"/i);
    const altM = fullTag.match(/alt="([^"]*)"/i);
    parts.push({ type: 'image', src: srcM?.[1] || '', alt: altM?.[1] || '', full: fullTag });
    lastIndex = match.index + fullTag.length;
  }
  if (lastIndex < html.length) {
    parts.push({ type: 'html', content: html.slice(lastIndex) });
  }
  return parts;
}

interface ImageEditState {
  originalUrl: string;
  prompt: string;
  loading: boolean;
  editedUrl: string | null;
  error: string | null;
}

function ImageEditModal({
  state,
  onPromptChange,
  onSubmit,
  onUpdate,
  onClose,
}: {
  state: ImageEditState;
  onPromptChange: (v: string) => void;
  onSubmit: () => void;
  onUpdate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold">Edit Image</h2>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Prompt input */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-dim)] uppercase tracking-wide mb-1.5">
              What should change?
            </label>
            <textarea
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-sm p-3 resize-none focus:outline-none focus:ring-1 focus:ring-[var(--accent)] min-h-[80px]"
              placeholder="e.g. Change the background to dark blue, add more contrast, remove the text overlay…"
              value={state.prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              disabled={state.loading}
            />
          </div>

          {state.error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              {state.error}
            </div>
          )}

          {/* Side-by-side comparison */}
          {(state.editedUrl || state.loading) && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-[var(--text-dim)] uppercase tracking-wide mb-2 font-medium">Original</p>
                <img
                  src={state.originalUrl}
                  alt="Original"
                  className="w-full rounded-lg border border-[var(--border)] object-contain max-h-64"
                />
              </div>
              <div>
                <p className="text-xs text-[var(--text-dim)] uppercase tracking-wide mb-2 font-medium">Edited</p>
                {state.loading ? (
                  <div className="w-full max-h-64 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] flex items-center justify-center h-40 text-sm text-[var(--text-dim)]">
                    Generating…
                  </div>
                ) : (
                  <img
                    src={state.editedUrl!}
                    alt="Edited"
                    className="w-full rounded-lg border border-[var(--border)] object-contain max-h-64"
                  />
                )}
              </div>
            </div>
          )}

          {/* Show original alone before any edit */}
          {!state.editedUrl && !state.loading && (
            <div>
              <p className="text-xs text-[var(--text-dim)] uppercase tracking-wide mb-2 font-medium">Current image</p>
              <img
                src={state.originalUrl}
                alt="Current"
                className="w-full rounded-lg border border-[var(--border)] object-contain max-h-64"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-[var(--border)]">
          <button className="btn-secondary" onClick={onClose} disabled={state.loading}>Cancel</button>
          {!state.editedUrl ? (
            <button
              className="btn-primary"
              onClick={onSubmit}
              disabled={state.loading || !state.prompt.trim()}
            >
              {state.loading ? 'Generating…' : 'Generate Edit'}
            </button>
          ) : (
            <>
              <button
                className="btn-secondary"
                onClick={onSubmit}
                disabled={state.loading}
              >
                {state.loading ? 'Generating…' : 'Regenerate'}
              </button>
              <button className="btn-primary" onClick={onUpdate} disabled={state.loading}>
                Use This Image
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [blog, setBlog] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [debugOpen, setDebugOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState('');

  const [contentView, setContentView] = useState<null | 'html' | 'markdown'>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const editRef = useRef<HTMLDivElement>(null);

  const [imageEdit, setImageEdit] = useState<ImageEditState | null>(null);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/history/${params.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load');
      setBlog(json.blog);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

  async function rePublish() {
    if (!blog?.editorBlocks?.length) return;
    setPublishing(true);
    setPublishMsg('');
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: blog.finalTitle || blog.request?.blogTitle, blocks: blog.editorBlocks, blogId: blog.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Publish failed');
      setPublishMsg(json.url);
      await load();
    } catch (e: any) {
      setPublishMsg(`Error: ${e?.message || String(e)}`);
    } finally {
      setPublishing(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this blog from history?')) return;
    await fetch(`/api/history/${params.id}`, { method: 'DELETE' });
    router.push('/blogs');
  }

  function startEdit() {
    setEditing(true);
    setContentView(null);
    setDebugOpen(false);
    requestAnimationFrame(() => {
      if (editRef.current) editRef.current.innerHTML = blog?.html || '';
    });
  }

  async function saveEdit() {
    const html = editRef.current?.innerHTML || '';
    setSaving(true);
    setSaveErr('');
    try {
      const res = await fetch(`/api/blog/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Save failed');
      setBlog((b: any) => ({ ...b, html: json.html }));
      setEditing(false);
    } catch (e: any) {
      setSaveErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  function download(content: string, name: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  function copyContent(content: string) {
    navigator.clipboard.writeText(content).catch(() => {});
  }

  function openImageEdit(src: string) {
    setImageEdit({ originalUrl: src, prompt: '', loading: false, editedUrl: null, error: null });
  }

  async function submitImageEdit() {
    if (!imageEdit) return;
    setImageEdit((s) => s ? { ...s, loading: true, error: null } : s);
    try {
      const res = await fetch('/api/images/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: imageEdit.originalUrl, prompt: imageEdit.prompt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Edit failed');
      setImageEdit((s) => s ? { ...s, loading: false, editedUrl: json.editedUrl } : s);
    } catch (e: any) {
      setImageEdit((s) => s ? { ...s, loading: false, error: e?.message || String(e) } : s);
    }
  }

  async function applyImageEdit() {
    if (!imageEdit?.editedUrl || !blog) return;
    const oldUrl = imageEdit.originalUrl;
    const newUrl = imageEdit.editedUrl;

    // Update editorBlocks: replace old URL with new one
    const updatedBlocks = (blog.editorBlocks || []).map((block: any) => {
      if (block?.type === 'Image') {
        const blockUrl = block?.content?.url || block?.content?.path || '';
        if (blockUrl === oldUrl) {
          return {
            ...block,
            content: { ...block.content, url: newUrl, path: newUrl },
          };
        }
      }
      return block;
    });

    // Update HTML: replace old img src with new one
    const updatedHtml = (blog.html || '').replace(
      new RegExp(oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      newUrl,
    );

    try {
      const res = await fetch(`/api/blog/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: updatedHtml, editorBlocks: updatedBlocks }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Save failed');
      setBlog((b: any) => ({ ...b, html: updatedHtml, editorBlocks: updatedBlocks }));
      setImageEdit(null);
    } catch (e: any) {
      setImageEdit((s) => s ? { ...s, error: e?.message || String(e) } : s);
    }
  }

  if (loading) return <div className="card p-6 text-sm text-[var(--text-faint)]">Loading…</div>;
  if (err) return <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 p-4 text-sm">{err}</div>;
  if (!blog) return null;

  const title = blog.finalTitle || blog.request?.blogTitle || '(untitled)';
  const hasDebug = blog.stageOutputs && Object.keys(blog.stageOutputs).length > 0;
  const activeContentText = contentView === 'html' ? (blog.html || '') : (blog.markdown || '');
  const activeContentExt = contentView === 'html' ? 'html' : 'md';
  const activeContentMime = contentView === 'html' ? 'text/html' : 'text/markdown';

  // Parse HTML into segments so we can overlay edit buttons on images
  const htmlSegments = blog.html ? parseHtmlSegments(blog.html) : [];

  return (
    <div className="space-y-6">
      {/* Image edit modal */}
      {imageEdit && (
        <ImageEditModal
          state={imageEdit}
          onPromptChange={(v) => setImageEdit((s) => s ? { ...s, prompt: v } : s)}
          onSubmit={submitImageEdit}
          onUpdate={applyImageEdit}
          onClose={() => setImageEdit(null)}
        />
      )}

      {/* Top bar */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/blogs" className="text-sm text-[var(--text-dim)] hover:text-white">← Blogs</Link>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight break-words">{title}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="pill">{blog.status}</span>
            {blog.request?.persona && <span className="pill">{blog.request.persona}</span>}
            {blog.request?.vertical && <span className="pill">{blog.request.vertical}</span>}
            {blog.request?.targetAudience && <span className="pill">{blog.request.targetAudience}</span>}
            {blog.editorBlocks?.length > 0 && <span className="pill">{blog.editorBlocks.length} blocks</span>}
            <span className="pill">{new Date(blog.createdAt).toLocaleString()}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {/* Edit mode: Save / Cancel */}
          {editing && (
            <>
              {saveErr && <span className="text-xs text-red-300">{saveErr}</span>}
              <button className="btn-secondary" disabled={saving} onClick={() => { setEditing(false); setSaveErr(''); }}>Cancel</button>
              <button className="btn-primary" disabled={saving} onClick={saveEdit}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}

          {/* Source / debug toggles */}
          {!editing && (
            <>
              {blog.markdown && (
                <button
                  className={`btn-secondary text-xs${contentView === 'markdown' ? ' ring-1 ring-[var(--accent)]' : ''}`}
                  onClick={() => { setContentView((v) => v === 'markdown' ? null : 'markdown'); setDebugOpen(false); }}
                >
                  Markdown
                </button>
              )}
              {blog.html && (
                <button
                  className={`btn-secondary text-xs${contentView === 'html' ? ' ring-1 ring-[var(--accent)]' : ''}`}
                  onClick={() => { setContentView((v) => v === 'html' ? null : 'html'); setDebugOpen(false); }}
                >
                  HTML
                </button>
              )}
              {(blog.html || blog.markdown) && (
                <button className="btn-secondary" onClick={startEdit}>Edit</button>
              )}
              {hasDebug && (
                <button
                  className="btn-secondary"
                  onClick={() => { setDebugOpen((v) => !v); setContentView(null); }}
                >
                  {debugOpen ? 'Hide Debug' : 'Debug'}
                </button>
              )}
            </>
          )}

          <button className="btn-primary" disabled={publishing || !blog.editorBlocks?.length} onClick={rePublish}>
            {publishing ? 'Publishing…' : blog.publishedUrl ? 'Re-publish' : 'Publish to Educative'}
          </button>
          {!editing && <button className="btn-secondary" onClick={remove}>Delete</button>}
        </div>
      </div>

      {blog.errorMessage && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 p-3 text-sm">
          {blog.errorMessage}
        </div>
      )}

      {blog.publishedUrl && (
        <div className="text-sm">
          Published: <a className="underline text-emerald-300 break-all" href={blog.publishedUrl} target="_blank" rel="noreferrer">{blog.publishedUrl}</a>
        </div>
      )}
      {publishMsg && <div className="text-xs text-[var(--text-dim)] break-all">{publishMsg}</div>}

      {/* Main content area — mutually exclusive views */}
      {editing ? (
        <article className="card p-8">
          <div
            ref={editRef}
            className="article-prose outline-none min-h-[40vh]"
            contentEditable
            suppressContentEditableWarning
          />
        </article>
      ) : contentView ? (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-dim)]">
              {contentView === 'html' ? 'HTML source' : 'Markdown source'}
            </h3>
            <div className="flex gap-2">
              <button className="btn-secondary text-xs" onClick={() => copyContent(activeContentText)}>Copy</button>
              <button
                className="btn-secondary text-xs"
                onClick={() => download(activeContentText, `${title}.${activeContentExt}`, activeContentMime)}
              >
                Download
              </button>
            </div>
          </div>
          <pre className="text-xs font-mono bg-[var(--panel-2)] border border-[var(--border)] p-4 rounded-xl overflow-auto max-h-[70vh] whitespace-pre-wrap break-words">
            {activeContentText}
          </pre>
        </div>
      ) : debugOpen && hasDebug ? (
        <div className="space-y-4">
          <StageOutputs
            outputs={blog.stageOutputs}
            logs={blog.stageLogs || {}}
            order={STAGE_ORDER}
            defaultTab="text-generator"
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-[var(--text-dim)] mb-1.5 uppercase tracking-wide">Editor Blocks</p>
              <pre className="whitespace-pre-wrap break-words text-xs bg-[#0a0d14] border border-[var(--border)] rounded-lg p-4 overflow-x-auto max-h-72">
                {JSON.stringify(blog.editorBlocks || [], null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--text-dim)] mb-1.5 uppercase tracking-wide">Request</p>
              <pre className="whitespace-pre-wrap break-words text-xs bg-[#0a0d14] border border-[var(--border)] rounded-lg p-4 overflow-x-auto max-h-72">
                {JSON.stringify(blog.request, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      ) : (
        (blog.html || blog.markdown) && (
          <article className="card p-8">
            <div className="article-prose">
              {blog.html ? (
                // Render HTML segments: plain HTML interspersed with edit-overlaid images
                <div>
                  {htmlSegments.map((seg, i) =>
                    seg.type === 'html' ? (
                      <span key={i} dangerouslySetInnerHTML={{ __html: seg.content }} />
                    ) : (
                      <span key={i} className="relative inline-block group w-full">
                        <img
                          src={seg.src}
                          alt={seg.alt}
                          className="w-full rounded-lg"
                        />
                        {seg.src && (
                          <button
                            onClick={() => openImageEdit(seg.src)}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 hover:bg-black/90 text-white text-xs font-medium px-3 py-1.5 rounded-lg border border-white/20"
                          >
                            Edit Image
                          </button>
                        )}
                      </span>
                    )
                  )}
                </div>
              ) : (
                <MarkdownRenderer>{blog.markdown || ''}</MarkdownRenderer>
              )}
            </div>
          </article>
        )
      )}
    </div>
  );
}
