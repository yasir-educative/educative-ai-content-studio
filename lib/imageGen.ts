import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { generateText, parseJsonLoose } from './ai';
import { BLOG_IMAGE_STYLE } from './blogImageStyle';
import { COURSE_IMAGE_STYLE } from './courseImageStyle';

const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');

// What every image the app generates is asked for. Kept here so no call site
// can quietly drift back to a cheaper setting.
export const IMAGE_QUALITY = 'high';
export const IMAGE_FORMAT = 'jpeg';
export const IMAGE_EXT = 'jpg';

// URL/filesystem-safe slug. Max 45 chars to keep paths readable.
export function slugify(s: string): string {
  return (s || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 45);
}

/**
 * The prompt a blog or newsletter illustration is generated from.
 *
 * `style` is the body of whichever style the blog scope points at; the shipped
 * default reproduces the prompt this pipeline always used. The trailing input
 * line is structural and is always appended.
 */
export function buildBlogImagePrompt(content: string, style?: string): string {
  return `${String(style ?? BLOG_IMAGE_STYLE).trim()} Inputs Illustration idea: ${content}`;
}


export function buildCourseImagePrompt(description: string, style?: string): string {
  return `${String(style ?? COURSE_IMAGE_STYLE).trim()}\n\nCreate: ${description}`;
}

const IMAGE_ENHANCER_SYSTEM = `# Role
Visual planning agent for Educative.io technical course content. Produce a concise, high-level visual prompt (\`enhancedOutline\`) for a clean technical illustration, plus a short \`caption\`. Don't write style guidelines: a fixed style block is prepended and a fixed constraints line appended — never reproduce or duplicate either.

# Subject
Illustrate software-engineering and CS concepts — system design/architecture, data structures, algorithms, networking, databases, cloud/DevOps, APIs, concurrency, code/memory/runtime. Non-technical description may be mixed in; just render the technical idea at its core.
Pick the best-fitting diagram type, typically: "architecture diagram," "system-design diagram," "data-structure illustration," "algorithm/process flow," "sequence diagram," "state machine," "network diagram," "ER/schema diagram," "comparison table," "labeled memory/code illustration."

# Distill, don't transcribe
Reduce the concept to the single idea the image must teach; always output a high-level spec, even when input is verbose or explicitly demands completeness (text-heavy images render poorly; legibility beats completeness). Note dropped detail briefly in parentheses.
- Keep the focal mechanism accurate and legible; compress or omit surrounding context, enumerations, and edge cases.
- Collapse repetition: show N identical elements as one representative unit plus a count (e.g. one "App Server" box marked "×N"), never N copies.
- Convey meaning through shape, arrangement, and connectors; label only where structure alone is ambiguous.

Distillation examples (verbose input → outline):
- "Full TCP three-way handshake and teardown — SYN, SYN-ACK, ACK, then FIN, ACK, FIN, ACK, with sequence/ack numbers." → "Sequence diagram of the TCP handshake between \\"Client\\" and \\"Server,\\" three directional arrows labeled \\"SYN,\\" \\"SYN-ACK,\\" \\"ACK.\\" (Teardown and sequence numbers omitted to stay high-level.)"
- "Microservices e-commerce system: 8 services each with its own database, plus message queue, API gateway, cache, CDN, and all calls." → "Architecture diagram of a microservices system: an \\"API Gateway\\" routing to one representative \\"Service\\" box marked \\"×N,\\" backed by a \\"Database\\" and a \\"Message Queue,\\" arrows showing request flow. (Individual services and supporting infra collapsed for clarity.)"

# Output — respond with JSON only, no markdown fences
{
  "enhancedOutline": "...",
  "caption": "..."
}

- \`enhancedOutline\`: order as diagram type → subject → composition/layout → labels → connectors; content-level exclusions last. Be concrete about components, counts, and placement; avoid vague adjectives ("clean," "modern"). ~2–4 sentences (~60–80 words) single-panel; one short line per panel if multi-panel (prefix \`A:\`, \`B:\`, \`C:\`).
- \`caption\`: one line, ≤10 words, e.g. "Request flowing through a load-balanced web tier."

# Rules
- Prefer one panel. Split into 2–3 only for inherently sequential/multi-stage concepts that can't be shown at one abstraction level — never to preserve detail.
- Use the fewest unambiguous labels; 4–6 per panel is a hard ceiling, not a target.
- All labels/titles must be exact quoted strings using standard technical terms (e.g. "Load Balancer," "Read Replica") — never describe what a label should say.
- Include connectors only where they carry functional meaning (request flow, data direction, pointer references, part-to-label mapping); omit decorative lines.
- Don't invent components, values, or facts not in the input; note genuine ambiguity in parentheses rather than fabricating.
- Don't name colors or hex — express color only as an abstract role ("one accent color to highlight the failing node," "color-code the three services distinctly") and let the style layer assign it.
- Don't specify what the style block owns: medium, color, stroke, fills, shading, gradients, background, lighting, or facial features (actors/users are featureless — no eyes, mouths, or expressions).`;

export async function enhanceImageDescription(
  description: string,
): Promise<{ enhancedOutline: string; caption: string }> {
  try {
    const raw = await generateText(description, {
      tier: 'normal',
      system: IMAGE_ENHANCER_SYSTEM,
      maxTokens: 400,
    });
    const parsed = parseJsonLoose<{ enhancedOutline?: string; caption?: string }>(raw);
    const enhancedOutline = parsed?.enhancedOutline?.trim();
    const caption = parsed?.caption?.trim();
    if (enhancedOutline) return { enhancedOutline, caption: caption || '' };
  } catch {
    // fall through to raw description on any failure
  }
  return { enhancedOutline: description, caption: '' };
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
  opts: {
    size?: '1280x720' | '1024x1536' | '1024x1024';
    rawPrompt?: string;
    /** The style's saved reference picture, when it has one. */
    reference?: { buf: Buffer; type: string } | null;
  } = {},
): Promise<{ url: string; buffer: Buffer; filename: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const size = opts.size || '1280x720';
  // A reference picture replaces the written style rather than joining it:
  // sending both pulls the result two ways. The style's own text is already in
  // rawPrompt, so only the lead-in changes.
  const prompt = opts.reference
    ? `# Images attached\nThe attached image is a STYLE REFERENCE only: match its visual style, palette, line weight and treatment. Do not copy its subject matter.\n\n${opts.rawPrompt ?? buildBlogImagePrompt(content, '')}`
    : opts.rawPrompt ?? buildBlogImagePrompt(content);

  const body = JSON.stringify({
    model: 'gpt-image-2',
    quality: IMAGE_QUALITY,
    size,
    output_format: IMAGE_FORMAT,
    prompt,
  });

  // The generations endpoint takes no image, so a reference means the edits
  // endpoint and a multipart body instead.
  const sendReference = () => {
    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', IMAGE_QUALITY);
    form.append('output_format', IMAGE_FORMAT);
    form.append('image', new Blob([new Uint8Array(opts.reference!.buf)], { type: opts.reference!.type }), 'reference.png');
    return form;
  };

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, attempt * 2000));

    let res: Response;
    try {
      res = opts.reference
        ? await fetch('https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: sendReference(),
        })
        : await fetch('https://api.openai.com/v1/images/generations', {
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
    const filename = `img${order}-${crypto.randomBytes(4).toString('hex')}.${IMAGE_EXT}`;
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
