'use client';

import Link from 'next/link';

// Quick-create cards
const TOOLS = [
  {
    href: '/blog',
    listHref: '/blogs',
    label: 'Blog',
    description: 'Research → draft → SEO → widgets → publish',
    accent: '#5865f5',
    accentBg: 'rgba(88,101,245,0.08)',
    accentBorder: 'rgba(88,101,245,0.2)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
  },
  {
    href: '/newsletter/new',
    listHref: '/newsletter',
    label: 'Newsletter',
    description: 'Research → draft → polished issue',
    accent: '#7c6df4',
    accentBg: 'rgba(124,109,244,0.08)',
    accentBorder: 'rgba(124,109,244,0.2)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2"/>
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
      </svg>
    ),
  },
  {
    href: '/course/new',
    listHref: '/course',
    label: 'Course Lesson',
    description: 'Multi-chapter content with quizzes, code, and publish',
    accent: '#22c55e',
    accentBg: 'rgba(34,197,94,0.08)',
    accentBorder: 'rgba(34,197,94,0.2)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
    ),
  },
  {
    href: '/mobile-course/new',
    listHref: '/mobile-course',
    label: 'Mobile Course',
    description: 'Architect or convert a course into flash-card lessons',
    accent: '#f59e0b',
    accentBg: 'rgba(245,158,11,0.08)',
    accentBorder: 'rgba(245,158,11,0.2)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2"/>
        <path d="M12 18h.01"/>
      </svg>
    ),
  },
  {
    href: '/mobile-short/new',
    listHref: '/mobile-course?tab=shorts',
    label: 'Mobile Short',
    description: 'Topic-based bite-sized card sets, bulk-create from Sheets',
    accent: '#ef4444',
    accentBg: 'rgba(239,68,68,0.08)',
    accentBorder: 'rgba(239,68,68,0.2)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    ),
  },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Define your content',
    body: 'Choose a format, set your topic, audience, and optional outline. For mobile courses, start from an existing Educative collection or let AI architect a new one.',
  },
  {
    step: '02',
    title: 'Pipeline runs live',
    body: 'Web research, AI writing, persona voice, images, code widgets, and quizzes stream in real time. Mobile course chapters run in parallel.',
  },
  {
    step: '03',
    title: 'Review and publish',
    body: 'Inspect each stage output, edit cards or content inline, then push to Educative with one click — new collection created automatically.',
  },
];

export default function Home() {
  return (
    <div className="space-y-12 pb-8">

      {/* ── Page header ── */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
          Content Studio
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-dim)' }}>
          Multi-stage AI pipeline for Educative blogs, newsletters, courses, and mobile content.
        </p>
      </div>

      {/* ── Quick create ── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--text-faint)' }}>
          Create new
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TOOLS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="card p-5 flex gap-4 items-start group transition-colors hover:border-[var(--accent)]"
              style={{ borderColor: 'var(--border)' }}
            >
              <span
                className="shrink-0 h-9 w-9 rounded-lg flex items-center justify-center transition-colors"
                style={{ color: t.accent, background: t.accentBg, border: `1px solid ${t.accentBorder}` }}
              >
                {t.icon}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text)' }}>{t.label}</div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>{t.description}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--text-faint)' }}>
          How it works
        </h2>
        <div className="grid md:grid-cols-3 gap-3">
          {HOW_IT_WORKS.map((s) => (
            <div key={s.step} className="card p-5">
              <div className="text-xs font-bold mb-2" style={{ color: 'var(--accent)' }}>
                Step {s.step}
              </div>
              <div className="text-sm font-semibold mb-1.5" style={{ color: 'var(--text)' }}>{s.title}</div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Quick links row ── */}
      <section className="card p-4 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium mr-1" style={{ color: 'var(--text-faint)' }}>Browse:</span>
        {[
          { href: '/blogs',         label: 'Blog history' },
          { href: '/newsletter',    label: 'Newsletters' },
          { href: '/course',        label: 'Course lessons' },
          { href: '/mobile-course', label: 'Mobile courses' },
          { href: '/outline',       label: 'Outline generator' },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="btn-secondary py-1 px-3 text-xs">
            {l.label}
          </Link>
        ))}
      </section>

    </div>
  );
}
