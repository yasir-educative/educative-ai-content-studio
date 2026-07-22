import { NextRequest } from 'next/server';
import {
  createBlog,
  uploadBlog,
  blogUrlForPageId,
  getImageUploadUrl,
  uploadImageMultipart,
  makeEducativeImageBlock,
} from '@/lib/educative';
import { updateBlog } from '@/lib/storage';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const maxDuration = 180;

const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');

// Upload every Image block whose url points to /api/images/ to Educative CDN.
// Requires the blog's page_id (from createBlog) so the upload URL is page-scoped.
// Returns the transformed blocks with proper Educative path/image_id references.
async function resolveImageBlocks(blocks: any[], pageId: string): Promise<any[]> {
  return Promise.all(
    blocks.map(async (block) => {
      if (block?.type !== 'Image') return block;
      const localUrl: string = block?.content?.url || block?.content?.path || '';
      if (!localUrl.startsWith('/api/images/')) return block;

      const relPath = localUrl.replace('/api/images/', '');
      const filePath = path.join(IMAGES_DIR, ...relPath.split('/'));
      const caption: string = block?.content?.caption || block?.content?.alt || '';

      try {
        const fileBuffer = await fs.readFile(filePath);

        // Step 1: Get page-scoped upload slot
        const slot = await getImageUploadUrl(pageId);
        if (!slot?.uploadUrl) {
          console.warn(`[publish] no upload slot for ${path.basename(relPath)}`);
          return block;
        }

        // Step 2: Upload as multipart form-data (file-0 field, matching n8n)
        const uploadResult = await uploadImageMultipart(slot.uploadUrl, fileBuffer, path.basename(relPath));
        if (!uploadResult) {
          console.warn(`[publish] multipart upload failed for ${path.basename(relPath)}`);
          return block;
        }

        // Step 3: Build the Educative Image block with path-based reference
        const resolvedPageId = uploadResult.page_id || pageId;
        const imageId = uploadResult.image_id || slot.imageId;
        if (!imageId) {
          console.warn(`[publish] no image_id returned for ${path.basename(relPath)}`);
          return block;
        }

        const imagePath = `/api/page/${resolvedPageId}/image/download/${imageId}`;
        return makeEducativeImageBlock(imagePath, caption, fileBuffer.length);
      } catch (err: any) {
        console.warn(`[publish] image upload failed for ${path.basename(relPath)}:`, err?.message);
        return block;
      }
    }),
  );
}

export async function POST(req: NextRequest) {
  try {
    const { title, blocks, blogId, templateId, categories, pageType } = await req.json();
    if (!Array.isArray(blocks) || !blocks.length) {
      return Response.json({ error: 'No editor blocks supplied' }, { status: 400 });
    }

    // Create the blog page first — we need page_id for the image upload URL.
    const { editor_page_id, page_id } = await createBlog(templateId);

    // Upload any locally-stored GPT images to Educative CDN before publishing.
    const resolvedBlocks = await resolveImageBlocks(blocks, page_id);

    await uploadBlog({ editorPageId: editor_page_id, title: title || 'Untitled', blocks: resolvedBlocks, categories });
    const url = blogUrlForPageId(page_id, pageType === 'newsletter' ? 'newsletter' : 'blog');

    if (blogId) {
      try {
        await updateBlog(blogId, { status: 'published', publishedUrl: url, publishedAt: new Date().toISOString() });
      } catch (e) {
        console.error('[history] publish recorded but save failed', e);
      }
    }
    return Response.json({ url, pageId: page_id, editorPageId: editor_page_id });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
