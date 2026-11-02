import { getMobileShort, updateMobileShort } from './mobileShortsStorage';
import { getMobileCourse, updateMobileCourse, type MobileCard } from './mobileCourseStorage';
import { isCardType, SHORTS_CARD_TYPES } from './mobileCardTypes';
import { checkCard, type CardProduct } from './mobileCardLimits';
import { rewriteCard } from './cardRewriteAgent';
import { generateCardImage } from './mobileShortsPipeline';

type Params = { id: string; cardId: string; chapterId?: string };

async function read(product: CardProduct, params: Params) {
  if (product === 'short') {
    const short = await getMobileShort(params.id);
    if (!short) return null;
    return { course: null, cards: short.cards, running: short.status === 'running', context: { topic: short.topic, level: short.level, objective: short.objective, neighbours: [] as MobileCard[] } };
  }
  const course = await getMobileCourse(params.id);
  const chapter = course?.chapters.find((c) => c.id === params.chapterId);
  if (!course || !chapter) return null;
  return { course, cards: chapter.cards, running: course.status === 'running' || chapter.status === 'processing', context: {
    courseName: course.title, chapterTitle: chapter.title,
    chapterSummary: chapter.summary,
    lessonOutline: chapter.lessonOutline ?? course.stageOutputs?.[`${chapter.id}-card-planner`], neighbours: [] as MobileCard[],
  } };
}

async function save(product: CardProduct, params: Params, original: MobileCard, candidate: MobileCard) {
  const latest = await read(product, params);
  if (!latest) return Response.json({ error: 'Not found' }, { status: 404 });
  if (latest.running || JSON.stringify(latest.cards.find((c) => c.id === original.id)) !== JSON.stringify(original)) {
    return Response.json({ error: 'Card changed during rewriting; try again' }, { status: 409 });
  }
  const issues = checkCard(candidate, product);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    console.error(`[card-rewrite] ${product} ${params.id} card ${original.id}: rejected candidate —`,
      errors.map((i) => `${i.path}: ${i.message}`).join('; '));
    // Name the fields. A bare "breaks the rules" tells the author nothing about
    // what to fix or whether to simply try again.
    return Response.json({
      error: `The rewrite still breaks ${errors.length === 1 ? 'a rule' : `${errors.length} rules`}: ${errors.map((i) => i.message).join('; ')}`,
      issues,
    }, { status: 422 });
  }
  const cards = latest.cards.map((c) => c.id === original.id ? candidate : c);
  if (product === 'short') await updateMobileShort(params.id, { cards });
  else {
    const course = latest.course;
    if (!course) return Response.json({ error: 'Not found' }, { status: 404 });
    await updateMobileCourse(params.id, { chapters: course.chapters.map((c) => c.id === params.chapterId ? { ...c, cards, regeneratedAt: new Date().toISOString() } : c) });
  }
  return Response.json({ card: candidate, issues });
}

export async function handleCardRewrite(req: Request, params: Params, product: CardProduct, mode: 'preview' | 'accept' | 'regenerate') {
  {
    try {
      let body;
      try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || (body.type !== undefined && !isCardType(body.type))
        || (mode === 'regenerate' && body.type !== undefined && !SHORTS_CARD_TYPES.includes(body.type))
        || (body.note !== undefined && typeof body.note !== 'string')
        || (body.regenerateImage !== undefined && typeof body.regenerateImage !== 'boolean')) {
        return Response.json({ error: 'Invalid rewrite options' }, { status: 400 });
      }
      const record = await read(product, params);
      if (!record) return Response.json({ error: 'Not found' }, { status: 404 });
      if (record.running) return Response.json({ error: 'Wait for generation to finish' }, { status: 409 });
      const index = record.cards.findIndex((c) => c.id === params.cardId);
      if (index < 0) return Response.json({ error: 'Card not found' }, { status: 404 });
      const original = record.cards[index];
      if (original.readOnly) return Response.json({ error: original.readOnly }, { status: 409 });
      if (mode === 'accept') {
        if (!body.original || !body.candidate || typeof body.candidate !== 'object' || Array.isArray(body.candidate)) return Response.json({ error: 'Original and candidate are required' }, { status: 400 });
        if (JSON.stringify(original) !== JSON.stringify(body.original)) return Response.json({ error: 'Card changed during rewriting; try again' }, { status: 409 });
        // The publish identity of the card is the server's, never the client's.
        const candidate = { ...body.candidate, id: original.id, card_number: original.card_number, pageId: original.pageId, publishedUrl: original.publishedUrl };
        return await save(product, params, original, candidate);
      }
      const result = await rewriteCard({ product, card: original, type: body.type, note: body.note, preserveImageDescription: !body.regenerateImage,
        context: { ...record.context, neighbours: record.cards.filter((_, i) => Math.abs(i - index) === 1) } });
      const type = result.candidate.type;
      if ((type === 'text_img' || type === 'img_only') && (body.regenerateImage || (mode === 'regenerate' && type !== original.type))) {
        const imageUrl = await generateCardImage(result.candidate, index, params.id, product);
        if (!imageUrl) throw new Error('Image generation failed; the original card was kept');
        result.candidate.imageUrl = imageUrl;
        result.issues = checkCard(result.candidate, product);
      }
      if (mode === 'regenerate') return await save(product, params, original, result.candidate);
      return Response.json({ ...result, original });
    } catch (error: any) {
      return Response.json({ error: error?.message || 'Rewrite failed' }, { status: 500 });
    }
  }
}
