// Central wiring of prompt functions through the file-backed registry.
//
// Every pure-template prompt in lib/prompts.ts gets wrapped here with `registerPrompt(name, fn)`.
// The wrapped version preserves the original signature, but at call time it loads any user-edited
// body from data/prompts/{name}.json and substitutes `{{var}}` placeholders. Pipeline code imports
// from this module instead of './prompts' so edits in the UI take effect without code changes.
//
// `audienceVoiceGuidance` is intentionally NOT wrapped — it has branching logic and can't be
// reduced to a static template. It's re-exported as-is.

import { registerPrompt } from './promptStore';
import * as P from './prompts';

// --- Outline pipeline ---
export const outlineSearchPrompt = registerPrompt('outline-search', P.outlineSearchPrompt, 'outline');
export const outlineGeneratorPrompt = registerPrompt('outline-generator', P.outlineGeneratorPrompt, 'outline');

// --- Shared (research, outline, editorial) ---
export const initialTopicSearchPrompt = registerPrompt('initial-topic-search', P.initialTopicSearchPrompt, 'shared');
export const createJsonOutlinePrompt = registerPrompt('json-outline', P.createJsonOutlinePrompt, 'shared');
export const genAiSearchPrompt = registerPrompt('genai-search', P.genAiSearchPrompt, 'shared');
export const genAiJsonOutlinePrompt = registerPrompt('genai-json-outline', P.genAiJsonOutlinePrompt, 'shared');
export const mediumDnaAnalysisPrompt = registerPrompt('medium-dna-analysis', P.mediumDnaAnalysisPrompt, 'shared');
export const cipFinalPassPrompt = registerPrompt('cip-final-pass', P.cipFinalPassPrompt, 'shared');
export const projectsTextGeneratorPrompt = registerPrompt('projects-text-generator', P.projectsTextGeneratorPrompt, 'shared');
export const projectsReviewerPrompt = registerPrompt('projects-reviewer', P.projectsReviewerPrompt, 'shared');
export const zachGptReviewPrompt = registerPrompt('zachgpt-review', P.zachGptReviewPrompt, 'shared');
export const zachGptIncorporatePrompt = registerPrompt('zachgpt-incorporate', P.zachGptIncorporatePrompt, 'shared');
export const findSeoKeywordsPrompt = registerPrompt('seo-keywords', P.findSeoKeywordsPrompt, 'shared');
export const seoEditorPrompt = registerPrompt('seo-editor', P.seoEditorPrompt, 'shared');
export const prReviewerPrompt = registerPrompt('pr-reviewer', P.prReviewerPrompt, 'shared');

// --- Blog pipeline only (widgets, Educative) ---
export const textGeneratorPrompt = registerPrompt('text-generator', P.textGeneratorPrompt, 'blog');
export const codeGeneratorPrompt = registerPrompt('code-generator', P.codeGeneratorPrompt, 'blog');
export const tableResearchPrompt = registerPrompt('table-research', P.tableResearchPrompt, 'blog');
export const tableGeneratorPrompt = registerPrompt('table-generator', P.tableGeneratorPrompt, 'blog');

// --- Newsletter pipeline ---
export const newsletterJsonOutlinePrompt = registerPrompt('newsletter-json-outline', P.newsletterJsonOutlinePrompt, 'newsletter');
export const newsletterTextGeneratorPrompt = registerPrompt('newsletter-text-generator', P.newsletterTextGeneratorPrompt, 'newsletter');

// Branching logic — cannot be template-extracted. Re-exported as-is so pipeline can use it.
export const audienceVoiceGuidance = P.audienceVoiceGuidance;

// --- Course pipeline (triggers registration on import) ---
export * from './coursePromptsRegistry';

// --- Mobile Course pipeline ---
export * from './mobileCoursePromptsRegistry';

// --- Mobile Short pipeline ---
export * from './mobileShortsPromptsRegistry';
