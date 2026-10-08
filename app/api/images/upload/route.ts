import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');
const MAX_BYTES = 12 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

/** Keep uploads beside the run's generated images so publish-time hosting picks them up too. */
function slugify(s: string): string {
  return (
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'upload'
  );
}

// POST /api/images/upload — multipart form with `file`, optional `blogId`.
// Returns { url } pointing at /api/images/..., the same shape the pipeline produces.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return Response.json({ error: 'No file supplied' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: `Image is ${(file.size / 1e6).toFixed(1)}MB — the limit is 12MB` }, { status: 400 });
    }
    const ext = EXT_BY_TYPE[file.type];
    if (!ext) {
      return Response.json({ error: `Unsupported image type: ${file.type || 'unknown'}` }, { status: 400 });
    }

    const blogId = String(form.get('blogId') || '').replace(/[^A-Za-z0-9_-]/g, '') || 'manual';
    const subdir = path.join('blogs', `uploads-${slugify(blogId)}`);
    const dir = path.join(IMAGES_DIR, subdir);
    await fs.mkdir(dir, { recursive: true });

    const name = `up-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}${ext}`;
    await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

    return Response.json({ url: `/api/images/${subdir.split(path.sep).join('/')}/${name}` });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
