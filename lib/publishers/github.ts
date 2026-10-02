// GitHub Contents API as an image host.
//
// dev.to's public API has no image-upload endpoint — an article may only reference images that
// are already online. So generated images go into a public GitHub repo first, and the article
// links the raw URLs.
//
// Two details matter for durability:
//   * URLs are pinned to the upload's commit SHA, not to a branch. A branch URL would change
//     meaning if the file is ever replaced; a commit URL is immutable.
//   * The Contents API's own `download_url` is explicitly documented as expiring, so it is never
//     persisted — raw.githubusercontent.com URLs are built by hand instead.

import type { LocalImage } from './images';
import { readImage } from './images';

const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'EducativeContentStudio/1.0';

export interface GitHubHostConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  /** Repo directory images are written under. Defaults to "images". */
  pathPrefix?: string;
}

export interface HostedImage {
  /** The original /api/images/... src this replaces. */
  src: string;
  /** Immutable raw URL pinned to the commit that added the file. */
  url: string;
  repoPath: string;
  commitSha: string;
  fileName: string;
  alt: string;
}

/**
 * Read the GitHub host settings, also reporting a half-filled configuration.
 *
 * Partial settings are the dangerous case: treated as "no host" they publish an article whose
 * images 404. The caller raises a precise error instead, but only when images are actually
 * present — a text-only article needs no host at all.
 */
export function inspectGitHubConfig(config: Record<string, any>): { cfg: GitHubHostConfig | null; missing: string[]; partial: boolean } {
  const fields = {
    owner: (config.githubOwner || '').trim(),
    repository: (config.githubRepo || '').trim(),
    token: (config.githubToken || '').trim(),
  };
  const missing = Object.entries(fields).filter(([, v]) => !v).map(([k]) => k);
  const partial = missing.length > 0 && missing.length < 3;
  return { cfg: missing.length ? null : readGitHubConfig(config), missing, partial };
}

export function readGitHubConfig(config: Record<string, any>): GitHubHostConfig | null {
  const owner = (config.githubOwner || '').trim();
  const repo = (config.githubRepo || '').trim();
  const token = (config.githubToken || '').trim();
  if (!owner || !repo || !token) return null;
  return {
    owner,
    repo,
    branch: (config.githubBranch || '').trim() || 'main',
    token,
    pathPrefix: (config.githubPathPrefix || '').trim().replace(/^\/+|\/+$/g, '') || 'images',
  };
}

function headers(cfg: GitHubHostConfig, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': USER_AGENT,
    ...extra,
  };
}

async function ghFetch(cfg: GitHubHostConfig, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${GITHUB_API}${path}`, { ...init, headers: headers(cfg, (init.headers as any) || {}) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body — reported verbatim below */
  }
  if (!res.ok) {
    const detail = json?.message || text.slice(0, 300) || res.statusText;
    const err: any = new Error(`GitHub ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/** Current blob SHA for a repo path, or null when the path is free. */
async function existingSha(cfg: GitHubHostConfig, repoPath: string): Promise<string | null> {
  try {
    const json = await ghFetch(
      cfg,
      `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeRepoPath(repoPath)}?ref=${encodeURIComponent(cfg.branch)}`,
      { method: 'GET' },
    );
    return Array.isArray(json) ? null : json?.sha || null;
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

/** Percent-encode each segment but keep the slashes that make up the path. */
function encodeRepoPath(repoPath: string): string {
  return repoPath.split('/').map(encodeURIComponent).join('/');
}

/**
 * Create (or replace) one file via the Contents API.
 *
 * A 409/422 means the path already holds a blob — the API then requires that blob's SHA before
 * it will overwrite. Fetch it and retry once rather than failing the publish.
 */
async function putFile(
  cfg: GitHubHostConfig,
  repoPath: string,
  base64: string,
  message: string,
): Promise<{ commitSha: string }> {
  const send = (sha?: string) =>
    ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeRepoPath(repoPath)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, branch: cfg.branch, content: base64, ...(sha ? { sha } : {}) }),
    });

  let json: any;
  try {
    json = await send();
  } catch (e: any) {
    if (e?.status !== 409 && e?.status !== 422) throw e;
    const sha = await existingSha(cfg, repoPath);
    if (!sha) throw e;
    json = await send(sha);
  }

  const commitSha = json?.commit?.sha;
  if (!commitSha) throw new Error(`GitHub upload of ${repoPath} returned no commit SHA`);
  return { commitSha };
}

export function rawUrl(cfg: GitHubHostConfig, commitSha: string, repoPath: string): string {
  return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${commitSha}/${encodeRepoPath(repoPath)}`;
}

/**
 * Confirm the raw URL actually serves. raw.githubusercontent.com can lag a moment behind the
 * commit, so a miss is retried briefly before being reported.
 */
async function verifyRawUrl(url: string, attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
      if (res.ok) {
        await res.arrayBuffer();
        return true;
      }
    } catch {
      /* network blip — retried below */
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  return false;
}

/**
 * Upload every image under `images/{blogKey}/` and return immutable raw URLs.
 *
 * Uploads run sequentially: the Contents API serializes writes to a branch, and parallel PUTs
 * race each other into 409s.
 */
export async function uploadImages(
  cfg: GitHubHostConfig,
  images: LocalImage[],
  blogKey: string,
): Promise<{ hosted: HostedImage[]; warnings: string[] }> {
  const hosted: HostedImage[] = [];
  const warnings: string[] = [];

  for (const img of images) {
    const repoPath = `${cfg.pathPrefix}/${blogKey}/${img.fileName}`;
    try {
      const buffer = await readImage(img);
      const { commitSha } = await putFile(cfg, repoPath, buffer.toString('base64'), `Add ${blogKey}/${img.fileName}`);
      const url = rawUrl(cfg, commitSha, repoPath);
      if (!(await verifyRawUrl(url))) {
        warnings.push(`Uploaded ${img.fileName} but ${url} did not resolve — is the repository public?`);
      }
      hosted.push({ src: img.src, url, repoPath, commitSha, fileName: img.fileName, alt: img.alt });
    } catch (e: any) {
      // One bad image must not sink the article — record it and carry on.
      warnings.push(`Image ${img.fileName} was not uploaded to GitHub: ${e?.message || e}`);
    }
  }

  return { hosted, warnings };
}

/**
 * Confirm the token can actually write, by writing.
 *
 * The repository object's `permissions.push` is NOT a usable signal: it reports the *account's*
 * role on the repo, so a read-only fine-grained token on your own repo still reports
 * `push: true`. Verified against the live API — that false positive is why this probes for real:
 * it creates a tiny file and deletes it again.
 */
export async function testGitHub(cfg: GitHubHostConfig): Promise<string> {
  const repo = await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}`, { method: 'GET' });
  if (repo?.private) {
    throw new Error(`${cfg.owner}/${cfg.repo} is private — dev.to readers could not load the images`);
  }

  const probePath = `${cfg.pathPrefix}/.write-probe-${Date.now().toString(36)}`;
  let blobSha: string;
  try {
    const created = await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeRepoPath(probePath)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Write-permission probe from Educative AI Content Studio',
        branch: cfg.branch,
        content: Buffer.from('write probe').toString('base64'),
      }),
    });
    blobSha = created?.content?.sha;
  } catch (e: any) {
    if (e?.status === 403 || e?.status === 404) {
      throw new Error(
        `GitHub token cannot write to ${cfg.owner}/${cfg.repo} — grant the fine-grained token Contents: Read and write on this repository (it currently has read access only)`,
      );
    }
    throw e;
  }

  // Tidy up. A leftover probe file is harmless, so a failed delete is not worth failing the test.
  if (blobSha) {
    try {
      await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeRepoPath(probePath)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Remove write-permission probe', branch: cfg.branch, sha: blobSha }),
      });
    } catch (e: any) {
      console.warn(`[github] could not remove probe file ${probePath}: ${e?.message}`);
    }
  }

  return `GitHub ${cfg.owner}/${cfg.repo} (public, branch ${cfg.branch}) is writable`;
}
