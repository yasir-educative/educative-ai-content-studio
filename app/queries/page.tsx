'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Field } from '../_components/Field';

const SENTINEL = '__UNCHANGED__';

interface Cfg {
  siteUrl: string; email: string; apiToken: string; projectKey: string; jql: string;
  defaultBoardId: number | null; enabledBoardIds: number[]; hiddenProjectKeys: string[]; configured: boolean;
}
interface Project { key: string; name: string; type: string; archived: boolean }
interface Status { name: string; category: string }
interface Issue {
  key: string; url: string; summary: string; status: string; statusCategory: string;
  priority: string; issueType: string; reporter: string; assignee: string;
  labels: string[]; created: string; updated: string;
}
interface Comment { author: string; created: string; body: string }
interface Ids { authorId?: string; collectionId?: string; pageId?: string; lessonUrl?: string }
interface Detail extends Issue {
  description: string; comments: Comment[]; resolution: string;
  ids: Ids; fields: Array<{ name: string; value: string }>;
}

const EMPTY: Cfg = {
  siteUrl: '', email: '', apiToken: '', projectKey: '', jql: '',
  defaultBoardId: null, enabledBoardIds: [], hiddenProjectKeys: [], configured: false,
};

// Jira groups every status into one of three categories; colour by category so
// a project's custom status names still read correctly without a per-name map.
function categoryClasses(category: string) {
  if (category === 'done') return 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10';
  if (category === 'indeterminate') return 'text-amber-300 border-amber-500/30 bg-amber-500/10';
  return 'text-sky-300 border-sky-500/30 bg-sky-500/10';
}

function relative(iso: string) {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (d < day) return 'today';
  if (d < 2 * day) return 'yesterday';
  if (d < 30 * day) return `${Math.floor(d / day)}d ago`;
  if (d < 365 * day) return `${Math.floor(d / (30 * day))}mo ago`;
  return `${Math.floor(d / (365 * day))}y ago`;
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

  const [projects, setProjects] = useState<Project[]>([]);
  const [picking, setPicking] = useState(false);
  const [projQuery, setProjQuery] = useState('');
  const [projLoading, setProjLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const [statuses, setStatuses] = useState<Status[]>([]);
  const [active, setActive] = useState<string[]>([]);
  const [mine, setMine] = useState(false);
  // Empty means "the default project"; non-empty searches across those projects.
  const [scope, setScope] = useState<string[]>([]);
  const [scoping, setScoping] = useState(false);

  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [issuesErr, setIssuesErr] = useState('');
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [analysis, setAnalysis] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // ── loaders ────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/jira', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { setCfg(j); setForm(j); if (!j.configured) setEditing(true); })
      .catch(() => setEditing(true));
  }, []);

  const loadIssues = useCallback(async (sel: string[], onlyMine = false, projects: string[] = []) => {
    setLoading(true); setIssuesErr(''); setIssues(null);
    try {
      const p = new URLSearchParams();
      if (sel.length) p.set('status', sel.join(','));
      if (onlyMine) p.set('mine', '1');
      if (projects.length) p.set('projects', projects.join(','));
      const qs = p.toString() ? `?${p}` : '';
      const res = await fetch(`/api/jira/issues${qs}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load');
      setIssues(json.issues);
    } catch (e: any) { setIssuesErr(e?.message || String(e)); } finally { setLoading(false); }
  }, []);

  const loadProjects = useCallback(async () => {
    setProjLoading(true);
    try {
      const r = await fetch('/api/jira/projects', { cache: 'no-store' });
      const j = await r.json();
      if (r.ok) setProjects(j.projects);
    } finally { setProjLoading(false); }
  }, []);

  useEffect(() => {
    if (!cfg.configured) return;
    if (!cfg.projectKey) { setPicking(true); return; }
    setActive([]);
    loadIssues([], mine, scope);
    fetch('/api/jira/statuses', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setStatuses(j.statuses || []))
      .catch(() => setStatuses([]));
  }, [cfg.configured, cfg.projectKey, loadIssues]);

  // Load detail whenever a different query is selected.
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true); setDetail(null); setAnalysis(null);
    fetch(`/api/jira/issue/${encodeURIComponent(selected)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && !j.error) setDetail(j); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  async function save() {
    setSaving(true); setErr('');
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
      const r = await fetch('/api/jira', { method: 'POST' });
      const j = await r.json();
      setTestOk(!!j.ok);
      setTestMsg(j.ok ? `Connected as ${j.displayName || j.email}` : j.error || 'Failed');
    } finally { setTesting(false); }
  }

  async function setProject(key: string) {
    const r = await fetch('/api/jira', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cfg, projectKey: key }),
    });
    const j = await r.json();
    if (r.ok) { setCfg(j); setForm(j); setPicking(false); setSelected(null); }
  }

  function toggleStatus(name: string) {
    const next = active.includes(name) ? active.filter((s) => s !== name) : [...active, name];
    setActive(next);
    loadIssues(next, mine, scope);
  }

  function toggleMine() {
    const next = !mine;
    setMine(next);
    setSelected(null);
    loadIssues(active, next, scope);
  }

  // Clearing the scope while "mine" is on searches every project the user can see.
  async function setHidden(keys: string[]) {
    const r = await fetch('/api/jira', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cfg, hiddenProjectKeys: keys }),
    });
    const j = await r.json();
    if (r.ok) setCfg(j);
  }
  const hide = (key: string) => {
    setHidden([...cfg.hiddenProjectKeys, key]);
    // Hiding a board also drops it from the current search scope.
    if (scope.includes(key)) toggleScope(key);
  };
  const unhide = (key: string) => setHidden(cfg.hiddenProjectKeys.filter((k) => k !== key));

  function toggleScope(key: string) {
    const next = scope.includes(key) ? scope.filter((k) => k !== key) : [...scope, key];
    setScope(next);
    loadIssues(active, mine, next);
  }

  async function analyze(key: string) {
    setAnalyzing(true); setAnalysis(null);
    try {
      const r = await fetch('/api/jira/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
      });
      setAnalysis(await r.json());
    } catch (e: any) { setAnalysis({ error: e?.message || String(e) }); } finally { setAnalyzing(false); }
  }

  const upd = (p: Partial<Cfg>) => setForm((f) => ({ ...f, ...p }));
  const activeProject = projects.find((p) => p.key === cfg.projectKey) || null;

  // Inactive boards and ones the user hid are kept out of the picker. A search
  // still reaches hidden boards, so nothing becomes unreachable by accident.
  const hiddenSet = useMemo(() => new Set(cfg.hiddenProjectKeys), [cfg.hiddenProjectKeys]);
  const relevant = useMemo(
    () => projects.filter((p) => !p.archived && !hiddenSet.has(p.key)),
    [projects, hiddenSet],
  );
  const hiddenProjects = useMemo(
    () => projects.filter((p) => hiddenSet.has(p.key)),
    [projects, hiddenSet],
  );
  const visibleProjects = useMemo(() => {
    const q = projQuery.trim().toLowerCase();
    if (q) {
      return projects
        .filter((p) => !hiddenSet.has(p.key))
        .filter((p) => p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q))
        .slice(0, 80);
    }
    return relevant.slice(0, 80);
  }, [projects, projQuery, relevant, hiddenSet]);

  // Client-side text search over the fetched page; status filtering is server-side.
  const shown = useMemo(() => {
    if (!issues) return null;
    const q = search.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter((i) => i.summary.toLowerCase().includes(q) || i.key.toLowerCase().includes(q));
  }, [issues, search]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of issues || []) m.set(i.status, (m.get(i.status) || 0) + 1);
    return m;
  }, [issues]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/" className="text-xs text-[var(--text-faint)] hover:text-[var(--text)] block mb-1.5 transition-colors">← Home</Link>
          <h1 className="text-2xl font-bold tracking-tight">Educative Content Queries</h1>
          <p className="text-sm text-[var(--text-dim)] mt-0.5">
            {cfg.configured && cfg.projectKey
              ? <>{activeProject?.name || cfg.projectKey} <span className="text-[var(--text-faint)]">· {cfg.projectKey}</span></>
              : 'Connect Jira to pull in content queries'}
          </p>
        </div>
        {cfg.configured && (
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => { setPicking((v) => !v); if (!projects.length) loadProjects(); }}>
              Change project
            </button>
            <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => loadIssues(active, mine, scope)} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => { setForm(cfg); setEditing((v) => !v); }}>
              Settings
            </button>
          </div>
        )}
      </div>

      {/* Connection form */}
      {(editing || !cfg.configured) && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Jira connection</h2>
            {cfg.configured && (
              <button className="btn-secondary text-xs py-1 px-3" onClick={test} disabled={testing}>
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            )}
          </div>
          {testMsg && (
            <div className={`text-xs rounded-lg px-3 py-2 border ${testOk ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-red-300 border-red-500/30 bg-red-500/10'}`}>
              {testOk ? '✓ ' : '✗ '}{testMsg}
            </div>
          )}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[11px] text-[var(--text-dim)] leading-relaxed">
            Site URL, your Atlassian email, and an API token from{' '}
            <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" className="underline text-[var(--accent)]">
              id.atlassian.com → Security → API tokens
            </a>. Leave the token blank to keep the saved one.
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Site URL"><input className="input" placeholder="https://educative.atlassian.net" value={form.siteUrl} onChange={(e) => upd({ siteUrl: e.target.value })} /></Field>
            <Field label="Account email"><input className="input" placeholder="you@educative.io" value={form.email} onChange={(e) => upd({ email: e.target.value })} /></Field>
            <Field label="API token">
              <input className="input" type="password"
                placeholder={cfg.apiToken === SENTINEL ? 'saved — leave blank to keep' : 'paste token'}
                value={form.apiToken === SENTINEL ? '' : form.apiToken}
                onChange={(e) => upd({ apiToken: e.target.value })} />
            </Field>
            <Field label="Project key"><input className="input" placeholder="PSB2C" value={form.projectKey} onChange={(e) => upd({ projectKey: e.target.value })} /></Field>
          </div>
          {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 p-3 text-sm">{err}</div>}
          <div className="flex gap-2">
            <button className="btn-primary text-sm py-1.5 px-4" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            {cfg.configured && <button className="btn-secondary text-sm py-1.5 px-4" onClick={() => { setForm(cfg); setEditing(false); }}>Cancel</button>}
          </div>
        </div>
      )}

      {/* Project picker */}
      {picking && cfg.configured && (
        <div className="card p-4 space-y-2">
          <input className="input w-full text-sm" placeholder={`Search ${projects.length || ''} projects…`} value={projQuery} onChange={(e) => setProjQuery(e.target.value)} />
          {projLoading && <p className="text-xs text-[var(--text-faint)]">Loading projects…</p>}
          <div className="max-h-64 overflow-y-auto divide-y divide-[var(--border)]">
            {visibleProjects.map((p) => (
              <div key={p.key} className="group flex items-center gap-2 px-2 py-2 hover:bg-[var(--panel-2)] transition-colors">
                <button className="flex-1 min-w-0 text-left" onClick={() => setProject(p.key)}>
                  <span className="text-sm truncate">{p.name}</span>
                </button>
                <span className="text-[11px] text-[var(--text-faint)] shrink-0">{p.key}</span>
                {p.key === cfg.projectKey
                  ? <span className="pill text-[10px] py-0 px-1.5 shrink-0">current</span>
                  : <button onClick={() => hide(p.key)} title="Hide this board"
                      className="text-xs text-[var(--text-faint)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 px-1">×</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters + two-pane board */}
      {cfg.configured && cfg.projectKey && !editing && (
        <>
          <div className="card p-3 space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap pb-2.5 border-b border-[var(--border)]">
              <button
                onClick={toggleMine}
                className={`text-xs rounded-lg px-3 py-1.5 border font-medium transition-colors ${mine ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]'}`}
              >
                {mine ? '✓ ' : ''}Assigned to me
              </button>
              <button
                onClick={() => { setScoping((v) => !v); if (!projects.length) loadProjects(); }}
                className="text-xs rounded-lg px-3 py-1.5 border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
              >
                Boards: {scope.length === 0
                  ? (mine ? 'all' : (projects.find((p) => p.key === cfg.projectKey)?.name || cfg.projectKey))
                  : scope.length <= 2
                    ? scope.map((k) => projects.find((p) => p.key === k)?.name || k).join(', ')
                    : `${scope.length} selected`}
              </button>
              {scope.length > 0 && (
                <button onClick={() => { setScope([]); loadIssues(active, mine, []); }} className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text)]">
                  clear
                </button>
              )}
              {mine && scope.length === 0 && (
                <span className="text-[11px] text-[var(--text-faint)]">your tickets across every board</span>
              )}
            </div>

            {scoping && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2.5 space-y-2">
                <input className="input w-full text-xs" placeholder={`Search ${projects.length || ''} boards…`} value={projQuery} onChange={(e) => setProjQuery(e.target.value)} />
                {projLoading && <p className="text-[11px] text-[var(--text-faint)]">Loading…</p>}
                <div className="max-h-56 overflow-y-auto rounded-md border border-[var(--border)] divide-y divide-[var(--border)]">
                  {visibleProjects.map((p) => {
                    const on = scope.includes(p.key);
                    return (
                      <div key={p.key}
                        className={`group flex items-center gap-2 px-2.5 py-1.5 transition-colors ${on ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--panel)]'}`}>
                        <input
                          type="checkbox"
                          className="accent-emerald-500 shrink-0"
                          checked={on}
                          onChange={() => toggleScope(p.key)}
                          id={`scope-${p.key}`}
                        />
                        <label htmlFor={`scope-${p.key}`} className="flex-1 min-w-0 cursor-pointer">
                          <span className={`text-xs block truncate ${on ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>{p.name}</span>
                        </label>
                        <code className="text-[10px] text-[var(--text-faint)] shrink-0 font-mono">{p.key}</code>
                        <button onClick={() => hide(p.key)} title={`Hide ${p.name}`}
                          className="text-xs text-[var(--text-faint)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity shrink-0 px-0.5">
                          ×
                        </button>
                      </div>
                    );
                  })}
                  {visibleProjects.length === 0 && !projLoading && (
                    <p className="text-[11px] text-[var(--text-faint)] px-2.5 py-2">No boards left. Restore one below.</p>
                  )}
                </div>

                {hiddenProjects.length > 0 && (
                  <div className="pt-1.5 border-t border-[var(--border)] space-y-1.5">
                    <button onClick={() => setShowHidden((v) => !v)} className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text)]">
                      {showHidden ? '▾' : '▸'} {hiddenProjects.length} hidden
                    </button>
                    {showHidden && (
                      <div className="flex flex-wrap gap-1.5">
                        {hiddenProjects.map((p) => (
                          <button key={p.key} onClick={() => unhide(p.key)} title={`Restore ${p.name}`}
                            className="text-[11px] rounded-md px-2 py-1 border border-dashed border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors">
                            + {p.name} <span className="font-mono opacity-60">{p.key}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <p className="text-[10px] text-[var(--text-faint)]">
                  Hover a board and press × to hide it for good. Inactive and archived boards are already excluded.
                  With none picked, “Assigned to me” covers every board you can see.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <button
                className={`text-xs rounded-lg px-2.5 py-1 border transition-colors ${active.length === 0 ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]'}`}
                onClick={() => { setActive([]); loadIssues([], mine, scope); }}
              >
                All{issues && ` (${issues.length})`}
              </button>
              {statuses.map((s) => {
                const on = active.includes(s.name);
                const n = counts.get(s.name);
                return (
                  <button key={s.name} onClick={() => toggleStatus(s.name)}
                    className={`text-xs rounded-lg px-2.5 py-1 border transition-colors ${on ? categoryClasses(s.category) + ' ring-1 ring-current' : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]'}`}>
                    {s.name}{n ? ` (${n})` : ''}
                  </button>
                );
              })}
              {statuses.length === 0 && <span className="text-xs text-[var(--text-faint)]">No status filters available</span>}
            </div>
            <input className="input w-full text-sm" placeholder="Filter the loaded queries by text or key…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {issuesErr && <div className="card p-3 text-sm text-red-300 border-red-500/40 bg-red-500/10">{issuesErr}</div>}

          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 items-start">
            {/* List */}
            <div className="card p-0 overflow-hidden">
              <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
                <span className="text-xs font-semibold">Queries {shown && <span className="text-[var(--text-faint)] font-normal">({shown.length})</span>}</span>
                {active.length > 0 && <span className="text-[10px] text-[var(--text-faint)]">{active.length} filter{active.length > 1 ? 's' : ''}</span>}
              </div>
              <div className="max-h-[calc(100vh-22rem)] overflow-y-auto divide-y divide-[var(--border)]">
                {loading && <p className="text-sm text-[var(--text-faint)] px-3 py-4">Fetching from Jira…</p>}
                {shown?.length === 0 && !loading && <p className="text-sm text-[var(--text-faint)] px-3 py-4">No queries matched.</p>}
                {shown?.map((i) => (
                  <button key={i.key} onClick={() => setSelected(i.key)}
                    className={`w-full text-left px-3 py-2.5 transition-colors ${selected === i.key ? 'bg-[var(--accent-soft)] border-l-2 border-[var(--accent)]' : 'hover:bg-[var(--panel-2)] border-l-2 border-transparent'}`}>
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] font-mono text-[var(--text-faint)] shrink-0 pt-0.5">{i.key}</span>
                      <span className={`text-[10px] rounded px-1.5 py-0.5 border shrink-0 ml-auto ${categoryClasses(i.statusCategory)}`}>{i.status}</span>
                    </div>
                    <p className="text-sm text-[var(--text)] leading-snug mt-1 line-clamp-2">{i.summary}</p>
                    <p className="text-[10px] text-[var(--text-faint)] mt-1">
                      {i.issueType}{i.reporter && ` · ${i.reporter}`}{i.created && ` · ${relative(i.created)}`}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Detail */}
            <div className="card p-0 overflow-hidden lg:sticky lg:top-20">
              {!selected && <p className="text-sm text-[var(--text-faint)] px-4 py-10 text-center">Select a query to see its details.</p>}
              {selected && detailLoading && <p className="text-sm text-[var(--text-faint)] px-4 py-10 text-center">Loading {selected}…</p>}
              {selected && !detailLoading && !detail && <p className="text-sm text-red-300 px-4 py-10 text-center">Could not load {selected}.</p>}
              {detail && (
                <div className="max-h-[calc(100vh-22rem)] overflow-y-auto">
                  <div className="px-4 py-3 border-b border-[var(--border)] space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a href={detail.url} target="_blank" rel="noreferrer" className="text-xs font-mono text-[var(--accent)] hover:underline">{detail.key} ↗</a>
                      <span className={`text-[10px] rounded px-1.5 py-0.5 border ${categoryClasses(detail.statusCategory)}`}>{detail.status}</span>
                      {detail.priority && <span className="text-[10px] text-[var(--text-faint)]">{detail.priority}</span>}
                    </div>
                    <h2 className="text-base font-semibold leading-snug">{detail.summary}</h2>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-faint)]">
                      <span>Type: <span className="text-[var(--text-dim)]">{detail.issueType || '—'}</span></span>
                      <span>Reporter: <span className="text-[var(--text-dim)]">{detail.reporter || '—'}</span></span>
                      <span>Assignee: <span className="text-[var(--text-dim)]">{detail.assignee || 'Unassigned'}</span></span>
                      <span>Created: <span className="text-[var(--text-dim)]">{detail.created ? new Date(detail.created).toLocaleDateString() : '—'}</span></span>
                    </div>
                    {detail.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {detail.labels.map((l) => <span key={l} className="pill text-[10px] py-0 px-1.5">{l}</span>)}
                      </div>
                    )}
                    <button className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5" onClick={() => analyze(detail.key)} disabled={analyzing}>
                      {analyzing && <span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" />}
                      {analyzing ? 'Analyzing…' : '✦ AI analysis'}
                    </button>
                  </div>

                  {analysis && (
                    <div className="px-4 py-3 border-b border-[var(--border)] space-y-2">
                      {analysis.error ? (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 p-3 text-xs">{analysis.error}</div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Suggested reply</span>
                            <span className={`text-[10px] rounded px-1.5 py-0.5 border ${analysis.usedLesson ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-[var(--text-faint)] border-[var(--border)]'}`}>
                              {analysis.usedLesson ? 'lesson read' : analysis.needsLesson ? 'lesson unavailable' : 'answered from ticket'}
                            </span>
                            <button
                              className="text-[10px] text-[var(--text-faint)] hover:text-[var(--accent)] ml-auto"
                              onClick={() => navigator.clipboard?.writeText(analysis.reply || '')}
                            >
                              copy reply
                            </button>
                          </div>

                          {analysis.reason && (
                            <p className="text-[11px] text-[var(--text-faint)] italic">{analysis.reason}</p>
                          )}
                          {analysis.warning && (
                            <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
                              {analysis.warning}
                            </p>
                          )}
                          {analysis.lessonTitle && (
                            <p className="text-[11px] text-[var(--text-faint)]">
                              Based on: <a href={analysis.lessonUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">{analysis.lessonTitle}</a>
                            </p>
                          )}

                          <textarea
                            readOnly
                            value={analysis.reply || ''}
                            spellCheck={false}
                            className="input w-full text-xs leading-relaxed min-h-[220px] font-sans"
                          />
                        </>
                      )}
                    </div>
                  )}

                  <div className="px-4 py-3 space-y-4">
                    {(detail.ids.authorId || detail.ids.collectionId || detail.ids.pageId || detail.ids.lessonUrl) && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-1.5">Educative references</p>
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2.5 space-y-1.5">
                          {([['Author ID', detail.ids.authorId], ['Collection ID', detail.ids.collectionId], ['Page ID', detail.ids.pageId]] as const).map(([label, val]) =>
                            val ? (
                              <div key={label} className="flex items-center gap-2 text-xs">
                                <span className="text-[var(--text-faint)] w-24 shrink-0">{label}</span>
                                <code className="text-[var(--text)] font-mono">{val}</code>
                                <button className="text-[10px] text-[var(--text-faint)] hover:text-[var(--accent)] ml-auto"
                                  onClick={() => navigator.clipboard?.writeText(String(val))}>copy</button>
                              </div>
                            ) : null,
                          )}
                          {detail.ids.lessonUrl && (
                            <a href={detail.ids.lessonUrl} target="_blank" rel="noreferrer"
                              className="text-xs text-[var(--accent)] hover:underline break-all block pt-0.5">
                              {detail.ids.lessonUrl} ↗
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    {detail.fields.length > 0 && (
                      <details className="group">
                        <summary className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] cursor-pointer select-none hover:text-[var(--text-dim)]">
                          Jira fields ({detail.fields.length})
                        </summary>
                        <div className="mt-1.5 rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
                          {detail.fields.map((fl) => (
                            <div key={fl.name} className="flex gap-2 px-2.5 py-1.5 text-xs">
                              <span className="text-[var(--text-faint)] w-40 shrink-0 truncate">{fl.name}</span>
                              <span className="text-[var(--text-dim)] break-words min-w-0">{fl.value}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-1.5">Description</p>
                      {detail.description
                        ? <pre className="text-xs text-[var(--text-dim)] whitespace-pre-wrap font-sans leading-relaxed">{detail.description}</pre>
                        : <p className="text-xs text-[var(--text-faint)] italic">No description.</p>}
                    </div>
                    {detail.comments.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-1.5">Comments ({detail.comments.length})</p>
                        <div className="space-y-2">
                          {detail.comments.map((c, idx) => (
                            <div key={idx} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2.5">
                              <p className="text-[10px] text-[var(--text-faint)] mb-1">{c.author} · {relative(c.created)}</p>
                              <pre className="text-xs text-[var(--text-dim)] whitespace-pre-wrap font-sans leading-relaxed">{c.body}</pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
