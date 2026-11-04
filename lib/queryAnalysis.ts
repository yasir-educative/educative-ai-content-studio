// Draft a reply to a content query.
//
// Two stages, so the lesson is only fetched when it is actually needed:
//   1. Triage — can the ticket be answered from its own text?
//   2. Draft   — write the reply, with the lesson content when stage 1 asked
//                for it and the ids are available.

import { generateText, generateTextWithImages, parseJsonLoose } from './ai';
import {
  registeredQueriesTriagePrompt,
  registeredPsbDraftPrompt,
  registeredFsbDraftPrompt,
  registeredQueriesPolishPrompt,
  registeredQueriesChangesPrompt,
} from './queryPromptsRegistry';
import { fetchImageAsDataUrl, fetchLessonMarkdown } from './educativeLesson';
import { extractSllId, fenzoLessonToMarkdown, fetchFenzoLesson, resolveTarget } from './fenzoLesson';
import type { JiraIssueDetail } from './jira';






/** One edit the content team would have to make. Shown to the author, never posted. */
export interface ContentChange {
  /** Where in the material, named so it can be found. */
  where: string;
  /** What to change it to. */
  change: string;
  /** Why the query calls for it. */
  why?: string;
}

export interface AnalysisResult {
  reply: string;
  /** Edits the material needs. Empty when nothing needs changing. */
  changes: ContentChange[];
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

/** A ticket field by name, however the board spells it. */
export function fieldValue(issue: JiraIssueDetail, ...names: string[]): string {
  const want = names.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const hit = issue.fields.find((f) => want.includes(f.name.toLowerCase().replace(/[^a-z0-9]/g, '')));
  return hit?.value.trim() || '';
}

/**
 * The part of the lesson a query is actually about.
 *
 * Query tickets carry "Feedback Source" and "Widget Type", which name the exact
 * widget the reader was looking at when they complained. Without them a draft
 * is written against the whole lesson and comes back generic, so pull the
 * widget's own text out of the material and put it in front of the model.
 */
export function focusBlock(issue: JiraIssueDetail, lessonMarkdown?: string): string {
  const source = fieldValue(issue, 'Feedback Source', 'FeedbackSource', 'Source');
  const widget = fieldValue(issue, 'Widget Type', 'WidgetType', 'Widget');
  if (!source && !widget) return '';

  const lines = [
    '# What this query is about',
    'The ticket names the exact place the reader was looking at. Answer about that, not about the lesson in general.',
    source && `- Feedback source: ${source}`,
    widget && `- Widget type: ${widget}`,
  ].filter(Boolean) as string[];

  const extract = widget && lessonMarkdown ? widgetExcerpt(lessonMarkdown, widget) : '';
  if (extract) {
    lines.push('', `The ${widget} from the material:`, extract);
  } else if (widget) {
    lines.push('', `No "${widget}" is present in the material below. Say what is actually there instead of describing it as if it were.`);
  }
  return `\n${lines.join('\n')}\n`;
}

/** The labelled widget blocks in the material whose type matches `widget`. */
export function widgetExcerpt(markdown: string, widget: string): string {
  const key = widget.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!key) return '';
  const blocks: string[] = [];
  const re = /\[widget type="([^"]+)"\]([\s\S]*?)\[\/widget\]/g;
  for (let m = re.exec(markdown); m; m = re.exec(markdown)) {
    const type = m[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    // "Quiz" should match "QuizWidget", and "Code Exercise" should match "CodeExercise".
    if (type.includes(key) || key.includes(type)) blocks.push(m[0]);
    if (blocks.length >= 3) break;
  }
  return blocks.join('\n\n').slice(0, 6000);
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
    const raw = await generateText(registeredQueriesTriagePrompt({ ticket }), { tier: 'edit', maxTokens: 300 });
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

  // Two content sources. Educative lessons are keyed by author/collection/page;
  // Fenzo PAL lessons by sll_id, on either fenzo.ai or a master environment.
  // The ticket's own fields decide which, so a board can carry both.
  const fieldText = [
    issue.description,
    issue.summary,
    ...issue.fields.map((f) => `${f.name}: ${f.value}`),
  ].join('\n');
  const sllId = extractSllId(fieldText);

  if (needsLesson && !(authorId && collectionId && pageId) && sllId) {
    try {
      const target = resolveTarget(fieldText);
      const fl = await fetchFenzoLesson(sllId, target);
      if (fl) {
        lesson = {
          title: fl.lesson_title,
          markdown: fenzoLessonToMarkdown(fl),
          url: `${target.base.replace(/\/api$/, '')}/pal/${fl.sll_id}/0`,
          images: [],
          kind: 'lesson',
        };
      } else {
        warning = 'The lesson could not be read, so the reply is based on the ticket alone.';
      }
    } catch (e: any) {
      warning = `Lesson fetch failed (${e?.message || e}). The reply is based on the ticket alone.`;
    }
  } else if (needsLesson) {
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
  // Fenzo sessions are generated per learner and carry widgets, so they get
  // their own template rather than Educative lesson wording.
  const isFenzo = !!sllId && !(authorId && collectionId && pageId);

  const lessonBlock = lesson
    ? `${lesson.title ? `${lesson.title}\n\n` : ''}${lesson.markdown.slice(0, 24_000)}`
    : 'Not supplied for this draft. Write a reply that stands on its own without quoting or characterising the material, and without mentioning that it was not supplied.';

  const classification =
    category === 'not-content'
      ? '\n# Classification\nNOT CONTENT — an account, subscription, access or platform-feature matter. Follow the not-about-content rules.'
      : '';

  const focus = focusBlock(issue, lesson?.markdown);

  const prompt = (isFenzo ? registeredFsbDraftPrompt : registeredPsbDraftPrompt)({
    ticket,
    lesson: lessonBlock,
    classification: `${classification}${focus}`,
  });

  const withImages = imageUrls.length
    ? `${prompt}\n\n# Images\n${imageUrls.length} image(s) from the material are attached. The query is about them, so judge them directly.`
    : prompt;

  const reply = (
    imageUrls.length
      ? await generateTextWithImages(withImages, imageUrls, { tier: 'normal', maxTokens: 1200 })
      : await generateText(withImages, { tier: 'normal', maxTokens: 1200 })
  ).trim();

  // The edits the content team would have to make. Never sent to the learner:
  // the reply answers them, this says what to change and where.
  let changes: ContentChange[] = [];
  if (category === 'content' && lesson) {
    try {
      const raw = await generateText(
        registeredQueriesChangesPrompt({ ticket, lesson: lessonBlock, reply, focus }),
        { tier: 'normal', maxTokens: 900 },
      );
      const parsed = parseJsonLoose<{ changes?: ContentChange[] }>(raw);
      changes = (Array.isArray(parsed?.changes) ? parsed!.changes : [])
        .filter((c) => c && typeof c.where === 'string' && typeof c.change === 'string' && c.where.trim() && c.change.trim())
        .slice(0, 6);
    } catch {
      // Advisory only: a reply without a change list is still usable.
    }
  }

  return {
    reply,
    changes,
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



/** Rewrite a human-written draft in house voice, keeping its substance. */
export async function polishReply(issue: JiraIssueDetail, draft: string): Promise<string> {
  const prompt = registeredQueriesPolishPrompt({ ticket: ticketText(issue), draft: draft.trim() });
  return (await generateText(prompt, { tier: 'normal', maxTokens: 1200 })).trim();
}
