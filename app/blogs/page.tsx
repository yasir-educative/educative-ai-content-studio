'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

type Status = 'running' | 'draft' | 'published' | 'failed' | 'cancelled';
type BlogSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: Status;
  runType?: string;
  live?: boolean;
  blogTitle: string;
  finalTitle?: string;
  persona: string;
  vertical: string;
  audience: string;
  publishedUrl?: string;
};

export default function HistoryPage() {
  const router = useRouter();
  const [blogs, setBlogs] = useState<BlogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'all' | Status>('all');
  const [filterPersona, setFilterPersona] = useState<string>('all');
  const [query, setQuery] = useState('');

  async function refresh(showLoader = false) {
    if (showLoader) setLoading(true);
    try {
      const res = await fetch('/api/history', { cache: 'no-store' });
      const json = await res.json();
      setBlogs(json.blogs || []);
    } finally {
      if (showLoader) setLoading(false);
    }
  }
  useEffect(() => { refresh(true); }, []);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const hasRunning = blogs.some((b) => b.status === 'running');
    if (hasRunning && !pollRef.current) {
      pollRef.current = setInterval(() => refresh(false), 3000);
    } else if (!hasRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [blogs]);

  async function remove(id: string, status: Status, live?: boolean) {
    const isRunning = status === 'running' && live;
    if (isRunning) {
      if (!confirm('This run is still in progress. Stop it and delete the record?')) return;
      await fetch(`/api/blog/${id}/cancel`, { method: 'POST' });
    } else {
      if (!confirm('Delete this blog from history? This cannot be undone.')) return;
    }
    await fetch(`/api/history/${id}`, { method: 'DELETE' });
    refresh(false);
  }

  async function stop(id: string) {
    if (!confirm('Stop this in-progress generation?')) return;
    await fetch(`/api/blog/${id}/cancel`, { method: 'POST' });
    refresh(false);
  }

  const personas = useMemo(() => {
    const set = new Set<string>();
    blogs.forEach((b) => b.persona && set.add(b.persona));
    return ['all', ...Array.from(set).sort()];
  }, [blogs]);

  const filtered = useMemo(() => {
    return blogs.filter((b) => {
      if (b.runType && b.runType !== 'blog') return false;
      if (filterStatus !== 'all' && b.status !== filterStatus) return false;
      if (filterPersona !== 'all' && b.persona !== filterPersona) return false;
      if (query) {
        const q = query.toLowerCase();
        const t = (b.finalTitle || b.blogTitle || '').toLowerCase();
        if (!t.includes(q)) return false;
      }
      return true;
    });
  }, [blogs, filterStatus, filterPersona, query]);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Blogs</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-dim)' }}>
            Every pipeline run is saved with full stage outputs. Click any entry to inspect or re-publish.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs" onClick={() => router.push('/outline')}>
            Outline Generator
          </button>
          <button className="btn-primary" onClick={() => router.push('/blog')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            New Blog
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 min-w-[180px] h-9 py-0 text-xs"
          placeholder="Search by title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="input w-[160px] h-9 py-0 text-xs" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}>
          <option value="all">All statuses</option>
          <option value="running">In progress</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className="input w-[180px] h-9 py-0 text-xs" value={filterPersona} onChange={(e) => setFilterPersona(e.target.value)}>
          {personas.map((p) => (
            <option key={p} value={p}>{p === 'all' ? 'All personas' : p}</option>
          ))}
        </select>
        <button className="btn-secondary h-9 px-3 text-xs" onClick={() => refresh(true)}>Refresh</button>
      </div>

      {/* List */}
      {loading ? (
        <LoadingRows />
      ) : filtered.length === 0 ? (
        <EmptyState hasItems={blogs.length > 0} onCreate={() => router.push('/blog')} />
      ) : (
        <div className="card divide-rows">
          {filtered.map((b) => (
            <BlogRow key={b.id} blog={b} onStop={stop} onRemove={remove} />
          ))}
        </div>
      )}
    </div>
  );
}

function BlogRow({
  blog: b,
  onStop,
  onRemove,
}: {
  blog: BlogSummary;
  onStop: (id: string) => void;
  onRemove: (id: string, status: Status, live?: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-4 px-4 py-3 group hover:bg-[var(--panel-2)] transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/blogs/${b.id}`}
            className="text-sm font-medium hover:underline leading-snug line-clamp-1"
            style={{ color: 'var(--text)' }}
          >
            {b.finalTitle || b.blogTitle || '(untitled)'}
          </Link>
          <StatusBadge status={b.status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          <span>{new Date(b.createdAt).toLocaleDateString()}</span>
          {b.vertical && <span>{b.vertical}</span>}
          {b.audience && <span>{b.audience}</span>}
          {b.persona && <span>{b.persona}</span>}
          {b.publishedUrl && (
            <a
              href={b.publishedUrl}
              target="_blank"
              rel="noreferrer"
              className="underline truncate max-w-[200px]"
              style={{ color: 'var(--success)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {b.publishedUrl}
            </a>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Link href={`/blogs/${b.id}`} className="btn-secondary py-1 px-2.5 text-xs">Open</Link>
        {b.status === 'running' && b.live && (
          <button className="btn-secondary py-1 px-2.5 text-xs" onClick={() => onStop(b.id)}>Stop</button>
        )}
        <button
          className="btn-secondary py-1 px-2.5 text-xs"
          style={{ color: 'var(--danger)' }}
          onClick={() => onRemove(b.id, b.status, b.live)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === 'running') return (
    <span className="pill pill-running">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 dot-running" />
      running
    </span>
  );
  if (status === 'published') return <span className="pill pill-success">published</span>;
  if (status === 'failed')    return <span className="pill pill-error">failed</span>;
  if (status === 'cancelled') return <span className="pill pill-error">cancelled</span>;
  return <span className="pill">draft</span>;
}

function LoadingRows() {
  return (
    <div className="card divide-rows">
      {Array.from({ length: 5 }).map((_, i) => (
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

function EmptyState({ hasItems, onCreate }: { hasItems: boolean; onCreate: () => void }) {
  return (
    <div className="card px-6 py-10 text-center">
      <p className="text-sm mb-3" style={{ color: 'var(--text-dim)' }}>
        {hasItems ? 'No blogs match the current filters.' : 'No blogs yet. Generate one and it will appear here automatically.'}
      </p>
      {!hasItems && (
        <button className="btn-primary" onClick={onCreate}>Create your first blog</button>
      )}
    </div>
  );
}
