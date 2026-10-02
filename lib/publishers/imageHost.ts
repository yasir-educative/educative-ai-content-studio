// Shared image hosting for destinations that accept only already-public image URLs.
//
// Neither dev.to nor Substack's community client gives us a dependable media-upload endpoint we
// can rely on, so generated images are pushed to a public GitHub repo first and the article links
// the commit-pinned raw URLs. Both channels configure the repo with the same field names, so the
// strategy selection lives here rather than being duplicated per publisher.

import type { Channel } from '../channelStore';
import { collectLocalImages, rewriteImageSrcs } from './images';
import { inspectGitHubConfig, uploadImages, type HostedImage } from './github';

export interface HostedResult {
  /** The HTML with every local image src replaced by a public URL. */
  html: string;
  hosted: HostedImage[];
  warnings: string[];
}

/**
 * Replace local image references with publicly reachable ones.
 *
 * Throws rather than returning a half-usable article in the two cases where publishing would
 * produce visibly broken content: incomplete GitHub settings, and an upload that failed. Nothing
 * has been created on the destination at this point, so failing here costs nothing.
 */
export async function hostImagesForChannel(
  channel: Channel,
  html: string,
  blogKey: string,
): Promise<HostedResult> {
  const images = collectLocalImages(html);
  if (!images.length) return { html, hosted: [], warnings: [] };

  const { cfg, missing, partial } = inspectGitHubConfig(channel.config);

  if (partial) {
    throw new Error(
      `This article has ${images.length} image(s), but GitHub image hosting is incomplete — missing: ${missing.join(', ')}. Add it on the channel, or remove the GitHub settings to fall back to a public base URL.`,
    );
  }

  if (cfg) {
    const result = await uploadImages(cfg, images, blogKey);
    if (result.hosted.length < images.length) {
      throw new Error(`Image hosting failed, so nothing was published. ${result.warnings.join(' ')}`);
    }
    return {
      html: rewriteImageSrcs(html, new Map(result.hosted.map((h) => [h.src, h.url]))),
      hosted: result.hosted,
      warnings: result.warnings,
    };
  }

  // Fallback for a studio that is already reachable from the internet.
  const base = (channel.config.publicBaseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (base) {
    return {
      html: rewriteImageSrcs(html, new Map(images.map((i) => [i.src, `${base}${i.src}`]))),
      hosted: [],
      warnings: [],
    };
  }

  return {
    html,
    hosted: [],
    warnings: [
      `${images.length} image(s) have no public host. Configure the GitHub image repository on this channel, otherwise they will not render.`,
    ],
  };
}

/**
 * Directory this run's images live under, e.g. `how-caches-fail-abc123-m8x2k1`.
 *
 * Every publish gets its own key so a re-publish uploads fresh files at fresh paths instead of
 * overwriting the ones a live post already points at. Commit-pinned raw URLs mean an older
 * version of the article keeps rendering exactly what it was published with.
 */
export function buildImageKey(title: string, blogId?: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'article';
  const suffix = (blogId || '').slice(-6);
  return `${slug}${suffix ? `-${suffix}` : ''}-${Date.now().toString(36)}`;
}
