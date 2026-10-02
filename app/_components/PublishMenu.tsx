'use client';

// Split publish control: the primary button fires the last-used (or first) channel, the caret
// opens the full destination list. Replaces the old single "Publish to Educative" button.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export interface PublishChannel {
  id: string;
  name: string;
  type: 'educative' | 'wordpress' | 'devto';
  config?: Record<string, any>;
}

const TYPE_LABEL: Record<PublishChannel['type'], string> = {
  educative: 'Educative',
  wordpress: 'WordPress',
  devto: 'dev.to',
};

/** One dot colour per destination type so the list is scannable at a glance. */
const TYPE_DOT: Record<PublishChannel['type'], string> = {
  educative: '#6366f1',
  wordpress: '#21759b',
  devto: '#a78bfa',
};

export interface PublishOutcome {
  channelId: string;
  channelName: string;
  url: string;
  warnings?: string[];
}

interface Props {
  disabled?: boolean;
  /** Called with the chosen channel; resolve/reject drives the button state. */
  onPublish: (channel: PublishChannel) => Promise<void>;
  /** Channels already published to — shown as "Re-publish" in the list. */
  publishedChannelIds?: string[];
  /** Remembers the last destination across renders of the same page. */
  storageKey?: string;
}

export function PublishMenu({ disabled, onPublish, publishedChannelIds = [], storageKey = 'publish:lastChannel' }: Props) {
  const [channels, setChannels] = useState<PublishChannel[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/channels')
      .then((r) => r.json())
      .then((j) => {
        const list: PublishChannel[] = j.channels || [];
        setChannels(list);
        let remembered = '';
        try {
          remembered = localStorage.getItem(storageKey) || '';
        } catch {
          /* private mode / blocked storage — fall through to the first channel */
        }
        setSelected(list.some((c) => c.id === remembered) ? remembered : list[0]?.id || '');
      })
      .catch(() => {});
  }, [storageKey]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function run(channel: PublishChannel) {
    setOpen(false);
    setBusyId(channel.id);
    setSelected(channel.id);
    try {
      localStorage.setItem(storageKey, channel.id);
    } catch {
      /* non-fatal */
    }
    try {
      await onPublish(channel);
    } finally {
      setBusyId(null);
    }
  }

  const active = channels.find((c) => c.id === selected) || channels[0];
  const busy = busyId !== null;
  const isRepublish = active ? publishedChannelIds.includes(active.id) : false;

  if (!channels.length) {
    return (
      <Link href="/channels" className="btn-secondary">
        Set up publishing
      </Link>
    );
  }

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        className="btn-primary rounded-r-none"
        disabled={disabled || busy || !active}
        onClick={() => active && run(active)}
      >
        {busy
          ? `Publishing to ${channels.find((c) => c.id === busyId)?.name || '…'}…`
          : `${isRepublish ? 'Re-publish' : 'Publish'} to ${active?.name || '…'}`}
      </button>
      <button
        className="btn-primary rounded-l-none border-l px-2"
        style={{ borderColor: 'rgba(255,255,255,0.25)' }}
        disabled={disabled || busy}
        aria-label="Choose publishing destination"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>▾</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border shadow-xl"
          style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
        >
          <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
            Publish to
          </div>
          {channels.map((c) => (
            <button
              key={c.id}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--panel-2)]"
              style={{ color: 'var(--text)' }}
              onClick={() => run(c)}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_DOT[c.type] }} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {publishedChannelIds.includes(c.id) ? 'published' : TYPE_LABEL[c.type]}
              </span>
            </button>
          ))}
          <Link
            href="/channels"
            className="block border-t px-3 py-2 text-xs hover:bg-[var(--panel-2)]"
            style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}
          >
            Manage channels →
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Shared renderer for publish results so every page reports destinations identically.
 *
 * De-duplicates by channel: a page may hold both the saved publish history and this session's
 * outcomes, and after a publish both describe the same destination. Later entries win, so a
 * caller passing [...stored, ...session] gets the fresh result.
 */
export function PublishResults({ outcomes, error }: { outcomes: PublishOutcome[]; error?: string }) {
  const byChannel = new Map<string, PublishOutcome>();
  for (const o of outcomes) byChannel.set(o.channelId || o.url, o);
  const unique = [...byChannel.values()];

  if (!unique.length && !error) return null;
  return (
    <div className="space-y-1.5">
      {unique.map((o) => (
        <div key={o.channelId + o.url} className="text-sm">
          <span style={{ color: 'var(--text-dim)' }}>{o.channelName}:</span>{' '}
          <a
            className="underline break-all"
            style={{ color: 'var(--success-text)' }}
            href={o.url}
            target="_blank"
            rel="noreferrer"
          >
            {o.url}
          </a>
          {o.warnings?.map((w, i) => (
            <div key={i} className="text-xs" style={{ color: 'var(--warning-text)' }}>⚠ {w}</div>
          ))}
        </div>
      ))}
      {error && <div className="text-sm" style={{ color: 'var(--danger-text)' }}>{error}</div>}
    </div>
  );
}
