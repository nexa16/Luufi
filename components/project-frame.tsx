'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { PrimaryNavigation } from '@/components/primary-navigation';

const button =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 disabled:opacity-50';
const label = 'text-xs font-bold uppercase tracking-[0.12em] text-lime-300';

export function Frame({
  title,
  eyebrow = 'Luufi',
  children,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-5 pb-32 pt-7 sm:px-8 sm:pt-12">
      <header className="mb-7">
        <p className={label}>{eyebrow}</p>
        <h1 className="mt-2 break-words text-3xl font-bold tracking-tight text-white">
          {title}
        </h1>
      </header>
      {children}
      <PrimaryNavigation active="projects" />
    </main>
  );
}

export function ProjectNavigation({
  projectId,
  active,
}: {
  projectId: string;
  active: 'overview' | 'feedback' | 'milestones' | 'orders' | 'versions';
}) {
  const root = `/projects/${encodeURIComponent(projectId)}`;
  return (
    <nav aria-label="Projektnavigation" className="mb-7 flex flex-wrap gap-2">
      <Link href="/" className={button}>
        Alle Projekte
      </Link>
      {(
        [
          ['overview', 'Übersicht', root],
          ['feedback', 'Feedback', `${root}/feedback`],
          ['milestones', 'Milestones', `${root}/milestones`],
          ['orders', 'Aufträge', `${root}/orders`],
          ['versions', 'Versionen', `${root}/versions`],
        ] as const
      ).map(([key, text, href]) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? 'page' : undefined}
          className={`${button} ${active === key ? 'border-lime-300/50 bg-lime-300/10 text-lime-200' : ''}`}
        >
          {text}
        </Link>
      ))}
    </nav>
  );
}
