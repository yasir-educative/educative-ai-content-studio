'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Field } from '../_components/Field';

const SENTINEL = '__UNCHANGED__';

interface Cfg {
  siteUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  jql: string;
  defaultBoardId: number | null;
  enabledBoardIds: number[];
  configured: boolean;
}

interface Board { id: number; name: string; type: string; projectKey: string; projectName: string; }

interface Issue {
  key: string; url: string; summary: string; status: string; statusCategory: string;
  priority: string; issueType: string; reporter: string; assignee: string;
  labels: string[]; created: string; updated: string;
}

const EMPTY: Cfg = { siteUrl: '', email: '', apiToken: '', projectKey: '', jql: '', defaultBoardId: null, enabledBoardIds: [], configured: false };

function StatusPill({ status, category }: { status: string; category: string }) {
  const cls =
    category === 'done' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/8'
    : category === 'indeterminate' ? 'text-amber-300 border-amber-500/30 bg-amber-500/8'
    : 'text-[var(--text-dim)] border-[var(--border)] bg-[var(--panel-2)]';
  return <span className={`text-[10px] rounded-md px-1.5 py-0.5 border shrink-0 ${cls}`}>{status || '—'}</span>;
}

export default function ContentQueriesPage() {
  const [cfg, setCfg] = useState<Cfg>(EMPTY);
  const [form, setForm] = useState<Cfg>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [err, setErr] = useState('');

  const [boards, setBoards] = useState<Board[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [boardsErr, setBoardsErr] = useState('');
  const [boardQuery, setBoardQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);

  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [jql, setJql] = useState('');
  const [loading, setLoading] = useState(false);
  const [issuesErr, setIssuesErr] = useState('');

  useEffect(() => {
    fetch('/api/jira', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { setCfg(j); setForm(j); if (!j.configured) setEditing(true); })
      .catch(() => setEditing(true));
  }, []);

  const loadIssues = useCallback(async (boardId?: number | null) => {
    setLoading(true); setIssuesErr(''); setIssues(null);
    try {
      const qs = boardId ? `?boardId=${boardId}` : '';
      const res = await fetch(`/api/jira/issues${qs}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load');
      setIssues(json.issues); setJql(json.jql);
    } catch (e: any) {
      setIssuesErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBoards = useCallback(async () => {
    setBoardsLoading(true); setBoardsErr('');
    try {
      const res = await fetch('/api/jira/boards', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load boards');
      setBoards(json.boards);
    } catch (e: any) { setBoardsErr(e?.message || String(e)); } finally { setBoardsLoading(false); }
  }, []);

  useEffect(() => {
    if (!cfg.configured) return;
    const b = cfg.defaultBoardId ?? null;
    setActiveBoardId(b);
    if (b) loadIssues(b); else setPicking(true);
    if (boards.length === 0) loadBoards();
  }, [cfg.configured, cfg.defaultBoardId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveBoards(defaultBoardId: number | null, enabledBoardIds: number[]) {
    const res = await fetch('/api/jira', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cfg, defaultBoardId, enabledBoardIds }),
    });
    const json = await res.json();
    if (res.ok) { setCfg(json); setForm(json); }
  }

  async function save() {
    setSaving(true); setErr(''); setTestMsg(''); setTestOk(null);
    try {
      const res = await fetch('/api/jira', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Save failed');
      setCfg(json); setForm(json); setEditing(false);
    } catch (e: any) { setErr(e?.message || String(e)); } finally { setSaving(false); }
  }

  async function test() {
    setTesting(true); setTestMsg(''); setTestOk(null);
    try {
      const res = await fetch('/api/jira', { method: 'POST' });
      const json = await res.json();
      setTestOk(!!json.ok);
      setTestMsg(json.ok ? `Connected as ${json.displayName || json.email}` : json.error || 'Connection failed');
    } catch (e: any) { setTestOk(false); setTestMsg(e?.message || String(e)); } finally { setTesting(false); }
  }

  const upd = (p: Partial<Cfg>) => setForm((f) => ({ ...f, ...p }));

  const activeBoard = boards.find((b) => b.id === activeBoardId) || null;
  // Kept boards float to the top when not searching, so the common ones are one click away.
  const pinned = boards.filter((b) => cfg.enabledBoardIds.includes(b.id));
  const q = boardQuery.trim().toLowerCase();
  const matches = (b: Board) =>
    b.name.toLowerCase().includes(q) || b.projectKey.toLowerCase().includes(q);
  const visibleBoards = q
    ? boards.filter(matches).slice(0, 60)
    : [...pinned, ...boards.filter((b) => !cfg.enabledBoardIds.includes(b.id))].slice(0, 60);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <Link href="/" className="text-xs text-[var(--text-faint)] hover:text-[var(--text)] block mb-2 transition-colors">← Home</Link>
        <h1 className="text-2xl font-bold tracking-tight">Educative Content Queries</h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          Content queries raised in Jira, pulled into one board to work through.
        </p>
      </div>

      {/* Connection */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold">Jira connection</h2>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
              {cfg.configured ? `Connected to ${cfg.siteUrl}` : 'Not connected yet'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {cfg.configured && !editing && (
              <>
                <button className="btn-secondary text-xs py-1 px-3" onClick={test} disabled={testing}>
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                <button className="btn-secondary text-xs py-1 px-3" onClick={() => { setForm(cfg); setEditing(true); }}>Edit</button>
              </>
            )}
          </div>
        </div>

        {testMsg && (
          <div className={`text-xs rounded-lg px-3 py-2 border ${testOk ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/8' : 'text-red-300 border-red-500/30 bg-red-500/8'}`}>
            {testOk ? '✓ ' : '✗ '}{testMsg}
          </div>
        )}

        {editing && (
          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[11px] text-[var(--text-dim)] leading-relaxed space-y-1">
              <p className="font-medium text-[var(--text)]">What you need</p>
              <p><strong>1.</strong> Your Jira site URL, e.g. <code>https://educative.atlassian.net</code></p>
              <p><strong>2.</strong> The Atlassian account email you log in with</p>
              <p><strong>3.</strong> An API token from{' '}
                <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" className="underline text-[var(--accent)]">
                  id.atlassian.com → Security → API tokens
                </a>{' '}— click “Create API token”, name it, and copy the value once
              </p>
              <p><strong>4.</strong> The project key holding the queries, e.g. <code>CONTENT</code> (or write your own JQL below)</p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Site URL">
                <input className="input" placeholder="https://educative.atlassian.net" value={form.siteUrl} onChange={(e) => upd({ siteUrl: e.target.value })} />
              </Field>
              <Field label="Account email">
                <input className="input" placeholder="you@educative.io" value={form.email} onChange={(e) => upd({ email: e.target.value })} />
              </Field>
              <Field label="API token">
                <input
                  className="input" type="password"
                  placeholder={cfg.apiToken === SENTINEL ? 'unchanged — leave as is' : 'paste token'}
                  value={form.apiToken === SENTINEL ? '' : form.apiToken}
                  onChange={(e) => upd({ apiToken: e.target.value })}
                  onFocus={() => { if (form.apiToken === SENTINEL) upd({ apiToken: '' }); }}
                />
              </Field>
              <Field label="Project key">
                <input className="input" placeholder="CONTENT" value={form.projectKey} onChange={(e) => upd({ projectKey: e.target.value })} />
              </Field>
            </div>

            <Field label="JQL (optional — overrides project key)">
              <input className="input font-mono text-xs" placeholder='project = "CONTENT" AND status != Done ORDER BY created DESC' value={form.jql} onChange={(e) => upd({ jql: e.target.value })} />
            </Field>

            {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 p-3 text-sm">{err}</div>}

            <div className="flex items-center gap-2">
              <button className="btn-primary text-sm py-1.5 px-4" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save connection'}
              </button>
              {cfg.configured && (
                <button className="btn-secondary text-sm py-1.5 px-4" onClick={() => { setForm(cfg); setEditing(false); setErr(''); }} disabled={saving}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Issues */}
      {cfg.configured && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">
                Queries {issues && <span className="text-[var(--text-faint)] font-normal">({issues.length})</span>}
              </h2>
              <p className="text-[11px] text-[var(--text-faint)] mt-0.5 break-all">
                {activeBoard
                  ? <>{activeBoard.name} <span className="opacity-60">· {activeBoard.projectKey} · board {activeBoard.id}</span>{activeBoardId === cfg.defaultBoardId && <span className="ml-1.5 pill text-[10px] py-0 px-1.5">default</span>}</>
                  : jql ? <span className="font-mono">{jql}</span> : 'No board selected'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button className="btn-secondary text-xs py-1 px-3" onClick={() => setPicking((v) => !v)}>
                {picking ? 'Hide boards' : 'Change board'}
              </button>
              <button className="btn-secondary text-xs py-1 px-3" onClick={() => loadIssues(activeBoardId)} disabled={loading}>
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
          </div>

          {/* Board picker */}
          {picking && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  className="input flex-1 text-sm"
                  placeholder={`Search ${boards.length || ''} boards by name or project key…`}
                  value={boardQuery}
                  onChange={(e) => setBoardQuery(e.target.value)}
                />
                <button className="btn-secondary text-xs py-1 px-3 shrink-0" onClick={loadBoards} disabled={boardsLoading}>
                  {boardsLoading ? 'Loading…' : 'Reload'}
                </button>
              </div>
              {boardsErr && <p className="text-xs text-red-400">{boardsErr}</p>}
              {boardsLoading && boards.length === 0 && <p className="text-xs text-[var(--text-faint)]">Loading boards…</p>}

              {pinned.length > 0 && !boardQuery && (
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] pt-1">Selected</p>
              )}
              <div className="max-h-72 overflow-y-auto divide-y divide-[var(--border)] rounded-md">
                {visibleBoards.map((b) => {
                  const isDefault = b.id === cfg.defaultBoardId;
                  const isOn = cfg.enabledBoardIds.includes(b.id);
                  return (
                    <div key={b.id} className={`flex items-center gap-2 px-2.5 py-2 ${b.id === activeBoardId ? 'bg-[var(--accent-soft)]' : ''}`}>
                      <button
                        className="flex-1 min-w-0 text-left"
                        onClick={() => { setActiveBoardId(b.id); loadIssues(b.id); }}
                        title="Open this board"
                      >
                        <span className="text-sm text-[var(--text)]">{b.name}</span>
                        <span className="text-[11px] text-[var(--text-faint)] ml-2">{b.projectKey} · {b.type}</span>
                      </button>
                      {isDefault ? (
                        <span className="pill text-[10px] py-0 px-1.5 shrink-0">default</span>
                      ) : (
                        <button
                          className="text-[10px] text-[var(--text-faint)] hover:text-[var(--accent)] shrink-0 px-1"
                          onClick={() => saveBoards(b.id, cfg.enabledBoardIds)}
                          title="Make this the default board"
                        >
                          set default
                        </button>
                      )}
                      <label className="flex items-center gap-1 text-[10px] text-[var(--text-faint)] shrink-0 cursor-pointer" title="Keep in the selected list">
                        <input
                          type="checkbox"
                          className="accent-emerald-500"
                          checked={isOn}
                          disabled={isDefault}
                          onChange={(e) =>
                            saveBoards(
                              cfg.defaultBoardId,
                              e.target.checked
                                ? [...cfg.enabledBoardIds, b.id]
                                : cfg.enabledBoardIds.filter((x) => x !== b.id),
                            )
                          }
                        />
                        keep
                      </label>
                    </div>
                  );
                })}
                {!boardsLoading && visibleBoards.length === 0 && (
                  <p className="text-xs text-[var(--text-faint)] px-2.5 py-2">No boards matched.</p>
                )}
              </div>
              <p className="text-[10px] text-[var(--text-faint)]">
                The default opens automatically. Kept boards stay at the top to switch to; any other board is still one search away.
              </p>
            </div>
          )}

          {issuesErr && <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 p-3 text-sm">{issuesErr}</div>}
          {loading && <p className="text-sm text-[var(--text-faint)]">Fetching from Jira…</p>}
          {issues && issues.length === 0 && !loading && <p className="text-sm text-[var(--text-faint)]">No issues matched.</p>}

          {issues && issues.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
              {issues.map((i) => (
                <div key={i.key} className="flex items-start gap-3 px-3 py-2.5">
                  <a href={i.url} target="_blank" rel="noreferrer" className="text-xs font-mono text-[var(--accent)] hover:underline shrink-0 pt-0.5 w-24 truncate">
                    {i.key}
                  </a>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--text)] leading-snug">{i.summary}</p>
                    <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                      {i.issueType}{i.reporter && ` · ${i.reporter}`}{i.assignee && ` → ${i.assignee}`}
                      {i.created && ` · ${new Date(i.created).toLocaleDateString()}`}
                    </p>
                  </div>
                  <StatusPill status={i.status} category={i.statusCategory} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
