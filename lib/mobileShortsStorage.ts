import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

import { MobileCard } from './mobileCourseStorage';
import { slugify } from './imageGen';

const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');

export type MobileShortStatus = 'running' | 'draft' | 'published' | 'failed' | 'cancelled';

export interface MobileShort {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: MobileShortStatus;
  topic: string;
  domain?: string;
  level?: string;
  objective?: string;
  additionalContext?: string;
  isHighlightCardNeeded?: boolean;
  numCards?: number;
  collectionId?: string;
  authorId: string;
  cards: MobileCard[];
  stageOutputs?: Record<string, any>;
  errorMessage?: string;
  publishedUrl?: string;
}

export interface MobileShortSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: MobileShortStatus;
  topic: string;
  collectionId?: string;
  cardCount: number;
  publishedUrl?: string;
}

const DATA_DIR = path.join(process.cwd(), 'data', 'mobile-shorts');

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function filePath(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`invalid mobile short id: ${id}`);
  return path.join(DATA_DIR, `${id}.json`);
}

export function newMobileShortId(): string {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(6).toString('hex');
  return `ms-${ts}-${rand}`;
}

export async function saveMobileShort(short: MobileShort): Promise<void> {
  await ensureDir();
  const tmp = filePath(short.id) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(short, null, 2), 'utf8');
  await fs.rename(tmp, filePath(short.id));
}

export async function getMobileShort(id: string): Promise<MobileShort | null> {
  try {
    const buf = await fs.readFile(filePath(id), 'utf8');
    return JSON.parse(buf) as MobileShort;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

export async function updateMobileShort(
  id: string,
  patch: Partial<MobileShort>,
): Promise<MobileShort | null> {
  const existing = await getMobileShort(id);
  if (!existing) return null;
  const merged: MobileShort = {
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: new Date().toISOString(),
  };
  await saveMobileShort(merged);
  return merged;
}

export async function deleteMobileShort(id: string): Promise<boolean> {
  try {
    await fs.unlink(filePath(id));
  } catch (e: any) {
    if (e?.code === 'ENOENT') return false;
    throw e;
  }
  try {
    await fs.rm(path.join(IMAGES_DIR, 'mobile-shorts', slugify(id)), { recursive: true, force: true });
  } catch {
    // images may not exist — ignore
  }
  return true;
}

export async function listMobileShorts(): Promise<MobileShortSummary[]> {
  await ensureDir();
  const entries = await fs.readdir(DATA_DIR);
  const summaries: MobileShortSummary[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    try {
      const buf = await fs.readFile(path.join(DATA_DIR, name), 'utf8');
      const s = JSON.parse(buf) as MobileShort;
      summaries.push({
        id: s.id,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        status: s.status,
        topic: s.topic,
        collectionId: s.collectionId,
        cardCount: s.cards?.length || 0,
        publishedUrl: s.publishedUrl,
      });
    } catch {
      // skip corrupt files
    }
  }
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return summaries;
}
