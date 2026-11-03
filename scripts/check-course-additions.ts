// Where do newly created pages land in the published table of contents?
//
// This is the part of adding cards to a live course that cannot be checked by
// reading the code: one wrong index silently moves a reader's lesson. Every
// case here is pure — no Educative call, nothing published.
import { placeNewPagesInToc, placeProposals, withRefreshWork, type Proposal } from '@/lib/mobileCourseAugment';
import type { MobileChapter } from '@/lib/mobileCourseStorage';
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

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
