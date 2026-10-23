'use client';

/* oxlint-disable next/no-img-element -- Protected original media must use the authenticated same-origin endpoint without an image proxy. */
/* oxlint-disable jsx-a11y/media-has-caption -- Original user footage has no authored caption track; automatic transcription is outside this scope. */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { SyntheticEvent } from 'react';
import Link from 'next/link';
import { Frame, ProjectNavigation } from '@/components/project-frame';
import {
  attachmentMimeTypes,
  imageMaxBytes,
  videoMaxBytes,
} from '@/lib/domain/feedback';
import type {
  Attachment,
  AttachmentManifest,
  Feedback,
  FeedbackEntry,
  FeedbackSaved,
  FeedbackSource,
  FeedbackSummary,
  Refinement,
} from '@/lib/domain/feedback';
import type { Page } from '@/lib/domain/planning';

const button =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 disabled:opacity-50';
const primary = `${button} border-lime-300 bg-lime-300 text-slate-950 hover:bg-lime-200`;
const panel =
  'min-w-0 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6';
const rootFor = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/feedback`;
const detailLink = (projectId: string, id: string) =>
  `/projects/${encodeURIComponent(projectId)}/feedback/${encodeURIComponent(id)}`;

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
const messageFor = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : 'Luufi ist gerade nicht erreichbar. Bitte erneut versuchen.';
function responseError(value: unknown, status: number) {
  return new ApiError(
    value &&
      typeof value === 'object' &&
      'error' in value &&
      typeof value.error === 'string'
      ? value.error
      : 'Die Anfrage ist fehlgeschlagen.',
    status,
  );
}
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const value: unknown = await response.json();
  if (!response.ok) throw responseError(value, response.status);
  return value as T;
}
function date(value: string) {
  return new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Vienna',
  }).format(new Date(value));
}
function ErrorNotice({
  error,
  retry,
}: {
  error?: unknown;
  retry?: () => void;
}) {
  return error ? (
    <div
      role="alert"
      className="my-4 rounded-2xl border border-red-300/30 bg-red-300/5 p-4 text-sm leading-6 text-red-200"
    >
      <p>{messageFor(error)}</p>
      {retry && (
        <button className={`${button} mt-3`} onClick={retry}>
          Erneut versuchen
        </button>
      )}
    </div>
  ) : null;
}
function usePages<T>(url: string) {
  const [state, setState] = useState<{
    url: string;
    items: T[];
    nextCursor: string | null;
    loading: boolean;
    error?: unknown;
  }>({ url, items: [], nextCursor: null, loading: true });
  const controller = useRef<AbortController | null>(null);
  const failed = useRef<string | null>(null);
  const load = useCallback(
    async (cursor: string | null = null) => {
      controller.current?.abort();
      const active = new AbortController();
      controller.current = active;
      failed.current = cursor;
      setState((previous) => ({
        url,
        items: previous.url === url ? previous.items : [],
        nextCursor: previous.url === url ? previous.nextCursor : null,
        loading: true,
      }));
      try {
        const page = await request<Page<T>>(
          `${url}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          { signal: active.signal },
        );
        if (!active.signal.aborted)
          setState((previous) => ({
            url,
            items: cursor ? [...previous.items, ...page.items] : page.items,
            nextCursor: page.nextCursor,
            loading: false,
          }));
      } catch (error) {
        if (!active.signal.aborted)
          setState((previous) => ({ ...previous, url, loading: false, error }));
      }
    },
    [url],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      controller.current?.abort();
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
        visible.error instanceof ApiError && visible.error.status === 409
          ? null
          : failed.current,
      ),
  };
}
function PageFeedback<T>({
  page,
  empty,
}: {
  page: ReturnType<typeof usePages<T>>;
  empty: string;
}) {
  return (
    <>
      <ErrorNotice error={page.error} retry={() => void page.retry()} />
      {page.loading && (
        <output className="my-4 block text-sm text-slate-400">
          Daten werden geladen …
        </output>
      )}
      {!page.loading && !page.error && !page.items.length && (
        <p className="my-5 text-sm leading-7 text-slate-400">{empty}</p>
      )}
      {page.nextCursor && (
        <button
          className={`${button} my-4`}
          disabled={page.loading}
          onClick={() => void page.more()}
        >
          Weitere laden
        </button>
      )}
    </>
  );
}

function validateFiles(files: File[]): AttachmentManifest[] {
  if (files.length > 10)
    throw new ApiError('Höchstens zehn Dateien je Eingabe auswählen.', 400);
  return files.map((file) => {
    if (
      !attachmentMimeTypes.includes(file.type as AttachmentManifest['mimeType'])
    )
      throw new ApiError(
        'Erlaubt sind JPEG, PNG, WebP, MP4, MOV und WebM.',
        400,
      );
    if (
      !file.name ||
      file.name.length > 255 ||
      /[/\\]/.test(file.name) ||
      Array.from(file.name).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new ApiError('Der Dateiname ist ungültig.', 400);
    const max = file.type.startsWith('image/') ? imageMaxBytes : videoMaxBytes;
    if (file.size <= 0 || file.size > max)
      throw new ApiError(
        'Bilder dürfen höchstens 10 MB, Videos höchstens 15 MB groß sein; leere Dateien sind nicht erlaubt.',
        400,
      );
    return {
      name: file.name,
      mimeType: file.type as AttachmentManifest['mimeType'],
      size: file.size,
    };
  });
}

type UploadAttempt = { key: string; revision: number };
function upload(
  attachment: Attachment,
  file: File,
  attempt: UploadAttempt,
  progress: (percent: number) => void,
  signal: AbortSignal,
): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      'PUT',
      `${rootFor(attachment.projectId)}/${encodeURIComponent(attachment.feedbackId)}/attachments/${encodeURIComponent(attachment.id)}`,
    );
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Luufi-Revision', String(attempt.revision));
    xhr.setRequestHeader('X-Luufi-Request-Key', attempt.key);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total)
        progress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    const abort = () => xhr.abort();
    const end = () => signal.removeEventListener('abort', abort);
    xhr.onload = () => {
      end();
      try {
        const value: unknown = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300)
          reject(responseError(value, xhr.status));
        else resolve(value as Attachment);
      } catch {
        reject(
          new ApiError(
            'Die Uploadbestätigung konnte nicht gelesen werden. Bitte erneut versuchen.',
            0,
          ),
        );
      }
    };
    xhr.onerror = () => {
      end();
      reject(
        new ApiError(
          'Die Dateiübertragung ist fehlgeschlagen. Der gespeicherte Text bleibt erhalten.',
          0,
        ),
      );
    };
    xhr.onabort = () => {
      end();
      reject(
        new ApiError(
          'Die Dateiübertragung wurde unterbrochen. Der gespeicherte Text bleibt erhalten.',
          0,
        ),
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      end();
      reject(new ApiError('Die Dateiübertragung wurde unterbrochen.', 0));
      return;
    }
    xhr.send(file);
  });
}

async function latestAttachment(attachment: Attachment, signal: AbortSignal) {
  let cursor: string | null = null;
  do {
    const page: Page<FeedbackEntry> = await request(
      `${rootFor(attachment.projectId)}/${encodeURIComponent(attachment.feedbackId)}/entries?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      { signal },
    );
    const found = page.items
      .flatMap((entry) => entry.attachments)
      .find((item) => item.id === attachment.id);
    if (found) return found;
    cursor = page.nextCursor;
  } while (cursor);
  throw new ApiError(
    'Der reservierte Anhang wurde nicht gefunden. Bitte den Feedbackstand neu laden.',
    404,
  );
}

function Media({ attachment }: { attachment: Attachment }) {
  const [playbackError, setPlaybackError] = useState(false);
  const mediaUrl = `${rootFor(attachment.projectId)}/${encodeURIComponent(attachment.feedbackId)}/attachments/${encodeURIComponent(attachment.id)}`;
  return (
    <div className="mt-3 space-y-3">
      {attachment.mimeType.startsWith('image/') ? (
        <img
          className="max-h-96 w-auto max-w-full rounded-xl"
          src={mediaUrl}
          alt={attachment.name}
          loading="lazy"
          onError={() => setPlaybackError(true)}
        />
      ) : (
        <video
          className="max-h-96 w-full rounded-xl"
          src={mediaUrl}
          controls
          preload="metadata"
          onError={() => setPlaybackError(true)}
        />
      )}
      {playbackError && (
        <output className="block text-sm text-amber-200">
          Die Vorschau kann hier nicht angezeigt oder abgespielt werden. Bitte
          die Datei herunterladen.
        </output>
      )}
      <a
        className={`${button} max-w-full break-all text-left`}
        href={`${mediaUrl}?download=1`}
      >
        Datei herunterladen: {attachment.name}
      </a>
    </div>
  );
}

type Transfer = {
  attachment: Attachment;
  file?: File;
  progress: number;
  busy: boolean;
  error?: unknown;
  attempt?: UploadAttempt;
};
function EntryAttachments({
  entry,
  files,
  auto = false,
  onChanged,
  onBusyChange,
}: {
  entry: FeedbackEntry;
  files?: File[];
  auto?: boolean;
  onChanged?: () => Promise<void> | void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const progressId = useId();
  const initial = () =>
    Object.fromEntries(
      entry.attachments.map((attachment, index) => [
        attachment.id,
        {
          attachment,
          file: files?.[index],
          progress: 0,
          busy: false,
        } satisfies Transfer,
      ]),
    );
  const [transfers, setTransfers] = useState<Record<string, Transfer>>(initial);
  const [queueActive, setQueueActive] = useState(
    auto &&
      entry.attachments.some((attachment) => attachment.status !== 'ready'),
  );
  const busy =
    queueActive || Object.values(transfers).some((transfer) => transfer.busy);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const current = useRef(transfers);
  const alive = useRef(true);
  const started = useRef(false);
  const initialIds = useRef(
    entry.attachments.map((attachment) => attachment.id),
  );
  const controllers = useRef(new Set<AbortController>());
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);
  const patch = useCallback((id: string, update: Partial<Transfer>) => {
    current.current = {
      ...current.current,
      [id]: { ...current.current[id], ...update },
    };
    if (alive.current) setTransfers(current.current);
  }, []);
  const transfer = useCallback(
    async (id: string) => {
      const value = current.current[id];
      if (
        Object.values(current.current).some((transfer) => transfer.busy) ||
        value.attachment.status === 'ready'
      )
        return;
      const file = value.file;
      if (!file) {
        patch(id, {
          error: new ApiError('Bitte die Datei erneut auswählen.', 400),
        });
        return;
      }
      if (
        file.name !== value.attachment.name ||
        file.size !== value.attachment.size ||
        file.type !== value.attachment.mimeType
      ) {
        patch(id, {
          error: new ApiError(
            'Die ausgewählte Datei muss dem reservierten Namen, Typ und der Größe entsprechen.',
            400,
          ),
        });
        return;
      }
      const attempt = value.attempt ?? {
        key: crypto.randomUUID(),
        revision: value.attachment.revision,
      };
      const controller = new AbortController();
      controllers.current.add(controller);
      patch(id, { busy: true, progress: 0, error: undefined, attempt });
      try {
        const attachment = await upload(
          value.attachment,
          file,
          attempt,
          (progress) => {
            if (alive.current) patch(id, { progress });
          },
          controller.signal,
        );
        if (!alive.current) return;
        patch(id, {
          attachment,
          busy: false,
          progress: 100,
          file: undefined,
          attempt: undefined,
        });
        await changed.current?.();
      } catch (error) {
        if (!alive.current) return;
        if (error instanceof ApiError && error.status === 409) {
          try {
            const attachment = await latestAttachment(
              value.attachment,
              controller.signal,
            );
            if (!alive.current) return;
            patch(id, {
              attachment,
              attempt: undefined,
              busy: false,
              error:
                attachment.status === 'ready'
                  ? undefined
                  : new ApiError(
                      'Der Anhangsstand wurde aktualisiert. Du kannst die Datei erneut übertragen.',
                      409,
                    ),
            });
            await changed.current?.();
          } catch (reloadError) {
            if (alive.current) patch(id, { busy: false, error: reloadError });
          }
        } else patch(id, { busy: false, error });
      } finally {
        controllers.current.delete(controller);
      }
    },
    [patch],
  );
  useEffect(() => {
    alive.current = true;
    const activeControllers = controllers.current;
    const timer = window.setTimeout(() => {
      if (auto && !started.current) {
        started.current = true;
        void (async () => {
          try {
            for (const id of initialIds.current) {
              if (!alive.current) return;
              await transfer(id);
            }
          } finally {
            if (alive.current) setQueueActive(false);
          }
        })();
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      alive.current = false;
      for (const controller of activeControllers) controller.abort();
    };
    // An entry owns one initial serial queue. Explicit retries use its retained attempt.
  }, [auto, transfer]);
  useEffect(() => {
    for (const attachment of entry.attachments) {
      const value = current.current[attachment.id];
      if (
        value &&
        !value.busy &&
        attachment.revision > value.attachment.revision
      )
        patch(attachment.id, {
          attachment,
          attempt: undefined,
          error: undefined,
        });
    }
  }, [entry, patch]);
  return entry.attachments.length ? (
    <ul aria-label="Anhänge" className="mt-5 space-y-4">
      {entry.attachments.map((item) => {
        const value = transfers[item.id] ?? {
          attachment: item,
          busy: false,
          progress: 0,
        };
        const attachment = value.attachment;
        return (
          <li
            key={attachment.id}
            className="min-w-0 rounded-2xl border border-white/10 p-4"
          >
            <p className="break-words font-semibold text-slate-200">
              {attachment.name}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {attachment.mimeType} ·{' '}
              {(attachment.size / 1_000_000).toLocaleString('de-AT', {
                maximumFractionDigits: 2,
              })}{' '}
              MB ·{' '}
              {attachment.status === 'ready'
                ? 'Gespeichert und geprüft'
                : attachment.status === 'expired'
                  ? 'Unvollständig · Upload abgelaufen'
                  : 'Unvollständig · Datei fehlt noch'}
            </p>
            {attachment.status === 'ready' ? (
              <Media attachment={attachment} />
            ) : (
              <>
                <p className="mt-3 text-sm text-slate-400">
                  Der Text ist bereits gespeichert.
                </p>
                {value.busy && (
                  <div className="mt-3">
                    <label
                      className="block text-sm"
                      htmlFor={`${progressId}-${attachment.id}`}
                    >
                      {value.progress < 100
                        ? `${value.progress} % übertragen`
                        : 'Übertragen · Serverprüfung läuft …'}
                    </label>
                    <progress
                      id={`${progressId}-${attachment.id}`}
                      className="mt-2 w-full accent-lime-300"
                      max={100}
                      value={value.progress}
                    />
                  </div>
                )}
                <label className="mt-3 block text-sm text-slate-300">
                  Datei erneut auswählen: {attachment.name}
                  <input
                    type="file"
                    accept={attachment.mimeType}
                    disabled={busy}
                    className="mt-2 block w-full min-w-0 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:p-2 file:text-white"
                    onChange={(event) =>
                      patch(attachment.id, {
                        file: event.target.files?.[0],
                        attempt: undefined,
                        error: undefined,
                      })
                    }
                  />
                </label>
                {value.file && (
                  <button
                    className={`${button} mt-3`}
                    disabled={busy}
                    onClick={() => void transfer(attachment.id)}
                  >
                    Datei übertragen: {attachment.name}
                  </button>
                )}
                <ErrorNotice error={value.error} />
              </>
            )}
          </li>
        );
      })}
    </ul>
  ) : null;
}

type TextAttempt = {
  signature: string;
  key: string;
  expectedRevision?: number;
};
const subscribeToHydration = () => () => undefined;
const clientHydrated = () => true;
const serverHydrated = () => false;
function FeedbackComposer({
  projectId,
  feedback,
  onSaved,
  onReset,
  refresh,
}: {
  projectId: string;
  feedback?: Feedback;
  onSaved?: (saved: FeedbackSaved) => void;
  onReset?: () => void;
  refresh?: () => Promise<void>;
}) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    clientHydrated,
    serverHydrated,
  );
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState<{
    result: FeedbackSaved;
    files: File[];
  }>();
  const attempt = useRef<TextAttempt | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hydrated || saving) return;
    setError(undefined);
    try {
      const attachments = validateFiles(files);
      if (text.length > 20_000 || (!text.trim() && !attachments.length))
        throw new ApiError(
          'Bitte Text oder mindestens eine Datei angeben. Höchstens 20.000 Zeichen sind erlaubt.',
          400,
        );
      const signature = JSON.stringify({ text, attachments });
      if (attempt.current?.signature !== signature)
        attempt.current = {
          signature,
          key: crypto.randomUUID(),
          expectedRevision: feedback?.revision,
        };
      const selected = attempt.current;
      const controller = new AbortController();
      active.current = controller;
      setSaving(true);
      const result = await request<FeedbackSaved>(
        feedback
          ? `${rootFor(projectId)}/${encodeURIComponent(feedback.id)}/entries`
          : rootFor(projectId),
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            attachments,
            requestKey: selected.key,
            ...(feedback
              ? { expectedRevision: selected.expectedRevision }
              : {}),
          }),
        },
      );
      if (controller.signal.aborted) return;
      setUploading(
        result.entry.attachments.some(
          (attachment) => attachment.status !== 'ready',
        ),
      );
      setSaved({ result, files });
      onSaved?.(result);
      attempt.current = null;
    } catch (failure) {
      if (active.current?.signal.aborted) return;
      setError(failure);
      if (failure instanceof ApiError && failure.status === 409) {
        attempt.current = null;
        await refresh?.();
      }
    } finally {
      if (!active.current?.signal.aborted) setSaving(false);
    }
  }
  if (saved)
    return (
      <section className={`${panel} my-5`} aria-label="Gespeicherte Eingabe">
        <output className="block font-bold text-lime-200">
          Text gespeichert. Dateien werden davon unabhängig übertragen.
        </output>
        <p className="mt-2 text-xs text-slate-400">
          {saved.result.entry.kind === 'original'
            ? 'Originalfeedback'
            : 'Ergänzung'}{' '}
          ·{' '}
          <time dateTime={saved.result.entry.createdAt}>
            {date(saved.result.entry.createdAt)}
          </time>
        </p>
        {saved.result.entry.text && (
          <p className="mt-4 whitespace-pre-wrap break-words leading-7 text-slate-200">
            {saved.result.entry.text}
          </p>
        )}
        <EntryAttachments
          key={saved.result.entry.id}
          entry={saved.result.entry}
          files={saved.files}
          auto
          onChanged={refresh}
          onBusyChange={setUploading}
        />
        <Link
          className={`${button} mt-5`}
          href={detailLink(projectId, saved.result.feedback.id)}
        >
          Gespeichertes Feedback öffnen
        </Link>
        <button
          className={`${button} ml-0 mt-3 sm:ml-3`}
          disabled={uploading}
          onClick={() => {
            if (uploading) return;
            setSaved(undefined);
            setText('');
            setFiles([]);
            setError(undefined);
            onReset?.();
          }}
        >
          {feedback
            ? 'Weitere Ergänzung erfassen'
            : 'Weiteres Feedback erfassen'}
        </button>
      </section>
    );
  return (
    <form
      className={`${panel} my-5`}
      aria-label={feedback ? 'Feedback ergänzen' : 'Feedback erfassen'}
      onSubmit={(event) => void save(event)}
    >
      <h2 className="mb-4 text-lg font-bold text-white">
        {feedback ? 'Datierte Ergänzung' : 'Neues Projektfeedback'}
      </h2>
      <label className="block text-sm font-semibold text-slate-300">
        {feedback ? 'Ergänzung' : 'Feedbacktext'}
        <textarea
          className="mt-2 min-h-36 w-full rounded-xl border border-white/20 bg-[#101722] p-3 text-base text-white focus-visible:outline-lime-300"
          maxLength={20_000}
          disabled={!hydrated || saving}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <p className="mt-2 text-xs text-slate-400">
        {text.length.toLocaleString('de-AT')} / 20.000 Zeichen. Gespeicherte
        Texte bleiben unverändert; weitere Inhalte werden Ergänzungen.
      </p>
      <label className="mt-5 block text-sm font-semibold text-slate-300">
        Dateien hinzufügen
        <input
          className="mt-2 block w-full min-w-0 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:p-2 file:text-white"
          type="file"
          multiple
          accept={attachmentMimeTypes.join(',')}
          disabled={!hydrated || saving}
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
      </label>
      <p className="mt-2 text-xs leading-6 text-slate-400">
        Bis zu zehn Dateien: JPEG, PNG oder WebP bis 10 MB; MP4, MOV oder WebM
        bis 15 MB je Datei. Keine automatische Analyse oder Umwandlung.
      </p>
      {files.length > 0 && (
        <ul className="mt-3 text-sm text-slate-300">
          {files.map((file, index) => (
            <li className="break-words" key={`${index}-${file.name}`}>
              {file.name}
            </li>
          ))}
        </ul>
      )}
      <ErrorNotice error={error} />
      <button
        className={`${primary} mt-5`}
        type="submit"
        disabled={!hydrated || saving}
      >
        {saving
          ? 'Text wird gespeichert …'
          : feedback
            ? 'Ergänzung speichern'
            : 'Feedback speichern'}
      </button>
    </form>
  );
}

function Refinements({
  projectId,
  feedbackId,
}: {
  projectId: string;
  feedbackId: string;
}) {
  const records = usePages<Refinement>(
    `${rootFor(projectId)}/${encodeURIComponent(feedbackId)}/refinements`,
  );
  return (
    <section className={`${panel} mt-6`} aria-label="Refinementergebnisse">
      <h2 className="mb-4 text-lg font-bold text-white">
        Refinementergebnisse
      </h2>
      <ol className="space-y-6">
        {records.items.map((record) => (
          <li
            key={record.id}
            className="min-w-0 border-b border-white/10 pb-5 last:border-0"
          >
            <p className="text-xs text-slate-400">
              <time dateTime={record.createdAt}>{date(record.createdAt)}</time>{' '}
              · Eingaberevision {record.inputContentRevision}
            </p>
            <p className="mt-3 whitespace-pre-wrap break-words leading-7 text-slate-200">
              {record.summary}
            </p>
            {record.orderIds.length > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold text-lime-200">
                  Verknüpfte Aufträge
                </h3>
                <ul className="mt-2 space-y-2">
                  {record.orderIds.map((id) => (
                    <li key={id}>
                      <Link
                        className="break-words underline underline-offset-4"
                        href={`/projects/${encodeURIComponent(projectId)}/orders/${encodeURIComponent(id)}`}
                      >
                        {id}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {record.questions.length > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold text-lime-200">Offene Fragen</h3>
                <ul className="mt-2 list-inside list-disc space-y-2 text-sm text-slate-300">
                  {record.questions.map((question, index) => (
                    <li key={index} className="whitespace-pre-wrap break-words">
                      {question}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {record.deferredReason && (
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">
                Zurückgestellt: {record.deferredReason}
              </p>
            )}
            {record.rejectedReason && (
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">
                Verworfen: {record.rejectedReason}
              </p>
            )}
            <dl className="mt-4 space-y-2 break-words text-xs leading-6 text-slate-400">
              <div>
                <dt>Repository-Commit</dt>
                <dd>{record.repositoryCommit}</dd>
              </div>
              <div>
                <dt>Dokumentationsrichtlinie</dt>
                <dd>{record.documentationPolicy}</dd>
              </div>
              <div>
                <dt>Planungsrichtlinie</dt>
                <dd>{record.planningPolicy}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
      <PageFeedback page={records} empty="Noch kein Refinement dokumentiert." />
      <p className="mt-4 text-xs leading-6 text-slate-400">
        Ein Refinement dokumentiert die Verarbeitung konkreter Eingaben. Es gibt
        keine Umsetzung frei.
      </p>
    </section>
  );
}

export function FeedbackCollection({ projectId }: { projectId: string }) {
  const feedback = usePages<FeedbackSummary>(rootFor(projectId));
  return (
    <Frame title="Projektfeedback">
      <ProjectNavigation projectId={projectId} active="feedback" />
      <p className="leading-7 text-slate-400">
        Halte Beobachtungen zu diesem Projekt fest. Der Originaltext bleibt
        erhalten; spätere Inhalte werden datierte Ergänzungen.
      </p>
      <FeedbackComposer
        key={projectId}
        projectId={projectId}
        onSaved={() => void feedback.refresh()}
        refresh={feedback.refresh}
      />
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-white">Gespeichertes Feedback</h2>
        <button
          className={button}
          disabled={feedback.loading}
          onClick={() => void feedback.refresh()}
        >
          Aktualisieren
        </button>
      </div>
      <ul className="space-y-4">
        {feedback.items.map((item) => (
          <li key={item.id}>
            <article className={panel}>
              <p className="mb-2 text-xs text-lime-200">
                {item.needsRefinement
                  ? 'Refinement erforderlich'
                  : 'Refinement aktuell'}
              </p>
              <h3 className="break-words text-lg font-semibold text-white">
                <Link
                  className="underline decoration-lime-300/40 underline-offset-4"
                  href={detailLink(projectId, item.id)}
                >
                  {item.originalPreview || 'Feedback mit Anhängen'}
                </Link>
              </h3>
              <p className="mt-3 text-xs leading-6 text-slate-400">
                <time dateTime={item.createdAt}>{date(item.createdAt)}</time> ·{' '}
                {item.entryCount}{' '}
                {item.entryCount === 1 ? 'Eingabe' : 'Eingaben'} ·{' '}
                {item.attachmentCount} Anhänge
                {item.pendingAttachmentCount
                  ? ` · ${item.pendingAttachmentCount} unvollständig`
                  : ''}
              </p>
            </article>
          </li>
        ))}
      </ul>
      <PageFeedback
        page={feedback}
        empty="Noch kein Feedback für dieses Projekt erfasst."
      />
    </Frame>
  );
}

export function FeedbackDetail({
  projectId,
  feedbackId,
}: {
  projectId: string;
  feedbackId: string;
}) {
  const url = `${rootFor(projectId)}/${encodeURIComponent(feedbackId)}`;
  const entries = usePages<FeedbackEntry>(`${url}/entries`);
  const [savedEntry, setSavedEntry] = useState<{ url: string; id: string }>();
  const [record, setRecord] = useState<{
    url: string;
    data?: Feedback;
    error?: unknown;
    loading: boolean;
  }>({ url, loading: true });
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setRecord((previous) => ({
      url,
      data: previous.url === url ? previous.data : undefined,
      loading: true,
    }));
    try {
      const data = await request<Feedback>(url, { signal: active.signal });
      if (!active.signal.aborted) setRecord({ url, data, loading: false });
    } catch (error) {
      if (!active.signal.aborted)
        setRecord((previous) => ({ ...previous, url, error, loading: false }));
    }
  }, [url]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      controller.current?.abort();
    };
  }, [refresh]);
  const visible = record.url === url ? record : { url, loading: true };
  const reload = async () => {
    await Promise.all([refresh(), entries.refresh()]);
  };
  return (
    <Frame title="Feedback" eyebrow="Projektfeedback">
      <ProjectNavigation projectId={projectId} active="feedback" />
      <Link
        className={`${button} mb-5`}
        href={`/projects/${encodeURIComponent(projectId)}/feedback`}
      >
        Zur Feedbackliste
      </Link>
      <ErrorNotice error={visible.error} retry={() => void refresh()} />
      {visible.loading && (
        <output className="mb-4 block text-sm text-slate-400">
          Feedback wird geladen …
        </output>
      )}
      {visible.data && (
        <>
          <output className="mb-5 block text-sm font-semibold text-lime-200">
            {visible.data.needsRefinement
              ? 'Refinement erforderlich'
              : 'Refinement für den aktuellen Eingabestand dokumentiert'}{' '}
            · Eingaberevision {visible.data.contentRevision}
          </output>
          <ol aria-label="Original und Ergänzungen" className="space-y-5">
            {entries.items
              .filter(
                (entry) =>
                  savedEntry?.url !== url || savedEntry.id !== entry.id,
              )
              .map((entry) => (
                <li key={entry.id}>
                  <article
                    className={panel}
                    aria-label={
                      entry.kind === 'original'
                        ? 'Originalfeedback'
                        : `Ergänzung ${entry.position}`
                    }
                  >
                    <h2 className="mb-2 text-lg font-bold text-white">
                      {entry.kind === 'original'
                        ? 'Originalfeedback'
                        : 'Ergänzung'}
                    </h2>
                    <time
                      className="text-xs text-slate-400"
                      dateTime={entry.createdAt}
                    >
                      {date(entry.createdAt)}
                    </time>
                    {entry.text ? (
                      <p className="mt-4 whitespace-pre-wrap break-words leading-7 text-slate-200">
                        {entry.text}
                      </p>
                    ) : (
                      <p className="mt-4 text-sm text-slate-400">
                        Eingabe ohne Text mit Anhängen.
                      </p>
                    )}
                    <EntryAttachments entry={entry} onChanged={reload} />
                  </article>
                </li>
              ))}
          </ol>
          <PageFeedback page={entries} empty="Keine Eingaben verfügbar." />
          <FeedbackComposer
            key={`${projectId}-${feedbackId}-composer`}
            projectId={projectId}
            feedback={visible.data}
            onSaved={(saved) => {
              setSavedEntry({ url, id: saved.entry.id });
              void reload();
            }}
            onReset={() => setSavedEntry(undefined)}
            refresh={reload}
          />
          <Refinements
            key={`${projectId}-${feedbackId}-refinements`}
            projectId={projectId}
            feedbackId={feedbackId}
          />
        </>
      )}
    </Frame>
  );
}

export function OrderFeedbackSources({
  projectId,
  orderId,
}: {
  projectId: string;
  orderId: string;
}) {
  const sources = usePages<FeedbackSource>(
    `/api/projects/${encodeURIComponent(projectId)}/orders/${encodeURIComponent(orderId)}/feedback-sources`,
  );
  return (
    <section className={`${panel} mt-5`} aria-label="Feedbackquellen">
      <h2 className="mb-4 text-lg font-bold text-white">Feedbackquellen</h2>
      <ul className="space-y-4">
        {sources.items.map((source) => (
          <li
            className="min-w-0 rounded-xl border border-white/10 p-4"
            key={`${source.feedbackId}-${source.refinementId}`}
          >
            <Link
              className="break-words font-semibold text-lime-200 underline underline-offset-4"
              href={detailLink(projectId, source.feedbackId)}
            >
              Ursprüngliches Projektfeedback öffnen
            </Link>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">
              {source.summary}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Eingaberevision {source.inputContentRevision} ·{' '}
              <time dateTime={source.createdAt}>{date(source.createdAt)}</time>
            </p>
          </li>
        ))}
      </ul>
      <PageFeedback page={sources} empty="Keine Feedbackquellen verknüpft." />
    </section>
  );
}
