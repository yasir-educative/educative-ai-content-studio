'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Stages, StageItem } from '@/app/_components/Stages';
import type { StageOutputMap, StageLogMap } from '@/app/_components/StageOutputs';

const ReactMarkdown = dynamic(() => import('react-markdown'), { ssr: false });
const StageOutputs = dynamic(
  () => import('@/app/_components/StageOutputs').then((m) => ({ default: m.StageOutputs })),
  { ssr: false },
);

const STAGE_ORDER = [
  'topic-research', 'json-outline', 'outline-review', 'text-generator',
  'zachgpt-review', 'zachgpt-incorporate', 'seo-keywords', 'seo-editor',
  'pr-reviewer', 'widgets-extract', 'markdown-to-html', 'structure-output',
  'sanitize-format', 'widgets-generate', 'editor-blocks', 'publish',
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

export default function NewsletterRunPage() {
  const { id: slugParam } = useParams<{ id: string }>();
  const id = slugParam.includes('--')
    ? slugParam.slice(slugParam.lastIndexOf('--') + 2)
    : slugParam;

  const [stages, setStages] = useState<StageItem[]>([]);
  const [outputs, setOutputs] = useState<StageOutputMap>({});
  const [logs, setLogs] = useState<StageLogMap>({});
  const [final, setFinal] = useState<any>(null);
  const [err, setErr] = useState('');
  const [running, setRunning] = useState(true);
  const [debugOpen, setDebugOpen] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [publishUrl, setPublishUrl] = useState('');
  const [publishErr, setPublishErr] = useState('');

  const [contentView, setContentView] = useState<null | 'html' | 'markdown'>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const editRef = useRef<HTMLDivElement>(null);

  const [imageEdit, setImageEdit] = useState<ImageEditState | null>(null);

  const [reviewPopup, setReviewPopup] = useState<{ gate: string; display: string; json: any } | null>(null);
  const [reviewEditing, setReviewEditing] = useState(false);
  const [reviewDraft, setReviewDraft] = useState('');
  const [reviewCountdown, setReviewCountdown] = useState(60);
  const reviewResolveRef = useRef<(() => void) | null>(null);
  const reviewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reviewAutoRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
              await handleEvent(evt);
            } catch {}
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') setErr(e?.message || String(e));
      } finally {
        setRunning(false);
      }
    }

    async function handleEvent(evt: any) {
      if (evt.type === 'stage') {
        setStages((s) => [...s, { name: evt.name, status: evt.status }]);
      } else if (evt.type === 'data') {
        setOutputs((o) => ({ ...o, [evt.name]: evt.payload }));
      } else if (evt.type === 'stream' && evt.name) {
        setOutputs((o) => ({ ...o, [evt.name]: evt.payload }));
      } else if (evt.type === 'log' && evt.name) {
        setLogs((l) => ({ ...l, [evt.name]: [...(l[evt.name] || []), evt.payload] }));
      } else if (evt.type === 'final') {
        setFinal(evt.payload);
      } else if (evt.type === 'error') {
        setErr(evt.message);
      } else if (evt.type === 'cancelled') {
        setErr('Generation cancelled');
      } else if (evt.type === 'awaiting-input' && evt.gate === 'outline-review') {
        const display = evt.payload?.display || '';
        const json = evt.payload?.json;
        setReviewPopup({ gate: evt.gate, display, json });
        setReviewDraft(display);
        setReviewEditing(false);
        setReviewCountdown(60);
        reviewTimerRef.current = setInterval(
          () => setReviewCountdown((c) => Math.max(0, c - 1)),
          1000,
        );
        reviewAutoRef.current = setTimeout(() => triggerResume(false), 60_000);
        await new Promise<void>((resolve) => { reviewResolveRef.current = resolve; });
        setReviewPopup(null);
      }
    }

    stream();
    return () => ctl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function triggerResume(edited: boolean) {
    if (reviewTimerRef.current) { clearInterval(reviewTimerRef.current); reviewTimerRef.current = null; }
    if (reviewAutoRef.current) { clearTimeout(reviewAutoRef.current); reviewAutoRef.current = null; }
    fetch(`/api/blog/${id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gate: 'outline-review', value: edited ? reviewDraft : undefined, edited }),
    }).catch(() => {});
    reviewResolveRef.current?.();
    reviewResolveRef.current = null;
  }

  async function stop() {
    try { await fetch(`/api/blog/${id}/cancel`, { method: 'POST' }); } catch {}
    abortRef.current?.abort();
  }

  async function publish() {
    if (!final?.editorBlocks?.length) { setPublishErr('No editor blocks available'); return; }
    setPublishing(true);
    setPublishErr('');
    setPublishUrl('');
    try {
      const CATEGORY_MAP: Record<string, string> = {
        'System Design': 'System Design',
        'AI/ML': 'Artificial Intelligence',
        'Cloud': 'Cloud',
      };
      const category = CATEGORY_MAP[final.vertical] ?? 'System Design';
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: final.title,
          blocks: final.editorBlocks,
          blogId: id,
          templateId: '5005',
          pageType: 'newsletter',
          categories: JSON.stringify([category]),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Publish failed');
      setPublishUrl(json.url);
    } catch (e: any) {
      setPublishErr(e?.message || String(e));
    } finally {
      setPublishing(false);
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

  function startEdit() {
    setEditing(true);
    setContentView(null);
    setDebugOpen(false);
    requestAnimationFrame(() => {
      if (editRef.current) editRef.current.innerHTML = final?.html || '';
    });
  }

  async function saveEdit() {
    const html = editRef.current?.innerHTML || '';
    setSaving(true);
    setSaveErr('');
    try {
      const res = await fetch(`/api/blog/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Save failed');
      setFinal((f: any) => ({ ...f, html: json.html }));
      setEditing(false);
    } catch (e: any) {
      setSaveErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
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
  const hasDebug = stages.length > 0 || Object.keys(outputs).length > 0;
  const liveText = typeof outputs['text-generator'] === 'string' ? outputs['text-generator'] : null;

  const activeContentText = contentView === 'html' ? (final?.html || '') : (final?.markdown || '');
  const activeContentExt = contentView === 'html' ? 'html' : 'md';
  const activeContentMime = contentView === 'html' ? 'text/html' : 'text/markdown';

  const htmlSegments = final?.html ? parseHtmlSegments(final.html) : [];

  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isDone) return;
    setDebugOpen(false);
    setContentView(null);
    setTimeout(() => articleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone]);

  return (
    <div className="space-y-6">

      {imageEdit && (
        <ImageEditModal
          state={imageEdit}
          onPromptChange={(v) => setImageEdit((s) => s ? { ...s, prompt: v } : s)}
          onSubmit={submitImageEdit}
          onUpdate={applyImageEdit}
          onClose={() => setImageEdit(null)}
        />
      )}

      {/* ── Top bar ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/newsletter/new" className="text-sm text-[var(--text-dim)] hover:text-white">← New Newsletter</Link>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight break-words">
            {final?.title || (running ? 'Generating newsletter…' : 'Newsletter generation')}
          </h1>
          {final && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {final.vertical && <span className="pill">{final.vertical}</span>}
              {final.audience && <span className="pill">{final.audience}</span>}
              {final.widgets?.code?.length > 0 && <span className="pill pill-success">{final.widgets.code.length} code</span>}
              {final.widgets?.table?.length > 0 && <span className="pill pill-success">{final.widgets.table.length} table</span>}
              {final.widgets?.image?.length > 0 && <span className="pill pill-success">{final.widgets.image.length} image</span>}
              {final.editorBlocks?.length > 0 && <span className="pill">{final.editorBlocks.length} blocks</span>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
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
                onClick={() => { setContentView((v) => v === 'markdown' ? null : 'markdown'); setDebugOpen(false); }}
              >
                Markdown
              </button>
              <button
                className={`btn-secondary text-xs${contentView === 'html' ? ' ring-1 ring-[var(--accent)]' : ''}`}
                onClick={() => { setContentView((v) => v === 'html' ? null : 'html'); setDebugOpen(false); }}
              >
                HTML
              </button>
              <button className="btn-secondary" onClick={startEdit}>Edit</button>
            </>
          )}

          {hasDebug && !editing && (
            <button className="btn-secondary" onClick={() => { setDebugOpen((v) => !v); setContentView(null); }}>
              {debugOpen ? 'Hide Debug' : 'Debug'}
            </button>
          )}

          {running && (
            <button className="btn-secondary" onClick={stop}>
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-400 mr-1" />
              Stop
            </button>
          )}

          {isDone && !editing && (
            <button
              className="btn-primary"
              disabled={publishing || !final?.editorBlocks?.length}
              onClick={publish}
            >
              {publishing ? 'Publishing…' : publishUrl ? 'Re-publish' : 'Publish to Educative'}
            </button>
          )}
        </div>
      </div>

      {publishUrl && (
        <div className="text-sm">
          Published:{' '}
          <a className="underline text-emerald-300 break-all" href={publishUrl} target="_blank" rel="noreferrer">
            {publishUrl}
          </a>
        </div>
      )}
      {publishErr && <div className="text-sm text-red-300">{publishErr}</div>}
      {err && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 p-4 text-sm">{err}</div>
      )}

      {running && (
        <div className="space-y-4">
          {stages.length > 0 && <Stages items={stages} />}
          {liveText && !debugOpen && (
            <div className="card p-6">
              <p className="text-xs font-medium text-[var(--text-dim)] mb-3 uppercase tracking-wide">
                Live draft (streaming)
              </p>
              <div className="article-prose max-h-[500px] overflow-y-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {liveText}
                </ReactMarkdown>
              </div>
            </div>
          )}
          {debugOpen && Object.keys(outputs).length > 0 && (
            <StageOutputs outputs={outputs} logs={logs} order={STAGE_ORDER} defaultTab="text-generator" />
          )}
        </div>
      )}

      {isDone && (
        editing ? (
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
                  onClick={() => download(activeContentText, `${final.title || 'newsletter'}.${activeContentExt}`, activeContentMime)}
                >
                  Download
                </button>
              </div>
            </div>
            <pre className="text-xs font-mono bg-[var(--panel-2)] border border-[var(--border)] p-4 rounded-xl overflow-auto max-h-[70vh] whitespace-pre-wrap break-words">
              {activeContentText}
            </pre>
          </div>
        ) : debugOpen ? (
          <StageOutputs outputs={outputs} logs={logs} order={STAGE_ORDER} defaultTab="text-generator" />
        ) : (
          <article ref={articleRef} className="card p-8">
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
                  {final.markdown || ''}
                </ReactMarkdown>
              )}
            </div>
          </article>
        )
      )}

      {reviewPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
              <div>
                <h2 className="text-lg font-semibold">Outline Generated</h2>
                <p className="text-xs text-[var(--text-dim)] mt-0.5">
                  Pipeline is paused. You can edit the outline before continuing.
                </p>
              </div>
              <span className="pill pill-running">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 dot-running" />
                Auto-continue in {reviewCountdown}s
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
              {!reviewEditing ? (
                <div className="article-prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                    {reviewPopup.display}
                  </ReactMarkdown>
                </div>
              ) : (
                <textarea
                  className="input w-full min-h-[400px] font-mono text-xs"
                  value={reviewDraft}
                  onChange={(e) => setReviewDraft(e.target.value)}
                />
              )}
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[var(--border)]">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setReviewEditing(!reviewEditing)}
              >
                {reviewEditing ? 'Preview Outline' : 'Review and Edit Outline'}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => triggerResume(reviewEditing)}
              >
                Continue Newsletter Generation
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
