import './globals.css';
import type { Metadata } from 'next';
import { AppShell } from './_components/AppShell';

export const metadata: Metadata = {
  title: 'Educative — AI Content Studio',
  description: 'Generate expert-level technical blogs, newsletters, course lessons, and mobile courses powered by a multi-stage AI pipeline.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
