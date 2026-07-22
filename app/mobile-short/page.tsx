'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type ShortStatus = 'running' | 'draft' | 'published' | 'failed' | 'cancelled';
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

export default function MobileShortListPage() {
  const router = useRouter();
  const [shorts, setShorts] = useState<ShortSummary[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh(showLoader = false) {
    if (showLoader) setLoading(true);
    try {
      const res = await fetch('/api/mobile-short', { cache: 'no-store' });
      const json = await res.json();
      setShorts(json.shorts || []);
    } finally {
      if (showLoader) setLoading(false);
    }
  }
  useEffect(() => { refresh(true); }, []);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const hasRunning = shorts.some((s) => s.status === 'running');
    if (hasRunning && !pollRef.current) {
      pollRef.current = setInterval(() => refresh(false), 3000);
    } else if (!hasRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [shorts]);

  async function remove(id: string) {
    if (!confirm('Delete this mobile short? This cannot be undone.')) return;
    await fetch(`/api/mobile-short/${id}`, { method: 'DELETE' });
    refresh(false);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <span className="pill mb-3">Mobile Short</span>
          <h1 className="text-3xl font-bold tracking-tight">
            Mobile <span className="brand-gradient">shorts</span>
          </h1>
          <p className="mt-2 text-[var(--text-dim)] max-w-2xl text-sm">
            Generate topic-based mobile flash cards through a 3-stage AI pipeline. Each short contains
            up to 5 focused cards with AI-generated illustrations.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button className="btn-primary" onClick={() => router.push('/mobile-short/new')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            New Mobile Short
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-secondary" onClick={() => refresh(true)}>Refresh</button>
      </div>

      {loading ? (
        <div className="card p-6 text-sm text-[var(--text-faint)]">Loading…</div>
      ) : shorts.length === 0 ? (
        <div className="card p-6 text-sm text-[var(--text-faint)]">
          No mobile shorts yet. Click "New Mobile Short" to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {shorts.map((s) => (
            <div key={s.id} className="card p-5 flex flex-col gap-3 hover:border-[var(--accent)] transition-colors">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/mobile-short/${s.id}`} className="font-medium text-[var(--text)] hover:underline leading-snug line-clamp-2 flex-1">
                  {s.topic}
                </Link>
                <StatusPill status={s.status} />
              </div>
              <div className="text-xs text-[var(--text-faint)] flex flex-wrap gap-x-3 gap-y-1">
                <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                <span className="pill py-0.5">{s.cardCount} card{s.cardCount !== 1 ? 's' : ''}</span>
                {s.level && <span className="pill py-0.5">{s.level}</span>}
              </div>
              {s.domain && (
                <div className="text-xs text-[var(--text-faint)]">
                  Domain: <span className="text-[var(--text-dim)]">{s.domain}</span>
                </div>
              )}
              {s.collectionId && (
                <div className="text-xs text-[var(--text-faint)]">
                  Collection: <span className="font-mono">{s.collectionId}</span>
                </div>
              )}
              {s.publishedUrl && (
                <a className="text-xs text-emerald-300 underline truncate" href={s.publishedUrl} target="_blank" rel="noreferrer">
                  {s.publishedUrl}
                </a>
              )}
              <div className="flex items-center gap-2 mt-auto pt-1">
                <Link href={`/mobile-short/${s.id}`} className="btn-secondary text-xs py-1 px-3">Open</Link>
                <button className="btn-secondary text-xs py-1 px-3 ml-auto" onClick={() => remove(s.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: ShortStatus }) {
  if (status === 'running') {
    return (
      <span className="pill pill-running inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-amber-400 dot-running shadow-[0_0_8px_rgba(245,158,11,0.7)]" />
        in progress
      </span>
    );
  }
  if (status === 'published') return <span className="pill pill-success">published</span>;
  if (status === 'failed') return <span className="pill pill-error">failed</span>;
  if (status === 'cancelled') return <span className="pill pill-error">cancelled</span>;
  return <span className="pill">draft</span>;
}
