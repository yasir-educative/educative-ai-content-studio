import { checkCard, checkCards } from '@/lib/mobileCardLimits';
import { shortsProfile, chooseTypes, COURSE_PROFILE, courseProfile } from '@/lib/cardTypeDecider';
import { enforceCharLimits, endsMidSentence, trimToMax, charLimitUnits, charLimitRequest } from '@/lib/mobileShortsPipeline';
import { applyScenarioHeadings, normalizeScenarioCardType, scenarioTypeFromHeadings } from '@/lib/mobileCardTypes';

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

// Scenario cards are opt-in: off by default in both products.
{
  const scenarioPlan = [1, 2, 3, 4, 5].map((n) => ({ card_number: n, title: `T ${n}`, teaching_goal: 'g', proposed_type: 'SCENARIO' as const, visual_idea: null }));
  t('scenario toggle off: no SCENARIO survives',
    !chooseTypes(scenarioPlan, [], shortsProfile(false, false), { topic: 't' }).some((c) => c.decision.chosen === 'SCENARIO'));
  t('scenario toggle on: SCENARIO survives above 3 cards',
    chooseTypes(scenarioPlan, [], shortsProfile(false, true), { topic: 't' }).some((c) => c.decision.chosen === 'SCENARIO'));
  t('scenario toggle off: the planner may not even propose one',
    !shortsProfile(false, false).types.includes('SCENARIO') && shortsProfile(false, true).types.includes('SCENARIO'));
  // The real failure: the planner proposed SCENARIO and the Decisions backend
  // scored it 0.08 against TEXT_IMG 0.92, so the toggle produced nothing.
  const realPlan = [
    { card_number: 1, title: 'a', teaching_goal: 'g', proposed_type: 'TEXT_IMG' as const, visual_idea: null },
    { card_number: 2, title: 'b', teaching_goal: 'g', proposed_type: 'TEXT_IMG' as const, visual_idea: null },
    { card_number: 3, title: 'c', teaching_goal: 'g', proposed_type: 'TEXT' as const, visual_idea: null },
    { card_number: 4, title: 'd', teaching_goal: 'g', proposed_type: 'HIGHLIGHT' as const, visual_idea: null },
    { card_number: 5, title: 'e', teaching_goal: 'g', proposed_type: 'SCENARIO' as const, visual_idea: null },
  ];
  const answers = [
    { name: 'card1', type: 'choice', probabilities: [{ value: 'TEXT_IMG', probability: 1 }] },
    { name: 'card2', type: 'choice', probabilities: [{ value: 'TEXT_IMG', probability: 1 }] },
    { name: 'card3', type: 'choice', probabilities: [{ value: 'TEXT', probability: 1 }] },
    { name: 'card4', type: 'choice', probabilities: [{ value: 'HIGHLIGHT', probability: 0.92 }, { value: 'IMG_ONLY', probability: 0.04 }] },
    { name: 'card5', type: 'choice', probabilities: [{ value: 'TEXT_IMG', probability: 0.92 }, { value: 'SCENARIO', probability: 0.08 }] },
  ];
  const real = chooseTypes(realPlan, answers, shortsProfile(true, true), { topic: 't' });
  t('the backend cannot veto a planner-proposed SCENARIO',
    real.find((c) => c.card_number === 5)!.decision.chosen === 'SCENARIO');
  t('a pinned decision says so', real.find((c) => c.card_number === 5)!.decision.backend === 'planner-pinned');
  t('pinning leaves every other card to the backend',
    real.filter((c) => c.decision.backend === 'decisions').length === 4);
  t('the highlight still survives alongside it',
    real.filter((c) => c.decision.chosen === 'HIGHLIGHT').length === 1);
  t('5 cards still get 2 visuals after a scenario is pinned',
    real.filter((c) => ['TEXT_IMG', 'IMG_ONLY'].includes(c.decision.chosen)).length >= 2);

  // Toggle on but the planner proposed none: one is promoted anyway.
  const noneProposed = [1, 2, 3, 4].map((n) => ({ card_number: n, title: `T ${n}`, teaching_goal: 'g', proposed_type: 'TEXT' as const, visual_idea: null }));
  t('toggle on with no proposal still yields one SCENARIO',
    chooseTypes(noneProposed, [], shortsProfile(false, true), { topic: 't' })
      .filter((c) => c.decision.chosen === 'SCENARIO').length === 1);
  t('3 cards or fewer never get a SCENARIO',
    !chooseTypes(noneProposed.slice(0, 3), [], shortsProfile(false, true), { topic: 't' })
      .some((c) => c.decision.chosen === 'SCENARIO'));
  t('toggle off is never promoted into a SCENARIO',
    !chooseTypes(noneProposed, [], shortsProfile(false, false), { topic: 't' })
      .some((c) => c.decision.chosen === 'SCENARIO'));

  t('course scenario toggle gates the planner enum',
    !courseProfile(false).types.includes('scenario') && courseProfile(true).types.includes('scenario'));
}

// A scenario card's variant owns its three tab headings.
{
  const sections = [
    { heading: 'wrong one', content: 'c'.repeat(110) },
    { heading: 'another', content: 'c'.repeat(110) },
    { heading: 'third', content: 'c'.repeat(210) },
  ];
  const card = base({ type: 'scenarioCard', sections }) as any;
  t('scenario without a type is an error',
    checkCard(card, 'short').some((i) => i.path === 'scenarioType' && i.severity === 'error'));
  const fixed = applyScenarioHeadings({ ...card, scenarioType: 'whats-going-on' });
  t('picking a variant rewrites every heading',
    fixed.sections!.map((s: any) => s.heading).join('|') === 'The Context|What it Implies|Key Takeaway');
  t('rewriting headings leaves the content alone',
    fixed.sections!.every((s: any, i: number) => s.content === sections[i].content));
  t('a correctly headed scenario passes', !checkCard(fixed as any, 'short').some((i) => i.severity === 'error'));
  t('a heading that does not match the variant is only a warning',
    checkCard({ ...fixed, sections } as any, 'short')
      .filter((i) => i.path.endsWith('.heading')).every((i) => i.severity === 'warning'));
  t('a card with the right headings and no id is not blocked',
    !checkCard({ ...card, sections: fixed.sections } as any, 'short').some((i) => i.path === 'scenarioType'));
  t('headings alone identify the variant',
    scenarioTypeFromHeadings(fixed.sections) === 'whats-going-on');
  t('a model spelling folds to an id',
    normalizeScenarioCardType('How Would You Fix?') === 'how-would-you-fix');
  t('an unknown variant falls back to the headings',
    normalizeScenarioCardType('mystery', fixed.sections) === 'whats-going-on');
}

// A scenario tab used to be rewritten alone, as a 42-character fragment with no
// idea it was one third of a card, and came back far under its minimum.
{
  const card = {
    type: 'scenarioCard', title: 'Ranking signals', scenarioType: 'whats-going-on',
    sections: [
      { heading: 'The Context', content: 'The Home feed ranks from a broad pool, not just recent clicks.' },
      { heading: 'What it Implies', content: 'Selection cannot rely on one signal alone.' },
      { heading: 'Key Takeaway', content: 'YouTube ranking balances watch time, freshness, and satisfaction.' },
    ],
  };
  const units = charLimitUnits([card], 'short');
  t('a scenario card breaks into three work items', units.length === 3);
  t('the first two tabs take the 100-130 band',
    units[0].limit!.min === 100 && units[0].limit!.max === 130 && units[1].limit!.min === 100);
  t('the third tab takes the 200-230 band',
    units[2].limit!.min === 200 && units[2].limit!.max === 230);
  t('each tab knows which tab it is',
    units[0].part === 'tab 1 of 3, headed "The Context"' && units[2].part!.startsWith('tab 3 of 3'));
  t('each tab carries the other two', units.every((u) => u.siblings!.length === 2));
  t('a tab never carries itself',
    !units[0].siblings!.some((sib: string) => sib.includes('The Home feed ranks')));

  const work = { ...card, ...units[2], card_number: 3 } as any;
  const req = charLimitRequest(work, units[2].text, 'under the minimum');
  t('the request names the tab and its minimum',
    req.part_of_card!.startsWith('tab 3 of 3') && req.required_min === 200);
  t('the request asks to expand, not shorten', req.action.startsWith('EXPAND'));
  t('the request shows the other tabs', (req.other_tabs || []).length === 2);
  t('a plain card carries no tab context',
    charLimitRequest({ type: 'text', limit: { min: 350, max: 420 } }, 'x', '').part_of_card === undefined);

  // The real card: every tab was short, and all three must be flagged.
  const issues = checkCard(card as any, 'short').filter((i) => i.path.endsWith('.content'));
  t('every short tab is reported', issues.length === 3 && issues.every((i) => i.severity === 'warning'));
}

// A short of 4+ cards always gets one standalone visual; none ever appeared before.
{
  const visualPlan = (n: number, type: 'TEXT' | 'TEXT_IMG') =>
    Array.from({ length: n }, (_, i) => ({ card_number: i + 1, title: `T ${i + 1}`, teaching_goal: 'g', proposed_type: type, visual_idea: null }));
  const five = chooseTypes(visualPlan(5, 'TEXT_IMG'), [], shortsProfile(false, false), { topic: 't' });
  t('a 5-card short gets exactly one IMG_ONLY',
    five.filter((c) => c.decision.chosen === 'IMG_ONLY').length === 1);
  t('the standalone visual is never the first card', five[0].decision.chosen !== 'IMG_ONLY');
  t('a 4-card short gets one too',
    chooseTypes(visualPlan(4, 'TEXT'), [], shortsProfile(false, false), { topic: 't' })
      .filter((c) => c.decision.chosen === 'IMG_ONLY').length === 1);
  t('a 3-card short is left alone',
    !chooseTypes(visualPlan(3, 'TEXT'), [], shortsProfile(false, false), { topic: 't' })
      .some((c) => c.decision.chosen === 'IMG_ONLY'));
  t('an IMG_ONLY the planner already chose is not duplicated',
    chooseTypes(
      visualPlan(5, 'TEXT_IMG').map((c, i) => i === 2 ? { ...c, proposed_type: 'IMG_ONLY' as const } : c),
      [], shortsProfile(false, false), { topic: 't' },
    ).filter((c) => c.decision.chosen === 'IMG_ONLY').length === 1);
  t('the visual minimum still holds with a standalone visual',
    five.filter((c) => ['TEXT_IMG', 'IMG_ONLY'].includes(c.decision.chosen)).length >= 2);
  t('the planner is told a standalone visual is required',
    shortsProfile(false, false).rulesText.includes('must include exactly one IMG_ONLY'));
}

// 1. Highlight toggle off removes every HIGHLIGHT the model proposed.
const plan = [1, 2, 3, 4].map((n) => ({ card_number: n, title: `T ${n}`, teaching_goal: 'g', proposed_type: 'HIGHLIGHT' as const, visual_idea: null }));
t('toggle off: no HIGHLIGHT survives', !chooseTypes(plan, [], shortsProfile(false, false), { topic: 't' }).some((c) => c.decision.chosen === 'HIGHLIGHT'));
const on = chooseTypes(plan, [], shortsProfile(true, false), { topic: 't' });
t('toggle on: at most one HIGHLIGHT', on.filter((c) => c.decision.chosen === 'HIGHLIGHT').length === 1);
t('4 cards get at least 2 visuals', on.filter((c) => ['TEXT_IMG', 'IMG_ONLY'].includes(c.decision.chosen)).length >= 2);

// Scenario sections: the real failure seen in ms-mvyx7vfl-b8252276c2fe (2 of 3).
const twoSections = base({ type: 'scenarioCard', sections: [
  { heading: 'The Context', content: 'x'.repeat(120) },
  { heading: 'Recommended approach', content: 'x'.repeat(215) },
] });
t('scenario with 2 sections is an error', checkCard(twoSections as any, 'short')
  .some((i) => i.path === 'sections' && i.severity === 'error'));
const threeSections = base({ type: 'scenarioCard', scenarioType: 'whats-going-on', sections: [
  { heading: 'The Context', content: 'x'.repeat(120) },
  { heading: 'What it Implies', content: 'x'.repeat(120) },
  { heading: 'Key Takeaway', content: 'x'.repeat(215) },
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
// Dropping a block can cost most of a card, so below the minimum the prose is
// cut instead — a short card is a warning, half a card is not worth the trade.
{
  const card = 'Caching cuts read latency, but every copy is one more place the truth can drift apart.\n\n'
    + '| Layer | Wins | Costs |\n|----------|----------|----------|\n'
    + '| Edge cache | Nearest hop, lowest latency | Stale reads after a write |\n'
    + '| Regional cache | Shared across a region | Invalidation fan-out |\n'
    + '| Origin | Always current | Slowest, and the first to saturate |';
  const cut = trimToMax(card, 450, 350);
  t('a card whose block drop would undershoot is cut in prose instead',
    cut.length <= 450 && cut.length >= 350 && cut.includes('| Layer |'));
  t('the min-aware trim still does not end mid-sentence', !endsMidSentence(cut));
}
t('a block drop that stays above the minimum is still preferred',
  trimToMax('One. Two. Three.\n\n' + 'word '.repeat(60).trim(), 40, 10) === 'One. Two. Three.');

t('prose that runs out mid-clause is caught',
  endsMidSentence('One signal is never enough. Ranking blends watch history, subscriptions, engagement, freshness, and policy filters before final'));
t('a table row is not mid-sentence', !endsMidSentence('| Cost vs resilience | Extra copies and capacity help |'));
t('a short bullet is not mid-sentence', !endsMidSentence('- Scale pushes sharding, queues, and CDNs'));
t('a finished sentence is not mid-sentence', !endsMidSentence('Ranking blends many signals before it ranks.'));

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
}
main();
