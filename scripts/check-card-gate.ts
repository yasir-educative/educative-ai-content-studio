import { checkCard, checkCards } from '@/lib/mobileCardLimits';
import { shortsProfile, chooseTypes, COURSE_PROFILE } from '@/lib/cardTypeDecider';
import { enforceCharLimits, endsMidSentence, trimToMax } from '@/lib/mobileShortsPipeline';

async function main() {
let fail = 0;
const t = (name: string, ok: boolean) => { if (!ok) { fail++; console.log('FAIL', name); } else console.log('ok  ', name); };

const base = (over: any) => ({ id: 'c1', card_number: 1, title: 'Two words', ...over });

// 2. Maximum blocks, minimum only warns.
const over = checkCard(base({ type: 'text', text: 'x'.repeat(421) }) as any, 'short');
t('text 421 over short max 420 is an error', over.some((i) => i.path === 'text' && i.severity === 'error'));
t('text 420 is allowed', !checkCard(base({ type: 'text', text: 'x'.repeat(420) }) as any, 'short').some((i) => i.path === 'text'));
const under = checkCard(base({ type: 'text', text: 'x'.repeat(100) }) as any, 'short');
t('text under min is a warning, not an error', under.some((i) => i.path === 'text' && i.severity === 'warning')
  && !under.some((i) => i.path === 'text' && i.severity === 'error'));
t('under-min alone does not block', !checkCards([base({ type: 'text', text: 'x'.repeat(100) })] as any, 'short').blocking);
t('over-max blocks', checkCards([base({ type: 'text', text: 'x'.repeat(421) })] as any, 'short').blocking);
t('course text max is 450, not 420', !checkCard(base({ type: 'text', text: 'x'.repeat(450) }) as any, 'course').some((i) => i.path === 'text'));

// 1. Highlight card type must be chosen.
t('highlight without a type is an error', checkCard(base({ type: 'highlightCard', text: 'x'.repeat(110) }) as any, 'short')
  .some((i) => i.path === 'highlightCardType' && i.severity === 'error'));
t('highlight with a valid type passes', !checkCard(base({ type: 'highlightCard', text: 'x'.repeat(110), highlightCardType: 'key-insight' }) as any, 'short')
  .some((i) => i.severity === 'error'));
t('unresolved card type is an error', checkCard(base({ type: 'text', text: 'x'.repeat(380), typeWarning: 'unknown' }) as any, 'short')
  .some((i) => i.path === 'type' && i.severity === 'error'));

// 1. Highlight toggle off removes every HIGHLIGHT the model proposed.
const plan = [1, 2, 3, 4].map((n) => ({ card_number: n, title: `T ${n}`, teaching_goal: 'g', proposed_type: 'HIGHLIGHT' as const, visual_idea: null }));
t('toggle off: no HIGHLIGHT survives', !chooseTypes(plan, [], shortsProfile(false), { topic: 't' }).some((c) => c.decision.chosen === 'HIGHLIGHT'));
const on = chooseTypes(plan, [], shortsProfile(true), { topic: 't' });
t('toggle on: at most one HIGHLIGHT', on.filter((c) => c.decision.chosen === 'HIGHLIGHT').length === 1);
t('4 cards get at least 2 visuals', on.filter((c) => ['TEXT_IMG', 'IMG_ONLY'].includes(c.decision.chosen)).length >= 2);

// Scenario sections: the real failure seen in ms-mvyx7vfl-b8252276c2fe (2 of 3).
const twoSections = base({ type: 'scenarioCard', sections: [
  { heading: 'The Context', content: 'x'.repeat(120) },
  { heading: 'Recommended approach', content: 'x'.repeat(215) },
] });
t('scenario with 2 sections is an error', checkCard(twoSections as any, 'short')
  .some((i) => i.path === 'sections' && i.severity === 'error'));
const threeSections = base({ type: 'scenarioCard', sections: [
  { heading: 'The Context', content: 'x'.repeat(120) },
  { heading: 'Why it matters', content: 'x'.repeat(120) },
  { heading: 'Recommended approach', content: 'x'.repeat(215) },
] });
t('scenario with 3 valid sections passes', !checkCard(threeSections as any, 'short').some((i) => i.severity === 'error'));
t('scenario takeaway uses the 200-230 band', checkCard(base({ type: 'scenarioCard', sections: [
  { heading: 'a', content: 'x'.repeat(120) },
  { heading: 'b', content: 'x'.repeat(120) },
  { heading: 'c', content: 'x'.repeat(231) },
] }) as any, 'short').some((i) => i.path === 'sections[2].content' && i.severity === 'error'));

// Course hard rules must never throw: a thrown rule used to kill the whole chapter.
const coursePlan = (types: string[]) => types.map((proposed_type, i) => ({
  card_number: i + 1, title: `T ${i + 1}`, teaching_goal: 'g', proposed_type, visual_idea: null,
})) as any;
const noThrow = (name: string, run: () => void) => {
  try { run(); t(name, true); } catch (e: any) { t(`${name} (threw: ${e?.message})`, false); }
};
noThrow('course profile survives a 2-card plan', () =>
  chooseTypes(coursePlan(['text', 'recap']), [], COURSE_PROFILE, { topic: 't' }));
noThrow('course profile survives a plan with no eligible img_only card', () =>
  chooseTypes(coursePlan(['quiz', 'quiz', 'recap']), [], COURSE_PROFILE, { topic: 't' }));
const courseDecided = chooseTypes(coursePlan(['recap', 'text', 'text', 'text']), [], COURSE_PROFILE, { topic: 't' });
t('course recap is forced last and only last',
  courseDecided[courseDecided.length - 1].decision.chosen === 'recap'
  && courseDecided.slice(0, -1).every((c) => c.decision.chosen !== 'recap'));
t('course first card is text or text_img', ['text', 'text_img'].includes(courseDecided[0].decision.chosen));
t('code types are dropped without code in the source',
  !chooseTypes(coursePlan(['text_code', 'code_output', 'text', 'recap']), [], COURSE_PROFILE,
    { topic: 't', sourceHasCode: false }).some((c) => ['text_code', 'code_output'].includes(c.decision.chosen)));

// The ceiling must hold even when the model is unavailable or ignores the limit:
// enforceCharLimits falls through to a hard trim. Run with no API key so the
// rewrite call fails and only the deterministic path is exercised.
delete process.env.OPENAI_API_KEY;
const oversized = [
  base({ type: 'highlightCard', text: 'This is a sentence about memory. '.repeat(8), highlightCardType: 'key-insight' }),
  base({ type: 'text', text: 'Another long sentence here. '.repeat(30) }),
  base({ type: 'text_img', text: 'Padding prose that runs long. '.repeat(20), imageUrl: '/x.png', illustration_idea: 'i' }),
];
const capped = await enforceCharLimits(oversized as any, () => {}, 'short');
t('highlight is cut to 130 with no model available', (capped[0].text as string).length <= 130);
t('text is cut to 420', (capped[1].text as string).length <= 420);
t('text_img is cut to 260', (capped[2].text as string).length <= 260);
t('no over-max error survives the trim',
  !capped.some((c: any) => checkCard(c, 'short').some((i) => i.path === 'text' && i.message.includes('>'))));
t('trimToMax cuts at a sentence boundary when one fits',
  trimToMax('One. Two. Three. ' + 'x'.repeat(200), 40).endsWith('.'));

// A markdown card loses a whole block before it loses the end of a sentence.
// This is the real card that shipped reading "> **Note:** Ranking and".
{
  const card = '**YouTube design** is a balancing problem under constant load.\n\n'
    + '- Scale pushes sharding, queues, and CDNs\n- Low latency favors cache and precompute\n'
    + '- Availability can weaken strict consistency\n- Replication and redundancy raise cost\n\n'
    + '| Tradeoff | Why |\n|----------|----------|\n'
    + '| Consistency vs latency | Global updates are slower |\n'
    + '| Cost vs resilience | Extra copies and capacity help |\n\n'
    + '> **Note:** In 2026, fairness tuning in ranking increasingly limits overexposure loops for already dominant creators.';
  const cut = trimToMax(card, 450);
  t('a long markdown card drops its last block, not its last sentence',
    cut.length <= 450 && cut.length >= 350 && cut.endsWith('|') && !cut.includes('Note:'));
  t('the trimmed card does not end mid-sentence', !endsMidSentence(cut));
}
t('prose that runs out mid-clause is caught',
  endsMidSentence('One signal is never enough. Ranking blends watch history, subscriptions, engagement, freshness, and policy filters before final'));
t('a table row is not mid-sentence', !endsMidSentence('| Cost vs resilience | Extra copies and capacity help |'));
t('a short bullet is not mid-sentence', !endsMidSentence('- Scale pushes sharding, queues, and CDNs'));
t('a finished sentence is not mid-sentence', !endsMidSentence('Ranking blends many signals before it ranks.'));

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
}
main();
