// Build every card type into Educative components, parse it back, and assert
// the card survived. The builder and parser are inverses; this is what stops
// them drifting and silently mangling an imported course.
import { buildCardComponents, buildMobileImageFlashCard, deriveCardTitle, parseMobileCard } from '@/lib/mobileCoursePublish';
import type { MobileCard } from '@/lib/mobileCourseStorage';
import { checkCard } from '@/lib/mobileCardLimits';

let fail = 0;
const t = (name: string, ok: boolean, detail = '') => {
  if (!ok) { fail++; console.log('FAIL', name, detail); } else console.log('ok  ', name);
};

const CARDS: MobileCard[] = [
  { id: 'c1', type: 'text', title: 'Two words', text: 'x'.repeat(380) },
  { id: 'c2', type: 'highlightCard', title: 'Key point', text: 'y'.repeat(115), highlightCardType: 'key-insight' },
  { id: 'c3', type: 'quiz', title: 'Check it', question: 'What is it?',
    options: [{ id: 1, text: 'A' }, { id: 2, text: 'B' }, { id: 3, text: 'C' }], correctAnswer: 2,
    incorrectMessage: 'Not quite' },
  { id: 'c4', type: 'trueFalseCard', title: 'True or false', question: 'z'.repeat(140), correctAnswer: 'false', explanation: 'because' },
  { id: 'c5', type: 'fillInTheBlank', title: 'Fill it', question: 'A _blank_ walks in', options: ['cat', 'dog'], correctOptions: ['cat'] },
  { id: 'c6', type: 'comparisonCards', title: 'A versus B', heading: 'Compare',
    leftOption: { label: 'A', heading: 'Ay', description: 'l'.repeat(260) },
    rightOption: { label: 'B', heading: 'Bee', description: 'r'.repeat(260) } },
  { id: 'c7', type: 'recapCard', title: 'Recap now', heading: 'Recap',
    content: [{ heading: 'One', text: 'a'.repeat(140) }, { heading: 'Two', text: 'b'.repeat(140) }] },
  { id: 'c8', type: 'scenarioCard', title: 'A scenario', explanation: 'why',
    sections: [{ heading: 'Context', content: 'c'.repeat(115) }, { heading: 'Why', content: 'w'.repeat(115) }, { heading: 'Fix', content: 'f'.repeat(215) }] },
  { id: 'c9', type: 'text-with-code', title: 'Some code', text_1: '1'.repeat(160), text_2: '2'.repeat(160), language: 'python', code: 'print(1)' },
  { id: 'c10', type: 'code-with-output', title: 'Code output', code: 'print(1)', output_available: true, output: '1' },
];

// A page as Educative returns it, from components we just built.
const asPage = (built: { components: any[]; summary: any }, title: string) =>
  ({ page_content: JSON.stringify({ components: built.components, summary: { ...built.summary, title } }) });

for (const card of CARDS) {
  const title = deriveCardTitle(card);
  const built = buildCardComponents(card, title);
  if (!built) { t(`${card.type} builds`, false); continue; }
  const back = parseMobileCard(asPage(built, title), { id: card.id, pageId: '123', card_number: 1 });

  t(`${card.type} parses back as the same type`, back.type === card.type, `got ${back.type} (${back.readOnly || ''})`);
  t(`${card.type} is not read-only`, !back.readOnly, back.readOnly || '');

  // Compare only the fields the card actually carries; identity and sync
  // metadata are supplied by the import, not by the page.
  const skip = new Set(['id', 'card_number', 'pageId', 'remoteHash', 'remoteSyncedAt', 'publishedUrl', 'title', 'illustration_idea']);
  for (const [field, value] of Object.entries(card)) {
    if (skip.has(field) || value === undefined || value === '') continue;
    const got = (back as any)[field];
    t(`${card.type}.${field} survives`, JSON.stringify(got) === JSON.stringify(value), `${JSON.stringify(got)} !== ${JSON.stringify(value)}`);
  }
}

// Image cards take a different builder.
for (const imgOnly of [false, true]) {
  const built = buildMobileImageFlashCard('Image card', imgOnly ? '' : 'prose here', imgOnly, '42', 'https://educative.io/img/42.png', 1234);
  const back = parseMobileCard(asPage(built, 'Image card'), { id: 'i1', pageId: '9' });
  t(`${imgOnly ? 'img_only' : 'text_img'} parses back`, back.type === (imgOnly ? 'img_only' : 'text_img'), back.readOnly || back.type);
  t(`${imgOnly ? 'img_only' : 'text_img'} keeps its image URL`, back.imageUrl === 'https://educative.io/img/42.png');
  if (!imgOnly) t('text_img keeps its prose', back.text === 'prose here');
}

// An unknown page must survive as read-only rather than being dropped.
const weird = parseMobileCard({ page_content: JSON.stringify({ components: [{ type: 'CodeWidget' }], summary: { title: 'Odd' } }) }, { id: 'x', pageId: '7' });
t('an unsupported page becomes read-only', !!weird.readOnly, weird.readOnly || 'not marked');
t('an unsupported page keeps its raw content', !!weird.rawRemoteContent);
t('unreadable content does not throw', !!parseMobileCard({ page_content: 'not json' }, { id: 'y' }).readOnly);

// Kinds Educative authors that this app does not build. Shapes taken from
// collection 5774286107049984 ("Grokking the Modern System Design Interview"),
// where they are 47% of the pages.
const flashPage = (content: any, title: string) => ({
  page_content: JSON.stringify({
    components: [{ type: 'FlashCard', content }, { type: 'SlateHTML', content: { html: '<p></p>' } }],
    summary: { title },
  }),
});

const anim = parseMobileCard(flashPage({
  title: 'The Architect\u2019s Mindset', cardType: 'text-with-animation', text: 'System Design is about planning.',
  customContent: '', animationPlayInLoop: true,
  lottieFile: { downloadUrl: 'https://lottie.example/a.json', name: 'chapter 1.json', size: 180091 },
}, 'The Architect\u2019s Mindset'), { id: 'a1', pageId: '1' });
t('animated card keeps its text', anim.text === 'System Design is about planning.');
t('animated card keeps its title', !!anim.title);
t('animated card is tagged', anim.remoteKind === 'text-with-animation');
t('animated card keeps the lottie url', anim.lottieUrl === 'https://lottie.example/a.json');
t('animated card is read-only', !!anim.readOnly);

const d2 = parseMobileCard(flashPage({
  title: 'Causal Consistency', cardType: 'd2-card', text: '**Causal consistency** is a model.',
  customContent: '', d2Code: 'direction: right\nClientA -> ClientB',
  d2File: { downloadUrl: 'https://d2.example/x.txt' },
}, 'Causal Consistency'), { id: 'd1', pageId: '2' });
t('diagram card keeps its text', d2.text === '**Causal consistency** is a model.');
t('diagram card is tagged', d2.remoteKind === 'd2-card');
t('diagram card keeps its source', d2.d2Code === 'direction: right\nClientA -> ClientB');
t('diagram card is read-only', !!d2.readOnly);

// The gate must ignore both, or an imported course can never be published.
t('read-only cards are skipped by the gate', checkCard(anim, 'course').length === 0 && checkCard(d2, 'course').length === 0);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
