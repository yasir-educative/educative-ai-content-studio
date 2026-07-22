'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field } from '../_components/Field';

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

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');
}

export default function BlogPage() {
  const router = useRouter();

  const [vertical, setVertical] = useState('System Design');
  const [blogTitle, setBlogTitle] = useState('');
  const [outline, setOutline] = useState('');
  const [persona, setPersona] = useState('');
  const [personaOptions, setPersonaOptions] = useState<string[]>([]);
  const [targetAudience, setTargetAudience] = useState('Intermediate');
  const [wordsLength, setWordsLength] = useState(2500);
  const [seoMode, setSeoMode] = useState<'none' | 'optimize' | 'rewrite'>('none');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/personas')
      .then((r) => r.json())
      .then((j) => {
        const names: string[] = (j.personas || []).map((p: any) => p.name);
        setPersonaOptions(names);
        setPersona((curr) => curr || names[0] || '');
      })
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/blog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vertical, blogTitle, outline, persona, targetAudience,
          blogSummary: '', wordsLength: Number(wordsLength), seoMode,
        }),
      });
      if (!res.ok || !res.body) { setErr('Request failed'); setBusy(false); return; }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let blogId = '';

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';
        for (const line of parts) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'meta' && evt.blogId) { blogId = evt.blogId; break outer; }
          } catch {}
        }
      }

      reader.cancel().catch(() => {});

      if (blogId) {
        const slug = slugify(blogTitle);
        router.push(slug ? `/blog/${slug}--${blogId}` : `/blog/${blogId}`);
      } else {
        setErr('Failed to start pipeline — no blog ID received');
        setBusy(false);
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
          Blog Generator
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--text-dim)' }}>
          Multi-stage pipeline: draft → editorial review → SEO → PR review → widgets → Educative blocks.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={submit} className="card p-6 space-y-5">
        <Field label="Blog title">
          <input
            className="input"
            required
            placeholder="The final headline of the article"
            value={blogTitle}
            onChange={(e) => setBlogTitle(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Field label="Vertical">
            <select className="input" value={vertical} onChange={(e) => setVertical(e.target.value)}>
              {VERTICALS.map((v) => <option key={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Persona voice">
            <select className="input" value={persona} onChange={(e) => setPersona(e.target.value)}>
              {personaOptions.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Audience">
            <select className="input" value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)}>
              <option>Beginner</option>
              <option>Intermediate</option>
              <option>Advanced</option>
            </select>
          </Field>
          <Field label="Word count">
            <input
              className="input"
              type="number"
              min={500}
              max={8000}
              step={100}
              value={wordsLength}
              onChange={(e) => setWordsLength(Number(e.target.value))}
            />
          </Field>
          <Field label="SEO mode">
            <select className="input" value={seoMode} onChange={(e) => setSeoMode(e.target.value as any)}>
              <option value="none">None</option>
              <option value="optimize">Optimize</option>
              <option value="rewrite">Rewrite</option>
            </select>
          </Field>
        </div>

        <Field
          label="Outline"
          hint="Paste the Outline Generator output, your own markdown outline, or leave blank."
        >
          <textarea
            className="input min-h-[200px] font-mono text-xs"
            value={outline}
            onChange={(e) => setOutline(e.target.value)}
          />
        </Field>

        {err && (
          <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
            {err}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button disabled={busy} className="btn-primary px-5">
            {busy ? (
              <>
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Starting…
              </>
            ) : 'Generate Blog'}
          </button>
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
            2–6 min depending on word count and widgets
          </span>
        </div>
      </form>
    </div>
  );
}
