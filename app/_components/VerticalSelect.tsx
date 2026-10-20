'use client';

import { useEffect, useState } from 'react';
import { BUILTIN_VERTICALS } from '@/lib/verticals';

// Shared vertical picker. The list is served from /api/verticals so the blog,
// outline, and newsletter forms stay in sync, and an added vertical shows up
// everywhere without a redeploy. Built-ins render immediately as a fallback so
// the control is never empty while the fetch is in flight.
export function VerticalSelect({
  value,
  onChange,
  className = 'input w-full',
  allowAdd = true,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  allowAdd?: boolean;
}) {
  const [verticals, setVerticals] = useState<string[]>([...BUILTIN_VERTICALS]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/verticals', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (Array.isArray(j?.verticals) && j.verticals.length) setVerticals(j.verticals); })
      .catch(() => { /* keep built-in fallback */ });
  }, []);

  async function submit() {
    const name = draft.trim();
    if (!name) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/verticals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to add');
      setVerticals(json.verticals);
      onChange(name); // select what was just added
      setDraft('');
      setAdding(false);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
          {!verticals.includes(value) && value && <option key={value}>{value}</option>}
          {verticals.map((v) => <option key={v}>{v}</option>)}
        </select>
        {allowAdd && !adding && (
          <button
            type="button"
            className="btn-secondary text-xs py-1 px-2.5 shrink-0"
            onClick={() => { setAdding(true); setErr(''); }}
            title="Add a new vertical"
          >
            + New
          </button>
        )}
      </div>

      {allowAdd && adding && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            className="input flex-1 text-sm"
            placeholder="New vertical name"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              if (e.key === 'Escape') { setAdding(false); setDraft(''); setErr(''); }
            }}
          />
          <button type="button" className="btn-primary text-xs py-1 px-3 shrink-0" onClick={submit} disabled={busy || !draft.trim()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button
            type="button"
            className="btn-secondary text-xs py-1 px-2.5 shrink-0"
            onClick={() => { setAdding(false); setDraft(''); setErr(''); }}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      )}

      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
