import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { slugify } from './imageGen';

const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');

export type MobileCardType =
  | 'text'
  | 'text_img'
  | 'img_only'
  | 'text-with-code'
  | 'code-with-output'
  | 'comparisonCards'
  | 'recapCard'
  | 'quiz'
  | 'trueFalseCard'
  | 'fillInTheBlank'
  | 'scenarioCard'
  | 'highlightCard';

export interface MobileCard {
  id: string;
  type: MobileCardType;
  card_number?: number;
  title?: string;
  // text, text_img
  text?: string;
  // text_img, img_only — image generation fields
  illustration_idea?: string;
  visible_labels?: string;
  imageUrl?: string;
  // img_only
  img_context?: string;
  // text-with-code
  text_1?: string;
  text_2?: string;
  language?: string;
  code?: string;
  // code-with-output
  output_available?: boolean;
  output?: string;
  // comparisonCards
  heading?: string;
  leftOption?: { label: string; heading: string; description: string };
  rightOption?: { label: string; heading: string; description: string };
  // recapCard: content: [{heading, text}]
  content?: Array<{ heading: string; text: string }>;
  // quiz
  question?: string;
  options?: Array<{ id: number; text: string }> | string[];
  correctAnswer?: number | string;
  incorrectMessage?: string;
  // trueFalseCard
  explanation?: string;
  // fillInTheBlank
  correctOptions?: string[];
  // scenarioCard
  sections?: Array<{ heading: string; content: string }>;
  scenarioType?: string;
  // highlightCard
  highlightCardType?: 'key-insight' | 'point-to-ponder' | 'bigger-picture';
  // publish state
  pageId?: string;
  publishedUrl?: string;
}

export interface MobileChapter {
  id: string;
  title: string;
  cards: MobileCard[];
  status: 'pending' | 'processing' | 'done' | 'failed';
  errorMessage?: string;
}

export type MobileCourseStatus = 'running' | 'draft' | 'published' | 'failed' | 'cancelled';

export interface MobileCourse {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: MobileCourseStatus;
  title: string;
  collectionId: string;
  authorId: string;
  targetCollectionId?: string;
  chapters: MobileChapter[];
  stageOutputs?: Record<string, any>;
  errorMessage?: string;
  publishedUrl?: string;
}

export interface MobileCourseSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: MobileCourseStatus;
  title: string;
  collectionId: string;
  chapterCount: number;
  cardCount: number;
  publishedUrl?: string;
}

const DATA_DIR = path.join(process.cwd(), 'data', 'mobile-courses');

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function filePath(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`invalid mobile course id: ${id}`);
  return path.join(DATA_DIR, `${id}.json`);
}

export function newMobileCourseId(): string {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(6).toString('hex');
  return `mc-${ts}-${rand}`;
}

export async function saveMobileCourse(course: MobileCourse): Promise<void> {
  await ensureDir();
  const tmp = filePath(course.id) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(course, null, 2), 'utf8');
  await fs.rename(tmp, filePath(course.id));
}

export async function getMobileCourse(id: string): Promise<MobileCourse | null> {
  try {
    const buf = await fs.readFile(filePath(id), 'utf8');
    return JSON.parse(buf) as MobileCourse;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

export async function updateMobileCourse(
  id: string,
  patch: Partial<MobileCourse>,
): Promise<MobileCourse | null> {
  const existing = await getMobileCourse(id);
  if (!existing) return null;
  const merged: MobileCourse = {
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: new Date().toISOString(),
  };
  await saveMobileCourse(merged);
  return merged;
}

export async function deleteMobileCourse(id: string): Promise<boolean> {
  try {
    await fs.unlink(filePath(id));
  } catch (e: any) {
    if (e?.code === 'ENOENT') return false;
    throw e;
  }
  try {
    await fs.rm(path.join(IMAGES_DIR, 'mobile-courses', slugify(id)), { recursive: true, force: true });
  } catch {
    // images may not exist — ignore
  }
  return true;
}

export async function listMobileCourses(): Promise<MobileCourseSummary[]> {
  await ensureDir();
  const entries = await fs.readdir(DATA_DIR);
  const summaries: MobileCourseSummary[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    try {
      const buf = await fs.readFile(path.join(DATA_DIR, name), 'utf8');
      const c = JSON.parse(buf) as MobileCourse;
      const cardCount = c.chapters.reduce((sum, ch) => sum + (ch.cards?.length || 0), 0);
      summaries.push({
        id: c.id,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        status: c.status,
        title: c.title,
        collectionId: c.collectionId,
        chapterCount: c.chapters.length,
        cardCount,
        publishedUrl: c.publishedUrl,
      });
    } catch {
      // skip corrupt files
    }
  }
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return summaries;
}
