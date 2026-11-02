'use client';

import { useState } from 'react';
import { Modal } from '@/app/_components/Modal';
import { CARD_TYPES, type MobileCardType } from '@/lib/mobileCardTypes';
import { checkCard, type CardProduct, type LimitIssue } from '@/lib/mobileCardLimits';
import type { MobileCard } from '@/lib/mobileCourseStorage';
import { CardIssues } from './CardIssues';

// Shown as "Text and image" rather than "text_img": this dialog is for authors.
const TYPE_LABEL: Record<MobileCardType, string> = {
  text: 'Text',
  text_img: 'Text and image',
  img_only: 'Image only',
  'text-with-code': 'Text with code',
  'code-with-output': 'Code with output',
  comparisonCards: 'Comparison',
  recapCard: 'Recap',
  quiz: 'Quiz',
  trueFalseCard: 'True / false',
  fillInTheBlank: 'Fill in the blank',
  scenarioCard: 'Scenario',
  highlightCard: 'Highlight',
};

// Internal bookkeeping an author never needs to read.
const HIDDEN = new Set(['id', 'card_number', 'pageId', 'publishedUrl', 'decision',
  'regeneratedAt', 'typeWarning', 'readOnly', 'imageUrl', 'type']);

function fieldLabel(field: string): string {
  return field.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/** One side of the comparison: the card as a reader-ish list of its fields. */
function CardPreview({ card, muted }: { card: MobileCard; muted?: boolean }) {
  const entries = Object.entries(card).filter(([field, value]) =>
    !HIDDEN.has(field) && value !== undefined && value !== null && value !== '');
  return (
    <div className={`space-y-3 ${muted ? 'opacity-70' : ''}`}>
      {card.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.imageUrl} alt={card.illustration_idea || 'Card illustration'}
          className="max-h-48 w-full rounded-lg object-contain bg-[var(--panel-2)]" />
      )}
      {entries.map(([field, value]) => (
        <div key={field} className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{fieldLabel(field)}</p>
            {typeof value === 'string' && value.length > 40 && (
              <span className="text-[10px] font-mono text-[var(--text-faint)] tabular-nums">{value.length}</span>
            )}
          </div>
          <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words text-[var(--text)]">
            {typeof value === 'string' ? value : (
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-[var(--text-dim)]">
                {JSON.stringify(value, null, 1)}
              </pre>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col min-h-0 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--panel)]">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">{title}</h3>
        {badge}
      </header>
      <div className="p-3 overflow-y-auto max-h-[46vh]">{children}</div>
    </section>
  );
}

function IssueBadge({ issues }: { issues: LimitIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  if (!issues.length) return <span className="text-[10px] font-semibold text-emerald-500">Passes the gate</span>;
  return (
    <span className="flex gap-1.5 text-[10px] font-semibold">
      {errors > 0 && <span className="text-red-500">{errors} error{errors > 1 ? 's' : ''}</span>}
      {warnings > 0 && <span className="text-amber-500">{warnings} warning{warnings > 1 ? 's' : ''}</span>}
    </span>
  );
}

export function CardRewriteControl({ card, product, endpoint, onAccepted, prominent, disabled }: {
  card: MobileCard; product: CardProduct; endpoint: string; onAccepted: () => Promise<void>;
  prominent?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MobileCardType>(card.type);
  const [note, setNote] = useState('');
  const [image, setImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ candidate: MobileCard; original: MobileCard; issues: LimitIssue[]; attempts: number } | null>(null);

  const beforeIssues = checkCard(result?.original || card, product);
  const blocked = !!result?.issues.some((i) => i.severity === 'error');

  // Only text_img and img_only carry an image. Switching a card to one of those
  // types makes the server generate one regardless, so the box is then checked
  // and locked rather than offered as a choice.
  const visual = type === 'text_img' || type === 'img_only';
  const forced = visual && type !== card.type;
  const imageOption = {
    checked: visual && (image || forced),
    disabled: !visual || forced,
    reason: !visual
      ? `A ${TYPE_LABEL[type].toLowerCase()} card has no image`
      : forced
        ? 'Changing to this type always generates a new image'
        : card.imageUrl
          ? 'Replace the current image with a new one'
          : 'This card has no image yet — generate one',
  };

  async function request(accept: boolean) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${endpoint}${accept ? '' : '/rewrite'}`, {
        method: accept ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accept
          ? { original: result!.original, candidate: result!.candidate }
          : { type, note, regenerateImage: imageOption.checked }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Rewrite failed');
      if (accept) { await onAccepted(); setOpen(false); setResult(null); }
      else setResult(json);
    } catch (err: any) { setError(err.message || 'Rewrite failed'); }
    finally { setBusy(false); }
  }

  function start() {
    setOpen(true);
    setType(card.type);
    setImage(false);
    setNote('');
    setResult(null);
    setError('');
  }

  return (
    <>
      <button
        type="button"
        className={`card-tool ${prominent ? 'card-tool-alert' : ''}`}
        disabled={disabled}
        onClick={start}
        data-tip={prominent ? 'Has errors — rewrite it' : 'Rewrite with AI'}
        aria-label={prominent ? 'This card has errors — rewrite it' : 'Rewrite this card with AI'}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5z"/>
        </svg>
      </button>

      {open && (
        <Modal
          className="max-w-5xl"
          closeDisabled={busy}
          onClose={() => { setOpen(false); setResult(null); }}
          title={
            <div className="flex items-baseline gap-2 min-w-0">
              <h2 className="font-semibold truncate">Rewrite card #{card.card_number}</h2>
              <span className="text-xs text-[var(--text-dim)] shrink-0">{TYPE_LABEL[card.type]}</span>
            </div>
          }
          footer={
            <div className="flex items-center justify-between gap-3 w-full">
              <p className="text-[11px] text-[var(--text-dim)] min-w-0 truncate">
                {result
                  ? blocked
                    ? 'The rewrite still breaks a rule — try again or adjust the note.'
                    : `Ready to replace the card${result.attempts > 1 ? ` (${result.attempts} attempts)` : ''}.`
                  : 'Nothing is saved until you accept.'}
              </p>
              <div className="flex gap-2 shrink-0">
                <button className="btn-secondary text-xs" disabled={busy}
                  onClick={() => { setOpen(false); setResult(null); }}>Cancel</button>
                <button className="btn-secondary text-xs" disabled={busy || disabled} onClick={() => request(false)}>
                  {busy && !result ? 'Rewriting…' : result ? 'Try again' : 'Rewrite'}
                </button>
                {result && (
                  <button className="btn-primary text-xs" disabled={busy || disabled || blocked} onClick={() => request(true)}
                    title={blocked ? 'Fix the remaining errors first' : undefined}>
                    {busy ? 'Saving…' : 'Accept'}
                  </button>
                )}
              </div>
            </div>
          }
        >
          <div className="p-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] items-end">
              <label className="block text-xs space-y-1">
                <span className="font-medium text-[var(--text-dim)]">Card type</span>
                <select className="input w-full text-sm" value={type} disabled={busy}
                  onChange={(e) => { setType(e.target.value as MobileCardType); setImage(false); setResult(null); }}>
                  {CARD_TYPES.map((value) => (
                    <option key={value} value={value}>{TYPE_LABEL[value]}</option>
                  ))}
                </select>
              </label>
              <label
                className={`flex items-center gap-2 text-xs pb-2 whitespace-nowrap ${imageOption.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={imageOption.reason}
              >
                <input
                  type="checkbox"
                  checked={imageOption.checked}
                  disabled={busy || imageOption.disabled}
                  onChange={(e) => setImage(e.target.checked)}
                />
                Also regenerate the image
              </label>
            </div>

            <label className="block text-xs space-y-1">
              <span className="font-medium text-[var(--text-dim)]">What should change? (optional)</span>
              <textarea className="input w-full text-sm h-16 resize-none" value={note} disabled={busy}
                placeholder="e.g. keep the example but explain why it matters first"
                onChange={(e) => setNote(e.target.value)} />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <Panel title="Current" badge={<IssueBadge issues={beforeIssues} />}>
                <CardPreview card={result?.original || card} muted={!!result} />
                <CardIssues issues={beforeIssues} />
              </Panel>
              <Panel title="Rewritten" badge={result ? <IssueBadge issues={result.issues} /> : undefined}>
                {result ? (
                  <>
                    <CardPreview card={result.candidate} />
                    <CardIssues issues={result.issues} />
                  </>
                ) : (
                  <p className="text-xs text-[var(--text-faint)] py-8 text-center">
                    {busy ? 'Writing a new version…' : 'Press Rewrite to generate a replacement.'}
                  </p>
                )}
              </Panel>
            </div>

            {error && <p className="text-xs text-red-500" role="alert">{error}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * One-shot regeneration: no preview, no dialog. The server rewrites the card
 * with the same type and saves it only if the result passes the gate, so a
 * failed attempt leaves the original in place.
 */
export function CardRegenerateButton({ card, endpoint, onDone, disabled }: {
  card: MobileCard; endpoint: string; onDone: () => Promise<void>; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function regenerate() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${endpoint}/regenerate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: card.type }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Regeneration failed');
      await onDone();
    } catch (err: any) { setError(err.message || 'Regeneration failed'); }
    finally { setBusy(false); }
  }

  // The original card is untouched on failure, so the message explains that and
  // points at Rewrite, which shows the attempt instead of discarding it.
  const tip = error
    ? `${error} — the card was left unchanged. Use Rewrite to see the attempt.`
    : busy ? 'Regenerating…' : 'Regenerate this card';

  return (
    <button
      type="button"
      className={`card-tool ${error ? 'card-tool-alert' : ''}`}
      disabled={busy || disabled}
      onClick={regenerate}
      data-tip={tip}
      data-tip-wrap={error ? 'true' : undefined}
      aria-label={tip}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
        className={busy ? 'animate-spin' : undefined}>
        <path d="M1 4v6h6M23 20v-6h-6"/>
        <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15"/>
      </svg>
    </button>
  );
}
