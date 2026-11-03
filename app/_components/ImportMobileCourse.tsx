'use client';

import { useState } from 'react';
import { Modal } from '@/app/_components/Modal';

type Preview = {
  title: string;
  pageCount: number;
  chapters: { id: string; title: string; pageCount: number }[];
};

/**
 * Pull a published mobile collection back in for viewing and editing.
 * Previews first, because importing reads every page one at a time and a
 * mistyped id should not cost that.
 */
export function ImportMobileCourse({ onImported }: { onImported: (courseId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [authorId, setAuthorId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<'' | 'preview' | 'import'>('');
  const [error, setError] = useState('');

  async function call(isPreview: boolean) {
    setBusy(isPreview ? 'preview' : 'import');
    setError('');
    try {
      const res = await fetch('/api/mobile-course/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionId: input.trim(), authorId: authorId.trim() || undefined, preview: isPreview }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      if (isPreview) setPreview(json);
      else onImported(json.course.id);
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally { setBusy(''); }
  }

  return (
    <>
      <button className="btn-secondary text-xs" onClick={() => setOpen(true)}>Import published</button>
      {open && (
        <Modal
          title={<h2 className="font-semibold">Import a published mobile course</h2>}
          closeDisabled={!!busy}
          onClose={() => { setOpen(false); setPreview(null); setError(''); }}
        >
          <div className="p-5 space-y-3">
            <p className="text-[11px] text-[var(--text-faint)]">
              Reads the collection and each of its pages. Nothing is written to Educative.
            </p>

            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
              <input
                className="input text-sm" value={input} disabled={!!busy} autoFocus
                placeholder="Collection URL or id"
                onChange={(e) => { setInput(e.target.value); setPreview(null); }}
              />
              <input
                className="input text-sm" value={authorId} disabled={!!busy}
                placeholder="Author id (optional)"
                onChange={(e) => { setAuthorId(e.target.value); setPreview(null); }}
              />
              <button className="btn-secondary text-sm" disabled={!input.trim() || !!busy} onClick={() => call(true)}>
                {busy === 'preview' ? 'Reading…' : 'Preview'}
              </button>
            </div>

            {preview && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3 space-y-2">
                <p className="text-sm font-medium">{preview.title}</p>
                <p className="text-[11px] text-[var(--text-dim)]">
                  {preview.chapters.length} chapter{preview.chapters.length === 1 ? '' : 's'} · {preview.pageCount} card{preview.pageCount === 1 ? '' : 's'}
                </p>
                <ul className="space-y-0.5 max-h-56 overflow-y-auto">
                  {preview.chapters.map((c) => (
                    <li key={c.id} className="flex justify-between gap-3 text-[11px] text-[var(--text-dim)]">
                      <span className="truncate">{c.title || 'Untitled chapter'}</span>
                      <span className="shrink-0 tabular-nums text-[var(--text-faint)]">{c.pageCount}</span>
                    </li>
                  ))}
                </ul>
                <button className="btn-primary text-sm" disabled={!!busy} onClick={() => call(false)}>
                  {busy === 'import' ? `Importing ${preview.pageCount} cards…` : `Import ${preview.pageCount} cards`}
                </button>
              </div>
            )}

            {error && <p className="text-xs text-red-500" role="alert">{error}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
