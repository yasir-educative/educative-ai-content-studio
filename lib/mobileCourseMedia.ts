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
import { slugify } from './imageGen';
import { buildCardImagePrompt, generateCardImage } from './mobileCoursePipeline';
import { enforceCharLimits } from './mobileShortsPipeline';
import type { MobileCard } from './mobileCourseStorage';

const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');

export function cardImageSubfolder(courseId: string, chapterId: string): string {
  return `mobile-courses/${slugify(courseId)}/${slugify(chapterId)}`;
}

export type MediaMode = 'd2' | 'recreate' | 'fresh';

/**
 * Which replacement a card's picture needs, or null when it has none we can
 * better. D2 source is redrawn from the source, a hosted raster is redrawn
 * from the picture itself, and a Lottie animation — which we cannot read at
 * all — is replaced by an illustration drawn from the card's own words.
 */
export function mediaModeFor(card: MobileCard): MediaMode | null {
  if (card.d2Code) return 'd2';
  if (card.lottieUrl || card.remoteKind === 'text-with-animation') return 'fresh';
  if (/^https?:\/\//.test(String(card.imageUrl || ''))) return 'recreate';
  return null;
}

/** Read the D2 source and say, in plain words, what the picture shows. */
export async function describeD2Diagram(card: MobileCard): Promise<string> {
  const code = String(card.d2Code || '').slice(0, 6000);
  if (!code.trim()) throw new Error('This card has no D2 source to work from');
  const prompt = `Below is the D2 source of a technical diagram from a lesson titled "${card.title || ''}".

Describe the picture it draws, as an illustration brief for an artist who cannot read D2.
Name every box, group and actor, and every arrow with its label and direction. Keep the same
wording for labels so the drawing matches the original. Say what the overall shape is
(left-to-right flow, layered stack, hub and spokes, and so on). No preamble, no markdown,
one paragraph of at most 120 words.

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
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const { buf, type } = await fetchImageBytes(source);
  const brief = `${card.illustration_idea || card.title || ''}`.trim();
  const prompt = `# Images attached
The attached image is the SUBJECT to recreate: keep what it depicts, its structure, its labels and their wording. Redraw it, do not trace over it.

${buildCardImagePrompt({ ...card, illustration_idea: brief || 'the attached diagram, redrawn' })}${note ? `\n\nAlso: ${note}` : ''}`;

  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('size', '1024x1536');
  form.append('quality', 'high');
  form.append('output_format', 'png');
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
  const filename = `recreated${order}-${crypto.randomBytes(4).toString('hex')}.png`;
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
    `Below is a mobile learning card. Write the illustration brief for one technical diagram that
teaches what the card teaches, for an artist who has not read it.

Name every box, actor and arrow, with the label each one carries and the direction it points.
Say what the overall shape is (left-to-right flow, layered stack, hub and spokes, and so on).
Draw only what the card states — invent no component, number or product name.
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
