'use client';

import { useEffect, useState, type RefObject } from 'react';

type Entry = { id: string; text: string; level: number };

function slug(text: string, taken: Set<string>): string {
  const base = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'section';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/**
 * Side rail for the article: reading time plus jump links to every H2/H3.
 * The article HTML comes from the pipeline without heading ids, so they are
 * assigned here, on the live nodes the links scroll to.
 */
export function ArticleToc({ containerRef, contentKey }: { containerRef: RefObject<HTMLElement | null>; contentKey?: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState('');
  const [minutes, setMinutes] = useState(0);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const scan = () => {
      const words = (root.textContent || '').split(/\s+/).filter(Boolean).length;
      setMinutes(Math.max(1, Math.round(words / 230)));
      const taken = new Set<string>();
      const found: Entry[] = [];
      root.querySelectorAll<HTMLElement>('h2, h3').forEach((node) => {
        const text = (node.textContent || '').trim();
        if (!text) return;
        if (!node.id) node.id = slug(text, taken);
        else taken.add(node.id);
        found.push({ id: node.id, text, level: node.tagName === 'H3' ? 3 : 2 });
      });
      setEntries(found);
      return found;
    };
    const found = scan() || [];
    // The article is injected after mount and edited in place, so re-scan on change.
    const mutations = new MutationObserver(() => scan());
    mutations.observe(root, { childList: true, subtree: true });
    const seen = new Map<string, number>();
    const spy = new IntersectionObserver(
      (records) => {
        for (const record of records) seen.set(record.target.id, record.intersectionRatio);
        const visible = [...seen].filter(([, ratio]) => ratio > 0);
        if (visible.length) setActive(visible.sort((a, b) => b[1] - a[1])[0][0]);
      },
      { rootMargin: '-72px 0px -65% 0px', threshold: [0, 1] },
    );
    found.forEach((entry) => {
      const node = document.getElementById(entry.id);
      if (node) spy.observe(node);
    });
    return () => { mutations.disconnect(); spy.disconnect(); };
  }, [containerRef, contentKey]);

  if (entries.length < 2) return null;

  return (
    <nav className="toc hidden min-[1100px]:block" aria-label="On this page">
      <p className="text-[0.68rem] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1">On this page</p>
      <p className="text-xs text-[var(--text-dim)] mb-3">{minutes} min read · {entries.length} sections</p>
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="toc-link"
          data-level={entry.level}
          aria-current={active === entry.id}
          onClick={() => document.getElementById(entry.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          {entry.text}
        </button>
      ))}
    </nav>
  );
}
