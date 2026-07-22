'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type PromptItem = {
  name: string;
  variables: string[];
  editable: boolean;
  version: number;
  updatedAt?: string;
  pipeline: string;
};

type TabId = 'blog' | 'newsletter' | 'course' | 'outline' | 'mobile-course' | 'mobile-short';

const TABS: { id: TabId; label: string }[] = [
  { id: 'blog',          label: 'Blog'          },
  { id: 'newsletter',    label: 'Newsletter'    },
  { id: 'course',        label: 'Course'        },
  { id: 'mobile-course', label: 'Mobile Course' },
  { id: 'mobile-short',  label: 'Mobile Short'  },
  { id: 'outline',       label: 'Outline'       },
];

const PIPELINE_LABEL: Record<string, string> = {
  blog:            'Blog pipeline',
  newsletter:      'Newsletter pipeline',
  course:          'Course pipeline',
  'mobile-course': 'Mobile course pipeline',
  'mobile-short':  'Mobile short pipeline',
  outline:         'Outline pipeline',
  shared:          'Shared (Blog + Newsletter)',
};

function getTabPipelines(tab: TabId): string[] {
  if (tab === 'blog')          return ['blog', 'shared'];
  if (tab === 'newsletter')    return ['newsletter', 'shared'];
  if (tab === 'course')        return ['course'];
  if (tab === 'mobile-course') return ['mobile-course'];
  if (tab === 'mobile-short')  return ['mobile-short'];
  if (tab === 'outline')       return ['outline'];
  return [];
}

function PromptRow({ p }: { p: PromptItem }) {
  const inner = (
    <div className="flex items-center gap-4 px-4 py-3 group transition-colors hover:bg-[var(--panel-2)]">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono font-medium" style={{ color: 'var(--text)' }}>{p.name}</div>
        <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-faint)' }}>
          {p.variables.length ? `vars: ${p.variables.join(', ')}` : 'no variables'}
        </div>
      </div>
      <div className="text-xs tabular-nums w-14 text-right" style={{ color: 'var(--text-faint)' }}>
        v{p.version}
      </div>
      <div className="text-xs w-40 text-right" style={{ color: 'var(--text-faint)' }}>
        {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : 'default'}
      </div>
      <span className={`pill shrink-0 ${p.editable ? 'pill-success' : 'pill-error'}`}>
        {p.editable ? 'editable' : 'code-only'}
      </span>
    </div>
  );

  if (!p.editable) return <div className="opacity-50 cursor-not-allowed">{inner}</div>;
  return <Link href={`/prompts/${p.name}`}>{inner}</Link>;
}

export default function PromptsPage() {
  const [items, setItems] = useState<PromptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('blog');

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/prompts');
      setItems((await res.json()).prompts || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  const pipelines = getTabPipelines(activeTab);
  const tabItems = items.filter((p) => pipelines.includes(p.pipeline));
  const showSections = pipelines.length > 1;

  return (
    <div className="max-w-5xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Prompts</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-dim)' }}>
            Edit prompt templates for every pipeline stage. Changes save to disk and take effect on the next run.
          </p>
        </div>
        <button onClick={refresh} className="btn-secondary text-xs">Refresh</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: '1px solid var(--border)' }}>
        {TABS.map((t) => {
          const count = items.filter((p) => getTabPipelines(t.id).includes(p.pipeline)).length;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors"
              style={active
                ? { background: 'var(--panel-2)', border: '1px solid var(--border)', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', marginBottom: '-1px' }
                : { border: '1px solid transparent', color: 'var(--text-faint)' }
              }
            >
              {t.label}
              {!loading && count > 0 && (
                <span className="ml-1.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div className="card px-4 py-6 text-sm" style={{ color: 'var(--text-faint)' }}>Loading…</div>
      ) : tabItems.length === 0 ? (
        <div className="card px-4 py-6 text-sm" style={{ color: 'var(--text-faint)' }}>No prompts registered for this pipeline yet.</div>
      ) : showSections ? (
        <div className="space-y-4">
          {pipelines.map((pipeline) => {
            const group = tabItems.filter((p) => p.pipeline === pipeline);
            if (!group.length) return null;
            return (
              <div key={pipeline}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-dim)' }}>
                    {PIPELINE_LABEL[pipeline]}
                  </span>
                  <span className="pill text-[10px]">{group.length}</span>
                </div>
                <div className="card divide-rows">
                  {group.map((p) => <PromptRow key={p.name} p={p} />)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card divide-rows">
          {tabItems.map((p) => <PromptRow key={p.name} p={p} />)}
        </div>
      )}
    </div>
  );
}
