'use client';

import { useState } from 'react';
import { Modal } from './Modal';

interface ProposedCard {
  card_type: string;
  card_title: string;
  content_focus: string;
  illustration_idea: string | null;
}

export interface Proposal {
  id: string;
  kind: 'cards' | 'chapter' | 'rewrite' | 'media';
  /** Set when the card's picture is being replaced too. */
  media?: 'd2' | 'recreate' | 'fresh';
  chapter_index: number;
  insert_at: number;
  chapter_title: string;
  note: string;
  reason: string;
  cards: ProposedCard[];
}

interface ChapterPlan {
  mobileIndex: number;
  chapterTitle: string;
  comparedWith: string[];
  summary: string;
  proposals: Proposal[];
}

interface WebLesson { pageId: string; title: string }
interface WebChapterRef { index: number; title: string; lessons: WebLesson[] }
/** pageIds empty means the whole web chapter. */
interface WebSelection { chapterIndex: number; pageIds: string[] }
interface ChapterMatch { mobileIndex: number; selection: WebSelection[]; note: string }

/** Only what the dialog reads, so the page's own course type fits. */
interface CourseRef {
  id: string;
  title: string;
  collectionId?: string;
  chapters: Array<{ title: string; cards: Array<{ title?: string; type: string; readOnly?: string; pageId?: string }> }>;
}

type Step = 'source' | 'mapping' | 'plan';

const UPDATE_HINTS = [
  'only material the web course added recently',
  'no new quizzes',
  'keep the chapter under 25 cards',
  'prefer rewrites over new cards',
];
const NEW_CHAPTER_HINTS = [
  'around 10 cards',
  'one diagram card',
  'end with a quiz and a recap',
];
const REFRESH_HINTS = [
  'fix wrong or stale facts only',
  'tighten the wording, keep the meaning',
  'leave the quizzes alone',
];

const MEDIA_LABEL: Record<string, string> = {
  d2: 'D2 diagram redrawn as an illustration',
  recreate: 'uploaded image redrawn in the card style',
  fresh: 'Lottie animation replaced by an illustration',
};

/** Accepts a bare collection ID, or any Educative URL that carries one. */
function readCollectionId(input: string): string {
  const raw = input.trim();
  if (/^\d+$/.test(raw)) return raw;
  const fromUrl = raw.match(/\/(?:collection|courses?)\/\d+\/(\d+)/) || raw.match(/(\d{10,})/);
  return fromUrl ? fromUrl[1] : raw;
}

/**
 * Update a published mobile course against the web course it came from.
 *
 * Four moves, each one the author's: pick the chapters and the source, check
 * the chapter pairing, read the plan, run it. The analysis and the plan change
 * nothing — accepting writes cards into the local course, and publishing them
 * to Educative is still a separate button on the course page.
 *
 * One request per chapter, driven from here: a 500-card course never fits in
 * one prompt, and this way the page can say which chapter it is on.
 */
export function CourseUpdateDialog({
  course,
  onClose,
  onApplied,
  scopeChapter,
  intent = 'gaps',
}: {
  course: CourseRef;
  onClose: () => void;
  onApplied: () => Promise<void>;
  /** Work on this one chapter only; the chapter picker is then hidden. */
  scopeChapter?: number;
  /**
   * 'new-chapter' plans one chapter to follow the scoped one, and nothing else.
   * 'refresh' works only on the cards already there: content, lengths, pictures.
   */
  intent?: 'gaps' | 'refresh' | 'new-chapter';
}) {
  const [step, setStep] = useState<Step>('source');
  const [sourceId, setSourceId] = useState(course.collectionId || '');
  const [instruction, setInstruction] = useState('');
  // The first two chapters are the usual target, and a 35-chapter course should
  // not analyse everything by accident.
  const [selected, setSelected] = useState<number[]>(
    scopeChapter === undefined ? course.chapters.map((_, i) => i).slice(0, 2) : [scopeChapter],
  );

  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [webTitle, setWebTitle] = useState('');
  const [webChapters, setWebChapters] = useState<WebChapterRef[]>([]);
  const [matches, setMatches] = useState<ChapterMatch[]>([]);
  const [plans, setPlans] = useState<ChapterPlan[]>([]);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [log, setLog] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Mobile chapter index -> the search box's text. A missing key means closed.
  const [picker, setPicker] = useState<Record<number, string>>({});
  const [chapterFilter, setChapterFilter] = useState('');
  const [result, setResult] = useState('');

  const chosen = plans.flatMap((p) => p.proposals).filter((p) => accepted[p.id]);
  const newCards = chosen.filter((p) => p.kind !== 'rewrite' && p.kind !== 'media')
    .reduce((n, p) => n + p.cards.length, 0);
  const rewrites = chosen.filter((p) => p.kind === 'rewrite' || p.kind === 'media').length;
  const running = !!busy;
  const validSource = /^\d+$/.test(sourceId.trim());

  function toggleChapter(i: number) {
    setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i].sort((a, b) => a - b)));
  }

  const webChapter = (index: number) => webChapters.find((c) => c.index === index);
  /** How many lessons a selection actually covers; [] means the whole chapter. */
  const lessonCount = (sel: WebSelection) =>
    (sel.pageIds.length || webChapter(sel.chapterIndex)?.lessons.length || 0);
  const selectedLessons = (m: ChapterMatch) => m.selection.reduce((n, s) => n + lessonCount(s), 0);
  // Web chapters no selected mobile chapter draws on: usually the rest of the
  // course, but this is where a missed pairing shows up.
  const unpaired = webChapters.filter((c) => !matches.some((m) => m.selection.some((s) => s.chapterIndex === c.index)));

  function editSelection(mobileIndex: number, fn: (selection: WebSelection[]) => WebSelection[]) {
    setMatches((s) => s.map((m) => (m.mobileIndex === mobileIndex ? { ...m, selection: fn(m.selection) } : m)));
  }

  function toggleLesson(mobileIndex: number, chapterIndex: number, pageId: string) {
    const all = webChapter(chapterIndex)?.lessons.map((l) => l.pageId) || [];
    editSelection(mobileIndex, (selection) => selection.map((sel) => {
      if (sel.chapterIndex !== chapterIndex) return sel;
      const current = sel.pageIds.length ? sel.pageIds : all;
      const next = current.includes(pageId) ? current.filter((id) => id !== pageId) : [...current, pageId];
      // Keeping every lesson is the same as keeping none: store it as the whole chapter.
      const ordered = all.filter((id) => next.includes(id));
      return { ...sel, pageIds: ordered.length === all.length ? [] : ordered };
    }));
  }

  async function post(path: string, body: unknown) {
    const res = await fetch(`/api/mobile-course/${course.id}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    return json;
  }

  async function mapToWebCourse() {
    setError('');
    setBusy('Reading the web course…');
    try {
      const json = await post('map-chapters', { sourceCollectionId: sourceId.trim(), mobileIndexes: selected });
      setWebTitle(json.webTitle);
      setWebChapters(json.webChapters || []);
      setMatches(json.matches || []);
      setStep('mapping');
    } catch (e: any) {
      setError(e?.message || 'Could not read the web course');
    } finally {
      setBusy('');
    }
  }

  /** One request per chapter, so the plan appears as it is written. */
  async function analyse(withWeb: boolean) {
    setError('');
    setPlans([]);
    setAccepted({});
    setResult('');
    const indexes = withWeb ? matches.map((m) => m.mobileIndex) : selected;
    try {
      for (const [n, mobileIndex] of indexes.entries()) {
        setBusy(`Analysing ${course.chapters[mobileIndex]?.title || `chapter ${mobileIndex}`} (${n + 1} of ${indexes.length})…`);
        const json = await post('analyze', {
          mobileIndex,
          instruction,
          intent,
          ...(withWeb ? {
            sourceCollectionId: sourceId.trim(),
            webCourseTitle: webTitle,
            selection: matches.find((m) => m.mobileIndex === mobileIndex)?.selection || [],
          } : {}),
        });
        setPlans((p) => [...p, json.plan]);
        setAccepted((a) => ({ ...a, ...Object.fromEntries((json.plan.proposals || []).map((x: Proposal) => [x.id, true])) }));
        setStep('plan');
      }
    } catch (e: any) {
      setError(e?.message || 'Analysis failed');
      setStep('plan');
    } finally {
      setBusy('');
    }
  }

  async function execute() {
    if (!chosen.length) return;
    setError('');
    setLog([]);
    setBusy('Writing, checking and illustrating the cards…');
    try {
      const json = await post('augment', { proposals: chosen });
      setLog(json.logs || []);
      setResult(`${json.added} card${json.added === 1 ? '' : 's'} added, ${json.rewritten} rewritten. Nothing is on Educative yet.`);
      if (json.errors?.length) setError(json.errors.map((e: any) => `${e.id}: ${e.error}`).join('; '));
      await onApplied();
    } catch (e: any) {
      setError(e?.message || 'Writing the cards failed');
    } finally {
      setBusy('');
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-3 w-full">
      <span className="text-[11px] text-[var(--text-faint)]">
        {step === 'source' && (selected.length
          ? `${selected.length} chapter${selected.length === 1 ? '' : 's'}${validSource ? ', compared against the web course' : ', with no reference course'} · nothing is changed by the analysis`
          : 'Select at least one chapter.')}
        {step === 'mapping' && `${matches.reduce((n, m) => n + selectedLessons(m), 0)} web lesson${
          matches.reduce((n, m) => n + selectedLessons(m), 0) === 1 ? '' : 's'} selected across ${matches.length} chapter${matches.length === 1 ? '' : 's'}, from "${webTitle}"`}
        {step === 'plan' && `${newCards} new card${newCards === 1 ? '' : 's'}, ${rewrites} rewrite${rewrites === 1 ? '' : 's'} selected · published only when you publish the additions`}
      </span>
      <div className="flex gap-2">
        <button className="btn-secondary text-xs" onClick={onClose} disabled={running}>Close</button>
        {step === 'source' && (validSource ? (
          <>
            <button className="btn-secondary text-xs" onClick={() => analyse(false)} disabled={running || !selected.length}>
              Skip the comparison
            </button>
            <button className="btn-primary text-xs" onClick={mapToWebCourse} disabled={running || !selected.length}>
              Pair with the web course
            </button>
          </>
        ) : (
          <button className="btn-primary text-xs" onClick={() => analyse(false)} disabled={running || !selected.length}>
            Analyse {selected.length} chapter{selected.length === 1 ? '' : 's'}
          </button>
        ))}
        {step === 'mapping' && (
          <>
            <button className="btn-secondary text-xs" onClick={() => setStep('source')} disabled={running}>Back</button>
            <button className="btn-primary text-xs" onClick={() => analyse(true)} disabled={running}>
              Analyse {matches.length} chapter{matches.length === 1 ? '' : 's'}
            </button>
          </>
        )}
        {step === 'plan' && (
          <>
            <button className="btn-secondary text-xs" onClick={() => setStep(webChapters.length ? 'mapping' : 'source')} disabled={running}>Back</button>
            <button className="btn-primary text-xs" onClick={execute} disabled={running || !chosen.length}>
              Create {newCards + rewrites} change{newCards + rewrites === 1 ? '' : 's'}
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      title={intent === 'new-chapter'
        ? `Add a chapter after ${course.chapters[scopeChapter ?? 0]?.title || 'this one'}`
        : intent === 'refresh'
          ? (scopeChapter === undefined
            ? 'Update the cards in this course'
            : `Update the cards in ${course.chapters[scopeChapter]?.title || 'this chapter'}`)
          : scopeChapter === undefined
            ? 'Update this course'
            : `Update ${course.chapters[scopeChapter]?.title || 'this chapter'}`}
      onClose={onClose}
      closeDisabled={running}
      className="max-w-3xl"
      footer={footer}
    >
      <div className="space-y-4">
        {step === 'source' && (
          <div className="space-y-5">
            {/* What this will work on */}
            <section className="rounded-lg border border-[var(--border)] overflow-hidden">
              <header className="flex items-baseline gap-2 px-3 py-2 bg-[var(--border)]/20 border-b border-[var(--border)]">
                <span className="text-[10px] font-mono text-[var(--text-faint)]">1</span>
                <h3 className="text-xs font-semibold text-[var(--text)]">
                  {scopeChapter === undefined ? 'Chapters to work on' : 'Scope'}
                </h3>
                {scopeChapter === undefined && (
                  <span className="ml-auto text-[11px] text-[var(--text-faint)] tabular-nums">
                    {selected.length} of {course.chapters.length} selected
                  </span>
                )}
              </header>

              {scopeChapter === undefined ? (
                <>
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)]">
                    <input
                      className="input text-xs flex-1"
                      placeholder="Filter chapters…"
                      value={chapterFilter}
                      onChange={(e) => setChapterFilter(e.target.value)}
                      disabled={running}
                    />
                    <button className="text-[11px] underline text-[var(--text-faint)] hover:text-[var(--text)]"
                      disabled={running}
                      onClick={() => setSelected(course.chapters.map((_, i) => i).slice(0, 2))}>first two</button>
                    <button className="text-[11px] underline text-[var(--text-faint)] hover:text-[var(--text)]"
                      disabled={running}
                      onClick={() => setSelected(course.chapters.map((_, i) => i))}>all</button>
                    <button className="text-[11px] underline text-[var(--text-faint)] hover:text-[var(--text)]"
                      disabled={running}
                      onClick={() => setSelected([])}>none</button>
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-[var(--border)]">
                    {course.chapters.map((c, i) => ({ c, i }))
                      .filter(({ c, i }) => {
                        const q = chapterFilter.trim().toLowerCase();
                        return !q || String(i) === q || c.title.toLowerCase().includes(q);
                      })
                      .map(({ c, i }) => {
                        const unpublished = c.cards.filter((k) => !k.pageId && !k.readOnly).length;
                        return (
                          <label
                            key={i}
                            className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--border)]/30 ${
                              selected.includes(i) ? 'bg-[var(--accent)]/5' : ''
                            }`}
                          >
                            <input type="checkbox" checked={selected.includes(i)} onChange={() => toggleChapter(i)} disabled={running} />
                            <span className="font-mono text-[10px] text-[var(--text-faint)] w-6 shrink-0 text-right">{i}</span>
                            <span className="text-xs text-[var(--text-dim)] truncate flex-1">{c.title}</span>
                            {unpublished > 0 && (
                              <span className="text-[10px] text-amber-600 shrink-0">{unpublished} unpublished</span>
                            )}
                            <span className="text-[10px] text-[var(--text-faint)] shrink-0 tabular-nums">{c.cards.length} cards</span>
                          </label>
                        );
                      })}
                  </div>
                </>
              ) : (
                <div className="px-3 py-2.5">
                  <p className="text-sm text-[var(--text)]">
                    <span className="font-mono text-[10px] text-[var(--text-faint)] mr-1">{scopeChapter}</span>
                    {course.chapters[scopeChapter]?.title}
                    <span className="text-[11px] text-[var(--text-faint)] font-normal ml-2">
                      {course.chapters[scopeChapter]?.cards.length} cards
                    </span>
                  </p>
                  <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                    {intent === 'new-chapter'
                      ? 'A new chapter will be planned and placed directly after this one. Nothing in it is changed.'
                      : intent === 'refresh'
                        ? 'Every card here is reviewed for correctness, wording and length. Lottie, D2 and uploaded pictures are replaced by generated illustrations — the originals are not kept. No card is added.'
                        : 'Only this chapter is analysed. Its cards may gain additions and rewrites.'}
                  </p>
                </div>
              )}
            </section>

            {/* The reference course */}
            <section className="rounded-lg border border-[var(--border)] overflow-hidden">
              <header className="flex items-baseline gap-2 px-3 py-2 bg-[var(--border)]/20 border-b border-[var(--border)]">
                <span className="text-[10px] font-mono text-[var(--text-faint)]">2</span>
                <h3 className="text-xs font-semibold text-[var(--text)]">Compare against the web course</h3>
                <span className="ml-auto text-[11px] text-[var(--text-faint)]">optional</span>
              </header>
              <div className="px-3 py-2.5 space-y-1.5">
                <div className="flex gap-2">
                  <input
                    id="course-update-source"
                    className="input text-sm flex-1"
                    placeholder="Collection ID or a link to the course"
                    value={sourceId}
                    onChange={(e) => setSourceId(readCollectionId(e.target.value))}
                    disabled={running}
                  />
                  {!!sourceId && (
                    <button
                      className="btn-secondary text-xs shrink-0"
                      onClick={() => setSourceId('')}
                      disabled={running}
                    >Clear</button>
                  )}
                </div>
                <p className="text-[11px] text-[var(--text-faint)]">
                  {validSource
                    ? 'The web course is kept up to date, so it is the reference: the plan comes from the gap between it and these cards.'
                    : sourceId
                      ? 'That is not a collection ID. Paste the number, or the course URL it appears in.'
                      : 'Leave empty to analyse the cards on their own, without a reference.'}
                </p>
              </div>
            </section>

            {/* Steering */}
            <section className="rounded-lg border border-[var(--border)] overflow-hidden">
              <header className="flex items-baseline gap-2 px-3 py-2 bg-[var(--border)]/20 border-b border-[var(--border)]">
                <span className="text-[10px] font-mono text-[var(--text-faint)]">3</span>
                <h3 className="text-xs font-semibold text-[var(--text)]">Tell the analyst what you want</h3>
                <span className="ml-auto text-[11px] text-[var(--text-faint)]">optional</span>
              </header>
              <div className="px-3 py-2.5 space-y-2">
                <textarea
                  id="course-update-instruction"
                  className="input w-full text-sm"
                  rows={3}
                  placeholder={intent === 'new-chapter'
                    ? 'For example: cover the caching building block in 10 cards, with one diagram card.'
                    : intent === 'refresh'
                      ? 'For example: correct anything the web course now contradicts, and leave the wording alone otherwise.'
                      : 'For example: only add cards for material the web course added this year, and keep the chapter under 25 cards.'}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  disabled={running}
                />
                <div className="flex flex-wrap gap-1.5">
                  {(intent === 'new-chapter' ? NEW_CHAPTER_HINTS : intent === 'refresh' ? REFRESH_HINTS : UPDATE_HINTS).map((hint) => (
                    <button
                      key={hint}
                      className="pill text-[11px] hover:border-[var(--accent)]"
                      disabled={running}
                      onClick={() => setInstruction((s) => (s ? `${s.trim()} ${hint}` : hint))}
                    >
                      + {hint}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}
        {step === 'mapping' && (
          <>
            <div className="rounded-lg bg-[var(--border)]/30 px-3 py-2">
              <p className="text-xs text-[var(--text-dim)]">
                Source: <span className="font-medium text-[var(--text)]">{webTitle}</span>
                <span className="text-[var(--text-faint)]"> · {webChapters.length} chapters</span>
              </p>
              <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                The pairing below is a proposal. A mobile chapter can draw on several web chapters, or on
                a few lessons out of one — add what is missing, and untick what does not belong.
              </p>
            </div>

            {unpaired.length > 0 && (
              <details className="rounded-lg border border-[var(--border)] px-3 py-2">
                <summary className="text-xs text-[var(--text-dim)] cursor-pointer">
                  {unpaired.length} web chapter{unpaired.length === 1 ? '' : 's'} not paired with anything here
                </summary>
                <p className="text-[11px] text-[var(--text-faint)] mt-1">
                  Most of these belong to parts of the course you are not working on. Add any that should be
                  compared, with the search box on the chapter below.
                </p>
                <ul className="mt-1 max-h-32 overflow-y-auto">
                  {unpaired.map((c) => (
                    <li key={c.index} className="text-[11px] text-[var(--text-dim)] truncate">
                      <span className="font-mono text-[10px] text-[var(--text-faint)] mr-1">{c.index}</span>
                      {c.title}
                      <span className="text-[var(--text-faint)]"> · {c.lessons.length} lesson{c.lessons.length === 1 ? '' : 's'}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {matches.map((m) => {
              const used = m.selection.map((s) => s.chapterIndex);
              const query = (picker[m.mobileIndex] ?? '').trim().toLowerCase();
              const open = picker[m.mobileIndex] !== undefined;
              const hits = webChapters.filter((c) => !query
                || String(c.index) === query
                || c.title.toLowerCase().includes(query)
                || c.lessons.some((l) => l.title.toLowerCase().includes(query)));

              return (
                <section key={m.mobileIndex} className="rounded-lg border border-[var(--border)] overflow-hidden">
                  <header className="flex items-baseline justify-between gap-3 px-3 py-2 bg-[var(--border)]/20 border-b border-[var(--border)]">
                    <h3 className="text-sm font-medium text-[var(--text)] truncate">
                      <span className="font-mono text-[10px] text-[var(--text-faint)] mr-1">{m.mobileIndex}</span>
                      {course.chapters[m.mobileIndex]?.title}
                      <span className="text-[11px] text-[var(--text-faint)] font-normal ml-2">
                        {course.chapters[m.mobileIndex]?.cards.length} cards
                      </span>
                    </h3>
                    <span className={`text-[11px] shrink-0 tabular-nums ${selectedLessons(m) ? 'text-[var(--text-faint)]' : 'text-amber-600'}`}>
                      {selectedLessons(m)} web lesson{selectedLessons(m) === 1 ? '' : 's'}
                    </span>
                  </header>

                  <div className="px-3 py-2 space-y-2">
                    {m.note && <p className="text-[11px] text-[var(--text-faint)] italic">{m.note}</p>}

                    {!m.selection.length && (
                      <p className="text-xs text-amber-600">
                        Nothing paired yet — analysed on its own, with no web course to compare against.
                      </p>
                    )}

                    {m.selection.map((sel) => {
                      const chapter = webChapter(sel.chapterIndex);
                      const lessons = chapter?.lessons || [];
                      const partial = sel.pageIds.length > 0;
                      const key = `${m.mobileIndex}:${sel.chapterIndex}`;
                      const showLessons = !!expanded[key];
                      return (
                        <div key={sel.chapterIndex} className="rounded border border-[var(--border)] bg-[var(--surface)]">
                          <div className="flex items-center gap-2 px-2 py-1.5">
                            <button
                              className="text-xs text-[var(--text-faint)] hover:text-[var(--text)] shrink-0 w-4 text-center"
                              onClick={() => setExpanded((e) => ({ ...e, [key]: !showLessons }))}
                              aria-expanded={showLessons}
                              title={showLessons ? 'Hide lessons' : 'Choose individual lessons'}
                            >
                              {showLessons ? '▾' : '▸'}
                            </button>
                            <span className="text-xs text-[var(--text)] truncate flex-1 min-w-0">
                              <span className="font-mono text-[10px] text-[var(--text-faint)] mr-1">{sel.chapterIndex}</span>
                              {chapter?.title || `Chapter ${sel.chapterIndex}`}
                            </span>
                            <span className={`text-[10px] shrink-0 tabular-nums px-1.5 py-0.5 rounded ${
                              partial ? 'bg-amber-500/15 text-amber-600' : 'text-[var(--text-faint)]'
                            }`}>
                              {partial ? `${sel.pageIds.length} of ${lessons.length}` : `all ${lessons.length}`}
                            </span>
                            <button
                              className="text-[11px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-faint)] hover:text-red-400 hover:border-red-400 shrink-0"
                              disabled={running}
                              title="Remove this web chapter"
                              onClick={() => editSelection(m.mobileIndex, (s) => s.filter((x) => x.chapterIndex !== sel.chapterIndex))}
                            >
                              Remove
                            </button>
                          </div>

                          {showLessons && (
                            <div className="border-t border-[var(--border)]">
                              <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border)]">
                                <button
                                  className="text-[10px] underline text-[var(--text-faint)] hover:text-[var(--text)]"
                                  disabled={running}
                                  onClick={() => editSelection(m.mobileIndex, (s) => s.map((x) =>
                                    x.chapterIndex === sel.chapterIndex ? { ...x, pageIds: [] } : x))}
                                >
                                  Select all
                                </button>
                                <button
                                  className="text-[10px] underline text-[var(--text-faint)] hover:text-[var(--text)]"
                                  disabled={running || lessons.length < 2}
                                  title={lessons.length < 2 ? 'A chapter must keep at least one lesson' : undefined}
                                  onClick={() => editSelection(m.mobileIndex, (s) => s.map((x) =>
                                    x.chapterIndex === sel.chapterIndex ? { ...x, pageIds: [lessons[0]?.pageId].filter(Boolean) as string[] } : x))}
                                >
                                  Keep only the first
                                </button>
                              </div>
                              <div className="max-h-44 overflow-y-auto divide-y divide-[var(--border)]">
                                {lessons.map((lesson) => {
                                  const on = !partial || sel.pageIds.includes(lesson.pageId);
                                  return (
                                    <label
                                      key={lesson.pageId}
                                      className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-[var(--border)]/30"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={on}
                                        disabled={running}
                                        onChange={() => toggleLesson(m.mobileIndex, sel.chapterIndex, lesson.pageId)}
                                      />
                                      <span className={`text-[11px] truncate ${on ? 'text-[var(--text-dim)]' : 'text-[var(--text-faint)] line-through'}`}>
                                        {lesson.title}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {!open ? (
                      <button
                        className="btn-secondary text-xs w-full"
                        disabled={running}
                        onClick={() => setPicker((p) => ({ ...p, [m.mobileIndex]: '' }))}
                      >
                        + Add web material
                      </button>
                    ) : (
                      <div className="rounded border border-[var(--accent)]/40">
                        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border)]">
                          <input
                            className="input text-xs flex-1"
                            autoFocus
                            placeholder="Search web chapters and lessons, or type a number…"
                            value={picker[m.mobileIndex] ?? ''}
                            onChange={(e) => setPicker((p) => ({ ...p, [m.mobileIndex]: e.target.value }))}
                            disabled={running}
                          />
                          <button
                            className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text)] shrink-0"
                            onClick={() => setPicker((p) => { const n = { ...p }; delete n[m.mobileIndex]; return n; })}
                          >
                            Done
                          </button>
                        </div>
                        <div className="max-h-56 overflow-y-auto divide-y divide-[var(--border)]">
                          {hits.map((c) => {
                            const already = used.includes(c.index);
                            return (
                              <button
                                key={c.index}
                                className={`w-full text-left px-2 py-1.5 flex items-center gap-2 ${
                                  already ? 'opacity-50 cursor-default' : 'hover:bg-[var(--border)]/30'
                                }`}
                                disabled={already || running}
                                onClick={() => editSelection(m.mobileIndex, (s) => [...s, { chapterIndex: c.index, pageIds: [] }]
                                  .sort((a, b) => a.chapterIndex - b.chapterIndex))}
                              >
                                <span className="font-mono text-[10px] text-[var(--text-faint)] w-6 shrink-0 text-right">{c.index}</span>
                                <span className="text-[11px] text-[var(--text-dim)] truncate flex-1">{c.title}</span>
                                <span className="text-[10px] text-[var(--text-faint)] shrink-0">
                                  {already ? 'added' : `${c.lessons.length} lesson${c.lessons.length === 1 ? '' : 's'}`}
                                </span>
                              </button>
                            );
                          })}
                          {!hits.length && (
                            <p className="px-2 py-2 text-[11px] text-[var(--text-faint)]">No web chapter matches that.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </>
        )}
        {step === 'plan' && (
          <>
            {plans.map((plan) => (
              <div key={plan.mobileIndex} className="space-y-2">
                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">
                    {plan.mobileIndex}: {plan.chapterTitle}
                  </p>
                  {plan.comparedWith.length > 0 && (
                    <p className="text-[11px] text-[var(--text-faint)]">compared with {plan.comparedWith.join(', ')}</p>
                  )}
                  <p className="text-xs text-[var(--text-dim)] mt-1">{plan.summary}</p>
                </div>
                {!plan.proposals.length && (
                  <p className="text-xs text-[var(--text-faint)]">Nothing proposed for this chapter.</p>
                )}
                {plan.proposals.map((p) => (
                  <div key={p.id} className="rounded-lg border border-[var(--border)] p-3 space-y-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={!!accepted[p.id]}
                        onChange={(e) => setAccepted((s) => ({ ...s, [p.id]: e.target.checked }))}
                        disabled={running}
                      />
                      <span className="min-w-0">
                        <span className="text-sm font-medium text-[var(--text)]">
                          {p.kind === 'chapter' && `New chapter "${p.chapter_title}" after this one`}
                          {p.kind === 'cards' && `${p.cards.length} card${p.cards.length === 1 ? '' : 's'} at position ${p.insert_at + 1}`}
                          {p.kind === 'rewrite' && `Rewrite card ${p.insert_at + 1}: ${course.chapters[p.chapter_index]?.cards[p.insert_at]?.title || 'untitled'}`}
                          {p.kind === 'media' && `New picture for card ${p.insert_at + 1}: ${course.chapters[p.chapter_index]?.cards[p.insert_at]?.title || 'untitled'}`}
                        </span>
                        {p.media && (
                          <span className="block text-[11px] text-amber-600 mt-0.5">
                            {MEDIA_LABEL[p.media]} — the original is replaced
                          </span>
                        )}
                        <span className="block text-xs text-[var(--text-faint)] mt-0.5">{p.reason}</span>
                      </span>
                    </label>
                    {p.note && <p className="pl-6 text-xs text-[var(--text-dim)]">{p.note}</p>}
                    <ul className="pl-6 space-y-1">
                      {p.cards.map((c, i) => (
                        <li key={i} className="text-xs text-[var(--text-dim)]">
                          <span className="font-mono text-[10px] text-[var(--text-faint)]">{c.card_type}</span>{' '}
                          <span className="font-medium">{c.card_title}</span> — {c.content_focus}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
            {result && <p className="text-sm text-emerald-600">{result}</p>}
            {log.length > 0 && (
              <details className="text-[11px] text-[var(--text-faint)]">
                <summary className="cursor-pointer">Generation log ({log.length})</summary>
                <pre className="mt-1 whitespace-pre-wrap">{log.join('\n')}</pre>
              </details>
            )}
          </>
        )}

        {busy && <p className="text-xs text-[var(--text-faint)] animate-pulse">{busy}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
