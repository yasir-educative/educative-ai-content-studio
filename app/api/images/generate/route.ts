import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { checkSize, IMAGE_FORMATS, IMAGE_MODELS, IMAGE_QUALITIES } from '@/lib/educativeImageStyle';
import { getImageStyle } from '@/lib/imageStyleStore';
import { readReferenceBytes } from '@/lib/referenceImageStore';

export const runtime = 'nodejs';
export const maxDuration = 300;

const OUT_DIR = path.join(process.cwd(), 'data', 'images', 'educative');

/** Real format from the file's magic bytes. */
function sniffExt(b: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Style comes from exactly one source per request, never two:
 *   create                     — the saved style text (Educative by default)
 *   create + reference         — the reference image; the style text is skipped
 *   create + reference + subject — reference styles it, subject is recreated
 *   edit                       — neither; the image already follows a style and
 *                                the request is a targeted change within it
 *
 * A written style and a picture of a style pull in different directions when
 * both are sent, so the reference wins whenever one is attached.
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
    // An image already in our own output dir, so "edit this result" does not
    // have to round-trip the bytes through the browser.
    let sourceUrl = '';
    // Whether the saved style reference should be sent alongside the subject.
    let useReference = false;
    let styleId = '';

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
      sourceUrl = get('sourceUrl');
      useReference = get('useReference') === '1';
      styleId = get('styleId');
    } else {
      const b = await req.json();
      instructions = String(b.instructions || '').trim();
      model = b.model || model;
      quality = b.quality || quality;
      format = b.format || format;
      compression = b.compression ?? '';
      width = Number(b.width) || 0;
      height = Number(b.height) || 0;
      mode = b.mode === 'edit' ? 'edit' : 'create';
      sourceUrl = String(b.sourceUrl || '');
      useReference = !!b.useReference;
      styleId = String(b.styleId || '');
    }

    // Only a file this route itself wrote may be re-read. The name is matched
    // whole so nothing can traverse out of the directory.
    let sourceBuf: Buffer | null = null;
    if (!upload && sourceUrl) {
      const m = /^\/api\/images\/educative\/([A-Za-z0-9._-]+)$/.exec(sourceUrl);
      if (!m || m[1].includes('..')) {
        return NextResponse.json({ error: 'sourceUrl must be a generated image' }, { status: 400 });
      }
      try {
        sourceBuf = await fs.readFile(path.join(OUT_DIR, m[1]));
      } catch {
        return NextResponse.json({ error: 'That image is no longer on disk' }, { status: 400 });
      }
    }

    if (!instructions) {
      return NextResponse.json(
        { error: mode === 'edit' ? 'Describe the change to make' : 'Image instructions are required' },
        { status: 400 },
      );
    }
    if (mode === 'edit' && !upload && !sourceBuf) {
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

    const reference = useReference ? await readReferenceBytes() : null;
    const hasSubject = !!(upload || sourceBuf);

    // An edit works inside an image that already follows the house style, so
    // prepending the style block would fight the existing artwork. A reference
    // image replaces the written style for the same reason.
    const styleApplied = mode !== 'edit' && !reference;
    let prompt = mode === 'edit'
      ? instructions
      : styleApplied
        ? `${getImageStyle(styleId).style}\n\n# Create\n${instructions}`
        : `# Create\n${instructions}`;

    // With two images the model needs to be told which is which, and in what
    // order they were attached, or it treats both as subject matter.
    if (reference) {
      prompt = hasSubject
        ? `# Images attached\nThe FIRST image is a STYLE REFERENCE only: match its visual style, palette, line weight and treatment. Do not copy its subject matter or reproduce its content.\nThe SECOND image is the SUBJECT to recreate: keep what it depicts, its structure and its labels.\n\n${prompt}`
        : `# Images attached\nThe attached image is a STYLE REFERENCE only: match its visual style, palette, line weight and treatment. Do not copy its subject matter.\n\n${prompt}`;
    }

    let res: Response;
    if (upload || sourceBuf || reference) {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      form.append('size', `${width}x${height}`);
      form.append('quality', quality);
      // The edits endpoint honours output_format for gpt-image models; without
      // it every result comes back PNG regardless of what was asked for.
      form.append('output_format', format);
      if (format !== 'png' && compression !== '' && compression !== undefined) {
        const c = Number(compression);
        if (Number.isFinite(c) && c >= 0 && c <= 100) form.append('output_compression', String(c));
      }
      // Order matters: the prompt refers to the reference as the first image.
      if (reference) {
        form.append('image[]', new Blob([new Uint8Array(reference.buf)], { type: reference.type }), 'reference.png');
      }
      if (hasSubject) {
        const srcBuf = sourceBuf ?? Buffer.from(await upload!.arrayBuffer());
        const type = upload?.type?.startsWith('image/') ? upload.type : 'image/png';
        form.append(reference ? 'image[]' : 'image', new Blob([new Uint8Array(srcBuf)], { type }), upload?.name || 'image.png');
      }
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

    // Name the file after what actually came back, not what was requested, so
    // a .jpeg never contains PNG bytes if the endpoint ignores output_format.
    const buf = Buffer.from(b64, 'base64');
    const ext = sniffExt(buf) || format;
    await fs.mkdir(OUT_DIR, { recursive: true });
    const filename = `img-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    await fs.writeFile(path.join(OUT_DIR, filename), buf);

    return NextResponse.json({
      url: `/api/images/educative/${filename}`,
      filename,
      model,
      mode,
      format: ext,
      requestedFormat: format,
      usedReference: !!reference,
      usedSubject: hasSubject,
      styleApplied,
      styleName: styleApplied ? getImageStyle(styleId).name : null,
      size: `${width}x${height}`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Image generation failed' }, { status: 500 });
  }
}
