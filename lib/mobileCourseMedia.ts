// Turn an Educative-authored media card into an ordinary image card we can edit.
//
// Two kinds arrive from an import that this app cannot author: a d2-card, whose
// picture only exists as D2 source, and a raster image someone uploaded. Both
// are readOnly on import, because rebuilding their page would drop the media.
// The functions here replace the media with a generated image of our own, which
// is what makes the card editable — so each one is destructive by intent and is
// only ever run when the author asks for that card.

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { generateText } from './ai';
import { slugify, IMAGE_QUALITY, IMAGE_FORMAT, IMAGE_EXT } from './imageGen';
import { buildCardImagePrompt, generateCardImage } from './mobileCoursePipeline';
import { enforceCharLimits } from './mobileShortsPipeline';
import type { MobileCard } from './mobileCourseStorage';

const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');

export function cardImageSubfolder(courseId: string, chapterId: string): string {
  return `mobile-courses/${slugify(courseId)}/${slugify(chapterId)}`;
}

export type MediaMode = 'd2' | 'recreate' | 'fresh';

/** A picture the image model cannot take as input, so there is nothing to recreate from. */
export function isUnreadableImage(url: unknown): boolean {
  // SVG is vector XML, not raster: the edits endpoint rejects it, and a card
  // carrying one has to be re-illustrated from its words like a Lottie.
  return /\.svgz?(\?|#|$)/i.test(String(url || ''));
}

/**
 * Which replacement a card's picture needs, or null when it has none we can
 * better. D2 source is redrawn from the source, a hosted raster is redrawn
 * from the picture itself, and a Lottie animation or an SVG — neither of which
 * the image model can read — is replaced by an illustration drawn from the
 * card's own words.
 */
export function mediaModeFor(card: MobileCard): MediaMode | null {
  if (card.d2Code) return 'd2';
  if (card.lottieUrl || card.remoteKind === 'text-with-animation') return 'fresh';
  if (/^https?:\/\//.test(String(card.imageUrl || ''))) {
    return isUnreadableImage(card.imageUrl) ? 'fresh' : 'recreate';
  }
  return null;
}

/** Read the D2 source and say, in plain words, what the picture shows. */
export async function describeD2Diagram(card: MobileCard): Promise<string> {
  const code = String(card.d2Code || '').slice(0, 6000);
  if (!code.trim()) throw new Error('This card has no D2 source to work from');
  // The card's own words say what the diagram is for; the source says what it
  // contains. A brief written from the source alone reproduces shapes without
  // understanding them, which is where the technical errors came from.
  const context = [card.text, card.img_context, card.explanation]
    .filter(Boolean).join('\n').slice(0, 2000);
  const prompt = `Below is the D2 source of a technical diagram from a card titled "${card.title || ''}".

Write the illustration brief for an artist who cannot read D2.

Read the source for what it means, not only for what it draws. Work out what the diagram is
teaching, then describe the picture that teaches it.

Rules:
- Every component, label and arrow direction must come from the source. Invent nothing, rename
  nothing, and reverse no arrow. Where the source labels an edge, keep that label's wording.
- Keep it high-level. Carry across the components that matter to the point being made and drop
  decorative or repeated ones; say "three workers" rather than naming six identical boxes.
- Name the overall shape the source actually has — left-to-right flow, layered stack, hub and
  spokes, cycle, comparison — and do not impose a different one.
- If the source and the card's words disagree about a name or a direction, follow the source and
  say so at the end in one short clause.

No preamble, no markdown, one paragraph of at most 120 words.
${context ? `\nWhat the card teaches:\n${context}\n` : ''}
D2 source:
${code}`;
  const out = await generateText(prompt, { tier: 'normal', maxTokens: 1200, noThinking: true });
  const idea = out.trim();
  if (!idea) throw new Error('Could not read the diagram source');
  return idea;
}

/**
 * Replace a d2-card's diagram with a generated illustration of the same thing.
 * The D2 source is kept on the card so the original is still recoverable.
 */
export async function imageFromD2(
  card: MobileCard,
  courseId: string,
  chapterId: string,
  order: number,
  note = '',
): Promise<MobileCard> {
  const idea = await describeD2Diagram(card);
  const draft: MobileCard = {
    ...card,
    type: card.text ? 'text_img' : 'img_only',
    illustration_idea: note ? `${idea}\n\nAlso: ${note}` : idea,
    img_context: card.text ? undefined : String(card.text || card.title || ''),
  };
  const url = await generateCardImage(draft, order, courseId, chapterId);
  if (!url) throw new Error('Image generation failed');
  // A diagram card's prose was written against the text limit, which is wider
  // than the one an image card gets. Trim it here or the card arrives already
  // unpublishable.
  const [capped] = await enforceCharLimits([draft], () => {}, 'course') as MobileCard[];
  return {
    ...draft,
    ...(capped || {}),
    imageUrl: url,
    remoteKind: undefined,
    readOnly: undefined,
    d2Url: undefined,
    regeneratedAt: new Date().toISOString(),
  };
}

async function fetchImageBytes(url: string): Promise<{ buf: Buffer; type: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the image: ${res.status}`);
  const type = res.headers.get('content-type') || 'image/png';
  if (!type.startsWith('image/')) throw new Error(`That URL is not an image (${type})`);
  return { buf: Buffer.from(await res.arrayBuffer()), type };
}

/**
 * Redraw an existing PNG or JPEG in the house style, keeping what it depicts.
 * The source is sent to the image model as the subject, so labels and structure
 * survive; only the treatment changes.
 */
export async function recreateCardImage(
  card: MobileCard,
  courseId: string,
  chapterId: string,
  order: number,
  note = '',
): Promise<MobileCard> {
  const source = String(card.imageUrl || '');
  if (!/^https?:\/\//.test(source)) {
    throw new Error('This card has no hosted image to recreate');
  }
  // An SVG only named by its content type gets caught below, after the fetch.
  if (isUnreadableImage(source)) return imageFromText(card, courseId, chapterId, order, note);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const { buf, type } = await fetchImageBytes(source);
  // Some pages serve an SVG from a path that does not say so. The edits
  // endpoint cannot take it, so fall back to drawing from the card's words.
  if (/svg/i.test(type)) return imageFromText(card, courseId, chapterId, order, note);
  const brief = `${card.illustration_idea || card.title || ''}`.trim();
  const prompt = `# Images attached
The attached image is the SUBJECT to recreate: keep what it depicts, its structure, its labels and their wording. Redraw it, do not trace over it.

${buildCardImagePrompt({ ...card, illustration_idea: brief || 'the attached diagram, redrawn' })}${note ? `\n\nAlso: ${note}` : ''}`;

  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('size', '1024x1536');
  form.append('quality', IMAGE_QUALITY);
  form.append('output_format', IMAGE_FORMAT);
  form.append('image', new Blob([new Uint8Array(buf)], { type }), 'source.png');

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Image recreation failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json: any = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image data returned');

  const subfolder = cardImageSubfolder(courseId, chapterId);
  const dir = path.join(IMAGES_DIR, ...subfolder.split('/'));
  await fs.mkdir(dir, { recursive: true });
  const filename = `recreated${order}-${crypto.randomBytes(4).toString('hex')}.${IMAGE_EXT}`;
  await fs.writeFile(path.join(dir, filename), Buffer.from(b64, 'base64'));

  return {
    ...card,
    type: card.text ? 'text_img' : 'img_only',
    imageUrl: `/api/images/${subfolder}/${filename}`,
    remoteKind: undefined,
    readOnly: undefined,
    regeneratedAt: new Date().toISOString(),
  };
}

/**
 * Give a card an illustration drawn from its own text.
 *
 * This is the Lottie case: the animation cannot be read, so there is nothing
 * to recreate from. The card's words are the only brief, and the animation is
 * dropped — which is the point of running this.
 */
export async function imageFromText(
  card: MobileCard,
  courseId: string,
  chapterId: string,
  order: number,
  note = '',
): Promise<MobileCard> {
  const body = [card.title, card.text, card.img_context, card.explanation]
    .filter(Boolean).join('\n').slice(0, 4000);
  if (!body.trim()) throw new Error('This card has no text to illustrate');

  const idea = (await generateText(
    `Below is a mobile learning card whose picture cannot be read and has to be drawn again from
the card itself. Write the illustration brief for one technical diagram, for an artist who has
not read the card.

The card's prose and this picture teach one concept between them. They are not two tellings of
the same thing. The prose already carries the reasoning — why it matters, what it costs, when it
does not hold — so the picture must carry what prose is bad at: the structure, the order, the
relationship, the comparison, the shape of the thing.

So: find the part of the concept the prose states but cannot show, and draw that. A reader who
has read the prose should still learn something from the picture; a reader who has only the
picture should still need the prose. If your brief could be replaced by reading the card aloud,
it is the wrong brief.

Rules:
- Draw only what the card states. Invent no component, number, product name or relationship, and
  do not fill the picture out with plausible architecture the card never mentions. This is where
  these conversions go wrong: a picture that looks right and says something the card does not.
- Keep it high-level: three to six elements. A picture that teaches one thing clearly beats one
  that covers the whole card.
- Never set the card's sentences in the picture. Labels name things — a component, a step, an
  axis, a side of a comparison — they do not restate the prose. No caption, no title, no summary
  line, and no bullet list of what the card already says.
- Name every box, actor and arrow you do include, with its label and the direction it points,
  using the card's own wording for names.
- Say what the overall shape is — left-to-right flow, layered stack, hub and spokes, comparison,
  cycle — choosing the one the card's content actually has.
- If the card does not describe anything a diagram can show, say so in one sentence instead of
  inventing a diagram.

No preamble, no markdown, one paragraph of at most 120 words.

Card:
${body}`,
    { tier: 'normal', maxTokens: 1200, noThinking: true },
  )).trim();
  if (!idea) throw new Error('Could not work out what to illustrate');

  const draft: MobileCard = {
    ...card,
    type: card.text ? 'text_img' : 'img_only',
    illustration_idea: note ? `${idea}\n\nAlso: ${note}` : idea,
    img_context: card.text ? undefined : String(card.img_context || card.title || ''),
  };
  const url = await generateCardImage(draft, order, courseId, chapterId);
  if (!url) throw new Error('Image generation failed');
  // An image card's text limit is tighter than a text card's, and this card
  // was written against the wider one.
  const [capped] = await enforceCharLimits([draft], () => {}, 'course') as MobileCard[];
  return {
    ...draft,
    ...(capped || {}),
    imageUrl: url,
    remoteKind: undefined,
    readOnly: undefined,
    lottieUrl: undefined,
    lottieName: undefined,
    regeneratedAt: new Date().toISOString(),
  };
}

/**
 * Draw a card's picture again from the brief it already has.
 *
 * Nothing about the card changes but the picture, so this is what a style
 * change or a prompt change needs: the card already carries an illustration
 * idea of our own, and only the drawing is out of date.
 */
export async function redrawCardImage(
  card: MobileCard,
  courseId: string,
  chapterId: string,
  order: number,
  note = '',
): Promise<MobileCard> {
  if (card.readOnly) throw new Error('This card is read-only; replace its media first');
  const brief = String(card.illustration_idea || '').trim();
  // No brief of our own to draw from — work one out from the card's words.
  if (!brief) return imageFromText(card, courseId, chapterId, order, note);

  const draft: MobileCard = note ? { ...card, illustration_idea: `${brief}\n\nAlso: ${note}` } : card;
  const url = await generateCardImage(draft, order, courseId, chapterId);
  if (!url) throw new Error('Image generation failed');
  return { ...card, imageUrl: url, regeneratedAt: new Date().toISOString() };
}

/** Whether a card carries a picture at all, replaceable or our own. */
export function hasPicture(card: MobileCard): boolean {
  return !!mediaModeFor(card) || card.type === 'text_img' || card.type === 'img_only';
}

/** Run whichever replacement a card needs. */
export async function replaceCardMedia(
  card: MobileCard,
  courseId: string,
  chapterId: string,
  order: number,
  mode: MediaMode,
  note = '',
): Promise<MobileCard> {
  if (mode === 'd2') return imageFromD2(card, courseId, chapterId, order, note);
  if (mode === 'recreate') return recreateCardImage(card, courseId, chapterId, order, note);
  return imageFromText(card, courseId, chapterId, order, note);
}
