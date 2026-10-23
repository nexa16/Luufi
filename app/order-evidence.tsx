'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type {
  Evidence,
  GitObservation,
  LifecycleEvent,
  LifecycleSummary,
  OrderApproval,
  Progress,
} from '@/lib/domain/execution';
import type { OrderStatus, Page } from '@/lib/domain/planning';

const panel =
  'min-w-0 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6';
const button =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 disabled:opacity-50';
const entry = 'min-w-0 rounded-2xl border border-white/10 p-4';
const statuses: Record<OrderStatus, string> = {
  draft: 'Entwurf',
  ready: 'Bereit',
  implementing: 'In Implementierung',
  implemented: 'Implementiert',
  done: 'Erledigt',
  archived: 'Archiviert',
};
const progressKinds: Record<Progress['kind'], string> = {
  update: 'Fortschritt',
  obstacle: 'Hindernis',
  test: 'Prüfung',
  handover: 'Übergabe',
};
const evidenceKinds: Record<Evidence['kind'], string> = {
  validation: 'Kriterien- und Dokumentationsprüfung',
  implementation: 'Implementierungsnachweis',
  integration: 'Integrationsnachweis',
};
const outcomes: Record<Evidence['outcome'], string> = {
  success: 'Erfolgreich',
  failure: 'Fehlgeschlagen',
  unavailable: 'Nicht verfügbar',
};
const ciOutcomes: Record<GitObservation['ci'][number]['conclusion'], string> = {
  success: 'Erfolgreich',
  failure: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
  pending: 'Ausstehend',
};

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
    signal,
    cache: 'no-store',
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
const errorMessage = (error: unknown) =>
  error instanceof ReadError
    ? error.message
    : 'Luufi ist gerade nicht erreichbar. Bitte erneut versuchen.';
function ErrorNotice({
  error,
  retry,
}: {
  error?: unknown;
  retry: () => Promise<void>;
}) {
  return error ? (
    <div
      role="alert"
      className="my-4 rounded-xl border border-red-300/30 bg-red-300/5 p-4 text-sm leading-6 text-red-200"
    >
      <p>{errorMessage(error)}</p>
      <button className={`${button} mt-3`} onClick={() => void retry()}>
        {error instanceof ReadError && error.status === 409
          ? 'Liste neu laden'
          : 'Erneut versuchen'}
      </button>
    </div>
  ) : null;
}
function useSummary(url: string) {
  const [state, setState] = useState<{
    url: string;
    data?: LifecycleSummary;
    error?: unknown;
    loading: boolean;
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
      const data = await read<LifecycleSummary>(url, controller.signal);
      if (!controller.signal.aborted) setState({ url, data, loading: false });
    } catch (error) {
      if (!controller.signal.aborted)
        setState((previous) => ({ ...previous, url, error, loading: false }));
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
function useHistory<T extends { id: string }>(url: string) {
  const [state, setState] = useState<{
    url: string;
    items: T[];
    nextCursor: string | null;
    loading: boolean;
    error?: unknown;
  }>({ url, items: [], nextCursor: null, loading: true });
  const active = useRef<AbortController | null>(null);
  const failedCursor = useRef<string | null>(null);
  const load = useCallback(
    async (cursor: string | null = null) => {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      failedCursor.current = cursor;
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
        if (controller.signal.aborted) return;
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
          setState((previous) => ({ ...previous, url, error, loading: false }));
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
          : failedCursor.current,
      ),
  };
}
function HistorySection<T extends { id: string }>({
  title,
  empty,
  history,
  children,
}: {
  title: string;
  empty: string;
  history: ReturnType<typeof useHistory<T>>;
  children: ReactNode;
}) {
  return (
    <section className={panel} aria-label={title}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-white">{title}</h3>
        <button
          className={button}
          disabled={history.loading}
          onClick={() => void history.refresh()}
        >
          Aktualisieren
        </button>
      </div>
      {history.loading && (
        <output className="mb-4 block text-sm text-slate-400">
          Daten werden geladen …
        </output>
      )}
      <ErrorNotice error={history.error} retry={history.retry} />
      {!history.loading && !history.error && !history.items.length && (
        <p className="text-sm leading-7 text-slate-400">{empty}</p>
      )}
      {children}
      {history.nextCursor && (
        <button
          className={`${button} mt-5`}
          disabled={history.loading}
          onClick={() => void history.more()}
        >
          Weitere laden
        </button>
      )}
    </section>
  );
}
function Timestamp({ value }: { value: string }) {
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
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function Reference({
  value,
  empty = 'Nicht hinterlegt.',
}: {
  value: string;
  empty?: string;
}) {
  const href = safeUrl(value);
  return value ? (
    href ? (
      <a
        className="break-all text-lime-200 underline underline-offset-4 focus-visible:outline-lime-300"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {value}
      </a>
    ) : (
      <span className="whitespace-pre-wrap break-all">{value}</span>
    )
  ) : (
    <span className="text-slate-400">{empty}</span>
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
function Claim({ summary }: { summary: LifecycleSummary }) {
  const execution = summary.execution;
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <Fact title="Freigabe">
        {summary.approval ? (
          <>
            {summary.approval.valid
              ? 'Gültige Freigabe'
              : 'Keine gültige Freigabe'}{' '}
            · Fassung {summary.approval.specVersion}
            {summary.approval.reason && (
              <p className="mt-1 text-slate-400">{summary.approval.reason}</p>
            )}
          </>
        ) : (
          'Keine Freigabe aufgezeichnet.'
        )}
      </Fact>
      <Fact title="Bearbeitung">
        {execution
          ? execution.phase === 'active'
            ? 'Bearbeitung aktiv'
            : execution.phase === 'paused'
              ? 'Bearbeitung unterbrochen'
              : 'Bearbeitung beendet'
          : 'Keine aktive Bearbeitung.'}
      </Fact>
      {execution && (
        <>
          <Fact title="Bearbeiter">{execution.worker}</Fact>
          <Fact title="Arbeitsbranch">{execution.branch}</Fact>
          <Fact title="Bearbeitungsgeneration">
            {execution.generation} · Fassung {execution.specVersion}
          </Fact>
          <Fact title="Letzter Bearbeitungsstand">
            <Timestamp value={execution.updatedAt} />
          </Fact>
        </>
      )}
      <Fact title="Aktueller Implementierungsnachweis">
        {summary.currentImplementationId ??
          'Kein aktueller Implementierungsnachweis hinterlegt.'}
      </Fact>
      <Fact title="Integrationsnachweis">
        {summary.integrationId ?? 'Kein Integrationsnachweis hinterlegt.'}
      </Fact>
      <Fact title="Stand der Lebenszyklusdaten">
        Revision {summary.lifecycleRevision}
      </Fact>
    </dl>
  );
}
function ApprovalCard({
  approval,
  projectId,
}: {
  approval: OrderApproval;
  projectId: string;
}) {
  return (
    <li className={entry}>
      <p
        className={`font-semibold ${approval.valid ? 'text-lime-200' : 'text-amber-200'}`}
      >
        {approval.valid ? 'Gültige Freigabe' : 'Freigabe nicht gültig'} ·
        Fassung {approval.scope.specVersion}
      </p>
      <p className="mt-2 break-words text-white">{approval.scope.title}</p>
      <p className="mt-2 text-xs leading-6 text-slate-400">
        {approval.mode === 'milestone'
          ? 'Milestonefreigabe · eingefrorene Auswahl'
          : 'Einzelfreigabe / Auswahl'}{' '}
        · {approval.itemCount} Aufträge ·{' '}
        <Timestamp value={approval.createdAt} />
      </p>
      {approval.reason && (
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-amber-200">
          {approval.reason}
        </p>
      )}
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <Fact title="Bestätigungsreferenz">
          <Reference value={approval.confirmationReference} />
        </Fact>
        <Fact title="Freigabe-ID">{approval.id}</Fact>
        <Fact title="Repository im Snapshot">
          <Reference value={approval.scope.repository} />
        </Fact>
        <Fact title="Integrationsbranch im Snapshot">
          {approval.scope.integrationBranch}
        </Fact>
        {approval.revokedAt && (
          <Fact title="Freigabe widerrufen">
            <Timestamp value={approval.revokedAt} />
          </Fact>
        )}
        {approval.scope.invalidatedAt && (
          <Fact title="Auftragssnapshot entwertet">
            <Timestamp value={approval.scope.invalidatedAt} />
            {approval.scope.invalidatedReason && (
              <p>{approval.scope.invalidatedReason}</p>
            )}
          </Fact>
        )}
      </dl>
      <h4 className="mb-2 mt-4 text-sm font-semibold text-slate-300">
        Abhängigkeiten im Freigabesnapshot
      </h4>
      {approval.scope.dependencyIds.length ? (
        <ul className="space-y-2 text-sm">
          {approval.scope.dependencyIds.map((id) => (
            <li key={id}>
              <Link
                className="break-all text-lime-200 underline underline-offset-4"
                href={`/projects/${encodeURIComponent(projectId)}/orders/${encodeURIComponent(id)}`}
              >
                {id}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">
          Keine Auftragsabhängigkeiten im Snapshot.
        </p>
      )}
    </li>
  );
}
function GitFacts({ observation }: { observation: GitObservation | null }) {
  return observation ? (
    <div className="mt-5">
      <h5 className="mb-3 font-semibold text-lime-200">
        Von Codex lokal geprüfte Gitfakten
      </h5>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact title="Repository">
          <Reference value={observation.repository} />
        </Fact>
        <Fact title="Geprüfter Branch">{observation.branch}</Fact>
        <Fact title="Auftragscommit">{observation.commitSha}</Fact>
        <Fact title="Beobachteter Head">{observation.headSha}</Fact>
        <Fact title="Remote-Referenz">{observation.remoteRef}</Fact>
        <Fact title="Commitbetreff">{observation.commitSubject}</Fact>
        <Fact title="Gepusht">
          {observation.pushed ? 'Ja, von Codex geprüft' : 'Nicht nachgewiesen'}
        </Fact>
        <Fact title="Commit im Branchhead enthalten">
          {observation.ancestorOfHead
            ? 'Ja, von Codex geprüft'
            : 'Nicht nachgewiesen'}
        </Fact>
        <Fact title="Zeitpunkt der Gitprüfung">
          <Timestamp value={observation.observedAt} />
        </Fact>
        <Fact title="Elterncommits">
          {observation.parentShas.length
            ? observation.parentShas.join('\n')
            : 'Keine Elterncommits aufgezeichnet.'}
        </Fact>
      </dl>
      <h5 className="mb-3 mt-5 font-semibold text-white">Pull Request</h5>
      {observation.pr ? (
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact title="PR-Referenz">
            <Reference value={observation.pr.url} />
          </Fact>
          <Fact title="Zielbranch">{observation.pr.baseBranch}</Fact>
          <Fact title="PR-Head">{observation.pr.headSha}</Fact>
          <Fact title="Merge">
            {observation.pr.merged
              ? 'Als gemergt aufgezeichnet'
              : 'Nicht gemergt'}{' '}
            ·{' '}
            {observation.pr.normalMerge
              ? 'Normaler Merge'
              : 'Normaler Merge nicht nachgewiesen'}
          </Fact>
          <Fact title="Mergecommit">
            {observation.pr.mergeSha ?? 'Nicht hinterlegt.'}
          </Fact>
        </dl>
      ) : (
        <p className="text-sm text-slate-400">
          Kein Pull Request aufgezeichnet.
        </p>
      )}
      <h5 className="mb-3 mt-5 font-semibold text-white">
        CI-Prüfungen zum aufgezeichneten Stand
      </h5>
      {observation.ci.length ? (
        <ul className="space-y-3">
          {observation.ci.map((ci, index) => (
            <li
              key={`${ci.name}-${ci.headSha}-${index}`}
              className="rounded-xl border border-white/10 p-3 text-sm"
            >
              <p className="break-words font-semibold text-slate-200">
                {ci.name} · {ciOutcomes[ci.conclusion]}
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
          Keine CI-Prüfung aufgezeichnet.
        </p>
      )}
    </div>
  ) : (
    <p className="mt-4 text-sm text-amber-200">
      Keine lokale Gitbeobachtung aufgezeichnet.
    </p>
  );
}
function EvidenceCard({
  evidence,
  summary,
  replacedBy,
}: {
  evidence: Evidence;
  summary?: LifecycleSummary;
  replacedBy?: string;
}) {
  const isCurrent =
    evidence.kind === 'implementation' &&
    summary?.currentImplementationId === evidence.id;
  const isIntegration =
    evidence.kind === 'integration' && summary?.integrationId === evidence.id;
  return (
    <li className={entry}>
      <article aria-label={`${evidenceKinds[evidence.kind]} ${evidence.id}`}>
        <div className="mb-3 flex flex-wrap gap-2">
          <h4 className="font-bold text-white">
            {evidenceKinds[evidence.kind]}
          </h4>
          <p
            className={`font-semibold ${evidence.outcome === 'success' ? 'text-lime-200' : evidence.outcome === 'failure' ? 'text-red-200' : 'text-amber-200'}`}
          >
            {outcomes[evidence.outcome]}
          </p>
        </div>
        {isCurrent && (
          <p className="mb-2 text-sm text-lime-200">
            Als aktueller Implementierungsnachweis referenziert.
          </p>
        )}
        {isIntegration && (
          <p className="mb-2 text-sm text-lime-200">
            Als Integrationsnachweis referenziert.
          </p>
        )}
        {replacedBy ? (
          <p className="mb-2 break-words text-sm text-amber-200">
            Ersetzt durch Nachweis: {replacedBy}
          </p>
        ) : evidence.kind === 'implementation' &&
          evidence.outcome === 'success' &&
          summary?.currentImplementationId &&
          !isCurrent ? (
          <p className="mb-2 text-sm text-slate-400">
            Historischer Kandidat · aktuell nicht ausgewählt.
          </p>
        ) : null}
        {evidence.supersedesId && (
          <p className="mb-2 break-words text-sm text-slate-400">
            Ersetzt Nachweis: {evidence.supersedesId}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-200">
          {evidence.summary}
        </p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Fact title="Nachweis-ID">{evidence.id}</Fact>
          <Fact title="Auftragsfassung">{evidence.specVersion}</Fact>
          <Fact title="Commit">{evidence.commitSha}</Fact>
          <Fact title="Bearbeitung">
            {evidence.executionId} · Generation {evidence.generation}
          </Fact>
          <Fact title="Aufgezeichnet">
            <Timestamp value={evidence.createdAt} />
          </Fact>
          <Fact title="Dokumentationsprüfung">
            <Reference value={evidence.documentationReference} />
          </Fact>
          {evidence.validationId && (
            <Fact title="Zugeordnete Kriterienprüfung">
              {evidence.validationId}
            </Fact>
          )}
        </dl>
        {evidence.unavailableBuildReason && (
          <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-amber-200">
            Kein Build bereitgestellt: {evidence.unavailableBuildReason}
          </p>
        )}
        {!evidence.unavailableBuildReason && evidence.kind !== 'validation' && (
          <p className="mt-4 text-sm leading-7 text-slate-400">
            Keine Bereitstellungsangabe in diesem Nachweis.
          </p>
        )}
        <h5 className="mb-3 mt-5 font-semibold text-white">
          Kriterienergebnisse
        </h5>
        {evidence.criteria.length ? (
          <ul className="space-y-3">
            {evidence.criteria.map((criterion) => (
              <li
                key={criterion.id}
                className="rounded-xl border border-white/10 p-3 text-sm"
              >
                <p className="mb-2 break-words font-semibold text-slate-200">
                  {criterion.id} ·{' '}
                  {criterion.result === 'pass'
                    ? 'Bestanden'
                    : criterion.result === 'fail'
                      ? 'Fehlgeschlagen'
                      : 'Manuelle Prüfebene'}
                </p>
                <Reference value={criterion.reference} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">
            Keine Kriterienergebnisse aufgezeichnet.
          </p>
        )}
        <GitFacts observation={evidence.observation} />
      </article>
    </li>
  );
}

export function OrderEvidencePanel({
  projectId,
  orderId,
}: {
  projectId: string;
  orderId: string;
}) {
  const root = `/api/projects/${encodeURIComponent(projectId)}/orders/${encodeURIComponent(orderId)}`;
  const summary = useSummary(`${root}/lifecycle`);
  const approvals = useHistory<OrderApproval>(`${root}/approvals`);
  const progress = useHistory<Progress>(`${root}/progress`);
  const events = useHistory<LifecycleEvent>(`${root}/events`);
  const evidence = useHistory<Evidence>(`${root}/evidence`);
  const replacements = new Map(
    evidence.items
      .filter(
        (item) =>
          item.kind === 'implementation' &&
          item.outcome === 'success' &&
          item.supersedesId,
      )
      .map((item) => [item.supersedesId, item.id]),
  );
  return (
    <section
      aria-label="Freigabe, Bearbeitung und Nachweise"
      className="my-5 min-w-0 space-y-5"
    >
      <header>
        <h2 className="text-xl font-bold text-white">
          Freigabe, Bearbeitung und Nachweise
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-400">
          Diese Daten wurden von Codex aufgezeichnet. Gitfakten wurden von Codex
          lokal geprüft; Luufi führt keine unabhängige GitHub-Prüfung aus.
          „Bereit“ allein ist keine Nutzerfreigabe. Das Lesen startet keine
          Bearbeitung.
        </p>
      </header>
      <section
        className={panel}
        aria-label="Aktueller Freigabe- und Bearbeitungsstand"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-white">
            {summary.error && summary.data
              ? 'Zuletzt geladener Stand'
              : 'Aktueller Stand'}
          </h3>
          <button
            className={button}
            disabled={summary.loading}
            onClick={() => void summary.refresh()}
          >
            Aktualisieren
          </button>
        </div>
        {summary.loading && (
          <output className="mb-4 block text-sm text-slate-400">
            Stand wird geladen …
          </output>
        )}
        <ErrorNotice error={summary.error} retry={summary.refresh} />
        {summary.data && <Claim summary={summary.data} />}
        {!!summary.error && (
          <p className="mt-3 text-xs leading-6 text-slate-400">
            Die aktuelle Zuordnung konnte nicht bestätigt werden. Historische
            Nachweise bleiben getrennt lesbar.
          </p>
        )}
      </section>
      <HistorySection
        title="Freigabesnapshots"
        empty="Keine Freigabesnapshots aufgezeichnet."
        history={approvals}
      >
        <ul className="space-y-4">
          {approvals.items.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              projectId={projectId}
            />
          ))}
        </ul>
      </HistorySection>
      <HistorySection
        title="Fortschritt und Hindernisse"
        empty="Noch kein Fortschritt aufgezeichnet."
        history={progress}
      >
        <ol className="space-y-4">
          {progress.items.map((item) => (
            <li className={entry} key={item.id}>
              <h4 className="font-semibold text-white">
                {progressKinds[item.kind]}
              </h4>
              <p className="mt-2 text-xs leading-6 text-slate-400">
                <Timestamp value={item.createdAt} /> · Generation{' '}
                {item.generation}
              </p>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-200">
                {item.text}
              </p>
              {item.nextAction ? (
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-lime-200">
                  Nächste Aktion: {item.nextAction}
                </p>
              ) : (
                <p className="mt-3 text-xs text-slate-400">
                  Keine nächste Aktion hinterlegt.
                </p>
              )}
            </li>
          ))}
        </ol>
      </HistorySection>
      <HistorySection
        title="Lebenszyklusereignisse"
        empty="Keine Zustandsänderung aufgezeichnet."
        history={events}
      >
        <ol className="space-y-4">
          {events.items.map((event) => (
            <li key={event.id} className={entry}>
              <h4 className="font-semibold text-white">
                {statuses[event.previousStatus]} → {statuses[event.nextStatus]}
              </h4>
              <p className="mt-2 text-xs leading-6 text-slate-400">
                <Timestamp value={event.createdAt} /> · Fassung{' '}
                {event.specVersion}
              </p>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-200">
                {event.reason}
              </p>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <Fact title="Aufgezeichnet von">{event.actor}</Fact>
                <Fact title="Referenz">
                  <Reference value={event.reference} />
                </Fact>
              </dl>
              {Object.keys(event.details).length > 0 && (
                <details className="mt-4 min-w-0">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm text-lime-200">
                    Weitere Ereignisdetails
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-all text-xs leading-6 text-slate-400">
                    {JSON.stringify(event.details, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      </HistorySection>
      <HistorySection
        title="Prüf- und Gitnachweise"
        empty="Keine Prüf- oder Gitnachweise aufgezeichnet."
        history={evidence}
      >
        <p className="mb-4 text-xs leading-6 text-slate-400">
          Historische Fehler bleiben Fehler. Ein gespeicherter Beleg allein ist
          keine neue erfolgreiche Prüfung. Ersetzungen werden anhand geladener
          Belege und der aktuellen Zuordnung gekennzeichnet.
        </p>
        {summary.data &&
          !evidence.loading &&
          !evidence.error &&
          [
            [
              'Aktueller Implementierungsnachweis',
              summary.data.currentImplementationId,
            ],
            ['Integrationsnachweis', summary.data.integrationId],
          ].map(([title, id]) =>
            id && !evidence.items.some((item) => item.id === id) ? (
              <p
                key={id}
                className="mb-4 break-words text-sm leading-7 text-amber-200"
              >
                {title} {id}:{' '}
                {evidence.nextCursor
                  ? 'Noch nicht geladen. Weitere Nachweisseiten können nachgeladen werden.'
                  : 'In der geladenen Historie nicht verfügbar.'}
              </p>
            ) : null,
          )}
        <ol className="space-y-5">
          {evidence.items.map((item) => (
            <EvidenceCard
              key={item.id}
              evidence={item}
              summary={summary.error ? undefined : summary.data}
              replacedBy={replacements.get(item.id)}
            />
          ))}
        </ol>
      </HistorySection>
    </section>
  );
}
