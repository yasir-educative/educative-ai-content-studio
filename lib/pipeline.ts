import { generateText, reviewText, generateTextStream, openaiSearch, parseJsonLoose, TEXT_GENERATOR_MODEL } from './ai';
import {
  outlineSearchPrompt,
  outlineGeneratorPrompt,
  initialTopicSearchPrompt,
  createJsonOutlinePrompt,
  genAiSearchPrompt,
  genAiJsonOutlinePrompt,
  textGeneratorPrompt,
  projectsTextGeneratorPrompt,
  projectsReviewerPrompt,
  mediumDnaAnalysisPrompt,
  cipFinalPassPrompt,
  zachGptReviewPrompt,
  zachGptIncorporatePrompt,
  findSeoKeywordsPrompt,
  seoEditorPrompt,
  codeGeneratorPrompt,
  tableResearchPrompt,
  tableGeneratorPrompt,
  audienceVoiceGuidance,
  prReviewerPrompt,
  newsletterJsonOutlinePrompt,
  newsletterTextGeneratorPrompt,
} from './promptsRegistry';
import { getPersonaBody } from './personaStore';
import {
  sanitizeText,
  extractWidgetTags,
  buildCodeWidget,
  buildTableWidget,
  buildImageWidget,
  mergeWidgets,
} from './transforms';
import {
  markdownToHtml,
  structureOutput,
  sanitizeAndFormat,
  mergeBlocks,
  makeCodeBlock,
  makeTableBlock,
  makeImageBlock,
} from './educative';
import { generateGptImage, extractImageContents, slugify } from './imageGen';

export type StageEvent =
  | { type: 'stage'; name: string; status: 'start' | 'done' | 'error'; message?: string }
  | { type: 'data'; name: string; payload: any }
  | { type: 'log'; name?: string; message: string; payload?: any }
  | { type: 'awaiting-input'; gate: string; payload: any }
  | { type: 'resumed'; gate: string; edited?: boolean }
  | { type: 'stream'; name: string; payload: string }
  | { type: 'stream-content'; payload: string }
  | { type: 'final'; payload: any };

export type Emit = (e: StageEvent) => void;

// Optional pause-gate hook injected by the runner. When the pipeline reaches a user-review
// checkpoint (e.g. outline review), it calls waitForResume(gate, payload) and awaits the value.
// If the user edits the payload in the UI, the resolved value replaces the pipeline's local copy
// before downstream stages consume it. If the hook is absent, the pipeline runs straight through.
export type WaitForResume = (gate: string, payload: any) => Promise<{ value?: any; edited?: boolean }>;

export interface OutlineInput {
  vertical: string;
  blogTitle: string;
  targetAudience: string;
  description: string;
  referenceContent?: string;
}

export async function runOutlinePipeline(input: OutlineInput, emit: Emit): Promise<{ outline: string; research: string }> {
  emit({ type: 'stage', name: 'research', status: 'start' });
  const research = await openaiSearch(outlineSearchPrompt(input.blogTitle));
  emit({ type: 'data', name: 'research', payload: research });
  emit({ type: 'stage', name: 'research', status: 'done' });

  emit({ type: 'stage', name: 'outline', status: 'start' });
  const outline = await generateText(
    outlineGeneratorPrompt({
      vertical: input.vertical,
      blogTitle: input.blogTitle,
      targetAudience: input.targetAudience,
      description: input.description,
      referenceContent: (input.referenceContent || '') + '\n\n' + research,
    }),
    { maxTokens: 8000 }
  );
  emit({ type: 'data', name: 'outline', payload: outline });
  emit({ type: 'stage', name: 'outline', status: 'done' });
  emit({ type: 'final', payload: { outline, research } });
  return { outline, research };
}

export interface BlogInput {
  vertical: string; // "Coding interview patterns" | "Projects" | other
  blogTitle: string;
  outline: string;
  persona: string;
  targetAudience: string; // Beginner | Intermediate | Advanced
  blogSummary: string;
  wordsLength: number;
  seoMode?: 'none' | 'optimize' | 'rewrite';
}

function formatOutlineForDisplay(outline: any): string {
  if (typeof outline === 'string') return outline;
  const title = outline.Title || outline.title || '';
  const theme = outline.Theme || outline.theme || '';
  const summary = outline['Blog summary'] || outline.blogSummary || outline['Newsletter summary'] || '';
  const sections: any[] = outline.outline || outline.sections || [];
  const lines: string[] = [];
  if (title) lines.push(`# ${title}`);
  if (theme) lines.push(`**Theme:** ${theme}`);
  if (summary) lines.push('', summary);
  if (sections.length) {
    lines.push('', '---', '');
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      const heading = s.sectionTitle || s.title || `Section ${i + 1}`;
      const type = s.sectionType || s.type || 'text';
      const body = s.sectionOutline || s.outline || s.description || '';
      const words = s.WordLength || s.wordLength || '';
      if (type === 'image') {
        lines.push(`## [Image] ${heading === 'N/A' ? `Diagram ${i + 1}` : heading}`);
      } else {
        lines.push(`## ${heading}`);
      }
      if (body) lines.push(body);
      if (words && words !== 'N/A') lines.push(`*~${words} words*`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function parseOutlineFromDisplay(text: string): any {
  const lines = text.split('\n');
  const result: any = { Title: '', Theme: '', 'Blog summary': '', outline: [] };
  let inPreamble = true;
  const preambleLines: string[] = [];
  let currentSection: any | null = null;
  let currentBodyLines: string[] = [];

  const flushSection = () => {
    if (!currentSection) return;
    currentSection.sectionOutline = currentBodyLines.join('\n').trim();
    result.outline.push(currentSection);
    currentSection = null;
    currentBodyLines = [];
  };

  for (const line of lines) {
    if (line.startsWith('# ') && inPreamble) {
      result.Title = line.slice(2).trim();
      continue;
    }
    const themeM = line.match(/^\*\*Theme:\*\*\s*(.+)/);
    if (themeM && inPreamble) {
      result.Theme = themeM[1].trim();
      continue;
    }
    if (line.trim() === '---') {
      if (inPreamble) {
        result['Blog summary'] = preambleLines.join('\n').trim();
        inPreamble = false;
      }
      continue;
    }
    if (inPreamble) {
      if (line.trim()) preambleLines.push(line);
      continue;
    }
    if (line.startsWith('## ')) {
      flushSection();
      const heading = line.slice(3).trim();
      const imgM = heading.match(/^\[Image\]\s*(.*)/i);
      if (imgM) {
        currentSection = { sectionTitle: imgM[1].trim() || 'N/A', sectionType: 'image', sectionOutline: '', description: '', WordLength: 'N/A' };
      } else {
        currentSection = { sectionTitle: heading, sectionType: 'text', sectionOutline: '', description: '', WordLength: '' };
      }
      continue;
    }
    if (currentSection) {
      const wM = line.match(/^\*~(.+?)\s*words\*$/);
      if (wM) { currentSection.WordLength = wM[1].trim(); continue; }
      currentBodyLines.push(line);
    }
  }
  flushSection();
  return result;
}

export async function runBlogPipeline(input: BlogInput, emit: Emit, waitForResume?: WaitForResume): Promise<any> {
  const personaPrompt = getPersonaBody(input.persona);
  const isCIP = /coding interview patterns/i.test(input.vertical);
  const isProjects = /projects/i.test(input.vertical);
  // n8n's "If GenAI Vertical" switch — match the AI/ML / Generative AI bucket regardless of label.
  const isGenAI = /generative ai|gen.?ai|ai\s*\/\s*ml|ai-ml|\bai\b.*\bml\b/i.test(input.vertical);
  const wordsLength = String(input.wordsLength ?? '');

  // Per-stage logger — emits to UI (log event) AND console for server-side trace.
  const stageLog = (name: string, prompt: string, inputs: any, output: any) => {
    const entry = { stage: name, prompt, input: inputs, output };
    try {
      console.log(
        `\n========= [stage:${name}] =========\n` +
          `--- prompt (first 400 chars) ---\n${String(prompt).slice(0, 400)}\n` +
          `--- input ---\n${typeof inputs === 'string' ? inputs.slice(0, 400) : JSON.stringify(inputs, null, 2).slice(0, 800)}\n` +
          `--- output (first 400 chars) ---\n${typeof output === 'string' ? output.slice(0, 400) : JSON.stringify(output).slice(0, 800)}\n` +
          `=========`,
      );
    } catch {}
    emit({ type: 'log', name, message: `stage:${name}`, payload: entry });
  };
  console.log(`[pipeline] starting blog | wordsLength=${wordsLength} | persona=${input.persona} | vertical=${input.vertical}`);

  // 1) Topic research — GenAI vertical uses a dedicated R&D agent (different source targets,
  // dual classification, adaptive output sections) per the n8n "If GenAI Vertical" branch.
  emit({ type: 'stage', name: 'topic-research', status: 'start' });
  const trPrompt = isGenAI
    ? genAiSearchPrompt({ blogTitle: input.blogTitle, outline: input.outline })
    : initialTopicSearchPrompt({ blogTitle: input.blogTitle, outline: input.outline });
  const research = await openaiSearch(trPrompt);
  stageLog('topic-research', trPrompt, { blogTitle: input.blogTitle, outline: input.outline, agent: isGenAI ? 'genai-search' : 'initial-topic-search' }, research);
  emit({ type: 'data', name: 'topic-research', payload: research });
  emit({ type: 'stage', name: 'topic-research', status: 'done' });

  // 2) Build JSON outline — GenAI vertical uses a dedicated outline architect that consumes
  // the GenAI researcher's structured sections (Current State / Known Unknowns / Authority Terms / etc.).
  emit({ type: 'stage', name: 'json-outline', status: 'start' });
  const joArgs = {
    vertical: input.vertical,
    blogTitle: input.blogTitle,
    wordsLength,
    personaPrompt,
    userOutline: input.outline || '',
    referenceContent: research,
    extraDetails: `Target audience: ${input.targetAudience}. Blog summary: ${input.blogSummary}`,
  };
  const joPrompt = isGenAI ? genAiJsonOutlinePrompt(joArgs) : createJsonOutlinePrompt(joArgs);
  const jsonOutlineRaw = await generateText(joPrompt, { maxTokens: 8000 });
  stageLog('json-outline', joPrompt, { wordsLength, blogTitle: input.blogTitle, userOutline: input.outline || '(empty)', agent: isGenAI ? 'genai-json-outline' : 'json-outline' }, jsonOutlineRaw);
  let jsonOutline: any;
  try {
    jsonOutline = parseJsonLoose(jsonOutlineRaw);
  } catch {
    jsonOutline = { raw: jsonOutlineRaw };
  }
  emit({ type: 'data', name: 'json-outline', payload: jsonOutline });
  emit({ type: 'stage', name: 'json-outline', status: 'done' });

  // Outline review gate — pause so the user can inspect / edit the outline before drafting.
  // The display version is human-readable markdown; the downstream value stays JSON.
  emit({ type: 'stage', name: 'outline-review', status: 'start' });
  const displayOutline = formatOutlineForDisplay(jsonOutline);
  emit({ type: 'data', name: 'outline-review', payload: displayOutline });
  if (waitForResume) {
    emit({ type: 'awaiting-input', gate: 'outline-review', payload: { display: displayOutline, json: jsonOutline } });
    const GATE_TIMEOUT_MS = 65_000;
    const resumeResult = await Promise.race([
      waitForResume('outline-review', { display: displayOutline, json: jsonOutline }),
      new Promise<{ edited: false }>((r) => setTimeout(() => r({ edited: false }), GATE_TIMEOUT_MS)),
    ]);
    if (resumeResult.edited && resumeResult.value != null) {
      if (typeof resumeResult.value === 'string') {
        try {
          jsonOutline = parseJsonLoose(resumeResult.value);
        } catch {
          jsonOutline = parseOutlineFromDisplay(resumeResult.value);
        }
      } else {
        jsonOutline = resumeResult.value;
      }
      emit({ type: 'data', name: 'outline-review', payload: formatOutlineForDisplay(jsonOutline) });
    }
    emit({ type: 'resumed', gate: 'outline-review', edited: resumeResult.edited });
  }
  emit({ type: 'stage', name: 'outline-review', status: 'done' });

  const outlineString = typeof jsonOutline === 'string' ? jsonOutline : JSON.stringify(jsonOutline, null, 2);

  // 3) Drafting — vertical-specific. Each branch emits its own distinct stage name so the
  // graph/live-tracker can clearly show which path ran:
  //
  //   isProjects → 'projects-text-generator' → 'projects-reviewer'   (TWO agents, no default text-generator)
  //   isCIP      → 'text-generator'          → 'medium-dna' → 'cip-final-pass'
  //   else       → 'text-generator'
  //
  // All three converge on the same `seedDraft` that fans out to the editorial + widget branches.
  const tgInputs = {
    personaPrompt,
    wordsLength,
    vertical: input.vertical,
    targetAudience: audienceVoiceGuidance(input.targetAudience),
    blogSummary: input.blogSummary,
    outlineString,
  };
  let draft: string;
  if (isProjects) {
    // n8n's "Projects: Content generator" + "Projects: Reviewer and Incorporator" — the regular
    // text-generator does NOT run for this vertical.
    emit({ type: 'stage', name: 'projects-text-generator', status: 'start' });
    const tgPrompt = projectsTextGeneratorPrompt(tgInputs);
    const initial = await generateText(tgPrompt, { maxTokens: 16000, noThinking: true });
    stageLog('projects-text-generator', tgPrompt, { wordsLength, vertical: input.vertical, audience: input.targetAudience }, initial);
    emit({ type: 'data', name: 'projects-text-generator', payload: initial });
    emit({ type: 'stage', name: 'projects-text-generator', status: 'done' });

    emit({ type: 'stage', name: 'projects-reviewer', status: 'start' });
    const prPrompt = projectsReviewerPrompt({ personaPrompt, wordsLength, draft: initial });
    draft = await generateText(prPrompt, { maxTokens: 16000, noThinking: true });
    stageLog('projects-reviewer', prPrompt, { wordsLength }, draft);
    emit({ type: 'data', name: 'projects-reviewer', payload: draft });
    emit({ type: 'stage', name: 'projects-reviewer', status: 'done' });
  } else {
    // Default + CIP both start with the standard text-generator. CIP then layers two extra
    // passes on top.
    emit({ type: 'stage', name: 'text-generator', status: 'start' });
    const tgPrompt = textGeneratorPrompt(tgInputs);
    // Heavy drafting stage — pinned to gemini-2.5-pro per project policy. Streamed token-by-token
    // (≈30ms throttle) so the UI can show text appearing live in the text-generator output panel
    // instead of waiting ~minute for the full draft. The runManager treats 'stream' events as
    // ephemeral (only the latest payload is retained for late re-attachers).
    let lastStreamAt = 0;
    const initial = await generateTextStream(
      tgPrompt,
      (_chunk, accumulated) => {
        const now = Date.now();
        if (now - lastStreamAt < 30) return;
        lastStreamAt = now;
        emit({ type: 'stream', name: 'text-generator', payload: accumulated });
      },
      { maxTokens: 16000, model: TEXT_GENERATOR_MODEL },
    );
    // Final flush so UI shows the complete draft (in case last token landed inside the throttle window).
    emit({ type: 'stream', name: 'text-generator', payload: initial });
    stageLog('text-generator', tgPrompt, { wordsLength, vertical: input.vertical, audience: input.targetAudience }, initial);
    emit({ type: 'data', name: 'text-generator', payload: initial });
    emit({ type: 'stage', name: 'text-generator', status: 'done' });

    if (isCIP) {
      emit({ type: 'stage', name: 'medium-dna', status: 'start' });
      const dnaPrompt = mediumDnaAnalysisPrompt(input.blogTitle);
      const dna = await generateText(dnaPrompt, { maxTokens: 4000 });
      stageLog('medium-dna', dnaPrompt, { blogTitle: input.blogTitle }, dna);
      emit({ type: 'data', name: 'medium-dna', payload: dna });
      emit({ type: 'stage', name: 'medium-dna', status: 'done' });

      emit({ type: 'stage', name: 'cip-final-pass', status: 'start' });
      const cipPrompt = cipFinalPassPrompt({
        dna,
        draft: initial,
        blogTitle: input.blogTitle,
        personaPrompt,
        targetAudience: audienceVoiceGuidance(input.targetAudience),
        wordsLength,
      });
      draft = await generateText(cipPrompt, { maxTokens: 16000, noThinking: true });
      stageLog('cip-final-pass', cipPrompt, { wordsLength, blogTitle: input.blogTitle }, draft);
      emit({ type: 'data', name: 'cip-final-pass', payload: draft });
      emit({ type: 'stage', name: 'cip-final-pass', status: 'done' });
    } else {
      draft = initial;
    }
  }
  const seedDraft = sanitizeText(draft)
    // Normalize image tags: the text generator sometimes outputs [image]...[/Caption] without the
    // required [/image] closing tag. This breaks sentinel protection, extractWidgetTags, and
    // mergeWidgets — all of which require the standard [/image] closing. Append it when absent.
    .replace(/(\[image\][\s\S]*?\[\/Caption\])(?!\s*\[\/image\])/gi, '$1[/image]');

  // Protect widget tags from editorial rewrites: replace with opaque sentinels the LLM will not
  // recognise or try to remove. Tokens like WIDGETSENTINEL0TOKEN look like code identifiers —
  // LLMs copy them verbatim. Readable tags like [WIDGET_TABLE_0] look like markdown placeholders
  // and get confidently stripped or expanded by LLMs.
  const sentinelToTag = new Map<string, string>();
  let sentinelCounter = 0;
  const protectedSeed = seedDraft.replace(/\[(code|table|image)\][\s\S]*?\[\/\1\]/g, (m) => {
    const sentinel = `WIDGETSENTINEL${sentinelCounter++}TOKEN`;
    sentinelToTag.set(sentinel, m);
    return sentinel;
  });
  const restoreSentinels = (s: string): string => {
    let out = s;
    for (const [sent, tag] of sentinelToTag) out = out.split(sent).join(tag);
    return out;
  };

  // ============================================================
  //  Two parallel branches off Text Generator:
  //    Branch A — text editorial: ZachGPT → SEO (optional) → PR reviewer → md→HTML → sanitize+format
  //    Branch B — widget builders: extract tags → generate code/table/D2/chart in parallel
  //  Both branches consume the same seedDraft. They join at mergeBlocks below.
  // ============================================================

  const editorialBranch = (async (): Promise<{ draft: string; cleanedHtml: string; title: string }> => {
    let d = protectedSeed;

    emit({ type: 'stage', name: 'zachgpt-review', status: 'start' });
    const zrPrompt = zachGptReviewPrompt(d);
    const feedback = await reviewText(zrPrompt, 8000);
    stageLog('zachgpt-review', zrPrompt, { draft: d.slice(0, 600) + '…' }, feedback);
    emit({ type: 'data', name: 'zachgpt-review', payload: feedback });
    emit({ type: 'stage', name: 'zachgpt-review', status: 'done' });

    emit({ type: 'stage', name: 'zachgpt-incorporate', status: 'start' });
    const ziPrompt = zachGptIncorporatePrompt({ draft: d, feedback, wordsLength });
    const ziOut = await generateText(ziPrompt, { maxTokens: 16000, noThinking: true });
    stageLog('zachgpt-incorporate', ziPrompt, { wordsLength, feedback: feedback.slice(0, 400) + '…' }, ziOut);
    const ziSanitized = sanitizeText(ziOut);
    // Guard: if the incorporate output is suspiciously short or looks like a meta-response (the LLM
    // returning a refusal/placeholder instead of actual blog text), fall back to the original draft.
    d = ziSanitized.length > 300 ? ziSanitized : d;
    emit({ type: 'data', name: 'zachgpt-incorporate', payload: d });
    emit({ type: 'stage', name: 'zachgpt-incorporate', status: 'done' });

    // SEO needed? — IF condition
    if (input.seoMode && input.seoMode !== 'none') {
      emit({ type: 'stage', name: 'seo-keywords', status: 'start' });
      const skPrompt = findSeoKeywordsPrompt({ blogTitle: input.blogTitle, summary: input.blogSummary, audience: input.targetAudience });
      const keywords = await openaiSearch(skPrompt);
      stageLog('seo-keywords', skPrompt, { blogTitle: input.blogTitle, audience: input.targetAudience }, keywords);
      emit({ type: 'data', name: 'seo-keywords', payload: keywords });
      emit({ type: 'stage', name: 'seo-keywords', status: 'done' });

      emit({ type: 'stage', name: 'seo-editor', status: 'start' });
      // seoEditorPrompt expects MODE = STRICT or FLEXIBLE (per n8n). UI uses 'optimize'/'rewrite'.
      const seoModeMapped = input.seoMode === 'rewrite' ? 'FLEXIBLE' : 'STRICT';
      const sePrompt = seoEditorPrompt({
        mode: seoModeMapped,
        blogTitle: input.blogTitle,
        summary: input.blogSummary,
        draft: d,
        finalKeywords: keywords,
        wordsLength,
      });
      const seOut = await generateText(sePrompt, { maxTokens: 16000, noThinking: true });
      // SEO editor returns JSON { updated_blog: "...", seo_analysis: {...} } — extract just the blog text.
      let seoBlog = seOut;
      try {
        const parsed = parseJsonLoose(seOut);
        if (typeof parsed?.updated_blog === 'string' && parsed.updated_blog.length > 100) {
          seoBlog = parsed.updated_blog;
        }
      } catch {}
      // Regex fallback: if parseJsonLoose failed and the raw output still looks like JSON,
      // pull the updated_blog value directly to avoid leaking raw JSON into the article.
      if (seoBlog === seOut && seOut.includes('"updated_blog"')) {
        const m = seOut.match(/"updated_blog"\s*:\s*"([\s\S]+?)"\s*(?:,\s*"seo_analysis"|}\s*$)/);
        if (m && m[1].length > 100) {
          try { seoBlog = JSON.parse(`"${m[1]}"`); } catch {}
        }
      }
      stageLog('seo-editor', sePrompt, { mode: seoModeMapped, uiMode: input.seoMode, wordsLength, keywords }, seoBlog);
      d = sanitizeText(seoBlog);
      emit({ type: 'data', name: 'seo-editor', payload: d });
      emit({ type: 'stage', name: 'seo-editor', status: 'done' });
    }

    // PR reviewer (Audience Based Voice Guidance + final unified proofreader)
    emit({ type: 'stage', name: 'pr-reviewer', status: 'start' });
    const prPrompt = prReviewerPrompt({ content: d, wordsLength: Number(wordsLength) || 1300 });
    const prOut = await reviewText(prPrompt, 16000, true);
    stageLog('pr-reviewer', prPrompt, { wordsLength }, prOut);
    const prSanitized = sanitizeText(prOut);
    // Guard: PR reviewer must output the full blog. If the output is less than half the input length,
    // the model was truncated (usually thinking tokens consumed most of the budget). Fall back to
    // the incorporate output so sentinels and full content are preserved.
    d = prSanitized.length >= d.length * 0.5 ? prSanitized : d;
    emit({ type: 'data', name: 'pr-reviewer', payload: d });
    emit({ type: 'stage', name: 'pr-reviewer', status: 'done' });

    // Restore widget tags from sentinels before HTML conversion so mergeBlocks can find them.
    d = restoreSentinels(d);

    // Markdown → HTML
    emit({ type: 'stage', name: 'markdown-to-html', status: 'start' });
    const rawHtml = markdownToHtml(d);
    stageLog('markdown-to-html', '(marked.parse with gfm:true)', { markdown: d.slice(0, 400) + '…' }, rawHtml.slice(0, 600) + '…');
    emit({ type: 'data', name: 'markdown-to-html', payload: rawHtml });
    emit({ type: 'stage', name: 'markdown-to-html', status: 'done' });

    // Structure the Output (passthrough for parity)
    emit({ type: 'stage', name: 'structure-output', status: 'start' });
    const structured = structureOutput(rawHtml);
    stageLog('structure-output', '(passthrough — preserved for n8n parity)', { html: rawHtml.slice(0, 200) + '…' }, structured.slice(0, 200) + '…');
    emit({ type: 'stage', name: 'structure-output', status: 'done' });

    // Sanitize and format
    emit({ type: 'stage', name: 'sanitize-format', status: 'start' });
    const { cleanedHtml, title } = sanitizeAndFormat({
      html: structured,
      rawMarkdown: d,
      fallbackTitle: input.blogTitle,
    });
    stageLog('sanitize-format', '(transformContent + wrapImagePlaceholders + JSON-escape)', { fallbackTitle: input.blogTitle }, { title, cleanedHtmlPreview: cleanedHtml.slice(0, 600) + '…' });
    emit({ type: 'data', name: 'sanitize-format', payload: { title, cleanedHtml } });
    emit({ type: 'stage', name: 'sanitize-format', status: 'done' });

    return { draft: d, cleanedHtml, title };
  })();

  // -------- Widget branch (extracts from the SAME seed draft) --------
  emit({ type: 'stage', name: 'widgets-extract', status: 'start' });
  const { codes, tables, images } = extractWidgetTags(seedDraft);
  stageLog(
    'widgets-extract',
    '(regex /\\[(code|table|image)\\]…\\[/\\1\\]/g over seedDraft)',
    { seedDraftPreview: seedDraft.slice(0, 800) + '…' },
    {
      codes: codes.map((c) => ({ order: c.order, payloadType: typeof c.payload, preview: typeof c.payload === 'string' ? c.payload.slice(0, 200) : JSON.stringify(c.payload).slice(0, 200) })),
      tables: tables.map((t) => ({ order: t.order, payloadType: typeof t.payload, preview: typeof t.payload === 'string' ? t.payload.slice(0, 200) : JSON.stringify(t.payload).slice(0, 200) })),
      images: images.map((i) => ({ order: i.order, payloadType: typeof i.payload, preview: typeof i.payload === 'string' ? i.payload.slice(0, 200) : JSON.stringify(i.payload).slice(0, 200) })),
    },
  );
  emit({ type: 'data', name: 'widgets-extract', payload: { codes: codes.length, tables: tables.length, images: images.length } });
  emit({ type: 'stage', name: 'widgets-extract', status: 'done' });

  emit({ type: 'stage', name: 'widgets-generate', status: 'start' });
  // IF condition: only run a sub-branch if there are tags of that kind (matches n8n If1 / If2 / image switch)
  // Helper: lifecycle wrapper so each widget sub-call shows as a visible stage with its own input/output tab.
  const subStage = async <T,>(name: string, prompt: string, inputs: any, fn: () => Promise<T>, outputForView?: (r: T) => any): Promise<T> => {
    emit({ type: 'stage', name, status: 'start' });
    try {
      const result = await fn();
      const view = outputForView ? outputForView(result) : result;
      stageLog(name, prompt, inputs, view);
      emit({ type: 'data', name, payload: view });
      emit({ type: 'stage', name, status: 'done' });
      return result;
    } catch (e: any) {
      emit({ type: 'stage', name, status: 'error', message: String(e?.message || e) });
      throw e;
    }
  };

  const codePromises = codes.map(async (b) => {
    const prompt = codeGeneratorPrompt(JSON.stringify(b.payload));
    const out = await subStage(`code-generator#${b.order}`, prompt, b.payload, () =>
      generateText(prompt, { maxTokens: 4000 }),
    );
    return { order: b.order, raw: out, html: buildCodeWidget(out, b.order) };
  });

  const tablePromises = tables.map(async (b) => {
    const refPrompt = tableResearchPrompt(JSON.stringify(b.payload));
    const reference = await subStage(`table-research#${b.order}`, refPrompt, b.payload, () => openaiSearch(refPrompt));
    const prompt = tableGeneratorPrompt({ reference, original: JSON.stringify(b.payload) });
    const out = await subStage(`table-generator#${b.order}`, prompt, { reference, original: b.payload }, () =>
      generateText(prompt, { maxTokens: 4000 }),
    );
    return { order: b.order, raw: out, html: buildTableWidget(out, b.order) };
  });

  // Extract raw [image] content strings for GPT generation
  const imageItems = extractImageContents(seedDraft);
  const blogImgSubfolder = `blogs/${slugify(input.blogTitle)}-${Date.now().toString(36)}`;

  const imagePromises = images.map(async (b, idx) => {
    const item = imageItems[idx] ?? { content: JSON.stringify(b.payload), caption: '' };
    const caption = item.caption;

    // Generate the image and save it locally. Educative CDN upload happens at publish time.
    // Wrap in try/catch so a single image failure doesn't abort the entire pipeline.
    let localUrl: string;
    try {
      const result = await subStage(
        `image-generate#${b.order}`,
        '(gpt-image-2)',
        { content: item.content },
        () => generateGptImage(item.content, b.order, blogImgSubfolder),
        (r) => ({ url: r.url, filename: r.filename }),
      );
      localUrl = result.url;
    } catch (e: any) {
      emit({ type: 'log', name: `image-generate#${b.order}`, message: `Image generation failed, skipping: ${e?.message}` });
      return null;
    }

    return {
      kind: 'gpt' as const,
      order: b.order,
      caption,
      url: localUrl,
      html: buildImageWidget({ url: localUrl, caption }, b.order, 'gpt'),
    };
  });

  // Join: editorial branch + all widget branches run together
  const [editorialResult, codeResults, tableResults, imageResultsRaw] = await Promise.all([
    editorialBranch,
    Promise.all(codePromises),
    Promise.all(tablePromises),
    Promise.all(imagePromises),
  ]);
  const imageResults = imageResultsRaw.filter((r): r is NonNullable<typeof r> => r !== null);
  const codeWidgets = codeResults.map((r) => r.html);
  const tableWidgets = tableResults.map((r) => r.html);
  const imageWidgets = imageResults.map((r) => r.html);
  emit({
    type: 'data',
    name: 'widgets-generate',
    payload: {
      code: codeResults.map((r) => ({ order: r.order, raw: r.raw })),
      table: tableResults.map((r) => ({ order: r.order, raw: r.raw })),
      image: imageResults.map((r) => ({ order: r.order, kind: r.kind, caption: r.caption, url: r.url })),
    },
  });
  emit({ type: 'stage', name: 'widgets-generate', status: 'done' });

  const finalDraft = editorialResult.draft;
  const cleanedHtml = editorialResult.cleanedHtml;
  const cleanTitle = editorialResult.title;

  // editor-blocks is the real fan-in: it consumes cleanedHtml from the editorial branch and the
  // code/table/image widget arrays from the widget branch, and produces the final Educative
  // editor block JSON.
  emit({ type: 'stage', name: 'editor-blocks', status: 'start' });

  // Replace [code/table/image] tags in the draft markdown with rendered widget HTML, then convert
  // the whole thing to clean HTML. markdownToHtml passes block-level HTML through untouched, so
  // the widget <pre>/<figure> blocks survive while the surrounding markdown becomes proper HTML.
  const merged = markdownToHtml(mergeWidgets(finalDraft, [...codeWidgets, ...tableWidgets, ...imageWidgets]));
  // Pass raw LLM text to the makers — they parse n8n's "Language:/Caption:/Code:" / "Table title:" formats.
  const codeEditorBlocks = codeResults.map((r) => makeCodeBlock(r.raw)).filter(Boolean);
  const tableEditorBlocks = tableResults.map((r) => makeTableBlock(r.raw)).filter(Boolean);
  // Build imageBlocks aligned to image extraction order (one per [image] tag, in order).
  const imageEditorBlocks = imageResults.map((r) => makeImageBlock(r.url, r.caption));
  const editorBlocks = mergeBlocks({
    cleanedHtml,
    codeBlocks: codeEditorBlocks,
    tableBlocks: tableEditorBlocks,
    imageBlocks: imageEditorBlocks,
  });
  stageLog(
    'editor-blocks',
    '(mergeBlocks: walk cleanedHtml; replace [code]/[table] in order; replace each <code>[image]…[/image]</code> with the next imageBlocks entry — gpt image, by extraction order)',
    {
      cleanedHtmlPreview: cleanedHtml.slice(0, 600) + '…',
      codeEditorBlocks: codeEditorBlocks.length,
      tableEditorBlocks: tableEditorBlocks.length,
      imageEditorBlocks: imageEditorBlocks.length,
    },
    {
      blockCount: editorBlocks.length,
      types: editorBlocks.map((b: any) => b?.type),
    },
  );
  // n8n-shape merged_widgets (the full final payload — text + widgets, double-stringified inner array exactly like n8n).
  const mergedWidgets = JSON.stringify(editorBlocks);
  emit({
    type: 'data',
    name: 'editor-blocks',
    payload: {
      count: editorBlocks.length,
      types: editorBlocks.map((b: any) => b?.type),
      blocks: editorBlocks,
      merged_widgets: mergedWidgets,
    },
  });
  emit({ type: 'stage', name: 'editor-blocks', status: 'done' });

  const final = {
    title: cleanTitle || input.blogTitle,
    persona: input.persona,
    vertical: input.vertical,
    audience: input.targetAudience,
    markdown: finalDraft,
    html: merged,
    widgets: {
      code: codeWidgets,
      table: tableWidgets,
      image: imageWidgets,
    },
    editorBlocks,
  };
  emit({ type: 'final', payload: final });
  return final;
}

export interface NewsletterInput {
  blogTitle: string;
  targetAudience: string;
  blogSummary: string;
  wordsLength: number;
  seoMode?: 'none' | 'optimize' | 'rewrite';
  outline?: string;
  vertical?: string;
}

export async function runNewsletterPipeline(input: NewsletterInput, emit: Emit, waitForResume?: WaitForResume): Promise<any> {
  const wordsLength = String(input.wordsLength ?? '');
  const vertical = input.vertical || 'Newsletter';

  const stageLog = (name: string, prompt: string, inputs: any, output: any) => {
    const entry = { stage: name, prompt, input: inputs, output };
    try {
      console.log(
        `\n========= [stage:${name}] =========\n` +
          `--- prompt (first 400 chars) ---\n${String(prompt).slice(0, 400)}\n` +
          `--- input ---\n${typeof inputs === 'string' ? inputs.slice(0, 400) : JSON.stringify(inputs, null, 2).slice(0, 800)}\n` +
          `--- output (first 400 chars) ---\n${typeof output === 'string' ? output.slice(0, 400) : JSON.stringify(output).slice(0, 800)}\n` +
          `=========`,
      );
    } catch {}
    emit({ type: 'log', name, message: `stage:${name}`, payload: entry });
  };
  console.log(`[pipeline] starting newsletter | wordsLength=${wordsLength} | title=${input.blogTitle}`);

  // 1) Topic research
  emit({ type: 'stage', name: 'topic-research', status: 'start' });
  const trPrompt = initialTopicSearchPrompt({ blogTitle: input.blogTitle, outline: input.outline || '' });
  const research = await openaiSearch(trPrompt);
  stageLog('topic-research', trPrompt, { blogTitle: input.blogTitle }, research);
  emit({ type: 'data', name: 'topic-research', payload: research });
  emit({ type: 'stage', name: 'topic-research', status: 'done' });

  // 2) JSON outline — newsletter-specific prompt
  emit({ type: 'stage', name: 'json-outline', status: 'start' });
  const joArgs = {
    blogTitle: input.blogTitle,
    vertical,
    targetAudience: input.targetAudience,
    wordsLength,
    userOutline: input.outline || '',
    referenceContent: research,
    extraDetails: input.blogSummary || '',
  };
  const joPrompt = newsletterJsonOutlinePrompt(joArgs);
  const jsonOutlineRaw = await generateText(joPrompt, { maxTokens: 8000 });
  stageLog('json-outline', joPrompt, joArgs, jsonOutlineRaw);
  let jsonOutline: any;
  try { jsonOutline = parseJsonLoose(jsonOutlineRaw); } catch { jsonOutline = { raw: jsonOutlineRaw }; }
  emit({ type: 'data', name: 'json-outline', payload: jsonOutline });
  emit({ type: 'stage', name: 'json-outline', status: 'done' });

  // Outline review gate
  emit({ type: 'stage', name: 'outline-review', status: 'start' });
  const displayOutline = formatOutlineForDisplay(jsonOutline);
  emit({ type: 'data', name: 'outline-review', payload: displayOutline });
  if (waitForResume) {
    emit({ type: 'awaiting-input', gate: 'outline-review', payload: { display: displayOutline, json: jsonOutline } });
    const GATE_TIMEOUT_MS = 65_000;
    const resumeResult = await Promise.race([
      waitForResume('outline-review', { display: displayOutline, json: jsonOutline }),
      new Promise<{ edited: false }>((r) => setTimeout(() => r({ edited: false }), GATE_TIMEOUT_MS)),
    ]);
    if (resumeResult.edited && resumeResult.value != null) {
      if (typeof resumeResult.value === 'string') {
        try {
          jsonOutline = parseJsonLoose(resumeResult.value);
        } catch {
          jsonOutline = parseOutlineFromDisplay(resumeResult.value);
        }
      } else {
        jsonOutline = resumeResult.value;
      }
      emit({ type: 'data', name: 'outline-review', payload: formatOutlineForDisplay(jsonOutline) });
    }
    emit({ type: 'resumed', gate: 'outline-review', edited: resumeResult.edited });
  }
  emit({ type: 'stage', name: 'outline-review', status: 'done' });

  const outlineSections: any[] = Array.isArray(jsonOutline?.outline) ? jsonOutline.outline : [];
  const outlineString = outlineSections.length
    ? outlineSections.map((s: any) =>
        `# Section Title: ${s.sectionTitle}\nType: ${s.sectionType}\nDescription: ${s.description ?? ''}\nOutline: ${s.sectionOutline}\nWordLength: ${s.WordLength}`
      ).join('\n\n')
    : (typeof jsonOutline === 'string' ? jsonOutline : JSON.stringify(jsonOutline, null, 2));
  const outlineSummary = jsonOutline?.['Newsletter summary'] || jsonOutline?.['Blog summary'] || input.blogSummary;

  // 3) Text generation — newsletter-specific prompt, no persona, straight through
  emit({ type: 'stage', name: 'text-generator', status: 'start' });
  const tgPrompt = newsletterTextGeneratorPrompt({
    blogTitle: input.blogTitle,
    wordsLength,
    vertical,
    targetAudience: audienceVoiceGuidance(input.targetAudience),
    blogSummary: outlineSummary,
    outlineString,
  });
  let lastStreamAt = 0;
  const initial = await generateTextStream(
    tgPrompt,
    (_chunk, accumulated) => {
      const now = Date.now();
      if (now - lastStreamAt < 30) return;
      lastStreamAt = now;
      emit({ type: 'stream', name: 'text-generator', payload: accumulated });
    },
    { maxTokens: 16000, model: TEXT_GENERATOR_MODEL },
  );
  emit({ type: 'stream', name: 'text-generator', payload: initial });
  stageLog('text-generator', tgPrompt, { wordsLength, audience: input.targetAudience }, initial);
  emit({ type: 'data', name: 'text-generator', payload: initial });
  emit({ type: 'stage', name: 'text-generator', status: 'done' });

  const seedDraft = sanitizeText(initial)
    .replace(/(\[image\][\s\S]*?\[\/Caption\])(?!\s*\[\/image\])/gi, '$1[/image]');

  // Sentinel protection
  const sentinelToTag = new Map<string, string>();
  let sentinelCounter = 0;
  const protectedSeed = seedDraft.replace(/\[(code|table|image)\][\s\S]*?\[\/\1\]/g, (m) => {
    const sentinel = `WIDGETSENTINEL${sentinelCounter++}TOKEN`;
    sentinelToTag.set(sentinel, m);
    return sentinel;
  });
  const restoreSentinels = (s: string): string => {
    let out = s;
    for (const [sent, tag] of sentinelToTag) out = out.split(sent).join(tag);
    return out;
  };

  // Editorial + widget branches (same as blog pipeline)
  const editorialBranch = (async (): Promise<{ draft: string; cleanedHtml: string; title: string }> => {
    let d = protectedSeed;

    emit({ type: 'stage', name: 'zachgpt-review', status: 'start' });
    const zrPrompt = zachGptReviewPrompt(d);
    const feedback = await reviewText(zrPrompt, 8000);
    stageLog('zachgpt-review', zrPrompt, { draft: d.slice(0, 600) + '…' }, feedback);
    emit({ type: 'data', name: 'zachgpt-review', payload: feedback });
    emit({ type: 'stage', name: 'zachgpt-review', status: 'done' });

    emit({ type: 'stage', name: 'zachgpt-incorporate', status: 'start' });
    const ziPrompt = zachGptIncorporatePrompt({ draft: d, feedback, wordsLength });
    const ziOut = await generateText(ziPrompt, { maxTokens: 16000, noThinking: true });
    stageLog('zachgpt-incorporate', ziPrompt, { wordsLength }, ziOut);
    const ziSanitized = sanitizeText(ziOut);
    d = ziSanitized.length > 300 ? ziSanitized : d;
    emit({ type: 'data', name: 'zachgpt-incorporate', payload: d });
    emit({ type: 'stage', name: 'zachgpt-incorporate', status: 'done' });

    if (input.seoMode && input.seoMode !== 'none') {
      emit({ type: 'stage', name: 'seo-keywords', status: 'start' });
      const skPrompt = findSeoKeywordsPrompt({ blogTitle: input.blogTitle, summary: input.blogSummary, audience: input.targetAudience });
      const keywords = await openaiSearch(skPrompt);
      stageLog('seo-keywords', skPrompt, { blogTitle: input.blogTitle }, keywords);
      emit({ type: 'data', name: 'seo-keywords', payload: keywords });
      emit({ type: 'stage', name: 'seo-keywords', status: 'done' });

      emit({ type: 'stage', name: 'seo-editor', status: 'start' });
      const seoModeMapped = input.seoMode === 'rewrite' ? 'FLEXIBLE' : 'STRICT';
      const sePrompt = seoEditorPrompt({ mode: seoModeMapped, blogTitle: input.blogTitle, summary: input.blogSummary, draft: d, finalKeywords: keywords, wordsLength });
      const seOut = await generateText(sePrompt, { maxTokens: 16000, noThinking: true });
      let seoBlog = seOut;
      try {
        const parsed = parseJsonLoose(seOut);
        if (typeof parsed?.updated_blog === 'string' && parsed.updated_blog.length > 100) seoBlog = parsed.updated_blog;
      } catch {}
      if (seoBlog === seOut && seOut.includes('"updated_blog"')) {
        const m = seOut.match(/"updated_blog"\s*:\s*"([\s\S]+?)"\s*(?:,\s*"seo_analysis"|}\s*$)/);
        if (m && m[1].length > 100) { try { seoBlog = JSON.parse(`"${m[1]}"`); } catch {} }
      }
      stageLog('seo-editor', sePrompt, { mode: seoModeMapped }, seoBlog);
      d = sanitizeText(seoBlog);
      emit({ type: 'data', name: 'seo-editor', payload: d });
      emit({ type: 'stage', name: 'seo-editor', status: 'done' });
    }

    emit({ type: 'stage', name: 'pr-reviewer', status: 'start' });
    const prPrompt = prReviewerPrompt({ content: d, wordsLength: Number(wordsLength) || 1300 });
    const prOut = await reviewText(prPrompt, 16000, true);
    stageLog('pr-reviewer', prPrompt, { wordsLength }, prOut);
    const prSanitized = sanitizeText(prOut);
    d = prSanitized.length >= d.length * 0.5 ? prSanitized : d;
    emit({ type: 'data', name: 'pr-reviewer', payload: d });
    emit({ type: 'stage', name: 'pr-reviewer', status: 'done' });

    d = restoreSentinels(d);

    emit({ type: 'stage', name: 'markdown-to-html', status: 'start' });
    const rawHtml = markdownToHtml(d);
    emit({ type: 'data', name: 'markdown-to-html', payload: rawHtml });
    emit({ type: 'stage', name: 'markdown-to-html', status: 'done' });

    emit({ type: 'stage', name: 'structure-output', status: 'start' });
    const structured = structureOutput(rawHtml);
    emit({ type: 'stage', name: 'structure-output', status: 'done' });

    emit({ type: 'stage', name: 'sanitize-format', status: 'start' });
    const { cleanedHtml, title } = sanitizeAndFormat({ html: structured, rawMarkdown: d, fallbackTitle: input.blogTitle });
    emit({ type: 'data', name: 'sanitize-format', payload: { title, cleanedHtml } });
    emit({ type: 'stage', name: 'sanitize-format', status: 'done' });

    return { draft: d, cleanedHtml, title };
  })();

  emit({ type: 'stage', name: 'widgets-extract', status: 'start' });
  const { codes, tables, images } = extractWidgetTags(seedDraft);
  emit({ type: 'data', name: 'widgets-extract', payload: { codes: codes.length, tables: tables.length, images: images.length } });
  emit({ type: 'stage', name: 'widgets-extract', status: 'done' });

  emit({ type: 'stage', name: 'widgets-generate', status: 'start' });
  const subStage = async <T,>(name: string, prompt: string, inputs: any, fn: () => Promise<T>, outputForView?: (r: T) => any): Promise<T> => {
    emit({ type: 'stage', name, status: 'start' });
    try {
      const result = await fn();
      const view = outputForView ? outputForView(result) : result;
      stageLog(name, prompt, inputs, view);
      emit({ type: 'data', name, payload: view });
      emit({ type: 'stage', name, status: 'done' });
      return result;
    } catch (e: any) {
      emit({ type: 'stage', name, status: 'error', message: String(e?.message || e) });
      throw e;
    }
  };

  const codePromises = codes.map(async (b) => {
    const prompt = codeGeneratorPrompt(JSON.stringify(b.payload));
    const out = await subStage(`code-generator#${b.order}`, prompt, b.payload, () => generateText(prompt, { maxTokens: 4000 }));
    return { order: b.order, raw: out, html: buildCodeWidget(out, b.order) };
  });

  const tablePromises = tables.map(async (b) => {
    const refPrompt = tableResearchPrompt(JSON.stringify(b.payload));
    const reference = await subStage(`table-research#${b.order}`, refPrompt, b.payload, () => openaiSearch(refPrompt));
    const prompt = tableGeneratorPrompt({ reference, original: JSON.stringify(b.payload) });
    const out = await subStage(`table-generator#${b.order}`, prompt, { reference, original: b.payload }, () => generateText(prompt, { maxTokens: 4000 }));
    return { order: b.order, raw: out, html: buildTableWidget(out, b.order) };
  });

  const imageItems = extractImageContents(seedDraft);
  const newsletterImgSubfolder = `newsletters/${slugify(input.blogTitle)}-${Date.now().toString(36)}`;

  const imagePromises = images.map(async (b, idx) => {
    const item = imageItems[idx] ?? { content: JSON.stringify(b.payload), caption: '' };
    let localUrl: string;
    try {
      const result = await subStage(
        `image-generate#${b.order}`,
        '(gpt-image-2)',
        { content: item.content },
        () => generateGptImage(item.content, b.order, newsletterImgSubfolder),
        (r) => ({ url: r.url, filename: r.filename }),
      );
      localUrl = result.url;
    } catch (e: any) {
      emit({ type: 'log', name: `image-generate#${b.order}`, message: `Image generation failed, skipping: ${e?.message}` });
      return null;
    }
    return { kind: 'gpt' as const, order: b.order, caption: item.caption, url: localUrl, html: buildImageWidget({ url: localUrl, caption: item.caption }, b.order, 'gpt') };
  });

  const [editorialResult, codeResults, tableResults, imageResultsRaw] = await Promise.all([
    editorialBranch,
    Promise.all(codePromises),
    Promise.all(tablePromises),
    Promise.all(imagePromises),
  ]);
  const imageResults = imageResultsRaw.filter((r): r is NonNullable<typeof r> => r !== null);
  const codeWidgets = codeResults.map((r) => r.html);
  const tableWidgets = tableResults.map((r) => r.html);
  const imageWidgets = imageResults.map((r) => r.html);
  emit({ type: 'data', name: 'widgets-generate', payload: { code: codeResults.map((r) => ({ order: r.order, raw: r.raw })), table: tableResults.map((r) => ({ order: r.order, raw: r.raw })), image: imageResults.map((r) => ({ order: r.order, kind: r.kind, caption: r.caption, url: r.url })) } });
  emit({ type: 'stage', name: 'widgets-generate', status: 'done' });

  const finalDraft = editorialResult.draft;
  const cleanedHtml = editorialResult.cleanedHtml;
  const cleanTitle = editorialResult.title;

  emit({ type: 'stage', name: 'editor-blocks', status: 'start' });
  const merged = markdownToHtml(mergeWidgets(finalDraft, [...codeWidgets, ...tableWidgets, ...imageWidgets]));
  const codeEditorBlocks = codeResults.map((r) => makeCodeBlock(r.raw)).filter(Boolean);
  const tableEditorBlocks = tableResults.map((r) => makeTableBlock(r.raw)).filter(Boolean);
  const imageEditorBlocks = imageResults.map((r) => makeImageBlock(r.url, r.caption));
  const editorBlocks = mergeBlocks({ cleanedHtml, codeBlocks: codeEditorBlocks, tableBlocks: tableEditorBlocks, imageBlocks: imageEditorBlocks });
  emit({ type: 'data', name: 'editor-blocks', payload: { count: editorBlocks.length, types: editorBlocks.map((b: any) => b?.type), blocks: editorBlocks, merged_widgets: JSON.stringify(editorBlocks) } });
  emit({ type: 'stage', name: 'editor-blocks', status: 'done' });

  const final = {
    title: cleanTitle || input.blogTitle,
    persona: '',
    vertical,
    audience: input.targetAudience,
    markdown: finalDraft,
    html: merged,
    widgets: { code: codeWidgets, table: tableWidgets, image: imageWidgets },
    editorBlocks,
  };
  emit({ type: 'final', payload: final });
  return final;
}
