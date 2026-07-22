import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

export const runtime = 'nodejs';

const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');
const BLOG_IMAGES_DIR = path.join(process.cwd(), 'data', 'blog-images');

function resolveImagePath(imageUrl: string): { filePath: string; relPath: string; baseDir: string } | null {
  if (imageUrl.startsWith('/api/images/')) {
    const relPath = imageUrl.replace('/api/images/', '');
    return { filePath: path.join(IMAGES_DIR, ...relPath.split('/')), relPath, baseDir: '/api/images/' };
  }
  if (imageUrl.startsWith('/api/blog-images/')) {
    const relPath = imageUrl.replace('/api/blog-images/', '');
    return { filePath: path.join(BLOG_IMAGES_DIR, ...relPath.split('/')), relPath, baseDir: '/api/blog-images/' };
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { imageUrl, prompt } = await req.json();
    if (!imageUrl || !prompt) {
      return NextResponse.json({ error: 'imageUrl and prompt are required' }, { status: 400 });
    }

    const resolved = resolveImagePath(imageUrl);
    if (!resolved) {
      return NextResponse.json({ error: 'Unsupported image URL prefix' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY not set' }, { status: 500 });

    let imageBuffer: Buffer;
    try {
      imageBuffer = await fs.readFile(resolved.filePath);
    } catch {
      return NextResponse.json({ error: 'Image file not found on disk' }, { status: 404 });
    }

    // Build multipart form for OpenAI /v1/images/edits
    const formData = new FormData();
    formData.append('model', 'gpt-image-2');
    formData.append('prompt', prompt);
    formData.append('size', '1280x720');
    formData.append('quality', 'low');
    const arrayBuffer = imageBuffer.buffer.slice(
      imageBuffer.byteOffset,
      imageBuffer.byteOffset + imageBuffer.byteLength,
    ) as ArrayBuffer;
    formData.append('image', new Blob([arrayBuffer], { type: 'image/png' }), 'image.png');

    const openaiRes = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!openaiRes.ok) {
      const text = await openaiRes.text();
      return NextResponse.json({ error: `OpenAI error (${openaiRes.status}): ${text}` }, { status: 500 });
    }

    const json: any = await openaiRes.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json({ error: 'No image data in OpenAI response' }, { status: 500 });
    }

    // Save edited image alongside original, using same subfolder
    const editedBuffer = Buffer.from(b64, 'base64');
    const dir = path.dirname(resolved.filePath);
    const hash = crypto.randomBytes(4).toString('hex');
    const editedFilename = `edited-${hash}.png`;
    const editedFilePath = path.join(dir, editedFilename);
    await fs.writeFile(editedFilePath, editedBuffer);

    // Build the edited URL with same prefix as original
    const originalSegments = resolved.relPath.split('/');
    const editedSegments = [...originalSegments.slice(0, -1), editedFilename];
    const editedUrl = `${resolved.baseDir}${editedSegments.join('/')}`;

    return NextResponse.json({ editedUrl, originalUrl: imageUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Image edit failed' }, { status: 500 });
  }
}
