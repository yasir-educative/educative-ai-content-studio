'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type Persona = {
  slug: string;
  name: string;
  body: string;
  builtin: boolean;
  imageStyleId?: string;
  createdAt: string;
  updatedAt: string;
};

type Style = { id: string; name: string; previewUrl?: string; referenceUrl?: string };

export default function PersonaEditorPage({ params }: { params: { slug: string } }) {
  const router = useRouter();
  const [data, setData] = useState<Persona | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  // The style this persona's illustrations are drawn in; '' means the default.
  const [styleId, setStyleId] = useState('');
  const [styles, setStyles] = useState<Style[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/personas/${params.slug}`);
      if (!res.ok) {
        setErr('Persona not found');
        return;
      }
      const json = (await res.json()) as Persona;
      setData(json);
      setName(json.name);
      setBody(json.body);
      setStyleId(json.imageStyleId || '');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch('/api/images/style', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setStyles(j.styles || []))
      .catch(() => {});
  }, []);
  useEffect(() => { load(); }, [params.slug]);

  async function save() {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(`/api/personas/${params.slug}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body, name, imageStyleId: styleId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'save failed');
      setData(json);
      setName(json.name);
      setBody(json.body);
      setStyleId(json.imageStyleId || '');
      setMsg('Saved');
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!confirm('Reset to the built-in default? Your edits will be lost.')) return;
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(`/api/personas/${params.slug}`, { method: 'PATCH' });
      const json = await res.json();
      setData(json);
      setName(json.name);
      setBody(json.body);
      setMsg('Reset to default');
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete persona "${data?.name}"? This cannot be undone.`)) return;
    await fetch(`/api/personas/${params.slug}`, { method: 'DELETE' });
    router.push('/personas');
  }

  if (loading) return <div className="max-w-5xl mx-auto p-6 text-sm text-[var(--text-faint)]">Loading…</div>;
  if (err && !data) return <div className="max-w-5xl mx-auto p-6 text-sm text-red-400">{err}</div>;
  if (!data) return null;

  const dirty = body !== data.body || name !== data.name || styleId !== (data.imageStyleId || '');

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href="/personas" className="text-xs text-[var(--text-faint)] hover:underline">← All personas</Link>
          <h1 className="text-2xl font-semibold">{data.name}</h1>
          <div className="text-xs text-[var(--text-faint)] mt-1">
            <span className={`pill mr-2 ${data.builtin ? '' : 'pill-success'}`}>{data.builtin ? 'built-in' : 'custom'}</span>
            {data.updatedAt ? `saved ${new Date(data.updatedAt).toLocaleString()}` : 'using default'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data.builtin ? (
            <button onClick={reset} disabled={saving || !data.updatedAt} className="btn">Reset to default</button>
          ) : (
            <button onClick={remove} disabled={saving} className="btn">Delete</button>
          )}
          <button onClick={save} disabled={saving || !dirty} className="btn btn-primary">
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {msg && <div className="card p-3 text-sm text-emerald-400">{msg}</div>}
      {err && <div className="card p-3 text-sm text-red-400">{err}</div>}

      <div className="space-y-3">
        {!data.builtin && (
          <div>
            <label className="text-xs font-semibold block mb-1">Display name</label>
            <input
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}
        <div>
          <label className="text-xs font-semibold block mb-1">Image style</label>
          <div className="flex items-start gap-3 flex-wrap">
            <select className="input min-w-[16rem]" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
              <option value="">Pipeline default</option>
              {styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {(() => {
              const chosen = styles.find((s) => s.id === styleId);
              return chosen?.previewUrl
                ? <img src={chosen.previewUrl} alt={`${chosen.name} sample`}
                    className="w-16 h-16 rounded-lg object-cover border border-[var(--border)] bg-white" />
                : null;
            })()}
          </div>
          <div className="text-xs text-[var(--text-faint)] mt-1">
            Illustrations in a blog written by this persona are drawn in this style. Left on
            &ldquo;Pipeline default&rdquo; they use whatever Blogs and newsletters is set to under
            {' '}<Link href="/images" className="underline hover:text-[var(--text)]">Style configuration</Link>.
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold block mb-1">Voice prompt</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            className="w-full min-h-[480px] font-mono text-sm p-3 rounded-lg border border-[var(--border)] bg-[var(--panel)]"
          />
          <div className="text-xs text-[var(--text-faint)] mt-1">
            This text is injected as the persona instructions in the text-generation stage of the blog pipeline.
          </div>
        </div>
      </div>
    </div>
  );
}
