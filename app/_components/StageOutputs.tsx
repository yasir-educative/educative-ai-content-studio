'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { STAGE_LABELS } from './Stages';

const MarkdownRenderer = dynamic(() => import('./MarkdownRenderer'), { ssr: false });

export type StageOutputMap = Record<string, any>;
export type StageLogEntry = { stage: string; prompt: string; input: any; output: any };
export type StageLogMap = Record<string, StageLogEntry[]>;

const WIDGET_SUB_RE = /^(code-generator|table-generator|table-research|image-enhancer|chart-generator|d2-generator|d2-svg-upload)#/;

function isWidgetSubKey(k: string): boolean {
  return WIDGET_SUB_RE.test(k);
}

function formatPayload(payload: any): { kind: 'json' | 'markdown' | 'text'; pretty: string; raw: any } {
  if (payload == null) return { kind: 'text', pretty: '', raw: payload };
  if (typeof payload === 'object') {
    return { kind: 'json', pretty: JSON.stringify(payload, null, 2), raw: payload };
  }
  const s = String(payload);
  const trimmed = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      return { kind: 'json', pretty: JSON.stringify(parsed, null, 2), raw: parsed };
    } catch {}
  }
  if (/(^|\n)\s*(#{1,6}\s|[-*]\s|```|\d+\.\s|\|)/.test(s)) {
    return { kind: 'markdown', pretty: s, raw: s };
  }
  return { kind: 'text', pretty: s, raw: s };
}

export function StageOutputs({
  outputs,
  logs = {},
  order,
  defaultTab,
}: {
  outputs: StageOutputMap;
  logs?: StageLogMap;
  order?: string[];
  defaultTab?: string;
}) {
  // Top-level tabs exclude widget sub-stage keys; those become sub-tabs of widgets-generate.
  const tabs = useMemo(() => {
    const keys = Object.keys(outputs).filter((k) => !isWidgetSubKey(k));
    // Synthesize widgets-generate even if pipeline only emitted sub-stage data events.
    if (Object.keys(outputs).some(isWidgetSubKey) && !keys.includes('widgets-generate')) {
      keys.push('widgets-generate');
    }
    if (!order) return keys;
    const ordered = order.filter((k) => keys.includes(k));
    const extras = keys.filter((k) => !order.includes(k));
    return [...ordered, ...extras];
  }, [outputs, order]);

  const widgetSubKeys = useMemo(
    () => Object.keys(outputs).filter(isWidgetSubKey).sort((a, b) => {
      // Sort by order index (numeric after #), then by name.
      const oa = Number(a.split('#')[1] || 0);
      const ob = Number(b.split('#')[1] || 0);
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    }),
    [outputs],
  );

  const [active, setActive] = useState<string>(defaultTab || tabs[0] || '');
  const [activeSub, setActiveSub] = useState<string>(widgetSubKeys[0] || '');
  const [view, setView] = useState<'content' | 'logs'>('content');

  if (!tabs.length) return null;

  // Resolve effective key (sub-tab overrides parent when in widgets-generate).
  const isWidgetsParent = active === 'widgets-generate';
  const subKey = isWidgetsParent && widgetSubKeys.includes(activeSub) ? activeSub : (isWidgetsParent ? widgetSubKeys[0] : '');
  const effectiveKey = subKey || active;
  const current = effectiveKey ? outputs[effectiveKey] : undefined;
  const fmt = current !== undefined ? formatPayload(current) : null;
  const stageLogs = logs[effectiveKey] || [];

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold">Stage outputs</h3>
        <div className="flex items-center gap-2">
          {fmt && view === 'content' && (
            <span className="pill text-[10px] uppercase tracking-wider">{fmt.kind}</span>
          )}
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs">
            <button
              onClick={() => setView('content')}
              className={`px-3 py-1.5 transition ${view === 'content' ? 'bg-[var(--panel)] text-white' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'}`}
            >
              Content
            </button>
            <button
              onClick={() => setView('logs')}
              className={`px-3 py-1.5 transition ${view === 'logs' ? 'bg-[var(--panel)] text-white' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'}`}
            >
              Logs {stageLogs.length > 0 && <span className="ml-1 opacity-70">({stageLogs.length})</span>}
            </button>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => {
              setActive(t);
              if (t === 'widgets-generate' && widgetSubKeys.length && !widgetSubKeys.includes(activeSub)) {
                setActiveSub(widgetSubKeys[0]);
              }
            }}
            className={`px-3 py-2 text-xs font-medium transition relative whitespace-nowrap ${
              active === t ? 'text-white' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'
            }`}
          >
            {STAGE_LABELS[t] || t}
            {active === t && (
              <span className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500 to-pink-500 rounded-t" />
            )}
          </button>
        ))}
      </div>

      {isWidgetsParent && widgetSubKeys.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-1">
          {widgetSubKeys.map((s) => (
            <button
              key={s}
              onClick={() => setActiveSub(s)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition ${
                activeSub === s
                  ? 'border-[var(--accent)] bg-[var(--panel-2)] text-white'
                  : 'border-[var(--border)] bg-[var(--panel)] text-[var(--text-dim)] hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {view === 'content' && fmt && (
        <div>
          {fmt.kind === 'markdown' ? (
            <MarkdownRenderer className="article-prose">{fmt.pretty}</MarkdownRenderer>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-xs bg-[#0a0d14] border border-[var(--border)] rounded-lg p-4 overflow-x-auto max-h-[600px]">
              {fmt.pretty}
            </pre>
          )}
        </div>
      )}

      {view === 'content' && !fmt && isWidgetsParent && (
        <p className="text-sm text-[var(--text-faint)]">Select a widget sub-stage above to inspect its output.</p>
      )}

      {view === 'logs' && (
        <div className="space-y-3">
          {stageLogs.length === 0 && (
            <p className="text-sm text-[var(--text-faint)]">No logs captured for this stage.</p>
          )}
          {stageLogs.map((entry, i) => (
            <details key={i} className="rounded-lg border border-[var(--border)] bg-[#0a0d14] p-3" open={i === 0}>
              <summary className="cursor-pointer text-xs font-medium text-[var(--text-dim)]">
                {entry.stage}
              </summary>
              <div className="mt-3 space-y-3">
                <LogSection label="Prompt" body={entry.prompt} />
                <LogSection label="Input" body={typeof entry.input === 'string' ? entry.input : JSON.stringify(entry.input, null, 2)} />
                <LogSection label="Output" body={typeof entry.output === 'string' ? entry.output : JSON.stringify(entry.output, null, 2)} />
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function LogSection({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1">{label}</div>
      <pre className="whitespace-pre-wrap break-words text-[11px] bg-black/40 border border-[var(--border)] rounded p-2 overflow-x-auto max-h-[300px]">
        {body || '(empty)'}
      </pre>
    </div>
  );
}
