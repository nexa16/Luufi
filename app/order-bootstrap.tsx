'use client';

import { useEffect, useState } from 'react';
import type { BootstrapEntry } from '@/lib/domain/releases';

const safeLink = (value: string | null) => {
  if (!value) return null;
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
};

export function OrderBootstrapProvenance({
  projectId,
  orderId,
}: {
  projectId: string;
  orderId: string;
}) {
  const url = `/api/projects/${encodeURIComponent(projectId)}/orders/${encodeURIComponent(orderId)}/bootstrap-provenance`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    url: string;
    value?: BootstrapEntry | null;
    error?: string;
  }>({ url });
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ url });
      void (async () => {
        try {
          const response = await fetch(url, {
            cache: 'no-store',
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          });
          const value: unknown = await response.json();
          if (!response.ok)
            throw new Error(
              value &&
                typeof value === 'object' &&
                'error' in value &&
                typeof value.error === 'string'
                ? value.error
                : 'Bootstrapbeleg konnte nicht geladen werden.',
            );
          if (!controller.signal.aborted)
            setState({ url, value: value as BootstrapEntry | null });
        } catch (error) {
          if (!controller.signal.aborted)
            setState({
              url,
              error:
                error instanceof Error
                  ? error.message
                  : 'Bootstrapbeleg konnte nicht geladen werden.',
            });
        }
      })();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url, attempt]);
  const current = state.url === url ? state : { url };
  if (current.value === null) return null;
  const proof = current.value;
  return (
    <section
      aria-label="Historischer Bootstrapbeleg"
      className="mb-5 min-w-0 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6"
    >
      <h2 className="text-lg font-bold text-white">
        Historischer Bootstrapbeleg
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        Dieser getrennte Neustartbeleg dokumentiert die bereits integrierte
        Umsetzung. Er enthält keine nachträglich erfundene Freigabe oder
        Bearbeitung.
      </p>
      {current.error ? (
        <div role="alert" className="mt-3 text-sm text-red-200">
          <p>{current.error}</p>
          <button
            className="mt-2 min-h-11 rounded-xl border border-white/20 px-4"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Erneut versuchen
          </button>
        </div>
      ) : !proof ? (
        <output className="mt-3 block text-sm text-slate-400">
          Bootstrapbeleg wird geladen …
        </output>
      ) : (
        <dl className="mt-4 space-y-3 break-words text-sm leading-6 text-slate-300">
          <div>
            <dt className="text-slate-400">Manifest und Fassung</dt>
            <dd>
              {proof.displayId} · Fassung {proof.specVersion} · Manifest{' '}
              {proof.manifestVersion}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Nachweisart</dt>
            <dd>
              {proof.kind === 'public-git'
                ? 'Öffentliche Git-Integration'
                : 'Privater Sites-Techniknachweis'}
            </dd>
          </div>
          {proof.implementationCommit && (
            <div>
              <dt className="text-slate-400">Auftragscommit</dt>
              <dd>{proof.implementationCommit}</dd>
            </div>
          )}
          {proof.integrationCommit && (
            <div>
              <dt className="text-slate-400">Integrationscommit</dt>
              <dd>{proof.integrationCommit}</dd>
            </div>
          )}
          <div>
            <dt className="text-slate-400">Quellcommit</dt>
            <dd>{proof.sourceCommit}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Prüfreferenz</dt>
            <dd className="whitespace-pre-wrap">
              {proof.verificationReference}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Beobachtet</dt>
            <dd>
              <time dateTime={proof.verifiedAt}>{proof.verifiedAt}</time>
            </dd>
          </div>
          {[
            ['Pull Request', proof.prUrl],
            ['CI', proof.ciUrl],
          ].map(
            ([label, value]) =>
              safeLink(value) && (
                <div key={label}>
                  <dt className="text-slate-400">{label}</dt>
                  <dd>
                    <a
                      className="text-lime-200 underline"
                      href={safeLink(value)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {label} öffnen
                    </a>
                  </dd>
                </div>
              ),
          )}
        </dl>
      )}
    </section>
  );
}
