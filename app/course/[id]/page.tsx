'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Stages, StageItem } from '@/app/_components/Stages';
import { StageOutputs, StageOutputMap, StageLogMap } from '@/app/_components/StageOutputs';

const STAGE_ORDER = [
  'web-research',
  'json-outline',
  'content-creator',
  'summary-elements',
  'pr-reviewer',
  'widget-images',
  'widget-code',
  'widget-table',
  'widget-runjs',
  'editor-blocks',
  'save-lesson',
  'save-chapter',
  'publish',
];

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

          {(state.editedUrl || state.loading) && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-[var(--text-dim)] uppercase tracking-wide mb-2 font-medium">Original</p>
                <img src={state.originalUrl} alt="Original" className="w-full rounded-lg border border-[var(--border)] object-contain max-h-64" />
              </div>
              <div>
                <p className="text-xs text-[var(--text-dim)] uppercase tracking-wide mb-2 font-medium">Edited</p>
                {state.loading ? (
                  <div className="w-full max-h-64 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] flex items-center justify-center h-40 text-sm text-[var(--text-dim)]">
                    Generating…
                  </div>
                ) : (
                  <img src={state.editedUrl!} alt="Edited" className="w-full rounded-lg border border-[var(--border)] object-contain max-h-64" />
                )}
              </div>
            </div>
          )}

          {!state.editedUrl && !state.loading && (
            <div>
              <p className="text-xs text-[var(--text-dim)] uppercase tracking-wide mb-2 font-medium">Current image</p>
              <img src={state.originalUrl} alt="Current" className="w-full rounded-lg border border-[var(--border)] object-contain max-h-64" />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-[var(--border)]">
          <button className="btn-secondary" onClick={onClose} disabled={state.loading}>Cancel</button>
          {!state.editedUrl ? (
            <button className="btn-primary" onClick={onSubmit} disabled={state.loading || !state.prompt.trim()}>
              {state.loading ? 'Generating…' : 'Generate Edit'}
            </button>
          ) : (
            <>
              <button className="btn-secondary" onClick={onSubmit} disabled={state.loading}>
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

export default function CourseLessonRunPage() {
  const { id } = useParams<{ id: string }>();

  const [stages, setStages] = useState<StageItem[]>([]);
  const [outputs, setOutputs] = useState<StageOutputMap>({});
  const [logs, setLogs] = useState<StageLogMap>({});
  const [final, setFinal] = useState<any>(null);
  const [err, setErr] = useState('');
  const [running, setRunning] = useState(true);
  const [debugOpen, setDebugOpen] = useState(false);

  const [publishUrl, setPublishUrl] = useState('');
  const [publishErr, setPublishErr] = useState('');

  const [contentView, setContentView] = useState<null | 'markdown'>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  const [imageEdit, setImageEdit] = useState<ImageEditState | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    abortRef.current = ctl;

    async function stream() {
      try {
        const res = await fetch(`/api/blog/${id}/stream`, { signal: ctl.signal });
        if (!res.ok || !res.body) {
          setErr('Failed to connect to pipeline stream');
          setRunning(false);
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() || '';
          for (const line of parts) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              handleEvent(evt);
            } catch {}
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') setErr(e?.message || String(e));
      } finally {
        setRunning(false);
      }
    }

    function handleEvent(evt: any) {
      if (evt.type === 'stage') {
        setStages((s) => {
          const existing = s.findIndex((x) => x.name === evt.name);
          if (existing >= 0) {
            const copy = [...s];
            copy[existing] = { name: evt.name, status: evt.status };
            return copy;
          }
          return [...s, { name: evt.name, status: evt.status }];
        });
      } else if (evt.type === 'data') {
        setOutputs((o) => ({ ...o, [evt.name]: evt.payload }));
      } else if (evt.type === 'stream' && evt.name) {
        setOutputs((o) => ({ ...o, [evt.name]: evt.payload }));
      } else if (evt.type === 'log' && evt.name) {
        setLogs((l) => ({ ...l, [evt.name]: [...(l[evt.name] || []), evt.payload] }));
      } else if (evt.type === 'final') {
        setFinal(evt.payload);
      } else if (evt.type === 'error') {
        setErr(evt.message || 'Pipeline error');
      } else if (evt.type === 'done' || evt.type === 'cancelled') {
        setRunning(false);
      }
    }

    stream();
    return () => { ctl.abort(); };
  }, [id]);

  async function stop() {
    if (!confirm('Stop this in-progress lesson generation?')) return;
    abortRef.current?.abort();
    await fetch(`/api/blog/${id}/cancel`, { method: 'POST' });
    setRunning(false);
  }

  function startEdit() {
    setEditing(true);
    setContentView(null);
    setDebugOpen(false);
    setEditDraft(final?.markdown || '');
  }

  async function saveEdit() {
    setSaving(true);
    setSaveErr('');
    try {
      const res = await fetch(`/api/blog/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: editDraft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Save failed');
      setFinal((f: any) => ({ ...f, markdown: json.markdown }));
      setEditing(false);
    } catch (e: any) {
      setSaveErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  function copyMarkdown() {
    navigator.clipboard.writeText(final?.markdown || '').catch(() => {});
  }

  function downloadMarkdown() {
    const content = final?.markdown || '';
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${final?.lessonTitle || final?.title || 'lesson'}.md`;
    a.click();
    URL.revokeObjectURL(url);
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
    if (!imageEdit?.editedUrl || !final) return;
    const oldUrl = imageEdit.originalUrl;
    const newUrl = imageEdit.editedUrl;

    const updatedBlocks = (final.editorBlocks || []).map((block: any) => {
      if (block?.type === 'Image') {
        const blockUrl = block?.content?.url || block?.content?.path || '';
        if (blockUrl === oldUrl) {
          return { ...block, content: { ...block.content, url: newUrl, path: newUrl } };
        }
      }
      return block;
    });

    const updatedHtml = (final.html || '').replace(
      new RegExp(oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      newUrl,
    );

    try {
      const res = await fetch(`/api/blog/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: updatedHtml, editorBlocks: updatedBlocks }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Save failed');
      setFinal((f: any) => ({ ...f, html: updatedHtml, editorBlocks: updatedBlocks }));
      setImageEdit(null);
    } catch (e: any) {
      setImageEdit((s) => s ? { ...s, error: e?.message || String(e) } : s);
    }
  }

  const isDone = !running && !!final;
  const lessonTitle = final?.lessonTitle || final?.title || 'Lesson';
  const publishedUrl = outputs['publish']?.url || outputs['save-lesson']?.url || '';
  const lessonPageId = outputs['save-lesson']?.pageId || '';
  const htmlSegments = final?.html ? parseHtmlSegments(final.html) : [];

  return (
    <div className="space-y-8">

      {imageEdit && (
        <ImageEditModal
          state={imageEdit}
          onPromptChange={(v) => setImageEdit((s) => s ? { ...s, prompt: v } : s)}
          onSubmit={submitImageEdit}
          onUpdate={applyImageEdit}
          onClose={() => setImageEdit(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/course/new" className="text-xs text-[var(--text-faint)] hover:text-[var(--text)] mb-3 inline-block">
            ← New Lesson
          </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="pill">Course</span>
            <h1 className="text-2xl font-bold tracking-tight line-clamp-2">
              {lessonTitle}
            </h1>
          </div>
          {final?.chapterTitle && (
            <p className="mt-1 text-sm text-[var(--text-dim)]">
              Chapter: {final.chapterTitle}
              {final?.courseTitle && ` · ${final.courseTitle}`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isDone && editing && (
            <>
              {saveErr && <span className="text-xs text-red-300">{saveErr}</span>}
              <button className="btn-secondary" disabled={saving} onClick={() => { setEditing(false); setSaveErr(''); }}>Cancel</button>
              <button className="btn-primary" disabled={saving} onClick={saveEdit}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}

          {isDone && !editing && (
            <>
              <button
                className={`btn-secondary text-xs${contentView === 'markdown' ? ' ring-1 ring-[var(--accent)]' : ''}`}
                onClick={() => { setContentView((v) => v === 'markdown' ? null : 'markdown'); setDebugOpen(false); setEditing(false); }}
              >
                Markdown
              </button>
              <button className="btn-secondary" onClick={startEdit}>Edit</button>
            </>
          )}

          {!editing && (
            <button
              className="btn-secondary"
              onClick={() => { setDebugOpen((v) => !v); setContentView(null); setEditing(false); }}
            >
              {debugOpen ? 'Hide Debug' : 'Debug'}
            </button>
          )}

          {running && (
            <button className="btn-secondary text-xs py-1.5 px-3" onClick={stop}>
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Progress card */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Pipeline progress</h2>
          {running && (
            <span className="pill pill-running inline-flex items-center gap-1.5 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 dot-running" />
              generating
            </span>
          )}
        </div>
        <Stages items={stages} />
      </div>

      {/* Published URL */}
      {publishedUrl && (
        <div className="card p-4 flex items-center gap-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400 shrink-0">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[var(--text-faint)] mb-0.5">Published to Educative</p>
            <a href={publishedUrl} target="_blank" rel="noreferrer" className="text-sm text-emerald-300 underline truncate block">
              {publishedUrl}
            </a>
          </div>
          {lessonPageId && (
            <span className="text-xs text-[var(--text-faint)] font-mono shrink-0">page: {lessonPageId}</span>
          )}
        </div>
      )}

      {err && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 p-4 text-sm">{err}</div>
      )}
      {publishErr && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 p-4 text-sm">{publishErr}</div>
      )}

      {/* Main content — mutually exclusive views */}
      {isDone && (
        editing ? (
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Edit lesson content</h2>
              <span className="text-xs text-[var(--text-faint)]">Markdown</span>
            </div>
            <textarea
              className="input w-full min-h-[60vh] font-mono text-xs"
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
            />
          </div>
        ) : contentView === 'markdown' ? (
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-dim)]">Markdown source</h3>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" onClick={copyMarkdown}>Copy</button>
                <button className="btn-secondary text-xs" onClick={downloadMarkdown}>Download</button>
              </div>
            </div>
            <pre className="text-xs font-mono bg-[var(--panel-2)] border border-[var(--border)] p-4 rounded-xl overflow-auto max-h-[70vh] whitespace-pre-wrap break-words">
              {final?.markdown || ''}
            </pre>
          </div>
        ) : debugOpen ? (
          <div className="card p-5">
            <StageOutputs outputs={outputs} logs={logs} order={STAGE_ORDER} />
          </div>
        ) : (
          <>
            {/* Lesson content — HTML with image edit overlays */}
            {(final?.html || final?.markdown) && (
              <article className="card p-8">
                <div className="article-prose">
                  {final.html ? (
                    <div>
                      {htmlSegments.map((seg, i) =>
                        seg.type === 'html' ? (
                          <span key={i} dangerouslySetInnerHTML={{ __html: seg.content }} />
                        ) : (
                          <span key={i} className="relative inline-block group w-full">
                            <img src={seg.src} alt={seg.alt} className="w-full rounded-lg" />
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                      {final.markdown}
                    </ReactMarkdown>
                  )}
                </div>
              </article>
            )}

            {/* Widget blocks summary */}
            {final?.editorBlocks?.length > 0 && (
              <div className="card p-5">
                <h2 className="text-sm font-semibold mb-3">Widget blocks</h2>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const counts: Record<string, number> = {};
                    for (const b of final.editorBlocks) {
                      counts[b.type] = (counts[b.type] || 0) + 1;
                    }
                    return Object.entries(counts).map(([type, count]) => (
                      <span key={type} className="pill py-0.5 text-xs">
                        {type} × {count}
                      </span>
                    ));
                  })()}
                  <span className="pill py-0.5 text-xs font-semibold">
                    {final.editorBlocks.length} total
                  </span>
                </div>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
