// WordPress publisher — mirrors the n8n media-then-page flow.
//
//   1. POST /wp-json/wp/v2/media        (raw binary + Content-Disposition) for every local image
//   2. POST /wp-json/wp/v2/media/{id}   to set alt_text and title
//   3. Rewrite the article HTML so each image points at its uploaded source_url
//   4. POST /wp-json/wp/v2/{posts|pages} with the rewritten HTML
//
// Auth is an Application Password over HTTP Basic (the REST equivalent of n8n's wordpressApi
// credential). Image uploads run sequentially: shared hosts routinely rate-limit or 502 on
// concurrent multipart writes, and a blog has only a handful of images.

import type { Channel } from '../channelStore';
import type { PublishRequest, PublishResult } from './types';
import { collectLocalImages, readImage, rewriteImageSrcs, findUnresolvedImages, type LocalImage } from './images';

export interface WordPressMedia {
  id: number;
  url: string;
  altText: string;
  fileName: string;
}

function authHeader(c: Channel): string {
  const user = c.config.username || '';
  const pass = (c.config.appPassword || '').replace(/\s+/g, ''); // WP shows app passwords space-separated
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

function apiBase(c: Channel): string {
  const site = (c.config.siteUrl || '').replace(/\/+$/, '');
  if (!site) throw new Error('WordPress channel has no site URL');
  return `${site}/wp-json/wp/v2`;
}

async function wpFetch(c: Channel, url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: authHeader(c), Accept: 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body — surfaced verbatim below */
  }
  if (!res.ok) {
    const detail = json?.message || text.slice(0, 300) || res.statusText;
    throw new Error(`WordPress ${res.status}: ${detail}`);
  }
  return json;
}

/** Upload one image and set its alt text. Steps 1 and 2 of the flow. */
export async function uploadMedia(c: Channel, img: LocalImage, placementKey?: string): Promise<WordPressMedia> {
  const buffer = await readImage(img);
  const created = await wpFetch(c, `${apiBase(c)}/media`, {
    method: 'POST',
    headers: {
      'Content-Disposition': `attachment; filename="${img.fileName}"`,
      'Content-Type': img.mimeType,
    },
    body: new Uint8Array(buffer),
  });

  const id = Number(created?.id);
  const url = created?.source_url || created?.guid?.rendered || '';
  if (!id || !url) throw new Error(`WordPress media upload returned no id/source_url for ${img.fileName}`);

  const altText = img.alt || img.fileName;
  try {
    await wpFetch(c, `${apiBase(c)}/media/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alt_text: altText, title: placementKey || altText }),
    });
  } catch (e: any) {
    // Alt text is cosmetic — a failure here must not lose an already-uploaded image.
    console.warn(`[wordpress] alt text update failed for media ${id}: ${e?.message}`);
  }

  return { id, url, altText, fileName: img.fileName };
}

function wpFigure(url: string, alt: string): string {
  const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    '<figure class="wp-block-image aligncenter size-full">',
    `<img src="${esc(url)}" alt="${esc(alt)}" />`,
    alt ? `<figcaption class="wp-element-caption">${esc(alt)}</figcaption>` : '',
    '</figure>',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Host every local image in the channel's media library and return the rewritten HTML.
 * Exported so the dev.to publisher can borrow a WordPress channel purely as an image host.
 */
export async function hostImages(
  c: Channel,
  html: string,
): Promise<{ html: string; media: WordPressMedia[]; warnings: string[]; urlBySrc: Map<string, string> }> {
  const images = collectLocalImages(html);
  const urlBySrc = new Map<string, string>();
  const media: WordPressMedia[] = [];
  const warnings: string[] = [];

  for (const img of images) {
    try {
      const uploaded = await uploadMedia(c, img, img.fileName);
      urlBySrc.set(img.src, uploaded.url);
      media.push(uploaded);
    } catch (e: any) {
      // One bad image must not sink the post — record it and carry on.
      warnings.push(`Image ${img.fileName} was not uploaded: ${e?.message || e}`);
    }
  }

  return { html: rewriteImageSrcs(html, urlBySrc, wpFigure), media, warnings, urlBySrc };
}

export async function publishToWordPress(req: PublishRequest): Promise<PublishResult> {
  const c = req.channel;
  if (!req.html) throw new Error('WordPress publishing needs rendered HTML');

  const { html, media, warnings } = await hostImages(c, req.html);

  // Same rule as dev.to: refuse rather than create a post with dead image links. The post has
  // not been created at this point, so nothing is lost by stopping.
  const unresolved = findUnresolvedImages(html);
  if (unresolved.length) {
    throw new Error(
      `Image upload failed for ${unresolved.length} image(s), so nothing was published. ${warnings.join(' ')}`.trim(),
    );
  }

  const postType = c.config.postType === 'pages' ? 'pages' : 'posts';
  const status = req.status || c.config.defaultStatus || 'draft';

  const body: Record<string, any> = {
    title: req.title,
    content: html,
    status,
  };
  // A previous publish to this channel means "update that post". Only set the slug when
  // creating: on an update WordPress already owns the permalink, and resending it can silently
  // suffix a duplicate (…-2).
  const existingId = req.existingExternalId;
  if (req.slug && !existingId) body.slug = req.slug;
  if (req.summary) body.excerpt = req.summary;

  // Without the id in the path WordPress would create a second copy on every re-publish — the
  // same duplication already guarded against on dev.to. The REST API updates with POST to
  // {type}/{id}, not PUT.
  const created = await wpFetch(
    c,
    existingId ? `${apiBase(c)}/${postType}/${existingId}` : `${apiBase(c)}/${postType}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  const url = created?.link || created?.guid?.rendered || `${c.config.siteUrl}/?p=${created?.id}`;
  return {
    url,
    externalId: String(created?.id ?? ''),
    mediaCount: media.length,
    warnings,
    meta: { status: created?.status || status, slug: created?.slug || req.slug, postType, updated: !!existingId },
  };
}

/** Credential check used by the "Test" button on /channels. */
export async function testWordPress(c: Channel): Promise<{ ok: true; detail: string }> {
  const me = await wpFetch(c, `${apiBase(c)}/users/me?context=edit`, { method: 'GET' });
  const name = me?.name || me?.slug || 'unknown user';
  const caps = me?.capabilities || {};
  if (caps && Object.keys(caps).length && !caps.upload_files) {
    throw new Error(`Connected as ${name}, but this user cannot upload media`);
  }
  return { ok: true, detail: `Connected as ${name}` };
}
