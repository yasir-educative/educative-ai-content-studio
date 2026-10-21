// Saved AI analyses, keyed by Jira issue key.
//
// Drafting a reply costs a model call and, when the lesson is read, a fetch of
// the whole page. Reopening a query should show what was produced last time
// rather than silently spending that again.

import { promises as fs, existsSync, readFileSync } from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'jira-analyses.json');

export interface SavedAnalysis {
  key: string;
  reply: string;
  category?: 'content' | 'not-content';
  usedLesson: boolean;
  needsManualReview: boolean;
  imagesRead: number;
  reason?: string;
  lessonTitle?: string;
  lessonUrl?: string;
  warning?: string;
  /** Set when a human edited the draft before saving. */
  edited?: boolean;
  savedAt: string;
}

function readAll(): Record<string, SavedAnalysis> {
  try {
    if (!existsSync(FILE)) return {};
    const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getAnalysis(key: string): SavedAnalysis | null {
  return readAll()[key] || null;
}

export async function saveAnalysis(a: Omit<SavedAnalysis, 'savedAt'>): Promise<SavedAnalysis> {
  if (!a.key) throw new Error('issue key is required');
  const all = readAll();
  const saved: SavedAnalysis = { ...a, savedAt: new Date().toISOString() };
  all[a.key] = saved;
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), 'utf8');
  return saved;
}

export async function deleteAnalysis(key: string): Promise<void> {
  const all = readAll();
  if (!(key in all)) return;
  delete all[key];
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), 'utf8');
}

/** Keys that already have a saved reply, so the list can mark them. */
export function savedKeys(): string[] {
  return Object.keys(readAll());
}
