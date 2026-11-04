// What postUpdate sends to Jira, proven without touching Jira.
//
// Every request is captured from a stubbed fetch, so this asserts the payloads
// an update actually produces: a comment, a status change, or both, with or
// without attachments. Nothing here reaches a real site.

import { postUpdate } from '@/lib/jira';
import type { JiraConfig } from '@/lib/jiraStore';

const CFG: JiraConfig = { siteUrl: 'https://example.atlassian.net', email: 'a@b.c', apiToken: 't' };

interface Call { url: string; method: string; headers: Record<string, string>; body: any }

function stubFetch(responses: any[] = []): Call[] {
  const calls: Call[] = [];
  let i = 0;
  (globalThis as any).fetch = async (url: string, init: any = {}) => {
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const raw = init.body;
    calls.push({
      url: String(url),
      method: init.method || 'GET',
      headers,
      body: typeof raw === 'string' ? JSON.parse(raw) : raw,
    });
    const payload = responses[i++] ?? {};
    return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(payload) } as any;
  };
  return calls;
}

async function main() {
let fail = 0;
const t = (name: string, pass: boolean) => { if (!pass) fail++; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`); };

// 1 ── Status only: no comment is written at all.
{
  const calls = stubFetch();
  const out = await postUpdate(CFG, { key: 'ABC-1', reply: '', transitionId: '31' });
  t('status only sends exactly one request', calls.length === 1);
  t('status only hits the transitions endpoint', calls[0].url.endsWith('/issue/ABC-1/transitions'));
  t('status only sends the transition id', calls[0].body?.transition?.id === '31');
  t('status only writes no comment', !calls.some((c) => c.url.includes('/comment')));
  t('status only reports no comment', out.commented === false && out.transitioned === true);
}

// 2 ── A status-only update that Jira rejects must fail loudly: nothing else ran.
{
  (globalThis as any).fetch = async () => ({
    ok: false, status: 400, statusText: 'Bad Request',
    text: async () => JSON.stringify({ errorMessages: ['Transition is not valid'] }),
  });
  let threw = '';
  try { await postUpdate(CFG, { key: 'ABC-1', reply: '', transitionId: '99' }); }
  catch (e: any) { threw = e?.message || ''; }
  t('a rejected status-only change throws', threw.includes('Transition is not valid'));
}

// 3 ── Neither half given.
{
  stubFetch();
  let threw = '';
  try { await postUpdate(CFG, { key: 'ABC-1', reply: '   ' }); }
  catch (e: any) { threw = e?.message || ''; }
  t('an empty update is refused', threw.includes('write a comment or pick a status'));
}

// 4 ── Comment with attachments, then a status change.
{
  const calls = stubFetch([[{ id: '101', filename: 'trace.png' }, { id: '102', filename: 'log.txt' }], {}, {}]);
  const out = await postUpdate(CFG, {
    key: 'ABC-2',
    reply: 'Fixed on staging.\n\nSee the trace.',
    instruction: 'please review:',
    mentionAccountId: 'acc-1',
    mentionName: 'Sam',
    transitionId: '41',
    attachments: [
      { filename: 'trace.png', contentType: 'image/png', data: Buffer.from('png').toString('base64') },
      { filename: 'log.txt', contentType: 'text/plain', data: 'data:text/plain;base64,' + Buffer.from('log').toString('base64') },
    ],
  });

  t('three requests: attach, comment, transition', calls.length === 3);
  const [attach, comment, transition] = calls;

  t('attachments go up first', attach.url.endsWith('/issue/ABC-2/attachments'));
  t('attachments carry the no-check token', attach.headers['x-atlassian-token'] === 'no-check');
  t('attachments set no Content-Type of their own', !('content-type' in attach.headers));
  t('attachments are sent as form data', attach.body instanceof FormData);
  t('every file is in the form', (attach.body as FormData).getAll('file').length === 2);

  t('the comment comes second', comment.url.endsWith('/issue/ABC-2/comment'));
  const content = comment.body?.body?.content || [];
  t('the comment is an ADF doc', comment.body?.body?.type === 'doc' && comment.body?.body?.version === 1);
  t('the lead paragraph mentions the person', content[0]?.content?.[0]?.type === 'mention'
    && content[0].content[0].attrs?.id === 'acc-1' && content[0].content[0].attrs?.text === '@Sam');
  t('the instruction follows the mention', content[0]?.content?.[1]?.text === ' please review:');
  t('each reply paragraph is its own block',
    content[1]?.content?.[0]?.text === 'Fixed on staging.' && content[2]?.content?.[0]?.text === 'See the trace.');
  t('the last paragraph names the attachments',
    content[content.length - 1]?.content?.[0]?.text === 'Attached: trace.png, log.txt');

  t('the transition comes last', transition.url.endsWith('/issue/ABC-2/transitions')
    && transition.body?.transition?.id === '41');
  t('the result counts what was attached', out.attached === 2 && out.commented && out.transitioned);
}

// 5 ── A comment with no files attaches nothing and names nothing.
{
  const calls = stubFetch([{}, {}]);
  const out = await postUpdate(CFG, { key: 'ABC-3', reply: 'No files here.' });
  t('no attachment request is made without files', !calls.some((c) => c.url.includes('/attachments')));
  t('a comment without a status sends one request', calls.length === 1);
  const content = calls[0].body?.body?.content || [];
  t('no attachment line is added', !JSON.stringify(content).includes('Attached:'));
  t('an unmentioned comment leads with the instruction',
    content[0]?.content?.[0]?.type === 'text' && content[0].content[0].text === 'please respond with the following:');
  t('the result says nothing was attached', out.attached === 0 && out.transitioned === false);
}

// 6 ── A failed transition after a successful comment is a warning, not a loss.
{
  let n = 0;
  (globalThis as any).fetch = async () => {
    n++;
    if (n === 1) return { ok: true, status: 200, statusText: 'OK', text: async () => '{}' } as any;
    return { ok: false, status: 400, statusText: 'Bad Request', text: async () => JSON.stringify({ errorMessages: ['no'] }) } as any;
  };
  const out = await postUpdate(CFG, { key: 'ABC-4', reply: 'Posted.', transitionId: '7' });
  t('a comment survives a rejected transition', out.commented === true && out.transitioned === false);
  t('the rejection is reported as a warning', !!out.warning && out.warning.includes('status change failed'));
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
}
main();
