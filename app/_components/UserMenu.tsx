'use client';

import { useSession, signIn, signOut } from 'next-auth/react';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

const TOOL_LINKS = [
  { href: '/graph',    label: 'Pipeline Graph' },
  { href: '/personas', label: 'Personas' },
  { href: '/prompts',  label: 'Prompts' },
];

export function UserMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (status === 'loading') {
    return (
      <div className="h-8 w-8 rounded-lg border border-[var(--border)] bg-[var(--panel)] animate-pulse" />
    );
  }

  if (status === 'unauthenticated') {
    return (
      <button
        onClick={() => signIn('google')}
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-xs font-medium text-[var(--text-dim)] hover:text-white hover:border-[var(--accent)] transition"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Sign in
      </button>
    );
  }

  const user = session?.user;
  const isAdmin = (user as any)?.isAdmin;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 transition hover:border-[var(--accent)]"
        title={user?.name || user?.email || ''}
      >
        {user?.image ? (
          <img
            src={user.image}
            alt=""
            className="h-6 w-6 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="h-6 w-6 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-[10px] font-bold text-white">
            {(user?.name || user?.email || '?')[0].toUpperCase()}
          </span>
        )}
        {isAdmin && (
          <span className="pill text-[8px] py-0.5 px-1.5" style={{ color: '#c4b5fd', borderColor: 'rgba(139,92,246,0.4)', background: 'rgba(139,92,246,0.08)' }}>
            Admin
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <p className="text-sm font-medium truncate">{user?.name}</p>
            <p className="text-xs text-[var(--text-faint)] truncate">{user?.email}</p>
          </div>

          <div className="border-b border-[var(--border)] py-1">
            {TOOL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-[var(--text-dim)] hover:bg-[var(--panel)] hover:text-white transition"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <button
            onClick={() => signOut()}
            className="w-full px-4 py-2.5 text-left text-sm text-[var(--text-dim)] hover:bg-[var(--panel)] hover:text-white transition"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
