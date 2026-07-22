import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');

// Serves images from nested subdirectories.
// /api/images/blogs/my-blog/img0.png  → data/images/blogs/my-blog/img0.png
// /api/images/courses/name/lesson/img0.png → data/images/courses/name/lesson/img0.png
// Also handles legacy flat paths: /api/images/filename.png → data/images/filename.png
export async function GET(_req: NextRequest, { params }: { params: { filepath: string[] } }) {
  const segments = params.filepath ?? [];
  // Reject empty, traversal attempts, or segments with illegal characters
  if (!segments.length || segments.some((s) => !s || s === '..' || /[/\\]/.test(s))) {
    return new Response('Not found', { status: 404 });
  }

  const filePath = path.join(IMAGES_DIR, ...segments);
  // Extra safety: ensure resolved path stays inside IMAGES_DIR
  if (!filePath.startsWith(IMAGES_DIR + path.sep) && filePath !== IMAGES_DIR) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const buf = await fs.readFile(filePath);
    const ext = path.extname(segments[segments.length - 1]).toLowerCase();
    const contentType =
      ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : 'image/jpeg';
    return new Response(buf, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
