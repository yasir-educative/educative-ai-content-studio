'use client';

// "Ask AI" over a selected passage: describe a change, see the rewrite, replace or discard.
//
// The request carries the whole document (windowed around the selection) plus the heading the
// passage sits under, so the rewrite stays consistent with the rest of the lesson rather than
// being produced from the isolated sentences.

import { useEffect, useRef, useState } from 'react';

const QUICK = [
  ['Tighten', 'Make this tighter and remove filler, keeping every technical fact.'],
  ['Simplify', 'Explain this more simply for an intermediate engineer, without losing precision.'],
  ['Expand', 'Expand this with one concrete example or detail that supports the point.'],
  ['Fix tone', 'Rewrite in a calm, practical engineering voice. Remove hype and clichés.'],
] as const;

export interface AskAiRequest {
  selection: string;
  documentText: string;
  sectionHeading: string;
  title?: string;
  blogId?: string;
}

export function AskAiPanel({
  request, onReplace, onClose,
}: {
  request: AskAiRequest;
  onReplace: (text: string) => void;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(text: string) {
    const ask = text.trim();
    if (!ask) { setErr('Describe the change you want'); return; }
    setBusy(true); setErr(''); setResult('');
    try {
      const res = await fetch('/api/ai-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, instruction: ask }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Request failed');
      setResult(json.result);
      setModel(json.model || '');
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6 pt-[8vh]"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card w-full max-w-2xl space-y-4 p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Rewrite with AI</h3>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
            {request.sectionHeading ? <>In section “{request.sectionHeading}”. </> : null}
            The whole article is sent as context so the rewrite stays consistent.
          </p>
        </div>

        <div className="rounded-lg border p-3 text-xs leading-relaxed"
          style={{ borderColor: 'var(--border)', background: 'var(--panel-2)', color: 'var(--text-dim)', maxHeight: 150, overflowY: 'auto' }}>
          {request.selection}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {QUICK.map(([label, text]) => (
            <button key={label} type="button" className="btn-secondary text-xs" disabled={busy}
              onClick={() => { setInstruction(text); void run(text); }}>
              {label}
            </button>
          ))}
        </div>

        <textarea
          ref={inputRef}
          className="input min-h-[80px] text-sm"
          placeholder="What should change? e.g. “add a sentence on why retries make this worse”"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void run(instruction); }}
        />

        {err && <div className="text-xs" style={{ color: 'var(--danger-text)' }}>{err}</div>}

        {result && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>Suggested</span>
              {model && <span className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>{model}</span>}
            </div>
            <div className="rounded-lg border p-3 text-sm leading-relaxed"
              style={{ borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--text)', maxHeight: 280, overflowY: 'auto' }}>
              {result}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button className="btn-primary" disabled={busy || !instruction.trim()} onClick={() => void run(instruction)}>
            {busy ? 'Thinking…' : result ? 'Try again' : 'Rewrite'}
          </button>
          {result && (
            <button className="btn-primary" onClick={() => { onReplace(result); onClose(); }}>
              Replace selection
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <span className="ml-auto text-[11px]" style={{ color: 'var(--text-faint)' }}>⌘↵ to run · Esc to close</span>
        </div>
      </div>
    </div>
  );
}
