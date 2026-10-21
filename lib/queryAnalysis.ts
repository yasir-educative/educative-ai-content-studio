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

const TRIAGE_SYSTEM = `You triage queries raised against Educative courses.

# 1. Category
"content" — about the material itself: an explanation, example, diagram, code, exercise, quiz, factual accuracy, difficulty, pacing, coverage, typos, or a request for more depth.

"not-content" — anything the content team cannot fix by editing a lesson:
- account, login, profile, email, deletion
- subscription, billing, refunds, plan access, entitlement, a lesson showing as locked
- missing or broken platform features: highlighting, notes, bookmarks, progress or "mark as complete", dark mode, search, certificates, streaks
- app or site bugs: pages not loading, a widget not running, playback, performance
- mock interviews, cloud labs or assessments failing as a product, rather than their content being wrong

Judge what would actually fix it. "I can see all the course content but it shows a lock icon and I have no highlighting or notes" is not-content: nothing in the lesson text is wrong, the entitlement or the feature is. Mentioning a course by name does not make it content.

If it is genuinely both, choose the one that must be fixed first, and say so in the reason.

# 2. Lesson needed (content queries only)
Answer WITHOUT the lesson when the query is general, about policy or process, or already quoted in full.
Read the lesson FIRST when the query claims something is wrong, unclear, outdated or contradictory, asks why it says something, or points at specific code, output, diagrams, numbers or steps.
For not-content queries this is always false; the lesson cannot settle them.

# 3. Image
True only when answering needs LOOKING AT a diagram, figure, screenshot or chart — its content, labels, accuracy or legibility. A query that merely sits on a lesson containing images does not qualify.

Respond with JSON only, no markdown fences:
{"category": "content"|"not-content", "needsLesson": true|false, "aboutImage": true|false, "reason": "one short sentence", "topic": "what the query is really asking"}`;

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

# When you were given the lesson content, you have already checked it
Then the reply must reach a verdict. Say what the lesson actually does, quoting the line that shows it. Do not fall back on "we are looking into it", "we will review this", or "we will get it corrected if needed" — to the reader that reads as though nobody looked, which is worse than no reply.

One of these, chosen by what the content shows:
- They are right and it is wrong: say so plainly, name the specific thing that is wrong, and say it is being corrected.
- They are right that it is unclear, but it is not incorrect: explain what the content does say and why it is correct as written, then acknowledge that the wording or diagram could make it more obvious, and say that will be improved.
- They are mistaken: show where the content already covers it, quote it, and explain the behaviour without being dismissive.
Only say something is being investigated when the content genuinely does not settle it — and then say what specifically is being checked, not "this issue".

# When the query reports an error, bug, or factual mistake
Do not offer features. Acknowledge the specific problem. If you have the content, follow the verdict rules above rather than deferring.

# When the query is NOT about content
You will be told when the query is an account, subscription, access, or platform-feature matter. Then:
- Do not treat it as feedback on the writing. Never say the material will be made clearer, and never offer Explain with AI or Mock Interviews.
- Acknowledge the specific thing they cannot do — the locked lesson, the missing notes, the progress that will not save — in their terms.
- Say it is being passed to the team that handles it so it can be put right. Do not name an internal team or queue.
- Where an obvious first check exists and is not condescending, you may offer one (for example confirming which account the subscription sits on). Never list generic troubleshooting steps they have already tried, and never ask them to repeat something the ticket says they did.
- Do not promise a timeline, a refund, or an entitlement change.`;

export interface AnalysisResult {
  reply: string;
  /** "content" when the content team can fix it by editing a lesson. */
  category: 'content' | 'not-content';
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
  let category: 'content' | 'not-content' = 'content';
  try {
    const raw = await generateText(ticket, { system: TRIAGE_SYSTEM, tier: 'edit', maxTokens: 300 });
    const parsed = parseJsonLoose<{ category?: string; needsLesson?: boolean; aboutImage?: boolean; reason?: string }>(raw);
    if (parsed && typeof parsed.needsLesson === 'boolean') {
      needsLesson = parsed.needsLesson;
      reason = parsed.reason || '';
    }
    aboutImage = !!parsed?.aboutImage;
    if (parsed?.category === 'not-content') category = 'not-content';
    // The lesson cannot settle an account or platform problem, so never fetch
    // it for one — and never flag such a ticket for review over a missing read.
    if (category === 'not-content') { needsLesson = false; aboutImage = false; }
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
    category === 'not-content'
      ? '\n# Classification\nNOT CONTENT — this is an account, subscription, access, or platform-feature matter. Follow the not-about-content rules.'
      : '',
    lesson
      ? `\n# ${lesson.kind === 'mobile-cards' ? 'Lesson content (mobile card deck, one card per section)' : 'Lesson content'}${
          lesson.title ? ` — ${lesson.title}` : ''
        }\n${lesson.markdown.slice(0, 24_000)}`
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
    category,
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
