'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
// The card shape, the gate and the rewrite dialog all come from the shared
// modules so the page cannot drift from what the server enforces.
import type { MobileCard } from '@/lib/mobileCourseStorage';
import { HighlightTypePicker, ScenarioTypePicker } from '@/app/_components/HighlightTypePicker';
import { applyScenarioHeadings } from '@/lib/mobileCardTypes';
import { checkCard, checkCourse } from '@/lib/mobileCardLimits';
import { CardIssues, CardIssueSummary } from '@/app/_components/CardIssues';
import { CardRewriteControl, CardRegenerateButton } from '@/app/_components/CardRewriteControl';
import { CourseUpdateDialog } from '@/app/_components/CourseUpdateDialog';
import { AddWebChaptersDialog } from '@/app/_components/AddWebChaptersDialog';

interface MobileChapter {
  id: string;
  title: string;
  cards: MobileCard[];
  status: 'pending' | 'processing' | 'done' | 'failed';
  errorMessage?: string;
}

interface MobileCourse {
  id: string;
  status: 'running' | 'draft' | 'published' | 'failed' | 'cancelled';
  title: string;
  collectionId: string;
  targetCollectionId?: string;
  chapters: MobileChapter[];
  publishedUrl?: string;
  errorMessage?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toStrArr(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((o) => (typeof o === 'string' ? o : o?.text || o?.label || String(o)));
  if (typeof v === 'string') return v.split('\n').filter(Boolean);
  return [];
}

function toObjArr(v: any): Array<{ heading: string; text: string }> {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.map((item) => {
      if (typeof item === 'string') return { heading: '', text: item };
      return {
        heading: String(item.heading || item.title || item.label || ''),
        text: String(item.text || item.content || item.description || item.body || ''),
      };
    });
  }
  if (typeof v === 'string') {
    return v.split(/\n{2,}/).filter(Boolean).map((t) => ({ heading: '', text: t.trim() }));
  }
  if (typeof v === 'object') {
    const arr = (v as any).items || (v as any).content || (v as any).sections || Object.values(v as any);
    if (Array.isArray(arr)) return toObjArr(arr);
  }
  return [];
}

function toSections(v: any): Array<{ heading: string; content: string }> {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.map((item) => {
      if (typeof item === 'string') return { heading: '', content: item };
      return {
        heading: String(item.heading || item.title || item.label || ''),
        content: String(item.content || item.text || item.description || ''),
      };
    });
  }
  if (typeof v === 'string') {
    return v.split(/\n{2,}/).filter(Boolean).map((t) => ({ heading: '', content: t.trim() }));
  }
  return [];
}

function deriveCardTitle(card: MobileCard): string {
  const TYPE_FALLBACK: Record<string, string> = {
    text: 'Text Card',
    highlightCard: 'Highlight Card',
    trueFalseCard: 'True / False',
    fillInTheBlank: 'Fill in the Blank',
    scenarioCard: 'Scenario Card',
    comparisonCards: 'Comparison',
    recapCard: 'Recap',
    quiz: 'Quiz',
    'text-with-code': 'Custom Card',
    'code-with-output': 'Code With Output',
  };
  const v = card.title || card.heading || TYPE_FALLBACK[card.type] || '';
  return String(v).trim();
}

// ── Card renderer ─────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  text: 'Text',
  text_img: 'Text + Image',
  img_only: 'Image',
  'text-with-code': 'Code',
  'code-with-output': 'Code + Output',
  comparisonCards: 'Compare',
  recapCard: 'Recap',
  quiz: 'Quiz',
  trueFalseCard: 'True / False',
  fillInTheBlank: 'Fill in the Blank',
  scenarioCard: 'Scenario',
  highlightCard: 'Highlight',
};

const TYPE_BADGE: Record<string, string> = {
  text: 'bg-blue-500/15 text-blue-600 border-blue-500/20',
  text_img: 'bg-teal-500/15 text-teal-600 border-teal-500/20',
  img_only: 'bg-teal-500/15 text-teal-600 border-teal-500/20',
  'text-with-code': 'bg-violet-500/15 text-violet-600 border-violet-500/20',
  'code-with-output': 'bg-violet-500/15 text-violet-600 border-violet-500/20',
  comparisonCards: 'bg-amber-500/15 text-amber-600 border-amber-500/20',
  recapCard: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/20',
  quiz: 'bg-rose-500/15 text-rose-600 border-rose-500/20',
  trueFalseCard: 'bg-rose-500/15 text-rose-600 border-rose-500/20',
  fillInTheBlank: 'bg-orange-500/15 text-orange-600 border-orange-500/20',
  scenarioCard: 'bg-sky-500/15 text-sky-600 border-sky-500/20',
  highlightCard: 'bg-amber-500/15 text-amber-600 border-amber-500/20',
};

function CharBadge({ count, min, max }: { count: number; min: number; max: number }) {
  const color = count > max ? 'text-red-400' : count < min ? 'text-amber-500' : 'text-emerald-500';
  return (
    <span className={`text-[10px] font-mono tabular-nums ${color}`}>
      {count} / {min}–{max}
    </span>
  );
}

// ── Inline markdown renderer (no external deps) ───────────────────────────────

function renderInline(text: string): React.ReactNode {
  // Split on **bold**, *italic*, `code` patterns
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
          return <strong key={i} className="font-semibold text-[var(--text)]">{part.slice(2, -2)}</strong>;
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
          return <em key={i} className="italic">{part.slice(1, -1)}</em>;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
          return <code key={i} className="text-[11px] bg-[var(--card)] px-1 py-0.5 rounded font-mono text-[var(--accent)]">{part.slice(1, -1)}</code>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function Md({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }

    // Fenced code block
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      i++;
      elements.push(
        <pre key={`code-${i}`} className="text-[11px] bg-[var(--card)] rounded-lg p-3 overflow-x-auto font-mono border border-[var(--border)] my-1.5 leading-relaxed">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={`bq-${i}`} className="border-l-2 border-[var(--accent)]/50 pl-3 italic text-[var(--text-faint)] my-1">
          {renderInline(line.slice(2))}
        </blockquote>
      );
      i++; continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s/, '')); i++; }
      elements.push(
        <ul key={`ul-${i}`} className="list-disc list-outside pl-4 space-y-0.5 my-1.5">
          {items.map((item, j) => <li key={j} className="leading-relaxed">{renderInline(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s/, '')); i++; }
      elements.push(
        <ol key={`ol-${i}`} className="list-decimal list-outside pl-4 space-y-0.5 my-1.5">
          {items.map((item, j) => <li key={j} className="leading-relaxed">{renderInline(item)}</li>)}
        </ol>
      );
      continue;
    }

    // Table (pipe-delimited)
    if (line.startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) { tableLines.push(lines[i]); i++; }
      const rows = tableLines.filter((l) => !/^\|[-| :]+\|$/.test(l.trim()));
      elements.push(
        <div key={`tbl-${i}`} className="overflow-x-auto my-2 rounded-lg border border-[var(--border)] text-[11px]">
          <table className="w-full">
            <tbody>
              {rows.map((row, ri) => {
                const cells = row.split('|').slice(1, -1);
                const Tag = ri === 0 ? 'th' : 'td';
                return (
                  <tr key={ri} className={ri === 0 ? 'bg-[var(--card)]' : ri % 2 ? 'bg-[var(--card)]/30' : ''}>
                    {cells.map((cell, ci) => (
                      <Tag key={ci} className="px-2 py-1.5 text-left text-[var(--text-dim)] border-b border-[var(--border)]">
                        {renderInline(cell.trim())}
                      </Tag>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Paragraph
    elements.push(
      <p key={`p-${i}`} className="leading-relaxed">{renderInline(line)}</p>
    );
    i++;
  }

  return (
    <div className={`text-[13px] text-[var(--text-dim)] space-y-1.5 ${className || ''}`}>
      {elements}
    </div>
  );
}

function CardView({
  card,
  onEdit,
  onEditImage,
  onDelete,
  endpoint,
  onRewritten,
  onUpdate,
  onMedia,
  mediaBusy,
}: {
  card: MobileCard;
  onEdit: (card: MobileCard) => void;
  onEditImage: (src: string, onApply: (url: string) => void) => void;
  onDelete?: () => void;
  /** Replaces an Educative-authored diagram or photo with an image of our own. */
  onMedia?: (card: MobileCard, mode: 'd2' | 'recreate' | 'fresh') => void;
  mediaBusy?: boolean;
  /** Omitted for the dimmed neighbour previews, which are not interactive. */
  endpoint?: string;
  onRewritten?: () => Promise<void>;
  /** Saves a single field edited directly on the card, e.g. the highlight type. */
  onUpdate?: (card: MobileCard) => void;
}) {
  const issues = checkCard(card, 'course');
  const blocking = issues.some((i) => i.severity === 'error');
  const [selected, setSelected] = useState<number | null>(null);
  const [tfSelected, setTfSelected] = useState<'true' | 'false' | null>(null);
  const [filledBlanks, setFilledBlanks] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [compTab, setCompTab] = useState<'left' | 'right'>('left');
  const [openRecapIdx, setOpenRecapIdx] = useState<number>(0);
  const [openScenarioIdx, setOpenScenarioIdx] = useState<number>(0);

  const badgeClass = TYPE_BADGE[card.type] || 'bg-[var(--card)] text-[var(--text-faint)] border-[var(--border)]';
  const label = TYPE_LABEL[card.type] || card.type;

  // ── Quiz ──────────────────────────────────────────────────────────────────
  const rawOptions = Array.isArray(card.options) ? (card.options as any[]) : [];
  const quizOpts = toStrArr(rawOptions);

  // correctAnswer is the option's id value (1-based id matching), not 0-based index
  const correctIdx = (() => {
    if (rawOptions.length === 0) return 0;
    const ca = card.correctAnswer;
    // Try matching by option id (n8n schema: options are {id, text}[])
    if (typeof rawOptions[0] === 'object' && rawOptions[0] !== null) {
      const byId = rawOptions.findIndex((o: any) => Number(o?.id) === Number(ca));
      if (byId >= 0) return byId;
    }
    // Fallback: numeric value — if >= length, treat as 1-based; else 0-based
    const n = Number(ca) || 0;
    return n >= rawOptions.length ? Math.max(0, n - 1) : n;
  })();

  const tfCorrect = String(card.correctAnswer ?? '').toLowerCase();

  // ── recapCard ─────────────────────────────────────────────────────────────
  const recapItems = toObjArr((card as any).content);

  // ── highlightCard ─────────────────────────────────────────────────────────
  const highlightText = String(card.text || (card as any).content || (card as any).highlight || '');
  const highlightType = String(card.highlightCardType || '');

  // ── scenarioCard ──────────────────────────────────────────────────────────
  const scenarioSections = toSections(card.sections || (card as any).content);
  const scenarioExplanation = String(card.explanation || '');

  // ── fillInTheBlank ────────────────────────────────────────────────────────
  const fibQuestion = String(card.question || '');
  const fibOptions = toStrArr(card.options);
  const fibCorrect: string[] = Array.isArray(card.correctOptions) ? card.correctOptions : [];
  const blankCount = (fibQuestion.match(/_blank_/g) || []).length;
  const allFilled = filledBlanks.length === blankCount && blankCount > 0;

  function fillBlank(opt: string) {
    if (filledBlanks.length >= blankCount) return;
    setFilledBlanks((prev) => [...prev, opt]);
  }

  function resetBlanks() { setFilledBlanks([]); setRevealed(false); }

  function renderFibSentence() {
    let slotIdx = 0;
    return fibQuestion.split('_blank_').map((part, i, arr) => {
      if (i === arr.length - 1) return <span key={i}>{part}</span>;
      const filled = filledBlanks[slotIdx];
      const slot = slotIdx++;
      return (
        <span key={i}>
          {part}
          {filled ? (
            <button
              className={`inline-flex items-center mx-0.5 px-2 py-0.5 rounded border text-xs font-semibold transition-colors ${
                revealed
                  ? fibCorrect[slot] === filled
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-600'
                    : 'border-red-500/60 bg-red-500/15 text-red-600'
                  : 'border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent)]'
              }`}
              onClick={() => { setFilledBlanks((prev) => prev.filter((_, j) => j !== slot)); setRevealed(false); }}
            >
              {filled} ✕
            </button>
          ) : (
            <span className="inline-block mx-0.5 w-16 h-5 align-middle border-b-2 border-dashed border-[var(--border)] opacity-60" />
          )}
        </span>
      );
    });
  }

  return (
    <div className={`relative flex flex-col w-[400px] min-h-[600px] max-h-[700px] rounded-2xl border bg-[var(--surface)] shadow-xl overflow-hidden shrink-0 ${
      blocking ? 'border-red-500' : 'border-[var(--border)]'
    }`}>
      {/* Card header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-0 gap-2 shrink-0">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeClass}`}>
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          {card.card_number !== undefined && (
            <span className="text-[10px] text-[var(--text-faint)] font-mono">#{card.card_number}</span>
          )}
          <button
            className="card-tool"
            disabled={!!card.readOnly}
            onClick={() => card.type === 'img_only' && card.imageUrl
              ? onEditImage(card.imageUrl, () => {})
              : onEdit(card)
            }
            data-tip={card.readOnly || 'Edit card'}
            data-tip-wrap={card.readOnly ? 'true' : undefined}
            aria-label={card.readOnly || 'Edit card'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>
            </svg>
          </button>
          {endpoint && onRewritten && !card.readOnly && (
            <CardRegenerateButton card={card} endpoint={endpoint} onDone={onRewritten} />
          )}
          {endpoint && onRewritten && !card.readOnly && (
            <CardRewriteControl
              card={card}
              product="course"
              endpoint={endpoint}
              onAccepted={onRewritten}
              prominent={blocking}
            />
          )}
          {onMedia && (() => {
            // Same rule the refresh uses: D2 from its source, a hosted raster
            // from the picture, a Lottie from the card's own words.
            const mode: 'd2' | 'recreate' | 'fresh' | null = card.d2Code || card.remoteKind === 'd2-card'
              ? 'd2'
              : card.lottieUrl || card.remoteKind === 'text-with-animation'
                ? 'fresh'
                : /^https?:\/\//.test(String(card.imageUrl || '')) ? 'recreate' : null;
            if (!mode) return null;
            const tip = mode === 'd2' ? 'Draw the D2 diagram as an image'
              : mode === 'fresh' ? 'Replace the animation with a generated illustration'
                : 'Recreate this image in the card style';
            const warning = mode === 'd2'
              ? 'Draw this D2 diagram as an image?\n\nThe card becomes editable, and saving it later replaces the diagram on the page with the new image.'
              : mode === 'fresh'
                ? 'Replace this animation with a generated illustration?\n\nThe animation cannot be recovered from the card, and saving it later removes it from the page.'
                : 'Redraw this image in the card style?\n\nThe original is replaced on the card; the page keeps it until you save.';
            return (
            <button
              className="card-tool"
              disabled={mediaBusy}
              onClick={() => { if (window.confirm(warning)) onMedia(card, mode); }}
              data-tip={mediaBusy ? 'Working…' : tip}
              data-tip-wrap="true"
              aria-label="Replace this card's media with a generated image"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
              </svg>
            </button>
            );
          })()}
          {onDelete && (
            <button
              className="card-tool card-tool-danger"
              onClick={() => { if (window.confirm('Delete this card?')) onDelete(); }}
              data-tip="Delete card" aria-label="Delete card"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
              </svg>
            </button>
          )}
          {card.imageUrl && (
            <a
              href={card.imageUrl}
              download={card.imageUrl.split('/').pop() || 'image.png'}
              className="card-tool card-tool-good"
              data-tip="Download image" aria-label="Download image"
              onClick={(e) => e.stopPropagation()}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
            </a>
          )}
          {card.publishedUrl && (
            <a href={card.publishedUrl} target="_blank" rel="noreferrer"
              className="card-tool" data-tip="Open published card" data-tip-align="right" aria-label="Open published card">
              ↗
            </a>
          )}
        </div>
      </div>

      {/* Thin accent line */}
      <div className={`h-px mx-4 mt-2.5 mb-0 opacity-50 ${
        card.type === 'highlightCard' ? 'bg-amber-400' :
        card.type === 'recapCard' ? 'bg-emerald-400' :
        card.type === 'quiz' || card.type === 'trueFalseCard' ? 'bg-rose-400' :
        card.type === 'fillInTheBlank' ? 'bg-orange-400' :
        card.type === 'scenarioCard' ? 'bg-sky-400' :
        card.type === 'comparisonCards' ? 'bg-amber-400' :
        card.type === 'text_img' || card.type === 'img_only' ? 'bg-teal-400' :
        'bg-blue-400'
      }`} />

      {/* Content */}
      <div className="flex-1 flex flex-col gap-3 p-4 overflow-y-auto">
        {/* Title */}
        {(() => { const t = deriveCardTitle(card); return t ? (
          <h3 className="font-semibold text-[15px] text-[var(--text)] leading-snug tracking-tight">
            {t}
          </h3>
        ) : null; })()}

        {/* ── text ─────────────────────────────────────────────────────── */}
        {card.type === 'text' && card.text && (
          <>
            <Md text={card.text} />
            {/* A char badge is meaningless for a kind we do not author. */}
            {!card.remoteKind && (
              <div className="flex justify-end pt-1">
                <CharBadge count={card.text.length} min={350} max={450} />
              </div>
            )}
          </>
        )}

        {/* ── imported kinds we can show but not author ─────────────────── */}
        {card.remoteKind === 'text-with-animation' && (
          <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className="text-[var(--accent)] shrink-0" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">Lottie animation</p>
            </div>
            <p className="text-[11px] text-[var(--text-faint)] break-words">
              {card.lottieName || 'Animation file'}
            </p>
            {card.lottieUrl && (
              <a href={card.lottieUrl} target="_blank" rel="noreferrer"
                className="text-[11px] text-[var(--accent)] hover:underline">
                Open the animation file →
              </a>
            )}
          </div>
        )}

        {card.remoteKind === 'd2-card' && (
          <details className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
            <summary className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-dim)] cursor-pointer">
              D2 diagram source
            </summary>
            <pre className="mt-2 text-[10px] leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto text-[var(--text-dim)]">
              {card.d2Code || '(no source on the page)'}
            </pre>
            {card.d2Url && (
              <a href={card.d2Url} target="_blank" rel="noreferrer"
                className="text-[11px] text-[var(--accent)] hover:underline">
                Open the diagram file →
              </a>
            )}
          </details>
        )}

        {/* ── text_img ─────────────────────────────────────────────────── */}
        {card.type === 'text_img' && (
          <>
            {card.text && (
              <>
                <Md text={card.text} />
                <div className="flex justify-end pt-0.5">
                  <CharBadge count={card.text.length} min={240} max={280} />
                </div>
              </>
            )}
            {card.imageUrl ? (
              <div className="relative group rounded-xl overflow-hidden border border-[var(--border)] mt-1 bg-[var(--card)] flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card.imageUrl} alt={card.title || ''} className="w-full max-h-[380px] object-contain" />
                {card.imageUrl.startsWith('/api/') && (
                  <button
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-medium"
                    onClick={() => onEditImage(card.imageUrl!, () => {})}
                  >
                    Edit Image
                  </button>
                )}
                <a
                  href={card.imageUrl}
                  download={card.imageUrl.split('/').pop() || 'image.png'}
                  className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  title="Download image" aria-label="Download image"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                </a>
              </div>
            ) : card.illustration_idea ? (
              <div className="bg-[var(--card)] border border-dashed border-[var(--border)] rounded-xl p-3 text-[11px] text-[var(--text-faint)] italic leading-relaxed">
                {card.illustration_idea}
              </div>
            ) : null}
          </>
        )}

        {/* ── img_only ─────────────────────────────────────────────────── */}
        {card.type === 'img_only' && (
          <div className="relative group rounded-xl overflow-hidden border border-[var(--border)] flex-1 min-h-[420px] bg-[var(--card)] flex items-center justify-center">
            {card.imageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card.imageUrl} alt={card.title || ''} className="w-full h-full object-contain" />
                {card.imageUrl.startsWith('/api/') && (
                  <button
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-medium"
                    onClick={() => onEditImage(card.imageUrl!, () => {})}
                  >
                    Edit Image
                  </button>
                )}
                <a
                  href={card.imageUrl}
                  download={card.imageUrl.split('/').pop() || 'image.png'}
                  className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  title="Download image" aria-label="Download image"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                </a>
              </>
            ) : (
              <div className="p-4 text-xs text-[var(--text-faint)] italic text-center leading-relaxed">
                {card.img_context || card.illustration_idea || 'Image generating…'}
              </div>
            )}
          </div>
        )}

        {/* ── text-with-code ───────────────────────────────────────────── */}
        {card.type === 'text-with-code' && (
          <>
            {card.text_1 && <Md text={card.text_1} />}
            {card.code && (
              <pre className="text-[11px] bg-[var(--card)] rounded-xl p-3 overflow-x-auto text-[var(--text-dim)] font-mono leading-relaxed border border-[var(--border)]">
                <code>{card.code}</code>
              </pre>
            )}
            {card.text_2 && <Md text={card.text_2} />}
          </>
        )}

        {/* ── code-with-output ─────────────────────────────────────────── */}
        {card.type === 'code-with-output' && (
          <>
            {card.code && (
              <pre className="text-[11px] bg-[var(--card)] rounded-xl p-3 overflow-x-auto text-[var(--text-dim)] font-mono leading-relaxed border border-[var(--border)]">
                <code>{card.code}</code>
              </pre>
            )}
            {card.output && (
              <div className="text-[11px] text-emerald-600 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 font-mono leading-relaxed">
                <span className="text-emerald-500 mr-1">▶</span>{card.output}
              </div>
            )}
          </>
        )}

        {/* ── comparisonCards — tabbed toggle ──────────────────────────── */}
        {card.type === 'comparisonCards' && (
          <div className="space-y-3 flex-1 flex flex-col">
            {/* Tab bar */}
            <div className="flex rounded-xl border border-[var(--border)] overflow-hidden text-xs font-semibold shrink-0">
              <button
                className={`flex-1 py-2.5 px-3 transition-colors ${
                  compTab === 'left'
                    ? 'bg-blue-500/15 text-blue-600 border-r border-blue-500/20'
                    : 'text-[var(--text-faint)] hover:bg-[var(--card)] border-r border-[var(--border)]'
                }`}
                onClick={() => setCompTab('left')}
              >
                {card.leftOption?.label || 'Option A'}
              </button>
              <button
                className={`flex-1 py-2.5 px-3 transition-colors ${
                  compTab === 'right'
                    ? 'bg-teal-500/15 text-teal-600'
                    : 'text-[var(--text-faint)] hover:bg-[var(--card)]'
                }`}
                onClick={() => setCompTab('right')}
              >
                {card.rightOption?.label || 'Option B'}
              </button>
            </div>
            {/* Tab content */}
            <div className="flex-1">
              {compTab === 'left' && card.leftOption && (
                <div className="h-full bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-semibold text-[var(--text)] leading-snug">{card.leftOption.heading}</p>
                  <Md text={card.leftOption.description} />
                </div>
              )}
              {compTab === 'right' && card.rightOption && (
                <div className="h-full bg-teal-500/5 border border-teal-500/20 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-semibold text-[var(--text)] leading-snug">{card.rightOption.heading}</p>
                  <Md text={card.rightOption.description} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── recapCard — accordion (one open at a time) ───────────────── */}
        {card.type === 'recapCard' && (
          <div className="space-y-1.5">
            {recapItems.length > 0 ? (
              recapItems.map((item, i) => {
                const isOpen = openRecapIdx === i;
                return (
                  <div key={i} className={`rounded-xl border transition-colors ${isOpen ? 'border-emerald-500/40 bg-emerald-500/8' : 'border-[var(--border)] bg-[var(--card)]'}`}>
                    <button
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
                      onClick={() => setOpenRecapIdx(isOpen ? -1 : i)}
                    >
                      <span className={`text-[12px] font-semibold leading-snug ${isOpen ? 'text-emerald-600' : 'text-[var(--text-dim)]'}`}>
                        {item.heading || `Point ${i + 1}`}
                      </span>
                      <span className={`text-[10px] shrink-0 transition-transform ${isOpen ? 'rotate-180 text-emerald-600' : 'text-[var(--text-faint)]'}`}>▼</span>
                    </button>
                    {isOpen && item.text && (
                      <div className="px-3 pb-3">
                        <Md text={item.text} />
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-[var(--text-faint)] italic">No recap items found.</p>
            )}
          </div>
        )}

        {/* ── quiz ─────────────────────────────────────────────────────── */}
        {card.type === 'quiz' && (
          <div className="space-y-3">
            {card.question && <Md text={card.question} />}
            <div className="space-y-2">
              {quizOpts.map((opt, i) => {
                const isSelected = selected === i;
                const isCorrect = i === correctIdx;
                const answered = selected !== null;
                let cls = 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/5';
                if (answered && isCorrect) cls = 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600';
                else if (answered && isSelected && !isCorrect) cls = 'border-red-500/60 bg-red-500/10 text-red-600';
                return (
                  <button
                    key={i}
                    className={`w-full text-left text-xs px-3 py-2.5 rounded-xl border font-medium transition-colors ${cls}`}
                    onClick={() => !answered && setSelected(i)}
                    disabled={answered}
                  >
                    <span className="text-[var(--text-faint)] mr-2 font-mono">{String.fromCharCode(65 + i)}.</span>
                    {opt}
                  </button>
                );
              })}
            </div>
            {selected !== null && selected !== correctIdx && card.incorrectMessage && (
              <div className="text-xs text-amber-600/80 border-l-2 border-amber-500/30 pl-2">
                <Md text={card.incorrectMessage} />
              </div>
            )}
            {selected !== null && selected === correctIdx && (
              <p className="text-xs text-emerald-600 border-l-2 border-emerald-500/30 pl-2">Correct!</p>
            )}
            {selected !== null && (
              <button className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text)] underline" onClick={() => setSelected(null)}>
                Try again
              </button>
            )}
          </div>
        )}

        {/* ── trueFalseCard ─────────────────────────────────────────────── */}
        {card.type === 'trueFalseCard' && (
          <div className="space-y-4 flex-1 flex flex-col justify-center">
            {card.question && <Md text={card.question} />}
            <div className="flex gap-3">
              {(['true', 'false'] as const).map((val) => {
                const isCorrect = tfCorrect === val;
                const isSelected = tfSelected === val;
                const answered = tfSelected !== null;
                let cls = 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/5';
                if (answered && isCorrect) cls = 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600';
                else if (answered && isSelected && !isCorrect) cls = 'border-red-500/60 bg-red-500/10 text-red-600';
                return (
                  <button
                    key={val}
                    className={`flex-1 text-sm px-4 py-3 rounded-xl border font-semibold transition-colors ${cls}`}
                    onClick={() => !answered && setTfSelected(val)}
                    disabled={answered}
                  >
                    {val === 'true' ? 'True' : 'False'}
                  </button>
                );
              })}
            </div>
            {tfSelected !== null && card.explanation && (
              <div className="text-xs text-[var(--text-dim)] border-l-2 border-[var(--border)] pl-3">
                <Md text={card.explanation} />
              </div>
            )}
            {tfSelected !== null && (
              <button className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text)] underline" onClick={() => setTfSelected(null)}>
                Try again
              </button>
            )}
          </div>
        )}

        {/* ── fillInTheBlank ───────────────────────────────────────────── */}
        {card.type === 'fillInTheBlank' && (
          <div className="space-y-4">
            {fibQuestion ? (
              <p className="text-[14px] text-[var(--text)] leading-relaxed font-medium">{renderFibSentence()}</p>
            ) : (
              <p className="text-xs text-[var(--text-faint)] italic">No question found.</p>
            )}
            {fibOptions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {fibOptions.map((opt, i) => {
                  const used = filledBlanks.includes(opt);
                  return (
                    <button
                      key={i}
                      className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                        used
                          ? 'opacity-30 cursor-not-allowed border-[var(--border)] text-[var(--text-faint)]'
                          : 'border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/70'
                      }`}
                      onClick={() => fillBlank(opt)}
                      disabled={used || allFilled}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}
            {allFilled && !revealed && (
              <button className="text-xs text-emerald-600 hover:text-emerald-600 underline font-medium" onClick={() => setRevealed(true)}>
                Check answers
              </button>
            )}
            {revealed && (
              <p className={`text-xs font-medium ${filledBlanks.every((b, i) => fibCorrect[i] === b) ? 'text-emerald-600' : 'text-amber-600'}`}>
                {filledBlanks.every((b, i) => fibCorrect[i] === b) ? '✓ All correct!' : `Correct: ${fibCorrect.join(', ')}`}
              </p>
            )}
            {filledBlanks.length > 0 && (
              <button className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text)] underline" onClick={resetBlanks}>
                Reset
              </button>
            )}
          </div>
        )}

        {/* ── scenarioCard ─────────────────────────────────────────────── */}
        {card.type === 'scenarioCard' && (() => {
          const allItems: Array<{ heading: string; content: string }> = [
            ...scenarioSections,
            ...(scenarioExplanation ? [{ heading: 'Key Takeaway', content: scenarioExplanation }] : []),
          ];
          if (!allItems.length) return <p className="text-xs text-[var(--text-faint)] italic">No scenario sections found.</p>;

          function scenarioColor(heading: string, idx: number) {
            const h = heading.toLowerCase();
            if (h.includes('fix') || h.includes('solution') || h.includes('resolved'))
              return {
                border: 'border-emerald-500/35',
                borderOpen: 'border-emerald-500/50',
                bg: 'bg-emerald-500/10',
                text: 'text-emerald-700',
                bar: 'bg-emerald-400',
              };
            if (h.includes('takeaway') || h.includes('key') || h.includes('lesson') || idx === allItems.length - 1)
              return {
                border: 'border-amber-500/35',
                borderOpen: 'border-amber-500/50',
                bg: 'bg-amber-500/10',
                text: 'text-amber-700',
                bar: 'bg-amber-400',
              };
            return {
              border: 'border-sky-500/30',
              borderOpen: 'border-sky-500/45',
              bg: 'bg-sky-500/8',
              text: 'text-sky-700',
              bar: 'bg-sky-400',
            };
          }

          return (
            <div className="space-y-1.5">
              <ScenarioTypePicker
                value={String(card.scenarioType || '')}
                readOnly={!onUpdate}
                onChange={(id) => onUpdate?.(applyScenarioHeadings({ ...card, scenarioType: id }))}
              />
              {allItems.map((item, i) => {
                const isOpen = openScenarioIdx === i;
                const c = scenarioColor(item.heading, i);
                return (
                  <div key={i} className={`rounded-xl border transition-colors ${isOpen ? `${c.borderOpen} ${c.bg}` : c.border}`}>
                    <button
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
                      onClick={() => setOpenScenarioIdx(isOpen ? -1 : i)}
                    >
                      <span className={`text-[11px] font-bold uppercase tracking-wide leading-snug ${isOpen ? c.text : 'text-[var(--text-dim)]'}`}>
                        {item.heading || `Section ${i + 1}`}
                      </span>
                      <span className={`text-[10px] shrink-0 transition-transform ${isOpen ? `rotate-180 ${c.text}` : 'text-[var(--text-faint)]'}`}>▼</span>
                    </button>
                    {isOpen && item.content && (
                      <div className="px-3 pb-3 text-[12px]">
                        <Md text={item.content} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* ── highlightCard ─────────────────────────────────────────────── */}
        {card.type === 'highlightCard' && (
          <div className="flex-1 flex flex-col">
            {highlightText ? (
              <>
              <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-amber-500/6 border border-amber-500/20 rounded-2xl p-6 text-center">
                <span className="text-4xl text-amber-600/30 font-serif leading-none select-none">"</span>
                <p className="text-[15px] text-amber-700 leading-relaxed font-medium tracking-tight">
                  {highlightText}
                </p>
                <HighlightTypePicker
                  value={highlightType}
                  readOnly={!onUpdate}
                  onChange={(id) => onUpdate?.({ ...card, highlightCardType: id })}
                />
              </div>
              <div className="flex justify-end pt-1">
                <CharBadge count={highlightText.length} min={100} max={130} />
              </div>
              </>
            ) : (
              <p className="text-xs text-[var(--text-faint)] italic">No highlight text found.</p>
            )}
          </div>
        )}
      </div>
      {card.readOnly && (
        <p className="px-4 py-2.5 text-[11px] text-amber-500 border-t border-[var(--border)] bg-[var(--panel-2)]">
          Read-only · {card.readOnly}
        </p>
      )}
      <CardIssues issues={issues} />
    </div>
  );
}

// ── Card Carousel ─────────────────────────────────────────────────────────────

function CardCarousel({
  cards,
  onEdit,
  onEditImage,
  onDelete,
  endpoint,
  onRewritten,
  onUpdate,
  onMedia,
  mediaBusy,
}: {
  cards: MobileCard[];
  onEdit: (card: MobileCard) => void;
  onEditImage: (src: string, onApply: (url: string) => void) => void;
  onDelete: (cardId: string) => void;
  endpoint: string;
  onRewritten: () => Promise<void>;
  onUpdate: (card: MobileCard) => void;
  onMedia?: (card: MobileCard, mode: 'd2' | 'recreate' | 'fresh') => void;
  mediaBusy?: boolean;
}) {
  const [idx, setIdx] = useState(0);

  const prev = () => setIdx((i) => Math.max(0, i - 1));
  const next = () => setIdx((i) => Math.min(cards.length - 1, i + 1));

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (cards.length === 0) return null;

  const hasPrev = idx > 0;
  const hasNext = idx < cards.length - 1;
  // Offset so adjacent cards peek in from the sides (card width 400 + 40 gap = 440)
  const OFFSET = 440;

  return (
    <div className="flex flex-col items-center gap-5 select-none">
      {/* Viewport */}
      <div className="relative w-full overflow-hidden" style={{ height: 720 }}>
        {/* Prev card */}
        {hasPrev && (
          <div
            className="absolute top-4 transition-all duration-300 ease-in-out cursor-pointer"
            style={{
              left: '50%',
              transform: `translateX(calc(-50% - ${OFFSET}px)) scale(0.88)`,
              opacity: 0.32,
            }}
            onClick={prev}
          >
            <div className="pointer-events-none">
              <CardView card={cards[idx - 1]} onEdit={() => {}} onEditImage={() => {}} />
            </div>
          </div>
        )}

        {/* Current card */}
        <div
          className="absolute top-0 transition-all duration-300 ease-in-out"
          style={{
            left: '50%',
            transform: 'translateX(-50%) scale(1)',
            opacity: 1,
            zIndex: 10,
          }}
        >
          <CardView
            card={cards[idx]}
            onEdit={onEdit}
            onEditImage={onEditImage}
            onDelete={() => onDelete(cards[idx].id)}
            endpoint={endpoint && `${endpoint}/${cards[idx].id}`}
            onRewritten={onRewritten}
            onUpdate={onUpdate}
            onMedia={onMedia}
            mediaBusy={mediaBusy}
          />
        </div>

        {/* Next card */}
        {hasNext && (
          <div
            className="absolute top-4 transition-all duration-300 ease-in-out cursor-pointer"
            style={{
              left: '50%',
              transform: `translateX(calc(-50% + ${OFFSET}px)) scale(0.88)`,
              opacity: 0.32,
            }}
            onClick={next}
          >
            <div className="pointer-events-none">
              <CardView card={cards[idx + 1]} onEdit={() => {}} onEditImage={() => {}} />
            </div>
          </div>
        )}
      </div>

      {/* Navigation bar */}
      <div className="flex items-center gap-4">
        <button
          className="w-9 h-9 rounded-full border border-[var(--border)] bg-[var(--card)] text-lg text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--accent)]/50 disabled:opacity-25 disabled:cursor-not-allowed transition-all flex items-center justify-center leading-none"
          onClick={prev}
          disabled={!hasPrev}
          title="Previous card (←)"
        >
          ‹
        </button>

        <span className="text-sm text-[var(--text-faint)] min-w-[4.5rem] text-center tabular-nums">
          {idx + 1} <span className="text-[var(--text-faint)]/40">/</span> {cards.length}
        </span>

        <button
          className="w-9 h-9 rounded-full border border-[var(--border)] bg-[var(--card)] text-lg text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--accent)]/50 disabled:opacity-25 disabled:cursor-not-allowed transition-all flex items-center justify-center leading-none"
          onClick={next}
          disabled={!hasNext}
          title="Next card (→)"
        >
          ›
        </button>
      </div>

      {/* Dot track */}
      {cards.length > 1 && (
        <div className="flex gap-1.5 flex-wrap justify-center max-w-[420px]">
          {cards.map((_, i) => (
            <button
              key={i}
              className={`rounded-full transition-all duration-200 ${
                i === idx
                  ? 'w-5 h-1.5 bg-[var(--accent)]'
                  : 'w-1.5 h-1.5 bg-[var(--border)] hover:bg-[var(--text-faint)]'
              }`}
              onClick={() => setIdx(i)}
              title={`Card ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Card editor modal ─────────────────────────────────────────────────────────

function CardEditorModal({
  card,
  onSave,
  onClose,
  onSaveToEducative,
}: {
  card: MobileCard;
  onSave: (updated: MobileCard) => void;
  onClose: () => void;
  /** Present only when this card already occupies a published page. */
  onSaveToEducative?: (updated: MobileCard) => Promise<string>;
}) {
  const [pushing, setPushing] = useState(false);
  const [pushErr, setPushErr] = useState('');
  const [draft, setDraft] = useState<MobileCard>({ ...card });
  const upd = (patch: Partial<MobileCard>) => setDraft((d) => ({ ...d, ...patch }));

  // The JSON textareas hold raw strings so half-typed JSON does not snap back;
  // both save buttons have to fold them in first.
  const flush = (): MobileCard => {
    let out = { ...draft };
    if (draft.type === 'recapCard') { try { out = { ...out, content: JSON.parse(recapRaw) }; } catch {} }
    if (draft.type === 'scenarioCard') { try { out = { ...out, sections: JSON.parse(sectionsRaw) }; } catch {} }
    return out;
  };

  // Local raw-string state for JSON fields so typing intermediate (invalid) JSON
  // doesn't cause the textarea to snap back to the last valid value.
  const [recapRaw, setRecapRaw] = useState(() => JSON.stringify(card.content || [], null, 2));
  const [sectionsRaw, setSectionsRaw] = useState(() => JSON.stringify(card.sections || [], null, 2));
  const [recapErr, setRecapErr] = useState('');
  const [sectionsErr, setSectionsErr] = useState('');

  function applyRecap(raw: string) {
    try { upd({ content: JSON.parse(raw) }); setRecapErr(''); }
    catch { setRecapErr('Invalid JSON — changes not saved yet'); }
  }
  function applySections(raw: string) {
    try { upd({ sections: JSON.parse(raw) }); setSectionsErr(''); }
    catch { setSectionsErr('Invalid JSON — changes not saved yet'); }
  }

  const optTexts = Array.isArray(draft.options)
    ? (draft.options as any[]).map((o) => (typeof o === 'string' ? o : o?.text || '')).join('\n')
    : '';

  function parseOptions(raw: string): Array<{ id: number; text: string }> {
    return raw.split('\n').filter(Boolean).map((t, i) => ({ id: i + 1, text: t.trim() }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 overflow-y-auto py-8" onClick={onClose}>
      <div className="relative bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--card)]">
          <div>
            <h2 className="font-semibold text-[var(--text)]">Edit Card</h2>
            <span className="text-xs text-[var(--text-faint)]">{TYPE_LABEL[card.type] || card.type}</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--border)] text-[var(--text-faint)] hover:text-[var(--text)] transition-colors text-lg">×</button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {card.type !== 'trueFalseCard' && card.type !== 'fillInTheBlank' && card.type !== 'highlightCard' && card.type !== 'img_only' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--text-faint)]">Title</label>
              <input className="input w-full" value={draft.title || ''} onChange={(e) => upd({ title: e.target.value })} />
            </div>
          )}

          {draft.type === 'text' && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--text-faint)]">Text (markdown supported)</label>
                <CharBadge count={(draft.text || '').length} min={350} max={450} />
              </div>
              <textarea className="input w-full h-36 resize-none text-sm font-mono" value={draft.text || ''} onChange={(e) => upd({ text: e.target.value })} />
            </div>
          )}

          {draft.type === 'text_img' && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--text-faint)]">Text (markdown supported)</label>
                <CharBadge count={(draft.text || '').length} min={240} max={280} />
              </div>
              <textarea className="input w-full h-32 resize-none text-sm font-mono" value={draft.text || ''} onChange={(e) => upd({ text: e.target.value })} />
            </div>
          )}

          {draft.type === 'img_only' && (
            <div className="py-6 text-center space-y-1">
              <p className="text-sm text-[var(--text-dim)]">Image-only card</p>
              <p className="text-xs text-[var(--text-faint)]">Use the ✏ button on the card to edit the image via AI.</p>
            </div>
          )}

          {draft.type === 'text-with-code' && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Text before code</label>
                <textarea className="input w-full h-20 resize-none text-sm" value={draft.text_1 || ''} onChange={(e) => upd({ text_1: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Language</label>
                <input className="input w-full text-sm" value={draft.language || ''} onChange={(e) => upd({ language: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Code</label>
                <textarea className="input w-full h-32 resize-none text-sm font-mono" value={draft.code || ''} onChange={(e) => upd({ code: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Text after code</label>
                <textarea className="input w-full h-20 resize-none text-sm" value={draft.text_2 || ''} onChange={(e) => upd({ text_2: e.target.value })} />
              </div>
            </>
          )}

          {draft.type === 'code-with-output' && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Code</label>
                <textarea className="input w-full h-32 resize-none text-sm font-mono" value={draft.code || ''} onChange={(e) => upd({ code: e.target.value })} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={!!draft.output_available} onChange={(e) => upd({ output_available: e.target.checked })} className="accent-[var(--accent)]" />
                <label className="text-xs text-[var(--text-faint)]">Has output</label>
              </div>
              {draft.output_available && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-faint)]">Output</label>
                  <textarea className="input w-full h-20 resize-none text-sm font-mono" value={draft.output || ''} onChange={(e) => upd({ output: e.target.value })} />
                </div>
              )}
            </>
          )}

          {draft.type === 'recapCard' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--text-faint)]">Recap items (JSON)</label>
              <textarea
                className={`input w-full h-40 resize-y text-xs font-mono ${recapErr ? 'border-red-400' : ''}`}
                value={recapRaw}
                onChange={(e) => { setRecapRaw(e.target.value); setRecapErr(''); }}
                onBlur={(e) => applyRecap(e.target.value)}
                spellCheck={false}
              />
              {recapErr
                ? <p className="text-xs text-red-500">{recapErr}</p>
                : <p className="text-xs text-[var(--text-faint)]">Format: {`[{"heading": "...", "text": "..."}]`}</p>}
            </div>
          )}

          {draft.type === 'quiz' && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Question</label>
                <textarea className="input w-full h-16 resize-none text-sm" value={draft.question || ''} onChange={(e) => upd({ question: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Options (one per line)</label>
                <textarea className="input w-full h-24 resize-none text-sm" value={optTexts} onChange={(e) => upd({ options: parseOptions(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Correct option ID (matches id field: 1, 2, 3…)</label>
                <input className="input w-24 text-sm" type="number" min={1} value={typeof draft.correctAnswer === 'number' ? draft.correctAnswer : 1} onChange={(e) => upd({ correctAnswer: parseInt(e.target.value) || 1 })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Incorrect message</label>
                <textarea className="input w-full h-16 resize-none text-sm" value={draft.incorrectMessage || ''} onChange={(e) => upd({ incorrectMessage: e.target.value })} />
              </div>
            </>
          )}

          {draft.type === 'trueFalseCard' && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Question</label>
                <textarea className="input w-full h-16 resize-none text-sm" value={draft.question || ''} onChange={(e) => upd({ question: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Correct answer</label>
                <select className="input text-sm" value={String(draft.correctAnswer || 'true')} onChange={(e) => upd({ correctAnswer: e.target.value })}>
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Explanation</label>
                <textarea className="input w-full h-20 resize-none text-sm" value={draft.explanation || ''} onChange={(e) => upd({ explanation: e.target.value })} />
              </div>
            </>
          )}

          {draft.type === 'fillInTheBlank' && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Question (use _blank_ for blanks)</label>
                <textarea className="input w-full h-16 resize-none text-sm" value={draft.question || ''} onChange={(e) => upd({ question: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">All options (one per line)</label>
                <textarea className="input w-full h-20 resize-none text-sm" value={(draft.options as string[] || []).join('\n')} onChange={(e) => upd({ options: e.target.value.split('\n').filter(Boolean) })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Correct options (one per line, in order)</label>
                <textarea className="input w-full h-16 resize-none text-sm" value={(draft.correctOptions || []).join('\n')} onChange={(e) => upd({ correctOptions: e.target.value.split('\n').filter(Boolean) })} />
              </div>
            </>
          )}

          {draft.type === 'scenarioCard' && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Sections (JSON)</label>
                <textarea
                  className={`input w-full h-36 resize-y text-xs font-mono ${sectionsErr ? 'border-red-400' : ''}`}
                  value={sectionsRaw}
                  onChange={(e) => { setSectionsRaw(e.target.value); setSectionsErr(''); }}
                  onBlur={(e) => applySections(e.target.value)}
                  spellCheck={false}
                />
                {sectionsErr
                  ? <p className="text-xs text-red-500">{sectionsErr}</p>
                  : <p className="text-xs text-[var(--text-faint)]">Format: {`[{"heading": "...", "content": "..."}]`}</p>}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Explanation</label>
                <textarea className="input w-full h-16 resize-none text-sm" value={draft.explanation || ''} onChange={(e) => upd({ explanation: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Scenario type</label>
                <ScenarioTypePicker
                  value={draft.scenarioType || ''}
                  onChange={(id) => {
                    const next = applyScenarioHeadings({ ...draft, scenarioType: id });
                    setSectionsRaw(JSON.stringify(next.sections || [], null, 2));
                    upd({ scenarioType: id, sections: next.sections });
                  }}
                />
              </div>
            </>
          )}

          {draft.type === 'highlightCard' && (
            <>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[var(--text-faint)]">Highlight text (plain, no markdown)</label>
                  <CharBadge count={(draft.text || '').length} min={100} max={130} />
                </div>
                <textarea className="input w-full h-24 resize-none text-sm" value={draft.text || ''} onChange={(e) => upd({ text: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Type</label>
                <select
                  className="input text-sm"
                  value={draft.highlightCardType || ''}
                  onChange={(e) => upd({ highlightCardType: (e.target.value || undefined) as MobileCard['highlightCardType'] })}
                >
                  <option value="">— select —</option>
                  <option value="key-insight">key-insight</option>
                  <option value="point-to-ponder">point-to-ponder</option>
                  <option value="bigger-picture">bigger-picture</option>
                </select>
              </div>
            </>
          )}

          {draft.type === 'comparisonCards' && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-faint)]">Heading</label>
                <input className="input w-full text-sm" value={draft.heading || ''} onChange={(e) => upd({ heading: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-blue-600">Left option</p>
                  <input className="input w-full text-xs" placeholder="Label" value={draft.leftOption?.label || ''} onChange={(e) => upd({ leftOption: { ...(draft.leftOption || { label: '', heading: '', description: '' }), label: e.target.value } })} />
                  <input className="input w-full text-xs" placeholder="Heading" value={draft.leftOption?.heading || ''} onChange={(e) => upd({ leftOption: { ...(draft.leftOption || { label: '', heading: '', description: '' }), heading: e.target.value } })} />
                  <textarea className="input w-full h-20 resize-none text-xs" placeholder="Description" value={draft.leftOption?.description || ''} onChange={(e) => upd({ leftOption: { ...(draft.leftOption || { label: '', heading: '', description: '' }), description: e.target.value } })} />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-teal-600">Right option</p>
                  <input className="input w-full text-xs" placeholder="Label" value={draft.rightOption?.label || ''} onChange={(e) => upd({ rightOption: { ...(draft.rightOption || { label: '', heading: '', description: '' }), label: e.target.value } })} />
                  <input className="input w-full text-xs" placeholder="Heading" value={draft.rightOption?.heading || ''} onChange={(e) => upd({ rightOption: { ...(draft.rightOption || { label: '', heading: '', description: '' }), heading: e.target.value } })} />
                  <textarea className="input w-full h-20 resize-none text-xs" placeholder="Description" value={draft.rightOption?.description || ''} onChange={(e) => upd({ rightOption: { ...(draft.rightOption || { label: '', heading: '', description: '' }), description: e.target.value } })} />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--card)] space-y-2">
          {pushErr && <p className="text-xs text-red-500" role="alert">{pushErr}</p>}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-[var(--text-faint)] min-w-0">
              {onSaveToEducative
                ? 'Saving to Educative updates the existing lesson page; it never creates a second one.'
                : 'Saved locally. Publish the chapter to put it on Educative.'}
            </p>
            <div className="flex gap-2 shrink-0">
              <button className="btn-secondary text-sm" disabled={pushing} onClick={onClose}>Cancel</button>
              <button className="btn-secondary text-sm" disabled={pushing} onClick={() => onSave(flush())}>
                Save locally
              </button>
              {onSaveToEducative && (
                <button
                  className="btn-primary text-sm"
                  disabled={pushing}
                  onClick={async () => {
                    setPushing(true);
                    setPushErr('');
                    try { setPushErr(await onSaveToEducative(flush())); }
                    finally { setPushing(false); }
                  }}
                >
                  {pushing ? 'Saving to Educative…' : 'Save to Educative'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Image edit modal ──────────────────────────────────────────────────────────

interface ImageEditState {
  src: string;
  prompt: string;
  loading: boolean;
  editedUrl: string | null;
  onApply: (newUrl: string) => void;
}

function ImageEditModal({
  state,
  onChange,
  onSubmit,
  onApply,
  onClose,
}: {
  state: ImageEditState;
  onChange: (prompt: string) => void;
  onSubmit: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75" onClick={onClose}>
      <div className="relative bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--card)]">
          <h2 className="font-semibold text-[var(--text)]">Edit Image</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--border)] text-[var(--text-faint)] text-lg">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-[var(--text-faint)]">Original</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={state.src} alt="original" className="rounded-xl w-full h-auto object-cover border border-[var(--border)]" />
            </div>
            {state.editedUrl && (
              <div className="space-y-1">
                <p className="text-xs text-emerald-600">Edited</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={state.editedUrl} alt="edited" className="rounded-xl w-full h-auto object-cover border border-emerald-500/30" />
              </div>
            )}
          </div>
          <textarea
            className="input w-full h-24 resize-none text-sm"
            placeholder="Describe what to change in the image…"
            value={state.prompt}
            onChange={(e) => onChange(e.target.value)}
            disabled={state.loading}
          />
          <div className="flex gap-2">
            <button className="btn-primary text-sm" onClick={onSubmit} disabled={state.loading || !state.prompt.trim()}>
              {state.loading ? 'Generating…' : 'Generate Edit'}
            </button>
            {state.editedUrl && (
              <button className="btn-secondary text-sm" onClick={onApply}>Use This Image</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MobileCourseDetailPage({ params }: { params: { id: string } }) {
  const [course, setCourse] = useState<MobileCourse | null>(null);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeChapter, setActiveChapter] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [publishCollectionId, setPublishCollectionId] = useState('');
  const [showPublishForm, setShowPublishForm] = useState(false);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [editCard, setEditCard] = useState<MobileCard | null>(null);
  const [editCardChapterId, setEditCardChapterId] = useState<string | null>(null);
  const [imageEdit, setImageEdit] = useState<ImageEditState | null>(null);
  const [regenChapterId, setRegenChapterId] = useState<string | null>(null);
  const [regenLog, setRegenLog] = useState<string>('');
  const [chapterPublishing, setChapterPublishing] = useState<string | null>(null);
  const [chapterPublishResult, setChapterPublishResult] = useState<Record<string, string>>({});
  // Which chapter the update dialog is scoped to, and what it is being asked
  // for. `undefined` scope means the whole course.
  const [update, setUpdate] = useState<{ chapter?: number } | null>(null);
  // Chapter id whose pictures are being redrawn, and where that has got to.
  const [imagesBusy, setImagesBusy] = useState<string | null>(null);
  const [imagesProgress, setImagesProgress] = useState('');
  // Open the web-chapter picker. A number fixes the position; null uses the web order.
  const [addWeb, setAddWeb] = useState<{ insertAt?: number } | null>(null);
  const [mediaCardId, setMediaCardId] = useState<string | null>(null);
  const [publishingAdds, setPublishingAdds] = useState(false);
  const [addResult, setAddResult] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    // loading must clear on every path, or a failed fetch leaves the page stuck
    // on "Loading…" with no navigation out of it.
    try {
      const res = await fetch(`/api/mobile-course/${params.id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      setCourse(json.course);
      setLive(json.live);
    } catch {
      // leave `course` null so the not-found branch renders
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (live && !pollRef.current) {
      pollRef.current = setInterval(load, 3000);
    } else if (!live && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [live]);

  async function saveChapterCards(chapterId: string, cards: MobileCard[]) {
    await fetch(`/api/mobile-course/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId, cards }),
    });
    await load();
  }

  async function publish() {
    if (!publishCollectionId.trim()) return;
    setPublishing(true);
    setShowPublishForm(false);
    setPublishResult(null);
    try {
      const res = await fetch(`/api/mobile-course/${params.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCollectionId: publishCollectionId.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        const first = (json.issues || []).find((i: any) => i.severity === 'error');
        const detail = first ? `${json.error}: card #${first.cardNumber ?? first.cardId} — ${first.message}` : json?.error || `HTTP ${res.status}`;
        setPublishResult(`Error: ${detail}`);
      } else if (json.errors?.length > 0) {
        setPublishResult(`Published ${json.published} cards. ${json.errors.length} failed: ${json.errors[0]?.error}`);
      } else {
        setPublishResult(`Published ${json.published} cards to Educative`);
      }
      await load();
    } catch (e: any) {
      setPublishResult(`Error: ${e?.message}`);
    } finally {
      setPublishing(false);
    }
  }

  async function createCollection() {
    setCreatingCollection(true);
    setPublishResult(null);
    try {
      const res = await fetch('/api/mobile-course/create-collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setPublishCollectionId(json.collectionId);
    } catch (e: any) {
      setPublishResult(`Error creating collection: ${e?.message}`);
    } finally {
      setCreatingCollection(false);
    }
  }

  async function regenerateChapter(chapterId: string) {
    setRegenChapterId(chapterId);
    setRegenLog('Connecting…');
    try {
      const res = await fetch(`/api/mobile-course/${params.id}/chapters/${chapterId}/regenerate`, { method: 'POST' });
      if (!res.ok || !res.body) {
        setRegenLog(`Error: HTTP ${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'stage') {
              setRegenLog(`${event.name}: ${event.status}`);
            } else if (event.type === 'done') {
              setRegenLog(`Done — ${event.payload?.cardCount ?? 0} cards`);
            } else if (event.type === 'error') {
              setRegenLog(`Error: ${event.message}`);
            }
          } catch {}
        }
      }
      await load();
    } catch (e: any) {
      setRegenLog(`Error: ${e?.message}`);
    } finally {
      setRegenChapterId(null);
    }
  }

  async function publishChapter(chapterId: string) {
    if (!course?.targetCollectionId) return;
    setChapterPublishing(chapterId);
    setChapterPublishResult((prev) => ({ ...prev, [chapterId]: '' }));
    try {
      const res = await fetch(`/api/mobile-course/${params.id}/chapters/${chapterId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCollectionId: course.targetCollectionId }),
      });
      const json = await res.json();
      if (!res.ok) {
        const first = (json.issues || []).find((i: any) => i.severity === 'error');
        const detail = first ? `${json.error}: card #${first.cardNumber ?? first.cardId} — ${first.message}` : json?.error || `HTTP ${res.status}`;
        setChapterPublishResult((prev) => ({ ...prev, [chapterId]: `Error: ${detail}` }));
      } else if (json.errors?.length > 0) {
        setChapterPublishResult((prev) => ({ ...prev, [chapterId]: `Published ${json.published} cards. ${json.errors.length} failed.` }));
      } else {
        setChapterPublishResult((prev) => ({ ...prev, [chapterId]: `Published ${json.published} cards` }));
      }
      await load();
    } catch (e: any) {
      setChapterPublishResult((prev) => ({ ...prev, [chapterId]: `Error: ${e?.message}` }));
    } finally {
      setChapterPublishing(null);
    }
  }

  /** Replace a card's Educative-authored diagram or photo with a generated image. */
  /**
   * Draw every picture in a chapter again.
   *
   * Educative's own media is replaced; a picture of ours is redrawn from the
   * brief it already has, which is what a style or prompt change needs.
   */
  async function regenerateChapterImages(chapterId: string, title: string, count: number) {
    if (imagesBusy) return;
    if (!confirm(
      `Redraw every picture in "${title}"? ${count} card${count === 1 ? '' : 's'} will be regenerated, `
      + 'and any Lottie, D2, SVG or uploaded original is replaced for good. Nothing is published.',
    )) return;
    setImagesBusy(chapterId);
    setImagesProgress('');
    setAddResult(null);
    try {
      const res = await fetch(`/api/mobile-course/${params.id}/chapters/${chapterId}/images`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      if (!res.body) throw new Error('No response from the server');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let summary = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === 'card' && event.status === 'start') {
            setImagesProgress(`${event.done + 1} of ${event.total}: ${event.title}`);
          } else if (event.type === 'done') {
            summary = `Redrew ${event.done} of ${event.total} picture${event.total === 1 ? '' : 's'}`
              + (event.failed ? `, ${event.failed} failed` : '');
          }
        }
      }
      setAddResult(summary || 'Nothing to redraw');
      await load();
    } catch (e: any) {
      setAddResult(`Error: ${e?.message}`);
    } finally {
      setImagesBusy(null);
      setImagesProgress('');
    }
  }

  async function convertMedia(chapterId: string, card: MobileCard, mode: 'd2' | 'recreate' | 'fresh') {
    setMediaCardId(card.id);
    setAddResult(null);
    try {
      const res = await fetch(
        `/api/mobile-course/${params.id}/chapters/${chapterId}/cards/${card.id}/media`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setAddResult(`Error: ${json.error || `HTTP ${res.status}`}`);
      else await load();
    } catch (e: any) {
      setAddResult(`Error: ${e?.message}`);
    } finally {
      setMediaCardId(null);
    }
  }

  /** Publish the cards added since the last publish, each at its own position. */
  async function publishAdditions() {
    setPublishingAdds(true);
    setAddResult(null);
    try {
      const res = await fetch(`/api/mobile-course/${params.id}/publish-additions`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const first = (json.issues || [])[0];
        setAddResult(`Error: ${json.error || `HTTP ${res.status}`}${first ? ` — ${first.message}` : ''}`);
      } else if (json.errors?.length) {
        setAddResult(`Published ${json.published}. ${json.errors.length} failed: ${json.errors[0]?.error}`);
      } else {
        setAddResult(`Published ${json.published} new card${json.published === 1 ? '' : 's'}`);
      }
      await load();
    } catch (e: any) {
      setAddResult(`Error: ${e?.message}`);
    } finally {
      setPublishingAdds(false);
    }
  }

  function openImageEdit(src: string, onApply: (url: string) => void) {
    setImageEdit({ src, prompt: '', loading: false, editedUrl: null, onApply });
  }

  async function submitImageEdit() {
    if (!imageEdit) return;
    setImageEdit((s) => s ? { ...s, loading: true } : s);
    try {
      const res = await fetch('/api/images/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: imageEdit.src, prompt: imageEdit.prompt }),
      });
      const json = await res.json();
      setImageEdit((s) => s ? { ...s, loading: false, editedUrl: json.editedUrl } : s);
    } catch {
      setImageEdit((s) => s ? { ...s, loading: false } : s);
    }
  }

  function applyImageEdit() {
    if (!imageEdit?.editedUrl) return;
    imageEdit.onApply(imageEdit.editedUrl);
    setImageEdit(null);
  }

  if (loading) return <div className="card p-6 text-sm text-[var(--text-faint)]">Loading…</div>;
  if (!course) {
    return (
      <div className="card p-6 space-y-3">
        <p className="text-sm text-red-400">Course not found.</p>
        <Link href="/mobile-course" className="text-xs text-[var(--text-faint)] hover:text-[var(--text)] transition-colors">
          ← All mobile courses
        </Link>
      </div>
    );
  }

  const chapters = course.chapters || [];
  const currentChapter = chapters[activeChapter];
  const totalCards = chapters.reduce((s, c) => s + (c.cards?.length || 0), 0);
  // Same checkCourse the publish routes run, so the buttons and the server agree.
  const chapterGate = checkCourse(course.title || '', currentChapter?.cards || []);
  const courseGate = checkCourse(course.title || '', chapters.flatMap((c) => c.cards || []));
  const allCards = chapters.flatMap((c) => c.cards || []);
  // Cards added to a course that is already live: everything else there has a page.
  const unpublished = allCards.filter((c) => !c.pageId && !c.readOnly);
  const hasPublishedCards = allCards.some((c) => c.pageId);

  return (
    <div className="flex gap-0 -mx-6 -my-10 min-h-screen">
      {/* Left sidebar */}
      <aside className="w-64 shrink-0 border-r border-[var(--border)] bg-[var(--card)] flex flex-col sticky top-16 self-start max-h-[calc(100vh-4rem)] overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-[var(--border)]">
          <Link
            href="/mobile-course"
            className="text-xs text-[var(--text-faint)] hover:text-[var(--text)] block mb-2 transition-colors"
          >
            ← All mobile courses
          </Link>
          <span className="pill text-xs mb-2 block w-fit">Mobile Course</span>
          <h1 className="font-semibold text-sm text-[var(--text)] leading-snug line-clamp-2">{course.title}</h1>
          <p className="text-[11px] text-[var(--text-faint)] mt-1">
            {chapters.length} chapter{chapters.length !== 1 ? 's' : ''} · {totalCards} cards
          </p>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <StatusPill status={course.status} />
            {live && (
              <span className="pill pill-running inline-flex items-center gap-1 text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 dot-running" /> Generating…
              </span>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {chapters.map((ch, i) => (
            <div
              key={ch.id}
              className={`w-full text-left px-3 py-2.5 flex items-start gap-2 transition-colors cursor-pointer ${
                i === activeChapter
                  ? 'bg-[var(--accent)]/10 border-r-2 border-[var(--accent)]'
                  : 'hover:bg-[var(--border)]/40'
              }`}
              onClick={() => setActiveChapter(i)}
            >
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium leading-snug truncate ${i === activeChapter ? 'text-[var(--accent)]' : 'text-[var(--text-dim)]'}`}>
                  {ch.title || `Chapter ${i + 1}`}
                </p>
                <p className="text-[10px] text-[var(--text-faint)] mt-0.5 flex items-center gap-1.5">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                    ch.status === 'done' ? 'bg-emerald-400' :
                    ch.status === 'failed' ? 'bg-red-400' :
                    ch.status === 'processing' ? 'bg-amber-400 animate-pulse' :
                    'bg-[var(--border)]'
                  }`} />
                  {regenChapterId === ch.id ? <span className="animate-pulse">{regenLog || 'Regenerating…'}</span> : `${ch.cards?.length || 0} cards`}
                </p>
              </div>
              {ch.status !== 'processing' && regenChapterId !== ch.id && (
                <button
                  className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors"
                  title="Regenerate this chapter"
                  onClick={(e) => { e.stopPropagation(); regenerateChapter(ch.id); }}
                >
                  ↺
                </button>
              )}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-[var(--border)] space-y-2">
          {hasPublishedCards && (
            <button className="btn-secondary w-full text-xs" onClick={() => setUpdate({})}>
              Update course…
            </button>
          )}
          {hasPublishedCards && unpublished.length > 0 && (
            <button
              className="btn-primary w-full text-xs"
              onClick={publishAdditions}
              disabled={publishingAdds || courseGate.blocking}
              title={courseGate.blocking ? 'Fix the card errors first' : 'Create a lesson for each new card, in place'}
            >
              {publishingAdds
                ? 'Publishing additions…'
                : `Publish ${unpublished.length} new card${unpublished.length === 1 ? '' : 's'}`}
            </button>
          )}
          {addResult && (
            <p className={`text-xs ${addResult.startsWith('Error') ? 'text-red-400' : 'text-emerald-600'}`}>{addResult}</p>
          )}
          {(course.status === 'draft' || course.status === 'published') && !publishing && !showPublishForm && (
            <button className="btn-primary w-full text-xs" onClick={() => {
              setPublishCollectionId(course.targetCollectionId || '');
              setShowPublishForm(true);
            }}>
              {course.status === 'published' ? 'Re-publish to Educative' : 'Publish to Educative'}
            </button>
          )}
          {showPublishForm && !publishing && (
            <div className="space-y-2">
              <div className="flex gap-1.5">
                <input
                  className="input flex-1 text-xs"
                  placeholder="Target collection ID"
                  value={publishCollectionId}
                  onChange={(e) => setPublishCollectionId(e.target.value)}
                  autoFocus
                />
                <button
                  className="btn-secondary text-xs px-2 shrink-0"
                  onClick={createCollection}
                  disabled={creatingCollection}
                  title="Auto-create a new Educative collection"
                >
                  {creatingCollection ? '…' : '+ New'}
                </button>
              </div>
              <div className="flex gap-1.5">
                <button
                  className="btn-primary flex-1 text-xs"
                  onClick={publish}
                  disabled={!publishCollectionId.trim() || courseGate.blocking}
                  title={courseGate.blocking ? 'Fix the card errors first' : undefined}
                >Publish</button>
                <button className="btn-secondary flex-1 text-xs" onClick={() => setShowPublishForm(false)}>Cancel</button>
              </div>
            </div>
          )}
          {publishing && <p className="text-xs text-[var(--text-faint)] animate-pulse text-center">Publishing…</p>}
          {publishResult && (
            <p className={`text-xs ${publishResult.startsWith('Error') ? 'text-red-400' : 'text-emerald-600'}`}>
              {publishResult}
            </p>
          )}
        </div>
      </aside>

      {/* Right content */}
      <main className="flex-1 min-w-0 py-8 px-6 overflow-x-hidden">
        {currentChapter ? (
          <div className="space-y-6">
            {/* Chapter header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-xl text-[var(--text)] tracking-tight">{currentChapter.title}</h2>
                <p className="text-xs text-[var(--text-faint)] mt-1">
                  {currentChapter.cards?.length || 0} cards · use ← → to navigate
                  {hasPublishedCards && currentChapter.cards?.some((c) => !c.pageId && !c.readOnly) && (
                    <span className="ml-2 text-amber-600">
                      · {currentChapter.cards.filter((c) => !c.pageId && !c.readOnly).length} not published
                    </span>
                  )}
                  {(currentChapter as any).regeneratedAt && (
                    <span className="ml-2 text-amber-600">· regenerated</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {hasPublishedCards && (
                  <>
                    <button
                      className="btn-secondary text-xs px-3 py-1.5"
                      onClick={() => setUpdate({ chapter: activeChapter })}
                      title="Analyse this chapter against the web course and plan what it needs"
                    >
                      Update chapter…
                    </button>
                    {(() => {
                      const chapter = course.chapters[activeChapter];
                      const pictures = (chapter?.cards || []).filter(
                        (k) => k.type === 'text_img' || k.type === 'img_only' || k.d2Code || k.lottieUrl
                          || /^https?:\/\//.test(String(k.imageUrl || '')),
                      ).length;
                      if (!chapter || !pictures) return null;
                      const running = imagesBusy === chapter.id;
                      return (
                        <button
                          className="btn-secondary text-xs px-3 py-1.5"
                          disabled={!!imagesBusy}
                          onClick={() => regenerateChapterImages(chapter.id, chapter.title, pictures)}
                          title="Draw every picture in this chapter again in the current style. Lottie, D2, SVG and uploaded originals are replaced for good."
                        >
                          {running ? (imagesProgress || 'Redrawing…') : `Regenerate images (${pictures})`}
                        </button>
                      );
                    })()}
                    <button
                      className="btn-secondary text-xs px-3 py-1.5"
                      onClick={() => setAddWeb({ insertAt: activeChapter + 1 })}
                      title="Pick web chapters and generate them with the normal card pipeline, directly after this one"
                    >
                      Add chapter after…
                    </button>
                  </>
                )}
                {currentChapter.status === 'processing' && (
                  <span className="text-xs text-amber-600 animate-pulse">Generating…</span>
                )}
                {currentChapter.status === 'failed' && (
                  <span className="text-xs text-red-400">Failed: {currentChapter.errorMessage}</span>
                )}
                {course.status === 'published' && (currentChapter as any).regeneratedAt && currentChapter.status === 'done' && (
                  <div className="flex flex-col items-end gap-1">
                    <button
                      className="btn-primary text-xs px-3 py-1.5"
                      onClick={() => publishChapter(currentChapter.id)}
                      disabled={chapterPublishing === currentChapter.id || chapterGate.blocking}
                      title={chapterGate.blocking ? 'Fix the card errors first' : undefined}
                    >
                      {chapterPublishing === currentChapter.id ? 'Publishing…' : 'Re-publish chapter'}
                    </button>
                    {chapterPublishResult[currentChapter.id] && (
                      <p className={`text-[11px] ${chapterPublishResult[currentChapter.id].startsWith('Error') ? 'text-red-400' : 'text-emerald-600'}`}>
                        {chapterPublishResult[currentChapter.id]}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <CardIssueSummary issues={chapterGate.issues} />

            {(currentChapter.cards?.length || 0) > 0 ? (
              // key resets carousel index when chapter changes
              <CardCarousel
                key={currentChapter.id}
                cards={currentChapter.cards}
                endpoint={`/api/mobile-course/${course.id}/chapters/${currentChapter.id}/cards`}
                onRewritten={load}
                onUpdate={(updated) => saveChapterCards(currentChapter.id,
                  currentChapter.cards.map((c) => c.id === updated.id ? updated : c))}
                onEdit={(c) => { setEditCard(c); setEditCardChapterId(currentChapter.id); }}
                onDelete={(cardId) => saveChapterCards(currentChapter.id, currentChapter.cards.filter((c) => c.id !== cardId))}
                onMedia={(card, mode) => convertMedia(currentChapter.id, card, mode)}
                mediaBusy={!!mediaCardId}
                onEditImage={(src, onApply) => openImageEdit(src, (newUrl) => {
                  const updCards = currentChapter.cards.map((k) =>
                    k.imageUrl === src ? { ...k, imageUrl: newUrl } : k
                  );
                  saveChapterCards(currentChapter.id, updCards);
                  setImageEdit(null);
                })}
              />
            ) : currentChapter.status === 'done' ? (
              <div className="card p-6 text-sm text-[var(--text-faint)]">No cards generated for this chapter.</div>
            ) : currentChapter.status === 'processing' ? (
              <div className="card p-6 text-sm text-[var(--text-faint)] animate-pulse">Cards are being generated…</div>
            ) : null}
          </div>
        ) : (
          <div className="card p-6 text-sm text-[var(--text-faint)]">
            {live ? 'Waiting for chapters to be processed…' : 'No chapters available.'}
          </div>
        )}
      </main>

      {/* Card editor modal */}
      {editCard && editCardChapterId && (
        <CardEditorModal
          card={editCard}
          onSave={(updated) => {
            const ch = chapters.find((c) => c.id === editCardChapterId);
            if (!ch) return;
            const updCards = ch.cards.map((k) => (k.id === updated.id ? updated : k));
            saveChapterCards(editCardChapterId, updCards);
            setEditCard(null);
            setEditCardChapterId(null);
          }}
          onClose={() => { setEditCard(null); setEditCardChapterId(null); }}
          onSaveToEducative={editCard.pageId && !editCard.readOnly ? async (updated) => {
            // Store the edit first, so the route builds the page from what the
            // author just typed rather than the last saved version.
            const ch = chapters.find((c) => c.id === editCardChapterId);
            if (!ch) return 'Chapter not found';
            await saveChapterCards(editCardChapterId, ch.cards.map((k) => (k.id === updated.id ? updated : k)));
            const res = await fetch(
              `/api/mobile-course/${course.id}/chapters/${editCardChapterId}/cards/${updated.id}/publish`,
              { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) return json.error || `Save failed (${res.status})`;
            await load();
            setEditCard(null);
            setEditCardChapterId(null);
            return '';
          } : undefined}
        />
      )}

      {addWeb && (
        <AddWebChaptersDialog
          course={{ id: params.id, collectionId: course.collectionId }}
          insertAt={addWeb.insertAt}
          onClose={() => setAddWeb(null)}
          onDone={load}
        />
      )}

      {update && (
        <CourseUpdateDialog
          course={course}
          scopeChapter={update.chapter}
          onClose={() => setUpdate(null)}
          onApplied={load}
        />
      )}

      {/* Image edit modal */}
      {imageEdit && (
        <ImageEditModal
          state={imageEdit}
          onChange={(p) => setImageEdit((s) => s ? { ...s, prompt: p } : s)}
          onSubmit={submitImageEdit}
          onApply={applyImageEdit}
          onClose={() => setImageEdit(null)}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === 'running') return (
    <span className="pill pill-running inline-flex items-center gap-1 text-[11px]">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 dot-running" /> in progress
    </span>
  );
  if (status === 'published') return <span className="pill pill-success text-[11px]">published</span>;
  if (status === 'failed') return <span className="pill pill-error text-[11px]">failed</span>;
  if (status === 'cancelled') return <span className="pill pill-error text-[11px]">cancelled</span>;
  return <span className="pill text-[11px]">draft</span>;
}
