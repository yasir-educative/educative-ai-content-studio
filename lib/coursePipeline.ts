// Course lesson generation pipeline.
// Mirrors the n8n course workflow: research → outline → content → review → widgets → save.

import {
  generateText,
  generateTextStream,
  openaiSearch,
  parseJsonLoose,
  TEXT_GENERATOR_MODEL,
} from './ai';
import {
  courseOutlineGeneratorPrompt,
  courseContentCreatorPrompt,
  courseSummaryElementsPrompt,
  coursePrReviewerPrompt,
  courseCodeGeneratorPrompt,
  courseTableGeneratorPrompt,
  courseRunJsElaboratePrompt,
  courseRunJsCreatorPrompt,
} from './coursePromptsRegistry';
import { sanitizeText } from './transforms';
import {
  markdownToHtml,
  sanitizeAndFormat,
  makeSlate,
  makeCodeBlock,
  makeTableBlock,
  parseCodeOutput,
  parseTableOutput,
} from './educative';
import {
  makeRunJsBlock,
  makeQuizBlock,
  makePromptAiBlock,
  makeMarkMapBlock,
  makeHintBlock,
  makeTempImageBlock,
  createLesson,
  saveLesson,
  addPageToChapter,
  publishCourse,
  resolveImageBlocksForLesson,
  lessonUrlForIds,
  extractCollectionIds,
} from './courseEducative';
import { generateGptImage, slugify } from './imageGen';
import { buildRunJsHtml } from './runJsTemplate';
import { updateBlog } from './storage';
import type { StageEvent, Emit } from './pipeline';

export type { StageEvent, Emit };

export interface CourseInput {
  courseTitle: string;
  courseSummary?: string;
  domain: string;
  lessonTitle: string;
  chapterTitle: string;
  chapterSummary?: string;
  targetAudience: string;
  wordsLength: number;
  outline?: string;
  blogSummary?: string;
  lessonPurpose?: string;
  runJsEnabled?: boolean;
  aiAssessmentEnabled?: boolean;
  authorId?: string;
  collectionId?: string;
  templateUrl?: string;
  prevLessonTitle?: string;
  nextLessonTitle?: string;
  blogId?: string;
}

// ---------- Widget sentinel system ----------
//
// Widget placeholders like [code]...[/code], [image][Description]...[/image], [Hint]...[/Hint]
// contain nested brackets that the markdown renderer (marked) can misparse as link references.
// Strategy: before markdown conversion, replace every placeholder with a unique HTML comment
// sentinel (<!-- CWGT:type:index -->). HTML comments are treated as HTML blocks by marked and
// survive markdown rendering + sanitization unchanged. mergeCourseBlocks then finds sentinels
// in the cleaned HTML and inlines the actual widgets at the correct positions.

interface ExtractedWidgets {
  protectedMarkdown: string;
  codes: any[];
  tables: any[];
  images: Array<{ description: string; caption: string }>;
  runjs: any[];
  hints: Array<{ description: string; title: string }>;
  markmaps: string[];
  quizDescriptions: string[];
  aiAssessmentDescriptions: string[];
}

// Strip outer [bracket] wrapper that the LLM adds inside Description/Caption sub-tags.
// e.g. [Description][actual text][/Description] → descMatch[1] = "[actual text]" → strip to "actual text"
function stripOuterBrackets(s: string): string {
  const t = s.trim();
  return t.startsWith('[') && t.endsWith(']') ? t.slice(1, -1).trim() : t;
}

function extractAndProtect(md: string): ExtractedWidgets {
  const codes: any[] = [];
  const tables: any[] = [];
  const images: Array<{ description: string; caption: string }> = [];
  const runjs: any[] = [];
  const hints: Array<{ description: string; title: string }> = [];
  const markmaps: string[] = [];
  const quizDescriptions: string[] = [];
  const aiAssessmentDescriptions: string[] = [];

  let result = md;

  // ── image ──────────────────────────────────────────────────────────────────
  // Primary: [image]...[/image]  (all sub-tags contained within)
  result = result.replace(/\[image\]([\s\S]*?)\[\/image\]/gi, (_, inner) => {
    const descMatch = inner.match(/\[Description\]([\s\S]*?)\[\/Description\]/i);
    const captionMatch = inner.match(/\[Caption\]([\s\S]*?)\[\/Caption\]/i);
    const description = stripOuterBrackets(descMatch?.[1] ?? inner);
    const caption = stripOuterBrackets(captionMatch?.[1] ?? '');
    const idx = images.length;
    images.push({ description, caption });
    return `\n\n<!-- CWGT:image:${idx} -->\n\n`;
  });

  // Fallback: LLM omits [/image] — match Description/Caption sub-tags directly
  result = result.replace(
    /\[image\]\[Description\]([\s\S]*?)\[\/Description\](?:\[Caption\]([\s\S]*?)\[\/Caption\])?/gi,
    (_, desc, cap) => {
      const idx = images.length;
      images.push({ description: stripOuterBrackets(desc ?? ''), caption: stripOuterBrackets(cap ?? '') });
      return `\n\n<!-- CWGT:image:${idx} -->\n\n`;
    },
  );

  // ── Hint ───────────────────────────────────────────────────────────────────
  // Prompt format: [Hint][description][title][/Hint]
  // LLM often reverses to [title][content] — detect by word count (title ≤ 5 words)
  result = result.replace(/\[Hint\]([\s\S]*?)\[\/Hint\]/gi, (_, inner) => {
    const parts: string[] = [];
    const re = /\[([\s\S]*?)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner)) !== null) parts.push(m[1].trim());
    const idx = hints.length;
    let description = inner.trim();
    let title = 'Hint';
    if (parts.length >= 2) {
      // Title is always the shorter part (fewer words).
      // Prompt format is [description][title], but LLM sometimes reverses it —
      // comparing lengths is more reliable than a word-count threshold.
      const w0 = parts[0].split(/\s+/).filter(Boolean).length;
      const w1 = parts[1].split(/\s+/).filter(Boolean).length;
      if (w0 <= w1) {
        // parts[0] is shorter → LLM reversed order, title is first
        title = parts[0];
        description = parts[1];
      } else {
        // parts[1] is shorter → correct prompt order, title is second
        title = parts[1] || 'Hint';
        description = parts[0];
      }
    } else if (parts.length === 1) {
      description = parts[0];
    }
    hints.push({ description, title });
    return `\n\n<!-- CWGT:hint:${idx} -->\n\n`;
  });

  // ── AI assessment ──────────────────────────────────────────────────────────
  result = result.replace(/\[AI assessment\]([\s\S]*?)\[\/AI assessment\]/gi, (_, inner) => {
    const idx = aiAssessmentDescriptions.length;
    aiAssessmentDescriptions.push(inner.trim());
    return `\n\n<!-- CWGT:aiassessment:${idx} -->\n\n`;
  });

  // ── markmap ────────────────────────────────────────────────────────────────
  // LLM often uses image-like Description/Caption sub-tags and omits [/markmap].
  // Run the sub-tag pattern first (more specific), then the simple pattern.
  result = result.replace(
    /\[markmap\]\[Description\]([\s\S]*?)\[\/Description\](?:\[Caption\]([\s\S]*?)\[\/Caption\])?(?:\s*\[\/markmap\])?/gi,
    (_, desc, _cap) => {
      const idx = markmaps.length;
      markmaps.push(stripOuterBrackets(desc ?? ''));
      return `\n\n<!-- CWGT:markmap:${idx} -->\n\n`;
    },
  );

  // Simple: [markmap]description[/markmap]
  result = result.replace(/\[markmap\]([\s\S]*?)\[\/markmap\]/gi, (_, inner) => {
    const idx = markmaps.length;
    markmaps.push(inner.trim());
    return `\n\n<!-- CWGT:markmap:${idx} -->\n\n`;
  });

  // ── quiz ───────────────────────────────────────────────────────────────────
  result = result.replace(/\[quiz\]([\s\S]*?)\[\/quiz\]/gi, (_, inner) => {
    const idx = quizDescriptions.length;
    quizDescriptions.push(inner.trim());
    return `\n\n<!-- CWGT:quiz:${idx} -->\n\n`;
  });

  // ── runjs ──────────────────────────────────────────────────────────────────
  // Fallback: LLM omits [/runjs] and uses Description/Caption sub-tags (same pattern as image/markmap)
  result = result.replace(
    /\[runjs\]\[Description\]([\s\S]*?)\[\/Description\](?:\[Caption\]([\s\S]*?)\[\/Caption\])?(?:\s*\[\/runjs\])?/gi,
    (_, desc, cap) => {
      const idx = runjs.length;
      runjs.push({ concept: stripOuterBrackets(desc ?? ''), caption: stripOuterBrackets(cap ?? '') });
      return `\n\n<!-- CWGT:runjs:${idx} -->\n\n`;
    },
  );

  // Standard: [runjs]...[/runjs] (JSON payload or plain description)
  result = result.replace(/\[runjs\]([\s\S]*?)\[\/runjs\]/gi, (_, inner) => {
    let payload: any = inner.trim();
    try { payload = JSON.parse(payload.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '')); } catch {}
    const idx = runjs.length;
    runjs.push(payload);
    return `\n\n<!-- CWGT:runjs:${idx} -->\n\n`;
  });

  // ── code ───────────────────────────────────────────────────────────────────
  result = result.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_, inner) => {
    let payload: any = inner.trim();
    try { payload = JSON.parse(payload.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '')); } catch {}
    const idx = codes.length;
    codes.push(payload);
    return `\n\n<!-- CWGT:code:${idx} -->\n\n`;
  });

  // ── table ──────────────────────────────────────────────────────────────────
  result = result.replace(/\[table\]([\s\S]*?)\[\/table\]/gi, (_, inner) => {
    let payload: any = inner.trim();
    try { payload = JSON.parse(payload.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '')); } catch {}
    const idx = tables.length;
    tables.push(payload);
    return `\n\n<!-- CWGT:table:${idx} -->\n\n`;
  });

  return { protectedMarkdown: result, codes, tables, images, runjs, hints, markmaps, quizDescriptions, aiAssessmentDescriptions };
}

// Build editor blocks from cleaned HTML + pre-built widget arrays.
// Sentinels (<!-- CWGT:type:index -->) are found in the HTML and replaced with widget blocks.
function mergeCourseBlocks(args: {
  cleanedHtml: string;
  codeBlocks: any[];
  tableBlocks: any[];
  imageBlocks: any[];
  runJsBlocks: any[];
  hintBlocks: any[];
  markmapBlocks: any[];
  quizBlocks: any[];
  aiAssessmentBlocks: any[];
}): any[] {
  const html = String(args.cleanedHtml || '');

  // Match sentinels; note: JSON.stringify escaping doesn't affect <!-- ... --> patterns
  const RE = /<!--\s*CWGT:(code|table|image|runjs|hint|markmap|quiz|aiassessment):(\d+)\s*-->/gi;

  type Hit = { index: number; end: number; type: string; idx: number };
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;
  while ((m = RE.exec(html))) {
    hits.push({ index: m.index, end: RE.lastIndex, type: m[1].toLowerCase(), idx: parseInt(m[2], 10) });
  }
  hits.sort((a, b) => a.index - b.index);

  const blocks: any[] = [];
  let cursor = 0;

  for (const hit of hits) {
    const seg = makeSlate(html.slice(cursor, hit.index));
    if (seg) blocks.push(seg);

    let block: any = null;
    switch (hit.type) {
      case 'code':        block = args.codeBlocks[hit.idx]; break;
      case 'table':       block = args.tableBlocks[hit.idx]; break;
      case 'image':       block = args.imageBlocks[hit.idx]; break;
      case 'runjs':       block = args.runJsBlocks[hit.idx]; break;
      case 'hint':        block = args.hintBlocks[hit.idx]; break;
      case 'markmap':     block = args.markmapBlocks[hit.idx]; break;
      case 'quiz':        block = args.quizBlocks[hit.idx]; break;
      case 'aiassessment': block = args.aiAssessmentBlocks[hit.idx]; break;
    }
    if (block) blocks.push(block);
    cursor = hit.end;
  }

  const tail = makeSlate(html.slice(cursor));
  if (tail) blocks.push(tail);

  // Fallback: append any widget whose sentinel was stripped by the PR reviewer
  for (const b of args.codeBlocks) if (b && !blocks.includes(b)) blocks.push(b);
  for (const b of args.tableBlocks) if (b && !blocks.includes(b)) blocks.push(b);
  for (const b of args.imageBlocks) if (b && !blocks.includes(b)) blocks.push(b);
  for (const b of args.runJsBlocks) if (b && !blocks.includes(b)) blocks.push(b);
  for (const b of args.hintBlocks) if (b && !blocks.includes(b)) blocks.push(b);
  for (const b of args.markmapBlocks) if (b && !blocks.includes(b)) blocks.push(b);
  for (const b of args.quizBlocks) if (b && !blocks.includes(b)) blocks.push(b);
  for (const b of args.aiAssessmentBlocks) if (b && !blocks.includes(b)) blocks.push(b);

  return blocks.filter(Boolean);
}

// Normalize summary-elements output from n8n format to internal widget args.
function normalizeSummaryElements(raw: any): {
  summary: string;
  quiz: any;
  ai_assessment: any;
  markmap: any;
  hint: any;
} | null {
  if (!raw) return null;
  try {
    // Quiz: convert correct_answer (string) → correct (index)
    let quiz: any = null;
    const rawQuiz = raw.quiz;
    if (Array.isArray(rawQuiz) && rawQuiz.length > 0) {
      quiz = {
        title: 'Knowledge Check',
        questions: rawQuiz.map((q: any) => {
          const opts: string[] = (q.options || []).map((o: any) =>
            String(typeof o === 'object' ? o.text || JSON.stringify(o) : o),
          );
          let correctIdx = 0;
          if (typeof q.correct_answer === 'string') {
            const idx = opts.findIndex((o) => o === q.correct_answer);
            correctIdx = idx >= 0 ? idx : 0;
          } else if (typeof q.correct === 'number') {
            correctIdx = q.correct;
          }
          return { question: q.question, options: opts, correct: correctIdx, explanation: q.explanation || '' };
        }),
      };
    } else if (rawQuiz && typeof rawQuiz === 'object' && rawQuiz.questions) {
      quiz = rawQuiz;
    }

    // AI assessment: preserve all fields needed by makePromptAiBlock
    let ai_assessment: any = null;
    const rawAI = raw.ai_assessment;
    if (rawAI) {
      ai_assessment = {
        title: rawAI.title || 'Apply Your Knowledge',
        prompt: rawAI.question || rawAI.prompt || '',
        placeholder: rawAI.placeholder || 'Type your answer here...',
        reference_answer: rawAI.reference_answer || '',
        intro_statement: rawAI.intro_statement || rawAI.introTextStatement || '',
        intro_prompt: rawAI.intro_prompt || rawAI.introPrompt || '',
        first_ai_message: rawAI.first_ai_message || rawAI.firstAIMessage || '',
        turn_limit: rawAI.turn_limit ?? rawAI.turnLimit ?? 4,
      };
    }

    // Markmap: string → { title, markdown }
    let markmap: any = null;
    const rawMM = raw.markmap;
    if (typeof rawMM === 'string' && rawMM.trim()) {
      markmap = {
        title: raw.markmap_caption || raw.markma_caption || 'Concept Map',
        markdown: rawMM,
      };
    } else if (rawMM && typeof rawMM === 'object' && rawMM.markdown) {
      markmap = rawMM;
    }

    // Hint: n8n { title, text } → { title, content }
    let hint: any = null;
    const rawHint = raw.hint;
    if (rawHint) {
      hint = { title: rawHint.title || 'Hint', content: rawHint.text || rawHint.content || '' };
    }

    return { summary: raw.summary || '', quiz, ai_assessment, markmap, hint };
  } catch {
    return null;
  }
}

function stageLog(emit: Emit, name: string, prompt: string, args: any, output: any) {
  emit({ type: 'log', name, message: `stage:${name}`, payload: { prompt, args, output } });
}

// ---------- Main pipeline ----------

export async function runCourseLessonPipeline(input: CourseInput, emit: Emit): Promise<void> {
  const { authorId: extractedAuthorId, collectionId: extractedCollectionId } =
    input.templateUrl ? extractCollectionIds(input.templateUrl) : { authorId: '', collectionId: '' };
  const authorId = input.authorId || extractedAuthorId || process.env.EDUCATIVE_AUTHOR_ID || '';
  const collectionId = input.collectionId || extractedCollectionId || '';

  const wordsLength = Number(input.wordsLength) || 2000;
  const domain = input.domain || 'System Design';
  const runId = input.blogId || `course-${Date.now()}`;

  // ── Stage 1: Web research ──────────────────────────────────────────────────
  emit({ type: 'stage', name: 'web-research', status: 'start' });
  const searchQuery = `${input.chapterTitle} related to the course ${input.courseTitle} implementation concepts best practices examples`;
  const research = await openaiSearch(searchQuery);
  stageLog(emit, 'web-research', searchQuery, { lessonTitle: input.lessonTitle }, research.slice(0, 500));
  emit({ type: 'data', name: 'web-research', payload: research });
  emit({ type: 'stage', name: 'web-research', status: 'done' });

  // ── Stage 2: JSON Outline ─────────────────────────────────────────────────
  emit({ type: 'stage', name: 'json-outline', status: 'start' });
  const joArgs = {
    lessonTitle: input.lessonTitle,
    chapterTitle: input.chapterTitle,
    courseTitle: input.courseTitle,
    courseSummary: input.courseSummary || '',
    chapterSummary: input.chapterSummary || '',
    domain,
    targetAudience: input.targetAudience,
    wordsLength,
    userOutline: input.outline || '',
    lessonPurpose: input.lessonPurpose || input.blogSummary || '',
    nextLessonTitle: input.nextLessonTitle || '',
    prevLessonTitle: input.prevLessonTitle || '',
    runJsEnabled: Boolean(input.runJsEnabled),
    aiAssessmentEnabled: input.aiAssessmentEnabled !== false,
    referenceContent: research,
  };
  const joPrompt = courseOutlineGeneratorPrompt(joArgs);
  const jsonOutlineRaw = await generateText(joPrompt, { maxTokens: 4000 });
  stageLog(emit, 'json-outline', joPrompt, joArgs, jsonOutlineRaw);
  let jsonOutline: any;
  try { jsonOutline = parseJsonLoose(jsonOutlineRaw); } catch { jsonOutline = { raw: jsonOutlineRaw }; }
  emit({ type: 'data', name: 'json-outline', payload: jsonOutline });
  emit({ type: 'stage', name: 'json-outline', status: 'done' });

  const lessonSummary: string = jsonOutline?.['Lesson summary'] || jsonOutline?.lesson_summary || '';
  const outlineSections: any[] = Array.isArray(jsonOutline?.outline) ? jsonOutline.outline : [];
  const outlineString = outlineSections.length
    ? outlineSections
        .map((s: any) =>
          `# Section Title: ${s.sectionTitle}\nType: ${s.sectionType}\nDescription: ${s.description ?? ''}\nOutline: ${s.sectionOutline}\nWordLength: ${s.WordLength}`,
        )
        .join('\n\n')
    : JSON.stringify(jsonOutline, null, 2);

  // ── Stage 3: Content creation (streaming) ────────────────────────────────
  emit({ type: 'stage', name: 'content-creator', status: 'start' });
  const ccArgs = {
    lessonTitle: input.lessonTitle,
    lessonSummary,
    chapterTitle: input.chapterTitle,
    chapterSummary: input.chapterSummary || '',
    courseTitle: input.courseTitle,
    courseSummary: input.courseSummary || '',
    domain,
    targetAudience: input.targetAudience,
    wordsLength,
    outlineString,
    prevLessonTitle: input.prevLessonTitle || '',
    nextLessonTitle: input.nextLessonTitle || '',
    lessonPurpose: input.lessonPurpose || input.blogSummary || '',
    referenceContent: research,
  };
  const ccPrompt = courseContentCreatorPrompt(ccArgs);
  let lastStreamAt = 0;
  const rawContent = await generateTextStream(
    ccPrompt,
    (_chunk, accumulated) => {
      const now = Date.now();
      if (now - lastStreamAt < 40) return;
      lastStreamAt = now;
      emit({ type: 'stream', name: 'content-creator', payload: accumulated });
    },
    { maxTokens: 16000, model: TEXT_GENERATOR_MODEL, noThinking: true },
  );
  emit({ type: 'stream', name: 'content-creator', payload: rawContent });
  stageLog(emit, 'content-creator', ccPrompt, ccArgs, rawContent.slice(0, 300));
  emit({ type: 'data', name: 'content-creator', payload: rawContent });
  emit({ type: 'stage', name: 'content-creator', status: 'done' });

  const seedContent = sanitizeText(rawContent);

  // ── Stage 4: Summary elements ─────────────────────────────────────────────
  emit({ type: 'stage', name: 'summary-elements', status: 'start' });
  const sePrompt = courseSummaryElementsPrompt({ content: seedContent.slice(0, 8000) });
  const summaryRaw = await generateText(sePrompt, { maxTokens: 4000, noThinking: true });
  stageLog(emit, 'summary-elements', sePrompt, {}, summaryRaw.slice(0, 300));
  let summaryElements: ReturnType<typeof normalizeSummaryElements> = null;
  try { summaryElements = normalizeSummaryElements(parseJsonLoose(summaryRaw)); } catch {}
  emit({ type: 'data', name: 'summary-elements', payload: summaryElements });
  emit({ type: 'stage', name: 'summary-elements', status: 'done' });

  // ── Stage 5: PR reviewer ──────────────────────────────────────────────────
  emit({ type: 'stage', name: 'pr-reviewer', status: 'start' });
  const prPrompt = coursePrReviewerPrompt({ content: seedContent, summary: summaryElements?.summary || '', wordsLength });
  const prOut = await generateText(prPrompt, { maxTokens: 16000, noThinking: true });
  stageLog(emit, 'pr-reviewer', prPrompt, {}, prOut.slice(0, 300));

  // PR reviewer returns JSON: { Content, Summary }
  let reviewed = seedContent;
  try {
    const prParsed = parseJsonLoose(prOut);
    const content = prParsed?.Content || prParsed?.content || '';
    if (content && sanitizeText(content).length > 300) {
      reviewed = sanitizeText(content);
      if (prParsed?.Summary && summaryElements) summaryElements = { ...summaryElements, summary: prParsed.Summary };
    } else {
      reviewed = sanitizeText(prOut).length > 300 ? sanitizeText(prOut) : seedContent;
    }
  } catch {
    reviewed = sanitizeText(prOut).length > 300 ? sanitizeText(prOut) : seedContent;
  }
  emit({ type: 'data', name: 'pr-reviewer', payload: reviewed });
  emit({ type: 'stage', name: 'pr-reviewer', status: 'done' });

  // Extract widget data AND replace placeholders with sentinels BEFORE markdown rendering.
  // This prevents nested brackets (e.g. [image][Description]...) from being misinterpreted
  // by the markdown renderer as link references.
  const {
    protectedMarkdown,
    codes: rawCodes,
    tables: rawTables,
    images: rawImages,
    runjs: rawRunJs,
    hints: rawHints,
    markmaps: rawMarkmaps,
    quizDescriptions: rawQuizDescs,
    aiAssessmentDescriptions: rawAiDescs,
  } = extractAndProtect(reviewed);

  emit({
    type: 'log',
    name: 'editor-blocks',
    message: 'widget-counts',
    payload: { code: rawCodes.length, table: rawTables.length, image: rawImages.length, runjs: rawRunJs.length, hint: rawHints.length, markmap: rawMarkmaps.length, quiz: rawQuizDescs.length, aiAssessment: rawAiDescs.length },
  });

  // ── Stage 6: Widget generation — all parallel ─────────────────────────────

  const codeWidgetPromise = (async (): Promise<any[]> => {
    if (!rawCodes.length) return [];
    emit({ type: 'stage', name: 'widget-code', status: 'start' });
    const blocks = (await Promise.all(rawCodes.map(async (rawCode) => {
      try {
        const codeData = typeof rawCode === 'string' ? rawCode : JSON.stringify(rawCode);
        const p = courseCodeGeneratorPrompt(codeData);
        const out = await generateText(p, { maxTokens: 2000, noThinking: true });
        stageLog(emit, 'widget-code', p, {}, out);
        const parsed = parseCodeOutput(out);
        return makeCodeBlock(parsed || rawCode) || makeCodeBlock(rawCode);
      } catch (e: any) {
        console.warn('[coursePipeline] code widget failed:', e?.message);
        return makeCodeBlock(rawCode);
      }
    }))).filter(Boolean);
    emit({ type: 'data', name: 'widget-code', payload: blocks.length });
    emit({ type: 'stage', name: 'widget-code', status: 'done' });
    return blocks;
  })();

  const tableWidgetPromise = (async (): Promise<any[]> => {
    if (!rawTables.length) return [];
    emit({ type: 'stage', name: 'widget-table', status: 'start' });
    const blocks = (await Promise.all(rawTables.map(async (rawTable) => {
      try {
        const desc = typeof rawTable === 'string' ? rawTable : JSON.stringify(rawTable);
        const p = courseTableGeneratorPrompt({ reference: desc, original: desc });
        const out = await generateText(p, { maxTokens: 1500, noThinking: true });
        stageLog(emit, 'widget-table', p, {}, out);
        const parsed = parseTableOutput(out);
        return makeTableBlock(parsed || rawTable) || makeTableBlock(rawTable);
      } catch (e: any) {
        console.warn('[coursePipeline] table widget failed:', e?.message);
        return makeTableBlock(rawTable);
      }
    }))).filter(Boolean);
    emit({ type: 'data', name: 'widget-table', payload: blocks.length });
    emit({ type: 'stage', name: 'widget-table', status: 'done' });
    return blocks;
  })();

  const runJsWidgetPromise = (async (): Promise<any[]> => {
    const outlineWantsRunJs = outlineSections.some((s: any) =>
      (s.sectionType || '').toLowerCase().includes('runjs'),
    );
    if (!input.runJsEnabled && !rawRunJs.length && !outlineWantsRunJs) return [];
    emit({ type: 'stage', name: 'widget-runjs', status: 'start' });
    const targets = rawRunJs.length ? rawRunJs : [{ concept: `Interactive visualization for ${input.lessonTitle}` }];
    const blocks = (await Promise.all(targets.map(async (rawRJ) => {
      try {
        const concept = typeof rawRJ === 'string' ? rawRJ : rawRJ?.concept || rawRJ?.Concept || rawRJ?.title || JSON.stringify(rawRJ);

        // Step 1: Elaborate — produce a focused architectural narrative paragraph
        const elaborateP = courseRunJsElaboratePrompt({ lessonTitle: input.lessonTitle, concept, domain });
        const narrative = await generateText(elaborateP, { maxTokens: 600, noThinking: true });

        // Step 2: Creator — translate narrative into NODES/CONNECTIONS/STEPS JSON
        const creatorP = courseRunJsCreatorPrompt({ lessonTitle: input.lessonTitle, description: narrative.trim(), domain });
        const creatorOut = await generateText(creatorP, { maxTokens: 4000, noThinking: true });
        let sceneData: any = { NODES: [], CONNECTIONS: [], STEPS: [] };
        try {
          const cleaned = creatorOut.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
          sceneData = parseJsonLoose(cleaned);
        } catch { /* keep empty scene */ }

        // Step 3: Inject scene data into the HTML template
        const title = concept.split(/[.!?\n]/)[0].trim().slice(0, 60) || `${input.lessonTitle} Playground`;
        const html = buildRunJsHtml(sceneData, title);
        return makeRunJsBlock(html, title);
      } catch (e: any) {
        console.warn('[coursePipeline] runjs widget failed:', e?.message);
        return null;
      }
    }))).filter(Boolean);
    emit({ type: 'data', name: 'widget-runjs', payload: blocks.length });
    emit({ type: 'stage', name: 'widget-runjs', status: 'done' });
    return blocks;
  })();

  const imageWidgetPromise = (async (): Promise<any[]> => {
    if (!rawImages.length) return [];
    emit({ type: 'stage', name: 'widget-images', status: 'start' });
    const imgSubfolder = `courses/${slugify(input.courseTitle)}/${slugify(input.lessonTitle)}`;
    const blocks: any[] = [];
    for (let i = 0; i < rawImages.length; i++) {
      const { description, caption } = rawImages[i];
      try {
        const result = await generateGptImage(`${domain} technical diagram: ${description} (for lesson "${input.lessonTitle}")`, i, imgSubfolder);
        blocks.push(makeTempImageBlock(result.url, caption || description.slice(0, 80)));
      } catch (e: any) {
        console.warn('[coursePipeline] image widget failed:', e?.message);
        blocks.push(null);
      }
    }
    emit({ type: 'data', name: 'widget-images', payload: blocks.filter(Boolean).length });
    emit({ type: 'stage', name: 'widget-images', status: 'done' });
    return blocks;
  })();

  const [codeBlocks, tableBlocks, runJsBlocks, imageBlocks] = await Promise.all([
    codeWidgetPromise,
    tableWidgetPromise,
    runJsWidgetPromise,
    imageWidgetPromise,
  ]);

  // ── Stage 7: Build editor blocks ──────────────────────────────────────────
  emit({ type: 'stage', name: 'editor-blocks', status: 'start' });

  // Hint blocks: prefer summaryElements.hint (generated from context) for the first hint;
  // fall back to inline extraction for subsequent hints or when summaryElements is absent.
  const hintBlocks: any[] = rawHints
    .map((h, i) => {
      if (i === 0 && summaryElements?.hint) return makeHintBlock(summaryElements.hint);
      return makeHintBlock({ title: h.title, content: h.description });
    })
    .filter(Boolean);

  // Markmap blocks: inline placeholders use summary-elements output; fallback to description
  const markmapBlocks: any[] = rawMarkmaps
    .map((desc, i) => {
      if (i === 0 && summaryElements?.markmap) return makeMarkMapBlock(summaryElements.markmap);
      return makeMarkMapBlock({ title: 'Concept Map', markdown: desc });
    })
    .filter(Boolean);

  // Quiz blocks from summary-elements
  const quizBlocks: any[] = summaryElements?.quiz ? [makeQuizBlock(summaryElements.quiz)].filter(Boolean) : [];

  // AI assessment blocks from summary-elements
  const aiAssessmentBlocks: any[] =
    input.aiAssessmentEnabled !== false && summaryElements?.ai_assessment
      ? [makePromptAiBlock(summaryElements.ai_assessment)].filter(Boolean)
      : [];

  // Convert protected markdown (with sentinels) → HTML → sanitize
  const html = markdownToHtml(protectedMarkdown);
  const { cleanedHtml, title } = sanitizeAndFormat({
    html,
    rawMarkdown: protectedMarkdown,
    fallbackTitle: input.lessonTitle,
  });

  const mainBlocks = mergeCourseBlocks({
    cleanedHtml,
    codeBlocks,
    tableBlocks,
    imageBlocks,
    runJsBlocks,
    hintBlocks,
    markmapBlocks,
    quizBlocks,
    aiAssessmentBlocks,
  });

  const editorBlocks = mainBlocks.filter(Boolean);

  emit({ type: 'data', name: 'editor-blocks', payload: `${editorBlocks.length} blocks` });
  emit({ type: 'stage', name: 'editor-blocks', status: 'done' });

  emit({
    type: 'final',
    payload: {
      title,
      markdown: reviewed,
      html,
      editorBlocks,
      widgets: { code: codeBlocks, table: tableBlocks, image: imageBlocks },
      lessonTitle: input.lessonTitle,
      chapterTitle: input.chapterTitle,
      courseTitle: input.courseTitle,
      authorId,
      collectionId,
    },
  });

  // ── Stage 8: Save lesson to Educative ─────────────────────────────────────
  const courseFlaskAuth = process.env.EDUCATIVE_COURSE_FLASK_AUTH || process.env.EDUCATIVE_FLASK_AUTH || '';
  if (!authorId || !collectionId || !courseFlaskAuth) {
    emit({
      type: 'log',
      name: 'save-lesson',
      message: !authorId || !collectionId
        ? 'Skipping Educative save — authorId or collectionId not configured.'
        : 'Skipping Educative save — EDUCATIVE_COURSE_FLASK_AUTH env var is not set.',
    });
    return;
  }

  emit({ type: 'stage', name: 'save-lesson', status: 'start' });
  try {
    const { page_id: pageId } = await createLesson(authorId, collectionId);
    if (!pageId) throw new Error('createLesson returned no page_id');

    const resolvedBlocks = await resolveImageBlocksForLesson(editorBlocks, authorId, collectionId, pageId);
    await saveLesson(authorId, collectionId, pageId, { title, blocks: resolvedBlocks });
    const lessonUrl = lessonUrlForIds(authorId, collectionId, pageId);

    emit({ type: 'data', name: 'save-lesson', payload: { pageId, url: lessonUrl } });
    emit({ type: 'stage', name: 'save-lesson', status: 'done' });

    if (input.blogId) {
      try {
        await updateBlog(input.blogId, { coursePageId: pageId, publishedUrl: lessonUrl, publishedAt: new Date().toISOString(), status: 'published' });
      } catch {}
    }

    emit({ type: 'stage', name: 'save-chapter', status: 'start' });
    try {
      await addPageToChapter(authorId, collectionId, pageId, input.chapterTitle, title);
      emit({ type: 'data', name: 'save-chapter', payload: { chapterTitle: input.chapterTitle, pageId } });
    } catch (e: any) {
      emit({ type: 'log', name: 'save-chapter', message: `Chapter update failed (non-fatal): ${e?.message}` });
    }
    emit({ type: 'stage', name: 'save-chapter', status: 'done' });

    emit({ type: 'stage', name: 'publish', status: 'start' });
    try {
      await publishCourse(authorId, collectionId);
      emit({ type: 'data', name: 'publish', payload: { url: lessonUrl } });
    } catch (e: any) {
      emit({ type: 'log', name: 'publish', message: `Publish failed (non-fatal): ${e?.message}` });
    }
    emit({ type: 'stage', name: 'publish', status: 'done' });
  } catch (e: any) {
    emit({ type: 'stage', name: 'save-lesson', status: 'error', message: e?.message });
    emit({ type: 'log', name: 'save-lesson', message: `Educative save failed (non-fatal): ${e?.message}` });
  }
}
