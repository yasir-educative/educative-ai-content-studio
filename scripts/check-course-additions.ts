// Where do newly created pages land in the published table of contents?
//
// This is the part of adding cards to a live course that cannot be checked by
// reading the code: one wrong index silently moves a reader's lesson. Every
// case here is pure — no Educative call, nothing published.
import { capNewCards, chapterOutline, newCardBudget, placeNewPagesInToc, placeProposals, withRefreshWork, type Proposal } from '@/lib/mobileCourseAugment';
import type { MobileChapter } from '@/lib/mobileCourseStorage';
import { mediaModeFor, isUnreadableImage, hasPicture } from '@/lib/mobileCourseMedia';
import { buildMobileCardImagePrompt } from '@/lib/mobileCardImagePrompt';
import { cardsGeneratorPrompt, CARD_FORMATTING_RULES } from '@/lib/mobilePrompts';
import type { ChpCategory } from '@/lib/courseEducative';
import type { MobileCard, MobileCourse } from '@/lib/mobileCourseStorage';

let fail = 0;
const t = (name: string, ok: boolean, detail = '') => {
  if (!ok) { fail++; console.log('FAIL', name, detail); } else console.log('ok  ', name);
};

const IDS = { authorId: '42', collectionId: '77' };

function category(id: string, title: string, pageIds: string[]): ChpCategory {
  return {
    id, title, summary: '', editMode: false, type: 'COLLECTION_CATEGORY',
    pages: pageIds.map((pid) => ({
      author_id: 42, collection_id: 77, page_id: Number(pid), id: Number(pid), title: `page ${pid}`,
      is_preview: false, parentIndex: null, editMode: false, is_recovered: false,
      type: 'collection_lesson', can_edit: false, is_standalone_module: false, is_cloned: false, brief_summary: '',
    })),
  };
}
const order = (cat: ChpCategory) => cat.pages.map((p) => String(p.page_id));

// ── A card inserted in the middle of a chapter ───────────────────────────────
{
  const cats = [category('1', 'One', ['100', '101', '102'])];
  const chapters = [{
    remoteCategoryId: '1', title: 'One',
    cards: [{ id: 'a', pageId: '100' }, { id: 'new', pageId: undefined }, { id: 'b', pageId: '101' }, { id: 'c', pageId: '102' }],
  }];
  placeNewPagesInToc(cats, chapters, new Map([['new', { pageId: '900', title: 'New' }]]), IDS);
  t('card lands between the pages it sits between', order(cats[0]).join() === '100,900,101,102', order(cats[0]).join());
}

// ── First and last position ──────────────────────────────────────────────────
{
  const cats = [category('1', 'One', ['100', '101'])];
  const chapters = [{
    remoteCategoryId: '1', title: 'One',
    cards: [{ id: 'new', pageId: undefined }, { id: 'a', pageId: '100' }, { id: 'b', pageId: '101' }],
  }];
  placeNewPagesInToc(cats, chapters, new Map([['new', { pageId: '900', title: 'New' }]]), IDS);
  t('card at position 0 goes first', order(cats[0]).join() === '900,100,101', order(cats[0]).join());
}
{
  const cats = [category('1', 'One', ['100', '101'])];
  const chapters = [{
    remoteCategoryId: '1', title: 'One',
    cards: [{ id: 'a', pageId: '100' }, { id: 'b', pageId: '101' }, { id: 'new', pageId: undefined }],
  }];
  placeNewPagesInToc(cats, chapters, new Map([['new', { pageId: '900', title: 'New' }]]), IDS);
  t('card at the end goes last', order(cats[0]).join() === '100,101,900', order(cats[0]).join());
}

// ── Several consecutive cards keep their order ───────────────────────────────
{
  const cats = [category('1', 'One', ['100', '101'])];
  const chapters = [{
    remoteCategoryId: '1', title: 'One',
    cards: [{ id: 'a', pageId: '100' }, { id: 'n1' }, { id: 'n2' }, { id: 'n3' }, { id: 'b', pageId: '101' }],
  }];
  placeNewPagesInToc(cats, chapters, new Map([
    ['n1', { pageId: '901', title: '1' }], ['n2', { pageId: '902', title: '2' }], ['n3', { pageId: '903', title: '3' }],
  ]), IDS);
  t('consecutive cards keep their order', order(cats[0]).join() === '100,901,902,903,101', order(cats[0]).join());
}

// ── A page added in Educative since the import does not shift the insertion ──
{
  const cats = [category('1', 'One', ['100', '555', '101'])];
  const chapters = [{
    remoteCategoryId: '1', title: 'One',
    cards: [{ id: 'a', pageId: '100' }, { id: 'new' }, { id: 'b', pageId: '101' }],
  }];
  placeNewPagesInToc(cats, chapters, new Map([['new', { pageId: '900', title: 'New' }]]), IDS);
  t('an unknown remote page is not disturbed', order(cats[0]).join() === '100,900,555,101', order(cats[0]).join());
}

// ── A new chapter between two existing ones ──────────────────────────────────
{
  const cats = [category('1', 'One', ['100']), category('2', 'Three', ['300'])];
  const chapters = [
    { remoteCategoryId: '1', title: 'One', cards: [{ id: 'a', pageId: '100' }] },
    { title: 'Two', cards: [{ id: 'n1' }, { id: 'n2' }] },
    { remoteCategoryId: '2', title: 'Three', cards: [{ id: 'c', pageId: '300' }] },
  ];
  const { chapterCategoryIds } = placeNewPagesInToc(cats, chapters, new Map([
    ['n1', { pageId: '901', title: '1' }], ['n2', { pageId: '902', title: '2' }],
  ]), IDS);
  t('new chapter sits in the middle', cats.map((c) => c.title).join() === 'One,Two,Three', cats.map((c) => c.title).join());
  t('new chapter holds its pages in order', order(cats[1]).join() === '901,902', order(cats[1]).join());
  t('new chapter id is reported back', chapterCategoryIds[1] === cats[1].id, JSON.stringify(chapterCategoryIds));
  t('new chapter id collides with nothing', new Set(cats.map((c) => c.id)).size === 3);
}

// ── A new chapter first ──────────────────────────────────────────────────────
{
  const cats = [category('1', 'One', ['100'])];
  const chapters = [
    { title: 'Zero', cards: [{ id: 'n1' }] },
    { remoteCategoryId: '1', title: 'One', cards: [{ id: 'a', pageId: '100' }] },
  ];
  placeNewPagesInToc(cats, chapters, new Map([['n1', { pageId: '900', title: '0' }]]), IDS);
  t('new first chapter goes first', cats.map((c) => c.title).join() === 'Zero,One', cats.map((c) => c.title).join());
}

// ── A chapter with nothing new is left exactly as it was ─────────────────────
{
  const cats = [category('1', 'One', ['100', '101']), category('2', 'Two', ['200'])];
  const before = JSON.stringify(cats[1]);
  const chapters = [
    { remoteCategoryId: '1', title: 'One', cards: [{ id: 'a', pageId: '100' }, { id: 'new' }, { id: 'b', pageId: '101' }] },
    { remoteCategoryId: '2', title: 'Two', cards: [{ id: 'c', pageId: '200' }] },
  ];
  placeNewPagesInToc(cats, chapters, new Map([['new', { pageId: '900', title: 'New' }]]), IDS);
  t('untouched chapter is unchanged', JSON.stringify(cats[1]) === before);
  t('page entry carries the numeric ids', cats[0].pages[1].page_id === 900 && cats[0].pages[1].id === 900);
}

// ── A local chapter the collection no longer has ─────────────────────────────
{
  const cats = [category('1', 'One', ['100'])];
  const chapters = [
    { remoteCategoryId: '1', title: 'One', cards: [{ id: 'a', pageId: '100' }] },
    { remoteCategoryId: '99', title: 'Deleted remotely', cards: [{ id: 'd', pageId: '400' }] },
  ];
  placeNewPagesInToc(cats, chapters, new Map(), IDS);
  t('a chapter with nothing new is never recreated', cats.length === 1, String(cats.length));
}

// ── placeProposals: indices refer to the course the analyst read ─────────────
{
  const card = (id: string): MobileCard => ({ id, type: 'text', title: id, text: 'x' });
  const course = {
    id: 'c', title: 'T', createdAt: '', updatedAt: '', status: 'published', collectionId: '', authorId: '1',
    chapters: [
      { id: 'ch1', title: 'One', status: 'done', cards: [card('a'), card('b'), card('c')] },
      { id: 'ch2', title: 'Two', status: 'done', cards: [card('d')] },
    ],
  } as MobileCourse;
  const p = (id: string, kind: Proposal['kind'], ci: number, at: number): Proposal =>
    ({ id, kind, chapter_index: ci, insert_at: at, chapter_title: id, note: '', reason: '', cards: [] });
  const chapters = placeProposals(course, [
    { proposal: p('p1', 'cards', 0, 1), cards: [card('n1')] },
    { proposal: p('p2', 'cards', 0, 3), cards: [card('n2')] },
    { proposal: p('p3', 'chapter', 0, 0), cards: [card('n3')] },
    { proposal: p('p4', 'rewrite', 1, 0), cards: [{ ...card('d'), title: 'rewritten' }] },
  ]);
  t('both insertions use the original indices',
    chapters[0].cards.map((k) => k.id).join() === 'a,n1,b,c,n2', chapters[0].cards.map((k) => k.id).join());
  t('new chapter follows the chapter it was planned for',
    chapters.map((c) => c.title).join() === 'One,p3,Two', chapters.map((c) => c.title).join());
  t('a rewrite replaces in place and shifts nothing',
    chapters[2].cards.length === 1 && chapters[2].cards[0].id === 'd' && chapters[2].cards[0].title === 'rewritten',
    JSON.stringify(chapters[2].cards.map((k) => [k.id, k.title])));
  t('cards are renumbered', chapters[0].cards.map((k) => k.card_number).join() === '1,2,3,4,5');
}

// ── withRefreshWork: what a chapter refresh does without asking the model ───
{
  const ok = (id: string): MobileCard =>
    ({ id, type: 'text', title: 'A fine title', text: 'x'.repeat(400) });
  const chapter: MobileChapter = {
    id: 'ch', title: 'One', status: 'done',
    cards: [
      ok('clean'),
      { id: 'lottie', type: 'text', title: 'An animated card', text: 'x'.repeat(400), lottieUrl: 'https://l/a.json', readOnly: 'animation' },
      { id: 'd2', type: 'text', title: 'A diagram card', text: 'x'.repeat(400), d2Code: 'a -> b', remoteKind: 'd2-card', readOnly: 'diagram' },
      { id: 'raster', type: 'text_img', title: 'An uploaded picture', text: 'x'.repeat(260), imageUrl: 'https://cdn/a.png', illustration_idea: 'a thing' },
      { id: 'toolong', type: 'text', title: 'Far too long', text: 'x'.repeat(900) },
      { id: 'stuck', type: 'text', title: 'Unreadable card', text: '', readOnly: 'unknown widget' },
    ],
  };
  const planned: Proposal = {
    id: 'ai1', kind: 'rewrite', chapter_index: 0, insert_at: 0,
    chapter_title: '', note: 'The figure is out of date', reason: 'Correctness', cards: [],
  };
  const out = withRefreshWork(chapter, 0, [planned]);
  const at = (i: number) => out.find((p) => p.insert_at === i);

  t('a clean card the analyst flagged is still rewritten, with no media',
    at(0)?.kind === 'rewrite' && !at(0)?.media, JSON.stringify(at(0)));
  t('a Lottie card is re-illustrated from its own words', at(1)?.media === 'fresh', JSON.stringify(at(1)));
  t('a D2 card is redrawn from its source', at(2)?.media === 'd2', JSON.stringify(at(2)));
  t('an uploaded raster is recreated', at(3)?.media === 'recreate', JSON.stringify(at(3)));
  t('a card over the limit is rewritten even though the analyst said nothing',
    at(4)?.kind === 'rewrite' && !at(4)?.media && at(4)!.note.includes('450'), JSON.stringify(at(4)));
  t('a read-only card with no media to replace is left alone', !at(5), JSON.stringify(at(5)));
  t('media-only cards are proposed as media, not as rewrites',
    at(1)?.kind === 'media' && at(2)?.kind === 'media' && at(3)?.kind === 'media',
    out.map((p) => `${p.insert_at}:${p.kind}`).join());
  t('one proposal per card', new Set(out.map((p) => p.insert_at)).size === out.length);

  // Whatever the toggles say, the analysis still runs and what it names is
  // still carried out, and a card failing the gate is still corrected.
  const noMedia = withRefreshWork(chapter, 0, [planned], { text: true, media: false });
  t('pictures off: no card is re-illustrated', noMedia.every((p) => !p.media), JSON.stringify(noMedia.map((p) => p.media)));
  t('pictures off: every proposal is a rewrite', noMedia.every((p) => p.kind === 'rewrite'));
  t('pictures off: the analyst note and the failing card still come through',
    noMedia.some((p) => p.insert_at === 0) && noMedia.some((p) => p.insert_at === 4));
  t('pictures off: a read-only card is skipped, since replacing its media is what frees it',
    !noMedia.some((p) => [1, 2, 5].includes(p.insert_at)), noMedia.map((p) => p.insert_at).join());

  const mediaOnly = withRefreshWork(chapter, 0, [planned], { text: false, media: true });
  t('wording pass off: the card the analysis named is still rewritten',
    mediaOnly.find((p) => p.insert_at === 0)?.kind === 'rewrite',
    JSON.stringify(mediaOnly.find((p) => p.insert_at === 0)));
  t('wording pass off: the analyst note survives',
    mediaOnly.find((p) => p.insert_at === 0)?.note.includes('out of date') === true);
  t('wording pass off: a card failing the gate is still corrected',
    mediaOnly.find((p) => p.insert_at === 4)?.kind === 'rewrite'
    && mediaOnly.find((p) => p.insert_at === 4)!.note.includes('450'));
  t('wording pass off: pictures are still replaced',
    [1, 2, 3].every((i) => !!mediaOnly.find((p) => p.insert_at === i)?.media));

  const neither = withRefreshWork(chapter, 0, [planned], { text: false, media: false });
  t('neither: the analysis still governs', neither.find((p) => p.insert_at === 0)?.kind === 'rewrite');
  t('neither: the gate still applies to every other card', neither.some((p) => p.insert_at === 4));
  t('neither: nothing is re-illustrated', neither.every((p) => !p.media));
  t('both is what it always did',
    JSON.stringify(withRefreshWork(chapter, 0, [planned], { text: true, media: true })) === JSON.stringify(out));
}

// ── placeProposals: a media replacement lands in place, like a rewrite ──────
{
  const card = (id: string): MobileCard => ({ id, type: 'text', title: id, text: 'x' });
  const course = {
    id: 'c', title: 'T', createdAt: '', updatedAt: '', status: 'published', collectionId: '', authorId: '1',
    chapters: [{ id: 'ch1', title: 'One', status: 'done', cards: [card('a'), card('b')] }],
  } as MobileCourse;
  const chapters = placeProposals(course, [{
    proposal: { id: 'm1', kind: 'media', chapter_index: 0, insert_at: 1, chapter_title: '', note: '', reason: '', cards: [], media: 'd2' },
    cards: [{ ...card('b'), type: 'text_img', imageUrl: '/api/images/x.png' }],
  }]);
  t('a media replacement keeps the card in place',
    chapters[0].cards.length === 2 && chapters[0].cards[1].id === 'b' && chapters[0].cards[1].imageUrl === '/api/images/x.png',
    JSON.stringify(chapters[0].cards.map((k) => [k.id, k.imageUrl])));
}

// The analyser is asked to catch a wrong quiz answer and a scenario that does
// not resolve, so the outline it reads has to carry them.
{
  const chapter = { id: 'c', title: 'Caching', status: 'done', cards: [
    { id: '1', type: 'quiz', title: 'Check', question: 'Which is stalest?',
      options: [{ id: 1, text: 'Edge' }, { id: 2, text: 'Origin' }], correctAnswer: 2 },
    { id: '2', type: 'scenarioCard', title: 'Drift', scenarioType: 'how-would-you-fix',
      sections: [
        { heading: 'What went wrong', content: 'Stale reads after a write.' },
        { heading: "Why it's wrong", content: 'Nothing invalidates the edge.' },
        { heading: 'The fix', content: 'Invalidate on write.' },
      ] },
    { id: '3', type: 'comparisonCards', title: 'Two layers',
      leftOption: { label: 'Edge', heading: '', description: 'Nearest hop.' },
      rightOption: { label: 'Origin', heading: '', description: 'Always current.' } },
    { id: '4', type: 'text-with-code', title: 'Read path', code: 'def get(k): return cache[k]' },
    { id: '5', type: 'recapCard', title: 'Recap', content: [{ heading: 'Caches', text: 'Trade freshness for speed.' }] },
    { id: '6', type: 'text_img', title: 'Flow', text: 'A read goes edge first.', illustration_idea: 'Client to edge to origin' },
  ] } as unknown as MobileChapter;
  const outline = chapterOutline(chapter);
  t('the outline shows quiz options', outline.includes('1. Edge | 2. Origin'));
  t('the outline shows which answer is marked correct', outline.includes('correct: 2'));
  t('the outline shows every scenario tab',
    outline.includes('What went wrong: Stale reads after a write.') && outline.includes('The fix: Invalidate on write.'));
  t('the outline shows both comparison sides', outline.includes('Edge: Nearest hop.') && outline.includes('Origin: Always current.'));
  t('the outline shows the code', outline.includes('def get(k)'));
  t('the outline shows recap items', outline.includes('Caches: Trade freshness for speed.'));
  t('the outline shows what the picture depicts', outline.includes('Client to edge to origin'));
  t('every card is still one line', outline.split('\n').length === chapter.cards.length);
  t('cards keep their index and type', outline.startsWith('[0] quiz') && outline.includes('\n[5] text_img'));
}

// An SVG cannot be fed to the image model, so it is re-illustrated from the
// card's words exactly as a Lottie is, not sent off to be "recreated".
{
  const card = (over: Partial<MobileCard>): MobileCard => ({ id: 'x', type: 'text_img', ...over } as MobileCard);
  t('an svg is drawn afresh, not recreated',
    mediaModeFor(card({ imageUrl: 'https://cdn/x/diagram.svg' })) === 'fresh');
  t('an svg with a query string is still caught',
    mediaModeFor(card({ imageUrl: 'https://cdn/x/diagram.svg?v=2' })) === 'fresh');
  t('a compressed svg is caught', isUnreadableImage('https://cdn/x/a.svgz'));
  t('a raster is still recreated from itself',
    mediaModeFor(card({ imageUrl: 'https://cdn/x/diagram.png' })) === 'recreate');
  t('a jpeg is still recreated', mediaModeFor(card({ imageUrl: 'https://cdn/x/a.jpg' })) === 'recreate');
  t('a name merely containing svg is not mistaken for one',
    !isUnreadableImage('https://cdn/x/svg-tutorial.png'));
  t('a lottie still wins over any image url',
    mediaModeFor(card({ imageUrl: 'https://cdn/x/a.png', lottieUrl: 'https://l/a.json' })) === 'fresh');
  t('d2 source still wins over everything',
    mediaModeFor(card({ imageUrl: 'https://cdn/x/a.svg', d2Code: 'a -> b' })) === 'd2');
  t('a card with no picture needs nothing', mediaModeFor(card({})) === null);
}

// Every card was coming back with the same composition, because the prompt
// mandated one: rows, a zigzag and a canvas to fill.
{
  const prompt = buildMobileCardImagePrompt(
    { type: 'text_img', text: 'Reads hit the edge first.', illustration_idea: 'client to edge to origin' },
    'Flat vector.',
  );
  t('the composition is no longer fixed to rows and a zigzag',
    !prompt.includes('3–4 horizontal rows') && !prompt.includes('Flow zigzags'));
  t('the canvas no longer has to be filled',
    !prompt.includes('Fill the canvas.') && /do not fill the canvas for the sake of it/i.test(prompt));
  t('the shape is chosen from the content', prompt.includes('choose the one shape that fits this idea'));
  t('it asks for a high-level picture', prompt.includes('Stay high-level'));
  t('mobile legibility is still enforced', prompt.includes('labels at least 26px high'));
  t('the chosen style still reaches the prompt', prompt.includes('Flat vector.'));
}

// Redrawing a whole chapter covers our own pictures too, not only the
// Educative media that mediaModeFor knows how to replace.
{
  const card = (over: Partial<MobileCard>): MobileCard => ({ id: 'x', type: 'text', ...over } as MobileCard);
  t('a card with our own illustration counts as a picture',
    hasPicture(card({ type: 'text_img', imageUrl: '/api/images/a.jpg', illustration_idea: 'a flow' })));
  t('an image-only card counts', hasPicture(card({ type: 'img_only', imageUrl: '/api/images/a.jpg' })));
  t('a plain text card does not', !hasPicture(card({ type: 'text', text: 'x' })));
  t('a d2 card counts even though its type is text', hasPicture(card({ d2Code: 'a -> b' })));
  t('a lottie card counts', hasPicture(card({ lottieUrl: 'https://l/a.json' })));
  t('an svg card counts', hasPicture(card({ type: 'text_img', imageUrl: 'https://cdn/a.svg' })));
  t('a card our own picture needs no media replacement, only a redraw',
    hasPicture(card({ type: 'text_img', imageUrl: '/api/images/a.jpg' }))
    && mediaModeFor(card({ type: 'text_img', imageUrl: '/api/images/a.jpg' })) === null);
}

// A chapter the mobile course never had is placed where the web course has
// it: after the mobile chapter paired with the nearest earlier web chapter.
{
  // pairs: [webChapterIndex, mobileChapterIndex]
  const place = (pairs: Array<[number, number]>, webIndex: number, chapterCount: number) => {
    const earlier = pairs.filter(([w]) => w < webIndex).map(([, m]) => m);
    return earlier.length ? Math.max(...earlier) + 1 : chapterCount;
  };
  const pairs: Array<[number, number]> = [[0, 0], [1, 1], [3, 2], [4, 3]];
  t('a gap goes after the chapter before it', place(pairs, 2, 4) === 2);
  t('a gap before everything goes at the end only when nothing precedes it',
    place(pairs, 0, 4) === 4);
  t('a gap after everything goes last', place(pairs, 5, 4) === 4);
  t('the nearest earlier pairing wins, not the first',
    place([[0, 0], [1, 3]], 2, 5) === 4);
  t('an unpaired course falls back to the end', place([], 2, 7) === 7);
}

// Prose and picture teach one concept between them. Neither restates the
// other, and the words never point at the picture.
{
  const prompt = buildMobileCardImagePrompt(
    { type: 'text_img', text: 'Caching trades freshness for speed.', illustration_idea: 'client, edge, origin' },
    'Flat vector.',
  );
  t('the picture is told what the prose already owns', prompt.includes('The\nprose carries the reasoning'));
  t('the picture is told not to set the prose', prompt.includes('Do not set the prose in the picture'));
  t('the card text is context only, never drawn',
    prompt.includes('never rendered as text, never restated in the drawing'));
  t('the prose still reaches the picture as context', prompt.includes('Caching trades freshness for speed.'));

  const imgOnly = buildMobileCardImagePrompt(
    { type: 'img_only', img_context: 'how a read is served', illustration_idea: 'client to origin' },
    'Flat vector.',
  );
  t('an image-only card still renders no text from its context', imgOnly.includes('do NOT render as text'));
}

// A chapter may gain at most 30% more cards in one update, so a thirty-chapter
// course cannot quietly grow past 800 cards in a single pass.
{
  t('fifteen cards buys five', newCardBudget(15) === 5);
  t('ten cards buys three', newCardBudget(10) === 3);
  t('twenty cards buys six', newCardBudget(20) === 6);
  t('a one-card chapter can still gain one', newCardBudget(1) === 1);
  t('an empty chapter can still gain one', newCardBudget(0) === 1);

  const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ card_title: `C${i}` }));
  const proposal = (id: string, n: number): Proposal => ({
    id, kind: 'cards', chapter_index: 0, insert_at: 0, chapter_title: '',
    note: '', reason: '', cards: cards(n) as any,
  });
  const rewrite: Proposal = {
    id: 'rw', kind: 'rewrite', chapter_index: 0, insert_at: 2, chapter_title: '',
    note: 'wrong', reason: 'Correctness', cards: [],
  };

  const under = capNewCards([proposal('a', 2), rewrite, proposal('b', 2)], 5);
  t('a plan inside its budget is untouched', under.dropped === 0 && under.proposals.length === 3);

  const over = capNewCards([proposal('a', 3), rewrite, proposal('b', 4), proposal('c', 2)], 5);
  const kept = over.proposals.filter((p) => p.kind === 'cards');
  t('the budget is never exceeded', kept.reduce((n, p) => n + p.cards.length, 0) === 5);
  t('what the analyst ranked first is kept', kept[0].id === 'a' && kept[0].cards.length === 3);
  t('the next proposal is trimmed, not dropped whole', kept[1].id === 'b' && kept[1].cards.length === 2);
  t('nothing is kept past the budget', !kept.some((p) => p.id === 'c'));
  t('the overflow is counted', over.dropped === 4);
  t('a rewrite costs nothing against the budget',
    over.proposals.some((p) => p.kind === 'rewrite'));

  const huge = capNewCards([proposal('a', 40)], 5);
  t('one oversized proposal is trimmed rather than losing the chapter everything',
    huge.proposals[0].cards.length === 5 && huge.dropped === 35);
  t('a budget of zero work still returns the rewrites',
    capNewCards([rewrite], 5).proposals.length === 1);
}

// A rewrite follows the same structure rules a first draft does, so the one
// set of rules is shared rather than restated and allowed to drift.
{
  t('the rules name every device', ['**Bold**', 'Lists', 'Blockquotes', 'Tables', '*Italics*']
    .every((bit) => CARD_FORMATTING_RULES.includes(bit)));
  t('the rules keep the list restraint', CARD_FORMATTING_RULES.includes('3+ discrete, parallel items'));
  t('the rules keep the spacing block', CARD_FORMATTING_RULES.includes('### Spacing'));
  t('TEXT_IMG is still excluded from them',
    CARD_FORMATTING_RULES.includes('these rules do NOT apply to TEXT_IMG'));
  t('highlight cards are still plain text', CARD_FORMATTING_RULES.includes('Plain text only'));

  // The generator must be byte-identical to what it was before the hoist.
  const generated = cardsGeneratorPrompt({ planStr: '[]' });
  t('the generator still carries the rules in place', generated.includes(CARD_FORMATTING_RULES));
  t('the rules appear once, not twice',
    generated.split('## Formatting rules').length - 1 === 1);
}

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
