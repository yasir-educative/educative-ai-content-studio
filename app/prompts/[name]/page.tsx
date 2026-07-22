'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type StoredPrompt = {
  name: string;
  version: number;
  body: string;
  default: string;
  variables: string[];
  updatedAt: string;
  history: { version: number; body: string; updatedAt: string }[];
  editable: boolean;
};

export default function PromptEditorPage({ params }: { params: { name: string } }) {
  const [data, setData] = useState<StoredPrompt | null>(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showDefault, setShowDefault] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/prompts/${params.name}`);
      if (!res.ok) {
        setErr('Prompt not found');
        return;
      }
      const json = (await res.json()) as StoredPrompt;
      setData(json);
      setBody(json.body);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [params.name]);

  async function save() {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(`/api/prompts/${params.name}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'save failed');
      setData(json);
      setBody(json.body);
      setMsg(json.history.length === 0
        ? `Saved as v${json.version} — edit and save again to start version history`
        : `Saved as v${json.version}`);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!confirm('Reset to default? This deletes the saved override.')) return;
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(`/api/prompts/${params.name}`, { method: 'DELETE' });
      const json = await res.json();
      setData(json);
      setBody(json.body);
      setMsg('Reset to default');
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function rollback(version: number) {
    if (!confirm(`Roll back to v${version}?`)) return;
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(`/api/prompts/${params.name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'rollback failed');
      setData(json);
      setBody(json.body);
      setMsg(`Rolled back to v${version} (now v${json.version})`);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="max-w-5xl mx-auto p-6 text-sm text-[var(--text-faint)]">Loading…</div>;
  if (err && !data) return <div className="max-w-5xl mx-auto p-6 text-sm text-red-400">{err}</div>;
  if (!data) return null;

  const dirty = body !== data.body;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href="/prompts" className="text-xs text-[var(--text-faint)] hover:underline">← All prompts</Link>
          <h1 className="text-2xl font-semibold font-mono">{data.name}</h1>
          <div className="text-xs text-[var(--text-faint)] mt-1">
            v{data.version}{data.updatedAt ? ` · saved ${new Date(data.updatedAt).toLocaleString()}` : ' · using default'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reset} disabled={saving || data.version === 0} className="btn">Reset to default</button>
          <button onClick={save} disabled={saving || !dirty} className="btn btn-primary">
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {msg && <div className="card p-3 text-sm text-emerald-400">{msg}</div>}
      {err && <div className="card p-3 text-sm text-red-400">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-4">
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            className="w-full min-h-[480px] font-mono text-sm p-3 rounded-lg border border-[var(--border)] bg-[var(--panel)]"
          />
          <div className="text-xs text-[var(--text-faint)]">
            Use <code className="font-mono">{'{{var}}'}</code> for substitutions. Pipeline supplies these at call time.
          </div>
          <button
            onClick={() => setShowDefault((v) => !v)}
            className="text-xs text-[var(--text-faint)] hover:underline"
          >
            {showDefault ? 'Hide' : 'Show'} default body
          </button>
          {showDefault && (
            <pre className="card p-3 text-xs whitespace-pre-wrap break-words max-h-[320px] overflow-auto">
              {data.default}
            </pre>
          )}
        </div>

        <aside className="space-y-3">
          <div className="card p-3">
            <div className="text-xs font-semibold mb-2">Variables</div>
            {data.variables.length === 0 ? (
              <div className="text-xs text-[var(--text-faint)]">none</div>
            ) : (
              <ul className="space-y-1">
                {data.variables.map((v) => (
                  <li key={v} className="text-xs font-mono">{`{{${v}}}`}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-3">
            <div className="text-xs font-semibold mb-2">History</div>
            {data.history.length === 0 ? (
              <div className="text-xs text-[var(--text-faint)]">
                {data.version > 0
                  ? 'Edit and save again to start version history'
                  : 'No prior versions'}
              </div>
            ) : (
              <ul className="space-y-1">
                {[...data.history].reverse().map((h) => (
                  <li key={h.version} className="flex items-center justify-between gap-2">
                    <span className="text-xs">
                      v{h.version}
                      <span className="text-[var(--text-faint)] ml-1">{new Date(h.updatedAt).toLocaleDateString()}</span>
                    </span>
                    <button
                      onClick={() => rollback(h.version)}
                      disabled={saving}
                      className="text-xs text-[var(--text-faint)] hover:underline"
                    >
                      restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
