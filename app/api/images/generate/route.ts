import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  checkSize,
  IMAGE_FORMATS,
  IMAGE_MODELS,
  IMAGE_QUALITIES,
} from '@/lib/educativeImageStyle';
import { getImageStyle } from '@/lib/imageStyleStore';

export const runtime = 'nodejs';
export const maxDuration = 300;

const OUT_DIR = path.join(process.cwd(), 'data', 'images', 'educative');

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const instructions = String(body.instructions || '').trim();
    if (!instructions) {
      return NextResponse.json({ error: 'Image instructions are required' }, { status: 400 });
    }

    const width = Number(body.width) || 0;
    const height = Number(body.height) || 0;
    const { checks, valid } = checkSize(width, height);
    if (!valid) {
      const failed = checks.filter((c) => !c.ok).map((c) => c.label);
      return NextResponse.json({ error: `Invalid size: ${failed.join(', ')}` }, { status: 400 });
    }

    const model = IMAGE_MODELS.includes(body.model) ? body.model : IMAGE_MODELS[0];
    const quality = IMAGE_QUALITIES.includes(body.quality) ? body.quality : 'high';
    const format = IMAGE_FORMATS.includes(body.format) ? body.format : 'png';

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY is not set' }, { status: 500 });

    // House style (saved override, else the shipped default) then the user's instructions.
    const { style } = getImageStyle();
    const prompt = `${style}\n\n# Create\n${instructions}`;

    const payload: Record<string, any> = {
      model,
      prompt,
      quality,
      size: `${width}x${height}`,
      output_format: format,
    };
    // PNG is lossless, so compression only applies to the lossy formats.
    if (format !== 'png' && body.compression !== undefined && body.compression !== '') {
      const c = Number(body.compression);
      if (Number.isFinite(c) && c >= 0 && c <= 100) payload.output_compression = c;
    }

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

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

    await fs.mkdir(OUT_DIR, { recursive: true });
    const filename = `img-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${format}`;
    await fs.writeFile(path.join(OUT_DIR, filename), Buffer.from(b64, 'base64'));

    return NextResponse.json({
      url: `/api/images/educative/${filename}`,
      filename,
      model,
      size: `${width}x${height}`,
      promptSent: prompt,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Image generation failed' }, { status: 500 });
  }
}
