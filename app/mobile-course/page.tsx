'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type CourseStatus = 'running' | 'draft' | 'published' | 'failed' | 'cancelled';
type ShortStatus  = 'running' | 'draft' | 'published' | 'failed' | 'cancelled';

type CourseSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: CourseStatus;
  title: string;
  collectionId: string;
  chapterCount: number;
  cardCount: number;
  publishedUrl?: string;
};

type ShortSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ShortStatus;
  topic: string;
  domain?: string;
  level?: string;
  cardCount: number;
  collectionId?: string;
  publishedUrl?: string;
};

type Tab = 'courses' | 'shorts';

export default function MobileCourseListPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('courses');
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [shorts, setShorts] = useState<ShortSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const coursePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shortPollRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refreshCourses(showLoader = false) {
    if (showLoader) setLoading(true);
    try { const r = await fetch('/api/mobile-course', { cache: 'no-store' }); setCourses((await r.json()).courses || []); }
    finally { if (showLoader) setLoading(false); }
  }
  async function refreshShorts(showLoader = false) {
    if (showLoader) setLoading(true);
    try { const r = await fetch('/api/mobile-short', { cache: 'no-store' }); setShorts((await r.json()).shorts || []); }
    finally { if (showLoader) setLoading(false); }
  }

  useEffect(() => { refreshCourses(true); refreshShorts(false); }, []);

  useEffect(() => {
    const hasRunning = courses.some((c) => c.status === 'running');
    if (hasRunning && !coursePollRef.current) coursePollRef.current = setInterval(() => refreshCourses(false), 3000);
    else if (!hasRunning && coursePollRef.current) { clearInterval(coursePollRef.current); coursePollRef.current = null; }
    return () => { if (coursePollRef.current) { clearInterval(coursePollRef.current); coursePollRef.current = null; } };
  }, [courses]);

  useEffect(() => {
    const hasRunning = shorts.some((s) => s.status === 'running');
    if (hasRunning && !shortPollRef.current) shortPollRef.current = setInterval(() => refreshShorts(false), 3000);
    else if (!hasRunning && shortPollRef.current) { clearInterval(shortPollRef.current); shortPollRef.current = null; }
    return () => { if (shortPollRef.current) { clearInterval(shortPollRef.current); shortPollRef.current = null; } };
  }, [shorts]);

  async function removeCourse(id: string) {
    if (!confirm('Delete this mobile course? This cannot be undone.')) return;
    await fetch(`/api/mobile-course/${id}`, { method: 'DELETE' });
    refreshCourses(false);
  }
  async function removeShort(id: string) {
    if (!confirm('Delete this mobile short? This cannot be undone.')) return;
    await fetch(`/api/mobile-short/${id}`, { method: 'DELETE' });
    refreshShorts(false);
  }

  const isCourses = tab === 'courses';

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Mobile</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-dim)' }}>
            {isCourses
              ? 'Flash-card courses from any Educative collection or new topic.'
              : 'Bite-sized card sets on any topic. Bulk-create from a Google Sheet.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary text-xs"
            onClick={() => isCourses ? refreshCourses(true) : refreshShorts(true)}
          >
            Refresh
          </button>
          {isCourses ? (
            <button className="btn-primary" onClick={() => router.push('/mobile-course/new')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
              New Course
            </button>
          ) : (
            <button className="btn-primary" onClick={() => router.push('/mobile-short/new')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
              New Short
            </button>
          )}
        </div>
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-1 p-1 rounded-lg w-fit" style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
        {(['courses', 'shorts'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); if (t === 'shorts') refreshShorts(true); }}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize"
            style={tab === t
              ? { background: 'var(--accent)', color: '#fff' }
              : { color: 'var(--text-dim)' }
            }
          >
            {t === 'courses' ? 'Mobile Courses' : 'Mobile Shorts'}
            {t === 'shorts' && shorts.some((s) => s.status === 'running') && (
              <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Courses */}
      {isCourses && (
        loading ? <LoadingRows /> : courses.length === 0 ? (
          <EmptyState label="No mobile courses yet." cta="New Mobile Course" onCta={() => router.push('/mobile-course/new')} />
        ) : (
          <div className="card divide-rows">
            {courses.map((c) => (
              <div key={c.id} className="flex items-start gap-4 px-4 py-3 group hover:bg-[var(--panel-2)] transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/mobile-course/${c.id}`} className="text-sm font-medium hover:underline line-clamp-1" style={{ color: 'var(--text)' }}>
                      {c.title}
                    </Link>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                    <span>{c.chapterCount} chapter{c.chapterCount !== 1 ? 's' : ''}</span>
                    <span>{c.cardCount} cards</span>
                    <span className="font-mono">{c.collectionId}</span>
                    {c.publishedUrl && (
                      <a href={c.publishedUrl} target="_blank" rel="noreferrer" className="underline truncate max-w-[200px]" style={{ color: 'var(--success)' }}>
                        {c.publishedUrl}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link href={`/mobile-course/${c.id}`} className="btn-secondary py-1 px-2.5 text-xs">Open</Link>
                  <button className="btn-secondary py-1 px-2.5 text-xs" style={{ color: 'var(--danger)' }} onClick={() => removeCourse(c.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Shorts */}
      {!isCourses && (
        loading ? <LoadingRows /> : shorts.length === 0 ? (
          <EmptyState label="No mobile shorts yet." cta="New Mobile Short" onCta={() => router.push('/mobile-short/new')} />
        ) : (
          <div className="card divide-rows">
            {shorts.map((s) => (
              <div key={s.id} className="flex items-start gap-4 px-4 py-3 group hover:bg-[var(--panel-2)] transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/mobile-short/${s.id}`} className="text-sm font-medium hover:underline line-clamp-1" style={{ color: 'var(--text)' }}>
                      {s.topic}
                    </Link>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                    <span>{s.cardCount} card{s.cardCount !== 1 ? 's' : ''}</span>
                    {s.level && <span>{s.level}</span>}
                    {s.domain && <span>{s.domain}</span>}
                    {s.publishedUrl && (
                      <a href={s.publishedUrl} target="_blank" rel="noreferrer" className="underline truncate max-w-[200px]" style={{ color: 'var(--success)' }}>
                        {s.publishedUrl}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link href={`/mobile-short/${s.id}`} className="btn-secondary py-1 px-2.5 text-xs">Open</Link>
                  <button className="btn-secondary py-1 px-2.5 text-xs" style={{ color: 'var(--danger)' }} onClick={() => removeShort(s.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: CourseStatus | ShortStatus }) {
  if (status === 'running')   return <span className="pill pill-running"><span className="h-1.5 w-1.5 rounded-full bg-amber-400 dot-running" />running</span>;
  if (status === 'published') return <span className="pill pill-success">published</span>;
  if (status === 'failed')    return <span className="pill pill-error">failed</span>;
  if (status === 'cancelled') return <span className="pill pill-error">cancelled</span>;
  return <span className="pill">draft</span>;
}

function LoadingRows() {
  return (
    <div className="card divide-rows">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex gap-3 animate-pulse">
          <div className="flex-1 space-y-2">
            <div className="h-4 rounded w-2/3" style={{ background: 'var(--panel-2)' }} />
            <div className="h-3 rounded w-1/3" style={{ background: 'var(--panel-2)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ label, cta, onCta }: { label: string; cta: string; onCta: () => void }) {
  return (
    <div className="card px-6 py-10 text-center">
      <p className="text-sm mb-3" style={{ color: 'var(--text-dim)' }}>{label}</p>
      <button className="btn-primary" onClick={onCta}>{cta}</button>
    </div>
  );
}
