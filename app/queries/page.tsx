'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Field } from '../_components/Field';

const SENTINEL = '__UNCHANGED__';

interface Cfg {
  siteUrl: string; email: string; apiToken: string; projectKey: string; jql: string;
  defaultBoardId: number | null; enabledBoardIds: number[]; hiddenProjectKeys: string[];
  defaultFacets: Record<string, string>; configured: boolean;
}
interface Project { key: string; name: string; type: string; archived: boolean }
interface Status { name: string; category: string }
interface Facet { fieldId: string; cf: string; name: string; values: string[] }
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
  reporterId?: string; assigneeId?: string;
}
interface Transition { id: string; name: string; to: string; toCategory: string }
interface JUser { accountId: string; displayName: string; email: string; avatar: string }
interface AsgBoard { key: string; name: string; count: number }

const EMPTY: Cfg = {
  siteUrl: '', email: '', apiToken: '', projectKey: '', jql: '',
  defaultBoardId: null, enabledBoardIds: [], hiddenProjectKeys: [], defaultFacets: {}, configured: false,
};

// Jira groups every status into one of three categories; colour by category so
// a project's custom status names still read correctly without a per-name map.
function categoryClasses(category: string) {
  if (category === 'done') return 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10';
  if (category === 'indeterminate') return 'text-amber-300 border-amber-500/30 bg-amber-500/10';
  return 'text-sky-300 border-sky-500/30 bg-sky-500/10';
}

// Deterministic colour per name, so the same person keeps the same avatar hue.
const AVATAR_HUES = [
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500',
  'bg-teal-500', 'bg-sky-500', 'bg-indigo-500', 'bg-violet-500', 'bg-fuchsia-500',
];
function hueFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}
function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = (name || '?').split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?';
  return (
    <span className={`${hueFor(name)} ${size === 'md' ? 'w-6 h-6 text-[10px]' : 'w-5 h-5 text-[9px]'} rounded-full shrink-0 inline-flex items-center justify-center text-white font-semibold`}>
      {initials}
    </span>
  );
}

// P0/P1 need to shout; the rest should not compete with status.
function priorityClasses(p: string) {
  const v = (p || '').toLowerCase();
  if (v.startsWith('p0')) return 'text-white bg-red-600 border-red-600';
  if (v.startsWith('p1')) return 'text-white bg-orange-600 border-orange-600';
  if (v.startsWith('p2')) return 'text-amber-900 dark:text-amber-200 bg-amber-200 dark:bg-amber-900/50 border-amber-400';
  return 'text-[var(--text-faint)] border-[var(--border)]';
}

function railFor(category: string) {
  if (category === 'done') return 'border-emerald-400/70';
  if (category === 'indeterminate') return 'border-amber-400/70';
  return 'border-sky-400/70';
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
  // Who the list is filtered to. null with mine=true means the signed-in user.
  const [assignee, setAssignee] = useState<JUser | null>(null);
  const [asgBoards, setAsgBoards] = useState<AsgBoard[]>([]);
  const [asgLoading, setAsgLoading] = useState(false);
  const [asgCapped, setAsgCapped] = useState(false);
  const [asgQuery, setAsgQuery] = useState('');
  const [asgHits, setAsgHits] = useState<JUser[]>([]);
  const [pickingAsg, setPickingAsg] = useState(false);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [facetSel, setFacetSel] = useState<Record<string, string>>({});
  // Facets are custom fields of one project; they mean nothing on another.
  const [facetProject, setFacetProject] = useState('');
  // Empty means "the default project"; non-empty searches across those projects.
  const [scope, setScope] = useState<string[]>([]);
  const [scoping, setScoping] = useState(false);

  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [issuesErr, setIssuesErr] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Current filter state, so "load more" repeats the same query without
  // depending on a stale closure inside the observer.
  const queryRef = useRef<{ statuses: string[]; mine: boolean; scope: string[]; text: string; facets: Record<string, string>; assigneeId: string }>({ statuses: [], mine: false, scope: [], text: '', facets: {}, assigneeId: '' });
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [analysis, setAnalysis] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [savingReply, setSavingReply] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [polishErr, setPolishErr] = useState('');
  // Draft before the last polish, so one click can undo it.
  const [prePolish, setPrePolish] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postMsg, setPostMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [transitionId, setTransitionId] = useState('');
  // Chosen person to mention. Seeded from the assignee, replaceable by search.
  const [mention, setMention] = useState<JUser | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [userHits, setUserHits] = useState<JUser[]>([]);
  const [userSearching, setUserSearching] = useState(false);
  const [pickingUser, setPickingUser] = useState(false);
  const [instruction, setInstruction] = useState('please respond with the following:');

  // ── loaders ────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/jira', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { setCfg(j); setForm(j); if (!j.configured) setEditing(true); })
      .catch(() => setEditing(true));
  }, []);

  const PAGE = 20;

  function encodeFacets(f: Record<string, string>) {
    return Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(',');
  }

  function buildQs(sel: string[], onlyMine: boolean, projects: string[], text: string, fac: Record<string, string>, cur?: string | null, asgId = '') {
    const p = new URLSearchParams();
    p.set('max', String(PAGE));
    if (sel.length) p.set('status', sel.join(','));
    if (asgId) p.set('assignee', asgId); else if (onlyMine) p.set('mine', '1');
    if (projects.length) p.set('projects', projects.join(','));
    if (text.trim()) p.set('text', text.trim());
    const fx = encodeFacets(fac);
    if (fx) p.set('facets', fx);
    if (cur) p.set('cursor', cur);
    return `?${p}`;
  }

  const loadIssues = useCallback(async (sel: string[], onlyMine = false, projects: string[] = [], text = '', fac: Record<string, string> = {}, asgId = '') => {
    queryRef.current = { statuses: sel, mine: onlyMine, scope: projects, text, facets: fac, assigneeId: asgId };
    setLoading(true); setIssuesErr(''); setIssues(null); setCursor(null); setTotal(null);
    try {
      const res = await fetch(`/api/jira/issues${buildQs(sel, onlyMine, projects, text, fac, null, asgId)}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load');
      setIssues(json.issues);
      setCursor(json.nextCursor ?? null);
      setTotal(typeof json.total === 'number' ? json.total : null);
    } catch (e: any) { setIssuesErr(e?.message || String(e)); } finally { setLoading(false); }
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const { statuses, mine: m, scope: sc, text: tx, facets: fx, assigneeId: aid } = queryRef.current;
      const res = await fetch(`/api/jira/issues${buildQs(statuses, m, sc, tx, fx, cursor, aid)}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load more');
      // De-duplicate: a shifting result set can repeat a key across pages.
      setIssues((prev) => {
        const seen = new Set((prev || []).map((i) => i.key));
        return [...(prev || []), ...(json.issues || []).filter((i: Issue) => !seen.has(i.key))];
      });
      setCursor(json.nextCursor ?? null);
    } catch (e: any) {
      setIssuesErr(e?.message || String(e));
      setCursor(null); // stop retrying a failing page on every scroll
    } finally { setLoadingMore(false); }
  }, [cursor, loadingMore, loading]);

  // Fetch the next page when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMore(); },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore]);

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
    // Apply the saved facet defaults (e.g. Team = Content) to the first load,
    // rather than fetching everything and narrowing afterwards.
    const saved = cfg.defaultFacets || {};
    setFacetSel(saved);
    loadIssues([], mine, scope, search, saved, assignee?.accountId || '');
    fetch('/api/jira/facets', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { setFacets(j.facets || []); setFacetProject(j.project || ''); })
      .catch(() => { setFacets([]); setFacetProject(''); });
    fetch('/api/jira/statuses', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setStatuses(j.statuses || []))
      .catch(() => setStatuses([]));
  }, [cfg.configured, cfg.projectKey, loadIssues]);

  // Debounce typing into a server-side search rather than filtering the page.
  const searchRef = useRef(search);
  searchRef.current = search;
  const firstSearch = useRef(true);
  useEffect(() => {
    if (!cfg.configured || !cfg.projectKey) return;
    if (firstSearch.current) { firstSearch.current = false; return; }
    const t = setTimeout(() => {
      if (searchRef.current === search) loadIssues(active, mine, scope, search, facetSel, assignee?.accountId || '');
    }, 450);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load detail whenever a different query is selected.
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true); setDetail(null); setAnalysis(null); setReplyDraft(''); setSavedAt(null);
    setPostMsg(null); setTransitions([]); setTransitionId(''); setPrePolish(null); setPolishErr('');
    setMention(null); setUserQuery(''); setUserHits([]); setPickingUser(false);
    // Transitions are per-issue and workflow-specific, so load the real list
    // rather than assuming a status name exists.
    fetch(`/api/jira/post-update?key=${encodeURIComponent(selected)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !Array.isArray(j?.transitions)) return;
        setTransitions(j.transitions);
        const done = j.transitions.find((t: Transition) => t.toCategory === 'done');
        if (done) setTransitionId(done.id);
      })
      .catch(() => {});
    // A saved reply means this query was already analysed; show it instead of
    // making the user pay for the call again.
    fetch(`/api/jira/analysis?key=${encodeURIComponent(selected)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.analysis) return;
        setAnalysis(j.analysis);
        setReplyDraft(j.analysis.reply || '');
        setSavedAt(j.analysis.savedAt || null);
      })
      .catch(() => {});
    fetch(`/api/jira/issue/${encodeURIComponent(selected)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || j.error) return;
        setDetail(j);
        // Default to the assignee; reporters on these tickets are often bots.
        if (j.assigneeId) setMention({ accountId: j.assigneeId, displayName: j.assignee, email: '', avatar: '' });
        else if (j.reporterId) setMention({ accountId: j.reporterId, displayName: j.reporter, email: '', avatar: '' });
      })
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
    loadIssues(next, mine, scope, search, facetSel, assignee?.accountId || '');
  }

  function pickFacet(cf: string, value: string) {
    const next = { ...facetSel };
    if (value) next[cf] = value; else delete next[cf];
    setFacetSel(next);
    setSelected(null);
    loadIssues(active, mine, scope, search, next, assignee?.accountId || '');
  }

  // Remember the current selection so it applies on the next visit.
  async function saveFacetDefaults() {
    const r = await fetch('/api/jira', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cfg, defaultFacets: facetSel }),
    });
    const j = await r.json();
    if (r.ok) setCfg(j);
  }

  // Boards that actually hold this person's work, so switching between them
  // never lands on an empty list.
  const loadAsgBoards = useCallback(async (accountId?: string) => {
    setAsgLoading(true);
    try {
      const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
      const r = await fetch(`/api/jira/assignee-boards${qs}`, { cache: 'no-store' });
      const j = await r.json();
      setAsgBoards(j.boards || []);
      setAsgCapped(!!j.capped);
    } catch { setAsgBoards([]); } finally { setAsgLoading(false); }
  }, []);

  function applyAssignee(user: JUser | null, on: boolean) {
    setAssignee(user);
    setMine(on);
    setSelected(null);
    setScope([]);        // their boards are a different set, so start unscoped
    setActive([]);
    setAsgBoards([]);
    setFacetSel({});
    if (on) { setFacets([]); setFacetProject(''); }
    else retargetFacets(cfg.projectKey);
    if (on) loadAsgBoards(user?.accountId);
    loadIssues([], on, [], search, {}, user?.accountId || '');
  }

  function toggleMine() {
    if (mine) { applyAssignee(null, false); return; }
    applyAssignee(null, true); // null user = the signed-in account
  }

  // Jump to one of the assignee's boards: scopes the list and the facets.
  // Switching board invalidates the facet selections: they are custom fields
  // of the previous project and match nothing on the new one, which silently
  // emptied the list.
  const retargetFacets = useCallback(async (projectKey: string) => {
    setFacetSel({});
    if (!projectKey) { setFacets([]); setFacetProject(''); return; }
    try {
      const r = await fetch(`/api/jira/facets?project=${encodeURIComponent(projectKey)}`, { cache: 'no-store' });
      const j = await r.json();
      setFacets(j.facets || []);
      setFacetProject(j.project || '');
    } catch { setFacets([]); setFacetProject(''); }
  }, []);

  function pickAsgBoard(key: string) {
    const next = scope.length === 1 && scope[0] === key ? [] : [key];
    setScope(next);
    setSelected(null);
    setActive([]);
    retargetFacets(next[0] || '');
    loadIssues([], mine, next, search, {}, assignee?.accountId || '');
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
    loadIssues(active, mine, next, search, facetSel, assignee?.accountId || '');
  }

  async function analyze(key: string) {
    setAnalyzing(true); setAnalysis(null);
    try {
      const r = await fetch('/api/jira/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
      });
      const j = await r.json();
      setAnalysis(j);
      setReplyDraft(j.reply || '');
      setSavedAt(null);
    } catch (e: any) { setAnalysis({ error: e?.message || String(e) }); } finally { setAnalyzing(false); }
  }

  async function saveReply() {
    if (!analysis || !detail) return;
    setSavingReply(true);
    try {
      const r = await fetch('/api/jira/analysis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: detail.key,
          reply: replyDraft,
          category: analysis.category,
          usedLesson: !!analysis.usedLesson,
          needsManualReview: !!analysis.needsManualReview,
          imagesRead: analysis.imagesRead || 0,
          reason: analysis.reason, lessonTitle: analysis.lessonTitle,
          lessonUrl: analysis.lessonUrl, warning: analysis.warning,
          edited: replyDraft !== (analysis.reply || ''),
        }),
      });
      const j = await r.json();
      if (r.ok) setSavedAt(j.analysis?.savedAt || new Date().toISOString());
    } finally { setSavingReply(false); }
  }

  useEffect(() => {
    const q = asgQuery.trim();
    if (!pickingAsg || q.length < 2) { setAsgHits([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/jira/users?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const j = await r.json();
        setAsgHits(j.users || []);
      } catch { setAsgHits([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [asgQuery, pickingAsg]);

  useEffect(() => {
    const q = userQuery.trim();
    if (!pickingUser || q.length < 2) { setUserHits([]); return; }
    setUserSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/jira/users?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const j = await r.json();
        setUserHits(j.users || []);
      } catch { setUserHits([]); } finally { setUserSearching(false); }
    }, 300);
    return () => { clearTimeout(t); setUserSearching(false); };
  }, [userQuery, pickingUser]);

  async function polish() {
    if (!detail || !replyDraft.trim()) return;
    setPolishing(true); setPolishErr('');
    const before = replyDraft;
    try {
      const r = await fetch('/api/jira/polish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: detail.key, draft: replyDraft }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Polish failed');
      setPrePolish(before);
      setReplyDraft(j.reply);
    } catch (e: any) { setPolishErr(e?.message || String(e)); } finally { setPolishing(false); }
  }

  async function postUpdate() {
    if (!detail || !replyDraft.trim()) return;
    const mentionId = mention?.accountId || '';
    const mentionName = mention?.displayName || '';
    const target = transitions.find((t) => t.id === transitionId);
    const label = target ? ` and moved it to ${target.to}` : '';
    if (!confirm(`Post this update to ${detail.key}${label}?`)) return;

    setPosting(true); setPostMsg(null);
    try {
      const r = await fetch('/api/jira/post-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: detail.key, reply: replyDraft, instruction,
          mentionAccountId: mentionId || undefined, mentionName: mentionName || undefined,
          transitionId: transitionId || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Post failed');
      setPostMsg({
        ok: true,
        text: j.warning || `Posted to ${detail.key}${j.transitioned && target ? ` and moved to ${target.to}` : ''}.`,
      });
      if (j.transitioned && target) {
        setDetail((d) => (d ? { ...d, status: target.to, statusCategory: target.toCategory } : d));
        setIssues((prev) => (prev || []).map((i) => i.key === detail.key ? { ...i, status: target.to, statusCategory: target.toCategory } : i));
      }
    } catch (e: any) {
      setPostMsg({ ok: false, text: e?.message || String(e) });
    } finally { setPosting(false); }
  }

  const upd = (p: Partial<Cfg>) => setForm((f) => ({ ...f, ...p }));
  const activeProject = projects.find((p) => p.key === cfg.projectKey) || null;
  // AI analysis answers content queries against a lesson, so it only applies to
  // the query board or a ticket that actually references one.
  const canAnalyze = !!detail && (
    detail.key.split('-')[0] === cfg.projectKey ||
    !!(detail.ids.pageId || detail.ids.lessonUrl)
  );

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

  // Filtering happens server-side, so the list renders what came back.
  const shown = issues;

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
            <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => loadIssues(active, mine, scope, search, facetSel, assignee?.accountId || '')} disabled={loading}>
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
              <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400 w-12 shrink-0">Scope</span>
              <button
                onClick={toggleMine}
                className={`text-xs rounded-lg px-3 py-1.5 border font-medium transition-colors ${mine && !assignee ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]'}`}
              >
                {mine && !assignee ? '✓ ' : ''}Assigned to me
              </button>

              <div className="relative">
                {!pickingAsg ? (
                  <button
                    onClick={() => { setPickingAsg(true); setAsgQuery(''); }}
                    className={`text-xs rounded-lg px-3 py-1.5 border font-medium transition-colors ${assignee ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]'}`}
                  >
                    {assignee ? `✓ @${assignee.displayName}` : 'Assigned to…'}
                  </button>
                ) : (
                  <input
                    autoFocus
                    className="input text-xs py-1.5 w-44"
                    placeholder="Search people…"
                    value={asgQuery}
                    onChange={(e) => setAsgQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setPickingAsg(false); setAsgQuery(''); } }}
                    onBlur={() => setTimeout(() => setPickingAsg(false), 160)}
                  />
                )}
                {pickingAsg && asgQuery.trim().length >= 2 && (
                  <div className="absolute top-full left-0 mt-1 z-20 w-60 rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-xl max-h-52 overflow-y-auto">
                    {asgHits.length === 0 && <p className="text-[11px] text-[var(--text-faint)] px-2.5 py-2">No people matched.</p>}
                    {asgHits.map((u) => (
                      <button key={u.accountId}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--panel-2)] transition-colors"
                        onMouseDown={(e) => { e.preventDefault(); setPickingAsg(false); setAsgQuery(''); applyAssignee(u, true); }}>
                        {u.avatar ? <img src={u.avatar} alt="" className="w-5 h-5 rounded-full shrink-0" /> : <span className="w-5 h-5 rounded-full bg-[var(--panel-2)] shrink-0" />}
                        <span className="text-xs truncate">{u.displayName}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {assignee && (
                <button onClick={() => applyAssignee(null, false)} className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text)]">
                  clear person
                </button>
              )}
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
                <button onClick={() => { setScope([]); loadIssues(active, mine, [], search, facetSel, assignee?.accountId || ''); }} className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text)]">
                  clear
                </button>
              )}
              {mine && scope.length === 0 && (
                <span className="text-[11px] text-[var(--text-faint)]">your tickets across every board</span>
              )}
            </div>

            {mine && (
              <div className="flex items-start gap-2 flex-wrap pb-2.5 border-b border-[var(--border)]">
                <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] w-12 shrink-0 pt-1.5">
                  {assignee ? 'Their boards' : 'My boards'}
                </span>
                <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                  {asgLoading && <span className="text-[11px] text-[var(--text-faint)] py-1">Finding boards…</span>}
                  {!asgLoading && asgBoards.length === 0 && (
                    <span className="text-[11px] text-[var(--text-faint)] py-1">No assigned queries found.</span>
                  )}
                  {asgCapped && asgBoards.length > 0 && (
                    <span className="text-[10px] text-[var(--text-faint)] py-1 w-full">
                      Counts are from their most recent issues, so they are lower bounds.
                    </span>
                  )}
                  {asgBoards.length > 0 && (
                    <button
                      onClick={() => { setScope([]); setActive([]); loadIssues([], mine, [], search, facetSel, assignee?.accountId || ''); }}
                      className={`text-xs rounded-lg px-2.5 py-1 border transition-colors ${scope.length === 0 ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-soft)] font-medium' : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]'}`}
                    >
                      All boards
                    </button>
                  )}
                  {asgBoards.map((b) => {
                    const on = scope.length === 1 && scope[0] === b.key;
                    return (
                      <button key={b.key} onClick={() => pickAsgBoard(b.key)} title={b.key}
                        className={`text-xs rounded-lg px-2.5 py-1 border transition-colors ${on ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-soft)] font-medium' : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-faint)]'}`}>
                        {b.name} ({b.count}{asgCapped ? '+' : ''})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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

            <div className="flex items-start gap-2 flex-wrap pb-2.5 border-b border-[var(--border)]">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 w-12 shrink-0 pt-1.5">Status</span>
              <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
              <button
                className={`text-xs rounded-lg px-2.5 py-1 border transition-colors ${active.length === 0 ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-soft)] font-medium' : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]'}`}
                onClick={() => { setActive([]); loadIssues([], mine, scope, search, facetSel, assignee?.accountId || ''); }}
              >
                All{total !== null ? ` (${total.toLocaleString()})` : issues ? ` (${issues.length})` : ''}
              </button>
              {statuses.map((s) => {
                const on = active.includes(s.name);
                const n = counts.get(s.name);
                return (
                  <button key={s.name} onClick={() => toggleStatus(s.name)}
                    className={`text-xs rounded-lg px-2.5 py-1 border transition-colors ${on ? categoryClasses(s.category) + ' ring-1 ring-current font-medium' : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-faint)]'}`}>
                    {s.name}{n ? ` (${n})` : ''}
                  </button>
                );
              })}
              {statuses.length === 0 && <span className="text-xs text-[var(--text-faint)]">No status filters available</span>}
              </div>
            </div>
            {facets.length > 0 && (
              <div className="flex items-end gap-2 flex-wrap pb-2.5 border-b border-[var(--border)]">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400 w-12 shrink-0 pb-1.5">Fields</span>
                {facets.map((f) => (
                  <label key={f.cf} className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">{f.name}</span>
                    <select
                      className="input text-xs py-1 min-w-[8rem]"
                      value={facetSel[f.cf] || ''}
                      onChange={(e) => pickFacet(f.cf, e.target.value)}
                    >
                      <option value="">All</option>
                      {f.values.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                ))}
                {Object.keys(facetSel).length > 0 && (
                  <button onClick={() => { setFacetSel({}); loadIssues(active, mine, scope, search, {}, assignee?.accountId || ''); }}
                    className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text)] pb-1.5">
                    clear
                  </button>
                )}
                <button onClick={saveFacetDefaults} title="Apply this selection automatically next time"
                  className="text-[11px] text-[var(--text-faint)] hover:text-[var(--accent)] pb-1.5 ml-auto">
                  {JSON.stringify(facetSel) === JSON.stringify(cfg.defaultFacets || {}) ? 'saved as default' : 'save as default'}
                </button>
              </div>
            )}

            <input className="input w-full text-sm" placeholder="Search all queries — text, or an issue key like PSB2C-20468…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {issuesErr && <div className="card p-3 text-sm text-red-300 border-red-500/40 bg-red-500/10">{issuesErr}</div>}

          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 items-start">
            {/* List */}
            <div className="card p-0 overflow-hidden">
              <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text)]">
                  Queries{' '}
                  <span className="text-[var(--text-faint)] font-normal">
                    {shown ? (total !== null && total > (issues?.length || 0) ? `${shown.length} of ${total}` : `${shown.length}`) : ''}
                  </span>
                </span>
                {active.length > 0 && <span className="text-[10px] text-[var(--text-faint)]">{active.length} filter{active.length > 1 ? 's' : ''}</span>}
              </div>
              <div className="max-h-[calc(100vh-22rem)] overflow-y-auto divide-y divide-[var(--border)]">
                {loading && <p className="text-sm text-[var(--text-faint)] px-3 py-4">Fetching from Jira…</p>}
                {shown?.length === 0 && !loading && <p className="text-sm text-[var(--text-faint)] px-3 py-4">No queries matched.</p>}
                {shown?.map((i) => (
                  <button key={i.key} onClick={() => setSelected(i.key)}
                    className={`w-full text-left px-3 py-2.5 transition-colors border-l-[3px] ${
                      selected === i.key
                        ? 'bg-[var(--accent-soft)] border-[var(--accent)]'
                        : `hover:bg-[var(--panel-2)] ${railFor(i.statusCategory)}`
                    }`}>
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] font-mono text-[var(--text-faint)] shrink-0 pt-0.5">{i.key}</span>
                      <span className={`text-[10px] rounded px-1.5 py-0.5 border shrink-0 ml-auto ${categoryClasses(i.statusCategory)}`}>{i.status}</span>
                    </div>
                    <p className="text-sm text-[var(--text)] leading-snug mt-1 line-clamp-2">{i.summary}</p>
                    <p className="text-[10px] text-[var(--text-faint)] mt-1 flex items-center gap-1.5">
                      {i.reporter && <Avatar name={i.reporter} />}
                      <span className="truncate">{i.issueType}{i.reporter && ` · ${i.reporter}`}{i.created && ` · ${relative(i.created)}`}</span>
                    </p>
                  </button>
                ))}

                {/* Scrolling this into view pulls the next page. */}
                {cursor && (
                  <div ref={sentinelRef} className="px-3 py-3 text-center">
                    <span className="text-[11px] text-[var(--text-faint)]">
                      {loadingMore ? 'Loading more…' : 'Scroll for more'}
                    </span>
                  </div>
                )}
                {!cursor && (issues?.length || 0) > 0 && !loading && (
                  <p className="px-3 py-2.5 text-center text-[10px] text-[var(--text-faint)]">
                    End of results · {issues?.length} loaded
                  </p>
                )}

              </div>
            </div>

            {/* Detail */}
            <div className="card p-0 overflow-hidden lg:sticky lg:top-20">
              {!selected && (
                <div className="px-4 py-12 text-center space-y-1">
                  <p className="text-3xl opacity-40">◧</p>
                  <p className="text-sm text-[var(--text-faint)]">Select a query to see its details.</p>
                </div>
              )}
              {selected && detailLoading && <p className="text-sm text-[var(--text-faint)] px-4 py-10 text-center">Loading {selected}…</p>}
              {selected && !detailLoading && !detail && <p className="text-sm text-red-300 px-4 py-10 text-center">Could not load {selected}.</p>}
              {detail && (
                <div className="max-h-[calc(100vh-22rem)] overflow-y-auto">
                  <div className="px-4 py-3 border-b border-[var(--border)] space-y-2 bg-gradient-to-br from-[var(--accent-soft)] to-transparent">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a href={detail.url} target="_blank" rel="noreferrer" className="text-xs font-mono font-semibold text-[var(--accent)] hover:underline">{detail.key} ↗</a>
                      <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 border ${categoryClasses(detail.statusCategory)}`}>{detail.status}</span>
                      {detail.priority && (
                        <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 border ${priorityClasses(detail.priority)}`}>{detail.priority}</span>
                      )}
                    </div>
                    <h2 className="text-base font-semibold leading-snug">{detail.summary}</h2>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-faint)]">
                      <span>Type: <span className="text-[var(--text-dim)]">{detail.issueType || '—'}</span></span>
                      <span className="inline-flex items-center gap-1">Reporter: {detail.reporter ? <><Avatar name={detail.reporter} /><span className="text-[var(--text-dim)]">{detail.reporter}</span></> : <span className="text-[var(--text-dim)]">—</span>}</span>
                      <span className="inline-flex items-center gap-1">Assignee: {detail.assignee ? <><Avatar name={detail.assignee} /><span className="text-[var(--text-dim)]">{detail.assignee}</span></> : <span className="text-[var(--text-dim)]">Unassigned</span>}</span>
                      <span>Created: <span className="text-[var(--text-dim)]">{detail.created ? new Date(detail.created).toLocaleDateString() : '—'}</span></span>
                    </div>
                    {detail.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {detail.labels.map((l) => (
                          <span key={l} className="text-[10px] py-0.5 px-1.5 rounded border border-indigo-400/50 bg-indigo-100 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200">{l}</span>
                        ))}
                      </div>
                    )}
                    {canAnalyze && (
                    <button className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5" onClick={() => analyze(detail.key)} disabled={analyzing}>
                      {analyzing && <span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" />}
                      {analyzing ? 'Analyzing…' : analysis && !analysis.error ? '✦ Re-analyze' : '✦ AI analysis'}
                    </button>
                    )}
                  </div>

                  {analysis && (
                    <div className="px-4 py-3 border-b border-[var(--border)] space-y-2">
                      {analysis.error ? (
                        <div className="rounded-lg border-l-4 border-red-500 bg-red-100 dark:bg-red-950/40 text-red-900 dark:text-red-200 p-3 text-xs">{analysis.error}</div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-fuchsia-600 dark:text-fuchsia-400">AI analysis</span>
                            {analysis.category === 'not-content' ? (
                              <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 border border-purple-500 bg-purple-100 dark:bg-purple-950/50 text-purple-900 dark:text-purple-200">
                                Not content
                              </span>
                            ) : (
                              <span className="text-[10px] rounded px-1.5 py-0.5 border border-[var(--border)] text-[var(--text-dim)]">
                                Content
                              </span>
                            )}
                            {analysis.category !== 'not-content' && (
                              <span className={`text-[10px] rounded px-1.5 py-0.5 border ${analysis.usedLesson ? 'text-emerald-700 dark:text-emerald-300 border-emerald-500/50 bg-emerald-100 dark:bg-emerald-950/40' : 'text-[var(--text-faint)] border-[var(--border)]'}`}>
                                {analysis.usedLesson ? 'lesson read' : analysis.needsLesson ? 'lesson unavailable' : 'answered from ticket'}
                              </span>
                            )}
                            {analysis.imagesRead > 0 && (
                              <span className="text-[10px] rounded px-1.5 py-0.5 border text-sky-700 dark:text-sky-300 border-sky-500/50 bg-sky-100 dark:bg-sky-950/40">
                                {analysis.imagesRead} image{analysis.imagesRead > 1 ? 's' : ''} read
                              </span>
                            )}
                            <button
                              className="text-[10px] text-[var(--text-faint)] hover:text-[var(--accent)] ml-auto"
                              onClick={() => navigator.clipboard?.writeText(analysis.reply || '')}
                            >
                              copy reply
                            </button>
                          </div>

                          {analysis.needsManualReview && (
                            <div className="rounded-lg border-l-4 border-amber-500 bg-amber-100 dark:bg-amber-950/40 px-3 py-2">
                              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">⚠ Review manually before sending</p>
                              <p className="text-[11px] text-amber-800 dark:text-amber-300/90 mt-0.5">
                                The lesson could not be read, so this draft is not grounded in the content. Check it
                                before sending. (Internal note — the reply itself does not mention this.)
                              </p>
                            </div>
                          )}
                          {analysis.reason && (
                            <p className="text-[11px] text-[var(--text-dim)] italic">{analysis.reason}</p>
                          )}
                          {analysis.warning && (
                            <p className="text-[11px] text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/40 border-l-4 border-amber-500 rounded px-2 py-1.5">
                              {analysis.warning}
                            </p>
                          )}
                          {analysis.lessonTitle && (
                            <p className="text-[11px] text-[var(--text-faint)]">
                              Based on: <a href={analysis.lessonUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">{analysis.lessonTitle}</a>
                            </p>
                          )}


                        </>
                      )}
                    </div>
                  )}

                  {/* Reply — usable with or without an AI draft */}
                  <div className="px-4 py-3 border-b border-[var(--border)] space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-600 dark:text-teal-400">Reply</span>
                      <button className="text-[10px] text-[var(--text-faint)] hover:text-[var(--accent)] ml-auto"
                        onClick={() => navigator.clipboard?.writeText(replyDraft)} disabled={!replyDraft.trim()}>
                        copy
                      </button>
                    </div>
                    <textarea
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      spellCheck={false}
                      placeholder="Write the reply, or generate one above and edit it."
                      className="input w-full text-xs leading-relaxed min-h-[200px] font-sans"
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <button className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                        onClick={polish} disabled={polishing || !replyDraft.trim()}>
                        {polishing && <span className="h-3 w-3 rounded-full border-2 border-current/30 border-t-current animate-spin inline-block" />}
                        {polishing ? 'Polishing…' : '✦ Polish with AI'}
                      </button>
                      <button className="btn-secondary text-xs py-1.5 px-3" onClick={saveReply} disabled={savingReply || !replyDraft.trim()}>
                        {savingReply ? 'Saving…' : savedAt ? 'Save changes' : 'Save reply'}
                      </button>
                      {savedAt && <span className="text-[10px] text-emerald-700 dark:text-emerald-300">saved {new Date(savedAt).toLocaleString()}</span>}
                      {prePolish !== null && replyDraft !== prePolish && (
                        <button className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text)]"
                          onClick={() => { setReplyDraft(prePolish); setPrePolish(null); }}>
                          undo polish
                        </button>
                      )}
                      {analysis?.reply && replyDraft !== analysis.reply && (
                        <button className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text)]"
                          onClick={() => setReplyDraft(analysis.reply)}>
                          revert to generated
                        </button>
                      )}
                    </div>
                    {polishErr && <p className="text-[11px] text-red-600 dark:text-red-300">{polishErr}</p>}
                  </div>

                          {/* Post to Jira */}
                          <div className="rounded-lg border border-indigo-400/40 bg-indigo-50 dark:bg-indigo-950/25 p-2.5 space-y-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Post to Jira</p>
                            <div className="flex items-end gap-2 flex-wrap">
                              <div className="flex flex-col gap-0.5 relative">
                                <span className="text-[10px] text-[var(--text-faint)]">Mention</span>
                                {!pickingUser ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      className="input text-xs py-1 text-left min-w-[10rem] hover:border-[var(--accent)] transition-colors"
                                      onClick={() => { setPickingUser(true); setUserQuery(''); }}
                                      title="Search for someone to mention"
                                    >
                                      {mention ? `@${mention.displayName}` : 'No mention'}
                                    </button>
                                    {mention && (
                                      <button className="text-[10px] text-[var(--text-faint)] hover:text-red-400 px-1"
                                        onClick={() => setMention(null)} title="Remove mention">×</button>
                                    )}
                                  </div>
                                ) : (
                                  <input
                                    autoFocus
                                    className="input text-xs py-1 min-w-[10rem]"
                                    placeholder="Search people…"
                                    value={userQuery}
                                    onChange={(e) => setUserQuery(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Escape') { setPickingUser(false); setUserQuery(''); } }}
                                    onBlur={() => setTimeout(() => setPickingUser(false), 160)}
                                  />
                                )}

                                {pickingUser && (userQuery.trim().length >= 2 || userSearching) && (
                                  <div className="absolute top-full left-0 mt-1 z-20 w-64 rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-xl max-h-56 overflow-y-auto">
                                    {userSearching && <p className="text-[11px] text-[var(--text-faint)] px-2.5 py-2">Searching…</p>}
                                    {!userSearching && userHits.length === 0 && (
                                      <p className="text-[11px] text-[var(--text-faint)] px-2.5 py-2">No people matched.</p>
                                    )}
                                    {userHits.map((u) => (
                                      <button
                                        key={u.accountId}
                                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--panel-2)] transition-colors"
                                        onMouseDown={(e) => { e.preventDefault(); setMention(u); setPickingUser(false); setUserQuery(''); }}
                                      >
                                        {u.avatar
                                          ? <img src={u.avatar} alt="" className="w-5 h-5 rounded-full shrink-0" />
                                          : <span className="w-5 h-5 rounded-full bg-[var(--panel-2)] shrink-0" />}
                                        <span className="min-w-0 flex-1">
                                          <span className="text-xs block truncate">{u.displayName}</span>
                                          {u.email && <span className="text-[10px] text-[var(--text-faint)] block truncate">{u.email}</span>}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <label className="flex flex-col gap-0.5 flex-1 min-w-[12rem]">
                                <span className="text-[10px] text-[var(--text-faint)]">Instruction</span>
                                <input className="input text-xs py-1" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
                              </label>
                              <label className="flex flex-col gap-0.5">
                                <span className="text-[10px] text-[var(--text-faint)]">Then set status</span>
                                <select className="input text-xs py-1" value={transitionId} onChange={(e) => setTransitionId(e.target.value)}>
                                  <option value="">Leave unchanged</option>
                                  {transitions.map((t) => <option key={t.id} value={t.id}>{t.to}</option>)}
                                </select>
                              </label>
                              <button className="btn-primary text-xs py-1.5 px-3" onClick={postUpdate} disabled={posting || !replyDraft.trim()}>
                                {posting ? 'Posting…' : 'Post update'}
                              </button>
                            </div>
                            <p className="text-[10px] text-[var(--text-faint)]">
                              Posts as a comment, led by the mention and instruction, then applies the status change.
                            </p>
                            {postMsg && (
                              <p className={`text-[11px] rounded px-2 py-1.5 border-l-4 ${postMsg.ok ? 'border-emerald-500 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200' : 'border-red-500 bg-red-100 dark:bg-red-950/40 text-red-900 dark:text-red-200'}`}>
                                {postMsg.ok ? '✓ ' : '✗ '}{postMsg.text}
                              </p>
                            )}
                          </div>

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
