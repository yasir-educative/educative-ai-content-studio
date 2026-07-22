import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');

export async function GET(_req: NextRequest, { params }: { params: { filename: string } }) {
  const { filename } = params;
  if (!filename || !/^[\w\-.]+$/.test(filename)) {
    return new Response('Not found', { status: 404 });
  }
  const filePath = path.join(IMAGES_DIR, filename);
  try {
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : 'image/jpeg';
    return new Response(buf, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
