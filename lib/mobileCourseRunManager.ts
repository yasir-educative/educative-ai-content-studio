// Background run manager for the Mobile Course Pipeline.
// Mirrors runManager.ts patterns but uses MobileCourse storage instead of SavedBlog.

import { runMobileCoursePipeline, type MobileCourseInput, type MobileCourseEmit } from './mobileCoursePipeline';
import {
  saveMobileCourse,
  getMobileCourse,
  newMobileCourseId,
  type MobileCourse,
  type MobileChapter,
} from './mobileCourseStorage';
import { runWithAbort, isAbortError } from './abortContext';

type Subscriber = (event: any) => void;

interface MobileCourseRunHandle {
  id: string;
  abort: AbortController;
  events: any[];
  subscribers: Set<Subscriber>;
  done: boolean;
  record: MobileCourse;
  pendingFlush: NodeJS.Timeout | null;
  lastFlushAt: number;
  lastStreams: Map<string, string>;
}

declare global { var __mobileCourseRuns: Map<string, MobileCourseRunHandle> | undefined; }
const RUNS: Map<string, MobileCourseRunHandle> =
  global.__mobileCourseRuns ?? (global.__mobileCourseRuns = new Map());

const PERSIST_THROTTLE_MS = 750;
const FINISHED_TTL_MS = 60_000;

function broadcast(handle: MobileCourseRunHandle, event: any) {
  handle.events.push(event);
  for (const s of handle.subscribers) {
    try { s(event); } catch {}
  }
}

async function flushRecord(handle: MobileCourseRunHandle) {
  handle.lastFlushAt = Date.now();
  handle.pendingFlush = null;
  handle.record.updatedAt = new Date().toISOString();
  try {
    await saveMobileCourse(handle.record);
  } catch (e) {
    console.error('[mobileCourseRunManager] flush failed', e);
  }
}

function scheduleFlush(handle: MobileCourseRunHandle) {
  if (handle.pendingFlush) return;
  const delay = Math.max(0, PERSIST_THROTTLE_MS - (Date.now() - handle.lastFlushAt));
  handle.pendingFlush = setTimeout(() => { void flushRecord(handle); }, delay);
}

export function startMobileCourseRun(input: MobileCourseInput): MobileCourseRunHandle {
  const id = newMobileCourseId();
  const startedAt = new Date().toISOString();

  const record: MobileCourse = {
    id,
    createdAt: startedAt,
    updatedAt: startedAt,
    status: 'running',
    title: input.courseTitle || `Collection ${input.collectionId}`,
    collectionId: input.collectionId,
    authorId: input.authorId,
    targetCollectionId: input.targetCollectionId,
    chapters: [],
    stageOutputs: {},
  };

  const handle: MobileCourseRunHandle = {
    id,
    abort: new AbortController(),
    events: [],
    subscribers: new Set(),
    done: false,
    record,
    pendingFlush: null,
    lastFlushAt: 0,
    lastStreams: new Map(),
  };
  RUNS.set(id, handle);
  void flushRecord(handle);

  const emit: MobileCourseEmit = (e) => {
    if (e?.type === 'data' && e.name) {
      record.stageOutputs![e.name] = e.payload;
    }
    if (e?.type === 'data' && e.name === 'fetch-collection' && e.payload?.title) {
      record.title = e.payload.title;
    }
    broadcast(handle, e);
    scheduleFlush(handle);
  };

  const onChapterDone = (chapter: MobileChapter) => {
    const idx = record.chapters.findIndex((c) => c.id === chapter.id);
    if (idx >= 0) {
      record.chapters[idx] = chapter;
    } else {
      record.chapters.push(chapter);
    }
    scheduleFlush(handle);
  };

  void (async () => {
    broadcast(handle, { type: 'meta', courseId: id });
    try {
      const pipelineResult = await runWithAbort(handle.abort.signal, () =>
        runMobileCoursePipeline(input, id, onChapterDone, emit),
      );
      // Promise.all inside the pipeline preserves input order, but onChapterDone fires
      // as each chapter completes (random order). Use the final result to restore order.
      if (pipelineResult?.chapters?.length) {
        record.chapters = pipelineResult.chapters;
      }
      record.status = 'draft';
      broadcast(handle, { type: 'done', courseId: id });
    } catch (err: any) {
      if (isAbortError(err) || handle.abort.signal.aborted) {
        record.status = 'cancelled';
        record.errorMessage = 'Cancelled by user';
        broadcast(handle, { type: 'cancelled', courseId: id });
      } else {
        record.status = 'failed';
        record.errorMessage = err?.message || String(err);
        broadcast(handle, { type: 'error', message: record.errorMessage });
      }
    } finally {
      handle.done = true;
      if (handle.pendingFlush) {
        clearTimeout(handle.pendingFlush);
        handle.pendingFlush = null;
      }
      await flushRecord(handle);
      setTimeout(() => RUNS.delete(id), FINISHED_TTL_MS);
    }
  })();

  return handle;
}

export function getMobileCourseRun(id: string): MobileCourseRunHandle | undefined {
  return RUNS.get(id);
}

export function cancelMobileCourseRun(id: string): boolean {
  const handle = RUNS.get(id);
  if (!handle || handle.done) return false;
  handle.abort.abort();
  return true;
}

export function isMobileCourseRunLive(id: string): boolean {
  const h = RUNS.get(id);
  return !!h && !h.done;
}

export function subscribeMobileCourse(
  id: string,
  listener: Subscriber,
): { backlog: any[]; unsubscribe: () => void; done: boolean } | null {
  const handle = RUNS.get(id);
  if (!handle) return null;
  handle.subscribers.add(listener);
  return {
    backlog: [...handle.events],
    done: handle.done,
    unsubscribe: () => handle.subscribers.delete(listener),
  };
}

export async function reconcileMobileCourseOrphan(id: string): Promise<void> {
  if (isMobileCourseRunLive(id)) return;
  const rec = await getMobileCourse(id);
  if (!rec || rec.status !== 'running') return;
  rec.status = 'failed';
  rec.errorMessage = (rec.errorMessage || '') + ' (server restarted before completion)';
  await saveMobileCourse(rec);
}
