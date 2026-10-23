'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode, SyntheticEvent } from 'react';
import { PrimaryNavigation } from '@/components/primary-navigation';
import type { ProjectIdea } from '@/lib/domain/project-ideas';
import {
  projectIdeaDetailLimit,
  projectIdeaTextLimit,
} from '@/lib/domain/project-ideas';

type Page = { items: ProjectIdea[]; nextCursor: string | null };
type Attempt = { signature: string; key: string };
type Failure = { message: string; conflict: boolean };
const secondary =
  'rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 disabled:opacity-50';
const primary =
  'rounded-xl bg-lime-300 px-4 py-2 font-bold text-slate-950 transition hover:bg-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-100 disabled:opacity-50';

class ApiFailure extends Error {
  constructor(
    message: string,
    readonly conflict: boolean,
  ) {
    super(message);
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new ApiFailure(
      payload &&
        typeof payload === 'object' &&
        'error' in payload &&
        typeof payload.error === 'string'
        ? payload.error
        : 'Die Anfrage ist fehlgeschlagen.',
      response.status === 409 || response.status === 404,
    );
  }
  return payload as T;
}

function failure(error: unknown): Failure {
  return {
    message:
      error instanceof ApiFailure
        ? error.message
        : 'Luufi ist gerade nicht erreichbar. Bitte erneut versuchen.',
    conflict: error instanceof ApiFailure && error.conflict,
  };
}

function mergeIdeas(
  current: ProjectIdea[],
  incoming: ProjectIdea[],
): ProjectIdea[] {
  const merged = new Map(current.map((idea) => [idea.id, idea]));
  for (const idea of incoming) {
    const previous = merged.get(idea.id);
    if (!previous || previous.revision <= idea.revision)
      merged.set(idea.id, idea);
  }
  return [...merged.values()];
}

function Modal({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl border border-white/15 bg-[#101722] p-6 text-white shadow-2xl backdrop:bg-black/75"
    >
      <h2 className="mb-5 text-xl font-bold tracking-tight">{title}</h2>
      {children}
    </dialog>
  );
}

export function ProjectIdeas() {
  const [ideas, setIdeas] = useState<ProjectIdea[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectIdea | null>(null);
  const [text, setText] = useState('');
  const [detail, setDetail] = useState('');
  const [formError, setFormError] = useState<Failure>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectIdea | null>(null);
  const [deleteError, setDeleteError] = useState<Failure>();
  const [deleting, setDeleting] = useState(false);
  const [conflictLoading, setConflictLoading] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const attempt = useRef<Attempt | null>(null);
  const deleteAttempt = useRef<Attempt | null>(null);
  const listBusy = useRef(false);
  const failedCursor = useRef<string | null>(null);

  async function load(cursor: string | null = null) {
    if (listBusy.current) return;
    listBusy.current = true;
    failedCursor.current = cursor;
    setLoading(true);
    setListError(undefined);
    try {
      const page = await request<Page>(
        `/api/ideas?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      setIdeas((current) => mergeIdeas(cursor ? current : [], page.items));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setListError(failure(error).message);
    } finally {
      listBusy.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  function openEditor(idea: ProjectIdea | null) {
    if (idea && editing?.id !== idea.id) {
      setText(idea.text);
      setDetail(idea.detail);
    } else if (!idea && editing) {
      setText('');
      setDetail('');
    }
    setEditing(idea);
    setFormError(undefined);
    setNotice(undefined);
    if (editing?.id !== idea?.id) attempt.current = null;
    setEditorOpen(true);
  }

  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || formError?.conflict) return;
    if (
      !text.trim() ||
      text.length > projectIdeaTextLimit ||
      detail.length > projectIdeaDetailLimit
    ) {
      setFormError({
        message:
          'Bitte einen Titel mit höchstens 280 und Details mit höchstens 4.000 Zeichen eingeben.',
        conflict: false,
      });
      return;
    }
    const input = {
      text,
      detail,
      ...(editing ? { expectedRevision: editing.revision } : {}),
    };
    const signature = JSON.stringify({ id: editing?.id, ...input });
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    setSaving(true);
    setFormError(undefined);
    setNotice(undefined);
    try {
      const { idea } = await request<{ idea: ProjectIdea }>(
        editing ? `/api/ideas/${encodeURIComponent(editing.id)}` : '/api/ideas',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...input, requestKey: attempt.current.key }),
        },
      );
      setIdeas((current) =>
        editing ? mergeIdeas(current, [idea]) : mergeIdeas([idea], current),
      );
      setAnnouncement(editing ? 'Idee gespeichert.' : 'Idee angelegt.');
      setText('');
      setDetail('');
      setEditing(null);
      setEditorOpen(false);
      attempt.current = null;
    } catch (error) {
      setFormError(failure(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleteTarget || deleting || deleteError?.conflict) return;
    const input = { expectedRevision: deleteTarget.revision };
    const signature = JSON.stringify({ id: deleteTarget.id, ...input });
    if (deleteAttempt.current?.signature !== signature)
      deleteAttempt.current = { signature, key: crypto.randomUUID() };
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await request<{ deleted: true }>(
        `/api/ideas/${encodeURIComponent(deleteTarget.id)}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...input,
            requestKey: deleteAttempt.current.key,
          }),
        },
      );
      setIdeas((current) =>
        current.filter((idea) => idea.id !== deleteTarget.id),
      );
      setDeleteTarget(null);
      deleteAttempt.current = null;
      setAnnouncement('Idee gelöscht.');
    } catch (error) {
      setDeleteError(failure(error));
    } finally {
      setDeleting(false);
    }
  }

  async function reloadConflict(target: ProjectIdea, forDelete: boolean) {
    setConflictLoading(true);
    try {
      let cursor: string | null = null;
      let items: ProjectIdea[] = [];
      do {
        const page: Page = await request<Page>(
          `/api/ideas?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        items = mergeIdeas(items, page.items);
        cursor = page.nextCursor;
      } while (cursor);
      setIdeas(items);
      setNextCursor(null);
      const latest = items.find((idea) => idea.id === target.id);
      if (!latest) {
        if (forDelete) {
          setDeleteTarget(null);
          setAnnouncement('Die Idee wurde bereits gelöscht.');
        } else {
          setEditing(null);
          setFormError(undefined);
          attempt.current = null;
          setNotice(
            'Diese Idee wurde inzwischen gelöscht. Dein Entwurf bleibt erhalten und kann als neue Idee gespeichert werden.',
          );
        }
        return;
      }
      if (forDelete) {
        setDeleteTarget(latest);
        setDeleteError(undefined);
        deleteAttempt.current = null;
      } else {
        setEditing(latest);
        setFormError(undefined);
        attempt.current = null;
        setNotice(
          `Aktueller Stand: „${latest.text}“${latest.detail ? ` — ${latest.detail}` : ''}. Dein Entwurf bleibt erhalten. Prüfe ihn vor erneutem Speichern.`,
        );
      }
    } catch (error) {
      const result = { ...failure(error), conflict: true };
      if (forDelete) setDeleteError(result);
      else setFormError(result);
    } finally {
      setConflictLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-5 pb-32 pt-7 sm:px-8 sm:pt-12">
      <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-fuchsia-300">
            Raum für neue Gedanken
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">
            Projektideen
          </h1>
        </div>
        <button
          className={primary}
          disabled={loading}
          onClick={() => openEditor(null)}
        >
          + Neue Idee
        </button>
      </header>
      <p className="mb-8 max-w-xl text-base leading-7 text-slate-400">
        Halte fest, was dich beschäftigt. Eine Idee braucht noch kein Projekt
        und startet keine Umsetzung.
      </p>
      <output className="sr-only">{announcement}</output>
      <section aria-label="Gespeicherte Projektideen" aria-busy={loading}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-200">Deine Sammlung</h2>
          <button
            className={secondary}
            disabled={loading}
            onClick={() => void load()}
          >
            Aktualisieren
          </button>
        </div>
        {loading && (
          <output className="mb-5 block text-slate-400">
            Ideen werden geladen …
          </output>
        )}
        {listError && (
          <div
            role="alert"
            className="mb-5 rounded-2xl border border-red-300/30 bg-red-300/5 p-5 text-red-200"
          >
            <p>{listError}</p>
            <button
              className={`${secondary} mt-3`}
              onClick={() => void load(failedCursor.current)}
            >
              Erneut versuchen
            </button>
          </div>
        )}
        {!loading && !listError && ideas.length === 0 && (
          <div className="rounded-3xl border border-fuchsia-300/20 bg-fuchsia-300/5 px-6 py-12 text-center">
            <h3 className="text-xl font-bold text-white">
              Der erste Gedanke zählt.
            </h3>
            <p className="mx-auto mt-3 max-w-sm leading-7 text-slate-400">
              Hier ist Platz für deine nächste Projektidee. Ein kurzer Titel
              genügt.
            </p>
            <button
              className={`${primary} mt-6`}
              onClick={() => openEditor(null)}
            >
              Erste Idee festhalten
            </button>
          </div>
        )}
        <ul className="grid gap-4 sm:grid-cols-2">
          {ideas.map((idea) => (
            <li key={idea.id}>
              <article
                className="flex h-full min-w-0 flex-col rounded-3xl border border-white/10 bg-white/[0.035] p-5"
                aria-label={idea.text}
              >
                <p className="mb-3 text-xs font-semibold text-fuchsia-300">
                  ID {idea.id}
                </p>
                <h3 className="break-words text-lg font-bold leading-7 text-white">
                  {idea.text}
                </h3>
                {idea.detail && (
                  <p className="mt-3 whitespace-pre-wrap break-words leading-7 text-slate-400">
                    {idea.detail}
                  </p>
                )}
                <time
                  dateTime={idea.createdAt}
                  className="mb-5 mt-4 text-xs text-slate-500"
                >
                  {new Intl.DateTimeFormat('de-AT', {
                    dateStyle: 'medium',
                    timeZone: 'Europe/Vienna',
                  }).format(new Date(idea.createdAt))}
                </time>
                <div className="mt-auto flex flex-wrap gap-2">
                  <button
                    className={secondary}
                    disabled={loading}
                    onClick={() => openEditor(idea)}
                  >
                    Bearbeiten
                  </button>
                  <button
                    className={`${secondary} text-red-200`}
                    disabled={loading}
                    onClick={() => {
                      setDeleteTarget(idea);
                      setDeleteError(undefined);
                    }}
                  >
                    Löschen
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ul>
        {nextCursor && (
          <button
            className={`${secondary} mx-auto mt-6 block`}
            disabled={loading}
            onClick={() => void load(nextCursor)}
          >
            Weitere Ideen laden
          </button>
        )}
      </section>
      {editorOpen && (
        <Modal
          title={editing ? 'Idee bearbeiten' : 'Neue Idee'}
          busy={saving || conflictLoading}
          onClose={() => setEditorOpen(false)}
        >
          <form onSubmit={(event) => void save(event)}>
            <label className="block font-semibold" htmlFor="idea-text">
              Titel
            </label>
            <textarea
              id="idea-text"
              name="text"
              required
              maxLength={projectIdeaTextLimit}
              rows={3}
              value={text}
              disabled={saving || conflictLoading}
              onChange={(event) => setText(event.target.value)}
              aria-describedby="text-limit"
              className="mt-2 w-full resize-y rounded-xl border border-white/20 bg-black/20 p-3 text-white outline-none focus:border-lime-300"
            />
            <p
              id="text-limit"
              className="mt-1 text-right text-xs text-slate-400"
            >
              {text.length} / {projectIdeaTextLimit}
            </p>
            <label className="mt-5 block font-semibold" htmlFor="idea-detail">
              Details{' '}
              <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              id="idea-detail"
              name="detail"
              maxLength={projectIdeaDetailLimit}
              rows={5}
              value={detail}
              disabled={saving || conflictLoading}
              onChange={(event) => setDetail(event.target.value)}
              aria-describedby="detail-limit"
              className="mt-2 w-full resize-y rounded-xl border border-white/20 bg-black/20 p-3 text-white outline-none focus:border-lime-300"
            />
            <p
              id="detail-limit"
              className="mt-1 text-right text-xs text-slate-400"
            >
              {detail.length} / {projectIdeaDetailLimit}
            </p>
            {notice && (
              <output className="mt-4 block whitespace-pre-wrap break-words rounded-xl bg-lime-300/10 p-3 text-sm leading-6 text-lime-200">
                {notice}
              </output>
            )}
            {formError && (
              <div role="alert" className="mt-4 text-sm leading-6 text-red-200">
                <p>{formError.message}</p>
                {formError.conflict && editing && (
                  <button
                    type="button"
                    className={`${secondary} mt-3`}
                    disabled={conflictLoading}
                    onClick={() => void reloadConflict(editing, false)}
                  >
                    Aktuellen Stand laden
                  </button>
                )}
              </div>
            )}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                className={secondary}
                disabled={saving || conflictLoading}
                onClick={() => setEditorOpen(false)}
              >
                Schließen
              </button>
              <button
                className={primary}
                disabled={saving || conflictLoading || formError?.conflict}
              >
                {saving ? 'Wird gespeichert …' : 'Speichern'}
              </button>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-400">
              Bei einem Fehler bleibt dein Text in diesem Fenster erhalten.
              Nicht gespeicherte Entwürfe gehen beim Neuladen der Seite
              verloren.
            </p>
          </form>
        </Modal>
      )}
      {deleteTarget && (
        <Modal
          title="Idee löschen?"
          busy={deleting || conflictLoading}
          onClose={() => setDeleteTarget(null)}
        >
          <p className="break-words leading-7 text-slate-300">
            „{deleteTarget.text}“ wird dauerhaft gelöscht. Dieser Schritt lässt
            sich nicht rückgängig machen.
          </p>
          {deleteError && (
            <div role="alert" className="mt-4 text-sm leading-6 text-red-200">
              <p>{deleteError.message}</p>
              {deleteError.conflict && (
                <button
                  className={`${secondary} mt-3`}
                  disabled={conflictLoading}
                  onClick={() => void reloadConflict(deleteTarget, true)}
                >
                  Aktuellen Stand laden
                </button>
              )}
            </div>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              className={secondary}
              disabled={deleting || conflictLoading}
              onClick={() => setDeleteTarget(null)}
            >
              Abbrechen
            </button>
            <button
              className="rounded-xl bg-red-300 px-4 py-2 font-bold text-slate-950 hover:bg-red-200 disabled:opacity-50"
              disabled={deleting || conflictLoading || deleteError?.conflict}
              onClick={() => void remove()}
            >
              {deleting ? 'Wird gelöscht …' : 'Endgültig löschen'}
            </button>
          </div>
        </Modal>
      )}
      <PrimaryNavigation active="ideas" />
    </main>
  );
}
