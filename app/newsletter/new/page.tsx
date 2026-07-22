'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field } from '../../_components/Field';

const VERTICALS = [
  'System Design',
  'AI/ML',
  'Cloud',
  'Coding interview patterns',
  'Projects',
  'Frontend',
  'Backend',
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

export default function NewNewsletterPage() {
  const router = useRouter();

  const [blogTitle, setBlogTitle] = useState('');
  const [vertical, setVertical] = useState('System Design');
  const [outline, setOutline] = useState('');
  const [targetAudience, setTargetAudience] = useState('Intermediate');
  const [wordsLength, setWordsLength] = useState(1500);
  const [seoMode, setSeoMode] = useState<'none' | 'optimize' | 'rewrite'>('none');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blogTitle,
          vertical,
          outline,
          targetAudience,
          blogSummary: '',
          wordsLength: Number(wordsLength),
          seoMode,
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
        router.push(slug ? `/newsletter/${slug}--${blogId}` : `/newsletter/${blogId}`);
      } else {
        setErr('Failed to start pipeline — no run ID received');
        setBusy(false);
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <span className="pill mb-3">Newsletter</span>
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="brand-gradient">Newsletter</span> Generator
        </h1>
        <p className="mt-2 text-[var(--text-dim)] max-w-2xl text-sm">
          Same multi-stage pipeline as the blog generator — research, drafting, editorial review, SEO, and widget generation — without persona voice selection.
        </p>
      </div>

      <form onSubmit={submit} className="card p-6 space-y-5">
        <Field label="Newsletter subject / title">
          <input
            className="input"
            required
            placeholder="The subject line or title of the newsletter"
            value={blogTitle}
            onChange={(e) => setBlogTitle(e.target.value)}
          />
        </Field>

        <div className="grid sm:grid-cols-4 gap-4">
          <Field label="Vertical">
            <select className="input" value={vertical} onChange={(e) => setVertical(e.target.value)}>
              {VERTICALS.map((v) => <option key={v}>{v}</option>)}
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

        <Field label="Outline (optional)" hint="Paste your own outline or leave blank for the pipeline to generate one.">
          <textarea
            className="input min-h-[180px] font-mono text-xs"
            value={outline}
            onChange={(e) => setOutline(e.target.value)}
          />
        </Field>

        <div className="flex items-center gap-3 pt-1">
          <button disabled={busy} className="btn-primary">
            {busy ? (
              <>
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Starting…
              </>
            ) : (
              <>
                Generate Newsletter
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
          <span className="text-xs text-[var(--text-faint)]">2–5 minutes depending on word count and widgets</span>
        </div>
      </form>

      {err && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 p-4 text-sm">{err}</div>
      )}
    </div>
  );
}
