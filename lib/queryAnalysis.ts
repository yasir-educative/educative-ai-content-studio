// Draft a reply to a content query.
//
// Two stages, so the lesson is only fetched when it is actually needed:
//   1. Triage — can the ticket be answered from its own text?
//   2. Draft   — write the reply, with the lesson content when stage 1 asked
//                for it and the ids are available.

import { generateText, parseJsonLoose } from './ai';
import { fetchLessonMarkdown } from './educativeLesson';
import type { JiraIssueDetail } from './jira';

const SIGNOFF = 'Best regards,\nThe Educative Team';

const TRIAGE_SYSTEM = `You triage content queries raised against Educative courses.

Decide whether the query can be answered accurately from the ticket text alone, or whether the lesson it refers to must be read first.

Answer WITHOUT the lesson when the query is:
- a general question about policy, process, access, billing, or the platform
- a request whose answer does not depend on what the lesson actually says
- already fully quoted in the ticket, with enough context to judge it

Read the lesson FIRST when the query:
- claims something in the lesson is wrong, unclear, outdated, or contradictory
- asks why the content says something, or what it meant
- refers to specific code, output, diagrams, numbers, or steps in the lesson
- cannot be judged without seeing the surrounding explanation

Be honest: if you cannot verify the claim without reading the lesson, say so.

Respond with JSON only, no markdown fences:
{"needsLesson": true|false, "reason": "one short sentence", "topic": "what the query is really asking"}`;

const DRAFT_SYSTEM = `You write replies to content queries on behalf of Educative's content team.

Format exactly:
Hi,

<body>

${SIGNOFF}

Rules for the body:
- Open by thanking them for raising it.
- Address the specific point. Do not restate the whole ticket.
- When lesson content is supplied, ground every claim in it. Quote the relevant line when it settles the question.
- If the reporter is right, say so plainly and state what will change.
- If the reporter is mistaken, explain the actual behaviour without being dismissive.
- If something genuinely cannot be determined from what you were given, say what is missing rather than guessing.
- Two to four short paragraphs. No bullet lists unless the answer is genuinely a sequence.
- Plain professional English. No marketing tone, no filler, no em-dashes.
- Never invent lesson content, URLs, dates, names, or commitments to ship a fix by a date.`;

export interface AnalysisResult {
  reply: string;
  usedLesson: boolean;
  needsLesson: boolean;
  reason: string;
  lessonTitle?: string;
  lessonUrl?: string;
  warning?: string;
}

function ticketText(issue: JiraIssueDetail): string {
  const parts = [
    `Summary: ${issue.summary}`,
    `Status: ${issue.status}`,
    issue.issueType && `Type: ${issue.issueType}`,
    issue.reporter && `Reporter: ${issue.reporter}`,
    issue.description && `\nDescription:\n${issue.description}`,
  ].filter(Boolean);

  if (issue.comments.length) {
    parts.push(
      '\nComments:\n' +
        issue.comments.map((c) => `- ${c.author}: ${c.body}`).join('\n'),
    );
  }
  const fields = issue.fields.filter((f) => f.value.length < 200);
  if (fields.length) {
    parts.push('\nFields:\n' + fields.map((f) => `- ${f.name}: ${f.value}`).join('\n'));
  }
  return parts.join('\n');
}

export async function analyzeQuery(issue: JiraIssueDetail): Promise<AnalysisResult> {
  const ticket = ticketText(issue);

  // ── Stage 1: triage ────────────────────────────────────────────────────────
  let needsLesson = true;
  let reason = '';
  try {
    const raw = await generateText(ticket, { system: TRIAGE_SYSTEM, tier: 'edit', maxTokens: 300 });
    const parsed = parseJsonLoose<{ needsLesson?: boolean; reason?: string }>(raw);
    if (parsed && typeof parsed.needsLesson === 'boolean') {
      needsLesson = parsed.needsLesson;
      reason = parsed.reason || '';
    }
  } catch {
    // Triage is an optimisation. If it fails, try to read the lesson anyway —
    // answering with more context is the safer default.
  }

  // ── Stage 2: lesson, only when the triage asked for it ─────────────────────
  let lesson = null as Awaited<ReturnType<typeof fetchLessonMarkdown>>;
  let warning: string | undefined;
  const { authorId, collectionId, pageId } = issue.ids;

  if (needsLesson) {
    if (authorId && collectionId && pageId) {
      try {
        lesson = await fetchLessonMarkdown(authorId, collectionId, pageId);
        if (!lesson) warning = 'The lesson could not be read, so the reply is based on the ticket alone.';
      } catch (e: any) {
        warning = `Lesson fetch failed (${e?.message || e}). The reply is based on the ticket alone.`;
      }
    } else {
      warning =
        'This query needs the lesson, but the ticket has no author/collection/page ids. The reply is based on the ticket alone and should be checked before sending.';
    }
  }

  // ── Stage 3: draft ─────────────────────────────────────────────────────────
  const prompt = [
    '# Query',
    ticket,
    lesson
      ? `\n# Lesson content${lesson.title ? ` — ${lesson.title}` : ''}\n${lesson.markdown.slice(0, 24_000)}`
      : '\n# Lesson content\nNot available. Do not invent what the lesson says; if the answer depends on it, say the lesson needs checking.',
  ].join('\n');

  const reply = (await generateText(prompt, { system: DRAFT_SYSTEM, tier: 'normal', maxTokens: 1200 })).trim();

  return {
    reply,
    usedLesson: !!lesson,
    needsLesson,
    reason,
    lessonTitle: lesson?.title,
    lessonUrl: lesson?.url,
    warning,
  };
}
