'use client';

// Model tier settings.
//
// Two choices drive every LLM agent in every pipeline. The list of models is fetched live from
// the OpenAI key, so it can only ever offer something that will actually run.

import { useEffect, useState } from 'react';
import { Field } from '../_components/Field';

interface ModelConfig { mainModel: string; normalModel: string; updatedAt?: string }

/** Which agents run on which tier — mirrors the `tier:` tags in the pipeline source. */
const AGENTS: { tier: 'main' | 'normal'; pipeline: string; agents: string[] }[] = [
  { tier: 'main', pipeline: 'Blog',           agents: ['outline-generator', 'json-outline', 'genai-json-outline', 'text-generator', 'projects-text-generator', 'projects-reviewer', 'cip-final-pass'] },
  { tier: 'main', pipeline: 'Newsletter',     agents: ['json-outline', 'text-generator', 'technical-blog-text-generator'] },
  { tier: 'main', pipeline: 'Course',         agents: ['json-outline', 'content-creator'] },
  { tier: 'main', pipeline: 'Mobile Course',  agents: ['architect', 'card-planner', 'cards-generator'] },
  { tier: 'main', pipeline: 'Mobile Short',   agents: ['cards-generator'] },
  { tier: 'normal', pipeline: 'Blog',         agents: ['medium-dna', 'zachgpt-review', 'zachgpt-incorporate', 'seo-editor', 'pr-reviewer', 'code-generator', 'table-generator'] },
  { tier: 'normal', pipeline: 'Newsletter',   agents: ['zachgpt-review', 'zachgpt-incorporate', 'seo-editor', 'pr-reviewer', 'code-generator', 'table-generator'] },
  { tier: 'normal', pipeline: 'Course',       agents: ['summary-elements', 'pr-reviewer', 'widget-code', 'widget-table', 'widget-runjs'] },
  { tier: 'normal', pipeline: 'Mobile Course',agents: ['text-refiner', 'json-generator'] },
  { tier: 'normal', pipeline: 'Mobile Short', agents: ['json-generator'] },
];

function TierList({ tier }: { tier: 'main' | 'normal' }) {
  const rows = AGENTS.filter((a) => a.tier === tier);
  return (
    <div className="mt-3 space-y-1.5">
      {rows.map((r) => (
        <div key={r.pipeline} className="flex gap-2 text-[11px]">
          <span className="w-28 shrink-0" style={{ color: 'var(--text-faint)' }}>{r.pipeline}</span>
          <span className="font-mono leading-relaxed" style={{ color: 'var(--text-dim)' }}>{r.agents.join(', ')}</span>
        </div>
      ))}
    </div>
  );
}

export default function ModelsPage() {
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [defaults, setDefaults] = useState<ModelConfig | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState('');
  const [searchModel, setSearchModel] = useState('');
  const [main, setMain] = useState('');
  const [normal, setNormal] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    const res = await fetch('/api/models');
    const j = await res.json();
    setConfig(j.config);
    setDefaults(j.defaults);
    setModels(j.models || []);
    setModelsError(j.modelsError || '');
    setSearchModel(j.searchModel || '');
    setMain(j.config.mainModel);
    setNormal(j.config.normalModel);
  }
  useEffect(() => { load(); }, []);

  async function save(reset = false) {
    setSaving(true); setMsg(''); setErr('');
    try {
      const res = await fetch('/api/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reset ? { reset: true } : { mainModel: main, normalModel: normal }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Save failed');
      await load();
      setMsg(reset ? 'Reset to the environment defaults.' : 'Saved. New runs use these models immediately.');
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  /** A stored model that the key no longer offers would silently 400 at run time. */
  const unknown = (m: string) => !!m && models.length > 0 && !models.includes(m);

  function Picker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
      <>
        <select className="input" value={models.includes(value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
          {!models.includes(value) && <option value="">{value ? `${value} (not in your account)` : 'Select a model'}</option>}
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {unknown(value) && (
          <span className="text-[11px]" style={{ color: 'var(--warning-text)' }}>
            ⚠ “{value}” is not available on this API key — calls using it will fail.
          </span>
        )}
      </>
    );
  }

  const dirty = !!config && (main !== config.mainModel || normal !== config.normalModel);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Models</h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--text-dim)' }}>
          Two models drive every pipeline. Changes apply to new runs immediately — no restart.
        </p>
      </div>

      {modelsError && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: 'var(--warning-text)' }}>
          Could not list models from OpenAI: {modelsError}
        </div>
      )}

      {!config ? (
        <div className="text-sm" style={{ color: 'var(--text-dim)' }}>Loading…</div>
      ) : (
        <>
          <div className="card p-6 space-y-3">
            <Field label="Main model" hint="Outline architects and text generators — the agents that decide structure and write the prose.">
              <Picker value={main} onChange={setMain} />
            </Field>
            <details>
              <summary className="cursor-pointer text-[11px]" style={{ color: 'var(--text-faint)' }}>
                Which agents use this
              </summary>
              <TierList tier="main" />
            </details>
          </div>

          <div className="card p-6 space-y-3">
            <Field label="Normal model" hint="Everything else — reviewers, rewriters, widget builders and format normalisers.">
              <Picker value={normal} onChange={setNormal} />
            </Field>
            <details>
              <summary className="cursor-pointer text-[11px]" style={{ color: 'var(--text-faint)' }}>
                Which agents use this
              </summary>
              <TierList tier="normal" />
            </details>
          </div>

          <div className="card p-6">
            <Field label="Web search model" hint="Set by OPENAI_SEARCH_MODEL in the environment — a separate capability, not configurable here.">
              <input className="input" value={searchModel} disabled readOnly />
            </Field>
            <p className="mt-3 text-[11px]" style={{ color: 'var(--text-faint)' }}>
              Used by topic research, SEO keywords and table research. Images are pinned to gpt-image-2.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={saving || !dirty} onClick={() => save(false)}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-secondary" disabled={saving} onClick={() => save(true)}>
              Reset to env defaults
            </button>
            {defaults && (
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                defaults: {defaults.mainModel} / {defaults.normalModel}
              </span>
            )}
          </div>

          {msg && <div className="text-sm" style={{ color: 'var(--success-text)' }}>{msg}</div>}
          {err && <div className="text-sm" style={{ color: 'var(--danger-text)' }}>{err}</div>}
        </>
      )}
    </div>
  );
}
