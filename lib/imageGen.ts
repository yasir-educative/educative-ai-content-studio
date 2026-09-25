import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { generateText, parseJsonLoose, OPENAI_LIGHT } from './ai';

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

const COURSE_IMAGE_STYLE = `# Mandatory visual style

- Style: soft, gently inflated 2D editorial vector illustration; clean, playful, and shape-based, never SaaS/UI-card, generic icon-pack, clay, plush, or rendered 3D
- Forms: plump, rounded, slightly exaggerated silhouettes with smooth controlled curves; technical objects retain necessary straight edges and functional geometry but stay softened, chunky, and simplified
- Stroke: primary silhouettes and functional details use clean, consistent #223656 contours; never colored, sketchy, missing, or thick sticker-like outlines; shading and highlight patches remain unoutlined
- Volume: build dimensionality only with clearly separated flat shapes: a base fill, usually one darker same-family curved patch, and an optional small pale upper-left highlight; never use lighting to create volume
- Shading: solid palette colors only; no gradients, smooth tonal transitions, cast/drop/ground shadows, glow, blur, transparency fades, reflections, ambient shadows, beveling, or realistic lighting
- Highlights: sparse and subtle; use small cream/light curved patches on select major rounded forms only, following their curvature; never large glossy white shine or highlights on every object
- Objects: use simple, chunky, low-detail standalone illustrations with recognizable silhouettes and soft volume; avoid generic flat symbols, UI pictograms, standardized icon-library geometry, extrusion, or perspective-heavy 3D
- Detail: keep internal details sparse and chunky; prefer a few large illustrative shapes over dense circuitry, controls, or micro-details
- People: rounded heads, simple solid hair, capsule-like bodies, and curved limbs; faces remain featureless with no eyes, eyebrows, mouth, or interior facial details; a tiny nose may appear only through a side-profile silhouette
- Technical objects: monitors, servers, databases, clouds, gears, tools, charts, cubes, devices, and similar concepts remain immediately recognizable while following the same softened, simplified visual language
- Palette: use only #f36792, #fe877b, #ffc3b3, #f05b30, #fa7532, #fff2e5, #feb13d, #fdda84, #fefc8b, #ffffee, #fafb33, #a7de94, #049706, #83d689, #27b292, #91dece, #9ecfd4, #c7eeff, #51b5f2, #0277ca, #3382bb, #b5d8fe, #192e58, #223656, #777df5, #8c50b6, #e2a8dc, #fad0ec, #fe77b8, #ff92ba; use a coordinated subset of roughly 3–5 main hues per illustration
- Connectors: thin, smooth #223656 lines with simple arrowheads; solid or dashed only when conceptually useful; keep connectors visually lighter than illustrated-object contours
- Text: clean dark-navy sans-serif only; labels sit directly on the white background beside or below their objects; no handwritten, decorative, outlined, playful-display, or 3D typography
- Containers: never add decorative cards, pills, tiles, badges, colored panels, or boxes behind objects or labels; enclosing boundaries are allowed only when the boundary itself represents an actual system/component structure required by the concept
- Borders: no outer image border or decorative frame; outlines belong only to actual illustrated or structural elements
- Background: plain white or transparent with generous whitespace; no scenery, textures, gradients, decorative backdrops, floor planes, shadows, or atmospheric effects
- Composition: clean educational illustration or technical diagram with clear hierarchy, balanced spacing, standalone pictorial objects, and purposeful relationships; avoid dashboards, feature-card grids, and UI-style layouts
- Overall character: friendly, colorful, educational, softly dimensional, and slightly playful; graphic rather than rendered, simplified rather than flat, professional without becoming corporate or UI-like`;

export function buildCourseImagePrompt(description: string): string {
  return `${COURSE_IMAGE_STYLE}\n\nCreate: ${description}`;
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
      model: OPENAI_LIGHT,
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

// Extract the raw inner content of each [image]...[/image] tag.
// Also tries to pull a caption from [Caption]...[/Caption] sub-tags for the editor block.
export function extractImageContents(draft: string): Array<{ content: string; caption: string }> {
  const results: Array<{ content: string; caption: string }> = [];
  const re = /\[image\]([\s\S]*?)\[\/image\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(draft)) !== null) {
    const raw = match[1].trim();
    // Try to pull caption from [Caption]...[/Caption] sub-tag
    const captionM = raw.match(/\[Caption\]([\s\S]*?)\[\/Caption\]/i);
    let caption = '';
    if (captionM) {
      caption = captionM[1].trim();
      const bracketedCap = caption.match(/^\[([^\]]+)\]$/);
      if (bracketedCap) caption = bracketedCap[1].trim();
    }
    results.push({ content: raw, caption });
  }
  return results;
}
