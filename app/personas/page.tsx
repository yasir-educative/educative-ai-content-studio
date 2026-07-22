'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Persona = {
  slug: string;
  name: string;
  body: string;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
};

export default function PersonasPage() {
  const [items, setItems] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBody, setNewBody] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/personas');
      const json = await res.json();
      setItems(json.personas || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function create() {
    setErr(null);
    if (!newName.trim()) {
      setErr('Name is required');
      return;
    }
    try {
      const res = await fetch('/api/personas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName, body: newBody }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'create failed');
      setCreating(false);
      setNewName('');
      setNewBody('');
      await refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  async function remove(slug: string, name: string) {
    if (!confirm(`Delete persona "${name}"? This cannot be undone.`)) return;
    await fetch(`/api/personas/${slug}`, { method: 'DELETE' });
    refresh();
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Personas</h1>
          <p className="text-sm text-[var(--text-faint)] mt-1">
            Voice prompts shown in the blog generator. Built-ins can be edited and reset; custom
            personas can be added and deleted. Changes take effect on the next pipeline run.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh} className="btn">Refresh</button>
          <button onClick={() => setCreating((v) => !v)} className="btn btn-primary">
            {creating ? 'Cancel' : 'New persona'}
          </button>
        </div>
      </div>

      {creating && (
        <div className="card p-4 space-y-3">
          <div>
            <label className="text-xs font-semibold block mb-1">Display name</label>
            <input
              className="input w-full"
              placeholder="e.g. Backend Bao 2"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1">Voice prompt</label>
            <textarea
              className="input w-full min-h-[200px] font-mono text-sm"
              placeholder="You are …\nVoice and style: …\nTone: …"
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
            />
          </div>
          {err && <div className="text-sm text-red-400">{err}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="btn">Cancel</button>
            <button onClick={create} className="btn btn-primary">Create</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-6 text-sm text-[var(--text-faint)]">Loading…</div>
      ) : (
        <div className="card divide-y divide-[var(--border)]">
          {items.map((p) => (
            <div key={p.slug} className="flex items-center gap-4 px-4 py-3">
              <Link href={`/personas/${p.slug}`} className="flex-1 min-w-0 hover:underline">
                <div className="font-medium text-sm">{p.name}</div>
                <div className="text-xs text-[var(--text-faint)] mt-0.5 truncate">
                  {p.body ? p.body.split('\n')[0].slice(0, 120) : '(empty)'}
                </div>
              </Link>
              <span className={`pill ${p.builtin ? '' : 'pill-success'}`}>
                {p.builtin ? 'built-in' : 'custom'}
              </span>
              <div className="text-xs text-[var(--text-faint)] w-44 text-right">
                {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : 'default'}
              </div>
              {!p.builtin && (
                <button
                  onClick={() => remove(p.slug, p.name)}
                  className="text-xs text-red-400 hover:underline"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <div className="px-4 py-6 text-sm text-[var(--text-faint)]">No personas yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
