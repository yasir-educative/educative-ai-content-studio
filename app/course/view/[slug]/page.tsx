'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { StageItem } from '@/app/_components/Stages';

const MarkdownRenderer = dynamic(() => import('@/app/_components/MarkdownRenderer'), { ssr: false });
import { Stages } from '@/app/_components/Stages';

type Status = 'running' | 'draft' | 'published' | 'failed' | 'cancelled';

type LessonSummary = {
  id: string;
  createdAt: string;
  status: Status;
  runType?: string;
  blogTitle: string;
  finalTitle?: string;
  chapterTitle?: string;
  courseTitle?: string;
  publishedUrl?: string;
  live?: boolean;
};

type ChapterGroup = {
  chapterTitle: string;
  lessons: LessonSummary[];
};

type FullLesson = {
  id: string;
  markdown?: string;
  html?: string;
  finalTitle?: string;
  errorMessage?: string;
  request?: { blogTitle?: string; chapterTitle?: string; courseTitle?: string; authorId?: string; collectionId?: string };
  status: Status;
  publishedUrl?: string;
  editorBlocks?: any[];
};

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
              placeholder="e.g. Change the background to dark blue, add more contrast…"
              value={state.prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              disabled={state.loading}
            />
          </div>
          {state.error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{state.error}</div>
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
                  <div className="w-full max-h-64 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] flex items-center justify-center h-40 text-sm text-[var(--text-dim)]">Generating…</div>
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
              <button className="btn-primary" onClick={onUpdate} disabled={state.loading}>Use This Image</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type PublishResult = {
  id: string;
  lessonTitle: string;
  status: 'published' | 'failed' | 'skipped';
  pageId?: string;
  url?: string;
  reason?: string;
  error?: string;
};

function groupByChapter(lessons: LessonSummary[]): ChapterGroup[] {
  const map = new Map<string, ChapterGroup>();
  const order: string[] = [];
  for (const l of [...lessons].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const key = l.chapterTitle || 'Chapter 1';
    if (!map.has(key)) {
      map.set(key, { chapterTitle: key, lessons: [] });
      order.push(key);
    }
    map.get(key)!.lessons.push(l);
  }
  return order.map((k) => map.get(k)!);
}

function lessonLabel(l: LessonSummary) {
  return l.finalTitle || l.blogTitle || '(untitled)';
}

function StatusDot({ status }: { status: Status }) {
  if (status === 'running') return <span className="inline-block w-2 h-2 rounded-full bg-amber-400 dot-running shrink-0" />;
  if (status === 'published') return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shrink-0" />;
  if (status === 'failed' || status === 'cancelled') return <span className="inline-block w-2 h-2 rounded-full bg-red-400 shrink-0" />;
  return <span className="inline-block w-2 h-2 rounded-full bg-slate-500 shrink-0" />;
}

// ── Helper: clean widget placeholders from raw markdown for stream preview ─────

function cleanStreamContent(md: string): string {
  return md
    .replace(/\[image\]([\s\S]*?)\[\/image\]/gi, (_, inner) => {
      const cap = inner.match(/\[Caption\]([\s\S]*?)\[\/Caption\]/i)?.[1]?.trim();
      return `\n\n> *\\[Image${cap ? ': ' + cap : ''}\\]*\n\n`;
    })
    .replace(/\[Hint\]([\s\S]*?)\[\/Hint\]/gi, '\n\n> *\\[Hint widget\\]*\n\n')
    .replace(/\[code\]([\s\S]*?)\[\/code\]/gi, '\n\n> *\\[Code widget\\]*\n\n')
    .replace(/\[table\]([\s\S]*?)\[\/table\]/gi, '\n\n> *\\[Table widget\\]*\n\n')
    .replace(/\[quiz\]([\s\S]*?)\[\/quiz\]/gi, '\n\n> *\\[Quiz widget\\]*\n\n')
    .replace(/\[AI assessment\]([\s\S]*?)\[\/AI assessment\]/gi, '\n\n> *\\[AI Assessment widget\\]*\n\n')
    .replace(/\[markmap\]([\s\S]*?)\[\/markmap\]/gi, '\n\n> *\\[Mindmap widget\\]*\n\n')
    .replace(/\[runjs\]([\s\S]*?)\[\/runjs\]/gi, '\n\n> *\\[RunJS widget\\]*\n\n')
    .replace(/#key#\s*([\s\S]*?)\s*#key#/g, '**$1**');
}

// ── Interactive Quiz widget (slide view) ──────────────────────────────────────

function QuizWidget({ block }: { block: any }) {
  const questions: any[] = block.content?.questions || [];
  const title = block.content?.title || 'Knowledge Check';
  const [slide, setSlide] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});

  const reset = useCallback(() => { setAnswers({}); setSlide(0); }, []);

  if (!questions.length) return null;

  const q = questions[slide];
  // Support both Educative block format (questionText/questionOptions) and plain format (question/options)
  const questionText: string = q.questionText || q.question || '';
  const opts: any[] = q.questionOptions || q.options || [];
  const correctIdx = opts.findIndex((o: any) => o.correct === true);
  const explanation: string = correctIdx >= 0 ? (opts[correctIdx]?.explanation?.mdText || '') : '';

  const selected = answers[slide];
  const answered = selected !== undefined;
  const isRight = selected === correctIdx;
  const total = questions.length;
  const answered_count = Object.keys(answers).length;

  return (
    <div className="my-6 rounded-xl border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--panel-2)]">
        <div className="flex items-center gap-2">
          <span className="pill text-xs py-0.5">Quiz</span>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-faint)] tabular-nums">{slide + 1} / {total}</span>
          {answered_count > 0 && (
            <button onClick={reset} className="text-xs text-[var(--text-faint)] hover:text-[var(--text)] transition-colors">
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-[var(--border)]">
        <div
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${((slide + 1) / total) * 100}%` }}
        />
      </div>

      {/* Question */}
      <div className="p-5 space-y-4 min-h-[200px]">
        <p className="text-sm font-medium text-[var(--text)] leading-relaxed">{questionText}</p>
        <ul className="space-y-2">
          {opts.map((opt: any, oi: number) => {
            const text = typeof opt === 'string' ? opt : opt?.text || '';
            const isCorrectOpt = oi === correctIdx;
            const isSelected = selected === oi;
            let cls = 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--accent)]/60 hover:text-[var(--text)] cursor-pointer';
            if (answered) {
              if (isCorrectOpt) cls = 'border-emerald-500 bg-emerald-500/10 text-emerald-300 cursor-default';
              else if (isSelected) cls = 'border-red-500 bg-red-500/10 text-red-300 cursor-default';
              else cls = 'border-[var(--border)] text-[var(--text-faint)] cursor-default opacity-50';
            }
            return (
              <li key={oi}>
                <button
                  className={`w-full text-left text-xs px-3 py-2.5 rounded-lg border transition-all ${cls}`}
                  onClick={() => { if (!answered) setAnswers(prev => ({ ...prev, [slide]: oi })); }}
                  disabled={answered}
                >
                  <span className="font-mono mr-2 opacity-60">{String.fromCharCode(65 + oi)}.</span>
                  {text}
                  {answered && isCorrectOpt && <span className="float-right ml-2 text-emerald-400">✓</span>}
                  {answered && isSelected && !isCorrectOpt && <span className="float-right ml-2 text-red-400">✗</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {answered && explanation && (
          <p className={`text-xs rounded-lg px-3 py-2 border ${isRight ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/8' : 'text-amber-300 border-amber-500/30 bg-amber-500/8'}`}>
            {isRight ? '✓ Correct — ' : '✗ Incorrect — '}{explanation}
          </p>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--panel-2)]">
        <button
          className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={() => setSlide(s => Math.max(0, s - 1))}
          disabled={slide === 0}
        >
          ← Previous
        </button>

        {/* Dot indicators */}
        <div className="flex items-center gap-1.5">
          {questions.map((_: any, i: number) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              className={`rounded-full transition-all ${
                i === slide
                  ? 'w-4 h-2 bg-emerald-400'
                  : answers[i] !== undefined
                  ? 'w-2 h-2 bg-emerald-500/50'
                  : 'w-2 h-2 bg-[var(--border)] hover:bg-[var(--text-faint)]'
              }`}
              title={`Question ${i + 1}`}
            />
          ))}
        </div>

        <button
          className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={() => setSlide(s => Math.min(total - 1, s + 1))}
          disabled={slide === total - 1}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ── RunJS iframe widget ────────────────────────────────────────────────────────

// Reconstruct the full HTML from jotted panes (new format) or fall back to
// the legacy content.html field.
function getRunJsHtml(block: any): string {
  const c = block.content || {};
  const files: any[] = c.jotted?.files || [];
  if (files.length > 0) {
    const getFile = (type: string) => files.find((f: any) => f.type === type)?.content || '';
    let html = getFile('html');
    const css = getFile('css');
    const js = getFile('js');
    if (html) {
      if (css) html = html.replace('</head>', `<style>${css}</style>\n</head>`);
      if (js) html = html.replace('</body>', `<script>${js}</script>\n</body>`);
      return html;
    }
  }
  return c.html || '';
}

function RunJsWidget({ block }: { block: any }) {
  const html = getRunJsHtml(block);
  const caption = block.content?.jotted?.caption || block.content?.caption || '';
  const height = Number(block.content?.jotted?.height) || block.content?.height || 600;
  const [loaded, setLoaded] = useState(false);

  if (!html) return null;

  return (
    <div className="my-6 rounded-xl border border-emerald-500/30 bg-[var(--panel)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wide">Interactive Diagram</span>
          {caption && <span className="text-xs text-[var(--text-dim)]">— {caption}</span>}
        </div>
        {!loaded && <span className="text-[10px] text-[var(--text-faint)] animate-pulse">Loading…</span>}
      </div>
      <iframe
        srcDoc={html}
        sandbox="allow-scripts"
        style={{ width: '100%', height: `${height}px`, border: 'none', display: 'block', background: '#0a0e1a' }}
        onLoad={() => setLoaded(true)}
        title={caption || 'Interactive architecture diagram'}
      />
    </div>
  );
}

// ── MarkMap mind-map widget (markmap-lib + markmap-view, client-side SVG) ──────

function MarkMapWidget({ block }: { block: any }) {
  const title = block.content?.caption || block.content?.title || 'Concept Map';
  // Block stores content in 'text' (Educative format); fall back to 'markdown' for legacy data
  const markdown = block.content?.text || block.content?.markdown || '';
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!markdown || !svgRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const [{ Transformer }, { Markmap }] = await Promise.all([
          import('markmap-lib'),
          import('markmap-view'),
        ]);
        if (cancelled || !svgRef.current) return;
        const transformer = new Transformer();
        const { root } = transformer.transform(markdown);
        if (mmRef.current) {
          mmRef.current.setData(root);
          mmRef.current.fit();
        } else {
          const colors = ['#a78bfa', '#34d399', '#60a5fa', '#f472b6', '#fbbf24'];
          let ci = 0;
          mmRef.current = Markmap.create(svgRef.current, { duration: 300, color: () => colors[ci++ % colors.length], paddingX: 16 }, root);
        }
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => { cancelled = true; };
  }, [markdown]);

  if (!markdown) return null;

  return (
    <div className="my-6 rounded-xl border border-purple-500/30 bg-[var(--panel)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-purple-500/20 bg-purple-500/5">
        <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />
        <span className="text-xs font-semibold text-purple-300 uppercase tracking-wide">Mind Map</span>
        <span className="text-sm text-[var(--text)]">{title}</span>
      </div>
      <div className="markmap-dark relative" style={{ height: '380px', background: '#13111c' }}>
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--text-faint)] animate-pulse">
            Loading mind map…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--text-faint)]">
            Mind map unavailable
          </div>
        )}
        <svg
          ref={svgRef}
          className="markmap"
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
}

// ── EditorBlocksRenderer ────────────────────────────────────────────────────────

function EditorBlocksRenderer({ blocks, onEditImage }: { blocks: any[]; onEditImage?: (src: string) => void }) {
  return (
    <div>
      {blocks.map((block, i) => {
        switch (block?.type) {
          case 'SlateHTML': {
            const html = block.content?.html || '';
            if (!html.trim()) return null;
            return (
              <div
                key={i}
                className="article-prose"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          }

          case 'Code': {
            const code = block.content?.content || block.content?.code || '';
            const lang = block.content?.language || '';
            const caption = block.content?.caption || block.content?.widgetTitle || '';
            return (
              <div key={i} className="my-6 rounded-xl border border-[var(--border)] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-[var(--panel-2)] border-b border-[var(--border)]">
                  <span className="text-xs font-mono text-[var(--text-dim)]">{lang || 'code'}</span>
                  {caption && <span className="text-xs text-[var(--text-faint)] truncate max-w-xs">{caption}</span>}
                </div>
                <pre className="p-4 text-xs font-mono overflow-x-auto max-h-96 bg-[#0a0d14] leading-relaxed">
                  <code className="text-[#c9d1d9]">{code}</code>
                </pre>
              </div>
            );
          }

          case 'Table': {
            const rows: string[][] = block.content?.data || [];
            if (!rows.length) return null;
            const title = block.content?.title || '';
            return (
              <div key={i} className="my-6 overflow-x-auto">
                {title && (
                  <p className="text-xs font-semibold text-[var(--text-dim)] mb-2 text-center uppercase tracking-wide">{title}</p>
                )}
                <table className="w-full text-sm border-collapse rounded-xl overflow-hidden">
                  <tbody>
                    {rows.map((row, ri) => (
                      <tr key={ri} className={ri === 0 ? 'bg-[var(--panel-2)]' : 'border-t border-[var(--border)] odd:bg-[var(--panel)] even:bg-transparent'}>
                        {row.map((cell, ci) => {
                          const Tag = ri === 0 ? 'th' : 'td';
                          return (
                            <Tag
                              key={ci}
                              className="border border-[var(--border)] px-3 py-2.5 text-left font-normal"
                              dangerouslySetInnerHTML={{ __html: cell }}
                            />
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          case 'Image': {
            const src = block.content?.path || block.content?.url || '';
            const rawCaption = block.content?.caption || block.content?.alt || '';
            // Strip leading/trailing brackets that the LLM sometimes wraps captions in
            const caption = rawCaption.startsWith('[') && rawCaption.endsWith(']')
              ? rawCaption.slice(1, -1).trim()
              : rawCaption;
            if (!src) {
              return (
                <div key={i} className="my-6 rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel)] p-8 text-xs text-[var(--text-faint)] text-center space-y-1">
                  <div className="text-2xl">🖼</div>
                  <div>{caption || 'Image placeholder'}</div>
                </div>
              );
            }
            const fullSrc = src.startsWith('/api/') || src.startsWith('http') ? src : `https://www.educative.io${src}`;
            const isLocal = src.startsWith('/api/');
            return (
              <div key={i} className="my-6 text-center">
                <div className="relative inline-block group w-full">
                  <img
                    src={fullSrc}
                    alt={caption}
                    className="max-w-full mx-auto rounded-xl border border-[var(--border)] shadow-lg"
                    loading="lazy"
                    onError={(e) => {
                      const target = e.currentTarget;
                      target.style.display = 'none';
                      const placeholder = target.parentElement?.nextElementSibling as HTMLElement;
                      if (placeholder) placeholder.style.display = 'flex';
                    }}
                  />
                  {isLocal && onEditImage && (
                    <button
                      onClick={() => onEditImage(src)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 hover:bg-black/90 text-white text-xs font-medium px-3 py-1.5 rounded-lg border border-white/20"
                    >
                      Edit Image
                    </button>
                  )}
                </div>
                <div className="hidden my-6 rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel)] p-8 text-xs text-[var(--text-faint)] flex-col items-center gap-1">
                  <div className="text-2xl">🖼</div>
                  <div>{caption || 'Image unavailable'}</div>
                </div>
                {caption && <p className="text-xs text-[var(--text-faint)] mt-2 italic">{caption}</p>}
              </div>
            );
          }

          case 'RunJS':
            return <RunJsWidget key={i} block={block} />;

          case 'Quiz':
            return <QuizWidget key={i} block={block} />;

          case 'MarkMap':
            return <MarkMapWidget key={i} block={block} />;

          case 'PromptAI': {
            const title = block.content?.title || 'Apply Your Knowledge';
            const prompt = block.content?.prompt || '';
            const placeholder = block.content?.placeholder || '';
            return (
              <div key={i} className="my-6 rounded-xl border border-blue-500/30 bg-[var(--panel)] overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-blue-500/20 bg-blue-500/5">
                  <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                  <span className="text-xs font-semibold text-blue-300 uppercase tracking-wide">AI Assessment</span>
                  <span className="text-sm font-semibold text-[var(--text)]">{title}</span>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-sm text-[var(--text-dim)]">{prompt}</p>
                  {placeholder && (
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-faint)] italic">{placeholder}</div>
                  )}
                </div>
              </div>
            );
          }

          case 'SpoilerEditor': {
            // showHintText is the label in Educative block format; fall back to title for legacy data.
            // mdHtml is the rendered content; fall back to html for legacy data.
            let hintTitle = block.content?.showHintText || block.content?.title || 'Hint';
            let hintHtml = block.content?.mdHtml || block.content?.html || '';
            const htmlText = hintHtml.replace(/<[^>]+>/g, '').trim();
            const titleWords = hintTitle.split(/\s+/).filter(Boolean).length;
            const contentWords = htmlText.split(/\s+/).filter(Boolean).length;
            if (titleWords > 8 && contentWords < titleWords) {
              // title holds the long content, html holds the short label — swap
              hintHtml = `<p>${hintTitle}</p>`;
              hintTitle = htmlText.slice(0, 60) || 'Hint';
            }
            return (
              <details key={i} className="my-6 rounded-xl border border-amber-500/25 bg-[var(--panel)] group/hint overflow-hidden">
                <summary className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none list-none hover:bg-amber-500/5 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/15 text-amber-400 text-[11px] shrink-0">💡</span>
                    <span className="text-sm font-medium text-amber-200">{hintTitle}</span>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    className="text-amber-400/50 transition-transform duration-200 group-open/hint:rotate-180 shrink-0">
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </summary>
                <div
                  className="px-5 pb-5 pt-4 border-t border-amber-500/15 article-prose text-sm"
                  dangerouslySetInnerHTML={{ __html: hintHtml }}
                />
              </details>
            );
          }

          default:
            if (!block?.type) return null;
            return (
              <div key={i} className="my-2 inline-flex items-center pill text-xs opacity-50">
                {block.type} widget
              </div>
            );
        }
      })}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────────

export default function CourseViewPage() {
  const { slug } = useParams<{ slug: string }>();
  const courseTitle = decodeURIComponent(slug);

  const [allLessons, setAllLessons] = useState<LessonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lessonData, setLessonData] = useState<Record<string, FullLesson>>({});
  const [loadingLesson, setLoadingLesson] = useState(false);
  const [collapsedChapters, setCollapsedChapters] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [contentView, setContentView] = useState<'blocks' | 'markdown' | 'edit'>('blocks');
  const [editDraft, setEditDraft] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState('');

  // Streaming states
  const streamCtlRef = useRef<AbortController | null>(null);
  const streamingForRef = useRef<string | null>(null);
  const [streamStages, setStreamStages] = useState<StageItem[]>([]);
  const [streamContent, setStreamContent] = useState('');
  const [streamRunning, setStreamRunning] = useState(false);

  // Publish Course modal
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishAuthorId, setPublishAuthorId] = useState('');
  const [publishCollectionId, setPublishCollectionId] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishResults, setPublishResults] = useState<PublishResult[] | null>(null);
  const [publishSummary, setPublishSummary] = useState<{ published: number; failed: number; skipped: number; total: number } | null>(null);
  const [publishErr, setPublishErr] = useState('');

  // Delete states
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingCourse, setDeletingCourse] = useState(false);

  // Image edit state
  const [imageEdit, setImageEdit] = useState<ImageEditState | null>(null);

  // ── Initial load ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/history', { cache: 'no-store' });
        const json = await res.json();
        const lessons: LessonSummary[] = (json.blogs || []).filter(
          (b: LessonSummary) => b.runType === 'course' && (b.courseTitle || 'Untitled Course') === courseTitle
        );
        setAllLessons(lessons);
        const chapters = groupByChapter(lessons);
        const first = chapters[0]?.lessons[0];
        if (first) setSelectedId(first.id);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [courseTitle]);

  // ── Poll for running lessons ──────────────────────────────────────────────────
  useEffect(() => {
    const hasRunning = allLessons.some((l) => l.status === 'running');
    if (!hasRunning) return;
    const interval = setInterval(async () => {
      const res = await fetch('/api/history', { cache: 'no-store' });
      const json = await res.json();
      const lessons: LessonSummary[] = (json.blogs || []).filter(
        (b: LessonSummary) => b.runType === 'course' && (b.courseTitle || 'Untitled Course') === courseTitle
      );
      setAllLessons(lessons);
    }, 4000);
    return () => clearInterval(interval);
  }, [allLessons, courseTitle]);

  // ── Stream lesson progress when a running lesson is selected ──────────────────
  const selectedStatus = allLessons.find((l) => l.id === selectedId)?.status;

  useEffect(() => {
    if (!selectedId || selectedStatus !== 'running') return;
    if (streamingForRef.current === selectedId) return; // already streaming

    streamCtlRef.current?.abort();
    const ctl = new AbortController();
    streamCtlRef.current = ctl;
    streamingForRef.current = selectedId;
    setStreamStages([]);
    setStreamContent('');
    setStreamRunning(true);

    const id = selectedId;

    async function doStream() {
      try {
        const res = await fetch(`/api/blog/${id}/stream`, { signal: ctl.signal });
        if (!res.ok || !res.body) { setStreamRunning(false); return; }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() || '';
          for (const part of parts) {
            if (!part.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(part.slice(6));
              if (evt.type === 'stage') {
                setStreamStages((s) => {
                  const idx = s.findIndex((x) => x.name === evt.name);
                  if (idx >= 0) {
                    const c = [...s]; c[idx] = { name: evt.name, status: evt.status }; return c;
                  }
                  return [...s, { name: evt.name, status: evt.status }];
                });
              } else if (evt.type === 'stream' && evt.name === 'content-creator') {
                // payload is the full accumulated text, not a delta — replace, not append
                setStreamContent(evt.payload || '');
              } else if (evt.type === 'data' && evt.name === 'content-creator') {
                setStreamContent(evt.payload || '');
              }
            } catch {}
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') console.warn('[course-stream]', e?.message);
      } finally {
        if (streamingForRef.current === id) {
          streamingForRef.current = null;
          setStreamRunning(false);
          // Reload full lesson data once pipeline completes
          fetch(`/api/blog/${id}`)
            .then((r) => r.json())
            .then((data) => setLessonData((prev) => ({ ...prev, [id]: data })))
            .catch(() => {});
        }
      }
    }

    doStream();
    return () => {
      if (streamingForRef.current === id) {
        streamCtlRef.current?.abort();
        streamingForRef.current = null;
        setStreamRunning(false);
      }
    };
  }, [selectedId, selectedStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load full lesson data when selected (non-running) ─────────────────────────
  useEffect(() => {
    if (!selectedId || lessonData[selectedId]) return;
    const summary = allLessons.find((l) => l.id === selectedId);
    if (summary?.status === 'running') return; // handled by streaming effect
    let cancelled = false;
    setLoadingLesson(true);
    fetch(`/api/blog/${selectedId}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setLessonData((prev) => ({ ...prev, [selectedId]: data })); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingLesson(false); });
    return () => { cancelled = true; };
  }, [selectedId, lessonData, allLessons]);

  // ── Publish modal helpers ─────────────────────────────────────────────────────
  function openPublishModal() {
    let aid = '';
    let cid = '';
    for (const lesson of Object.values(lessonData)) {
      if (lesson.request?.authorId) aid = lesson.request.authorId;
      if (lesson.request?.collectionId) cid = lesson.request.collectionId;
      if (aid && cid) break;
    }
    setPublishAuthorId(aid);
    setPublishCollectionId(cid);
    setPublishResults(null);
    setPublishSummary(null);
    setPublishErr('');
    setPublishModalOpen(true);
  }

  async function runPublishCourse() {
    if (!publishCollectionId.trim()) { setPublishErr('Collection ID is required'); return; }
    setPublishing(true);
    setPublishErr('');
    setPublishResults(null);
    setPublishSummary(null);
    try {
      const res = await fetch('/api/course/publish-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseTitle,
          authorId: publishAuthorId.trim() || undefined,
          collectionId: publishCollectionId.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Publish failed');
      setPublishResults(json.results || []);
      setPublishSummary(json.summary || null);
    } catch (e: any) {
      setPublishErr(e?.message || String(e));
    } finally {
      setPublishing(false);
    }
  }

  // ── Delete helpers ────────────────────────────────────────────────────────────
  async function deleteLesson(id: string) {
    if (!confirm('Delete this lesson?')) return;
    setDeletingId(id);
    try {
      await fetch(`/api/history/${id}`, { method: 'DELETE' });
      setAllLessons((prev) => prev.filter((l) => l.id !== id));
      setLessonData((prev) => { const next = { ...prev }; delete next[id]; return next; });
      if (selectedId === id) setSelectedId(null);
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteCourse() {
    if (!confirm(`Delete all ${allLessons.length} lessons for "${courseTitle}"? This cannot be undone.`)) return;
    setDeletingCourse(true);
    try {
      await Promise.all(allLessons.map((l) => fetch(`/api/history/${l.id}`, { method: 'DELETE' })));
      window.location.href = '/course';
    } catch {
      setDeletingCourse(false);
    }
  }

  // ── Image edit helpers ────────────────────────────────────────────────────────
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
    if (!imageEdit?.editedUrl || !selectedId) return;
    const lesson = lessonData[selectedId];
    if (!lesson) return;
    const oldUrl = imageEdit.originalUrl;
    const newUrl = imageEdit.editedUrl;

    const updatedBlocks = (lesson.editorBlocks || []).map((block: any) => {
      if (block?.type === 'Image') {
        const blockUrl = block?.content?.url || block?.content?.path || '';
        if (blockUrl === oldUrl) {
          return { ...block, content: { ...block.content, url: newUrl, path: newUrl } };
        }
      }
      return block;
    });

    const updatedHtml = (lesson.html || '').replace(
      new RegExp(oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      newUrl,
    );

    try {
      const res = await fetch(`/api/blog/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: updatedHtml, editorBlocks: updatedBlocks }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Save failed');
      setLessonData((prev) => ({
        ...prev,
        [selectedId]: { ...lesson, html: updatedHtml, editorBlocks: updatedBlocks },
      }));
      setImageEdit(null);
    } catch (e: any) {
      setImageEdit((s) => s ? { ...s, error: e?.message || String(e) } : s);
    }
  }

  // ── Misc helpers ──────────────────────────────────────────────────────────────
  const chapters = useMemo(() => groupByChapter(allLessons), [allLessons]);
  const selectedLesson = selectedId ? lessonData[selectedId] : null;
  const selectedSummary = allLessons.find((l) => l.id === selectedId);

  function toggleChapter(title: string) {
    setCollapsedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      return next;
    });
  }

  async function saveEdit() {
    if (!selectedId) return;
    setEditSaving(true);
    setEditErr('');
    try {
      const res = await fetch(`/api/blog/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: editDraft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Save failed');
      setLessonData((prev) => ({
        ...prev,
        [selectedId]: { ...prev[selectedId], markdown: json.markdown ?? editDraft },
      }));
      setContentView('markdown');
    } catch (e: any) {
      setEditErr(e?.message || String(e));
    } finally {
      setEditSaving(false);
    }
  }

  function selectLesson(id: string) {
    setSelectedId(id);
    const summary = allLessons.find((l) => l.id === id);
    if (summary?.status !== 'running') {
      // Stop any active stream so it doesn't overwrite data for the new selection
      streamCtlRef.current?.abort();
      streamingForRef.current = null;
      setStreamRunning(false);
    }
    // Clear cache for running lessons so we re-stream
    if (summary?.status === 'running') {
      setLessonData((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
    setContentView('blocks');
    setEditErr('');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm text-[var(--text-faint)]">Loading course…</div>
      </div>
    );
  }

  if (allLessons.length === 0) {
    return (
      <div className="space-y-4">
        <Link href="/course" className="text-xs text-[var(--text-faint)] hover:text-[var(--text)]">← Back to courses</Link>
        <div className="card p-6 text-sm text-[var(--text-faint)]">No lessons found for "{courseTitle}".</div>
      </div>
    );
  }

  const isSelectedRunning = selectedSummary?.status === 'running';

  return (
    <>
      {imageEdit && (
        <ImageEditModal
          state={imageEdit}
          onPromptChange={(v) => setImageEdit((s) => s ? { ...s, prompt: v } : s)}
          onSubmit={submitImageEdit}
          onUpdate={applyImageEdit}
          onClose={() => setImageEdit(null)}
        />
      )}
      <div className="flex h-[calc(100vh-4rem)] -mx-4 -my-4 overflow-hidden">
        {/* ── Left sidebar ── */}
        <aside
          className={`flex flex-col border-r border-[var(--border)] bg-[var(--bg)] transition-all duration-200 ${
            sidebarOpen ? 'w-72 min-w-[18rem]' : 'w-0 min-w-0 overflow-hidden'
          }`}
        >
          {/* Sidebar header */}
          <div className="p-4 border-b border-[var(--border)] shrink-0">
            <Link href="/course" className="text-xs text-[var(--text-faint)] hover:text-[var(--text)] block mb-2">
              ← All courses
            </Link>
            <h1 className="font-semibold text-sm leading-snug line-clamp-3 text-[var(--text)]">{courseTitle}</h1>
            <p className="text-xs text-[var(--text-faint)] mt-1">
              {chapters.length} chapter{chapters.length !== 1 ? 's' : ''} · {allLessons.length} lesson{allLessons.length !== 1 ? 's' : ''}
            </p>

            {/* Progress bar */}
            {(() => {
              const done = allLessons.filter((l) => l.status === 'published' || l.status === 'draft').length;
              const pct = allLessons.length > 0 ? Math.round((done / allLessons.length) * 100) : 0;
              return (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[10px] text-[var(--text-faint)] mb-1">
                    <span>{pct}% complete</span>
                    <span>{done}/{allLessons.length}</span>
                  </div>
                  <div className="h-1 rounded-full bg-[var(--border)] overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })()}

            <button className="btn-primary w-full mt-3 text-xs py-2" onClick={openPublishModal}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
              Publish Course
            </button>
          </div>

          {/* Chapter / lesson tree */}
          <div className="flex-1 overflow-y-auto py-2">
            {chapters.map((chapter, ci) => {
              const collapsed = collapsedChapters.has(chapter.chapterTitle);
              return (
                <div key={chapter.chapterTitle} className="mb-1">
                  <button
                    className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-[var(--panel)] transition-colors"
                    onClick={() => toggleChapter(chapter.chapterTitle)}
                  >
                    <svg
                      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      className={`shrink-0 text-[var(--text-faint)] transition-transform ${collapsed ? '-rotate-90' : ''}`}
                    >
                      <path d="M6 9l6 6 6-6"/>
                    </svg>
                    <span className="text-xs font-semibold text-[var(--text-dim)] uppercase tracking-wide truncate">
                      {ci + 1}. {chapter.chapterTitle}
                    </span>
                  </button>

                  {!collapsed && (
                    <ul>
                      {chapter.lessons.map((lesson) => {
                        const isSelected = lesson.id === selectedId;
                        return (
                          <li key={lesson.id} className="group/lesson relative">
                            <button
                              className={`w-full flex items-center gap-2.5 pl-8 pr-8 py-2 text-left text-sm transition-colors ${
                                isSelected
                                  ? 'bg-emerald-500/15 text-emerald-300 border-r-2 border-emerald-400'
                                  : 'text-[var(--text-dim)] hover:bg-[var(--panel)] hover:text-[var(--text)]'
                              }`}
                              onClick={() => selectLesson(lesson.id)}
                            >
                              <StatusDot status={lesson.status} />
                              <span className="truncate leading-snug flex-1">{lessonLabel(lesson)}</span>
                            </button>
                            {/* Per-lesson delete button */}
                            <button
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--text-faint)] hover:text-red-400 opacity-0 group-hover/lesson:opacity-100 transition-opacity"
                              onClick={(e) => { e.stopPropagation(); deleteLesson(lesson.id); }}
                              disabled={deletingId === lesson.id}
                              title="Delete lesson"
                            >
                              {deletingId === lesson.id
                                ? <span className="text-[10px]">…</span>
                                : (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                                  </svg>
                                )
                              }
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {/* Sidebar footer */}
          <div className="p-3 border-t border-[var(--border)] shrink-0 space-y-2">
            <Link href="/course/new" className="btn-secondary w-full text-xs text-center block py-2">
              + Add more lessons
            </Link>
            <button
              className="w-full text-xs text-red-400/70 hover:text-red-400 py-1.5 transition-colors"
              onClick={deleteCourse}
              disabled={deletingCourse}
            >
              {deletingCourse ? 'Deleting…' : 'Delete course'}
            </button>
          </div>
        </aside>

        {/* Sidebar toggle */}
        <button
          className="absolute top-1/2 -translate-y-1/2 z-10 w-5 h-12 bg-[var(--panel)] border border-[var(--border)] rounded-r-md flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text)] transition-colors"
          style={{ left: sidebarOpen ? '18rem' : '0' }}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d={sidebarOpen ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'}/>
          </svg>
        </button>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto">
          {isSelectedRunning ? (
            /* Running lesson: show live pipeline progress */
            <div className="max-w-4xl mx-auto px-8 py-10 space-y-6">
              <div className="flex items-center gap-3">
                <span className="pill pill-running inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 dot-running" />
                  generating
                </span>
                <h1 className="text-xl font-bold">{lessonLabel(selectedSummary!)}</h1>
              </div>

              {streamStages.length > 0 && (
                <Stages items={streamStages} />
              )}

              {streamContent && (
                <div className="card p-5 space-y-3">
                  <p className="text-xs font-semibold text-[var(--text-dim)] uppercase tracking-wide">Content preview</p>
                  <MarkdownRenderer className="article-prose overflow-auto max-h-[60vh] text-sm">
                    {cleanStreamContent(streamContent)}
                  </MarkdownRenderer>
                </div>
              )}

              {!streamRunning && !streamStages.length && (
                <p className="text-sm text-[var(--text-faint)]">Connecting to pipeline…</p>
              )}
            </div>
          ) : !selectedSummary ? (
            <div className="p-8 text-sm text-[var(--text-faint)]">Select a lesson from the left panel.</div>
          ) : loadingLesson ? (
            <div className="p-8 text-sm text-[var(--text-faint)]">Loading lesson…</div>
          ) : selectedLesson ? (
            <div className="max-w-4xl mx-auto px-8 py-10 space-y-6">
              {/* Lesson header */}
              <div className="space-y-2 pb-6 border-b border-[var(--border)]">
                {selectedLesson.request?.chapterTitle && (
                  <p className="text-xs text-[var(--text-faint)] uppercase tracking-wide">
                    {selectedLesson.request.chapterTitle}
                  </p>
                )}
                <h1 className="text-3xl font-bold tracking-tight text-[var(--text)]">
                  {selectedLesson.finalTitle || selectedLesson.request?.blogTitle || '(untitled)'}
                </h1>
                <div className="flex items-center gap-3 flex-wrap text-xs text-[var(--text-faint)]">
                  {selectedLesson.status === 'published' && selectedLesson.publishedUrl && (
                    <a href={selectedLesson.publishedUrl} target="_blank" rel="noreferrer" className="text-emerald-300 underline">
                      View on Educative →
                    </a>
                  )}
                  <Link href={`/course/${selectedLesson.id}`} className="hover:text-[var(--text)]">
                    Pipeline details →
                  </Link>
                </div>

                {/* View toggle + edit controls */}
                <div className="flex items-center justify-between flex-wrap gap-2 pt-2">
                  <div className="flex items-center gap-2">
                    {selectedLesson.editorBlocks && selectedLesson.editorBlocks.length > 0 && (
                      <button
                        className={`btn-secondary text-xs py-1 px-3 ${contentView === 'blocks' ? 'ring-1 ring-[var(--accent)]' : ''}`}
                        onClick={() => setContentView('blocks')}
                      >
                        Rendered
                      </button>
                    )}
                    {selectedLesson.markdown && (
                      <button
                        className={`btn-secondary text-xs py-1 px-3 ${contentView === 'markdown' ? 'ring-1 ring-[var(--accent)]' : ''}`}
                        onClick={() => setContentView('markdown')}
                      >
                        Markdown
                      </button>
                    )}
                    {selectedLesson.markdown && (
                      <button
                        className={`btn-secondary text-xs py-1 px-3 ${contentView === 'edit' ? 'ring-1 ring-amber-400' : ''}`}
                        onClick={() => { setEditDraft(selectedLesson.markdown || ''); setContentView('edit'); setEditErr(''); }}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  {contentView === 'edit' && (
                    <div className="flex items-center gap-2">
                      {editErr && <span className="text-xs text-red-300">{editErr}</span>}
                      <button
                        className="btn-secondary text-xs py-1 px-3"
                        onClick={() => { setContentView('blocks'); setEditErr(''); }}
                        disabled={editSaving}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn-primary text-xs py-1 px-3"
                        onClick={saveEdit}
                        disabled={editSaving}
                      >
                        {editSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Lesson content */}
              {contentView === 'edit' ? (
                <textarea
                  className="input w-full min-h-[70vh] font-mono text-xs leading-relaxed"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  spellCheck={false}
                />
              ) : contentView === 'blocks' && selectedLesson.editorBlocks && selectedLesson.editorBlocks.length > 0 ? (
                <EditorBlocksRenderer blocks={selectedLesson.editorBlocks} onEditImage={openImageEdit} />
              ) : selectedLesson.markdown ? (
                <MarkdownRenderer className="prose prose-invert prose-sm max-w-none">
                  {selectedLesson.markdown}
                </MarkdownRenderer>
              ) : (
                <div className="space-y-3">
                  {selectedLesson.status === 'failed' && (
                    <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 p-4 text-sm space-y-1">
                      <p className="font-semibold">Lesson generation failed</p>
                      {selectedLesson.errorMessage && (
                        <p className="font-mono text-xs text-red-400 break-all">{selectedLesson.errorMessage}</p>
                      )}
                    </div>
                  )}
                  {selectedLesson.status === 'cancelled' && (
                    <p className="text-sm text-[var(--text-faint)]">This lesson was cancelled.</p>
                  )}
                  {selectedLesson.status !== 'failed' && selectedLesson.status !== 'cancelled' && (
                    <p className="text-sm text-[var(--text-faint)]">No content available yet.</p>
                  )}
                </div>
              )}

              <LessonNav chapters={chapters} currentId={selectedSummary.id} onSelect={selectLesson} />
            </div>
          ) : null}
        </main>
      </div>

      {/* ── Publish Course modal ── */}
      {publishModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
              <div>
                <h2 className="text-lg font-semibold">Publish Course to Educative</h2>
                <p className="text-xs text-[var(--text-dim)] mt-0.5">
                  Creates and saves all {allLessons.length} lessons to your Educative collection.
                </p>
              </div>
              <button className="text-[var(--text-faint)] hover:text-[var(--text)] transition-colors" onClick={() => { if (!publishing) setPublishModalOpen(false); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {!publishResults ? (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[var(--text-dim)]">Author ID</label>
                    <input className="input w-full font-mono text-sm" placeholder="Leave blank to use EDUCATIVE_AUTHOR_ID env" value={publishAuthorId} onChange={(e) => setPublishAuthorId(e.target.value)} disabled={publishing} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[var(--text-dim)]">Collection ID <span className="text-red-400">*</span></label>
                    <input className="input w-full font-mono text-sm" placeholder="e.g. 5862310" value={publishCollectionId} onChange={(e) => setPublishCollectionId(e.target.value)} disabled={publishing} />
                    <p className="text-[10px] text-[var(--text-faint)]">Found in your Educative editor URL: /author/…/collection/<strong>ID</strong>/…</p>
                  </div>
                  {publishErr && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 p-3 text-sm">{publishErr}</div>
                  )}
                  <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] max-h-48 overflow-y-auto">
                    {[...allLessons].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((l) => (
                      <div key={l.id} className="flex items-center gap-2.5 px-3 py-2">
                        <StatusDot status={l.status} />
                        <span className="text-xs text-[var(--text-dim)] truncate flex-1">{lessonLabel(l)}</span>
                        <span className="text-[10px] text-[var(--text-faint)] shrink-0">{l.chapterTitle || 'Chapter 1'}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  {publishSummary && (
                    <div className="flex gap-3 flex-wrap text-sm">
                      <span className="pill pill-success">{publishSummary.published} published</span>
                      {publishSummary.failed > 0 && <span className="pill pill-error">{publishSummary.failed} failed</span>}
                      {publishSummary.skipped > 0 && <span className="pill">{publishSummary.skipped} skipped</span>}
                    </div>
                  )}
                  <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] max-h-64 overflow-y-auto">
                    {publishResults.map((r) => (
                      <div key={r.id} className="flex items-start gap-2.5 px-3 py-2.5">
                        {r.status === 'published'
                          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" className="shrink-0 mt-0.5"><path d="M20 6L9 17l-5-5"/></svg>
                          : r.status === 'failed'
                          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" className="shrink-0 mt-0.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 mt-0.5 text-[var(--text-faint)]"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                        }
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[var(--text-dim)] truncate">{r.lessonTitle}</p>
                          {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-[10px] text-emerald-300 underline truncate block">{r.url}</a>}
                          {r.error && <p className="text-[10px] text-red-300 truncate">{r.error}</p>}
                          {r.reason && <p className="text-[10px] text-[var(--text-faint)] truncate">{r.reason}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border)]">
              <button className="btn-secondary" onClick={() => setPublishModalOpen(false)} disabled={publishing}>
                {publishResults ? 'Close' : 'Cancel'}
              </button>
              {!publishResults && (
                <button className="btn-primary" onClick={runPublishCourse} disabled={publishing || !publishCollectionId.trim()}>
                  {publishing
                    ? <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-white dot-running" />Publishing {allLessons.length} lessons…</span>
                    : `Publish ${allLessons.length} lessons`
                  }
                </button>
              )}
              {publishResults && (
                <button className="btn-secondary" onClick={() => { setPublishResults(null); setPublishSummary(null); setPublishErr(''); }}>
                  Publish Again
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function LessonNav({
  chapters,
  currentId,
  onSelect,
}: {
  chapters: ChapterGroup[];
  currentId: string;
  onSelect: (id: string) => void;
}) {
  const flat = chapters.flatMap((c) => c.lessons);
  const idx = flat.findIndex((l) => l.id === currentId);
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx < flat.length - 1 ? flat[idx + 1] : null;
  if (!prev && !next) return null;
  return (
    <div className="flex items-center justify-between pt-8 border-t border-[var(--border)]">
      {prev ? (
        <button className="flex flex-col items-start gap-0.5 group" onClick={() => onSelect(prev.id)}>
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">← Previous</span>
          <span className="text-sm text-[var(--text-dim)] group-hover:text-emerald-300 transition-colors line-clamp-1">{lessonLabel(prev)}</span>
        </button>
      ) : <div />}
      {next ? (
        <button className="flex flex-col items-end gap-0.5 group" onClick={() => onSelect(next.id)}>
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Next →</span>
          <span className="text-sm text-[var(--text-dim)] group-hover:text-emerald-300 transition-colors line-clamp-1">{lessonLabel(next)}</span>
        </button>
      ) : <div />}
    </div>
  );
}
