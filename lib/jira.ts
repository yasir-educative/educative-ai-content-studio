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

export function effectiveJql(c: JiraConfig): string {
  if (c.jql?.trim()) return c.jql.trim();
  if (c.projectKey?.trim()) return `project = "${c.projectKey.trim()}" ORDER BY created DESC`;
  throw new Error('Set a project key or a JQL query first');
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
): Promise<{ issues: JiraIssue[]; jql: string; total: number }> {
  if (!isConfigured(c)) throw new Error('Jira is not configured yet');
  const jql = effectiveJql(c);

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
      out.push({
        key: p.key || '',
        name: p.name || '',
        type: p.projectTypeKey || '',
        archived: /\[ARCHIVED\]/i.test(p.name || ''),
      });
    }
    if (data?.isLast !== false) break;
    startAt += data?.maxResults || 100;
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
