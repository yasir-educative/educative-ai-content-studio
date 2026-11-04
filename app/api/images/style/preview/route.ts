import { NextRequest, NextResponse } from 'next/server';
import {
  getStyleById, listStyles, readStyleReference,
  saveStylePreview, clearStylePreview, STYLE_PREVIEW_SUBJECT,
} from '@/lib/imageStyleStore';
import { IMAGE_QUALITY, IMAGE_FORMAT } from '@/lib/imageGen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Draw a style's sample image.
 *
 * Every style draws the same subject, so putting two previews side by side
 * shows the difference between the styles and nothing else. A style with a
 * reference picture is drawn from the picture, because that is what its real
 * images will be drawn from.
 */
export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    const style = getStyleById(String(id || ''));
    if (!id || style.id !== id) return NextResponse.json({ error: 'style not found' }, { status: 400 });

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY is not set' }, { status: 500 });

    const reference = await readStyleReference(style.id);
    const prompt = reference
      ? `# Images attached\nThe attached image is a STYLE REFERENCE only: match its visual style, palette, line weight and treatment. Do not copy its subject matter.\n\n# Create\n${STYLE_PREVIEW_SUBJECT}`
      : `${style.body}\n\n# Create\n${STYLE_PREVIEW_SUBJECT}`;

    let res: Response;
    if (reference) {
      const form = new FormData();
      form.append('model', 'gpt-image-2');
      form.append('prompt', prompt);
      form.append('size', '1024x1024');
      form.append('quality', IMAGE_QUALITY);
      form.append('output_format', IMAGE_FORMAT);
      form.append('image', new Blob([new Uint8Array(reference.buf)], { type: reference.type }), 'reference.png');
      res = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
      });
    } else {
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-image-2', prompt, size: '1024x1024', quality: IMAGE_QUALITY, output_format: IMAGE_FORMAT,
        }),
      });
    }

    if (!res.ok) {
      return NextResponse.json({ error: `Preview failed (${res.status}): ${(await res.text()).slice(0, 300)}` }, { status: 400 });
    }
    const json: any = await res.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) return NextResponse.json({ error: 'No image data returned' }, { status: 400 });

    await saveStylePreview(style.id, Buffer.from(b64, 'base64'));
    return NextResponse.json(listStyles());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to draw the preview' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await clearStylePreview(new URL(req.url).searchParams.get('id') || '');
    return NextResponse.json(listStyles());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to remove the preview' }, { status: 400 });
  }
}
