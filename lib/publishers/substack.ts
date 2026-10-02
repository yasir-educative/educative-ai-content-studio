// Substack publisher — DRAFT CREATION ONLY.
//
// Substack has no verified official API for creating posts or uploading article images; the
// documentation link on their API terms currently 404s. Programmatic access therefore goes
// through the community `python-substack` client, which drives Substack's undocumented
// interfaces using an authenticated browser session cookie. That project is unaffiliated with
// Substack and its interfaces may change without notice.
//
// Because of that, this publisher deliberately stops at the draft:
//
//   * It shells out to `substack drafts create` and nothing else.
//   * It NEVER calls `drafts publish`, and never passes --no-send/--yes.
//   * A draft is invisible to subscribers and sends no email, so a misfire cannot reach readers.
//
// Publishing and newsletter delivery stay a human decision in the Substack editor. That also
// sidesteps the one-way door in Substack's model: editing an already-emailed post updates the
// web and app versions but never resends or corrects the email already delivered.
//
// Images reuse the same public GitHub host as the dev.to channel, so the markdown carries
// absolute URLs and the client has no local uploads to perform.

import { spawn } from 'child_process';
import { promises as fs, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import type { Channel } from '../channelStore';
import type { PublishRequest, PublishResult } from './types';
import { findUnresolvedImages } from './images';
import { htmlToMarkdown } from './htmlToMarkdown';
import { hostImagesForChannel, buildImageKey } from './imageHost';
import { inspectGitHubConfig, testGitHub } from './github';

/** Commands this publisher is allowed to run. `publish` is intentionally absent. */
const ALLOWED_COMMANDS = ['status', 'publications', 'drafts'] as const;

const DEFAULT_TIMEOUT_MS = 120_000;

interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Run the python-substack CLI with the channel's credentials supplied through the environment.
 *
 * The cookie string is passed via env, never on the command line, so it cannot leak into a
 * process listing. It is also scrubbed from anything this module surfaces or logs.
 */
function resolveCli(c: Channel): string {
  const explicit = (c.config.cliPath || '').trim();
  if (explicit) return explicit;
  // The repo ships a virtualenv with python-substack installed; prefer it over PATH so the
  // channel works without the operator exporting anything.
  const bundled = path.join(process.cwd(), '.venv', 'bin', 'substack');
  if (existsSync(bundled)) return bundled;
  return process.env.SUBSTACK_CLI || 'substack';
}

function runCli(c: Channel, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CliResult> {
  const bin = resolveCli(c);
  const head = args.find((a) => !a.startsWith('-'));
  if (!head || !ALLOWED_COMMANDS.includes(head as any)) {
    // Defence in depth: even a future caller cannot reach `drafts publish` through here, since
    // `publish` is checked separately below.
    throw new Error(`Refusing to run unsupported substack command: ${head || '(none)'}`);
  }
  if (args.includes('publish')) {
    throw new Error('This channel creates drafts only — publishing must be done from the Substack editor');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: {
        ...process.env,
        PUBLICATION_URL: c.config.publicationUrl || '',
        COOKIES_STRING: c.config.cookiesString || '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`substack CLI timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err: any) => {
      clearTimeout(timer);
      if (err?.code === 'ENOENT') {
        reject(new Error(
          `The "${bin}" CLI was not found. Install it on this machine with "pip install python-substack", or set the channel's CLI path to the executable inside your virtualenv.`,
        ));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

/** Never let the session cookie reach a message, a log line, or the UI. */
function scrub(text: string, c: Channel): string {
  const cookie = c.config.cookiesString || '';
  let out = text;
  if (cookie) out = out.split(cookie).join('«cookie redacted»');
  // Also mask anything that looks like a raw Substack session cookie in CLI output.
  return out.replace(/(substack\.sid|connect\.sid)=[^;\s]+/gi, '$1=«redacted»');
}

function cliError(c: Channel, action: string, detail: string): Error {
  // API failures arrive as a JSON blob — `{"error":{"message":"Please sign in","status_code":401}}`
  // on stderr with exit 1. Surface the message, not the whole payload.
  const parsed = parseJsonOutput(detail);
  const err = parsed?.error;
  const readable = err
    ? `${typeof err === 'string' ? err : err.message || JSON.stringify(err)}${
        typeof err === 'object' && err.status_code ? ` (HTTP ${err.status_code})` : ''
      }`
    : detail;
  const clean = scrub(readable.trim(), c).slice(0, 400) || 'unknown error';
  const hint = /401|403|unauthor|forbidden|please sign in|login|session/i.test(clean)
    ? ' — the session cookie is probably expired; copy a fresh Cookie header from an authenticated Substack request.'
    : '';
  return new Error(`Substack ${action} failed: ${clean}${hint}`);
}

/** The CLI prints JSON when given --json, but may prepend progress lines. */
function parseJsonOutput(stdout: string): any {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall back to the last balanced JSON object or array in the output.
    const start = Math.max(trimmed.lastIndexOf('{'), trimmed.lastIndexOf('['));
    for (let i = start; i >= 0; i--) {
      const ch = trimmed[i];
      if (ch !== '{' && ch !== '[') continue;
      try {
        return JSON.parse(trimmed.slice(i));
      } catch {
        /* keep scanning backwards */
      }
    }
    return null;
  }
}

function draftUrl(c: Channel, id: string | number): string {
  const base = (c.config.publicationUrl || '').replace(/\/+$/, '');
  return id ? `${base}/publish/post/${id}` : `${base}/publish/posts/drafts`;
}

/**
 * Run the CLI and return its parsed JSON, raising on failure.
 *
 * An API failure exits 1 with `{"error":{"message":"Please sign in","status_code":401}}` on
 * stderr. The payload is also checked on a zero exit, so a future version that reports errors
 * without a failing status cannot be mistaken for a successful publish.
 */
async function runCliJson(c: Channel, action: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<any> {
  const r = await runCli(c, args, timeoutMs);
  if (r.code !== 0) {
    throw cliError(c, action, r.stderr || r.stdout || `exit code ${r.code}`);
  }
  const json = parseJsonOutput(r.stdout);
  const err = json?.error;
  if (err) {
    const message = typeof err === 'string' ? err : err.message || JSON.stringify(err);
    const status = typeof err === 'object' && err.status_code ? ` (HTTP ${err.status_code})` : '';
    throw cliError(c, action, `${message}${status}`);
  }
  if (json === null && r.stdout.trim()) {
    throw cliError(c, action, `could not parse CLI output: ${r.stdout.slice(0, 200)}`);
  }
  return json;
}

export async function publishToSubstack(req: PublishRequest): Promise<PublishResult> {
  const c = req.channel;
  if (!c.config.publicationUrl) throw new Error('Substack channel has no publication URL');
  if (!c.config.cookiesString) throw new Error('Substack channel has no session cookies');
  if (!req.html && !req.markdown) throw new Error('Substack publishing needs HTML or markdown');

  const warnings: string[] = [];
  let html = req.html || '';
  let hostedCount = 0;

  // --- 1. Host the images so the markdown carries absolute URLs ---------------------------
  if (html) {
    const resolved = await hostImagesForChannel(c, html, buildImageKey(req.title, req.blogId));
    html = resolved.html;
    hostedCount = resolved.hosted.length;
    warnings.push(...resolved.warnings);
  }

  const markdown = html ? htmlToMarkdown(html) : req.markdown!;
  const unresolved = findUnresolvedImages(markdown);
  if (unresolved.length) warnings.push(`${unresolved.length} image(s) still point at this app and will not load on Substack.`);

  // --- 2. Hand the markdown to the CLI as a file ------------------------------------------
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'substack-draft-'));
  const file = path.join(dir, 'post.md');
  try {
    await fs.writeFile(file, markdown, 'utf8');

    const args = ['--json', 'drafts', 'create', file, '--title', req.title];
    const subtitle = req.summary || c.config.subtitle || '';
    if (subtitle) args.push('--subtitle', subtitle.slice(0, 200));
    if (req.slug) args.push('--slug', req.slug);

    const json = await runCliJson(c, 'draft creation', args);
    const id = json?.id ?? json?.draft_id ?? json?.draft?.id ?? '';
    if (!id) throw new Error('Substack draft creation returned no draft id.');

    warnings.push('Created as a Substack draft. Review it in the editor and publish from there — this channel never publishes or emails subscribers.');

    return {
      url: draftUrl(c, id),
      externalId: String(id),
      mediaCount: hostedCount,
      warnings,
      meta: {
        status: 'draft',
        delivery: 'none',
        draftId: String(id),
        title: json?.draft_title || req.title,
      },
    };
  } finally {
    // Markdown can contain unpublished content — do not leave it in the temp dir.
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Credential check used by the "Test" button on /channels. Covers the CLI, the session and the image host. */
export async function testSubstack(c: Channel): Promise<{ ok: true; detail: string }> {
  if (!c.config.publicationUrl) throw new Error('Substack channel has no publication URL');
  if (!c.config.cookiesString) throw new Error('Substack channel has no session cookies');

  const parsed = await runCliJson(c, 'status check', ['--json', 'status'], 45_000);
  const who =
    parsed?.email || parsed?.user?.email || parsed?.name || parsed?.publication?.name ||
    parsed?.publication?.subdomain || 'session accepted';

  const { cfg: gh, missing, partial } = inspectGitHubConfig(c.config);
  let imageNote: string;
  if (gh) {
    imageNote = await testGitHub(gh);
  } else if (partial) {
    imageNote = `GitHub image hosting is incomplete — missing: ${missing.join(', ')}. Posts with images will be refused.`;
  } else {
    const fallback = c.config.publicBaseUrl || process.env.PUBLIC_BASE_URL;
    imageNote = fallback
      ? `Images will be linked from ${fallback}.`
      : 'No image host configured — posts with images will not render them.';
  }

  return { ok: true, detail: `${who}. ${imageNote}. Drafts only — this channel never publishes.` };
}
