// Model tier configuration.
//
// Every LLM agent in every pipeline runs on one of two configurable models:
//
//   main   — the outline architects and the text generators. These decide the article's
//            structure and write its prose, so they carry the quality of the output.
//   normal — everything else: reviewers, rewriters, widget builders, format normalisers.
//
// The web-search model is deliberately NOT part of this. It is a different capability with its
// own endpoint and stays pinned to OPENAI_SEARCH_MODEL in the environment.
//
// Stored at data/models.json so a change takes effect without a redeploy. Env vars remain the
// defaults for a fresh checkout.

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import path from 'path';

export type ModelTier = 'main' | 'normal' | 'edit';

export interface ModelConfig {
  mainModel: string;
  normalModel: string;
  /** Used by the editor's "Ask AI" rewrite of a selection. */
  editModel: string;
  updatedAt?: string;
}

const DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DIR, 'models.json');

/** Defaults come from env so an unconfigured install behaves exactly as before. */
export function defaultConfig(): ModelConfig {
  return {
    mainModel: process.env.OPENAI_MODEL_TEXTGEN || process.env.OPENAI_MODEL_DEFAULT || 'gpt-5.4',
    normalModel: process.env.OPENAI_MODEL_LIGHT || 'gpt-5.4-mini',
    // Interactive edits are short and want a fast, focused model.
    editModel: process.env.OPENAI_MODEL_EDIT || 'gpt-6-luna',
  };
}

// Cached so the hot path (every LLM call) is not a disk read. Invalidated on save, and on a
// file whose mtime moved — which covers an edit made by another process.
let cache: { config: ModelConfig; mtimeMs: number } | null = null;

export function getModelConfig(): ModelConfig {
  try {
    const { mtimeMs } = require('fs').statSync(FILE);
    if (cache && cache.mtimeMs === mtimeMs) return cache.config;
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<ModelConfig>;
    const d = defaultConfig();
    const config: ModelConfig = {
      mainModel: (parsed.mainModel || '').trim() || d.mainModel,
      normalModel: (parsed.normalModel || '').trim() || d.normalModel,
      editModel: (parsed.editModel || '').trim() || d.editModel,
      updatedAt: parsed.updatedAt,
    };
    cache = { config, mtimeMs };
    return config;
  } catch {
    // No file yet, or unreadable — fall back to env.
    return defaultConfig();
  }
}

export function saveModelConfig(patch: Partial<ModelConfig>): ModelConfig {
  const current = getModelConfig();
  const next: ModelConfig = {
    mainModel: (patch.mainModel || '').trim() || current.mainModel,
    normalModel: (patch.normalModel || '').trim() || current.normalModel,
    editModel: (patch.editModel || '').trim() || current.editModel,
    updatedAt: new Date().toISOString(),
  };
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  renameSync(tmp, FILE);
  cache = null;
  return next;
}

/** Reset to the environment defaults by removing the override file. */
export function resetModelConfig(): ModelConfig {
  try {
    require('fs').unlinkSync(FILE);
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e;
  }
  cache = null;
  return defaultConfig();
}

export function resolveModel(tier: ModelTier): string {
  const c = getModelConfig();
  if (tier === 'main') return c.mainModel;
  if (tier === 'edit') return c.editModel;
  return c.normalModel;
}
