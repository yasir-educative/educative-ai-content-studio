// Jira Cloud REST client for the Educative Content Queries board.
// Read-only for now: verify the connection and list matching issues.

import { getJiraConfig, isConfigured, type JiraConfig } from './jiraStore';

const USER_AGENT = 'EducativeContentStudio/1.0 (+https://www.educative.io)';

function authHeader(c: JiraConfig): string {
  return 'Basic ' + Buffer.from(`${c.email}:${c.apiToken}`).toString('base64');
}

// Boards live under the Agile API, which is a different base path from the core v3 API.
async function jiraFetch(
  c: JiraConfig,
  pathAndQuery: string,
  init: RequestInit = {},
  base = '/rest/api/3',
): Promise<any> {
  const url = `${c.siteUrl}${base}${pathAndQuery}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader(c),
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON surfaced below */
  }
  if (!res.ok) {
    const detail =
      json?.errorMessages?.join(' ') || json?.message || text.slice(0, 300) || res.statusText;
    if (res.status === 401) throw new Error(`Jira rejected the credentials (401). Check the email and API token. ${detail}`);
    if (res.status === 403) throw new Error(`Jira denied access (403). The account may lack permission on this project. ${detail}`);
    if (res.status === 404) throw new Error(`Jira endpoint not found (404). Check the site URL. ${detail}`);
    throw new Error(`Jira ${res.status}: ${detail}`);
  }
  if (json === null) throw new Error('Jira returned a non-JSON body — check the site URL points at a Jira Cloud site');
  return json;
}

/** Confirm the credentials work and report who they belong to. */
export async function testConnection(c: JiraConfig = getJiraConfig()) {
  if (!isConfigured(c)) throw new Error('Jira is not configured yet');
  const me = await jiraFetch(c, '/myself');
  return {
    accountId: me?.accountId || '',
    displayName: me?.displayName || '',
    email: me?.emailAddress || c.email,
  };
}

export interface JiraIssue {
  key: string;
  url: string;
  summary: string;
  status: string;
  statusCategory: string;
  priority: string;
  issueType: string;
  reporter: string;
  assignee: string;
  labels: string[];
  created: string;
  updated: string;
}

export interface QueryFilter {
  statuses?: string[];
  /** Restrict to the signed-in user's assigned issues. */
  mine?: boolean;
  /** Projects to search. Empty with mine=true means every project. */
  projectKeys?: string[];
}

const q = (s: string) => `"${s.replace(/"/g, '')}"`;

export function effectiveJql(c: JiraConfig, f: QueryFilter = {}): string {
  const clauses: string[] = [];
  const projects = (f.projectKeys || []).filter(Boolean);

  if (projects.length) {
    clauses.push(`project IN (${projects.map(q).join(', ')})`);
  } else if (c.jql?.trim()) {
    clauses.push(`(${c.jql.trim().replace(/\s+ORDER\s+BY\s+.*$/i, '')})`);
  } else if (c.projectKey?.trim()) {
    clauses.push(`project = ${q(c.projectKey.trim())}`);
  } else if (!f.mine) {
    // Searching every project is only sensible when narrowed to one assignee.
    throw new Error('Set a project key or a JQL query first');
  }

  if (f.mine) clauses.push('assignee = currentUser()');
  if (f.statuses?.length) clauses.push(`status IN (${f.statuses.map(q).join(', ')})`);

  return `${clauses.join(' AND ')} ORDER BY created DESC`;
}

function mapIssue(site: string, raw: any): JiraIssue {
  const f = raw?.fields || {};
  return {
    key: raw?.key || '',
    url: `${site}/browse/${raw?.key || ''}`,
    summary: f.summary || '',
    status: f.status?.name || '',
    statusCategory: f.status?.statusCategory?.key || '',
    priority: f.priority?.name || '',
    issueType: f.issuetype?.name || '',
    reporter: f.reporter?.displayName || '',
    assignee: f.assignee?.displayName || '',
    labels: Array.isArray(f.labels) ? f.labels : [],
    created: f.created || '',
    updated: f.updated || '',
  };
}

const FIELDS = 'summary,status,priority,issuetype,reporter,assignee,labels,created,updated';

/**
 * Fetch matching issues. Jira Cloud replaced GET /search with POST /search/jql;
 * older sites still only have /search, so fall back rather than fail.
 */
export async function fetchIssues(
  c: JiraConfig = getJiraConfig(),
  maxResults = 50,
  filter: QueryFilter = {},
): Promise<{ issues: JiraIssue[]; jql: string; total: number }> {
  if (!isConfigured(c)) throw new Error('Jira is not configured yet');
  const jql = effectiveJql(c, filter);

  let data: any;
  try {
    data = await jiraFetch(c, '/search/jql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, maxResults, fields: FIELDS.split(',') }),
    });
  } catch {
    data = await jiraFetch(
      c,
      `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=${encodeURIComponent(FIELDS)}`,
    );
  }

  const issues = (data?.issues || []).map((i: any) => mapIssue(c.siteUrl, i));
  return { issues, jql, total: Number(data?.total ?? issues.length) };
}

// ── Boards ───────────────────────────────────────────────────────────────────

const AGILE = '/rest/agile/1.0';

export interface JiraBoard {
  id: number;
  name: string;
  type: string;
  projectKey: string;
  projectName: string;
}

/**
 * Every board the account can see. Jira pages this at 50, and a large org has
 * hundreds, so follow isLast rather than returning a truncated first page.
 */
export async function fetchBoards(c: JiraConfig = getJiraConfig()): Promise<JiraBoard[]> {
  if (!isConfigured(c)) throw new Error('Jira is not configured yet');
  const out: JiraBoard[] = [];
  let startAt = 0;
  for (let page = 0; page < 20; page++) {
    const data = await jiraFetch(c, `/board?maxResults=50&startAt=${startAt}`, {}, AGILE);
    for (const b of data?.values || []) {
      const loc = b?.location || {};
      out.push({
        id: Number(b.id),
        name: b.name || '',
        type: b.type || '',
        projectKey: loc.projectKey || '',
        projectName: loc.projectName || '',
      });
    }
    if (data?.isLast !== false) break;
    startAt += data?.maxResults || 50;
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Issues on one board. Extra JQL from the config narrows the board's own filter. */
export async function fetchBoardIssues(
  c: JiraConfig,
  boardId: number,
  maxResults = 50,
): Promise<{ issues: JiraIssue[]; total: number }> {
  const params = new URLSearchParams({ maxResults: String(maxResults), fields: FIELDS });
  if (c.jql?.trim()) params.set('jql', c.jql.trim());
  const data = await jiraFetch(c, `/board/${boardId}/issue?${params}`, {}, AGILE);
  const issues = (data?.issues || []).map((i: any) => mapIssue(c.siteUrl, i));
  return { issues, total: Number(data?.total ?? issues.length) };
}

// ── Projects ─────────────────────────────────────────────────────────────────
// Business projects (Jira Work Management) have no agile board, so the board
// list never shows them. Content queries live in one, hence selection by project.

export interface JiraProject {
  key: string;
  name: string;
  type: string;
  archived: boolean;
}

export async function fetchProjects(c: JiraConfig = getJiraConfig()): Promise<JiraProject[]> {
  if (!isConfigured(c)) throw new Error('Jira is not configured yet');
  const out: JiraProject[] = [];
  let startAt = 0;
  for (let page = 0; page < 20; page++) {
    const data = await jiraFetch(c, `/project/search?maxResults=100&startAt=${startAt}&status=live`);
    for (const p of data?.values || []) {
      const name = p.name || '';
      // status=live already drops Jira-archived projects, but orgs also mark
      // retired and non-production boards in the name, which the API treats as
      // perfectly live. Those are noise in a picker, so flag them here.
      const inactive = /\[\s*(archived|deprecated|old|retired)\s*\]|\[\s*staging\s*\]|\bstaging\b|\bsandbox\b|-\s*test$/i.test(name);
      out.push({
        key: p.key || '',
        name,
        type: p.projectTypeKey || '',
        archived: inactive,
      });
    }
    if (data?.isLast !== false) break;
    startAt += data?.maxResults || 100;
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ── Statuses (filter facets) ─────────────────────────────────────────────────

export interface JiraStatus { name: string; category: string }

/** Distinct statuses available on a project, used to build the filter chips. */
export async function fetchProjectStatuses(
  c: JiraConfig,
  projectKey: string,
): Promise<JiraStatus[]> {
  const data = await jiraFetch(c, `/project/${encodeURIComponent(projectKey)}/statuses`);
  const seen = new Map<string, JiraStatus>();
  for (const type of Array.isArray(data) ? data : []) {
    for (const s of type?.statuses || []) {
      const name = s?.name || '';
      if (name && !seen.has(name)) {
        seen.set(name, { name, category: s?.statusCategory?.key || '' });
      }
    }
  }
  return [...seen.values()];
}

// ── Issue detail ─────────────────────────────────────────────────────────────

/** Atlassian Document Format is a nested node tree; flatten it to readable text. */
export function adfToText(node: any, depth = 0): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map((n) => adfToText(n, depth)).join('');

  const kids = () => adfToText(node.content, depth + 1);
  switch (node.type) {
    case 'text': return node.text || '';
    case 'hardBreak': return '\n';
    case 'paragraph': return kids() + '\n\n';
    case 'heading': return '#'.repeat(node.attrs?.level || 1) + ' ' + kids() + '\n\n';
    case 'bulletList':
    case 'orderedList': return kids();
    case 'listItem': return '- ' + kids().trim() + '\n';
    case 'codeBlock': return '```\n' + kids().trim() + '\n```\n\n';
    case 'blockquote': return '> ' + kids().trim() + '\n\n';
    case 'rule': return '---\n\n';
    case 'mediaSingle':
    case 'mediaGroup': return '[attachment]\n\n';
    case 'inlineCard': return node.attrs?.url || '';
    case 'mention': return '@' + (node.attrs?.text || '').replace(/^@/, '');
    case 'table': return kids() + '\n';
    case 'tableRow': return kids().trim() + '\n';
    case 'tableHeader':
    case 'tableCell': return kids().trim() + ' | ';
    default: return kids();
  }
}

export interface JiraComment { author: string; created: string; body: string }

export interface JiraIssueDetail extends JiraIssue {
  description: string;
  comments: JiraComment[];
  resolution: string;
  /** Author/collection/page mined from the text, when present. */
  ids: EducativeIds;
  /** Populated custom fields, resolved to their human names. */
  fields: Array<{ name: string; value: string }>;
}

// customfield_10234 tells the reader nothing, so map ids to names once per process.
let fieldNameCache: Map<string, string> | null = null;
async function fieldNames(c: JiraConfig): Promise<Map<string, string>> {
  if (fieldNameCache) return fieldNameCache;
  try {
    const all = await jiraFetch(c, '/field');
    const m = new Map<string, string>();
    for (const f of Array.isArray(all) ? all : []) if (f?.id && f?.name) m.set(f.id, f.name);
    fieldNameCache = m;
  } catch {
    fieldNameCache = new Map();
  }
  return fieldNameCache;
}

/** Render a custom field value, which may be a scalar, option object, or list. */
function fieldValue(v: any): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(fieldValue).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    if (v.type === 'doc' || v.content) return adfToText(v.content).trim();
    return String(v.displayName || v.name || v.value || v.emailAddress || '');
  }
  return '';
}

export async function fetchIssue(c: JiraConfig, key: string): Promise<JiraIssueDetail> {
  if (!isConfigured(c)) throw new Error('Jira is not configured yet');
  const data = await jiraFetch(c, `/issue/${encodeURIComponent(key)}?fields=*all`);
  const base = mapIssue(c.siteUrl, data);
  const f = data?.fields || {};

  const description = adfToText(f.description?.content).trim();
  const comments: JiraComment[] = (f.comment?.comments || []).map((cm: any) => ({
    author: cm?.author?.displayName || '',
    created: cm?.created || '',
    body: adfToText(cm?.body?.content).trim(),
  }));

  const names = await fieldNames(c);
  const fields: Array<{ name: string; value: string }> = [];
  for (const [id, raw] of Object.entries(f)) {
    if (!id.startsWith('customfield_')) continue;
    const value = fieldValue(raw);
    if (!value) continue;
    fields.push({ name: names.get(id) || id, value: value.slice(0, 500) });
  }
  fields.sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...base,
    description,
    resolution: f.resolution?.name || '',
    comments,
    ids: extractEducativeIds(description, base.summary, ...comments.map((x) => x.body), ...fields.map((x) => `${x.name}: ${x.value}`)),
    fields,
  };
}

// ── Educative identifiers ────────────────────────────────────────────────────
// Query tickets carry the author, collection and page they refer to, but the
// shape varies: sometimes labelled fields in the description, sometimes only an
// Educative URL. Both are mined so the detail pane can show them either way.

export interface EducativeIds {
  authorId?: string;
  collectionId?: string;
  pageId?: string;
  lessonUrl?: string;
}

/** Educative lesson URLs embed the three ids positionally. */
const URL_RE = /https?:\/\/(?:www\.)?educative\.io\/(?:api\/)?(?:collection\/)?(\d{6,})\/(\d{6,})\/(\d{6,})/i;

function labelled(text: string, words: string[]): string | undefined {
  for (const w of words) {
    // "Author ID: 123", "authorId = 123", "author_id 123"
    const re = new RegExp(`${w}\\s*(?:id)?\\s*[:=#]?\\s*(\\d{4,})`, 'i');
    const m = text.match(re);
    if (m) return m[1];
  }
  return undefined;
}

export function extractEducativeIds(...texts: (string | undefined)[]): EducativeIds {
  const text = texts.filter(Boolean).join('\n');
  if (!text.trim()) return {};
  const out: EducativeIds = {};

  const u = text.match(URL_RE);
  if (u) {
    out.authorId = u[1];
    out.collectionId = u[2];
    out.pageId = u[3];
    out.lessonUrl = u[0];
  }

  // Explicit labels win over anything inferred from a URL.
  out.authorId = labelled(text, ['author[_ ]?id', 'author']) || out.authorId;
  out.collectionId = labelled(text, ['collection[_ ]?id', 'collection', 'course[_ ]?id']) || out.collectionId;
  out.pageId = labelled(text, ['page[_ ]?id', 'lesson[_ ]?id', 'page']) || out.pageId;

  if (!out.lessonUrl) {
    const any = text.match(/https?:\/\/(?:www\.)?educative\.io\/[^\s)\]]+/i);
    if (any) out.lessonUrl = any[0];
  }
  return out;
}
