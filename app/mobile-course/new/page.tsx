'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

// ── Shared types ──────────────────────────────────────────────────────────────

interface LessonRef { pageId: string; title: string; content?: string; }
interface ChapterRef { id: string; title: string; lessons: LessonRef[]; enabled: boolean; }

interface ArchitectLesson { title: string; outline: string; }
interface ArchitectChapter { title: string; description: string; lessons: ArchitectLesson[]; enabled: boolean; }

type Step =
  | 'mode'              // pick existing vs new topic
  | 'existing-input'    // collection ID form
  | 'existing-preview'  // chapter/lesson review
  | 'new-input'         // topic/domain/description form
  | 'new-architecting'  // AI thinking spinner
  | 'plan-edit'         // editable architect output
  | 'running';          // pipeline in progress

// ── Pipeline stream helper ────────────────────────────────────────────────────

type Stage = { name: string; status: 'start' | 'done' | 'error'; message?: string };

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewMobileCoursePage() {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

  const [step, setStep] = useState<Step>('mode');
  const [stages, setStages] = useState<Stage[]>([]);
  const [runError, setRunError] = useState('');

  // ── Existing course state ─────────────────────────────────────────────────
  const [collectionId, setCollectionId] = useState('');
  const [authorId, setAuthorId] = useState('10370001');
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [chapters, setChapters] = useState<ChapterRef[]>([]);

  // ── New topic state ───────────────────────────────────────────────────────
  const [newTopic, setNewTopic] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newOutline, setNewOutline] = useState('');
  const [architectError, setArchitectError] = useState('');
  const [architectChapters, setArchitectChapters] = useState<ArchitectChapter[]>([]);
  const [generatedCourseName, setGeneratedCourseName] = useState('');

  // ─────────────────────────────────────────────────────────────────────────
  // Existing course flow
  // ─────────────────────────────────────────────────────────────────────────

  async function fetchStructure(e: React.FormEvent) {
    e.preventDefault();
    if (!collectionId.trim()) return;
    setFetching(true);
    setFetchError('');
    try {
      const res = await fetch(
        `/api/mobile-course/collection-preview?collectionId=${encodeURIComponent(collectionId.trim())}&authorId=${encodeURIComponent(authorId.trim() || '10370001')}`,
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setCourseTitle(data.title || '');
      setChapters((data.chapters || []).map((ch: any) => ({
        ...ch,
        enabled: true,
        lessons: (ch.lessons || []).map((l: any) => ({ ...l })),
      })));
      setStep('existing-preview');
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to fetch collection');
    } finally {
      setFetching(false);
    }
  }

  function toggleChapter(idx: number) {
    setChapters((prev) => prev.map((ch, i) => i === idx ? { ...ch, enabled: !ch.enabled } : ch));
  }

  function removeLesson(chIdx: number, lIdx: number) {
    setChapters((prev) => prev.map((ch, i) => {
      if (i !== chIdx) return ch;
      return { ...ch, lessons: ch.lessons.filter((_, j) => j !== lIdx) };
    }));
  }

  function removeChapter(idx: number) {
    setChapters((prev) => prev.filter((_, i) => i !== idx));
  }

  async function startExistingGeneration() {
    const selectedChapters = chapters
      .filter((ch) => ch.enabled && ch.lessons.length > 0)
      .map(({ id, title, lessons }) => ({ id, title, lessons }));
    if (!selectedChapters.length) { setRunError('No chapters selected'); return; }

    setStep('running');
    setStages([]);
    setRunError('');
    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/mobile-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: collectionId.trim(),
          authorId: authorId.trim() || '10370001',
          courseTitle,
          previewedChapters: selectedChapters,
        }),
        signal: abortRef.current.signal,
      });
      await drainStream(res);
    } catch (err: any) {
      if (err?.name !== 'AbortError') setRunError(err?.message || 'Failed to start');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // New topic flow
  // ─────────────────────────────────────────────────────────────────────────

  async function runArchitect(e: React.FormEvent) {
    e.preventDefault();
    if (!newTopic.trim()) return;
    setStep('new-architecting');
    setArchitectError('');
    try {
      const res = await fetch('/api/mobile-course/architect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: newTopic.trim(),
          domain: newDomain.trim(),
          description: newDescription.trim(),
          outline: newOutline.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const plan = json.plan;
      setGeneratedCourseName(plan.courseName || newTopic);
      setArchitectChapters(
        (plan.chapters || []).map((ch: any) => ({
          title: ch.title || '',
          description: ch.description || '',
          enabled: true,
          lessons: (ch.lessons || []).map((l: any) => ({
            title: l.title || '',
            outline: l.outline || '',
          })),
        })),
      );
      setStep('plan-edit');
    } catch (err: any) {
      setArchitectError(err?.message || 'Architect failed');
      setStep('new-input');
    }
  }

  // ── Plan editor mutations ──────────────────────────────────────────────────

  function toggleArchChapter(ci: number) {
    setArchitectChapters((prev) => prev.map((ch, i) => i === ci ? { ...ch, enabled: !ch.enabled } : ch));
  }

  function updateArchChapterTitle(ci: number, title: string) {
    setArchitectChapters((prev) => prev.map((ch, i) => i === ci ? { ...ch, title } : ch));
  }

  function removeArchChapter(ci: number) {
    setArchitectChapters((prev) => prev.filter((_, i) => i !== ci));
  }

  function addArchLesson(ci: number) {
    setArchitectChapters((prev) => prev.map((ch, i) => i === ci
      ? { ...ch, lessons: [...ch.lessons, { title: 'New lesson', outline: '' }] }
      : ch));
  }

  function updateArchLesson(ci: number, li: number, patch: Partial<ArchitectLesson>) {
    setArchitectChapters((prev) => prev.map((ch, i) => i === ci
      ? { ...ch, lessons: ch.lessons.map((l, j) => j === li ? { ...l, ...patch } : l) }
      : ch));
  }

  function removeArchLesson(ci: number, li: number) {
    setArchitectChapters((prev) => prev.map((ch, i) => i === ci
      ? { ...ch, lessons: ch.lessons.filter((_, j) => j !== li) }
      : ch));
  }

  function addArchChapter() {
    setArchitectChapters((prev) => [
      ...prev,
      { title: 'New Chapter', description: '', enabled: true, lessons: [{ title: 'New lesson', outline: '' }] },
    ]);
  }

  async function startNewGeneration() {
    const selectedChapters = architectChapters
      .filter((ch) => ch.enabled && ch.lessons.length > 0)
      .map((ch, ci) => ({
        id: `gen-ch-${ci + 1}`,
        title: ch.title,
        lessons: ch.lessons.map((l, li) => ({
          pageId: `gen-lesson-${ci + 1}-${li + 1}`,
          title: l.title,
          content: l.outline,
        })),
      }));

    if (!selectedChapters.length) { setRunError('No chapters selected'); return; }

    setStep('running');
    setStages([]);
    setRunError('');
    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/mobile-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: 'generated',
          authorId: '10370001',
          courseTitle: generatedCourseName || newTopic,
          previewedChapters: selectedChapters,
        }),
        signal: abortRef.current.signal,
      });
      await drainStream(res);
    } catch (err: any) {
      if (err?.name !== 'AbortError') setRunError(err?.message || 'Failed to start');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Shared: drain SSE stream and redirect on done
  // ─────────────────────────────────────────────────────────────────────────

  async function drainStream(res: Response) {
    const courseId = res.headers.get('X-Course-Id');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No stream');
    const dec = new TextDecoder();
    let buf = '';
    let finalCourseId = courseId;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'meta' && ev.courseId) finalCourseId = ev.courseId;
          if (ev.type === 'stage') {
            setStages((prev) => {
              const idx = prev.findIndex((s) => s.name === ev.name);
              const entry: Stage = { name: ev.name, status: ev.status, message: ev.message };
              if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
              return [...prev, entry];
            });
          }
          if (ev.type === 'done') { if (finalCourseId) router.push(`/mobile-course/${finalCourseId}`); }
          if (ev.type === 'error') setRunError(ev.message || 'Unknown error');
        } catch {}
      }
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setStep(step === 'running' && architectChapters.length > 0 ? 'plan-edit' : 'existing-preview');
    setRunError('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const title = (() => {
    if (step === 'plan-edit' || step === 'new-architecting' || step === 'new-input') return generatedCourseName || newTopic || 'New Topic Course';
    if (step === 'existing-preview' || step === 'existing-input') return courseTitle || 'Existing Course';
    return '';
  })();

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <span className="pill mb-3">New Mobile Course</span>
        <h1 className="text-3xl font-bold tracking-tight">
          Generate <span className="brand-gradient">mobile cards</span>
        </h1>
        {step !== 'mode' && title && (
          <p className="mt-2 text-[var(--text-dim)] text-sm">{title}</p>
        )}
      </div>

      {/* ── Mode picker ──────────────────────────────────────────────── */}
      {step === 'mode' && (
        <div className="grid grid-cols-2 gap-4">
          <button
            className="card p-6 text-left space-y-2 hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/4 transition-colors group"
            onClick={() => setStep('existing-input')}
          >
            <div className="text-2xl">📚</div>
            <h2 className="font-semibold text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
              From Existing Course
            </h2>
            <p className="text-xs text-[var(--text-faint)] leading-relaxed">
              Fetch chapters and lessons from an existing Educative collection and convert them into mobile cards.
            </p>
          </button>
          <button
            className="card p-6 text-left space-y-2 hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/4 transition-colors group"
            onClick={() => setStep('new-input')}
          >
            <div className="text-2xl">✨</div>
            <h2 className="font-semibold text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
              Generate on New Topic
            </h2>
            <p className="text-xs text-[var(--text-faint)] leading-relaxed">
              Describe a topic and let AI architect a full course structure, then review and customise before generating.
            </p>
          </button>
        </div>
      )}

      {/* ── Existing: input ───────────────────────────────────────────── */}
      {step === 'existing-input' && (
        <form onSubmit={fetchStructure} className="card p-6 space-y-5">
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text)]">Collection ID <span className="text-red-400">*</span></label>
            <input
              className="input w-full"
              placeholder="e.g. 12345678"
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
              required
              disabled={fetching}
            />
            <p className="text-xs text-[var(--text-faint)]">The numeric Educative collection ID from the course URL</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text)]">Author ID</label>
            <input
              className="input w-full"
              placeholder="10370001"
              value={authorId}
              onChange={(e) => setAuthorId(e.target.value)}
              disabled={fetching}
            />
          </div>
          {fetchError && <p className="text-sm text-red-400">{fetchError}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setStep('mode')}>← Back</button>
            <button type="submit" className="btn-primary" disabled={fetching || !collectionId.trim()}>
              {fetching ? 'Fetching…' : 'Fetch Structure'}
            </button>
          </div>
        </form>
      )}

      {/* ── Existing: chapter/lesson review ───────────────────────────── */}
      {step === 'existing-preview' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-lg text-[var(--text)]">{courseTitle || 'Collection'}</h2>
              <p className="text-xs text-[var(--text-faint)] mt-0.5">
                {chapters.filter((c) => c.enabled).length} of {chapters.length} chapters selected
                {' · '}{chapters.filter((c) => c.enabled).reduce((s, c) => s + c.lessons.length, 0)} lessons
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary text-sm" onClick={() => setStep('existing-input')}>← Back</button>
              <button
                className="btn-primary text-sm"
                onClick={startExistingGeneration}
                disabled={!chapters.some((c) => c.enabled && c.lessons.length > 0)}
              >
                Generate Cards
              </button>
            </div>
          </div>

          {runError && <div className="card p-3 text-sm text-red-400 border-red-500/30">{runError}</div>}

          <div className="space-y-3">
            {chapters.map((ch, ci) => (
              <div key={ch.id} className={`card p-4 space-y-3 transition-opacity ${!ch.enabled ? 'opacity-40' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <input type="checkbox" checked={ch.enabled} onChange={() => toggleChapter(ci)} className="shrink-0 accent-[var(--accent)]" />
                    <span className="font-medium text-sm text-[var(--text)] truncate">{ch.title || `Chapter ${ci + 1}`}</span>
                    <span className="text-xs text-[var(--text-faint)] shrink-0">{ch.lessons.length} lessons</span>
                  </div>
                  <button className="text-xs text-red-400/60 hover:text-red-400 shrink-0" onClick={() => removeChapter(ci)}>✕</button>
                </div>
                {ch.enabled && ch.lessons.length > 0 && (
                  <div className="pl-6 space-y-1">
                    {ch.lessons.map((l, li) => (
                      <div key={l.pageId} className="flex items-center justify-between gap-2 py-0.5">
                        <span className="text-xs text-[var(--text-dim)] truncate">{l.title || `Lesson ${li + 1}`}</span>
                        <button className="text-[10px] text-[var(--text-faint)] hover:text-red-400 shrink-0" onClick={() => removeLesson(ci, li)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── New topic: input form ─────────────────────────────────────── */}
      {step === 'new-input' && (
        <form onSubmit={runArchitect} className="card p-6 space-y-5">
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text)]">Topic <span className="text-red-400">*</span></label>
            <input
              className="input w-full"
              placeholder="e.g. Advanced Kubernetes Networking"
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text)]">Domain</label>
            <input
              className="input w-full"
              placeholder="e.g. DevOps, Backend Development, Machine Learning"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text)]">Short Description</label>
            <textarea
              className="input w-full h-20 resize-none text-sm"
              placeholder="What will learners gain from this course?"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text)]">Optional Outline / Key Points</label>
            <textarea
              className="input w-full h-24 resize-none text-sm"
              placeholder="List any specific topics, concepts, or structure you want covered…"
              value={newOutline}
              onChange={(e) => setNewOutline(e.target.value)}
            />
          </div>
          {architectError && <p className="text-sm text-red-400">{architectError}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setStep('mode')}>← Back</button>
            <button type="submit" className="btn-primary" disabled={!newTopic.trim()}>
              Design Course Structure
            </button>
          </div>
        </form>
      )}

      {/* ── New topic: architecting spinner ──────────────────────────── */}
      {step === 'new-architecting' && (
        <div className="card p-10 flex flex-col items-center gap-4 text-center">
          <div className="h-8 w-8 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
          <p className="text-sm text-[var(--text-dim)]">AI is designing your course structure…</p>
          <p className="text-xs text-[var(--text-faint)]">This usually takes 15–30 seconds</p>
        </div>
      )}

      {/* ── New topic: plan editor ────────────────────────────────────── */}
      {step === 'plan-edit' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <input
                className="input w-full text-base font-semibold"
                value={generatedCourseName}
                onChange={(e) => setGeneratedCourseName(e.target.value)}
                placeholder="Course name"
              />
              <p className="text-xs text-[var(--text-faint)] mt-1">
                {architectChapters.filter((c) => c.enabled).length} of {architectChapters.length} chapters ·{' '}
                {architectChapters.filter((c) => c.enabled).reduce((s, c) => s + c.lessons.length, 0)} lessons
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button className="btn-secondary text-sm" onClick={() => setStep('new-input')}>← Back</button>
              <button
                className="btn-primary text-sm"
                onClick={startNewGeneration}
                disabled={!architectChapters.some((c) => c.enabled && c.lessons.length > 0)}
              >
                Generate Cards
              </button>
            </div>
          </div>

          {runError && <div className="card p-3 text-sm text-red-400 border-red-500/30">{runError}</div>}

          <div className="space-y-3">
            {architectChapters.map((ch, ci) => (
              <div key={ci} className={`card p-4 space-y-3 transition-opacity ${!ch.enabled ? 'opacity-50' : ''}`}>
                {/* Chapter header */}
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={ch.enabled} onChange={() => toggleArchChapter(ci)} className="shrink-0 accent-[var(--accent)]" />
                  <input
                    className="input flex-1 text-sm font-medium"
                    value={ch.title}
                    onChange={(e) => updateArchChapterTitle(ci, e.target.value)}
                    placeholder="Chapter title"
                  />
                  <button className="text-xs text-red-400/60 hover:text-red-400 shrink-0 px-1" onClick={() => removeArchChapter(ci)} title="Remove chapter">✕</button>
                </div>

                {ch.enabled && (
                  <div className="pl-6 space-y-2">
                    {ch.lessons.map((l, li) => (
                      <div key={li} className="flex gap-2 items-start">
                        <div className="flex-1 space-y-1">
                          <input
                            className="input w-full text-xs"
                            value={l.title}
                            onChange={(e) => updateArchLesson(ci, li, { title: e.target.value })}
                            placeholder="Lesson title"
                          />
                          <textarea
                            className="input w-full text-xs h-14 resize-none font-normal"
                            value={l.outline}
                            onChange={(e) => updateArchLesson(ci, li, { outline: e.target.value })}
                            placeholder="Lesson outline / key points…"
                          />
                        </div>
                        <button
                          className="text-[10px] text-[var(--text-faint)] hover:text-red-400 mt-1.5 shrink-0"
                          onClick={() => removeArchLesson(ci, li)}
                          title="Remove lesson"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      className="text-xs text-[var(--accent)]/70 hover:text-[var(--accent)] transition-colors"
                      onClick={() => addArchLesson(ci)}
                    >
                      + Add lesson
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button className="btn-secondary text-sm w-full" onClick={addArchChapter}>
            + Add chapter
          </button>
        </div>
      )}

      {/* ── Running: pipeline progress ────────────────────────────────── */}
      {step === 'running' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-[var(--text)]">{courseTitle || generatedCourseName || 'Generating…'}</h2>
              <p className="text-xs text-[var(--text-faint)] mt-0.5 animate-pulse">Pipeline running — will redirect when done</p>
            </div>
            <button className="btn-secondary text-sm" onClick={cancel}>Cancel</button>
          </div>

          {runError && <div className="card p-3 text-sm text-red-400 border-red-500/30">{runError}</div>}

          {stages.length > 0 && (
            <div className="card p-5 space-y-2">
              <h3 className="text-sm font-medium text-[var(--text-dim)] mb-3">Pipeline progress</h3>
              {stages.map((s) => (
                <div key={s.name} className="flex items-center gap-3 text-sm">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${
                    s.status === 'done' ? 'bg-emerald-400' :
                    s.status === 'error' ? 'bg-red-400' :
                    'bg-amber-400 animate-pulse'
                  }`} />
                  <span className="text-[var(--text-dim)] flex-1 text-xs">{s.name}</span>
                  {s.message && <span className="text-[var(--text-faint)] text-xs truncate max-w-[160px]">{s.message}</span>}
                  <span className={`text-xs ${s.status === 'done' ? 'text-emerald-400' : s.status === 'error' ? 'text-red-400' : 'text-amber-400'}`}>
                    {s.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
