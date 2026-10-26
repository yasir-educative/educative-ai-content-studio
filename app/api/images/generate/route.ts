import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { checkSize, IMAGE_FORMATS, IMAGE_MODELS, IMAGE_QUALITIES } from '@/lib/educativeImageStyle';
import { getImageStyle } from '@/lib/imageStyleStore';

export const runtime = 'nodejs';
export const maxDuration = 300;

const OUT_DIR = path.join(process.cwd(), 'data', 'images', 'educative');

/**
 * Three paths, all landing in data/images/educative:
 *   create            — prompt only, house style prepended
 *   create + reference — the reference steers composition; style still applies
 *   edit              — change an existing image, house style deliberately NOT
 *                       applied, since the image already follows one and the
 *                       request is a targeted change within it
 */
export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get('content-type') || '';
    let instructions = '';
    let mode: 'create' | 'edit' = 'create';
    let model = IMAGE_MODELS[0] as string;
    let quality = 'high';
    let format = 'png';
    let compression: string | number = '';
    let width = 0;
    let height = 0;
    let upload: File | null = null;

    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      const get = (k: string) => String(form.get(k) ?? '');
      instructions = get('instructions').trim();
      mode = get('mode') === 'edit' ? 'edit' : 'create';
      model = get('model') || model;
      quality = get('quality') || quality;
      format = get('format') || format;
      compression = get('compression');
      width = Number(get('width')) || 0;
      height = Number(get('height')) || 0;
      const f = form.get('image');
      if (f && typeof f === 'object' && 'arrayBuffer' in f) upload = f as File;
    } else {
      const b = await req.json();
      instructions = String(b.instructions || '').trim();
      model = b.model || model;
      quality = b.quality || quality;
      format = b.format || format;
      compression = b.compression ?? '';
      width = Number(b.width) || 0;
      height = Number(b.height) || 0;
    }

    if (!instructions) {
      return NextResponse.json(
        { error: mode === 'edit' ? 'Describe the change to make' : 'Image instructions are required' },
        { status: 400 },
      );
    }
    if (mode === 'edit' && !upload) {
      return NextResponse.json({ error: 'Editing needs an image to edit' }, { status: 400 });
    }

    model = IMAGE_MODELS.includes(model as any) ? model : IMAGE_MODELS[0];
    quality = IMAGE_QUALITIES.includes(quality as any) ? quality : 'high';
    format = IMAGE_FORMATS.includes(format as any) ? format : 'png';

    const { checks, valid } = checkSize(width, height);
    if (!valid) {
      return NextResponse.json(
        { error: `Invalid size: ${checks.filter((c) => !c.ok).map((c) => c.label).join(', ')}` },
        { status: 400 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY is not set' }, { status: 500 });

    // An edit works inside an image that already follows the house style, so
    // prepending the style block would fight the existing artwork.
    const prompt =
      mode === 'edit' ? instructions : `${getImageStyle().style}\n\n# Create\n${instructions}`;

    let res: Response;
    if (upload) {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      form.append('size', `${width}x${height}`);
      form.append('quality', quality);
      const buf = Buffer.from(await upload.arrayBuffer());
      const type = upload.type && upload.type.startsWith('image/') ? upload.type : 'image/png';
      form.append('image', new Blob([new Uint8Array(buf)], { type }), upload.name || 'image.png');
      res = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } else {
      const payload: Record<string, any> = {
        model,
        prompt,
        quality,
        size: `${width}x${height}`,
        output_format: format,
      };
      if (format !== 'png' && compression !== '' && compression !== undefined) {
        const c = Number(compression);
        if (Number.isFinite(c) && c >= 0 && c <= 100) payload.output_compression = c;
      }
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Image generation failed (${res.status}): ${text.slice(0, 400)}` },
        { status: res.status >= 500 ? 502 : 400 },
      );
    }

    const json: any = await res.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) return NextResponse.json({ error: 'No image data returned' }, { status: 502 });

    // The edits endpoint always answers PNG regardless of the requested format.
    const ext = upload ? 'png' : format;
    await fs.mkdir(OUT_DIR, { recursive: true });
    const filename = `img-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    await fs.writeFile(path.join(OUT_DIR, filename), Buffer.from(b64, 'base64'));

    return NextResponse.json({
      url: `/api/images/educative/${filename}`,
      filename,
      model,
      mode,
      usedReference: !!upload,
      styleApplied: mode !== 'edit',
      size: `${width}x${height}`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Image generation failed' }, { status: 500 });
  }
}
