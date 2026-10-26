// File-backed Jira connection for the Educative Content Queries board.
//
// Stored at data/jira.json (gitignored). The API token is a secret and is NEVER
// returned to the browser: reads that cross the API boundary go through
// redactJira(), which swaps it for a sentinel. On save, a token still holding
// the sentinel means "unchanged", so the form round-trips without the client
// ever seeing the real value. Same contract as channelStore.

import { promises as fs, existsSync, readFileSync } from 'fs';
import path from 'path';

export const SECRET_SENTINEL = '__UNCHANGED__';

export interface JiraConfig {
  /** https://your-org.atlassian.net — no trailing slash */
  siteUrl: string;
  /** Atlassian account email the API token belongs to */
  email: string;
  /** SECRET — Atlassian API token */
  apiToken: string;
  /** Project key, e.g. CONTENT. Used to build the default JQL. */
  projectKey?: string;
  /** Optional JQL override. When set it wins over projectKey. */
  jql?: string;
  /** The board opened by default on the queries page. */
  defaultBoardId?: number;
  /** Other boards kept available to switch to. Always includes the default. */
  enabledBoardIds?: number[];
  /** Boards the user hid from the picker. They stay hidden until restored. */
  hiddenProjectKeys?: string[];
  /** Facet selections applied on load, keyed by numeric custom field id. */
  defaultFacets?: Record<string, string>;
  /** Boards shown as one-click boxes above the list. User-defined. */
  quickBoards?: string[];
  updatedAt?: string;
}

const FILE = path.join(process.cwd(), 'data', 'jira.json');

const EMPTY: JiraConfig = { siteUrl: '', email: '', apiToken: '' };

export function getJiraConfig(): JiraConfig {
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
      return { ...EMPTY, ...parsed };
    }
  } catch {
    // unreadable config — treat as unconfigured
  }
  return { ...EMPTY };
}

export function isConfigured(c: JiraConfig = getJiraConfig()): boolean {
  return !!(c.siteUrl && c.email && c.apiToken);
}

/** Safe to send to the browser: the token becomes a sentinel. */
export function redactJira(c: JiraConfig = getJiraConfig()) {
  return {
    siteUrl: c.siteUrl,
    email: c.email,
    apiToken: c.apiToken ? SECRET_SENTINEL : '',
    projectKey: c.projectKey || '',
    jql: c.jql || '',
    defaultBoardId: c.defaultBoardId ?? null,
    enabledBoardIds: c.enabledBoardIds ?? [],
    hiddenProjectKeys: c.hiddenProjectKeys ?? [],
    defaultFacets: c.defaultFacets ?? {},
    quickBoards: c.quickBoards ?? [],
    configured: isConfigured(c),
  };
}

export async function saveJiraConfig(patch: Partial<JiraConfig>): Promise<JiraConfig> {
  const existing = getJiraConfig();
  const siteUrl = String(patch.siteUrl ?? existing.siteUrl).trim().replace(/\/+$/, '');
  if (siteUrl && !/^https?:\/\//i.test(siteUrl)) {
    throw new Error('Site URL must start with http:// or https://');
  }
  // Keep the stored token unless a real replacement arrives. The sentinel means
  // the form never saw it; blank means the field was simply left alone. Treating
  // blank as a new value used to wipe a working token on any unrelated save, so
  // clearing credentials is DELETE only, never a side effect of an edit.
  const incoming = patch.apiToken;
  const apiToken =
    incoming === undefined || incoming === SECRET_SENTINEL || String(incoming).trim() === ''
      ? existing.apiToken
      : String(incoming).trim();

  const next: JiraConfig = {
    siteUrl,
    email: String(patch.email ?? existing.email).trim(),
    apiToken,
    projectKey: String(patch.projectKey ?? existing.projectKey ?? '').trim(),
    jql: String(patch.jql ?? existing.jql ?? '').trim(),
    defaultBoardId:
      patch.defaultBoardId === undefined ? existing.defaultBoardId : Number(patch.defaultBoardId) || undefined,
    // The default is always selectable, so keep it in the list regardless.
    enabledBoardIds: (() => {
      const ids = patch.enabledBoardIds === undefined ? existing.enabledBoardIds ?? [] : patch.enabledBoardIds.map(Number);
      const def = patch.defaultBoardId === undefined ? existing.defaultBoardId : Number(patch.defaultBoardId) || undefined;
      const set = new Set(ids.filter(Boolean));
      if (def) set.add(def);
      return [...set];
    })(),
    hiddenProjectKeys:
      patch.hiddenProjectKeys === undefined
        ? existing.hiddenProjectKeys ?? []
        : [...new Set(patch.hiddenProjectKeys.map((k) => String(k).trim()).filter(Boolean))],
    defaultFacets:
      patch.defaultFacets === undefined ? existing.defaultFacets ?? {} : patch.defaultFacets,
    quickBoards:
      patch.quickBoards === undefined
        ? existing.quickBoards ?? []
        : [...new Set(patch.quickBoards.map((k) => String(k).trim()).filter(Boolean))],
    updatedAt: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export async function clearJiraConfig(): Promise<void> {
  try {
    await fs.unlink(FILE);
  } catch {
    // already absent
  }
}
