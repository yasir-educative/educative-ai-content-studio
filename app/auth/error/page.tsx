'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function ErrorContent() {
  const params = useSearchParams();
  const error = params.get('error');

  const message =
    error === 'AccessDenied'
      ? 'Your email domain is not allowed to access this application. Please sign in with an authorized account.'
      : error === 'Configuration'
      ? 'There is a problem with the server configuration. Please contact the administrator.'
      : 'An authentication error occurred. Please try again.';

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-6">
      <div className="h-16 w-16 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      </div>
      <div>
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="mt-2 text-sm text-[var(--text-dim)] max-w-md">{message}</p>
      </div>
      <Link href="/" className="btn-primary">
        Back to Home
      </Link>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense>
      <ErrorContent />
    </Suspense>
  );
}
