// What each pipeline sends the image model, proven without calling it.
//
// Every scope resolves to a style, every style can carry a reference picture,
// and the shipped defaults must reproduce the exact prompt each pipeline used
// before styles were configurable. All of that is checked here on disk only.

import { promises as fs } from 'fs';
import path from 'path';
import {
  BUILTIN_ID, BLOG_BUILTIN_ID, MOBILE_BUILTIN_ID, COURSE_BUILTIN_ID,
  listStyles, getStyleById, getMobileStyle, saveStyle, deleteStyle,
  setDefaultStyle, saveStyleReference, clearStyleReference, readStyleReference,
  saveStylePreview, clearStylePreview, stylePreviewUrl, STYLE_PREVIEW_SUBJECT,
} from '@/lib/imageStyleStore';
import { STYLE_SCOPES } from '@/lib/imageStyleScopes';
import { buildBlogImagePrompt, buildCourseImagePrompt } from '@/lib/imageGen';
import { BLOG_IMAGE_STYLE } from '@/lib/blogImageStyle';
import { COURSE_IMAGE_STYLE } from '@/lib/courseImageStyle';
import { buildMobileCardImagePrompt } from '@/lib/mobileCardImagePrompt';
import { IMAGE_QUALITY, IMAGE_FORMAT, IMAGE_EXT } from '@/lib/imageGen';
import { makeEducativeImageBlock } from '@/lib/educative';
import { readFileSync } from 'fs';
import { listPersonas, savePersona, getPersonaImageStyleId } from '@/lib/personaStore';
import { promises as fsp } from 'fs';

const FILE = path.join(process.cwd(), 'data', 'educative-image-styles.json');

async function main() {
let fail = 0;
const t = (name: string, pass: boolean) => { if (!pass) fail++; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`); };

// The store writes to a real file, so put back whatever is there now.
let before: string | null = null;
try { before = await fs.readFile(FILE, 'utf8'); } catch { before = null; }
const restore = async () => {
  if (before === null) await fs.rm(FILE, { force: true });
  else await fs.writeFile(FILE, before, 'utf8');
};

try {
  // 1 ── Every scope has a shipped style to fall back to.
  {
    const ids = STYLE_SCOPES.map(({ scope }) => getStyleById(undefined, scope).id);
    t('every scope resolves to a style', ids.every(Boolean) && ids.length === 4);
    t('the four scopes are distinct', new Set(STYLE_SCOPES.map((s) => s.scope)).size === 4);
    const list = listStyles();
    t('all four shipped styles are listed',
      [BUILTIN_ID, BLOG_BUILTIN_ID, MOBILE_BUILTIN_ID, COURSE_BUILTIN_ID]
        .every((id) => list.styles.some((s) => s.id === id && s.builtin)));
  }

  // 2 ── The shipped defaults reproduce the old hardcoded prompts exactly.
  {
    const blog = getStyleById(BLOG_BUILTIN_ID, 'blog');
    t('the blog default is the prompt the pipeline always used',
      buildBlogImagePrompt('a cache', blog.body) === buildBlogImagePrompt('a cache'));
    t('the blog prompt still ends with the illustration idea',
      buildBlogImagePrompt('a cache').endsWith('Inputs Illustration idea: a cache'));
    t('the blog style carries no input line of its own', !BLOG_IMAGE_STYLE.includes('Inputs Illustration idea'));

    const course = getStyleById(COURSE_BUILTIN_ID, 'course');
    t('the course default is the prompt the pipeline always used',
      buildCourseImagePrompt('a queue', course.body) === buildCourseImagePrompt('a queue'));
    t('the course prompt keeps its Create line',
      buildCourseImagePrompt('a queue').endsWith('\n\nCreate: a queue'));
    t('the course style block is intact', COURSE_IMAGE_STYLE.includes('# Mandatory visual style'));

    const card = { type: 'text_img', illustration_idea: 'two boxes', text: 'x' };
    t('a mobile card is drawn in the mobile scope style',
      buildMobileCardImagePrompt(card).includes(getMobileStyle().body.trim().slice(0, 40)));
  }

  // 3 ── Choosing a style per scope, and the scopes staying independent.
  {
    // Whatever the other scopes point at right now must not move.
    const others = (['course', 'mobile', 'educative'] as const).map((s) => [s, getStyleById(undefined, s).id] as const);
    const mine = await saveStyle({ name: 'Check style', body: 'Flat line art, two colours.' });
    await setDefaultStyle(mine.id, 'blog');
    t('a scope points at the chosen style', getStyleById(undefined, 'blog').id === mine.id);
    t('choosing for one scope leaves the others alone',
      others.every(([scope, id]) => getStyleById(undefined, scope).id === id));
    t('the chosen style reaches the blog prompt',
      buildBlogImagePrompt('a cache', getStyleById(undefined, 'blog').body).startsWith('Flat line art, two colours.'));

    // 4 ── A reference picture: saved once, found by every later read.
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    await saveStyleReference(mine.id, png, 'png');
    t('the saved reference is readable back', (await readStyleReference(mine.id))?.buf.equals(png) === true);
    t('the reference shows up on the style', !!listStyles().styles.find((s) => s.id === mine.id)?.referenceUrl);
    t('the reference is served from the images route',
      (listStyles().styles.find((s) => s.id === mine.id)?.referenceUrl || '').startsWith('/api/images/style-references/'));
    t('a style without a picture reports none', !listStyles().styles.find((s) => s.id === COURSE_BUILTIN_ID)?.referenceUrl);

    // One picture per style: saving another replaces it rather than adding.
    const jpg = Buffer.from('ffd8ffe000104a46', 'hex');
    await saveStyleReference(mine.id, jpg, 'jpg');
    const after = await readStyleReference(mine.id);
    t('a second picture replaces the first', after?.buf.equals(jpg) === true);
    t('the replacement keeps its own type', after?.type === 'image/jpeg');

    await clearStyleReference(mine.id);
    t('a removed reference is gone', (await readStyleReference(mine.id)) === null);
    t('the style survives its reference being removed', !!listStyles().styles.find((s) => s.id === mine.id));

    // 5 ── A sample image: output, never sent to the model.
    const sample = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    t('a style starts with no sample', !stylePreviewUrl(mine.id));
    await saveStylePreview(mine.id, sample);
    t('the sample shows up on the style', !!listStyles().styles.find((s) => s.id === mine.id)?.previewUrl);
    t('the sample is served from the images route',
      (stylePreviewUrl(mine.id) || '').startsWith('/api/images/style-previews/'));
    t('the sample url is cache-busted so a redraw shows', /\?v=\d+$/.test(stylePreviewUrl(mine.id) || ''));
    t('a sample is never read back as a reference', (await readStyleReference(mine.id)) === null);
    t('every style draws the same preview subject',
      STYLE_PREVIEW_SUBJECT.includes('Client') && STYLE_PREVIEW_SUBJECT.includes('Database'));
    await clearStylePreview(mine.id);
    t('a removed sample is gone', !stylePreviewUrl(mine.id));

    // 6 ── Deleting a style frees the scopes that pointed at it.
    await saveStyleReference(mine.id, png, 'png');
    await saveStylePreview(mine.id, sample);
    await deleteStyle(mine.id);
    t('deleting a style falls the scope back to its shipped style',
      getStyleById(undefined, 'blog').id === BLOG_BUILTIN_ID);
    t('deleting a style takes its reference with it', (await readStyleReference(mine.id)) === null);
    t('deleting a style takes its sample with it', !stylePreviewUrl(mine.id));
  }

  // 7 ── Every image request asks for high quality JPEG, and no call site
  // quietly keeps its own setting.
  {
    t('the shared quality is high', IMAGE_QUALITY === 'high');
    t('the shared format is jpeg', IMAGE_FORMAT === 'jpeg');
    t('saved files take the matching extension', IMAGE_EXT === 'jpg');

    const sources = [
      'lib/imageGen.ts', 'lib/mobileCourseMedia.ts',
      'app/api/images/style/preview/route.ts', 'app/api/images/edit/route.ts',
    ].map((f) => [f, readFileSync(f, 'utf8')] as const);
    const strays = sources.filter(([, src]) =>
      /quality['"]?[,:]\s*['"](low|medium)['"]/.test(src) || /append\('quality', '(low|medium)'\)/.test(src));
    t(`no call site still asks for low quality${strays.length ? ` (${strays.map(([f]) => f).join(', ')})` : ''}`,
      strays.length === 0);
    const pngOut = sources.filter(([, src]) =>
      /output_format['"]?[,:]\s*['"]png['"]/.test(src) || /append\('output_format', 'png'\)/.test(src));
    t(`no call site still writes png${pngOut.length ? ` (${pngOut.map(([f]) => f).join(', ')})` : ''}`,
      pngOut.length === 0);

    // Educative is told what the bytes actually are, not always PNG.
    const jpg = makeEducativeImageBlock('/x/img0-ab12cd34.jpg', 'c', 10);
    t('a jpeg is published as a jpeg',
      jpg.content.imageType === 'data:image/jpeg' && jpg.content.metadata.name === 'image.jpg');
    const png = makeEducativeImageBlock('/x/legacy.png', 'c', 10);
    t('an older png is still published as a png',
      png.content.imageType === 'data:image/png' && png.content.metadata.name === 'image.png');
  }

  // 8 ── A persona can own an image style, overriding the pipeline default.
  {
    const persona = listPersonas()[0];
    const before = persona.imageStyleId;
    const styleFile = path.join(process.cwd(), 'data', 'personas', `${persona.slug}.json`);
    let hadFile = true;
    try { await fsp.access(styleFile); } catch { hadFile = false; }

    try {
      t('a persona starts on the pipeline default', getPersonaImageStyleId(persona.name) === undefined);

      const mine = await saveStyle({ name: 'Persona style', body: 'Ink on paper, single accent.' });
      await savePersona(persona.slug, { imageStyleId: mine.id });
      t('a persona remembers its style', getPersonaImageStyleId(persona.name) === mine.id);
      t('the bound style is what the blog scope resolves to',
        getStyleById(getPersonaImageStyleId(persona.name), 'blog').id === mine.id);
      t('binding one persona does not move the scope default',
        getStyleById(undefined, 'blog').id !== mine.id);

      // A style can be deleted after a persona points at it.
      await deleteStyle(mine.id);
      t('a persona pointing at a deleted style falls back to the default',
        getStyleById(getPersonaImageStyleId(persona.name), 'blog').id === getStyleById(undefined, 'blog').id);

      await savePersona(persona.slug, { imageStyleId: '' });
      t('an empty binding clears it', getPersonaImageStyleId(persona.name) === undefined);
      t('an unknown persona name has no style', getPersonaImageStyleId('Nobody At All') === undefined);
    } finally {
      if (hadFile) await savePersona(persona.slug, { imageStyleId: before ?? '' });
      else await fsp.rm(styleFile, { force: true });
    }
  }

  // 9 ── The shipped styles cannot be deleted out from under a pipeline.
  {
    let threw = '';
    try { await deleteStyle(COURSE_BUILTIN_ID); } catch (e: any) { threw = e?.message || ''; }
    t('a shipped style cannot be deleted', threw.includes('cannot be deleted'));
  }
} finally {
  await restore();
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
}
main();
