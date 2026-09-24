'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'single' | 'sheet';

interface ShortFormData {
  topic: string;
  domain: string;
  level: string;
  objective: string;
  additionalContext: string;
  numCards: number;
  includeHighlight: boolean;
}

interface SheetRow {
  idx: number;
  topic: string;
  domain: string;
  level: string;
  additionalContext: string;
  status: string;
  numCards: number;
  includeHighlight: boolean;
}

type BulkStatus = 'idle' | 'running' | 'done' | 'error';
type BulkPublishStatus = 'publishing' | 'published' | 'publish-failed';

interface BulkJob {
  rowIdx: number;
  topic: string;
  status: BulkStatus;
  shortId?: string;
  stages: Array<{ name: string; status: 'start' | 'done' | 'error' }>;
  error?: string;
  publishStatus?: BulkPublishStatus;
  publishedUrl?: string;
  publishError?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().trim().replace(/[\s_\-]+/g, '');

function findCol(headers: string[], matchers: Array<(n: string) => boolean>): number {
  for (const match of matchers) {
    const i = headers.findIndex((h) => match(norm(h)));
    if (i >= 0) return i;
  }
  return -1;
}

function parseHighlight(val: string): boolean {
  return ['yes', 'true', '1', 'y'].includes(val.toLowerCase().trim());
}

function parseNumCards(val: string): number {
  const n = parseInt(val.trim(), 10);
  return n >= 1 && n <= 10 ? n : 5;
}

async function startShortStream(
  body: object,
  onStage: (s: { name: string; status: 'start' | 'done' | 'error' }) => void,
  signal?: AbortSignal,
): Promise<string | null> {
  const res = await fetch('/api/mobile-short', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const shortId = res.headers.get('X-Short-Id');
  const reader = res.body?.getReader();
  if (!reader) return shortId;

  const dec = new TextDecoder();
  let buf = '';
  let finalId = shortId;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        if (ev.type === 'meta' && ev.shortId) finalId = ev.shortId;
        if (ev.type === 'stage') onStage({ name: ev.name, status: ev.status });
      } catch {}
    }
  }
  return finalId;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewMobileShortPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('single');

  // ── Single mode state ──
  const [step, setStep] = useState<'input' | 'running'>('input');
  const [form, setForm] = useState<ShortFormData>({
    topic: '',
    domain: '',
    level: 'beginner',
    objective: '',
    additionalContext: '',
    numCards: 5,
    includeHighlight: true,
  });
  const [stages, setStages] = useState<Array<{ name: string; status: 'start' | 'done' | 'error' }>>([]);
  const [singleError, setSingleError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // ── Sheet mode state ──
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState('');
  const [sheetRows, setSheetRows] = useState<SheetRow[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [bulkJobs, setBulkJobs] = useState<BulkJob[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);

  function upd(patch: Partial<ShortFormData>) { setForm((f) => ({ ...f, ...patch })); }

  // ── Single: start generation ──
  async function startSingle(e: React.FormEvent) {
    e.preventDefault();
    if (!form.topic.trim()) return;
    setStep('running');
    setStages([]);
    setSingleError('');
    abortRef.current = new AbortController();
    try {
      const finalId = await startShortStream(
        {
          topic: form.topic.trim(),
          domain: form.domain.trim() || undefined,
          level: form.level,
          objective: form.objective.trim() || undefined,
          additionalContext: form.additionalContext.trim() || undefined,
          numCards: form.numCards,
          isHighlightCardNeeded: form.includeHighlight,
        },
        (s) => setStages((prev) => {
          const idx = prev.findIndex((x) => x.name === s.name);
          if (idx >= 0) { const next = [...prev]; next[idx] = s; return next; }
          return [...prev, s];
        }),
        abortRef.current.signal,
      );
      if (finalId) router.push(`/mobile-short/${finalId}`);
    } catch (err: any) {
      if (err?.name !== 'AbortError') setSingleError(err?.message || 'Failed to start');
    }
  }

  function cancelSingle() {
    abortRef.current?.abort();
    setStep('input');
    setSingleError('');
    setStages([]);
  }

  // ── Sheet: fetch ──
  async function fetchSheet() {
    if (!sheetUrl.trim()) return;
    setSheetLoading(true);
    setSheetError('');
    setSheetRows([]);
    setSelectedRows(new Set());
    setBulkJobs([]);
    try {
      const res = await fetch('/api/mobile-short/sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sheetUrl.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setSheetError(json.error || 'Failed to fetch sheet'); return; }

      const headers: string[] = json.headers;
      const rawRows: string[][] = json.rows;
      const rowIndices: number[] = json.rowIndices ?? rawRows.map((_: any, i: number) => i);

      // Auto-detect the six specific columns
      const topicCol = findCol(headers, [
        (n) => n === 'topic',
        (n) => n.includes('topic'),
        (n) => n.includes('title'),
      ]);
      const domainCol = findCol(headers, [
        (n) => n === 'domain',
        (n) => n.includes('domain'),
      ]);
      const levelCol = findCol(headers, [
        (n) => n === 'level',
        (n) => n.includes('level'),
      ]);
      const contextCol = findCol(headers, [
        (n) => n === 'additionalcontext',
        (n) => n.includes('additionalcontext'),
        (n) => n.includes('context'),
      ]);
      const statusCol = findCol(headers, [
        (n) => n === 'status',
        (n) => n.includes('status'),
      ]);
      const highlightCol = findCol(headers, [
        (n) => n.includes('highlightcard') || n.includes('ishighlight'),
        (n) => n.includes('highlight'),
      ]);
      const numCardsCol = findCol(headers, [
        (n) => n === 'noofcards',
        (n) => n === 'numcards',
        (n) => n === 'numberofcards',
        (n) => n.includes('noofcard'),
        (n) => n.includes('numcard'),
        (n) => n.includes('numberofcard'),
        (n) => n === 'cards',
      ]);

      const rows: SheetRow[] = rawRows.map((cells, i) => ({
        idx: rowIndices[i],
        topic: topicCol >= 0 ? (cells[topicCol] ?? '') : '',
        domain: domainCol >= 0 ? (cells[domainCol] ?? '') : '',
        level: levelCol >= 0 ? (cells[levelCol] ?? '') : '',
        additionalContext: contextCol >= 0 ? (cells[contextCol] ?? '') : '',
        status: statusCol >= 0 ? (cells[statusCol] ?? '') : '',
        numCards: numCardsCol >= 0 && cells[numCardsCol] ? parseNumCards(cells[numCardsCol]) : 5,
        includeHighlight: highlightCol >= 0 && cells[highlightCol] ? parseHighlight(cells[highlightCol]) : true,
      }));

      setSheetRows(rows);
      setSelectedRows(new Set(rows.map((r) => r.idx)));
    } catch (err: any) {
      setSheetError(err?.message || 'Failed to fetch');
    } finally {
      setSheetLoading(false);
    }
  }

  function toggleRow(idx: number) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function toggleAll() {
    if (selectedRows.size === sheetRows.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(sheetRows.map((r) => r.idx)));
  }

  function updateRow(idx: number, patch: Partial<Pick<SheetRow, 'numCards' | 'includeHighlight'>>) {
    setSheetRows((prev) => prev.map((r) => r.idx === idx ? { ...r, ...patch } : r));
  }

  // ── Sheet: bulk create ──
  async function startBulk() {
    const toCreate = sheetRows.filter((r) => selectedRows.has(r.idx) && r.topic.trim());
    if (!toCreate.length) return;

    const jobs: BulkJob[] = toCreate.map((r) => ({
      rowIdx: r.idx,
      topic: r.topic,
      status: 'idle',
      stages: [],
    }));
    setBulkJobs(jobs);
    setBulkRunning(true);

    // Each row gets its own isolated async closure; all state updates key on rowIdx
    // so concurrent runs can never overwrite each other's slot.
    function patchJob(rowIdx: number, patch: Partial<BulkJob>) {
      setBulkJobs((prev) => prev.map((j) => j.rowIdx === rowIdx ? { ...j, ...patch } : j));
    }

    function patchJobStage(rowIdx: number, stage: { name: string; status: 'start' | 'done' | 'error' }) {
      setBulkJobs((prev) => prev.map((j) => {
        if (j.rowIdx !== rowIdx) return j;
        const stages = [...j.stages];
        const si = stages.findIndex((x) => x.name === stage.name);
        if (si >= 0) stages[si] = stage; else stages.push(stage);
        return { ...j, stages };
      }));
    }

    await Promise.all(
      toCreate.map(async (row) => {
        const rowIdx = row.idx;
        patchJob(rowIdx, { status: 'running' });
        try {
          const shortId = await startShortStream(
            {
              topic: row.topic.trim(),
              domain: row.domain.trim() || undefined,
              level: row.level.trim() || undefined,
              additionalContext: row.additionalContext.trim() || undefined,
              numCards: row.numCards,
              isHighlightCardNeeded: row.includeHighlight,
              sheetUrl: sheetUrl.trim() || undefined,
              rowIdx,
            },
            (s) => patchJobStage(rowIdx, s),
          );
          patchJob(rowIdx, { status: 'done', shortId: shortId || undefined });

          // Auto-publish to Educative (sheet bulk flow only)
          if (shortId) {
            patchJob(rowIdx, { publishStatus: 'publishing' });
            try {
              const pubRes = await fetch(`/api/mobile-short/${shortId}/publish`, { method: 'POST' });
              const pubJson = await pubRes.json();
              patchJob(rowIdx, {
                publishStatus: pubRes.ok ? 'published' : 'publish-failed',
                publishedUrl: pubJson.short?.publishedUrl,
                publishError: pubRes.ok ? (pubJson.sheetError || undefined) : (pubJson.error || 'Publish failed'),
              });
            } catch (pubErr: any) {
              patchJob(rowIdx, { publishStatus: 'publish-failed', publishError: pubErr?.message || 'Publish failed' });
            }
          }
        } catch (err: any) {
          patchJob(rowIdx, { status: 'error', error: err?.message || 'Failed' });
        }
      }),
    );

    setBulkRunning(false);
  }

  const allDone = bulkJobs.length > 0 && bulkJobs.every((j) =>
    (j.status === 'error') ||
    (j.status === 'done' && (j.publishStatus === 'published' || j.publishStatus === 'publish-failed' || !j.shortId))
  );
  const selectedCount = sheetRows.filter((r) => selectedRows.has(r.idx) && r.topic.trim()).length;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl space-y-8">
      {/* Header */}
      <div>
        <span className="pill mb-3">New Mobile Short</span>
        <h1 className="text-3xl font-bold tracking-tight">
          Generate <span className="brand-gradient">flash cards</span>
        </h1>
        <p className="mt-2 text-[var(--text-dim)] text-sm">
          Generate up to 5 focused mobile learning cards per topic.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-1 p-1 bg-[var(--card)] border border-[var(--border)] rounded-lg w-fit">
        {(['single', 'sheet'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`text-xs px-4 py-1.5 rounded-md font-medium transition-colors capitalize ${
              mode === m ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
            }`}
          >
            {m === 'single' ? 'Single topic' : 'From Google Sheet'}
          </button>
        ))}
      </div>

      {/* ── Single mode ─────────────────────────────────────────────────────── */}
      {mode === 'single' && step === 'input' && (
        <form onSubmit={startSingle} className="card p-6 space-y-5">
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text)]">Topic <span className="text-red-400">*</span></label>
            <input className="input w-full" placeholder="e.g., LLM context windows"
              value={form.topic} onChange={(e) => upd({ topic: e.target.value })} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text)]">Domain</label>
            <input className="input w-full" placeholder="e.g., AI/ML, System Design"
              value={form.domain} onChange={(e) => upd({ domain: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text)]">Level</label>
            <select className="input w-full" value={form.level} onChange={(e) => upd({ level: e.target.value })}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text)]">Objective</label>
            <input className="input w-full" placeholder="e.g., Understand how context windows affect LLM behavior"
              value={form.objective} onChange={(e) => upd({ objective: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text)]">Additional Context</label>
            <textarea className="input w-full h-24 resize-none text-sm" placeholder="Any extra context or notes…"
              value={form.additionalContext} onChange={(e) => upd({ additionalContext: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--text)]">Number of Cards</label>
              <select className="input w-full" value={form.numCards} onChange={(e) => upd({ numCards: parseInt(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} card{n !== 1 ? 's' : ''}</option>)}
              </select>
            </div>
            <div className="space-y-1 flex flex-col justify-end pb-0.5">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" className="mt-0.5 shrink-0 accent-[var(--accent)]"
                  checked={form.includeHighlight} onChange={(e) => upd({ includeHighlight: e.target.checked })} />
                <span className="text-sm text-[var(--text-dim)] leading-snug">Add Highlight Card</span>
              </label>
            </div>
          </div>
          <div className="pt-1">
            <button type="submit" className="btn-primary" disabled={!form.topic.trim()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              Generate Short
            </button>
          </div>
        </form>
      )}

      {mode === 'single' && step === 'running' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-[var(--text)]">{form.topic || 'Generating…'}</h2>
              <p className="text-xs text-[var(--text-faint)] mt-0.5 animate-pulse">Pipeline running — will redirect when done</p>
            </div>
            <button className="btn-secondary text-sm" onClick={cancelSingle}>Cancel</button>
          </div>
          {singleError && <div className="card p-3 text-sm text-red-400 border-red-500/30">{singleError}</div>}
          <div className="card p-5 space-y-2">
            <h3 className="text-sm font-medium text-[var(--text-dim)] mb-3">Pipeline progress</h3>
            {stages.length === 0 && !singleError && (
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                <span className="text-xs text-[var(--text-faint)]">Initialising pipeline…</span>
              </div>
            )}
            {stages.map((s) => (
              <div key={s.name} className="flex items-center gap-3 text-sm">
                <span className={`h-2 w-2 rounded-full shrink-0 ${s.status === 'done' ? 'bg-emerald-400' : s.status === 'error' ? 'bg-red-400' : 'bg-amber-400 animate-pulse'}`} />
                <span className="text-[var(--text-dim)] flex-1 text-xs">{s.name}</span>
                <span className={`text-xs ${s.status === 'done' ? 'text-emerald-400' : s.status === 'error' ? 'text-red-400' : 'text-amber-400'}`}>{s.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Sheet mode ───────────────────────────────────────────────────────── */}
      {mode === 'sheet' && (
        <div className="space-y-6">
          {/* URL input */}
          <div className="card p-5">
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--text)]">Google Sheet URL</label>
              <p className="text-xs text-[var(--text-faint)]">Fetches rows where Status = "In progress"</p>
              <div className="flex gap-2 mt-1.5">
                <input
                  className="input flex-1"
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fetchSheet(); } }}
                />
                <button
                  className="btn-secondary shrink-0"
                  onClick={fetchSheet}
                  disabled={sheetLoading || !sheetUrl.trim()}
                >
                  {sheetLoading ? 'Fetching…' : 'Fetch'}
                </button>
              </div>
              {sheetError && <p className="text-xs text-red-400 mt-1.5">{sheetError}</p>}
            </div>
          </div>

          {/* Row cards */}
          {sheetRows.length > 0 && (
            <>
              {/* Toolbar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={selectedRows.size === sheetRows.length && sheetRows.length > 0}
                      onChange={toggleAll}
                    />
                    <span className="text-sm text-[var(--text-dim)]">
                      {sheetRows.length} row{sheetRows.length !== 1 ? 's' : ''} · {selectedRows.size} selected
                    </span>
                  </label>
                </div>
                {bulkJobs.length === 0 ? (
                  <button
                    className="btn-primary text-xs py-1.5 px-4"
                    onClick={startBulk}
                    disabled={selectedCount === 0 || bulkRunning}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                    Generate {selectedCount} short{selectedCount !== 1 ? 's' : ''}
                  </button>
                ) : allDone ? (
                  <button className="btn-secondary text-xs py-1.5 px-4" onClick={() => router.push('/mobile-short')}>
                    View all shorts →
                  </button>
                ) : null}
              </div>

              {/* Cards grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sheetRows.map((row) => {
                  const job = bulkJobs.find((j) => j.rowIdx === row.idx);
                  const isSelected = selectedRows.has(row.idx);
                  return (
                    <div
                      key={row.idx}
                      onClick={() => { if (!bulkRunning && !job) toggleRow(row.idx); }}
                      className={`card p-4 flex flex-col gap-3 transition-all border-2 ${
                        isSelected
                          ? 'border-[var(--accent)]/50 bg-[var(--accent)]/5'
                          : 'border-transparent opacity-50'
                      } ${!bulkRunning && !job ? 'cursor-pointer hover:border-[var(--accent)]/30' : ''}`}
                    >
                      {/* Top row: checkbox + row number + status */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="accent-[var(--accent)] shrink-0"
                            checked={isSelected}
                            disabled={bulkRunning || !!job}
                            onChange={() => toggleRow(row.idx)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="text-[10px] font-mono text-[var(--text-faint)]">Row {row.idx + 2}</span>
                        </div>
                        {/* Generation status badge */}
                        {job && (
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                            job.status === 'done' ? 'bg-emerald-500/15 text-emerald-400' :
                            job.status === 'error' ? 'bg-red-500/15 text-red-400' :
                            'bg-amber-500/15 text-amber-400'
                          }`}>
                            {job.status === 'running'
                              ? (job.stages.at(-1)?.name || 'starting…')
                              : job.status === 'done'
                              ? '✓ generated'
                              : job.status === 'error'
                              ? job.error || 'error'
                              : 'queued'}
                          </span>
                        )}
                      </div>

                      {/* Publish status row */}
                      {job?.status === 'done' && (
                        <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                          {job.publishStatus === 'publishing' && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 animate-pulse">
                              Publishing…
                            </span>
                          )}
                          {job.publishStatus === 'published' && (
                            <>
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                                ✓ published
                              </span>
                              {job.publishedUrl && (
                                <a
                                  href={job.publishedUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-[var(--accent)] hover:underline"
                                >
                                  View on Educative →
                                </a>
                              )}
                              {job.publishError && (
                                <span className="text-[10px] text-amber-400">Sheet: {job.publishError}</span>
                              )}
                            </>
                          )}
                          {job.publishStatus === 'publish-failed' && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400" title={job.publishError}>
                              Publish failed
                            </span>
                          )}
                          {!job.publishStatus && job.shortId && (
                            <a
                              href={`/mobile-short/${job.shortId}`}
                              className="text-[10px] text-[var(--accent)] hover:underline"
                            >
                              Open →
                            </a>
                          )}
                        </div>
                      )}

                      {/* Topic */}
                      <div>
                        <p className="text-sm font-semibold text-[var(--text)] leading-snug line-clamp-2">
                          {row.topic || <span className="text-[var(--text-faint)] italic font-normal">No topic</span>}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {row.domain && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-400 font-medium">
                              {row.domain}
                            </span>
                          )}
                          {row.level && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium capitalize">
                              {row.level}
                            </span>
                          )}
                          {row.status && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 font-medium">
                              {row.status}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Additional context */}
                      {row.additionalContext && (
                        <div className="max-h-20 overflow-y-auto border-l-2 border-[var(--border)] pl-2 pr-1">
                          <p className="text-[11px] text-[var(--text-dim)] leading-relaxed">
                            {row.additionalContext}
                          </p>
                        </div>
                      )}

                      {/* Editable controls */}
                      <div
                        className="flex items-center gap-3 pt-2 border-t border-[var(--border)] mt-auto"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-[var(--text-faint)] whitespace-nowrap">Cards</span>
                          <select
                            className="input text-xs py-0.5 px-1.5 h-6 w-14"
                            value={row.numCards}
                            disabled={bulkRunning || !!job}
                            onChange={(e) => updateRow(row.idx, { numCards: parseInt(e.target.value) })}
                          >
                            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                        <label className="flex items-center gap-1.5 ml-auto cursor-pointer select-none">
                          <input
                            type="checkbox"
                            className="accent-[var(--accent)]"
                            checked={row.includeHighlight}
                            disabled={bulkRunning || !!job}
                            onChange={(e) => updateRow(row.idx, { includeHighlight: e.target.checked })}
                          />
                          <span className="text-[10px] text-[var(--text-faint)]">Highlight</span>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
