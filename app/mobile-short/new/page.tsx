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
  idx: number;        // original row index
  cells: string[];    // raw cell values
}

type BulkStatus = 'idle' | 'running' | 'done' | 'error';

interface BulkJob {
  rowIdx: number;
  topic: string;
  status: BulkStatus;
  shortId?: string;
  stages: Array<{ name: string; status: 'start' | 'done' | 'error' }>;
  error?: string;
}

// ── Single short helpers ───────────────────────────────────────────────────────

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
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<SheetRow[]>([]);
  const [topicCol, setTopicCol] = useState<number>(-1);
  const [domainCol, setDomainCol] = useState<number>(-1);
  const [levelCol, setLevelCol] = useState<number>(-1);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [bulkSettings, setBulkSettings] = useState<Omit<ShortFormData, 'topic' | 'domain' | 'level'>>({
    objective: '',
    additionalContext: '',
    numCards: 5,
    includeHighlight: true,
  });
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
    setHeaders([]);
    setSheetRows([]);
    setSelectedRows(new Set());
    setTopicCol(-1);
    setDomainCol(-1);
    setLevelCol(-1);
    setBulkJobs([]);
    try {
      const res = await fetch('/api/mobile-short/sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sheetUrl.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setSheetError(json.error || 'Failed to fetch sheet'); return; }
      setHeaders(json.headers);
      const rows: SheetRow[] = (json.rows as string[][]).map((cells, idx) => ({ idx, cells }));
      setSheetRows(rows);
      // Auto-detect columns by header name
      const h = (json.headers as string[]).map((s: string) => s.toLowerCase().trim());
      const topicIdx = h.findIndex((x: string) => x.includes('topic') || x.includes('title') || x.includes('subject'));
      const domainIdx = h.findIndex((x: string) => x.includes('domain') || x.includes('category') || x.includes('vertical'));
      const levelIdx = h.findIndex((x: string) => x.includes('level') || x.includes('audience') || x.includes('difficulty'));
      setTopicCol(topicIdx >= 0 ? topicIdx : 0);
      if (domainIdx >= 0) setDomainCol(domainIdx);
      if (levelIdx >= 0) setLevelCol(levelIdx);
      // Select all rows by default
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

  // ── Sheet: bulk create ──
  async function startBulk() {
    const toCreate = sheetRows.filter((r) => selectedRows.has(r.idx));
    if (!toCreate.length || topicCol < 0) return;

    const jobs: BulkJob[] = toCreate.map((r) => ({
      rowIdx: r.idx,
      topic: r.cells[topicCol] || `Row ${r.idx + 2}`,
      status: 'idle',
      stages: [],
    }));
    setBulkJobs(jobs);
    setBulkRunning(true);

    // Fire all in parallel
    await Promise.all(
      toCreate.map(async (row, ji) => {
        const topic = row.cells[topicCol] || '';
        if (!topic.trim()) return;

        const domain = domainCol >= 0 ? row.cells[domainCol] : undefined;
        const level = levelCol >= 0 ? row.cells[levelCol] : undefined;

        setBulkJobs((prev) => {
          const next = [...prev];
          next[ji] = { ...next[ji], status: 'running' };
          return next;
        });

        try {
          const shortId = await startShortStream(
            {
              topic: topic.trim(),
              domain: domain?.trim() || undefined,
              level: level?.trim() || undefined,
              objective: bulkSettings.objective?.trim() || undefined,
              additionalContext: bulkSettings.additionalContext?.trim() || undefined,
              numCards: bulkSettings.numCards,
              isHighlightCardNeeded: bulkSettings.includeHighlight,
            },
            (s) => setBulkJobs((prev) => {
              const next = [...prev];
              const stages = [...next[ji].stages];
              const si = stages.findIndex((x) => x.name === s.name);
              if (si >= 0) stages[si] = s; else stages.push(s);
              next[ji] = { ...next[ji], stages };
              return next;
            }),
          );
          setBulkJobs((prev) => {
            const next = [...prev];
            next[ji] = { ...next[ji], status: 'done', shortId: shortId || undefined };
            return next;
          });
        } catch (err: any) {
          setBulkJobs((prev) => {
            const next = [...prev];
            next[ji] = { ...next[ji], status: 'error', error: err?.message || 'Failed' };
            return next;
          });
        }
      }),
    );

    setBulkRunning(false);
  }

  const allDone = bulkJobs.length > 0 && bulkJobs.every((j) => j.status === 'done' || j.status === 'error');

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
          <div className="card p-5 space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--text)]">Google Sheet URL</label>
              <p className="text-xs text-[var(--text-faint)]">Sheet must be shared with "Anyone with the link" → Viewer</p>
              <div className="flex gap-2">
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
              {sheetError && <p className="text-xs text-red-400 mt-1">{sheetError}</p>}
            </div>
          </div>

          {/* Sheet data + column mapping */}
          {headers.length > 0 && (
            <>
              {/* Column mapping */}
              <div className="card p-5 space-y-4">
                <h3 className="text-sm font-semibold text-[var(--text)]">Map columns</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[var(--text-dim)] uppercase tracking-wide">Topic column <span className="text-red-400">*</span></label>
                    <select className="input w-full text-sm" value={topicCol} onChange={(e) => setTopicCol(Number(e.target.value))}>
                      <option value={-1}>— select —</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[var(--text-dim)] uppercase tracking-wide">Domain column <span className="text-[var(--text-faint)]">(optional)</span></label>
                    <select className="input w-full text-sm" value={domainCol} onChange={(e) => setDomainCol(Number(e.target.value))}>
                      <option value={-1}>— none —</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[var(--text-dim)] uppercase tracking-wide">Level column <span className="text-[var(--text-faint)]">(optional)</span></label>
                    <select className="input w-full text-sm" value={levelCol} onChange={(e) => setLevelCol(Number(e.target.value))}>
                      <option value={-1}>— none —</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                </div>

                {/* Global settings */}
                <div className="border-t border-[var(--border)] pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[var(--text-dim)] uppercase tracking-wide">Cards per short</label>
                    <select className="input w-full text-sm" value={bulkSettings.numCards}
                      onChange={(e) => setBulkSettings((s) => ({ ...s, numCards: parseInt(e.target.value) }))}>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} card{n !== 1 ? 's' : ''}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[var(--text-dim)] uppercase tracking-wide">Objective <span className="text-[var(--text-faint)]">(applies to all)</span></label>
                    <input className="input w-full text-sm" placeholder="Optional learning goal"
                      value={bulkSettings.objective}
                      onChange={(e) => setBulkSettings((s) => ({ ...s, objective: e.target.value }))} />
                  </div>
                  <div className="space-y-1 flex flex-col justify-end pb-0.5">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" className="mt-0.5 shrink-0 accent-[var(--accent)]"
                        checked={bulkSettings.includeHighlight}
                        onChange={(e) => setBulkSettings((s) => ({ ...s, includeHighlight: e.target.checked }))} />
                      <span className="text-sm text-[var(--text-dim)]">Add Highlight Card</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Row table */}
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                  <div className="flex items-center gap-3">
                    <input type="checkbox" className="accent-[var(--accent)]"
                      checked={selectedRows.size === sheetRows.length && sheetRows.length > 0}
                      onChange={toggleAll} />
                    <span className="text-sm font-medium text-[var(--text)]">
                      {sheetRows.length} rows · {selectedRows.size} selected
                    </span>
                  </div>
                  {bulkJobs.length === 0 && (
                    <button
                      className="btn-primary text-xs py-1.5 px-4"
                      onClick={startBulk}
                      disabled={selectedRows.size === 0 || topicCol < 0 || bulkRunning}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                      Create {selectedRows.size} short{selectedRows.size !== 1 ? 's' : ''} in parallel
                    </button>
                  )}
                  {allDone && (
                    <button className="btn-secondary text-xs py-1.5 px-4" onClick={() => router.push('/mobile-course')}>
                      View all shorts →
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--panel)]">
                        <th className="w-8 px-4 py-2" />
                        <th className="px-3 py-2 text-left text-[var(--text-faint)] font-medium">#</th>
                        {headers.map((h, i) => (
                          <th key={i} className={`px-3 py-2 text-left font-medium ${
                            i === topicCol ? 'text-[var(--accent)]' :
                            i === domainCol ? 'text-teal-400' :
                            i === levelCol ? 'text-amber-400' :
                            'text-[var(--text-faint)]'
                          }`}>
                            {h}
                            {i === topicCol && <span className="ml-1 text-[10px] opacity-60">topic</span>}
                            {i === domainCol && <span className="ml-1 text-[10px] opacity-60">domain</span>}
                            {i === levelCol && <span className="ml-1 text-[10px] opacity-60">level</span>}
                          </th>
                        ))}
                        {bulkJobs.length > 0 && <th className="px-3 py-2 text-left font-medium text-[var(--text-faint)]">Status</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {sheetRows.map((row, ji) => {
                        const job = bulkJobs[ji];
                        const isSelected = selectedRows.has(row.idx);
                        return (
                          <tr
                            key={row.idx}
                            className={`border-b border-[var(--border)] transition-colors ${isSelected ? '' : 'opacity-40'} hover:bg-[var(--panel)]`}
                            onClick={() => { if (!bulkRunning) toggleRow(row.idx); }}
                            style={{ cursor: bulkRunning ? 'default' : 'pointer' }}
                          >
                            <td className="px-4 py-2">
                              <input type="checkbox" className="accent-[var(--accent)]"
                                checked={isSelected}
                                onChange={() => toggleRow(row.idx)}
                                disabled={bulkRunning}
                                onClick={(e) => e.stopPropagation()} />
                            </td>
                            <td className="px-3 py-2 text-[var(--text-faint)]">{row.idx + 2}</td>
                            {row.cells.map((cell, ci) => (
                              <td key={ci} className={`px-3 py-2 max-w-[180px] truncate ${
                                ci === topicCol ? 'text-[var(--text)] font-medium' : 'text-[var(--text-dim)]'
                              }`} title={cell}>
                                {cell || <span className="text-[var(--text-faint)] italic">—</span>}
                              </td>
                            ))}
                            {bulkJobs.length > 0 && (
                              <td className="px-3 py-2 whitespace-nowrap">
                                {!job ? null : job.status === 'idle' ? (
                                  <span className="text-[var(--text-faint)]">queued</span>
                                ) : job.status === 'running' ? (
                                  <span className="inline-flex items-center gap-1.5 text-amber-400">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                                    {job.stages.at(-1)?.name || 'starting…'}
                                  </span>
                                ) : job.status === 'done' ? (
                                  <a href={`/mobile-short/${job.shortId}`}
                                    className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                                    onClick={(e) => e.stopPropagation()}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                                    done — open
                                  </a>
                                ) : (
                                  <span className="text-red-400 text-[11px]">{job.error || 'error'}</span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
