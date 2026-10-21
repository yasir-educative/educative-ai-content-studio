// Jira Cloud REST client for the Educative Content Queries board.
// Read-only for now: verify the connection and list matching issues.

import { getJiraConfig, isConfigured, type JiraConfig } from './jiraStore';

const USER_AGENT = 'EducativeContentStudio/1.0 (+https://www.educative.io)';

function authHeader(c: JiraConfig): string {
  return 'Basic ' + Buffer.from(`${c.email}:${c.apiToken}`).toString('base64');
}

async function jiraFetch(c: JiraConfig, pathAndQuery: string, init: RequestInit = {}): Promise<any> {
  const url = `${c.siteUrl}/rest/api/3${pathAndQuery}`;
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
