// Per-request abort signal carried via AsyncLocalStorage so leaf LLM calls (generateText, etc.)
// can pick it up without every pipeline call site having to thread `signal` through. Route
// handlers wrap the pipeline in `runWithAbort(signal, fn)` and the LangChain invoke calls in
// lib/ai.ts read it from the store.

import { AsyncLocalStorage } from 'async_hooks';

const als = new AsyncLocalStorage<AbortSignal>();

export function runWithAbort<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  if (!signal) return fn();
  return als.run(signal, fn);
}

export function getAbortSignal(): AbortSignal | undefined {
  return als.getStore();
}

export function checkAborted(): void {
  const sig = als.getStore();
  if (sig?.aborted) {
    const err: any = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }
}

export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  const e = err as any;
  return e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || /aborted|cancell?ed/i.test(String(e?.message || ''));
}
