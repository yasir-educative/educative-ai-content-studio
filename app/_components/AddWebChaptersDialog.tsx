'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/app/_components/Modal';

interface WebChapterRef {
  index: number;
  id: string;
  title: string;
  lessons: Array<{ pageId: string; title: string }>;
}

/**
 * Generate mobile chapters from web chapters.
 *
 * No analysis: each pick runs the ordinary card pipeline — planner, type
 * decision, cards generator, gate — exactly as a generated course does.
 * `insertAt` places them; without one they land where the web order says.
 */
export function AddWebChaptersDialog({
  course, insertAt, pairs, onClose, onDone,
}: {
  course: { id: string; collectionId?: string };
  /** Fixed position, as "Add chapter after" needs. Omit to use the web order. */
  insertAt?: number;
  /** [webChapterIndex, mobileChapterIndex] pairs, so a gap lands in the right place. */
  pairs?: Array<[number, number]>;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [sourceId, setSourceId] = useState(course.collectionId || '');
  const [chapters, setChapters] = useState<WebChapterRef[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState<number[]>([]);

  const valid = /^\d+$/.test(sourceId.trim());
  const running = !!busy;

  async function loadOutline() {
    setBusy('Reading the web course…');
    setError('');
    try {
      const res = await fetch(`/api/mobile-course/${course.id}/map-chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCollectionId: sourceId.trim(), outlineOnly: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Could not read the web course');
      setChapters(json.webChapters || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy('');
    }
  }
  useEffect(() => { if (valid && !chapters.length) loadOutline(); /* eslint-disable-next-line */ }, []);

  async function generate() {
    if (!picked.length) return;
    setError('');
    setLog([]);
    try {
      // Later chapters shift as earlier ones are inserted, so a fixed position
      // walks forward; the web order needs no adjustment.
      for (const [n, chapterIndex] of picked.entries()) {
        const title = chapters.find((c) => c.index === chapterIndex)?.title || `chapter ${chapterIndex}`;
        setBusy(`Generating "${title}" (${n + 1} of ${picked.length})…`);
        const res = await fetch(`/api/mobile-course/${course.id}/chapters/from-web`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceCollectionId: sourceId.trim(),
            chapterIndex,
            ...(insertAt === undefined ? { pairs: pairs || [] } : { insertAt: insertAt + n }),
          }),
        });
        if (!res.body) throw new Error('No response from the server');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let failed = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            if (!part.startsWith('data: ')) continue;
            const event = JSON.parse(part.slice(6));
            if (event.type === 'error') failed = event.message || 'Generation failed';
            else if (event.type === 'stage' && event.status === 'start') setBusy(`"${title}" — ${event.name}`);
          }
        }
        if (failed) { setLog((l) => [...l, `${title}: ${failed}`]); continue; }
        setDone((d) => [...d, chapterIndex]);
        setLog((l) => [...l, `${title}: added`]);
        await onDone();
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy('');
    }
  }

  const query = filter.trim().toLowerCase();
  const visible = query ? chapters.filter((c) => c.title.toLowerCase().includes(query)) : chapters;

  return (
    <Modal
      onClose={onClose}
      closeDisabled={running}
      title={insertAt === undefined ? 'Add the missing chapters' : 'Add chapters after this one'}
      footer={
        <>
          <span className="text-[11px] text-[var(--text-faint)] mr-auto">
            {busy || (picked.length
              ? `${picked.length} chapter${picked.length === 1 ? '' : 's'} selected · the normal card pipeline runs on each`
              : 'Pick the web chapters to generate.')}
          </span>
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={onClose} disabled={running}>Close</button>
            <button className="btn-primary text-xs" onClick={generate} disabled={running || !picked.length}>
              Generate {picked.length || ''}
            </button>
          </div>
        </>
      }
    >
      <div className="space-y-3">
        {!valid && (
          <label className="block space-y-1">
            <span className="text-xs text-[var(--text-dim)]">Web collection ID</span>
            <div className="flex gap-2">
              <input className="input text-sm flex-1" value={sourceId} onChange={(e) => setSourceId(e.target.value)} />
              <button className="btn-secondary text-xs" onClick={loadOutline} disabled={!/^\d+$/.test(sourceId.trim())}>Read</button>
            </div>
          </label>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}

        {chapters.length > 0 && (
          <>
            <input className="input text-xs w-full" placeholder="Filter chapters…"
              value={filter} onChange={(e) => setFilter(e.target.value)} />
            <ul className="max-h-80 overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
              {visible.map((c) => (
                <li key={c.index} className="flex items-center gap-2 px-2.5 py-1.5">
                  <input type="checkbox" className="shrink-0 accent-[var(--accent)]"
                    checked={picked.includes(c.index)}
                    disabled={running || done.includes(c.index)}
                    onChange={() => setPicked((p) =>
                      p.includes(c.index) ? p.filter((x) => x !== c.index) : [...p, c.index].sort((a, b) => a - b))} />
                  <span className="font-mono text-[10px] text-[var(--text-faint)]">{c.index}</span>
                  <span className="text-xs truncate flex-1">{c.title}</span>
                  <span className="text-[10px] text-[var(--text-faint)] shrink-0">
                    {c.lessons.length} lesson{c.lessons.length === 1 ? '' : 's'}
                  </span>
                  {done.includes(c.index) && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">added</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        {log.length > 0 && (
          <pre className="text-[11px] whitespace-pre-wrap text-[var(--text-dim)]">{log.join('\n')}</pre>
        )}
      </div>
    </Modal>
  );
}
