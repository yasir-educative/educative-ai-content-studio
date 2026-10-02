import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');

// URL/filesystem-safe slug. Max 45 chars to keep paths readable.
export function slugify(s: string): string {
  return (s || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 45);
}

function buildPrompt(content: string): string {
  return `Create a clean portrait mobile-friendly image card. Use the Illustration idea as the primary source for the visual composition. Use the Content only as hidden background context to better understand the topic. Do not copy, summarize, paraphrase, or display any text from the Content in the image. The final image should be driven mainly by the illustration idea, using a clear visual explanation with simple labels, icons, arrows, or small callouts only when needed. Keep text minimal, sharp, and readable on mobile. Show only a few short labels necessary to make the illustration understandable. Do not include paragraphs or long sentences. Use about 20px white padding on all sides, not more. Keep all elements safely inside the margins. Avoid clutter. Inputs Illustration idea: ${content}`;
}

// subfolder is a forward-slash-separated relative path, e.g.:
//   "blogs/my-blog-title-abc123"
//   "newsletters/my-newsletter-abc123"
//   "courses/course-name/lesson-name"
// Images are saved to data/images/<subfolder>/img<order>-<hash>.png
// and served at /api/images/<subfolder>/img<order>-<hash>.png
export async function generateGptImage(
  content: string,
  order: number,
  subfolder: string,
  opts: { size?: '1280x720' | '1024x1536' | '1024x1024'; rawPrompt?: string } = {},
): Promise<{ url: string; buffer: Buffer; filename: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const body = JSON.stringify({
    model: 'gpt-image-2',
    quality: 'low',
    size: opts.size || '1280x720',
    output_format: 'png',
    prompt: opts.rawPrompt ?? buildPrompt(content),
  });

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, attempt * 2000));

    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
      });
    } catch (e: any) {
      lastError = new Error(`Image generation network error: ${e?.message}`);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      lastError = new Error(`Image generation failed (${res.status}): ${text}`);
      if (res.status < 500) throw lastError;
      continue;
    }

    const json: any = await res.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error('No image data returned from OpenAI');

    const buffer = Buffer.from(b64, 'base64');
    const dir = path.join(IMAGES_DIR, ...subfolder.split('/'));
    await fs.mkdir(dir, { recursive: true });
    const filename = `img${order}-${crypto.randomBytes(4).toString('hex')}.png`;
    await fs.writeFile(path.join(dir, filename), buffer);

    return { url: `/api/images/${subfolder}/${filename}`, buffer, filename };
  }

  throw lastError ?? new Error('Image generation failed after 3 attempts');
}

export interface ImageTagContent {
  /** The visual description handed to the image generator. */
  content: string;
  /** Short caption rendered under the image, and used as its alt text. */
  caption: string;
}

/**
 * Split a string into its top-level `[...]` segments, ignoring nested brackets.
 *
 * Descriptions routinely contain brackets of their own ("labeled [A] and [B]"), so a plain
 * split on `][` would carve them up. Depth tracking keeps each segment whole.
 */
function splitTopLevelBrackets(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '[') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(s.slice(start, i));
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Strip one redundant `[...]` wrapper, which the models sometimes add around a value. */
function unwrap(s: string): string {
  const m = s.trim().match(/^\[([\s\S]+)\]$/);
  return (m ? m[1] : s).trim();
}

/**
 * Pull the description and caption out of every `[image]…[/image]` tag.
 *
 * The prompts specify two shapes and the models emit both, so both are parsed here:
 *
 *   A (newsletter)  [image][Description][…][/Description][Caption][…][/Caption][/image]
 *   B (blog)        [image][2–3 line description][Short caption][/image]
 *
 * Only shape A used to be handled, so every blog image shipped with an empty caption and empty
 * alt text. Shape B's caption is simply the last top-level segment.
 */
export function extractImageContents(draft: string): ImageTagContent[] {
  const results: ImageTagContent[] = [];
  const re = /\[image\]([\s\S]*?)\[\/image\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(draft)) !== null) {
    const raw = match[1].trim();

    // --- Shape A: explicitly tagged sub-blocks ---
    const captionM = raw.match(/\[Caption\]([\s\S]*?)\[\/Caption\]/i);
    if (captionM) {
      const descM = raw.match(/\[Description\]([\s\S]*?)\[\/Description\]/i);
      results.push({
        // Without a [Description] block, fall back to the tag body minus the caption block so
        // the caption text is never fed to the image generator as something to draw.
        content: unwrap(descM ? descM[1] : raw.replace(captionM[0], '')),
        caption: unwrap(captionM[1]),
      });
      continue;
    }

    // --- Shape B: positional segments ---
    const segments = splitTopLevelBrackets(raw);
    if (segments.length >= 2) {
      results.push({ content: segments[0], caption: segments[segments.length - 1] });
    } else if (segments.length === 1) {
      results.push({ content: segments[0], caption: '' });
    } else {
      // Bare prose with no brackets at all.
      results.push({ content: raw, caption: '' });
    }
  }
  return results;
}
