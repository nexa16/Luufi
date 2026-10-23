'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { PrimaryNavigation } from '@/components/primary-navigation';
import type { Milestone, Page, Project } from '@/lib/domain/planning';

const button =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 disabled:opacity-50';
const panel =
  'min-w-0 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6';
const label = 'text-xs font-bold uppercase tracking-[0.12em] text-lime-300';

class ReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function readJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    signal,
    headers: { Accept: 'application/json' },
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const message =
      value &&
      typeof value === 'object' &&
      'error' in value &&
      typeof value.error === 'string'
        ? value.error
        : 'Die Daten konnten nicht geladen werden.';
    throw new ReadError(message, response.status);
  }
  return value as T;
}

function readError(error: unknown): ReadError {
  return error instanceof ReadError
    ? error
    : new ReadError(
        'Luufi ist gerade nicht erreichbar. Bitte erneut versuchen.',
        0,
      );
}

type ReadState<T> = {
  url: string;
  data?: T;
  error?: ReadError;
  loading: boolean;
};
function useRead<T>(
  url: string,
  reader: (url: string, signal: AbortSignal) => Promise<T> = readJson<T>,
) {
  const [state, setState] = useState<ReadState<T>>({ url, loading: true });
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState((previous) => ({
      url,
      data: previous.url === url ? previous.data : undefined,
      loading: true,
    }));
    try {
      const data = await reader(url, controller.signal);
      if (!controller.signal.aborted) setState({ url, data, loading: false });
    } catch (error) {
      if (!controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          url,
          error: readError(error),
          loading: false,
        }));
    }
  }, [url, reader]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      active.current?.abort();
    };
  }, [load]);
  const visible: ReadState<T> =
    state.url === url ? state : { url, loading: true };
  return { ...visible, refresh: load };
}

type CollectionState<T> = {
  url: string;
  items: T[];
  nextCursor: string | null;
  failedCursor: string | null;
  loading: boolean;
  error?: ReadError;
};
function useCollection<T extends { id: string }>(url: string) {
  const empty: CollectionState<T> = {
    url,
    items: [],
    nextCursor: null,
    failedCursor: null,
    loading: true,
  };
  const [state, setState] = useState<CollectionState<T>>(empty);
  const active = useRef<AbortController | null>(null);
  const load = useCallback(
    async (cursor: string | null = null) => {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      setState((previous) => ({
        ...previous,
        url,
        items: previous.url === url ? previous.items : [],
        loading: true,
        error: undefined,
        failedCursor: cursor,
      }));
      try {
        const page = await readJson<Page<T>>(
          `${url}${url.includes('?') ? '&' : '?'}limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setState((previous) => {
          const merged = new Map(
            (cursor ? previous.items : []).map((item) => [item.id, item]),
          );
          for (const item of page.items) merged.set(item.id, item);
          return {
            url,
            items: [...merged.values()],
            nextCursor: page.nextCursor,
            failedCursor: null,
            loading: false,
          };
        });
      } catch (error) {
        if (!controller.signal.aborted)
          setState((previous) => ({
            ...previous,
            url,
            error: readError(error),
            loading: false,
          }));
      }
    },
    [url],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      active.current?.abort();
    };
  }, [load]);
  const visible = state.url === url ? state : empty;
  return {
    ...visible,
    refresh: () => load(),
    more: () => load(visible.nextCursor),
    retry: () =>
      load(visible.error?.status === 409 ? null : visible.failedCursor),
  };
}

function LoadFeedback({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error?: ReadError;
  retry: () => Promise<void>;
}) {
  return (
    <>
      {loading && (
        <output className="mb-4 block text-sm text-slate-400">
          Daten werden geladen …
        </output>
      )}
      {error && (
        <div
          role="alert"
          className="mb-5 rounded-2xl border border-red-300/30 bg-red-300/5 p-4 text-sm leading-6 text-red-200"
        >
          <p>{error.message}</p>
          <button
            className={`${button} mt-3`}
            disabled={loading}
            onClick={() => void retry()}
          >
            {error.status === 409 ? 'Liste neu laden' : 'Erneut versuchen'}
          </button>
        </div>
      )}
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-3xl border border-dashed border-white/15 px-5 py-10 text-center leading-7 text-slate-400">
      {children}
    </p>
  );
}

function Frame({
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

function ProjectNavigation({
  projectId,
  active,
}: {
  projectId: string;
  active: 'overview' | 'milestones';
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
          ['milestones', 'Milestones', `${root}/milestones`],
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

function CollectionFooter({
  loading,
  nextCursor,
  more,
}: {
  loading: boolean;
  nextCursor: string | null;
  more: () => Promise<void>;
}) {
  return (
    nextCursor && (
      <button
        className={`${button} mx-auto mt-5 flex`}
        disabled={loading}
        onClick={() => void more()}
      >
        Weitere laden
      </button>
    )
  );
}

export function ProjectCollection() {
  const projects = useCollection<Project>('/api/projects');
  return (
    <Frame title="Projekte">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-lg leading-7 text-slate-400">
          Deine Projekte und ihr nächster Schritt. Die Verwaltung übernimmt
          Codex; hier liest du den aktuellen Stand.
        </p>
        <button
          className={button}
          disabled={projects.loading}
          onClick={() => void projects.refresh()}
        >
          Aktualisieren
        </button>
      </div>
      <LoadFeedback {...projects} retry={projects.retry} />
      {!projects.loading && !projects.error && projects.items.length === 0 && (
        <Empty>
          Noch keine Projekte registriert. Deine eigenständigen Gedanken findest
          du unter Projektideen.
        </Empty>
      )}
      <ul className="grid gap-4 sm:grid-cols-2">
        {projects.items.map((project) => (
          <li key={project.id}>
            <article className={`${panel} h-full`} aria-label={project.name}>
              <p className={label}>{project.key}</p>
              <h2 className="mb-3 mt-2 break-words text-xl font-bold text-white">
                <Link
                  className="underline decoration-lime-300/40 underline-offset-4 focus-visible:outline-lime-300"
                  href={`/projects/${encodeURIComponent(project.id)}`}
                >
                  {project.name}
                </Link>
              </h2>
              <p className="break-words text-sm leading-6 text-slate-400">
                {project.repository}
              </p>
            </article>
          </li>
        ))}
      </ul>
      <CollectionFooter {...projects} />
    </Frame>
  );
}

async function nextMilestone(
  url: string,
  signal: AbortSignal,
): Promise<Milestone | null> {
  let cursor: string | null = null;
  do {
    const page: Page<Milestone> = await readJson(
      `${url}?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      signal,
    );
    const next = page.items.find((milestone) => milestone.state === 'open');
    if (next) return next;
    cursor = page.nextCursor;
  } while (cursor);
  return null;
}

export function ProjectOverview({ projectId }: { projectId: string }) {
  const root = `/api/projects/${encodeURIComponent(projectId)}`;
  const project = useRead<Project>(root);
  const milestone = useRead<Milestone | null>(
    `${root}/milestones`,
    nextMilestone,
  );
  return (
    <Frame
      title={project.data?.name ?? 'Projektübersicht'}
      eyebrow={project.data?.key ?? 'Projekt'}
    >
      <ProjectNavigation projectId={projectId} active="overview" />
      <LoadFeedback {...project} retry={project.refresh} />
      {project.data && (
        <>
          <section className={`${panel} mb-5`} aria-label="Nächster Milestone">
            <h2 className="mb-4 text-lg font-bold text-white">
              Nächster Milestone
            </h2>
            <LoadFeedback {...milestone} retry={milestone.refresh} />
            {milestone.data && (
              <>
                <p className="break-words text-lg font-semibold text-lime-200">
                  {milestone.data.title}
                </p>
                {milestone.data.description && (
                  <p className="mt-2 whitespace-pre-wrap break-words leading-7 text-slate-400">
                    {milestone.data.description}
                  </p>
                )}
                <Link
                  href={`/projects/${encodeURIComponent(projectId)}/milestones`}
                  className={`${button} mt-4`}
                >
                  Milestones ansehen
                </Link>
              </>
            )}
            {milestone.data === null &&
              !milestone.loading &&
              !milestone.error && (
                <p className="leading-7 text-slate-400">
                  Kein offener Milestone geplant.
                </p>
              )}
          </section>
          <section className={panel} aria-label="Projekteinstellungen">
            <h2 className="mb-5 text-lg font-bold text-white">
              Projekteinstellungen
            </h2>
            <dl className="grid gap-5 sm:grid-cols-2">
              <Setting
                title="Kennung"
                value={`${project.data.key} · ${project.data.id}`}
              />
              <Setting title="Repository" value={project.data.repository} />
              <Setting
                title="Integrationsbranch"
                value={project.data.integrationBranch}
              />
              <Setting
                title="Produktionsbranch"
                value={project.data.productionBranch}
              />
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-sm text-slate-400">Dokumentationspfade</dt>
                <dd className="mt-1 break-words text-sm leading-7 text-slate-200">
                  {project.data.documentationPaths.length ? (
                    <ul>
                      {project.data.documentationPaths.map((path) => (
                        <li key={path}>{path}</li>
                      ))}
                    </ul>
                  ) : (
                    'Keine hinterlegt.'
                  )}
                </dd>
              </div>
              <Setting
                title="Bereitstellungshinweise"
                value={project.data.deploymentHints || 'Keine hinterlegt.'}
                wide
              />
            </dl>
          </section>
        </>
      )}
    </Frame>
  );
}

function Setting({
  title,
  value,
  wide = false,
}: {
  title: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-sm text-slate-400">{title}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-7 text-slate-200">
        {value}
      </dd>
    </div>
  );
}

export function MilestoneCollection({ projectId }: { projectId: string }) {
  const milestones = useCollection<Milestone>(
    `/api/projects/${encodeURIComponent(projectId)}/milestones`,
  );
  return (
    <Frame title="Milestones">
      <ProjectNavigation projectId={projectId} active="milestones" />
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-sm leading-6 text-slate-400">
          In der festgelegten Reihenfolge.
        </p>
        <button
          className={button}
          disabled={milestones.loading}
          onClick={() => void milestones.refresh()}
        >
          Aktualisieren
        </button>
      </div>
      <LoadFeedback {...milestones} retry={milestones.retry} />
      {!milestones.loading &&
        !milestones.error &&
        milestones.items.length === 0 && (
          <Empty>Noch keine Milestones geplant.</Empty>
        )}
      <ol className="space-y-4">
        {milestones.items.map((milestone) => (
          <li key={milestone.id}>
            <article className={panel} aria-label={milestone.title}>
              <p className={label}>
                {milestone.state === 'open' ? 'Offen' : 'Geschlossen'}
              </p>
              <h2 className="mt-2 break-words text-xl font-bold text-white">
                {milestone.title}
              </h2>
              {milestone.description && (
                <p className="mt-3 whitespace-pre-wrap break-words leading-7 text-slate-400">
                  {milestone.description}
                </p>
              )}
            </article>
          </li>
        ))}
      </ol>
      <CollectionFooter {...milestones} />
    </Frame>
  );
}
