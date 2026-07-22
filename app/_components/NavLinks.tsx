'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signIn } from 'next-auth/react';

const items = [
  { href: '/',               label: 'Home',          public: true  },
  { href: '/blogs',          label: 'Blogs',         public: false },
  { href: '/newsletter',     label: 'Newsletter',    public: false },
  { href: '/course',         label: 'Course',        public: false },
  { href: '/mobile-course',  label: 'Mobile Course', public: false },
];

export function NavLinks() {
  const pathname = usePathname();
  const { status } = useSession();
  const authed = status === 'authenticated';

  return (
    <nav className="flex items-center gap-1">
      {items.map((it) => {
        const active =
          it.href === '/blogs'
            ? pathname === '/blogs' ||
              pathname?.startsWith('/blogs/') ||
              pathname === '/blog' ||
              !!pathname?.match(/^\/blog\/.+/) ||
              pathname === '/outline'
            : it.href === '/newsletter'
            ? pathname === '/newsletter' || !!pathname?.match(/^\/newsletter\/.+/)
            : it.href === '/'
            ? pathname === '/'
            : pathname === it.href || pathname?.startsWith(it.href + '/');

        if (!it.public && !authed) {
          return (
            <button
              key={it.href}
              onClick={() => signIn('google', { callbackUrl: it.href })}
              className={`nav-link ${active ? 'active' : ''}`}
            >
              {it.label}
            </button>
          );
        }

        return (
          <Link key={it.href} href={it.href} className={`nav-link ${active ? 'active' : ''}`}>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
