'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { PrimaryNavigation } from '@/components/primary-navigation';
import { orderStatuses, orderTypes } from '@/lib/domain/planning';
import type {
  Milestone,
  Order,
  OrderSpec,
  OrderStatus,
  OrderType,
  Page,
  Project,
  RelationType,
} from '@/lib/domain/planning';

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
        nextCursor: previous.url === url ? previous.nextCursor : null,
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
  active: 'overview' | 'milestones' | 'orders';
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
          ['orders', 'Aufträge', `${root}/orders`],
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
              <Link
                className={`${button} mt-4`}
                href={`/projects/${encodeURIComponent(projectId)}/orders?milestoneId=${encodeURIComponent(milestone.id)}`}
              >
                Aufträge ansehen
              </Link>
            </article>
          </li>
        ))}
      </ol>
      <CollectionFooter {...milestones} />
    </Frame>
  );
}

const statusNames: Record<OrderStatus, string> = {
  draft: 'Entwurf',
  ready: 'Bereit',
  implementing: 'In Implementierung',
  implemented: 'Implementiert',
  done: 'Erledigt',
  archived: 'Archiviert',
};
const typeNames: Record<OrderType, string> = {
  feature: 'Feature',
  improvement: 'Verbesserung',
  defect: 'Fehlerbehebung',
  technical: 'Technische Arbeit',
};
const relationNames: Record<RelationType, string> = {
  depends_on: 'Abhängig von',
  related: 'Verwandt mit',
  originated_from: 'Entstanden aus',
  replaces: 'Ersetzt',
};

export type OrderSelection = {
  milestoneId?: string;
  status?: string;
  type?: string;
};

async function milestoneChoices(
  url: string,
  signal: AbortSignal,
): Promise<Milestone[]> {
  const items: Milestone[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<Milestone> = await readJson(
      `${url}?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      signal,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

function filterQuery(selection: OrderSelection) {
  const query = new URLSearchParams();
  if (selection.milestoneId) query.set('milestoneId', selection.milestoneId);
  if (selection.status) query.set('status', selection.status);
  if (selection.type) query.set('type', selection.type);
  return query.toString();
}

export function OrderCollection({
  projectId,
  initialSelection = {},
}: {
  projectId: string;
  initialSelection?: OrderSelection;
}) {
  const [selection, setSelection] = useState<OrderSelection>({
    milestoneId: initialSelection.milestoneId ?? '',
    status: orderStatuses.includes(initialSelection.status as OrderStatus)
      ? initialSelection.status
      : '',
    type: orderTypes.includes(initialSelection.type as OrderType)
      ? initialSelection.type
      : '',
  });
  const root = `/api/projects/${encodeURIComponent(projectId)}`;
  const query = filterQuery(selection);
  const orders = useCollection<Order>(
    `${root}/orders${query ? `?${query}` : ''}`,
  );
  const milestones = useRead<Milestone[]>(
    `${root}/milestones`,
    milestoneChoices,
  );
  function change(next: OrderSelection) {
    setSelection(next);
    const updated = filterQuery(next);
    window.history.replaceState(
      null,
      '',
      `/projects/${encodeURIComponent(projectId)}/orders${updated ? `?${updated}` : ''}`,
    );
  }
  return (
    <Frame title="Aufträge">
      <ProjectNavigation projectId={projectId} active="orders" />
      <fieldset className={`${panel} mb-5`}>
        <legend className="px-2 text-sm font-bold text-lime-200">
          Auftragsfilter
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-semibold text-slate-300">
            Milestone
            <select
              className="mt-2 min-h-11 w-full rounded-xl border border-white/20 bg-[#101722] px-3 text-white"
              value={selection.milestoneId}
              onChange={(event) =>
                change({ ...selection, milestoneId: event.target.value })
              }
            >
              <option value="">Alle Milestones</option>
              <option value="unplanned">Unverplant</option>
              {selection.milestoneId &&
                selection.milestoneId !== 'unplanned' &&
                !milestones.data?.some(
                  (item) => item.id === selection.milestoneId,
                ) && (
                  <option value={selection.milestoneId}>
                    Gewählter Milestone
                  </option>
                )}
              {milestones.data?.map((milestone) => (
                <option key={milestone.id} value={milestone.id}>
                  {milestone.title}
                  {milestone.state === 'closed' ? ' · geschlossen' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-300">
            Zustand
            <select
              className="mt-2 min-h-11 w-full rounded-xl border border-white/20 bg-[#101722] px-3 text-white"
              value={selection.status}
              onChange={(event) =>
                change({ ...selection, status: event.target.value })
              }
            >
              <option value="">Alle Zustände</option>
              {orderStatuses.map((status) => (
                <option key={status} value={status}>
                  {statusNames[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-300">
            Typ
            <select
              className="mt-2 min-h-11 w-full rounded-xl border border-white/20 bg-[#101722] px-3 text-white"
              value={selection.type}
              onChange={(event) =>
                change({ ...selection, type: event.target.value })
              }
            >
              <option value="">Alle Typen</option>
              {orderTypes.map((type) => (
                <option key={type} value={type}>
                  {typeNames[type]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className={button}
            onClick={() => change({ milestoneId: '', status: '', type: '' })}
          >
            Filter zurücksetzen
          </button>
          <button
            className={button}
            disabled={orders.loading}
            onClick={() => void orders.refresh()}
          >
            Aktualisieren
          </button>
        </div>
        <div className="mt-4">
          <LoadFeedback {...milestones} retry={milestones.refresh} />
        </div>
      </fieldset>
      <LoadFeedback {...orders} retry={orders.retry} />
      {!orders.loading && !orders.error && orders.items.length === 0 && (
        <Empty>Keine Aufträge für diese Auswahl vorhanden.</Empty>
      )}
      <ol className="space-y-4">
        {orders.items.map((order) => (
          <li key={order.id}>
            <article
              className={panel}
              aria-label={`${order.displayId} ${order.spec.title}`}
            >
              <div className="mb-2 flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold">
                <span className="text-lime-300">{order.displayId}</span>
                <span className="text-fuchsia-200">
                  {typeNames[order.type]}
                </span>
                <span className="text-slate-400">
                  {statusNames[order.status]}
                </span>
              </div>
              <h2 className="break-words text-xl font-bold text-white">
                <Link
                  className="underline decoration-lime-300/40 underline-offset-4 focus-visible:outline-lime-300"
                  href={`/projects/${encodeURIComponent(projectId)}/orders/${encodeURIComponent(order.id)}`}
                >
                  {order.spec.title || 'Auftrag ohne Titel'}
                </Link>
              </h2>
              <p className="mt-3 whitespace-pre-wrap break-words leading-7 text-slate-400">
                {order.spec.goal}
              </p>
              <p className="mt-3 text-xs text-slate-500">
                Fassung {order.specVersion} ·{' '}
                {order.milestoneId
                  ? (milestones.data?.find(
                      (milestone) => milestone.id === order.milestoneId,
                    )?.title ?? 'Milestone zugeordnet')
                  : 'Unverplant'}
              </p>
            </article>
          </li>
        ))}
      </ol>
      <CollectionFooter {...orders} />
    </Frame>
  );
}

function SpecView({ spec }: { spec: OrderSpec }) {
  const fields = [
    ['Titel', spec.title],
    ['Ziel', spec.goal],
    ['Herkunft', spec.origin],
    ['Nutzerproblem', spec.problem],
    ['Umfang', spec.scope],
    ['Ausgeschlossen', spec.exclusions],
    ['Nutzerabläufe', spec.flows],
    ['Teststrategie', spec.testStrategy],
    ['Voraussetzungen', spec.prerequisites],
    ['Dokumentation', spec.documentation],
  ];
  return (
    <>
      <dl className="space-y-5">
        {fields.map(([title, value]) => (
          <Setting
            key={title}
            title={title}
            value={value || 'Nicht hinterlegt.'}
          />
        ))}
      </dl>
      <h3 className="mb-2 mt-6 font-bold text-white">Akzeptanzkriterien</h3>
      {spec.criteria.length ? (
        <ul className="space-y-2 text-sm leading-7 text-slate-300">
          {spec.criteria.map((criterion) => (
            <li key={criterion.id} className="break-words">
              <span className="font-semibold text-lime-200">
                {criterion.id}
              </span>{' '}
              · {criterion.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-7 text-slate-400">
          Noch keine Kriterien hinterlegt.
        </p>
      )}
      <h3 className="mb-2 mt-6 font-bold text-white">Quellen</h3>
      {spec.sources.length ? (
        <ul className="space-y-2 text-sm leading-7 text-slate-300">
          {spec.sources.map((source, index) => (
            <li
              key={`${index}-${source}`}
              className="whitespace-pre-wrap break-words"
            >
              {source}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-7 text-slate-400">
          Keine Quellen hinterlegt.
        </p>
      )}
      <h3 className="mb-3 mt-6 font-bold text-white">Refinement-Kontext</h3>
      <dl className="space-y-4">
        <Setting
          title="Repository-Commit"
          value={spec.context.repositoryCommit || 'Nicht hinterlegt.'}
        />
        <Setting
          title="Dokumentationsrichtlinie"
          value={spec.context.documentationPolicy || 'Nicht hinterlegt.'}
        />
      </dl>
    </>
  );
}

function Relation({
  projectId,
  targetId,
  type,
}: {
  projectId: string;
  targetId: string;
  type: RelationType;
}) {
  const target = useRead<Order>(
    `/api/projects/${encodeURIComponent(projectId)}/orders/${encodeURIComponent(targetId)}`,
  );
  return (
    <li className="rounded-2xl border border-white/10 p-4">
      <p className="mb-2 text-sm font-semibold text-fuchsia-200">
        {relationNames[type]}
      </p>
      <Link
        href={`/projects/${encodeURIComponent(projectId)}/orders/${encodeURIComponent(targetId)}`}
        className="break-words text-sm font-semibold leading-7 text-white underline decoration-lime-300/40 underline-offset-4 focus-visible:outline-lime-300"
      >
        {target.data
          ? `${target.data.displayId} · ${target.data.spec.title}`
          : targetId}
      </Link>
      <div className="mt-2">
        <LoadFeedback {...target} retry={target.refresh} />
      </div>
    </li>
  );
}

export function OrderDetail({
  projectId,
  orderId,
}: {
  projectId: string;
  orderId: string;
}) {
  const order = useRead<Order>(
    `/api/projects/${encodeURIComponent(projectId)}/orders/${encodeURIComponent(orderId)}`,
  );
  const [version, setVersion] = useState<{
    orderId: string;
    selected: number;
  }>();
  const selected =
    version?.orderId === orderId ? version.selected : order.data?.specVersion;
  const snapshot = order.data?.history.find(
    (entry) => entry.version === selected,
  );
  return (
    <Frame title={order.data?.displayId ?? 'Auftrag'} eyebrow="Auftragsdetails">
      <ProjectNavigation projectId={projectId} active="orders" />
      <Link
        className={`${button} mb-6`}
        href={`/projects/${encodeURIComponent(projectId)}/orders`}
      >
        Zur Auftragsliste
      </Link>
      <LoadFeedback {...order} retry={order.refresh} />
      {order.data && (
        <>
          <section
            className={`${panel} mb-5`}
            aria-label="Aktueller Auftragsstand"
          >
            <h2 className="break-words text-xl font-bold text-white">
              {order.data.spec.title || 'Auftrag ohne Titel'}
            </h2>
            <dl className="mt-5 grid gap-5 sm:grid-cols-2">
              <Setting title="Zustand" value={statusNames[order.data.status]} />
              <Setting title="Typ" value={typeNames[order.data.type]} />
              <Setting
                title="Aktuelle Fassung"
                value={String(order.data.specVersion)}
              />
              <div>
                <dt className="text-sm text-slate-400">Planung</dt>
                <dd className="mt-1 text-sm leading-7 text-slate-200">
                  {order.data.milestoneId ? (
                    <Link
                      className="break-words underline decoration-lime-300/40 underline-offset-4"
                      href={`/projects/${encodeURIComponent(projectId)}/orders?milestoneId=${encodeURIComponent(order.data.milestoneId)}`}
                    >
                      Aufträge im selben Milestone
                    </Link>
                  ) : (
                    'Unverplant'
                  )}
                </dd>
              </div>
            </dl>
          </section>
          <section className={`${panel} mb-5`} aria-label="Spezifikation">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <h2 className="text-lg font-bold text-white">
                Spezifikation · Fassung {selected}
              </h2>
              <label className="block text-sm font-semibold text-slate-300">
                Spezifikationsfassung
                <select
                  className="ml-3 min-h-11 rounded-xl border border-white/20 bg-[#101722] px-3 text-white"
                  value={selected}
                  onChange={(event) =>
                    setVersion({
                      orderId,
                      selected: Number(event.target.value),
                    })
                  }
                >
                  {[...order.data.history]
                    .sort((a, b) => b.version - a.version)
                    .map((entry) => (
                      <option key={entry.version} value={entry.version}>
                        Fassung {entry.version}
                        {entry.version === order.data?.specVersion
                          ? ' · aktuell'
                          : ''}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {snapshot?.createdAt && (
              <p className="mb-5 text-xs text-slate-400">
                Gespeichert:{' '}
                <time dateTime={snapshot.createdAt}>
                  {new Intl.DateTimeFormat('de-AT', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'Europe/Vienna',
                  }).format(new Date(snapshot.createdAt))}
                </time>
              </p>
            )}
            <SpecView spec={snapshot?.spec ?? order.data.spec} />
          </section>
          <section className={panel} aria-label="Ausgehende Beziehungen">
            <h2 className="mb-3 text-lg font-bold text-white">
              Ausgehende Beziehungen
            </h2>
            <p className="mb-4 text-sm leading-6 text-slate-400">
              Diese Verknüpfungen gehen von {order.data.displayId} zu den
              genannten Aufträgen.
            </p>
            {order.data.relations.length ? (
              <ul className="space-y-3">
                {order.data.relations.map((relation) => (
                  <Relation
                    key={`${relation.type}-${relation.targetId}`}
                    projectId={projectId}
                    {...relation}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-7 text-slate-400">
                Keine Beziehungen hinterlegt.
              </p>
            )}
          </section>
        </>
      )}
    </Frame>
  );
}
