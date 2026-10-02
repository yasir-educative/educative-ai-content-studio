// File-backed publishing-channel registry.
//
// A "channel" is one publishing destination: an Educative tenant, a WordPress site, or a dev.to
// account. Users add them from /channels; each one is a JSON file at data/channels/{id}.json.
//
// Secrets (WordPress application passwords, dev.to API keys, Educative cookies) live in those
// files alongside the rest of data/ — which is gitignored. They are NEVER returned to the browser:
// every read that crosses the API boundary goes through `redactChannel()`, which swaps secret
// values for a sentinel. On save, a field still holding the sentinel means "unchanged", so the
// edit form can round-trip without the client ever seeing the real value.

import { promises as fs, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import path from 'path';

export type ChannelType = 'educative' | 'wordpress' | 'devto' | 'substack';

export interface ChannelConfig {
  // --- WordPress ---
  siteUrl?: string;          // https://grokkingfrontend.com (no trailing slash)
  username?: string;         // WP user with upload + publish rights
  appPassword?: string;      // SECRET — Application Password, not the login password
  postType?: 'posts' | 'pages';
  defaultStatus?: 'draft' | 'publish' | 'pending' | 'private';

  // --- dev.to ---
  apiKey?: string;           // SECRET — dev.to API key
  organizationId?: string;   // publish under an org instead of the personal account
  defaultPublished?: boolean;// false → stays an unpublished dev.to draft
  tags?: string;             // comma-separated; dev.to allows max 4
  series?: string;           // optional dev.to series name
  useFirstImageAsCover?: boolean; // default true — first hosted image becomes main_image
  // dev.to has no image-upload API, so images are hosted in a public GitHub repo first.
  githubOwner?: string;
  githubRepo?: string;
  githubBranch?: string;     // defaults to "main"
  githubPathPrefix?: string; // defaults to "images"
  githubToken?: string;      // SECRET — fine-grained token with Contents: Read and write
  publicBaseUrl?: string;    // fallback image host: this app's own public origin

  // --- Substack (draft creation only) ---
  // Substack has no verified official publishing API, so this goes through the community
  // `python-substack` CLI driven by an authenticated browser session cookie.
  publicationUrl?: string;   // https://yourpublication.substack.com
  cookiesString?: string;    // SECRET — the complete Cookie header from a signed-in request
  subtitle?: string;         // default subtitle when a run supplies no summary
  cliPath?: string;          // path to the `substack` executable (default: "substack" on PATH)

  // --- Educative ---
  templateId?: string;
  categories?: string;
  pageType?: 'blog' | 'newsletter';
  flaskAuth?: string;        // SECRET — overrides EDUCATIVE_FLASK_AUTH for this channel
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  config: ChannelConfig;
  createdAt: string;
  updatedAt: string;
}

/** Config keys whose values must never leave the server. */
const SECRET_KEYS = ['appPassword', 'apiKey', 'flaskAuth', 'githubToken', 'cookiesString'] as const;
/** Sent to the client in place of a stored secret; sent back verbatim to mean "keep it". */
export const SECRET_MASK = '••••••••';

const DIR = path.join(process.cwd(), 'data', 'channels');
// Deleted channels move here instead of being unlinked. A channel holds credentials that are
// tedious to re-enter and cannot be recovered from anywhere else, so an accidental delete —
// a misclick, or a stray cleanup script — should never be final. `listChannels` only reads
// *.json directly in DIR, so trashed files are invisible to the app.
const TRASH = path.join(DIR, '.trash');
// Channels synthesized from env so a fresh checkout can publish without visiting /channels.
// Each disappears from the synthesized list once the user saves an override of the same id.
const DEFAULT_EDUCATIVE_ID = 'educative-default';
const DEFAULT_DEVTO_ID = 'devto-default';

function ensureDirSync() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'channel'
  );
}

function filePath(id: string): string {
  if (!/^[a-z0-9_-]+$/.test(id)) throw new Error(`invalid channel id: ${id}`);
  return path.join(DIR, `${id}.json`);
}

function readFile(id: string): Channel | null {
  try {
    return JSON.parse(readFileSync(filePath(id), 'utf8')) as Channel;
  } catch {
    return null;
  }
}

function writeFileAtomic(c: Channel) {
  ensureDirSync();
  const tmp = filePath(c.id) + '.tmp';
  writeFileSync(tmp, JSON.stringify(c, null, 2), 'utf8');
  renameSync(tmp, filePath(c.id));
}

/**
 * The implicit Educative destination. Keeps "Publish to Educative" working on a fresh checkout
 * with nothing configured, since the credentials already live in env.
 */
function defaultEducativeChannel(): Channel {
  return {
    id: DEFAULT_EDUCATIVE_ID,
    name: 'Educative',
    type: 'educative',
    config: {
      templateId: process.env.EDUCATIVE_TEMPLATE_ID || '',
      categories: '',
      pageType: 'blog',
    },
    createdAt: '',
    updatedAt: '',
  };
}

/**
 * The default dev.to destination, from env.
 *
 * Only offered when DEVTO_API_KEY is set — an unusable channel in the publish menu is worse
 * than no channel. GitHub image hosting is picked up from env too, and a missing GITHUB_TOKEN
 * is fine: it only matters once an article actually carries images, and the publisher says so
 * precisely at that point.
 */
function defaultDevToChannel(): Channel | null {
  const apiKey = process.env.DEVTO_API_KEY || '';
  if (!apiKey) return null;
  return {
    id: DEFAULT_DEVTO_ID,
    name: 'DEV Community',
    type: 'devto',
    config: {
      apiKey,
      organizationId: process.env.DEVTO_ORGANIZATION_ID || '',
      defaultPublished: /^(1|true|yes)$/i.test(process.env.DEVTO_PUBLISHED || ''),
      tags: process.env.DEVTO_TAGS || '',
      series: process.env.DEVTO_SERIES || '',
      useFirstImageAsCover: true,
      githubOwner: process.env.DEVTO_GITHUB_OWNER || '',
      githubRepo: process.env.DEVTO_GITHUB_REPO || '',
      githubBranch: process.env.DEVTO_GITHUB_BRANCH || 'main',
      githubPathPrefix: process.env.DEVTO_GITHUB_PATH_PREFIX || 'images',
      githubToken: process.env.DEVTO_GITHUB_TOKEN || '',
      publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
    },
    createdAt: '',
    updatedAt: '',
  };
}

/** Full channels including secrets. Server-side only. */
export function listChannels(): Channel[] {
  ensureDirSync();
  const out: Channel[] = [];
  for (const f of readdirSync(DIR)) {
    if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
    const c = readFile(f.replace(/\.json$/, ''));
    if (c) out.push(c);
  }
  // Keep Educative first, then group by type, then alphabetical — stable order in the dropdown.
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'educative' ? -1 : b.type === 'educative' ? 1 : a.type.localeCompare(b.type);
    return a.name.localeCompare(b.name);
  });
  if (!out.some((c) => c.type === 'educative')) out.unshift(defaultEducativeChannel());
  // Only synthesize the dev.to default when the user has not saved their own copy of it.
  if (!out.some((c) => c.id === DEFAULT_DEVTO_ID)) {
    const devto = defaultDevToChannel();
    if (devto) out.push(devto);
  }
  return out;
}

export function getChannel(id: string): Channel | null {
  const c = readFile(id);
  if (c) return c;
  if (id === DEFAULT_EDUCATIVE_ID) return defaultEducativeChannel();
  if (id === DEFAULT_DEVTO_ID) return defaultDevToChannel();
  return null;
}

/** Strip secrets for anything crossing the API boundary. */
export function redactChannel(c: Channel): Channel {
  const config: ChannelConfig = { ...c.config };
  for (const k of SECRET_KEYS) {
    if (config[k]) (config as any)[k] = SECRET_MASK;
  }
  return { ...c, config };
}

/** Merge an incoming config over the stored one, treating the mask as "leave this alone". */
function mergeConfig(existing: ChannelConfig, incoming: ChannelConfig): ChannelConfig {
  const next: ChannelConfig = { ...existing, ...incoming };
  for (const k of SECRET_KEYS) {
    const v = incoming[k];
    if (v === undefined || v === SECRET_MASK || v === '') {
      (next as any)[k] = existing[k];
    }
  }
  if (next.siteUrl) next.siteUrl = next.siteUrl.replace(/\/+$/, '');
  if (next.publicationUrl) next.publicationUrl = next.publicationUrl.replace(/\/+$/, '');
  if (next.publicBaseUrl) next.publicBaseUrl = next.publicBaseUrl.replace(/\/+$/, '');
  return next;
}

export function createChannel(input: { name: string; type: ChannelType; config: ChannelConfig }): Channel {
  const name = input.name.trim();
  if (!name) throw new Error('name is required');
  if (!['educative', 'wordpress', 'devto', 'substack'].includes(input.type)) throw new Error(`unsupported channel type: ${input.type}`);

  ensureDirSync();
  let id = slugify(name);
  if (existsSync(filePath(id)) || id === DEFAULT_EDUCATIVE_ID) {
    let i = 2;
    while (existsSync(filePath(`${id}-${i}`))) i++;
    id = `${id}-${i}`;
  }
  const now = new Date().toISOString();
  const c: Channel = { id, name, type: input.type, config: mergeConfig({}, input.config || {}), createdAt: now, updatedAt: now };
  validateChannel(c);
  writeFileAtomic(c);
  return c;
}

export function saveChannel(id: string, patch: { name?: string; config?: ChannelConfig }): Channel {
  const existing = getChannel(id);
  if (!existing) throw new Error(`unknown channel: ${id}`);
  const now = new Date().toISOString();
  const next: Channel = {
    id,
    name: patch.name?.trim() || existing.name,
    type: existing.type,
    config: mergeConfig(existing.config, patch.config || {}),
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
  validateChannel(next);
  writeFileAtomic(next);
  return next;
}

export async function deleteChannel(id: string): Promise<void> {
  // A synthesized default has no file to remove, and would simply reappear from env.
  if (id === DEFAULT_EDUCATIVE_ID && !existsSync(filePath(id))) {
    throw new Error('the built-in Educative channel cannot be deleted');
  }
  if (id === DEFAULT_DEVTO_ID && !existsSync(filePath(id))) {
    throw new Error('the built-in dev.to channel comes from the environment — clear DEVTO_API_KEY to remove it');
  }
  const src = filePath(id);
  if (!existsSync(src)) return;
  // Soft delete: move to .trash with a timestamp so an accidental removal is recoverable.
  if (!existsSync(TRASH)) mkdirSync(TRASH, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  renameSync(src, path.join(TRASH, `${id}.${stamp}.json`));
}

/** Channels previously deleted, newest first. Restorable by id. */
export function listTrashedChannels(): { id: string; name: string; type: ChannelType; deletedAt: string; file: string }[] {
  if (!existsSync(TRASH)) return [];
  const out = readdirSync(TRASH)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const c = JSON.parse(readFileSync(path.join(TRASH, f), 'utf8')) as Channel;
        const stamp = f.replace(/\.json$/, '').split('.').slice(1).join('.');
        return { id: c.id, name: c.name, type: c.type, deletedAt: stamp, file: f };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as { id: string; name: string; type: ChannelType; deletedAt: string; file: string }[];
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Put a trashed channel back. Fails if something already occupies its id. */
export function restoreChannel(file: string): Channel {
  if (!/^[A-Za-z0-9_.-]+\.json$/.test(file)) throw new Error(`invalid trash file: ${file}`);
  const src = path.join(TRASH, file);
  if (!existsSync(src)) throw new Error(`no trashed channel named ${file}`);
  const c = JSON.parse(readFileSync(src, 'utf8')) as Channel;
  if (existsSync(filePath(c.id))) throw new Error(`a channel with id "${c.id}" already exists — rename or delete it first`);
  renameSync(src, filePath(c.id));
  return c;
}

/** Fail fast on misconfiguration rather than at publish time. */
export function validateChannel(c: Channel): void {
  if (c.type === 'wordpress') {
    if (!c.config.siteUrl) throw new Error('WordPress channels need a site URL');
    if (!/^https?:\/\//i.test(c.config.siteUrl)) throw new Error('site URL must start with http:// or https://');
    if (!c.config.username) throw new Error('WordPress channels need a username');
    if (!c.config.appPassword) throw new Error('WordPress channels need an application password');
  }
  if (c.type === 'substack') {
    if (!c.config.publicationUrl) throw new Error('Substack channels need a publication URL');
    if (!/^https?:\/\//i.test(c.config.publicationUrl)) throw new Error('publication URL must start with http:// or https://');
    if (!c.config.cookiesString) throw new Error('Substack channels need the session Cookie header');
  }
  if (c.type === 'devto') {
    if (!c.config.apiKey) throw new Error('dev.to channels need an API key');
    // Incomplete GitHub settings are allowed here on purpose: a text-only article publishes
    // fine without an image host, and the dev.to publisher raises a precise error naming the
    // missing fields only when an article actually carries images.
  }
}
