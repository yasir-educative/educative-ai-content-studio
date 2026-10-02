'use client';

// Live configuration summary for the home page.
//
// Reads the same endpoints the pipelines read, so what it shows is what a run will actually use
// — not a hardcoded description that can drift out of date.

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface ModelsResponse {
  config: { mainModel: string; normalModel: string };
  searchModel: string;
  models?: string[];
}
interface Channel { id: string; name: string; type: 'educative' | 'wordpress' | 'devto' | 'substack' }

const TYPE_DOT: Record<Channel['type'], string> = {
  educative: '#6366f1',
  wordpress: '#21759b',
  devto: '#a78bfa',
  substack: '#ff6719',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="w-24 shrink-0" style={{ color: 'var(--text-faint)' }}>{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function Mono({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <code className="font-mono text-[11px]" style={{ color: muted ? 'var(--text-faint)' : 'var(--text)' }}>
      {children}
    </code>
  );
}

export function ConfigPanel() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/models').then((r) => r.json()),
      fetch('/api/channels').then((r) => r.json()),
    ])
      .then(([m, c]) => { setModels(m); setChannels(c.channels || []); })
      .catch((e) => setErr(e?.message || String(e)));
  }, []);

  /** A stored model the key no longer offers would fail at run time — say so here, not later. */
  const unknown = (m?: string) => !!m && !!models?.models?.length && !models.models.includes(m);

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>
          Configuration
        </h2>
        <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
          applies to every pipeline · changes take effect on the next run
        </span>
      </div>

      {err && <div className="card p-4 text-xs" style={{ color: 'var(--danger-text)' }}>{err}</div>}

      <div className="grid gap-3 md:grid-cols-2">
        {/* ── Models ── */}
        <Link href="/models" className="card p-5 block transition-colors hover:border-[var(--accent)]" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Models</span>
            <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Configure →</span>
          </div>
          {!models ? (
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>Loading…</div>
          ) : (
            <div className="space-y-1.5">
              <Row label="Main">
                <Mono>{models.config.mainModel}</Mono>
                {unknown(models.config.mainModel) && <span className="ml-2 text-[11px]" style={{ color: 'var(--warning-text)' }}>⚠ unavailable</span>}
                <span className="ml-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>outlines + text generators</span>
              </Row>
              <Row label="Normal">
                <Mono>{models.config.normalModel}</Mono>
                {unknown(models.config.normalModel) && <span className="ml-2 text-[11px]" style={{ color: 'var(--warning-text)' }}>⚠ unavailable</span>}
                <span className="ml-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>reviewers + widgets</span>
              </Row>
              <Row label="Search">
                <Mono muted>{models.searchModel}</Mono>
                <span className="ml-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>from .env</span>
              </Row>
            </div>
          )}
        </Link>

        {/* ── Publishing channels ── */}
        <Link href="/channels" className="card p-5 block transition-colors hover:border-[var(--accent)]" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Publishing channels</span>
            <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Configure →</span>
          </div>
          {!channels ? (
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>Loading…</div>
          ) : channels.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>None configured yet.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {channels.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
                  style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: TYPE_DOT[c.type] }} />
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </Link>

        {/* ── Prompts and personas: no nav entry of their own ── */}
        <Link href="/prompts" className="card p-5 block transition-colors hover:border-[var(--accent)]" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Prompts</span>
            <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Edit →</span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>
            Every stage prompt, editable per pipeline. An edit overrides the built-in version until reset.
          </p>
        </Link>

        <Link href="/personas" className="card p-5 block transition-colors hover:border-[var(--accent)]" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Personas</span>
            <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Edit →</span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>
            The voices available to the blog generator. Built-ins can be edited and reset; your own can be deleted.
          </p>
        </Link>
      </div>
    </section>
  );
}
