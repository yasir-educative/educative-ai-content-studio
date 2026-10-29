'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Field } from '../_components/Field';
import {
  EDUCATIVE_IMAGE_STYLE,
  IMAGE_FORMATS,
  IMAGE_MODELS,
  IMAGE_QUALITIES,
  checkSize,
  IMAGE_SIZES,
} from '@/lib/educativeImageStyle';

export default function EducativeImagesPage() {
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refPreview, setRefPreview] = useState<string>('');
  // Set when editing a result in place: the server re-reads it from disk.
  const [sourceUrl, setSourceUrl] = useState('');
  // Style reference: saved server-side, reused until replaced or removed.
  const [refImage, setRefImage] = useState<{ url: string } | null>(null);
  const [useRef, setUseRef] = useState(true);
  const [refBusy, setRefBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [model, setModel] = useState<string>(IMAGE_MODELS[0]);
  const [quality, setQuality] = useState<string>('high');
  const [format, setFormat] = useState<string>('jpeg');
  const [compression, setCompression] = useState('');
  const [width, setWidth] = useState(1536);
  const [height, setHeight] = useState(1024);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ url: string; filename: string; size: string; styleApplied?: boolean; usedReference?: boolean; usedSubject?: boolean; format?: string; requestedFormat?: string } | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  // House style: server-backed so an edit survives reloads and applies to generation.
  const [style, setStyle] = useState(EDUCATIVE_IMAGE_STYLE);
  const [isDefault, setIsDefault] = useState(true);
  const [editing, setEditing] = useState(false);
  const [styleDraft, setStyleDraft] = useState('');
  const [styleBusy, setStyleBusy] = useState(false);
  const [styleErr, setStyleErr] = useState('');

  useEffect(() => {
    fetch('/api/images/style', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (typeof j?.style === 'string') { setStyle(j.style); setIsDefault(!!j.isDefault); } })
      .catch(() => { /* keep the bundled default */ });
  }, []);

  async function persistStyle(method: 'PUT' | 'DELETE', body?: object) {
    setStyleBusy(true);
    setStyleErr('');
    try {
      const res = await fetch('/api/images/style', {
        method,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed');
      setStyle(json.style);
      setIsDefault(!!json.isDefault);
      setEditing(false);
    } catch (e: any) {
      setStyleErr(e?.message || String(e));
    } finally {
      setStyleBusy(false);
    }
  }

  // Close the zoom overlay on Escape.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomed(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);

  const { checks, valid } = useMemo(() => checkSize(width, height), [width, height]);
  const lossless = format === 'png';

  useEffect(() => {
    fetch('/api/images/reference', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setRefImage(j.reference || null))
      .catch(() => {});
  }, []);

  async function uploadReference(f: File | null) {
    if (!f) return;
    setRefBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('image', f);
      const r = await fetch('/api/images/reference', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Failed to save reference');
      setRefImage(j.reference); setUseRef(true);
    } catch (e: any) { setErr(e?.message || String(e)); } finally { setRefBusy(false); }
  }

  async function removeReference() {
    setRefBusy(true);
    try {
      await fetch('/api/images/reference', { method: 'DELETE' });
      setRefImage(null);
    } finally { setRefBusy(false); }
  }

  function pickFile(f: File | null) {
    if (f) { setErr(''); setSourceUrl(''); }
    setRefFile(f);
    setRefPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return f ? URL.createObjectURL(f) : ''; });
  }

  async function generate() {
    if (!instructions.trim() || !valid) return;
    if (mode === 'edit' && !refFile && !sourceUrl) { setErr('Add the image you want to edit'); return; }
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      let res: Response;
      if (refFile) {
        const fd = new FormData();
        fd.append('mode', mode);
        fd.append('instructions', instructions);
        fd.append('model', model);
        fd.append('quality', quality);
        fd.append('format', format);
        fd.append('compression', String(compression));
        fd.append('width', String(width));
        fd.append('height', String(height));
        fd.append('image', refFile);
        fd.append('useReference', useRef && refImage ? '1' : '0');
        res = await fetch('/api/images/generate', { method: 'POST', body: fd });
      } else {
        res = await fetch('/api/images/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, sourceUrl, useReference: useRef && !!refImage, instructions, model, quality, format, compression, width, height }),
        });
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Generation failed');
      setResult({ url: json.url, filename: json.filename, size: json.size, styleApplied: json.styleApplied, usedReference: json.usedReference, usedSubject: json.usedSubject, format: json.format, requestedFormat: json.requestedFormat });
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <Link href="/" className="text-xs text-[var(--text-faint)] hover:text-[var(--text)] block mb-2 transition-colors">
          ← Home
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Educative Image Generator</h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          The house visual style is fixed and always sent. Describe only what the image should show.
        </p>
      </div>

      {/* Mode */}
      <div className="card p-1 flex gap-1">
        {([['create', 'Create'], ['edit', 'Edit an image']] as const).map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m); setErr(''); }}
            className={`flex-1 text-sm py-2 rounded-lg transition-colors ${mode === m ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Style reference — persists until replaced or removed */}
      <div className="card p-5 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <label className="text-xs font-medium text-[var(--text-dim)] uppercase tracking-wide">Style reference</label>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
              Its style is matched, not its subject. Saved and reused until you replace or remove it.
            </p>
          </div>
          {refImage && (
            <label className="flex items-center gap-2 text-xs cursor-pointer shrink-0">
              <input type="checkbox" className="accent-emerald-500" checked={useRef}
                onChange={(e) => setUseRef(e.target.checked)} disabled={busy} />
              Use this reference
            </label>
          )}
        </div>
        <div className="flex items-start gap-3 flex-wrap">
          <label className={`flex-1 min-w-[14rem] rounded-xl border-2 border-dashed px-4 py-4 text-center cursor-pointer transition-colors border-[var(--border)] hover:border-[var(--text-faint)] ${busy || refBusy ? 'opacity-50 pointer-events-none' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'));
              if (f) uploadReference(f);
            }}
            onPaste={(e) => {
              const f = Array.from(e.clipboardData.files).find((x) => x.type.startsWith('image/'));
              if (f) uploadReference(f);
            }}
          >
            <input type="file" accept="image/*" className="hidden" disabled={busy || refBusy}
              onChange={(e) => uploadReference(e.target.files?.[0] || null)} />
            <p className="text-xs text-[var(--text-dim)]">
              {refBusy ? 'Saving…' : refImage
                ? <>Replace the reference — <span className="text-[var(--accent)] underline">choose</span>, drag or paste</>
                : <>Set a style reference — <span className="text-[var(--accent)] underline">choose a file</span>, drag or paste</>}
            </p>
          </label>
          {refImage && (
            <div className="relative shrink-0">
              <img src={refImage.url} alt="Style reference"
                className={`h-24 rounded-lg border object-contain bg-white ${useRef ? 'border-[var(--accent)]' : 'border-[var(--border)] opacity-40'}`} />
              <button onClick={removeReference} disabled={busy || refBusy} title="Remove reference"
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[var(--panel)] border border-[var(--border)] text-xs leading-none hover:text-red-400">×</button>
            </div>
          )}
        </div>
      </div>

      {/* Image input */}
      <div className="card p-5 space-y-2">
        <label className="text-xs font-medium text-[var(--text-dim)] uppercase tracking-wide">
          {mode === 'edit' ? 'Image to edit' : 'Image to recreate (optional)'}
        </label>
        <p className="text-[11px] text-[var(--text-faint)]">
          {mode === 'edit'
            ? 'The change is applied inside this image. The house style is not re-applied, since the image already has one.'
            : 'Its subject and structure are kept and redrawn. Leave empty to create from the description alone.'}
        </p>
        <div className="flex items-start gap-3 flex-wrap">
          {/* Click, drag and drop, or paste all land in pickFile. */}
          <label
            onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (busy) return;
              const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'));
              if (f) pickFile(f); else setErr('Drop an image file');
            }}
            onPaste={(e) => {
              const f = Array.from(e.clipboardData.files).find((x) => x.type.startsWith('image/'));
              if (f && !busy) pickFile(f);
            }}
            tabIndex={0}
            className={`flex-1 min-w-[16rem] rounded-xl border-2 border-dashed px-4 py-5 text-center cursor-pointer transition-colors ${
              dragging
                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                : 'border-[var(--border)] hover:border-[var(--text-faint)]'
            } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <input type="file" accept="image/*" disabled={busy} className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] || null)} />
            <p className="text-xs text-[var(--text-dim)]">
              {dragging ? 'Drop to use this image' : <>Drag an image here, <span className="text-[var(--accent)] underline">choose a file</span>, or paste</>}
            </p>
            {refFile && !dragging && (
              <p className="text-[10px] text-[var(--text-faint)] mt-1 truncate">{refFile.name}</p>
            )}
            {!refFile && sourceUrl && !dragging && (
              <p className="text-[10px] text-[var(--text-faint)] mt-1 truncate">Using the generated image</p>
            )}
          </label>
          {refPreview && (
            <div className="relative shrink-0">
              <img src={refPreview} alt="Reference" className="h-24 rounded-lg border border-[var(--border)] bg-white object-contain" />
              <button onClick={() => { pickFile(null); setSourceUrl(''); setRefPreview(''); }} disabled={busy}
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[var(--panel)] border border-[var(--border)] text-xs leading-none hover:text-red-400">×</button>
            </div>
          )}
        </div>
      </div>

      {/* Fixed style block — not sent when editing */}
      {mode === 'create' && (
      <div className="card p-5 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <label className="text-xs font-medium text-[var(--text-dim)] uppercase tracking-wide">
              Mandatory visual style
              {!isDefault && <span className="ml-2 pill text-[10px] py-0 px-1.5">edited</span>}
            </label>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
              Prepended to every request.{isDefault ? ' Currently the default.' : ' Customized.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!editing && (
              <>
                <button className="btn-secondary text-xs py-1 px-3" onClick={() => setShowPrompt((v) => !v)}>
                  {showPrompt ? 'Hide' : 'Show'}
                </button>
                <button
                  className="btn-secondary text-xs py-1 px-3"
                  onClick={() => { setStyleDraft(style); setEditing(true); setShowPrompt(true); setStyleErr(''); }}
                >
                  Edit
                </button>
                {!isDefault && (
                  <button
                    className="btn-secondary text-xs py-1 px-3"
                    onClick={() => persistStyle('DELETE')}
                    disabled={styleBusy}
                    title="Discard the customization and restore the shipped style"
                  >
                    {styleBusy ? '…' : 'Set to default'}
                  </button>
                )}
              </>
            )}
            {editing && (
              <>
                <button
                  className="btn-secondary text-xs py-1 px-3"
                  onClick={() => { setEditing(false); setStyleErr(''); }}
                  disabled={styleBusy}
                >
                  Cancel
                </button>
                <button
                  className="btn-secondary text-xs py-1 px-3"
                  onClick={() => setStyleDraft(EDUCATIVE_IMAGE_STYLE)}
                  disabled={styleBusy}
                  title="Load the shipped style into the editor"
                >
                  Load default
                </button>
                <button
                  className="btn-primary text-xs py-1 px-3"
                  onClick={() => persistStyle('PUT', { style: styleDraft })}
                  disabled={styleBusy || !styleDraft.trim()}
                >
                  {styleBusy ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>
        {styleErr && <p className="text-xs text-red-400">{styleErr}</p>}
        {showPrompt && (
          <textarea
            readOnly={!editing}
            value={editing ? styleDraft : style}
            onChange={(e) => setStyleDraft(e.target.value)}
            spellCheck={false}
            className={`input w-full font-mono text-[11px] leading-relaxed min-h-[260px] ${
              editing ? '' : 'opacity-80 cursor-default'
            }`}
          />
        )}
      </div>
      )}

      {/* User instructions */}
      <div className="card p-5 space-y-1.5">
        <label className="text-xs font-medium text-[var(--text-dim)] uppercase tracking-wide">
          {mode === 'edit' ? 'What should change?' : 'What should the image show?'}
        </label>
        <textarea
          className="input w-full text-sm min-h-[120px]"
          placeholder={mode === 'edit'
            ? 'e.g. Change the database cylinder to green and relabel it "Read replica".'
            : 'e.g. A horizontal flow of three stages: Client, API gateway, and Database, connected by arrows.'}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          disabled={busy}
        />
        <p className="text-[11px] text-[var(--text-faint)]">
          {mode === 'edit'
            ? 'Sent on its own — the style block is not included.'
            : <>Sent as <code>#&nbsp;Create</code> after the style block.</>}
        </p>
      </div>

      {/* Controls */}
      <div className="card p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Model">
            <select className="input" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
              {IMAGE_MODELS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Quality">
            <select className="input" value={quality} onChange={(e) => setQuality(e.target.value)} disabled={busy}>
              {IMAGE_QUALITIES.map((q) => <option key={q}>{q}</option>)}
            </select>
          </Field>
          <Field label="Output format">
            <select className="input" value={format} onChange={(e) => setFormat(e.target.value)} disabled={busy}>
              {IMAGE_FORMATS.map((f) => <option key={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Compression (0–100)">
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              placeholder="60"
              value={compression}
              onChange={(e) => setCompression(e.target.value)}
              disabled={busy || lossless}
            />
            {lossless && <p className="text-[11px] text-[var(--text-faint)] mt-1">N/A — PNG is lossless</p>}
          </Field>
        </div>

        <div>
          <div className="flex items-end gap-3 flex-wrap">
            <Field label="Size">
              <select
                className="input min-w-[15rem]"
                value={IMAGE_SIZES.some((o) => o.w === width && o.h === height) ? `${width}x${height}` : 'custom'}
                onChange={(e) => {
                  if (e.target.value === 'custom') return;
                  const [w, h] = e.target.value.split('x').map(Number);
                  setWidth(w); setHeight(h);
                }}
                disabled={busy}
              >
                {IMAGE_SIZES.map((o) => (
                  <option key={`${o.w}x${o.h}`} value={`${o.w}x${o.h}`}>
                    {o.w} × {o.h} — {o.label}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </Field>
            <Field label="Width (px)">
              <input className="input w-28" type="number" value={width}
                onChange={(e) => setWidth(Number(e.target.value) || 0)} disabled={busy} />
            </Field>
            <span className="text-[var(--text-faint)] pb-2.5">×</span>
            <Field label="Height (px)">
              <input className="input w-28" type="number" value={height}
                onChange={(e) => setHeight(Number(e.target.value) || 0)} disabled={busy} />
            </Field>
            <span className={`pill text-xs py-1 mb-0.5 ${valid ? 'pill-success' : 'pill-error'}`}>
              {valid ? '✓ Valid' : '✗ Invalid'}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {checks.map((c) => (
              <span
                key={c.label}
                className={`text-[11px] rounded-md px-2 py-1 border ${
                  c.ok
                    ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/8'
                    : 'text-red-300 border-red-500/30 bg-red-500/8'
                }`}
              >
                {c.ok ? '✓' : '✗'} {c.label}
              </span>
            ))}
          </div>
        </div>

        {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 p-3 text-sm">{err}</div>}

        <button
          className="btn-primary flex items-center gap-2"
          onClick={generate}
          disabled={busy || !valid || !instructions.trim()}
        >
          {busy && <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" />}
          {busy ? (mode === 'edit' ? 'Editing…' : 'Generating…') : mode === 'edit' ? 'Apply edit' : 'Generate'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold">Generated image</p>
              <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                {result.size} · {result.filename}
                {result.format && result.requestedFormat && result.format !== result.requestedFormat &&
                  ` · returned ${result.format}, not ${result.requestedFormat}`}
                {result.usedReference && ' · style reference used'}
                {result.usedSubject && ' · recreated from image'}
                {result.styleApplied === false && ' · house style not applied'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                className="btn-secondary text-xs py-1.5 px-4"
                onClick={() => {
                  // Carry the result into edit mode without re-uploading it.
                  setMode('edit');
                  setSourceUrl(result.url);
                  pickFile(null);
                  setSourceUrl(result.url);
                  setRefPreview(result.url);
                  setInstructions('');
                  setErr('');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                Edit this image
              </button>
              <a href={result.url} download={result.filename} className="btn-primary text-xs py-1.5 px-4">
                Download
              </a>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className="block w-full cursor-zoom-in rounded-xl border border-[var(--border)] bg-white overflow-hidden focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            title="Click to zoom"
          >
            <img src={result.url} alt="Generated" className="w-full block" />
          </button>
          <p className="text-[11px] text-[var(--text-faint)]">Click the image to view it full size.</p>
        </div>
      )}

      {/* Zoom overlay */}
      {zoomed && result && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setZoomed(false)}
        >
          <img
            src={result.url}
            alt="Generated, full size"
            className="max-w-full max-h-full object-contain rounded-lg bg-white"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute top-4 right-4 flex items-center gap-2">
            {/* Explicit light styling: these sit on the dark overlay, not on a
                themed surface, so the themed button classes are unreadable here. */}
            <a
              href={result.url}
              download={result.filename}
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-medium py-1.5 px-3 rounded-lg bg-white/95 text-slate-900 border border-white/70 hover:bg-white transition-colors shadow-sm"
            >
              Download
            </a>
            <button
              onClick={(e) => { e.stopPropagation(); setZoomed(false); }}
              className="text-xs font-medium py-1.5 px-3 rounded-lg bg-white/15 text-white border border-white/50 hover:bg-white/25 transition-colors backdrop-blur-sm"
              aria-label="Close"
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
