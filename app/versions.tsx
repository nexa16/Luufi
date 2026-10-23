'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Frame, ProjectNavigation } from '@/components/project-frame';
import type {
  BuildRecord,
  LatestAvailableVersion,
  ProjectVersion,
  ReleaseRecord,
  VersionOrder,
} from '@/lib/domain/releases';
import type { Page } from '@/lib/domain/planning';

const panel =
  'min-w-0 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6';
const button =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 disabled:opacity-50';
const itemPanel = 'min-w-0 rounded-2xl border border-white/10 p-4';
const rootFor = (id: string) =>
  `/api/projects/${encodeURIComponent(id)}/versions`;
const detailFor = (p: string, id: string) =>
  `/projects/${encodeURIComponent(p)}/versions/${encodeURIComponent(id)}`;
const channelName = (version: ProjectVersion) =>
  version.channel === 'develop'
    ? 'Develop-Vorschau'
    : version.releaseId
      ? 'Produktion · Release aufgezeichnet'
      : 'Produktionskandidat · kein Releasebeleg';
class ReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    signal,
    headers: { Accept: 'application/json' },
  });
  const value: unknown = await response.json();
  if (!response.ok)
    throw new ReadError(
      value &&
        typeof value === 'object' &&
        'error' in value &&
        typeof value.error === 'string'
        ? value.error
        : 'Die Daten konnten nicht geladen werden.',
      response.status,
    );
  return value as T;
}
function useRecord<T>(url: string) {
  const [state, setState] = useState<{
    url: string;
    data?: T;
    loading: boolean;
    error?: unknown;
  }>({ url, loading: true });
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState((previous) => ({
      url,
      data: previous.url === url ? previous.data : undefined,
      loading: true,
    }));
    try {
      const data = await read<T>(url, controller.signal);
      if (!controller.signal.aborted) setState({ url, data, loading: false });
    } catch (error) {
      if (!controller.signal.aborted)
        setState((previous) => ({ ...previous, url, loading: false, error }));
    }
  }, [url]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      active.current?.abort();
    };
  }, [refresh]);
  return { ...(state.url === url ? state : { url, loading: true }), refresh };
}
function usePages<T extends { id: string }>(url: string) {
  const [state, setState] = useState<{
    url: string;
    items: T[];
    nextCursor: string | null;
    loading: boolean;
    error?: unknown;
  }>({ url, items: [], nextCursor: null, loading: true });
  const active = useRef<AbortController | null>(null);
  const failed = useRef<string | null>(null);
  const load = useCallback(
    async (cursor: string | null = null) => {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      failed.current = cursor;
      setState((previous) => ({
        url,
        items: previous.url === url ? previous.items : [],
        nextCursor: previous.url === url ? previous.nextCursor : null,
        loading: true,
      }));
      try {
        const page = await read<Page<T>>(
          `${url}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          controller.signal,
        );
        if (!controller.signal.aborted)
          setState((previous) => {
            const items = new Map(
              (cursor ? previous.items : []).map((item) => [item.id, item]),
            );
            for (const item of page.items) items.set(item.id, item);
            return {
              url,
              items: [...items.values()],
              nextCursor: page.nextCursor,
              loading: false,
            };
          });
      } catch (error) {
        if (!controller.signal.aborted)
          setState((previous) => ({ ...previous, url, loading: false, error }));
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
  const visible =
    state.url === url
      ? state
      : { url, items: [] as T[], nextCursor: null, loading: true };
  return {
    ...visible,
    refresh: () => load(),
    more: () => load(visible.nextCursor),
    retry: () =>
      load(
        visible.error instanceof ReadError && visible.error.status === 409
          ? null
          : failed.current,
      ),
  };
}
function Feedback({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error?: unknown;
  retry: () => Promise<void>;
}) {
  return (
    <>
      {loading && (
        <output className="my-4 block text-sm text-slate-400">
          Daten werden geladen …
        </output>
      )}
      {!!error && (
        <div
          role="alert"
          className="my-4 rounded-xl border border-red-300/30 bg-red-300/5 p-4 text-sm leading-6 text-red-200"
        >
          <p>
            {error instanceof ReadError
              ? error.message
              : 'Luufi ist gerade nicht erreichbar. Bitte erneut versuchen.'}
          </p>
          <button className={`${button} mt-3`} onClick={() => void retry()}>
            {error instanceof ReadError && error.status === 409
              ? 'Liste neu laden'
              : 'Erneut versuchen'}
          </button>
        </div>
      )}
    </>
  );
}
function Pages<T extends { id: string }>({
  title,
  empty,
  page,
  children,
}: {
  title: string;
  empty: string;
  page: ReturnType<typeof usePages<T>>;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className={`${panel} mt-5`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        <button
          className={button}
          disabled={page.loading}
          onClick={() => void page.refresh()}
        >
          Aktualisieren
        </button>
      </div>
      <Feedback {...page} retry={page.retry} />
      {!page.loading && !page.error && !page.items.length && (
        <p className="text-sm leading-7 text-slate-400">{empty}</p>
      )}
      {children}
      {page.nextCursor && (
        <button
          className={`${button} mt-5`}
          disabled={page.loading}
          onClick={() => void page.more()}
        >
          Weitere laden
        </button>
      )}
    </section>
  );
}
function Time({ value }: { value: string }) {
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat('de-AT', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Vienna',
      }).format(new Date(value))}
    </time>
  );
}
function safeUrl(value: string) {
  if (
    value !== value.trim() ||
    !/^https?:\/\//i.test(value) ||
    Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function Reference({ value, label }: { value: string | null; label?: string }) {
  if (!value) return <span className="text-slate-400">Nicht hinterlegt.</span>;
  const href = safeUrl(value);
  return href ? (
    <a
      className="break-all text-lime-200 underline underline-offset-4 focus-visible:outline-lime-300"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label ?? value}
    </a>
  ) : (
    <span className="whitespace-pre-wrap break-all">{value}</span>
  );
}
function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-slate-400">{title}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-7 text-slate-200">
        {children}
      </dd>
    </div>
  );
}
function VersionFacts({ version }: { version: ProjectVersion }) {
  return (
    <dl className="mt-5 grid gap-4 sm:grid-cols-2">
      <Fact title="Versionslabel">{version.label}</Fact>
      <Fact title="Einordnung">{channelName(version)}</Fact>
      <Fact title="Öffentlicher Versionscommit">
        {version.repositoryCommit}
      </Fact>
      <Fact title="Projektbranch">{version.sourceBranch}</Fact>
      <Fact title="Enthaltener Umfang">
        {version.orderCount} {version.orderCount === 1 ? 'Auftrag' : 'Aufträge'}{' '}
        · unveränderlicher Snapshot
      </Fact>
      <Fact title="Erfasst">
        <Time value={version.createdAt} />
      </Fact>
    </dl>
  );
}
function BuildCard({ build }: { build: BuildRecord }) {
  return (
    <li className={itemPanel}>
      <article
        aria-label={`${build.kind === 'site' ? 'Site' : 'APK'} ${build.id}`}
      >
        <h3 className="font-bold text-white">
          {build.kind === 'site' ? 'Site' : 'APK'} · Zielumgebung{' '}
          {build.environment === 'preview' ? 'Preview' : 'Produktion'}
        </h3>
        <p
          className={`mt-2 font-semibold ${build.outcome === 'available' ? 'text-lime-200' : 'text-amber-200'}`}
        >
          {build.outcome === 'available'
            ? 'Als verfügbar beobachtet'
            : build.outcome === 'failure'
              ? 'Bereitstellung fehlgeschlagen'
              : 'Nicht verfügbar'}
        </p>
        {build.outcome === 'available' ? (
          <p className="mt-3 text-sm">
            <Reference
              value={build.url}
              label={
                build.kind === 'site'
                  ? 'Beobachteten Site-Link öffnen'
                  : 'Beobachteten APK-Link öffnen'
              }
            />
          </p>
        ) : (
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">
            Grund: {build.reason || 'Nicht hinterlegt.'}
          </p>
        )}
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Fact title="Verfügbarkeit beobachtet">
            <Time value={build.observedAt} />
          </Fact>
          <Fact title="Gebauter öffentlicher Commit">
            {build.projectCommit}
          </Fact>
          <Fact title="Hostingquelle">
            {build.sourceKind === 'sites'
              ? 'Privater Sites-Quellspeicher'
              : 'GitHub-Quelle'}
          </Fact>
          <Fact title="Hostingquellbranch">{build.sourceBranch}</Fact>
          <Fact title="Hostingquellcommit">{build.sourceCommit}</Fact>
          <Fact title="Versionscommit enthalten">
            {build.versionCommitIncluded
              ? 'Von Codex bestätigt'
              : 'Nicht nachgewiesen'}
          </Fact>
          <Fact title="Quellzuordnung">
            <Reference value={build.mappingReference} />
          </Fact>
          <Fact title="Bereitstellungsprüfung">
            <Reference value={build.verificationReference} />
          </Fact>
          <Fact title="Beleg erfasst">
            <Time value={build.createdAt} />
          </Fact>
        </dl>
      </article>
    </li>
  );
}
function ReleaseCard({ release }: { release: ReleaseRecord }) {
  const observations = release.observation;
  const conclusion = {
    success: 'Erfolgreich',
    failure: 'Fehlgeschlagen',
    cancelled: 'Abgebrochen',
    pending: 'Ausstehend',
  };
  return (
    <li className={itemPanel}>
      <article aria-label={`Produktionsrelease ${release.id}`}>
        <h3 className="font-bold text-white">
          Aufgezeichnetes Produktionsrelease · {release.tag}
        </h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Fact title="Nutzerfreigabereferenz">
            <Reference value={release.confirmationReference} />
          </Fact>
          <Fact title="Produktionsbranch">{release.productionBranch}</Fact>
          <Fact title="Produktionscommit">{release.productionCommit}</Fact>
          <Fact title="Tagziel">{release.tagCommit}</Fact>
          <Fact title="Zugeordneter Build">{release.buildId}</Fact>
          <Fact title="Deploymentnachweis">
            <Reference value={release.deploymentReference} />
          </Fact>
          <Fact title="Gitprüfung durch Codex">
            <Time value={observations.observedAt} />
          </Fact>
          <Fact title="Repository">
            <Reference value={observations.repository} />
          </Fact>
          <Fact title="Beobachteter Produktionshead">
            {observations.productionHead}
          </Fact>
          <Fact title="Beobachteter Tag">
            {observations.tag} · {observations.tagCommit}
          </Fact>
          <Fact title="Versionscommit in Produktion">
            {observations.versionCommit} ·{' '}
            {observations.versionCommitIncluded
              ? 'Enthalten, von Codex geprüft'
              : 'Nicht nachgewiesen'}
          </Fact>
          <Fact title="Releasebeleg erfasst">
            <Time value={release.createdAt} />
          </Fact>
        </dl>
        <h4 className="mb-3 mt-5 font-semibold text-white">
          Aufgezeichnete Produktions-CI
        </h4>
        {observations.ci.length ? (
          <ul className="space-y-3">
            {observations.ci.map((ci, index) => (
              <li
                key={`${ci.name}-${index}`}
                className="min-w-0 rounded-xl border border-white/10 p-3 text-sm"
              >
                <p className="font-semibold text-slate-200">
                  {ci.name} · {conclusion[ci.conclusion]}
                </p>
                <p className="my-2 break-all text-xs text-slate-400">
                  Head: {ci.headSha}
                </p>
                <Reference value={ci.url} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">
            Keine CI-Beobachtung hinterlegt.
          </p>
        )}
      </article>
    </li>
  );
}

export function VersionCollection({ projectId }: { projectId: string }) {
  const versions = usePages<ProjectVersion>(rootFor(projectId));
  return (
    <Frame title="Versionen">
      <ProjectNavigation projectId={projectId} active="versions" />
      <p className="mb-5 text-sm leading-7 text-slate-400">
        Gespeicherte Projektstände mit deutschen Änderungsnotizen und
        eingefrorenem Auftragsumfang. Ein Produktionskandidat ist noch kein
        freigegebenes Release.
      </p>
      <Pages
        title="Gespeicherte Versionen"
        empty="Noch keine Versionen für dieses Projekt erfasst."
        page={versions}
      >
        <ul className="space-y-4">
          {versions.items.map((version) => (
            <li key={version.id} className={itemPanel}>
              <article>
                <p className="mb-2 text-xs font-semibold text-lime-200">
                  {channelName(version)}
                </p>
                <h3 className="break-words text-xl font-bold text-white">
                  <Link
                    className="underline decoration-lime-300/40 underline-offset-4 focus-visible:outline-lime-300"
                    href={detailFor(projectId, version.id)}
                  >
                    {version.label} · {version.title}
                  </Link>
                </h3>
                <VersionFacts version={version} />
              </article>
            </li>
          ))}
        </ul>
      </Pages>
    </Frame>
  );
}
export function VersionDetail({
  projectId,
  versionId,
}: {
  projectId: string;
  versionId: string;
}) {
  const root = `${rootFor(projectId)}/${encodeURIComponent(versionId)}`;
  const version = useRecord<ProjectVersion>(root);
  const orders = usePages<VersionOrder>(`${root}/orders`);
  const builds = usePages<BuildRecord>(`${root}/builds`);
  const releases = usePages<ReleaseRecord>(`${root}/releases`);
  return (
    <Frame
      title={version.data?.title ?? 'Versionsdetails'}
      eyebrow={version.data?.label ?? 'Projektversion'}
    >
      <ProjectNavigation projectId={projectId} active="versions" />
      <Link
        className={`${button} mb-5`}
        href={`/projects/${encodeURIComponent(projectId)}/versions`}
      >
        Zur Versionsliste
      </Link>
      <Feedback {...version} retry={version.refresh} />
      {version.data && (
        <section className={panel} aria-label="Versionsstand">
          <h2 className="text-lg font-bold text-white">
            {channelName(version.data)}
          </h2>
          <VersionFacts version={version.data} />
          <h3 className="mb-3 mt-6 font-bold text-white">Änderungen</h3>
          <p className="whitespace-pre-wrap break-words leading-7 text-slate-300">
            {version.data.changelog}
          </p>
        </section>
      )}
      <Pages
        title="Enthaltene Aufträge"
        empty="Keine Aufträge im Versionsumfang hinterlegt."
        page={orders}
      >
        <ul className="space-y-4">
          {orders.items.map((order) => (
            <li key={order.id} className={itemPanel}>
              <h3 className="break-words font-semibold text-white">
                <Link
                  className="underline decoration-lime-300/40 underline-offset-4"
                  href={`/projects/${encodeURIComponent(projectId)}/orders/${encodeURIComponent(order.orderId)}`}
                >
                  {order.displayId} · {order.title}
                </Link>
              </h3>
              <p className="mt-2 text-xs leading-6 text-slate-400">
                Fassung {order.specVersion} ·{' '}
                {order.provenanceKind === 'execution'
                  ? 'Regulärer Bearbeitungsnachweis'
                  : 'Bootstrap-Provenienz'}
              </p>
              <dl className="mt-4 space-y-3">
                <Fact title="Finaler Auftragscommit">
                  {order.implementationCommit}
                </Fact>
                <Fact title="Integrationsreferenz">
                  <Reference value={order.integrationReference} />
                </Fact>
                <Fact title="Implementierungsnachweis">
                  {order.implementationId ??
                    'Bootstrapbeleg, kein historischer W5-Claim.'}
                </Fact>
                <Fact title="Integrationsnachweis">
                  {order.integrationId ?? 'Separate Bootstrap-Provenienz.'}
                </Fact>
              </dl>
            </li>
          ))}
        </ul>
      </Pages>
      <Pages
        title="Build- und Verfügbarkeitsbelege"
        empty="Keine Bereitstellung aufgezeichnet."
        page={builds}
      >
        <p className="mb-4 text-xs leading-6 text-slate-400">
          Historische Beobachtungen, keine dauerhafte Erreichbarkeitsgarantie.
          Neuere Fehler desselben Buildziels ersetzen frühere
          Verfügbarkeitsbeobachtungen. Die Projektübersicht nennt die zuletzt
          verfügbare Version anhand des aktuellen Belegstands.
        </p>
        <ul className="space-y-4">
          {builds.items.map((build) => (
            <BuildCard key={build.id} build={build} />
          ))}
        </ul>
      </Pages>
      <Pages
        title="Produktionsreleasebelege"
        empty="Kein Produktionsrelease aufgezeichnet."
        page={releases}
      >
        <p className="mb-4 text-xs leading-6 text-slate-400">
          Nutzerfreigabe, Git-/Tagprüfung und Deploymentbeobachtung sind
          getrennte gespeicherte Nachweise von Codex. Luufi führt keine eigene
          unabhängige GitHub-Prüfung oder Veröffentlichung aus.
        </p>
        {version.data?.channel === 'production' && !version.data.releaseId && (
          <p className="mb-4 text-sm text-amber-200">
            Produktionskandidat: Es liegt noch kein zugeordneter Releasebeleg
            vor.
          </p>
        )}
        <ul className="space-y-4">
          {releases.items.map((release) => (
            <ReleaseCard key={release.id} release={release} />
          ))}
        </ul>
      </Pages>
    </Frame>
  );
}
export function LatestVersion({ projectId }: { projectId: string }) {
  const latest = useRecord<LatestAvailableVersion>(
    `/api/projects/${encodeURIComponent(projectId)}/latest-available-version`,
  );
  return (
    <section aria-label="Letzte verfügbare Version" className={`${panel} mb-5`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white">
          Letzte verfügbare Version
        </h2>
        <button
          className={button}
          disabled={latest.loading}
          onClick={() => void latest.refresh()}
        >
          Aktualisieren
        </button>
      </div>
      <Feedback {...latest} retry={latest.refresh} />
      {latest.data === null && !latest.loading && !latest.error && (
        <p className="text-sm leading-7 text-slate-400">
          Noch keine verfügbare Version beobachtet.
        </p>
      )}
      {latest.data && (
        <>
          <p className="text-xs font-semibold text-lime-200">
            {channelName(latest.data.version)}
          </p>
          <h3 className="mt-2 break-words font-bold text-white">
            <Link
              className="underline underline-offset-4"
              href={detailFor(projectId, latest.data.version.id)}
            >
              {latest.data.version.label} · {latest.data.version.title}
            </Link>
          </h3>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            {latest.data.build.kind === 'site' ? 'Site' : 'APK'} ·{' '}
            {latest.data.build.environment === 'preview'
              ? 'Preview'
              : 'Produktionsumgebung'}{' '}
            · beobachtet <Time value={latest.data.build.observedAt} />
          </p>
          <p className="mt-3 text-sm">
            <Reference
              value={latest.data.build.url}
              label={
                latest.data.build.kind === 'site'
                  ? 'Verfügbare Site öffnen'
                  : 'Verfügbare APK öffnen'
              }
            />
          </p>
          <p className="mt-3 text-xs leading-6 text-slate-400">
            Datierte Beobachtung durch Codex. Eine neuere Version ohne
            verfügbaren Build verdrängt diesen Verweis nicht.
          </p>
        </>
      )}
    </section>
  );
}
