// Stage → model-tier map.
//
// One source of truth for "which model does this stage run on", used by three things that would
// otherwise drift apart: the pipelines' `tier:` tags, the /models settings page, and the model
// name printed into each stage's debug log.
//
// Keep this in sync with the `tier:` arguments in the pipelines — `npm run check:tiers`-style
// auditing is done by scripts/check-tiers.js.

import { resolveModel, type ModelTier } from './modelStore';

/** 'search' and 'image' are fixed capabilities, not part of the two configurable tiers. */
export type StageTier = ModelTier | 'search' | 'image';

export const STAGE_TIERS: Record<string, StageTier> = {
  // ── Research (web search) ──
  'research': 'search',
  'topic-research': 'search',
  'web-research': 'search',
  'seo-keywords': 'search',
  'table-research': 'search',
  'topic-detailer': 'search',

  // ── Main: outline architects ──
  'outline': 'main',
  'json-outline': 'main',
  'genai-json-outline': 'main',
  'architect': 'main',
  'card-planner': 'main',

  // ── Main: text generators ──
  'text-generator': 'main',
  'technical-blog-text-generator': 'main',
  'projects-text-generator': 'main',
  'projects-reviewer': 'main',
  'cip-final-pass': 'main',
  'content-creator': 'main',
  'cards-generator': 'main',

  // ── Normal: reviewers, rewriters, widget builders, normalisers ──
  'medium-dna': 'normal',
  'zachgpt-review': 'normal',
  'zachgpt-incorporate': 'normal',
  'seo-editor': 'normal',
  'pr-reviewer': 'normal',
  'code-generator': 'normal',
  'table-generator': 'normal',
  'summary-elements': 'normal',
  'widget-code': 'normal',
  'widget-table': 'normal',
  'widget-runjs': 'normal',
  'text-refiner': 'normal',
  'json-generator': 'normal',

  // ── Image generation ──
  'image-generate': 'image',
  'widget-images': 'image',
  'images': 'image',
};

const IMAGE_MODEL = 'gpt-image-2';

/**
 * The tier a stage runs on.
 *
 * Handles the per-widget suffixes the pipelines emit (`code-generator#2`) and the mobile-course
 * chapter prefixes (`ch3-cards-generator`). Stages with no LLM call — transforms, gates, saves —
 * return null so the log shows nothing rather than a misleading model name.
 */
export function tierForStage(stageName: string): StageTier | null {
  const base = stageName.split('#')[0];
  if (STAGE_TIERS[base]) return STAGE_TIERS[base];
  // Mobile course prefixes each stage with its chapter id.
  const suffix = Object.keys(STAGE_TIERS).find((k) => base.endsWith(`-${k}`));
  return suffix ? STAGE_TIERS[suffix] : null;
}

/** The concrete model a stage will use, for display and debug logs. */
export function modelForStage(stageName: string): string | null {
  const tier = tierForStage(stageName);
  if (!tier) return null;
  if (tier === 'image') return IMAGE_MODEL;
  if (tier === 'search') return process.env.OPENAI_SEARCH_MODEL || 'gpt-5-search-api';
  return resolveModel(tier);
}
