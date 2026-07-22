export type StageItem = { name: string; status: 'start' | 'done' | 'error' };

const PRETTY: Record<string, string> = {
  research: 'Web research',
  outline: 'Outline draft',
  'topic-research': 'Topic research',
  'json-outline': 'JSON outline',
  'outline-review': 'Outline review',
  'text-generation': 'Drafting article',                  // legacy — pre-rename runs
  'text-generator': 'Text generator',                     // default + CIP path
  'projects-text-generator': 'Projects content generator',
  'projects-reviewer': 'Projects reviewer',
  'medium-dna': 'Medium structural DNA',
  'cip-final-pass': 'CIP final pass',
  'zachgpt-review': 'ZachGPT review',
  'zachgpt-incorporate': 'Incorporate edits',
  'seo-keywords': 'SEO keywords',
  'seo-editor': 'SEO editor pass',
  'widgets-extract': 'Extract widgets',
  'widgets-generate': 'Generate widgets',
  'pr-reviewer': 'PR reviewer (incorporate edits)',
  'markdown-to-html': 'Markdown → HTML',
  'structure-output': 'Structure output',
  'sanitize-format': 'Sanitize & format',
  'editor-blocks': 'Make editor blocks (fan-in widgets + HTML)',
  publish: 'Publish to Educative',
  'image-extraction': 'Extract image cards',
  'image-generation': 'Generate images (gpt-image-2)',
};

export const STAGE_LABELS = PRETTY;

// Widget sub-stages clutter the high-level pipeline tracker; they're already shown as sub-tabs
// inside StageOutputs. Filter them out of the progress card and surface only one synthetic
// "Generate widgets" row whose status reflects the slowest sub-stage.
const WIDGET_SUB_RE = /^(code-generator|table-generator|table-research|image-enhancer|chart-generator|d2-generator|d2-svg-upload|image-generate)#/;

export function Stages({ items }: { items: StageItem[] }) {
  if (!items.length) return null;
  // collapse to one entry per name with latest status
  const map = new Map<string, StageItem>();
  for (const it of items) map.set(it.name, it);
  // Drop per-widget sub-stages from the tracker.
  for (const k of Array.from(map.keys())) {
    if (WIDGET_SUB_RE.test(k)) map.delete(k);
  }
  const list = Array.from(map.values());
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Pipeline progress</h3>
        <span className="text-[11px] text-[var(--text-faint)]">{list.filter((s) => s.status === 'done').length}/{list.length} stages</span>
      </div>
      <ul className="grid sm:grid-cols-2 gap-2">
        {list.map((s) => (
          <li
            key={s.name}
            className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2"
          >
            <span
              className={
                s.status === 'done'
                  ? 'h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)]'
                  : s.status === 'error'
                  ? 'h-2 w-2 rounded-full bg-red-400'
                  : 'h-2 w-2 rounded-full bg-amber-400 dot-running shadow-[0_0_8px_rgba(245,158,11,0.7)]'
              }
            />
            <span className="text-sm flex-1 truncate">{PRETTY[s.name] || s.name}</span>
            <span
              className={
                s.status === 'done'
                  ? 'pill pill-success'
                  : s.status === 'error'
                  ? 'pill pill-error'
                  : 'pill pill-running'
              }
            >
              {s.status === 'done' ? 'done' : s.status === 'error' ? 'error' : 'running'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
