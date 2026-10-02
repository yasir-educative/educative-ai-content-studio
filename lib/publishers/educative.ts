// Educative publisher — the original /api/publish behaviour, lifted into a channel so it sits
// alongside WordPress and dev.to behind one interface.
//
// Same shape as the other destinations (upload images, then create the item), except the images
// go to Educative's page-scoped CDN and the body is editor blocks rather than HTML.

import type { PublishRequest, PublishResult } from './types';
import type { Channel } from '../channelStore';
import {
  createBlog,
  uploadBlog,
  blogUrlForPageId,
  getImageUploadUrl,
  uploadImageMultipart,
  makeEducativeImageBlock,
} from '../educative';
import { resolveLocalImagePath } from './images';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Upload every Image block whose url points at this app to the Educative CDN.
 * Needs the blog's page_id — the upload slot is page-scoped.
 */
async function resolveImageBlocks(
  blocks: any[],
  pageId: string,
  authOverride: string | undefined,
  warnings: string[],
): Promise<{ blocks: any[]; uploaded: number }> {
  let uploaded = 0;
  const out = await Promise.all(
    blocks.map(async (block) => {
      if (block?.type !== 'Image') return block;
      const localUrl: string = block?.content?.url || block?.content?.path || '';
      const filePath = resolveLocalImagePath(localUrl);
      if (!filePath) return block;

      const caption: string = block?.content?.caption || block?.content?.alt || '';
      const name = path.basename(filePath);

      try {
        const fileBuffer = await fs.readFile(filePath);

        const slot = await getImageUploadUrl(pageId, authOverride);
        if (!slot?.uploadUrl) {
          warnings.push(`No upload slot for ${name}`);
          return block;
        }

        const uploadResult = await uploadImageMultipart(slot.uploadUrl, fileBuffer, name, authOverride);
        if (!uploadResult) {
          warnings.push(`Upload failed for ${name}`);
          return block;
        }

        const resolvedPageId = uploadResult.page_id || pageId;
        const imageId = uploadResult.image_id || slot.imageId;
        if (!imageId) {
          warnings.push(`No image_id returned for ${name}`);
          return block;
        }

        uploaded++;
        const imagePath = `/api/page/${resolvedPageId}/image/download/${imageId}`;
        return makeEducativeImageBlock(imagePath, caption, fileBuffer.length);
      } catch (err: any) {
        warnings.push(`Image ${name} was not uploaded: ${err?.message || err}`);
        return block;
      }
    }),
  );
  return { blocks: out, uploaded };
}

export async function publishToEducative(req: PublishRequest): Promise<PublishResult> {
  const c = req.channel;
  const blocks = req.blocks;
  if (!Array.isArray(blocks) || !blocks.length) throw new Error('Educative publishing needs editor blocks');

  const auth = c.config.flaskAuth || undefined;
  const warnings: string[] = [];
  const ov = req.educative || {};
  const templateId = ov.templateId || c.config.templateId || undefined;

  // Create the page first — page_id is required to build the image upload URL.
  const { editor_page_id, page_id } = await createBlog(templateId, auth);
  const resolved = await resolveImageBlocks(blocks, page_id, auth, warnings);

  await uploadBlog({
    editorPageId: editor_page_id,
    title: req.title || 'Untitled',
    blocks: resolved.blocks,
    categories: ov.categories || c.config.categories || undefined,
    authOverride: auth,
  });

  const pageType = (ov.pageType || c.config.pageType) === 'newsletter' ? 'newsletter' : 'blog';
  return {
    url: blogUrlForPageId(page_id, pageType),
    externalId: page_id,
    mediaCount: resolved.uploaded,
    warnings,
    meta: { pageId: page_id, editorPageId: editor_page_id },
  };
}

/**
 * Educative has no cheap read-only identity endpoint, so "test" just confirms the cookie is
 * accepted by creating a throwaway draft page. The page stays in the author's drafts.
 */
export async function testEducative(c: Channel): Promise<{ ok: true; detail: string }> {
  const auth = c.config.flaskAuth || undefined;
  const { page_id } = await createBlog(c.config.templateId || undefined, auth);
  return { ok: true, detail: `Credentials accepted — created scratch page ${page_id} (safe to delete)` };
}
