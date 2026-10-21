// Draft a reply to a content query.
//
// Two stages, so the lesson is only fetched when it is actually needed:
//   1. Triage — can the ticket be answered from its own text?
//   2. Draft   — write the reply, with the lesson content when stage 1 asked
//                for it and the ids are available.

import { generateText, generateTextWithImages, parseJsonLoose } from './ai';
import { fetchImageAsDataUrl, fetchLessonMarkdown } from './educativeLesson';
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

Also decide whether answering requires LOOKING AT an image. That is true only when the query is about a diagram, figure, screenshot, chart or illustration — its content, labels, accuracy or legibility. A query that merely happens to sit on a lesson containing images is not about the image.

Respond with JSON only, no markdown fences:
{"needsLesson": true|false, "aboutImage": true|false, "reason": "one short sentence", "topic": "what the query is really asking"}`;

const DRAFT_SYSTEM = `You write replies sent to learners on behalf of Educative's content team.

Format exactly:
Hi,

<body>

${SIGNOFF}

# This reply is sent to the learner
Never reveal how it was produced or what you could or could not access. Educative owns this content, so any gap in what you were given is our problem, not something to tell the learner about.

NEVER write sentences like:
- "the lesson content is not available to us"
- "we can't verify whether..."
- "since we don't have access to..."
- "based on the information provided"
- "our system was unable to..."
If you were not given the lesson, write the reply that is true and useful without it. Acknowledge the point, say what we are doing about it, and stop. Do not hedge about your own access, and do not invent what the lesson says to fill the gap.

# Body
- Open by thanking them for raising it.
- Address their specific point. Do not restate the whole ticket.
- When lesson content is supplied, ground the answer in it and quote the line that settles the question.
- If they are right, say so plainly and say what will change.
- If they are mistaken, explain the actual behaviour without being dismissive.
- Two to four short paragraphs. Bullets only when the answer is genuinely a sequence.
- Plain professional English. No marketing tone, no filler, no em-dashes.
- Never invent lesson wording, URLs, names, or a date by which a fix will ship.

# When the query is about difficulty, not correctness
If they say the content is too complex, too dense, too high level, hard to follow, moves too fast, or assumes too much:
1. Endorse the feedback directly. Treat it as a fair signal about the writing, not a shortcoming of the reader.
2. Say we will work on making that material easier to digest. Vary the wording between replies — do not reuse one stock sentence.
3. Point them to "Explain with AI" on the lesson. This is expected for difficulty feedback, not optional: it expands any passage into more detail at the depth the reader wants, which is what someone struggling with density needs right now while we improve the writing. Describe what it does in your own words; do not reuse a fixed sentence.
4. Mention "Mock Interviews" as well ONLY when they also talk about practising, applying, retaining or testing what they learned. Skip it otherwise.
Frame these as something that helps today, never as a reason not to fix the content.

# When the query reports an error, bug, or factual mistake
Do not offer features. Acknowledge the specific problem and say it is being looked into.`;

export interface AnalysisResult {
  reply: string;
  usedLesson: boolean;
  needsLesson: boolean;
  aboutImage: boolean;
  imagesRead: number;
  /** True when the reply could not be grounded and a human must check it. */
  needsManualReview: boolean;
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
  let aboutImage = false;
  let reason = '';
  try {
    const raw = await generateText(ticket, { system: TRIAGE_SYSTEM, tier: 'edit', maxTokens: 300 });
    const parsed = parseJsonLoose<{ needsLesson?: boolean; aboutImage?: boolean; reason?: string }>(raw);
    if (parsed && typeof parsed.needsLesson === 'boolean') {
      needsLesson = parsed.needsLesson;
      reason = parsed.reason || '';
    }
    aboutImage = !!parsed?.aboutImage;
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

  // ── Stage 3: images, only when the query is actually about one ────────────
  const imageUrls: string[] = [];
  if (aboutImage && lesson?.images.length && authorId) {
    // Cap it: a lesson can carry a dozen figures and the question is about one
    // area, so a few is enough context without an unreadable payload.
    for (const img of lesson.images.slice(0, 4)) {
      const dataUrl = await fetchImageAsDataUrl(img.src, authorId);
      if (dataUrl) imageUrls.push(dataUrl);
    }
    if (!imageUrls.length) {
      warning = [warning, 'The query is about an image, but the images could not be downloaded.']
        .filter(Boolean).join(' ');
    }
  }

  // Unanswerable without grounding that we could not get — a human must check.
  const needsManualReview = needsLesson && !lesson;

  // ── Stage 4: draft ─────────────────────────────────────────────────────────
  const prompt = [
    '# Query',
    ticket,
    lesson
      ? `\n# Lesson content${lesson.title ? ` — ${lesson.title}` : ''}\n${lesson.markdown.slice(0, 24_000)}`
      // Phrased as an internal instruction, not as something to relay. Saying
      // "not available" here invites the model to repeat that to the learner.
      : '\n# Lesson content\nNot supplied for this draft. Write a reply that stands on its own without quoting or characterising the lesson, and without mentioning that it was not supplied.',
    imageUrls.length
      ? `\n# Images\n${imageUrls.length} image(s) from the lesson are attached. The query is about them, so judge them directly.${
          lesson?.images.slice(0, 4).map((i, n) => `\n${n + 1}. ${i.caption || '(no caption)'}`).join('') || ''
        }`
      : '',
  ].filter(Boolean).join('\n');

  const reply = (
    imageUrls.length
      ? await generateTextWithImages(prompt, imageUrls, { system: DRAFT_SYSTEM, tier: 'normal', maxTokens: 1200 })
      : await generateText(prompt, { system: DRAFT_SYSTEM, tier: 'normal', maxTokens: 1200 })
  ).trim();

  return {
    reply,
    usedLesson: !!lesson,
    needsLesson,
    aboutImage,
    imagesRead: imageUrls.length,
    needsManualReview,
    reason,
    lessonTitle: lesson?.title,
    lessonUrl: lesson?.url,
    warning,
  };
}
