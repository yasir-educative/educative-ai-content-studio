'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

type Status = 'running' | 'draft' | 'published' | 'failed' | 'cancelled';
type NewsletterSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: Status;
  runType?: 'blog' | 'newsletter';
  live?: boolean;
  blogTitle: string;
  finalTitle?: string;
  vertical: string;
  audience: string;
  publishedUrl?: string;
};

export default function NewsletterListPage() {
  const router = useRouter();
  const [items, setItems] = useState<NewsletterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'all' | Status>('all');
  const [query, setQuery] = useState('');

  async function refresh(showLoader = false) {
    if (showLoader) setLoading(true);
    try {
      const res = await fetch('/api/history', { cache: 'no-store' });
      const json = await res.json();
      const newsletters = (json.blogs || []).filter((b: NewsletterSummary) => b.runType === 'newsletter');
      setItems(newsletters);
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

  async function remove(id: string, status: Status, live?: boolean) {
    const isRunning = status === 'running' && live;
    if (isRunning) {
      if (!confirm('This run is still in progress. Stop it and delete the record?')) return;
      await fetch(`/api/blog/${id}/cancel`, { method: 'POST' });
    } else {
      if (!confirm('Delete this newsletter? This cannot be undone.')) return;
    }
    await fetch(`/api/history/${id}`, { method: 'DELETE' });
    refresh(false);
  }

  async function stop(id: string) {
    if (!confirm('Stop this in-progress generation?')) return;
    await fetch(`/api/blog/${id}/cancel`, { method: 'POST' });
    refresh(false);
  }

  const filtered = useMemo(() => {
    return items.filter((b) => {
      if (filterStatus !== 'all' && b.status !== filterStatus) return false;
      if (query) {
        const q = query.toLowerCase();
        const t = (b.finalTitle || b.blogTitle || '').toLowerCase();
        if (!t.includes(q)) return false;
      }
      return true;
    });
  }, [items, filterStatus, query]);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <span className="pill mb-3">Newsletter</span>
          <h1 className="text-3xl font-bold tracking-tight">
            Your <span className="brand-gradient">newsletters</span>
          </h1>
          <p className="mt-2 text-[var(--text-dim)] max-w-2xl text-sm">
            Every newsletter run is auto-saved with its full stage outputs and logs. Click into any
            run to inspect it or re-publish.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button className="btn-primary" onClick={() => router.push('/newsletter/new')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            Generate Newsletter
          </button>
        </div>
      </div>

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="Search by title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="input max-w-[180px]" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}>
          <option value="all">All statuses</option>
          <option value="running">In progress</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button className="btn-secondary" onClick={() => refresh(true)}>Refresh</button>
      </div>

      {loading ? (
        <div className="card p-6 text-sm text-[var(--text-faint)]">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-6 text-sm text-[var(--text-faint)]">
          {items.length === 0
            ? 'No newsletters yet. Hit "Generate Newsletter" to create your first one.'
            : 'No newsletters match the current filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((b) => (
            <div key={b.id} className="card p-5 flex flex-col gap-3 hover:border-[var(--accent)] transition-colors">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/newsletter/${b.id}`} className="font-medium text-[var(--text)] hover:underline leading-snug line-clamp-2 flex-1">
                  {b.finalTitle || b.blogTitle || '(untitled)'}
                </Link>
                <StatusPill status={b.status} />
              </div>
              <div className="text-xs text-[var(--text-faint)] flex flex-wrap gap-x-3 gap-y-1">
                <span>{new Date(b.createdAt).toLocaleDateString()}</span>
                {b.vertical && <span className="pill py-0.5">{b.vertical}</span>}
                {b.audience && <span>{b.audience}</span>}
              </div>
              {b.publishedUrl && (
                <a className="text-xs text-emerald-300 underline truncate" href={b.publishedUrl} target="_blank" rel="noreferrer">
                  {b.publishedUrl}
                </a>
              )}
              <div className="flex items-center gap-2 mt-auto pt-1">
                <Link href={`/newsletter/${b.id}`} className="btn-secondary text-xs py-1 px-3">Open</Link>
                {b.status === 'running' && b.live && (
                  <button className="btn-secondary text-xs py-1 px-3" onClick={() => stop(b.id)}>Stop</button>
                )}
                <button className="btn-secondary text-xs py-1 px-3 ml-auto" onClick={() => remove(b.id, b.status, b.live)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
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
