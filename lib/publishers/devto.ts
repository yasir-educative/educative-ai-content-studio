// dev.to (Forem) publisher.
//
// dev.to stores manually-uploaded images in its own S3/Cloudinary buckets, but the public API
// exposes no upload endpoint — an article may only reference images that are already online.
// So the flow mirrors the WordPress one with GitHub standing in for the media library:
//
//   collect local images → PUT each into a public GitHub repo → rewrite the body with the raw
//   URLs → POST /articles (or PUT /articles/{id} when this blog already has one here)
//
// The article body is sent as `body_markdown`, converted from the pipeline's HTML, because
// dev.to strips most inline HTML (including <figure>) from article bodies.

import type { Channel } from '../channelStore';
import type { PublishRequest, PublishResult } from './types';
import { findUnresolvedImages } from './images';
import { htmlToMarkdown } from './htmlToMarkdown';
import { inspectGitHubConfig, testGitHub, type HostedImage } from './github';
import { hostImagesForChannel, buildImageKey } from './imageHost';

const DEVTO_API = 'https://dev.to/api';
const DEVTO_ACCEPT = 'application/vnd.forem.api-v1+json';
const USER_AGENT = 'EducativeContentStudio/1.0';
/** dev.to allows at most four tags per article. */
const MAX_TAGS = 4;
/** `description` doubles as the SEO/preview blurb and is truncated by dev.to past this. */
const MAX_DESCRIPTION = 250;

async function devtoFetch(c: Channel, path: string, init: RequestInit = {}, attempt = 0): Promise<any> {
  const key = c.config.apiKey || '';
  if (!key) throw new Error('dev.to channel has no API key');

  const res = await fetch(`${DEVTO_API}${path}`, {
    ...init,
    headers: {
      'api-key': key,
      Accept: DEVTO_ACCEPT,
      'User-Agent': USER_AGENT,
      ...(init.headers || {}),
    },
  });

  // dev.to rate-limits article writes fairly aggressively; back off and retry rather than
  // surfacing a 429 the user can do nothing about.
  if (res.status === 429 && attempt < 3) {
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, waitMs));
    return devtoFetch(c, path, init, attempt + 1);
  }

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body — reported verbatim below */
  }
  if (!res.ok) {
    const detail =
      json?.error ||
      (json?.errors ? JSON.stringify(json.errors) : '') ||
      text.slice(0, 300) ||
      res.statusText;
    const duplicateTitle = /already been used/i.test(String(detail));
    const hint =
      res.status === 401
        ? ' (check the API key and that it has not been revoked)'
        : duplicateTitle
        ? // dev.to blocks re-posting the same title within five minutes. A publish that timed out
          // may well have succeeded, so say so rather than inviting a blind retry.
          ' — dev.to blocks repeat titles for five minutes. If an earlier publish timed out it probably succeeded; check your dev.to dashboard before retrying.'
        : res.status === 422
        ? ' (dev.to rejected a field — often a bad main_image URL or YAML front matter in the body)'
        : '';
    const err: any = new Error(`dev.to ${res.status}: ${detail}${hint}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/** dev.to tags: lowercase alphanumeric, de-duplicated, at most four. */
function normalizeTags(raw?: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const t of raw.split(',')) {
    const tag = t.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

/** Plain-text opening of the article, used when the caller supplies no summary. */
function deriveDescription(markdown: string): string {
  const firstPara = markdown
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#') && !l.startsWith('!') && !l.startsWith('>') && !l.startsWith('```') && !l.startsWith('|'));
  if (!firstPara) return '';
  return firstPara
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

export async function publishToDevTo(req: PublishRequest): Promise<PublishResult> {
  const c = req.channel;
  if (!req.html && !req.markdown) throw new Error('dev.to publishing needs HTML or markdown');

  const warnings: string[] = [];
  let html = req.html || '';
  let hosted: HostedImage[] = [];

  // --- 1. Host the images -----------------------------------------------------------------
  if (html) {
    const resolved = await hostImagesForChannel(c, html, buildImageKey(req.title, req.blogId));
    html = resolved.html;
    hosted = resolved.hosted;
    warnings.push(...resolved.warnings);
  }

  // --- 2. Build the body ------------------------------------------------------------------
  const bodyMarkdown = html ? htmlToMarkdown(html) : req.markdown!;
  const unresolved = findUnresolvedImages(bodyMarkdown);
  if (unresolved.length) warnings.push(`${unresolved.length} image(s) still point at this app and will not load on dev.to.`);

  // --- 3. Build the payload ---------------------------------------------------------------
  // `published` can be forced per request; otherwise the channel's default decides draft vs live.
  const published = req.status ? req.status === 'publish' || req.status === 'published' : !!c.config.defaultPublished;

  const article: Record<string, any> = { title: req.title, body_markdown: bodyMarkdown, published };

  // Tags must be sent as an ARRAY. The comma-separated string form is accepted with a 201 but
  // silently dropped — verified against the live API: a string yields tag_list "".
  const tags = normalizeTags(c.config.tags);
  if (tags.length) article.tags = tags;

  const description = (req.summary || deriveDescription(bodyMarkdown)).slice(0, MAX_DESCRIPTION);
  if (description) article.description = description;

  // Cover image: the first hosted image, unless the channel opts out.
  const coverImage = c.config.useFirstImageAsCover === false ? '' : hosted[0]?.url || '';
  if (coverImage) article.main_image = coverImage;

  if (req.canonicalUrl) article.canonical_url = req.canonicalUrl;
  if (c.config.series) article.series = c.config.series;
  if (c.config.organizationId) article.organization_id = Number(c.config.organizationId);

  // --- 4. Create, or update the article this blog already has here ------------------------
  const existingId = req.existingExternalId;
  const result = existingId
    ? await devtoFetch(c, `/articles/${existingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article }),
      })
    : await devtoFetch(c, '/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article }),
      });

  // An unpublished article has no public URL yet — send the author to the dev.to editor instead.
  const url = result?.url || result?.canonical_url || (result?.id ? `https://dev.to/dashboard` : '');
  if (!result?.published) {
    warnings.push('Saved as a dev.to draft. Publish it from the dashboard, or enable "Publish immediately" on this channel.');
  }

  return {
    url,
    externalId: String(result?.id ?? ''),
    mediaCount: hosted.length,
    warnings,
    meta: {
      published: result?.published ?? published,
      slug: result?.slug,
      tags,
      mainImage: coverImage || undefined,
      updated: !!existingId,
      images: Object.fromEntries(hosted.map((h) => [h.fileName, h.url])),
    },
  };
}

/** Credential check used by the "Test" button on /channels. Covers dev.to and its image host. */
export async function testDevTo(c: Channel): Promise<{ ok: true; detail: string }> {
  const me = await devtoFetch(c, '/users/me', { method: 'GET' });
  const name = me?.username ? `@${me.username}` : me?.name || 'unknown user';

  const { cfg: gh, missing, partial } = inspectGitHubConfig(c.config);
  if (!gh) {
    const fallback = c.config.publicBaseUrl || process.env.PUBLIC_BASE_URL;
    const imageNote = partial
      ? `GitHub image hosting is incomplete — missing: ${missing.join(', ')}. Articles with images will be refused.`
      : fallback
      ? `Images will be linked from ${fallback}.`
      : 'No image host configured — articles with images will not render them.';
    return { ok: true, detail: `Connected as ${name}. ${imageNote}` };
  }
  const ghDetail = await testGitHub(gh);
  return { ok: true, detail: `Connected as ${name}. ${ghDetail}.` };
}
