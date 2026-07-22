// Filesystem-backed history store for generated blogs.
// One JSON file per run under data/blogs/{id}.json. No external deps — easy to inspect, easy to delete.

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');

export type BlogStatus = 'running' | 'draft' | 'published' | 'failed' | 'cancelled';

export interface SavedBlog {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: BlogStatus;
  runType?: 'blog' | 'newsletter' | 'course';
  // request inputs (so the run is reproducible)
  request: {
    vertical: string;
    blogTitle: string;
    persona: string;
    targetAudience: string;
    blogSummary: string;
    wordsLength: number;
    seoMode: string;
    outline?: string;
    // course-specific
    chapterTitle?: string;
    courseTitle?: string;
    authorId?: string;
    collectionId?: string;
  };
  coursePageId?: string;
  // pipeline outputs
  finalTitle?: string;
  markdown?: string;
  html?: string;
  editorBlocks?: any[];
  widgets?: { code?: any[]; table?: any[]; image?: any[] };
  // pipeline trace for re-rendering StageOutputs on the detail page
  stageOutputs?: Record<string, any>;
  stageLogs?: Record<string, any[]>;
  // publish state
  publishedUrl?: string;
  publishedAt?: string;
  errorMessage?: string;
}

export interface BlogSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: BlogStatus;
  runType?: 'blog' | 'newsletter' | 'course';
  blogTitle: string;
  finalTitle?: string;
  persona: string;
  vertical: string;
  audience: string;
  publishedUrl?: string;
  // course-specific
  chapterTitle?: string;
  courseTitle?: string;
}

const DATA_DIR = path.join(process.cwd(), 'data', 'blogs');

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function filePath(id: string): string {
  // Defensive — id comes from cuid-like generator below; reject anything with path separators.
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`invalid blog id: ${id}`);
  return path.join(DATA_DIR, `${id}.json`);
}

export function newBlogId(): string {
  // Short, sortable-ish (timestamp prefix), URL-safe.
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(6).toString('hex');
  return `${ts}-${rand}`;
}

export async function saveBlog(blog: SavedBlog): Promise<void> {
  await ensureDir();
  const tmp = filePath(blog.id) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(blog, null, 2), 'utf8');
  await fs.rename(tmp, filePath(blog.id));
  invalidateListCache();
}

export async function getBlog(id: string): Promise<SavedBlog | null> {
  try {
    const buf = await fs.readFile(filePath(id), 'utf8');
    return JSON.parse(buf) as SavedBlog;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

export async function updateBlog(id: string, patch: Partial<SavedBlog>): Promise<SavedBlog | null> {
  const existing = await getBlog(id);
  if (!existing) return null;
  const merged: SavedBlog = { ...existing, ...patch, id: existing.id, updatedAt: new Date().toISOString() };
  await saveBlog(merged);
  return merged;
}

// Delete all images for a blog/newsletter by recursively removing their image subdirectory.
// The subdirectory is derived from the /api/images/... URLs stored in editor blocks.
async function deleteImagesForBlog(blog: SavedBlog): Promise<void> {
  const blocks: any[] = blog.editorBlocks ?? [];
  const urls = blocks
    .filter((b) => b?.type === 'Image')
    .map((b) => b?.content?.url || b?.content?.path || '')
    .filter((u: string) => u.startsWith('/api/images/'));

  if (!urls.length) return;

  // Collect unique image subdirectories (everything except the filename).
  // e.g. /api/images/blogs/my-title-abc123/img0.png → data/images/blogs/my-title-abc123
  const dirsToDelete = new Set<string>();
  for (const url of urls) {
    const segments = url.replace('/api/images/', '').split('/');
    const dirSegments = segments.slice(0, -1); // drop filename
    if (dirSegments.length) {
      dirsToDelete.add(path.join(IMAGES_DIR, ...dirSegments));
    }
  }

  await Promise.all(
    [...dirsToDelete].map((dir) =>
      fs.rm(dir, { recursive: true, force: true }).catch(() => {}),
    ),
  );
}

export async function deleteBlog(id: string): Promise<boolean> {
  const blog = await getBlog(id);
  if (!blog) return false;
  try {
    await deleteImagesForBlog(blog);
    await fs.unlink(filePath(id));
    invalidateListCache();
    return true;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return false;
    throw e;
  }
}

let _listCache: { data: BlogSummary[]; at: number } | null = null;
const LIST_CACHE_TTL_MS = 5_000;

export function invalidateListCache(): void {
  _listCache = null;
}

export async function listBlogs(): Promise<BlogSummary[]> {
  await ensureDir();
  if (_listCache && Date.now() - _listCache.at < LIST_CACHE_TTL_MS) return _listCache.data;

  const entries = await fs.readdir(DATA_DIR);
  const jsonFiles = entries.filter((n) => n.endsWith('.json'));

  const results = await Promise.all(
    jsonFiles.map(async (name) => {
      try {
        const buf = await fs.readFile(path.join(DATA_DIR, name), 'utf8');
        const b = JSON.parse(buf) as SavedBlog;
        return {
          id: b.id,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
          status: b.status,
          runType: b.runType,
          blogTitle: b.request?.blogTitle || '',
          finalTitle: b.finalTitle,
          persona: b.request?.persona || '',
          vertical: b.request?.vertical || '',
          audience: b.request?.targetAudience || '',
          publishedUrl: b.publishedUrl,
          chapterTitle: b.request?.chapterTitle,
          courseTitle: b.request?.courseTitle,
        } as BlogSummary;
      } catch {
        return null;
      }
    }),
  );

  const summaries = (results.filter(Boolean) as BlogSummary[]).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  _listCache = { data: summaries, at: Date.now() };
  return summaries;
}
