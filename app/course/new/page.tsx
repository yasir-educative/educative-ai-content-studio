'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field } from '../../_components/Field';

const DOMAINS = [
  'System Design',
  'Coding Interview Patterns',
  'Frontend',
  'Backend',
  'AI/ML',
  'DevOps',
  'Data Structures & Algorithms',
  'Database Design',
  'Cloud & Infrastructure',
  'Other',
];

interface LessonInput {
  lessonTitle: string;
  targetAudience: string;
  wordsLength: number;
  outline: string;
  templateLessonUrl: string;
  runJsEnabled: boolean;
  aiAssessmentEnabled: boolean;
  prevLessonTitle: string;
  nextLessonTitle: string;
}

interface ChapterInput {
  chapterTitle: string;
  chapterSummary: string;
  lessons: LessonInput[];
}

function defaultLesson(): LessonInput {
  return {
    lessonTitle: '',
    targetAudience: 'Intermediate',
    wordsLength: 2000,
    outline: '',
    templateLessonUrl: '',
    runJsEnabled: false,
    aiAssessmentEnabled: true,
    prevLessonTitle: '',
    nextLessonTitle: '',
  };
}

function defaultChapter(num: number): ChapterInput {
  return {
    chapterTitle: `Chapter ${num}`,
    chapterSummary: '',
    lessons: [defaultLesson()],
  };
}

// ── Sheet import panel ────────────────────────────────────────────────────────
function SheetImportPanel({ onImport }: { onImport: (data: any) => void }) {
  const [sheetUrl, setSheetUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function doImport() {
    if (!sheetUrl.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/sheet-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sheetUrl }),
      });
      const json = await res.json();
      if (!res.ok) {
        setResult({ ok: false, message: json?.error || 'Import failed' });
        return;
      }
      onImport(json);
      setResult({ ok: true, message: `Imported ${json.lessonCount} lesson${json.lessonCount !== 1 ? 's' : ''} across ${json.chapters.length} chapter${json.chapters.length !== 1 ? 's' : ''}.` });
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field
        label="Google Sheet URL"
        hint="The sheet must be shared: File → Share → Anyone with the link → Viewer."
      >
        <div className="flex gap-2">
          <input
            className="input flex-1 font-mono text-xs"
            placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=…"
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary text-xs px-4 py-2 shrink-0"
            disabled={loading || !sheetUrl.trim()}
            onClick={doImport}
          >
            {loading ? (
              <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" />
            ) : 'Import'}
          </button>
        </div>
      </Field>

      {result && (
        <div className={`text-xs rounded-lg px-3 py-2 ${result.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}>
          {result.message}
        </div>
      )}

      {/* Expected column structure */}
      <details className="group">
        <summary className="text-xs text-[var(--text-faint)] hover:text-[var(--text)] cursor-pointer list-none flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="group-open:rotate-90 transition-transform">
            <path d="M9 18l6-6-6-6"/>
          </svg>
          Expected column headers
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[10px] text-[var(--text-faint)] border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left py-1.5 pr-3 font-semibold text-[var(--text-dim)] whitespace-nowrap">Column</th>
                <th className="text-left py-1.5 pr-3 font-semibold text-[var(--text-dim)]">Required</th>
                <th className="text-left py-1.5 font-semibold text-[var(--text-dim)]">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]/50">
              {[
                ['Course Title', 'Yes*', 'Same value in every row. *First row used.'],
                ['Course Summary', 'No', 'Optional. First row used.'],
                ['Domain', 'No', 'e.g. System Design, Frontend. Default: System Design'],
                ['Chapter Title', 'Yes', 'Rows with the same chapter title are grouped together'],
                ['Chapter Summary', 'No', 'Optional chapter description'],
                ['Lesson Title', 'Yes', 'One lesson per row'],
                ['Outline', 'No', 'Optional — leave blank to auto-generate'],
                ['Template Lesson URL', 'No', 'Educative lesson URL for style reference (per-lesson)'],
                ['Audience', 'No', 'Beginner / Intermediate / Advanced. Default: Intermediate'],
                ['Word Count', 'No', 'Target word count. Default: 2000'],
                ['RunJS', 'No', 'TRUE or FALSE. Default: FALSE'],
                ['AI Assessment', 'No', 'TRUE or FALSE. Default: TRUE'],
                ['Prev Lesson', 'No', 'Title of the preceding lesson (for context)'],
                ['Next Lesson', 'No', 'Title of the following lesson (for context)'],
              ].map(([col, req, notes]) => (
                <tr key={col}>
                  <td className="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap text-[var(--text-dim)]">{col}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{req}</td>
                  <td className="py-1.5 text-[var(--text-faint)] leading-snug">{notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function NewCourseLessonPage() {
  const router = useRouter();

  // Course-level
  const [courseTitle, setCourseTitle] = useState('');
  const [courseSummary, setCourseSummary] = useState('');
  const [domain, setDomain] = useState('System Design');
  const [templateUrl, setTemplateUrl] = useState('');   // course-level: for authorId/collectionId + default style
  const [authorId, setAuthorId] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Import panel visibility
  const [showImport, setShowImport] = useState(false);

  // Chapters
  const [chapters, setChapters] = useState<ChapterInput[]>([defaultChapter(1)]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // ── Import handler ──
  function handleImport(data: any) {
    if (data.courseTitle) setCourseTitle(data.courseTitle);
    if (data.courseSummary) setCourseSummary(data.courseSummary);
    if (data.domain) setDomain(data.domain);
    if (Array.isArray(data.chapters) && data.chapters.length > 0) {
      setChapters(
        data.chapters.map((ch: any) => ({
          chapterTitle: ch.chapterTitle || '',
          chapterSummary: ch.chapterSummary || '',
          lessons: (ch.lessons || []).map((l: any) => ({
            lessonTitle: l.lessonTitle || '',
            targetAudience: l.targetAudience || 'Intermediate',
            wordsLength: Number(l.wordsLength) || 2000,
            outline: l.outline || '',
            templateLessonUrl: l.templateLessonUrl || '',
            runJsEnabled: Boolean(l.runJsEnabled),
            aiAssessmentEnabled: l.aiAssessmentEnabled !== false,
            prevLessonTitle: l.prevLessonTitle || '',
            nextLessonTitle: l.nextLessonTitle || '',
          })),
        }))
      );
      setShowImport(false); // collapse after successful import
    }
  }

  // ── Chapter mutations ──
  function updateChapter<K extends keyof ChapterInput>(ci: number, field: K, value: ChapterInput[K]) {
    setChapters((prev) => prev.map((c, i) => i === ci ? { ...c, [field]: value } : c));
  }
  function addChapter() {
    setChapters((prev) => [...prev, defaultChapter(prev.length + 1)]);
  }
  function removeChapter(ci: number) {
    if (chapters.length === 1) return;
    setChapters((prev) => prev.filter((_, i) => i !== ci));
  }

  // ── Lesson mutations ──
  function updateLesson<K extends keyof LessonInput>(ci: number, li: number, field: K, value: LessonInput[K]) {
    setChapters((prev) =>
      prev.map((c, i) =>
        i !== ci ? c : { ...c, lessons: c.lessons.map((l, j) => j === li ? { ...l, [field]: value } : l) }
      )
    );
  }
  function addLesson(ci: number) {
    setChapters((prev) =>
      prev.map((c, i) => i !== ci ? c : { ...c, lessons: [...c.lessons, defaultLesson()] })
    );
  }
  function removeLesson(ci: number, li: number) {
    setChapters((prev) =>
      prev.map((c, i) => i !== ci ? c : { ...c, lessons: c.lessons.filter((_, j) => j !== li) })
    );
  }

  const totalLessons = chapters.reduce((sum, c) => sum + c.lessons.length, 0);

  // ── Submit ──
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chapters.flatMap((c) => c.lessons).every((l) => l.lessonTitle.trim())) {
      setErr('All lessons must have a title.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const lessons = chapters.flatMap((ch) =>
        ch.lessons.map((l) => ({
          courseTitle,
          courseSummary,
          domain,
          lessonTitle: l.lessonTitle,
          chapterTitle: ch.chapterTitle,
          chapterSummary: ch.chapterSummary,
          targetAudience: l.targetAudience,
          wordsLength: Number(l.wordsLength),
          outline: l.outline,
          // Lesson-level template overrides course-level for style; course-level extracts authorId/collectionId
          templateUrl: l.templateLessonUrl || templateUrl,
          authorId,
          collectionId,
          runJsEnabled: l.runJsEnabled,
          aiAssessmentEnabled: l.aiAssessmentEnabled,
          prevLessonTitle: l.prevLessonTitle,
          nextLessonTitle: l.nextLessonTitle,
        }))
      );

      const res = await fetch('/api/course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessons }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json?.error || 'Request failed'); setBusy(false); return; }
      router.push(`/course/view/${encodeURIComponent(courseTitle)}`);
    } catch (e: any) {
      setErr(e?.message || String(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <span className="pill mb-3">Course</span>
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="brand-gradient">Course Lesson</span> Generator
        </h1>
        <p className="mt-2 text-[var(--text-dim)] max-w-2xl text-sm">
          Define chapters and lessons manually, or import them from a Google Sheet.
          The pipeline runs for each lesson in parallel.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-6">

        {/* ── Google Sheet Import ── */}
        <div className="card overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
            onClick={() => setShowImport((v) => !v)}
          >
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-[#0F9D58]/10 border border-[#0F9D58]/30 flex items-center justify-center shrink-0">
                {/* Google Sheets icon */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <rect x="4" y="2" width="16" height="20" rx="2" fill="#0F9D58" fillOpacity="0.15" stroke="#0F9D58" strokeWidth="1.5"/>
                  <path d="M8 10h8M8 13h8M8 16h5" stroke="#0F9D58" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M14 2v5h6" stroke="#0F9D58" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold">Import from Google Sheets</p>
                <p className="text-xs text-[var(--text-faint)]">Auto-populate chapters and lessons from a spreadsheet</p>
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-[var(--text-faint)] transition-transform ${showImport ? 'rotate-180' : ''}`}>
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {showImport && (
            <div className="px-5 pb-5 border-t border-[var(--border)] pt-4">
              <SheetImportPanel onImport={handleImport} />
            </div>
          )}
        </div>

        {/* ── Course ── */}
        <div className="card p-6 space-y-5">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 rounded-full bg-[var(--accent)]/20 border border-[var(--accent)]/40 flex items-center justify-center text-[10px] font-bold text-[var(--accent)]">C</div>
            <h2 className="text-sm font-semibold tracking-wide">Course</h2>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <Field label="Course title">
                <input className="input" required placeholder="e.g. Grokking the System Design Interview"
                  value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} />
              </Field>
            </div>
            <Field label="Domain">
              <select className="input" value={domain} onChange={(e) => setDomain(e.target.value)}>
                {DOMAINS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Course summary" hint="Optional — used by all lessons to maintain voice and context consistency.">
            <textarea className="input min-h-[72px] text-sm" placeholder="What does this course teach? Who is it for? What's the learning arc?"
              value={courseSummary} onChange={(e) => setCourseSummary(e.target.value)} />
          </Field>

          <Field
            label="Educative template URL"
            hint={templateUrl
              ? 'Used to extract Author ID + Collection ID. Also used as the default style template for lessons that don\'t have their own.'
              : 'Optional — if provided, all lessons use this template. Otherwise each lesson uses its own template URL below.'}
          >
            <input className="input font-mono text-xs"
              placeholder="https://www.educative.io/editor/author/123/collection/456/page/789 (optional)"
              value={templateUrl} onChange={(e) => setTemplateUrl(e.target.value)} />
          </Field>

          <button type="button" className="text-xs text-[var(--text-faint)] hover:text-[var(--text)] flex items-center gap-1.5"
            onClick={() => setShowAdvanced((v) => !v)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d={showAdvanced ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'}/>
            </svg>
            {showAdvanced ? 'Hide' : 'Show'} manual Author / Collection IDs
          </button>

          {showAdvanced && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Author ID">
                <input className="input font-mono text-xs" placeholder="e.g. 6369199079047168"
                  value={authorId} onChange={(e) => setAuthorId(e.target.value)} />
              </Field>
              <Field label="Collection ID">
                <input className="input font-mono text-xs" placeholder="e.g. 5668546535088128"
                  value={collectionId} onChange={(e) => setCollectionId(e.target.value)} />
              </Field>
            </div>
          )}
        </div>

        {/* ── Chapters + Lessons ── */}
        {chapters.map((chapter, ci) => (
          <div key={ci} className="space-y-3">

            {/* Chapter card */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-[10px] font-bold text-emerald-400">
                    {ci + 1}
                  </div>
                  <h2 className="text-sm font-semibold text-emerald-300">Chapter {ci + 1}</h2>
                </div>
                {chapters.length > 1 && (
                  <button type="button" className="text-xs text-red-400 hover:text-red-300" onClick={() => removeChapter(ci)}>
                    Remove chapter
                  </button>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Chapter title">
                  <input className="input" required placeholder="e.g. Distributed Systems Fundamentals"
                    value={chapter.chapterTitle} onChange={(e) => updateChapter(ci, 'chapterTitle', e.target.value)} />
                </Field>
                <Field label="Chapter summary" hint="Optional — gives lessons shared chapter context.">
                  <input className="input" placeholder="What does this chapter cover?"
                    value={chapter.chapterSummary} onChange={(e) => updateChapter(ci, 'chapterSummary', e.target.value)} />
                </Field>
              </div>
            </div>

            {/* Lessons inside chapter */}
            {chapter.lessons.map((lesson, li) => (
              <div key={li} className="card p-5 space-y-4 ml-5 border-l-2 border-l-emerald-500/20">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--text-faint)] uppercase tracking-widest">
                    Lesson {li + 1}
                  </span>
                  {chapter.lessons.length > 1 && (
                    <button type="button" className="text-xs text-red-400/70 hover:text-red-300" onClick={() => removeLesson(ci, li)}>
                      Remove
                    </button>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Lesson title">
                    <input className="input" required placeholder="e.g. Consistent Hashing — Deep Dive"
                      value={lesson.lessonTitle} onChange={(e) => updateLesson(ci, li, 'lessonTitle', e.target.value)} />
                  </Field>
                  <Field
                    label="Template lesson URL"
                    hint={templateUrl && !lesson.templateLessonUrl
                      ? 'Using course-level template'
                      : 'Optional Educative lesson for style reference'}
                  >
                    <input className="input font-mono text-xs"
                      placeholder={templateUrl && !lesson.templateLessonUrl ? '← using course template' : 'https://www.educative.io/… (optional)'}
                      value={lesson.templateLessonUrl}
                      onChange={(e) => updateLesson(ci, li, 'templateLessonUrl', e.target.value)} />
                  </Field>
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <Field label="Audience">
                    <select className="input" value={lesson.targetAudience}
                      onChange={(e) => updateLesson(ci, li, 'targetAudience', e.target.value)}>
                      <option>Beginner</option>
                      <option>Intermediate</option>
                      <option>Advanced</option>
                    </select>
                  </Field>
                  <Field label="Word count">
                    <input className="input" type="number" min={500} max={8000} step={100}
                      value={lesson.wordsLength}
                      onChange={(e) => updateLesson(ci, li, 'wordsLength', Number(e.target.value))} />
                  </Field>
                  <div className="flex flex-col gap-2.5 pt-5">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="checkbox" className="w-3.5 h-3.5 rounded accent-[var(--accent)]"
                        checked={lesson.runJsEnabled}
                        onChange={(e) => updateLesson(ci, li, 'runJsEnabled', e.target.checked)} />
                      RunJS playground
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="checkbox" className="w-3.5 h-3.5 rounded accent-[var(--accent)]"
                        checked={lesson.aiAssessmentEnabled}
                        onChange={(e) => updateLesson(ci, li, 'aiAssessmentEnabled', e.target.checked)} />
                      AI assessment
                    </label>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Previous lesson title" hint="For narrative flow">
                    <input className="input text-sm" placeholder="Optional"
                      value={lesson.prevLessonTitle} onChange={(e) => updateLesson(ci, li, 'prevLessonTitle', e.target.value)} />
                  </Field>
                  <Field label="Next lesson title" hint="For forward references">
                    <input className="input text-sm" placeholder="Optional"
                      value={lesson.nextLessonTitle} onChange={(e) => updateLesson(ci, li, 'nextLessonTitle', e.target.value)} />
                  </Field>
                </div>

                <Field label="Outline" hint="Optional — paste your outline or leave blank to auto-generate.">
                  <textarea className="input min-h-[72px] font-mono text-xs"
                    value={lesson.outline} onChange={(e) => updateLesson(ci, li, 'outline', e.target.value)} />
                </Field>
              </div>
            ))}

            {/* Add lesson */}
            <button type="button"
              className="ml-5 btn-secondary text-xs py-1.5 px-4 flex items-center gap-1.5"
              onClick={() => addLesson(ci)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
              Add lesson to Chapter {ci + 1}
            </button>
          </div>
        ))}

        {/* ── Add chapter ── */}
        <button type="button"
          className="btn-secondary w-full flex items-center justify-center gap-2 py-3 border-dashed"
          onClick={addChapter}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          Add Chapter {chapters.length + 1}
        </button>

        {/* ── Generate ── */}
        <div className="flex items-center gap-3 pt-2">
          <button disabled={busy} className="btn-primary">
            {busy ? (
              <>
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Starting {totalLessons} lesson{totalLessons !== 1 ? 's' : ''}…
              </>
            ) : (
              <>
                Generate {totalLessons} lesson{totalLessons !== 1 ? 's' : ''}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M13 5l7 7-7 7"/>
                </svg>
              </>
            )}
          </button>
          <span className="text-xs text-[var(--text-faint)]">
            {totalLessons > 1 ? `${totalLessons} lessons run in parallel · ` : ''}3–8 min per lesson
          </span>
        </div>

        {err && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 p-4 text-sm">{err}</div>
        )}
      </form>
    </div>
  );
}
