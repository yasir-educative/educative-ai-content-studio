// Background run manager for the Mobile Shorts Pipeline.
// Mirrors mobileCourseRunManager.ts patterns but uses MobileShort storage instead of MobileCourse.

import { runMobileShortsPipeline, type MobileShortInput, type MobileShortEmit } from './mobileShortsPipeline';
import {
  saveMobileShort,
  getMobileShort,
  newMobileShortId,
  type MobileShort,
} from './mobileShortsStorage';
import { MobileCard } from './mobileCourseStorage';
import { runWithAbort, isAbortError } from './abortContext';

type Subscriber = (event: any) => void;

interface MobileShortRunHandle {
  id: string;
  abort: AbortController;
  events: any[];
  subscribers: Set<Subscriber>;
  done: boolean;
  record: MobileShort;
  pendingFlush: NodeJS.Timeout | null;
  lastFlushAt: number;
  lastStreams: Map<string, string>;
}

declare global { var __mobileShortRuns: Map<string, MobileShortRunHandle> | undefined; }
const RUNS: Map<string, MobileShortRunHandle> =
  global.__mobileShortRuns ?? (global.__mobileShortRuns = new Map());

const PERSIST_THROTTLE_MS = 750;
const FINISHED_TTL_MS = 60_000;

function broadcast(handle: MobileShortRunHandle, event: any) {
  handle.events.push(event);
  for (const s of handle.subscribers) {
    try { s(event); } catch {}
  }
}

async function flushRecord(handle: MobileShortRunHandle) {
  handle.lastFlushAt = Date.now();
  handle.pendingFlush = null;
  handle.record.updatedAt = new Date().toISOString();
  try {
    await saveMobileShort(handle.record);
  } catch (e) {
    console.error('[mobileShortsRunManager] flush failed', e);
  }
}

function scheduleFlush(handle: MobileShortRunHandle) {
  if (handle.pendingFlush) return;
  const delay = Math.max(0, PERSIST_THROTTLE_MS - (Date.now() - handle.lastFlushAt));
  handle.pendingFlush = setTimeout(() => { void flushRecord(handle); }, delay);
}

export function startMobileShortRun(input: MobileShortInput): MobileShortRunHandle {
  const id = newMobileShortId();
  const startedAt = new Date().toISOString();

  const record: MobileShort = {
    id,
    createdAt: startedAt,
    updatedAt: startedAt,
    status: 'running',
    topic: input.topic,
    domain: input.domain,
    level: input.level,
    objective: input.objective,
    additionalContext: input.additionalContext,
    isHighlightCardNeeded: input.isHighlightCardNeeded,
    numCards: input.numCards,
    authorId: input.authorId || '',
    cards: [],
    stageOutputs: {},
  };

  const handle: MobileShortRunHandle = {
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

  const emit: MobileShortEmit = (e) => {
    if (e?.type === 'data' && e.name) {
      record.stageOutputs![e.name] = e.payload;
    }
    broadcast(handle, e);
    scheduleFlush(handle);
  };

  const onCard = (card: MobileCard) => {
    const idx = record.cards.findIndex((c) => c.id === card.id);
    if (idx >= 0) {
      record.cards[idx] = card;
    } else {
      record.cards.push(card);
    }
    scheduleFlush(handle);
  };

  void (async () => {
    broadcast(handle, { type: 'meta', shortId: id });
    try {
      const result = await runWithAbort(handle.abort.signal, () =>
        runMobileShortsPipeline(input, id, onCard, emit),
      );
      record.status = 'draft';
      broadcast(handle, { type: 'done', shortId: id });
    } catch (err: any) {
      if (isAbortError(err) || handle.abort.signal.aborted) {
        record.status = 'cancelled';
        record.errorMessage = 'Cancelled by user';
        broadcast(handle, { type: 'cancelled', shortId: id });
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

export function getMobileShortRun(id: string): MobileShortRunHandle | undefined {
  return RUNS.get(id);
}

export function cancelMobileShortRun(id: string): boolean {
  const handle = RUNS.get(id);
  if (!handle || handle.done) return false;
  handle.abort.abort();
  return true;
}

export function isMobileShortRunLive(id: string): boolean {
  const h = RUNS.get(id);
  return !!h && !h.done;
}

export function subscribeMobileShort(
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

export async function reconcileMobileShortOrphan(id: string): Promise<void> {
  if (isMobileShortRunLive(id)) return;
  const rec = await getMobileShort(id);
  if (!rec || rec.status !== 'running') return;
  rec.status = 'failed';
  rec.errorMessage = (rec.errorMessage || '') + ' (server restarted before completion)';
  await saveMobileShort(rec);
}
