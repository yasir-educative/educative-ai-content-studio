'use client';

import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Field } from '../_components/Field';

const MarkdownRenderer = dynamic(() => import('../_components/MarkdownRenderer'), { ssr: false });
import { Stages, StageItem } from '../_components/Stages';
import { StageOutputs, StageOutputMap } from '../_components/StageOutputs';

const VERTICALS = [
  'Coding interview patterns',
  'Projects',
  'System Design',
  'Frontend',
  'Backend',
  'AI/ML',
  'DevOps',
  'Other',
];

export default function OutlinePage() {
  const [vertical, setVertical] = useState('System Design');
  const [blogTitle, setBlogTitle] = useState('');
  const [targetAudience, setTargetAudience] = useState('Intermediate');
  const [description, setDescription] = useState('');
  const [referenceContent, setReferenceContent] = useState('');

  const [busy, setBusy] = useState(false);
  const [stages, setStages] = useState<StageItem[]>([]);
  const [research, setResearch] = useState('');
  const [outline, setOutline] = useState('');
  const [outputs, setOutputs] = useState<StageOutputMap>({});
  const [err, setErr] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  function stop() {
    abortRef.current?.abort();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setStages([]);
    setResearch('');
    setOutline('');
    setOutputs({});
    setErr('');
    try {
      const res = await fetch('/api/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctl.signal,
        body: JSON.stringify({ vertical, blogTitle, targetAudience, description, referenceContent }),
      });
      if (!res.ok || !res.body) {
        setErr('Request failed');
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'stage') setStages((s) => [...s, { name: evt.name, status: evt.status }]);
            else if (evt.type === 'data') {
              if (evt.name === 'research') setResearch(evt.payload);
              if (evt.name === 'outline') setOutline(evt.payload);
              setOutputs((o) => ({ ...o, [evt.name]: evt.payload }));
            } else if (evt.type === 'error') setErr(evt.message);
            else if (evt.type === 'cancelled') setErr('Generation cancelled');
          } catch {}
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') setErr('Generation cancelled');
      else setErr(e?.message || String(e));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function download(content: string, name: string, mime = 'text/markdown') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-8">
      <div>
        <span className="pill mb-3">Step 1 of 2</span>
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="brand-gradient">Outline</span> Generator
        </h1>
        <p className="mt-2 text-[var(--text-dim)] max-w-2xl text-sm">
          Run live web research and produce a structured outline draft. Use the result as the seed for the full
          blog generator.
        </p>
      </div>

      <form onSubmit={submit} className="card p-6 space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Vertical">
            <select className="input" value={vertical} onChange={(e) => setVertical(e.target.value)}>
              {VERTICALS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Target audience">
            <select className="input" value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)}>
              <option>Beginner</option>
              <option>Intermediate</option>
              <option>Advanced</option>
            </select>
          </Field>
        </div>
        <Field label="Blog title" hint="The working title — it will inform research and the outline structure.">
          <input
            className="input"
            required
            placeholder="e.g. Designing a rate limiter for a multi-tenant API"
            value={blogTitle}
            onChange={(e) => setBlogTitle(e.target.value)}
          />
        </Field>
        <Field label="Description / angle" hint="Optional — frame the perspective or unique angle.">
          <textarea
            className="input min-h-[110px]"
            placeholder="What makes your take different? Any constraints to mention?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Reference content (optional)" hint="Notes, snippets, or competitor articles to anchor the outline.">
          <textarea
            className="input min-h-[110px]"
            value={referenceContent}
            onChange={(e) => setReferenceContent(e.target.value)}
          />
        </Field>

        <div className="flex items-center gap-3 pt-1">
          <button disabled={busy} className="btn-primary">
            {busy ? (
              <>
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Generating…
              </>
            ) : (
              <>
                Generate Outline
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
          {busy && (
            <button type="button" onClick={stop} className="btn">
              <span className="h-2.5 w-2.5 rounded-sm bg-red-400" />
              Stop generation
            </button>
          )}
          <span className="text-xs text-[var(--text-faint)]">~30–60 seconds</span>
        </div>
      </form>

      {err && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 p-4 text-sm">{err}</div>
      )}

      <Stages items={stages} />

      {Object.keys(outputs).length > 0 && (
        <StageOutputs outputs={outputs} order={['research', 'outline']} defaultTab="outline" />
      )}

      {research && (
        <section className="card p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" /> Research notes
            </h2>
            <button className="btn-secondary" onClick={() => download(research, 'research.md')}>
              Download
            </button>
          </div>
          <MarkdownRenderer className="article-prose text-sm">{research}</MarkdownRenderer>
        </section>
      )}

      {outline && (
        <section className="card p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" /> Outline
            </h2>
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                onClick={() => navigator.clipboard.writeText(outline)}
                title="Copy raw markdown"
              >
                Copy
              </button>
              <button
                className="btn-secondary"
                onClick={() => download(outline, `${blogTitle || 'outline'}.md`)}
              >
                Download .md
              </button>
            </div>
          </div>
          <MarkdownRenderer className="article-prose">{outline}</MarkdownRenderer>
        </section>
      )}
    </div>
  );
}
