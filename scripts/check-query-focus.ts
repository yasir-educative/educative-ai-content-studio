// A content query points at one widget; the draft must be written about that.
//
// All offline: no Jira read, no model call, no Educative fetch. What is checked
// is that the ticket's own fields reach the prompt and that the widget they
// name survives into the material the model is given.

import { extractLessonHtml } from '@/lib/educativeLesson';
import { fieldValue, focusBlock, widgetExcerpt } from '@/lib/queryAnalysis';
import { queriesChangesPrompt } from '@/lib/queryPrompts';
import type { JiraIssueDetail } from '@/lib/jira';

const issue = (fields: Array<{ name: string; value: string }>): JiraIssueDetail => ({
  key: 'PSB2C-1', summary: 'Quiz answer looks wrong', status: 'Open', statusCategory: 'new',
  issueType: 'Query', reporter: 'A Learner', assignee: '', updated: '', created: '', url: '',
  description: 'The second quiz option is marked correct but it is not.', resolution: '',
  comments: [], fields, ids: {}, reporterId: '', assigneeId: '',
} as unknown as JiraIssueDetail);

function main() {
let fail = 0;
const t = (name: string, pass: boolean) => { if (!pass) fail++; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`); };

// 1 ── A widget type the renderer does not name must survive, not vanish.
{
  const page = {
    components: [
      { type: 'MarkdownEditor', content: { text: '<p>Caches cut read latency.</p>' } },
      { type: 'Quiz', content: { question: 'Which layer serves the stalest reads?', options: ['Edge cache', 'Origin'], comp_id: 'abc123', hash: 'deadbeefdeadbeef' } },
      { type: 'CodeExercise', content: { language: 'python', code: 'def get(k): return cache[k]' } },
    ],
  };
  const md = extractLessonHtml(page);
  t('an unknown widget is no longer dropped', md.includes('[widget type="Quiz"]'));
  t('its text comes with it', md.includes('Which layer serves the stalest reads?'));
  t('a second unknown widget is kept too', md.includes('[widget type="CodeExercise"]'));
  t('known components still render as before', md.includes('Caches cut read latency.'));
  t('ids and hashes are left out', !md.includes('abc123') && !md.includes('deadbeefdeadbeef'));

  // 2 ── The ticket's Widget Type picks that widget out of the material.
  t('the quiz is found by name', widgetExcerpt(md, 'Quiz').includes('stalest reads'));
  t('a near spelling still matches', widgetExcerpt(md, 'Code Exercise').includes('def get(k)'));
  t('the excerpt is only the named widget', !widgetExcerpt(md, 'Quiz').includes('def get(k)'));
  t('an absent widget returns nothing', widgetExcerpt(md, 'Canvas') === '');
  t('an empty widget name matches nothing', widgetExcerpt(md, '') === '');

  // 3 ── Both fields reach the prompt, under whatever name the board uses.
  const withFields = issue([
    { name: 'Feedback Source', value: 'Quiz widget' },
    { name: 'Widget Type', value: 'Quiz' },
  ]);
  t('Feedback Source is read', fieldValue(withFields, 'Feedback Source') === 'Quiz widget');
  t('a field is found however it is spelled',
    fieldValue(withFields, 'widgettype') === 'Quiz' && fieldValue(withFields, 'Widget Type') === 'Quiz');
  t('a missing field is empty, not undefined', fieldValue(withFields, 'Nothing Here') === '');

  const focus = focusBlock(withFields, md);
  t('the focus block names both fields',
    focus.includes('Feedback source: Quiz widget') && focus.includes('Widget type: Quiz'));
  t('the focus block carries the widget itself', focus.includes('stalest reads'));
  t('the focus block tells the model to answer about it',
    focus.includes('Answer about that, not about the lesson in general'));

  // A widget the ticket names but the lesson does not have is worth saying.
  const missing = focusBlock(issue([{ name: 'Widget Type', value: 'Canvas' }]), md);
  t('a widget missing from the material is called out',
    missing.includes('No "Canvas" is present in the material'));
  t('a ticket with neither field adds nothing', focusBlock(issue([]), md) === '');
}

// 4 ── The change log is internal, and asks for findable edits.
{
  const p = queriesChangesPrompt({ ticket: 'T', lesson: 'L', reply: 'R', focus: 'F' });
  t('the change prompt says it is never sent', p.includes('never sent to anyone'));
  t('the change prompt allows an empty list', p.includes('An empty list is the correct, common answer'));
  t('the change prompt demands a findable location', p.includes('Never write "the lesson"'));
  t('the change prompt returns JSON only', p.includes('{"changes":[{"where":"...","change":"...","why":"..."}]}'));
  t('the change prompt sees the reply so it cannot contradict it', p.includes('# Reply already sent'));
}

// 5 ── The reply itself must not narrate the investigation.
{
  const { psbDraftPrompt, fsbDraftPrompt } = require('@/lib/queryPrompts');
  for (const [name, fn] of [['PSB', psbDraftPrompt], ['Fenzo', fsbDraftPrompt]] as const) {
    const p = fn({ ticket: 'T', lesson: 'L', classification: '' });
    t(`${name}: the reply gives the answer, not the process`, p.includes('Give the answer, not the investigation'));
    t(`${name}: narration phrases are named and banned`, p.includes('"I checked"') && p.includes('"on reviewing the lesson"'));
    t(`${name}: the edit plan is kept out of the reply`, p.includes('that is recorded separately'));
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
}
main();
