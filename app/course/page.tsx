'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useMemo } from 'react';

type Status = 'running' | 'draft' | 'published' | 'failed' | 'cancelled';

type LessonSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: Status;
  runType?: string;
  live?: boolean;
  blogTitle: string;
  finalTitle?: string;
  vertical: string;
  audience: string;
  publishedUrl?: string;
  chapterTitle?: string;
  courseTitle?: string;
};

type CourseGroup = {
  courseTitle: string;
  lessons: LessonSummary[];
  chapters: Set<string>;
  statuses: Status[];
  latestAt: string;
};

function groupByCourse(lessons: LessonSummary[]): CourseGroup[] {
  const map = new Map<string, CourseGroup>();
  for (const l of lessons) {
    const key = l.courseTitle || 'Untitled Course';
    if (!map.has(key)) {
      map.set(key, { courseTitle: key, lessons: [], chapters: new Set(), statuses: [], latestAt: l.createdAt });
    }
    const g = map.get(key)!;
    g.lessons.push(l);
    if (l.chapterTitle) g.chapters.add(l.chapterTitle);
    g.statuses.push(l.status);
    if (l.createdAt > g.latestAt) g.latestAt = l.createdAt;
  }
  return Array.from(map.values()).sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

function courseSlug(title: string) {
  return encodeURIComponent(title);
}

function CourseStatusSummary({ statuses }: { statuses: Status[] }) {
  const running = statuses.filter((s) => s === 'running').length;
  const published = statuses.filter((s) => s === 'published').length;
  const failed = statuses.filter((s) => s === 'failed').length;
  const draft = statuses.filter((s) => s === 'draft').length;
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {running > 0 && (
        <span className="pill pill-running inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 dot-running" />
          {running} running
        </span>
      )}
      {published > 0 && <span className="pill pill-success">{published} published</span>}
      {draft > 0 && <span className="pill">{draft} draft</span>}
      {failed > 0 && <span className="pill pill-error">{failed} failed</span>}
    </div>
  );
}

export default function CourseListPage() {
  const router = useRouter();
  const [items, setItems] = useState<LessonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [deletingCourse, setDeletingCourse] = useState<string | null>(null);

  async function refresh(showLoader = false) {
    if (showLoader) setLoading(true);
    try {
      const res = await fetch('/api/history', { cache: 'no-store' });
      const json = await res.json();
      const courses = (json.blogs || []).filter((b: LessonSummary) => b.runType === 'course');
      setItems(courses);
    } finally {
      if (showLoader) setLoading(false);
    }
  }

  useEffect(() => { refresh(true); }, []);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const hasRunning = items.some((b) => b.status === 'running');
    if (hasRunning && !pollRef.current) {
      pollRef.current = setInterval(() => refresh(false), 3000);
    } else if (!hasRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [items]);

  async function deleteCourse(courseTitle: string, lessonIds: string[], e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete all ${lessonIds.length} lessons for "${courseTitle}"?`)) return;
    setDeletingCourse(courseTitle);
    try {
      await Promise.all(lessonIds.map((id) => fetch(`/api/history/${id}`, { method: 'DELETE' })));
      setItems((prev) => prev.filter((l) => (l.courseTitle || 'Untitled Course') !== courseTitle));
    } finally {
      setDeletingCourse(null);
    }
  }

  const courses = useMemo(() => {
    const groups = groupByCourse(items);
    if (!query.trim()) return groups;
    const q = query.toLowerCase();
    return groups.filter((g) =>
      g.courseTitle.toLowerCase().includes(q) ||
      g.lessons.some((l) => (l.finalTitle || l.blogTitle).toLowerCase().includes(q))
    );
  }, [items, query]);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <span className="pill mb-3">Course</span>
          <h1 className="text-3xl font-bold tracking-tight">
            Your <span className="brand-gradient">courses</span>
          </h1>
          <p className="mt-2 text-[var(--text-dim)] max-w-2xl text-sm">
            Courses are grouped by title. Click a course to browse its chapters and lessons.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button className="btn-primary" onClick={() => router.push('/course/new')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            Generate Course/Lesson
          </button>
        </div>
      </div>

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="Search by course or lesson title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn-secondary" onClick={() => refresh(true)}>Refresh</button>
      </div>

      {loading ? (
        <div className="card p-6 text-sm text-[var(--text-faint)]">Loading…</div>
      ) : courses.length === 0 ? (
        <div className="card p-6 text-sm text-[var(--text-faint)]">
          {items.length === 0
            ? 'No course lessons yet. Hit "Generate Course/Lesson" to create your first one.'
            : 'No courses match the current search.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {courses.map((course) => {
            const ids = course.lessons.map((l) => l.id);
            const isDeleting = deletingCourse === course.courseTitle;
            return (
              <div key={course.courseTitle} className="card p-5 flex flex-col gap-3 hover:border-[var(--accent)] transition-colors group relative">
                <Link href={`/course/view/${courseSlug(course.courseTitle)}`} className="flex items-start gap-3 cursor-pointer">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-[var(--text)] group-hover:text-emerald-300 transition-colors leading-snug line-clamp-2">
                      {course.courseTitle}
                    </h2>
                    <p className="text-xs text-[var(--text-faint)] mt-1">
                      {course.chapters.size > 0 ? `${course.chapters.size} chapter${course.chapters.size !== 1 ? 's' : ''} · ` : ''}
                      {course.lessons.length} lesson{course.lessons.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </Link>

                <CourseStatusSummary statuses={course.statuses} />

                <div className="flex items-center justify-between text-xs text-[var(--text-faint)] mt-auto pt-1 border-t border-[var(--border)]">
                  <span>{new Date(course.latestAt).toLocaleDateString()}</span>
                  <div className="flex items-center gap-3">
                    <button
                      className="text-red-400/60 hover:text-red-400 transition-colors disabled:opacity-50"
                      onClick={(e) => deleteCourse(course.courseTitle, ids, e)}
                      disabled={isDeleting}
                      title="Delete course"
                    >
                      {isDeleting ? 'Deleting…' : 'Delete'}
                    </button>
                    <Link href={`/course/view/${courseSlug(course.courseTitle)}`} className="text-emerald-400 group-hover:underline">
                      View →
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
