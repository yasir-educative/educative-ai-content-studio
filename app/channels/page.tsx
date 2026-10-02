'use client';

// Publishing destinations manager.
//
// Credentials are write-only from the browser's point of view: the API returns secrets as a
// mask, and sending that mask back means "keep what's stored". So an existing channel can be
// renamed or re-pointed without ever re-entering its password.

import { useEffect, useState } from 'react';
import { Field } from '../_components/Field';

type ChannelType = 'educative' | 'wordpress' | 'devto' | 'substack';

interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  config: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

const TYPE_LABEL: Record<ChannelType, string> = {
  educative: 'Educative',
  wordpress: 'WordPress',
  devto: 'dev.to',
  substack: 'Substack',
};

const TYPE_DOT: Record<ChannelType, string> = {
  educative: '#6366f1',
  wordpress: '#21759b',
  devto: '#a78bfa',
  substack: '#ff6719',
};

function blankConfig(type: ChannelType): Record<string, any> {
  if (type === 'wordpress') {
    return { siteUrl: '', username: '', appPassword: '', postType: 'posts', defaultStatus: 'draft' };
  }
  if (type === 'devto') {
    return {
      apiKey: '', organizationId: '', defaultPublished: false, tags: '', series: '',
      useFirstImageAsCover: true,
      githubOwner: '', githubRepo: '', githubBranch: 'main', githubPathPrefix: 'images', githubToken: '',
      publicBaseUrl: '',
    };
  }
  if (type === 'substack') {
    return {
      publicationUrl: '', cookiesString: '', subtitle: '', cliPath: '',
      githubOwner: '', githubRepo: '', githubBranch: 'main', githubPathPrefix: 'images', githubToken: '',
      publicBaseUrl: '',
    };
  }
  return { templateId: '', categories: '', pageType: 'blog', flaskAuth: '' };
}

/** Shared GitHub image-host fields — dev.to and Substack both link public image URLs. */
function GitHubImageFields({
  config,
  set,
  secretHint,
  why,
}: {
  config: Record<string, any>;
  set: (k: string, v: any) => void;
  secretHint?: string;
  why: string;
}) {
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)' }}>
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
        Image hosting
      </div>
      <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>{why}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="GitHub owner" hint="User or organization that owns the repo.">
          <input className="input" placeholder="my-username" value={config.githubOwner || ''} onChange={(e) => set('githubOwner', e.target.value)} />
        </Field>
        <Field label="Repository" hint="Must be public so readers can load the images.">
          <input className="input" placeholder="devto-blog-assets" value={config.githubRepo || ''} onChange={(e) => set('githubRepo', e.target.value)} />
        </Field>
        <Field label="Branch">
          <input className="input" placeholder="main" value={config.githubBranch || ''} onChange={(e) => set('githubBranch', e.target.value)} />
        </Field>
        <Field label="Path prefix" hint="Images land in {'{prefix}/{article-key}/'}.">
          <input className="input" placeholder="images" value={config.githubPathPrefix || ''} onChange={(e) => set('githubPathPrefix', e.target.value)} />
        </Field>
        <Field label="GitHub token" hint={secretHint ?? 'Fine-grained token scoped to this repository, Contents: Read and write.'} className="sm:col-span-2">
          <input className="input" type="password" autoComplete="new-password" value={config.githubToken || ''} onChange={(e) => set('githubToken', e.target.value)} />
        </Field>
        <Field
          label="Public base URL"
          hint="Fallback used only when GitHub is not configured — this app's public origin."
          className="sm:col-span-2"
        >
          <input className="input" placeholder="https://studio.example.com" value={config.publicBaseUrl || ''} onChange={(e) => set('publicBaseUrl', e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

// Declared at module scope, not inside ChannelsPage: a component defined during render is a new
// type on every keystroke, which remounts the inputs and drops focus mid-typing.
function ConfigForm({
  type,
  config,
  onChange,
  isNew,
}: {
  type: ChannelType;
  config: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  isNew: boolean;
}) {
  const set = (k: string, v: any) => onChange({ ...config, [k]: v });
  const secretHint = isNew ? undefined : 'Leave as •••••••• to keep the stored value.';

  if (type === 'wordpress') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Site URL" hint="e.g. https://grokkingfrontend.com — no trailing slash." className="sm:col-span-2">
          <input className="input" placeholder="https://example.com" value={config.siteUrl || ''} onChange={(e) => set('siteUrl', e.target.value)} />
        </Field>
        <Field label="Username" hint="A WP user that can upload media and create posts.">
          <input className="input" autoComplete="off" value={config.username || ''} onChange={(e) => set('username', e.target.value)} />
        </Field>
        <Field label="Application password" hint={secretHint ?? 'Users → Profile → Application Passwords. Not the login password.'}>
          <input className="input" type="password" autoComplete="new-password" value={config.appPassword || ''} onChange={(e) => set('appPassword', e.target.value)} />
        </Field>
        <Field label="Create as">
          <select className="input" value={config.postType || 'posts'} onChange={(e) => set('postType', e.target.value)}>
            <option value="posts">Post</option>
            <option value="pages">Page</option>
          </select>
        </Field>
        <Field label="Default status">
          <select className="input" value={config.defaultStatus || 'draft'} onChange={(e) => set('defaultStatus', e.target.value)}>
            <option value="draft">Draft</option>
            <option value="pending">Pending review</option>
            <option value="private">Private</option>
            <option value="publish">Published</option>
          </select>
        </Field>
      </div>
    );
  }

  if (type === 'devto') {
    return (
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="API key" hint={secretHint ?? 'dev.to → Settings → Extensions → DEV Community API Keys.'} className="sm:col-span-2">
            <input className="input" type="password" autoComplete="new-password" value={config.apiKey || ''} onChange={(e) => set('apiKey', e.target.value)} />
          </Field>
          <Field label="Organization ID" hint="Optional — publish under an org instead of your account.">
            <input className="input" value={config.organizationId || ''} onChange={(e) => set('organizationId', e.target.value)} />
          </Field>
          <Field label="Series" hint="Optional — groups articles into a dev.to series.">
            <input className="input" value={config.series || ''} onChange={(e) => set('series', e.target.value)} />
          </Field>
          <Field label="Tags" hint="Comma-separated, max 4, letters and digits only." className="sm:col-span-2">
            <input className="input" placeholder="systemdesign, backend" value={config.tags || ''} onChange={(e) => set('tags', e.target.value)} />
          </Field>
        </div>

        <GitHubImageFields
          config={config}
          set={set}
          secretHint={secretHint}
          why="dev.to has no image-upload API, so generated images are pushed to a public GitHub repository first and linked by commit-pinned raw URL. The token needs Contents: Read and write on that repo."
        />

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
            <input type="checkbox" checked={config.useFirstImageAsCover !== false} onChange={(e) => set('useFirstImageAsCover', e.target.checked)} />
            Use the first image as the article cover (main_image)
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
            <input type="checkbox" checked={!!config.defaultPublished} onChange={(e) => set('defaultPublished', e.target.checked)} />
            Publish immediately (unchecked keeps it as a dev.to draft)
          </label>
        </div>
      </div>
    );
  }

  if (type === 'substack') {
    return (
      <div className="space-y-5">
        <div
          className="rounded-lg px-3 py-2 text-[11px]"
          style={{ background: 'var(--accent-soft)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}
        >
          <strong style={{ color: 'var(--text)' }}>Drafts only.</strong> Substack has no verified official
          publishing API, so this uses the community <code>python-substack</code> CLI with your signed-in
          session cookie. This channel creates an unpublished draft and stops — it never publishes and never
          emails subscribers. Review and publish from the Substack editor.
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Publication URL" hint="e.g. https://yourpublication.substack.com" className="sm:col-span-2">
            <input className="input" placeholder="https://yourpublication.substack.com" value={config.publicationUrl || ''} onChange={(e) => set('publicationUrl', e.target.value)} />
          </Field>
          <Field
            label="Session Cookie header"
            hint={secretHint ?? 'Sign in to Substack → DevTools → Network → pick an authenticated request → copy its complete Cookie header. It grants account access and expires periodically.'}
            className="sm:col-span-2"
          >
            <textarea className="input min-h-[72px] font-mono text-xs" autoComplete="new-password" value={config.cookiesString || ''} onChange={(e) => set('cookiesString', e.target.value)} />
          </Field>
          <Field label="Default subtitle" hint="Used when a run supplies no summary.">
            <input className="input" value={config.subtitle || ''} onChange={(e) => set('subtitle', e.target.value)} />
          </Field>
          <Field label="CLI path" hint='Blank uses "substack" on PATH. Point at your virtualenv, e.g. /opt/venv/bin/substack.'>
            <input className="input" placeholder="substack" value={config.cliPath || ''} onChange={(e) => set('cliPath', e.target.value)} />
          </Field>
        </div>

        <GitHubImageFields
          config={config}
          set={set}
          secretHint={secretHint}
          why="Images are linked as absolute URLs rather than uploaded through the client, so the same public GitHub repo used for dev.to works here. The token needs Contents: Read and write on that repo."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
        The default Educative channel uses EDUCATIVE_FLASK_AUTH from the environment. Add another
        only to publish as a different account — the flask-auth cookie is what separates them.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="flask-auth cookie"
          hint={secretHint ?? 'The cookie value only, without the "flask-auth=" prefix. Blank uses EDUCATIVE_FLASK_AUTH.'}
          className="sm:col-span-2"
        >
          <input className="input" type="password" autoComplete="new-password" value={config.flaskAuth || ''} onChange={(e) => set('flaskAuth', e.target.value)} />
        </Field>
        <Field label="Template ID" hint="Blank uses EDUCATIVE_TEMPLATE_ID from the environment.">
          <input className="input" value={config.templateId || ''} onChange={(e) => set('templateId', e.target.value)} />
        </Field>
        <Field label="Page type">
          <select className="input" value={config.pageType || 'blog'} onChange={(e) => set('pageType', e.target.value)}>
            <option value="blog">Blog</option>
            <option value="newsletter">Newsletter</option>
          </select>
        </Field>
        <Field label="Categories" hint="Optional category payload passed through to the editor." className="sm:col-span-2">
          <input className="input" value={config.categories || ''} onChange={(e) => set('categories', e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

export default function ChannelsPage() {
  const [items, setItems] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<ChannelType>('wordpress');
  const [newName, setNewName] = useState('');
  const [newConfig, setNewConfig] = useState<Record<string, any>>(blankConfig('wordpress'));

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editConfig, setEditConfig] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const [trashed, setTrashed] = useState<{ id: string; name: string; type: ChannelType; deletedAt: string; file: string }[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/channels');
      const json = await res.json();
      setItems(json.channels || []);
      setTrashed(json.trashed || []);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  function pickType(t: ChannelType) {
    setNewType(t);
    setNewConfig(blankConfig(t));
  }

  async function create() {
    setErr('');
    if (!newName.trim()) { setErr('Name is required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, type: newType, config: newConfig }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to create channel');
      setAdding(false);
      setNewName('');
      setNewConfig(blankConfig(newType));
      await refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(c: Channel) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditConfig({ ...blankConfig(c.type), ...c.config });
    setErr('');
  }

  async function save(id: string) {
    setSaving(true);
    setErr('');
    try {
      const res = await fetch(`/api/channels/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, config: editConfig }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to save channel');
      setEditingId(null);
      await refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function restore(file: string) {
    setErr('');
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restore: file }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Restore failed');
      await refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  async function remove(c: Channel) {
    if (!confirm(`Delete the channel "${c.name}"? It moves to the trash below and can be restored.`)) return;
    setErr('');
    try {
      const res = await fetch(`/api/channels/${c.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to delete channel');
      await refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  async function test(c: Channel) {
    setTesting(c.id);
    setTestResult((r) => ({ ...r, [c.id]: { ok: false, message: 'Testing…' } }));
    try {
      const res = await fetch(`/api/channels/${c.id}/test`, { method: 'POST' });
      const json = await res.json();
      setTestResult((r) => ({
        ...r,
        [c.id]: { ok: !!json?.ok, message: json?.ok ? json.detail : json?.error || 'Test failed' },
      }));
    } catch (e: any) {
      setTestResult((r) => ({ ...r, [c.id]: { ok: false, message: e?.message || String(e) } }));
    } finally {
      setTesting(null);
    }
  }

  function summaryOf(c: Channel): string {
    if (c.type === 'wordpress') {
      return `${c.config?.siteUrl || 'no site URL'} · ${c.config?.postType === 'pages' ? 'pages' : 'posts'} · ${c.config?.defaultStatus || 'draft'}`;
    }
    if (c.type === 'devto') {
      const host = c.config?.githubOwner && c.config?.githubRepo
        ? `github.com/${c.config.githubOwner}/${c.config.githubRepo}`
        : c.config?.publicBaseUrl || 'no image host';
      return `${c.config?.defaultPublished ? 'publish live' : 'draft'} · images via ${host}`;
    }
    if (c.type === 'substack') {
      const host = c.config?.githubOwner && c.config?.githubRepo
        ? `github.com/${c.config.githubOwner}/${c.config.githubRepo}`
        : c.config?.publicBaseUrl || 'no image host';
      return `${c.config?.publicationUrl || 'no publication URL'} · drafts only · images via ${host}`;
    }
    return `${c.config?.pageType || 'blog'}${c.config?.templateId ? ` · template ${c.config.templateId}` : ''}${c.config?.flaskAuth ? ' · own cookie' : ' · env cookie'}`;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
            Publishing channels
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-dim)' }}>
            Shared by every pipeline — a channel added here is available from the Publish button on
            both blogs and newsletters. Add one WordPress channel per domain.
          </p>
        </div>
        {!adding && (
          <button className="btn-primary shrink-0" onClick={() => { setAdding(true); pickType('wordpress'); }}>
            Add channel
          </button>
        )}
      </div>

      {err && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
          {err}
        </div>
      )}

      {adding && (
        <div className="card space-y-5 p-6">
          <div className="flex gap-2">
            {(['wordpress', 'devto', 'substack', 'educative'] as ChannelType[]).map((t) => (
              <button
                key={t}
                className={`btn-secondary text-xs${newType === t ? ' ring-1 ring-[var(--accent)]' : ''}`}
                onClick={() => pickType(t)}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <Field label="Channel name" hint="How it appears in the Publish menu, e.g. “Grokking Frontend”.">
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <ConfigForm type={newType} config={newConfig} onChange={setNewConfig} isNew />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={saving} onClick={create}>
              {saving ? 'Saving…' : 'Add channel'}
            </button>
            <button className="btn-secondary" onClick={() => { setAdding(false); setErr(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text-dim)' }}>Loading…</div>
      ) : (
        <div className="space-y-3">
          {items.map((c) => {
            const isEditing = editingId === c.id;
            const result = testResult[c.id];
            return (
              <div key={c.id} className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_DOT[c.type] }} />
                      <span className="font-medium" style={{ color: 'var(--text)' }}>{c.name}</span>
                      <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{TYPE_LABEL[c.type]}</span>
                    </div>
                    <div className="mt-1 truncate text-xs" style={{ color: 'var(--text-dim)' }}>{summaryOf(c)}</div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button className="btn-secondary text-xs" disabled={testing === c.id} onClick={() => test(c)}>
                      {testing === c.id ? 'Testing…' : 'Test'}
                    </button>
                    {isEditing ? (
                      <button className="btn-secondary text-xs" onClick={() => setEditingId(null)}>Cancel</button>
                    ) : (
                      <button className="btn-secondary text-xs" onClick={() => startEdit(c)}>Edit</button>
                    )}
                    <button className="btn-secondary text-xs" onClick={() => remove(c)}>Delete</button>
                  </div>
                </div>

                {result && (
                  <div className="mt-3 text-xs" style={{ color: result.ok ? 'var(--success-text)' : 'var(--warning-text)' }}>
                    {result.ok ? '✓ ' : '⚠ '}{result.message}
                  </div>
                )}

                {isEditing && (
                  <div className="mt-5 space-y-5 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
                    <Field label="Channel name">
                      <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </Field>
                    <ConfigForm type={c.type} config={editConfig} onChange={setEditConfig} isNew={false} />
                    <div className="flex gap-2">
                      <button className="btn-primary" disabled={saving} onClick={() => save(c.id)}>
                        {saving ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!items.length && (
            <div className="card p-6 text-sm" style={{ color: 'var(--text-dim)' }}>
              No channels yet. Add one to start publishing.
            </div>
          )}

          {trashed.length > 0 && (
            <details className="card p-5">
              <summary className="cursor-pointer text-sm" style={{ color: 'var(--text-dim)' }}>
                Recently deleted ({trashed.length}) — credentials are kept so a channel can be put back
              </summary>
              <div className="mt-4 space-y-2">
                {trashed.map((t) => (
                  <div key={t.file} className="flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <span style={{ color: 'var(--text)' }}>{t.name}</span>{' '}
                      <span style={{ color: 'var(--text-faint)' }}>({TYPE_LABEL[t.type]} · deleted {t.deletedAt.slice(0, 10)})</span>
                    </div>
                    <button className="btn-secondary text-xs shrink-0" onClick={() => restore(t.file)}>Restore</button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
