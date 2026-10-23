import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FeedbackCollection,
  FeedbackDetail,
  OrderFeedbackSources,
} from '@/app/feedback';
import FeedbackListPage from '@/app/projects/[projectId]/feedback/page';
import FeedbackDetailPage from '@/app/projects/[projectId]/feedback/[feedbackId]/page';
import type {
  Attachment,
  Feedback,
  FeedbackEntry,
  FeedbackSaved,
  FeedbackSummary,
  Refinement,
} from '@/lib/domain/feedback';

const now = '2026-10-23T10:00:00.000Z';
const root = '/api/projects/p1/feedback';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const page = <T,>(items: T[], nextCursor: string | null = null) =>
  json({ items, nextCursor });
const feedback = (overrides: Partial<Feedback> = {}): Feedback => ({
  id: 'f1',
  projectId: 'p1',
  revision: 0,
  contentRevision: 0,
  refinedContentRevision: null,
  needsRefinement: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const summary = (
  overrides: Partial<FeedbackSummary> = {},
): FeedbackSummary => ({
  ...feedback(),
  originalPreview: 'Der ursprüngliche Gedanke',
  entryCount: 1,
  attachmentCount: 0,
  pendingAttachmentCount: 0,
  ...overrides,
});
const attachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'a1',
  projectId: 'p1',
  feedbackId: 'f1',
  entryId: 'e1',
  name: 'bild.png',
  mimeType: 'image/png',
  size: 4,
  status: 'pending',
  revision: 0,
  sha256: null,
  createdAt: now,
  readyAt: null,
  mediaUrl: `${root}/f1/attachments/a1`,
  downloadUrl: `${root}/f1/attachments/a1?download=1`,
  ...overrides,
});
const entry = (overrides: Partial<FeedbackEntry> = {}): FeedbackEntry => ({
  id: 'e1',
  feedbackId: 'f1',
  kind: 'original',
  text: 'Original bleibt erhalten.',
  position: 0,
  createdAt: now,
  attachments: [],
  ...overrides,
});
const saved = (overrides: Partial<FeedbackSaved> = {}): FeedbackSaved => ({
  feedback: feedback(),
  entry: entry(),
  ...overrides,
});
const refinement = (overrides: Partial<Refinement> = {}): Refinement => ({
  id: 'r1',
  feedbackId: 'f1',
  inputContentRevision: 0,
  createdAt: now,
  repositoryCommit: 'a'.repeat(40),
  documentationPolicy: '1.0.0',
  planningPolicy: '1.0.0',
  summary: 'Die Beobachtung ist einem Auftrag zugeordnet.',
  orderIds: ['o1'],
  questions: ['Welcher Einstieg ist betroffen?'],
  deferredReason: 'Eine Teilfrage wartet.',
  rejectedReason: '',
  ...overrides,
});
const fetchMock = vi.fn<typeof fetch>();
const requestUrl = (input: Parameters<typeof fetch>[0]) =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
const body = (index: number) =>
  JSON.parse(
    fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')[
      index
    ][1]?.body as string,
  );

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload = {
    onprogress: null as
      | null
      | ((event: {
          loaded: number;
          total: number;
          lengthComputable: boolean;
        }) => void),
  };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  onabort: null | (() => void) = null;
  status = 0;
  responseText = '';
  withCredentials = false;
  aborted = false;
  headers: Record<string, string> = {};
  url = '';
  file?: File;
  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    expect(method).toBe('PUT');
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(file: File) {
    this.file = file;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  finish(value: unknown, status = 200) {
    this.status = status;
    this.responseText = JSON.stringify(value);
    this.onload?.();
  }
}

function detailApi(
  entries = [entry()],
  current = feedback(),
  records: Refinement[] = [],
) {
  fetchMock.mockImplementation(async (input) => {
    const url = requestUrl(input);
    if (url.includes('/entries')) return page(entries);
    if (url.includes('/refinements')) return page(records);
    return json(current);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  FakeXhr.instances = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

describe('LUUFI-12 Feedback lesen und ergänzen', () => {
  it('sperrt die servergerenderte Eingabe bis die Hydration die Ereignishandler bereitstellt', async () => {
    fetchMock.mockResolvedValue(page([]));
    const container = document.createElement('div');
    container.innerHTML = renderToString(<FeedbackCollection projectId="p1" />);
    const controls = within(container);
    expect(controls.getByLabelText('Feedbacktext')).toBeDisabled();
    expect(controls.getByLabelText('Dateien hinzufügen')).toBeDisabled();
    expect(
      controls.getByRole('button', { name: 'Feedback speichern' }),
    ).toBeDisabled();
    document.body.appendChild(container);
    render(<FeedbackCollection projectId="p1" />, { container, hydrate: true });
    await waitFor(() =>
      expect(controls.getByLabelText('Feedbacktext')).toBeEnabled(),
    );
    expect(controls.getByLabelText('Dateien hinzufügen')).toBeEnabled();
    expect(
      controls.getByRole('button', { name: 'Feedback speichern' }),
    ).toBeEnabled();
    const user = userEvent.setup();
    await user.type(
      controls.getByLabelText('Feedbacktext'),
      'Nach der Hydration erhalten',
    );
    expect(controls.getByLabelText('Feedbacktext')).toHaveValue(
      'Nach der Hydration erhalten',
    );
    expect(controls.getByText(/27 \/ 20.000 Zeichen/)).toBeInTheDocument();
  });
  it('bricht den laufenden Textaufruf beim Projektwechsel ab und übernimmt dessen Antwort oder Dateien nicht', async () => {
    let finish!: (value: Response) => void;
    let postSignal!: AbortSignal;
    fetchMock.mockImplementation(async (_input, options) => {
      if (options?.method === 'POST') {
        postSignal = options.signal as AbortSignal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return page([]);
    });
    const user = userEvent.setup();
    const view = render(<FeedbackCollection projectId="p1" />);
    await user.type(
      screen.getByLabelText('Feedbacktext'),
      'Nur für Projekt eins',
    );
    await user.upload(
      screen.getByLabelText('Dateien hinzufügen'),
      new File(['png!'], 'bild.png', { type: 'image/png' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Feedback speichern' }),
    );
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    view.rerender(<FeedbackCollection projectId="p2" />);
    expect(postSignal.aborted).toBe(true);
    await act(async () =>
      finish(
        json(
          saved({
            entry: entry({
              text: 'Nur für Projekt eins',
              attachments: [attachment()],
            }),
          }),
          201,
        ),
      ),
    );
    expect(screen.getByLabelText('Feedbacktext')).toHaveValue('');
    expect(
      screen.queryByRole('region', { name: 'Gespeicherte Eingabe' }),
    ).not.toBeInTheDocument();
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it.each([false, true])(
    'hält die neue Eingabe während der Uploadqueue gesperrt (Ergänzung: %s)',
    async (addition) => {
      const first = attachment();
      const second = attachment({ id: 'a2', name: 'zweites.png' });
      fetchMock.mockImplementation(async (input, options) => {
        if (options?.method === 'POST')
          return json(
            saved({ entry: entry({ attachments: [first, second] }) }),
            201,
          );
        if (
          !addition ||
          requestUrl(input).includes('/entries') ||
          requestUrl(input).includes('/refinements')
        )
          return page([]);
        return json(feedback());
      });
      const user = userEvent.setup();
      render(
        addition ? (
          <FeedbackDetail projectId="p1" feedbackId="f1" />
        ) : (
          <FeedbackCollection projectId="p1" />
        ),
      );
      await user.type(
        await screen.findByLabelText(addition ? 'Ergänzung' : 'Feedbacktext'),
        'Text vor Dateien',
      );
      await user.upload(screen.getByLabelText('Dateien hinzufügen'), [
        new File(['png!'], 'bild.png', { type: 'image/png' }),
        new File(['png!'], 'zweites.png', { type: 'image/png' }),
      ]);
      await user.click(
        screen.getByRole('button', {
          name: addition ? 'Ergänzung speichern' : 'Feedback speichern',
        }),
      );
      await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
      const next = screen.getByRole('button', {
        name: addition
          ? 'Weitere Ergänzung erfassen'
          : 'Weiteres Feedback erfassen',
      });
      expect(next).toBeDisabled();
      await user.click(next);
      expect(FakeXhr.instances[0].aborted).toBe(false);
      act(() =>
        FakeXhr.instances[0].finish({ ...first, status: 'ready', revision: 1 }),
      );
      await waitFor(() => expect(FakeXhr.instances).toHaveLength(2));
      expect(next).toBeDisabled();
      act(() =>
        FakeXhr.instances[1].finish({
          ...second,
          status: 'ready',
          revision: 1,
        }),
      );
      await waitFor(() => expect(next).toBeEnabled());
      await user.click(next);
      expect(
        screen.getByLabelText(addition ? 'Ergänzung' : 'Feedbacktext'),
      ).toHaveValue('');
    },
  );

  it('lässt einen wartenden Slot nicht manuell an der seriellen Uploadqueue vorbeistarten', async () => {
    const first = attachment();
    const second = attachment({ id: 'a2', name: 'zweites.png' });
    fetchMock.mockImplementation(async (_input, options) =>
      options?.method === 'POST'
        ? json(saved({ entry: entry({ attachments: [first, second] }) }), 201)
        : page([]),
    );
    const user = userEvent.setup();
    render(<FeedbackCollection projectId="p1" />);
    await user.upload(screen.getByLabelText('Dateien hinzufügen'), [
      new File(['png!'], 'bild.png', { type: 'image/png' }),
      new File(['png!'], 'zweites.png', { type: 'image/png' }),
    ]);
    await user.click(
      screen.getByRole('button', { name: 'Feedback speichern' }),
    );
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    const secondButton = screen.getByRole('button', {
      name: 'Datei übertragen: zweites.png',
    });
    expect(secondButton).toBeDisabled();
    await user.click(secondButton);
    expect(FakeXhr.instances).toHaveLength(1);
    act(() =>
      FakeXhr.instances[0].finish({ ...first, status: 'ready', revision: 1 }),
    );
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(2));
    expect(FakeXhr.instances[1].url).toBe(`${root}/f1/attachments/a2`);
  });

  it('zeigt eine gerade gespeicherte Ergänzung mit aktiver Übertragung nur einmal', async () => {
    let appended = false;
    const addition = entry({
      id: 'e2',
      kind: 'addition',
      position: 1,
      text: 'Neue Ergänzung',
      attachments: [attachment({ entryId: 'e2' })],
    });
    fetchMock.mockImplementation(async (input, options) => {
      if (options?.method === 'POST') {
        appended = true;
        return json(saved({ entry: addition }), 201);
      }
      const url = requestUrl(input);
      if (url.includes('/entries'))
        return page(appended ? [entry(), addition] : [entry()]);
      return url.includes('/refinements') ? page([]) : json(feedback());
    });
    const user = userEvent.setup();
    render(<FeedbackDetail projectId="p1" feedbackId="f1" />);
    await user.type(
      await screen.findByLabelText('Ergänzung'),
      'Neue Ergänzung',
    );
    await user.upload(
      screen.getByLabelText('Dateien hinzufügen'),
      new File(['png!'], 'bild.png', { type: 'image/png' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Ergänzung speichern' }),
    );
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryAllByText('Daten werden geladen …')).toHaveLength(0),
    );
    expect(
      screen.getAllByLabelText('Datei erneut auswählen: bild.png'),
    ).toHaveLength(1);
    expect(
      screen.getByRole('article', { name: 'Originalfeedback' }),
    ).toHaveTextContent('Original bleibt erhalten.');
    act(() =>
      FakeXhr.instances[0].finish({
        ...attachment(),
        status: 'ready',
        revision: 1,
      }),
    );
    const next = screen.getByRole('button', {
      name: 'Weitere Ergänzung erfassen',
    });
    await waitFor(() => expect(next).toBeEnabled());
    await user.click(next);
    await screen.findByRole('article', { name: 'Ergänzung 1' });
  });
  it('zeigt paginierte Feedbackzusammenfassungen, Unvollständigkeit und geschützte Projektlinks', async () => {
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).includes('cursor=more')
        ? page([
            summary({ id: 'f2', originalPreview: '', needsRefinement: false }),
          ])
        : page(
            [summary({ attachmentCount: 2, pendingAttachmentCount: 1 })],
            'more',
          ),
    );
    const user = userEvent.setup();
    render(
      await FeedbackListPage({ params: Promise.resolve({ projectId: 'p1' }) }),
    );
    expect(
      await screen.findByRole('link', { name: 'Der ursprüngliche Gedanke' }),
    ).toHaveAttribute('href', '/projects/p1/feedback/f1');
    expect(screen.getByText(/1 unvollständig/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Feedback' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(screen.getByRole('button', { name: 'Weitere laden' }));
    await screen.findByRole('link', { name: 'Feedback mit Anhängen' });
    expect(screen.getByText('Refinement aktuell')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('wiederholt einen fehlgeschlagenen Leseabruf und erklärt leere Listen', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<FeedbackCollection projectId="p1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'nicht erreichbar',
    );
    fetchMock.mockResolvedValue(page([]));
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByText('Noch kein Feedback für dieses Projekt erfasst.');
  });

  it('bewahrt Originaltext und Ergänzungen und sendet eine neue datierte Ergänzung mit Revision', async () => {
    detailApi(
      [
        entry(),
        entry({
          id: 'e2',
          kind: 'addition',
          text: 'Eine weitere Beobachtung.',
          position: 1,
        }),
      ],
      feedback({ revision: 3 }),
    );
    const user = userEvent.setup();
    render(
      await FeedbackDetailPage({
        params: Promise.resolve({ projectId: 'p1', feedbackId: 'f1' }),
      }),
    );
    await screen.findByRole('article', { name: 'Originalfeedback' });
    expect(
      screen.getByRole('article', { name: 'Ergänzung 1' }),
    ).toHaveTextContent('Eine weitere Beobachtung.');
    expect(
      screen.queryByRole('button', {
        name: /bearbeiten|löschen|freigeben|analysieren/i,
      }),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText('Ergänzung', { exact: true }),
      '  Neue Ergänzung\nmit Abstand  ',
    );
    fetchMock.mockImplementation(async (input, options) =>
      options?.method === 'POST'
        ? json(
            saved({
              entry: entry({
                id: 'e3',
                kind: 'addition',
                text: '  Neue Ergänzung\nmit Abstand  ',
                position: 2,
              }),
            }),
            201,
          )
        : requestUrl(input).includes('/entries')
          ? page([entry()])
          : requestUrl(input).includes('/refinements')
            ? page([])
            : json(feedback({ revision: 4 })),
    );
    await user.click(
      screen.getByRole('button', { name: 'Ergänzung speichern' }),
    );
    await screen.findByText(
      'Text gespeichert. Dateien werden davon unabhängig übertragen.',
    );
    expect(body(0)).toMatchObject({
      text: '  Neue Ergänzung\nmit Abstand  ',
      attachments: [],
      expectedRevision: 3,
    });
    expect(
      fetchMock.mock.calls.find(
        ([, options]) => options?.method === 'POST',
      )?.[0],
    ).toBe(`${root}/f1/entries`);
    expect(
      screen.getByRole('article', { name: 'Originalfeedback' }),
    ).toHaveTextContent('Original bleibt erhalten.');
  });

  it('wiederholt ungewisses Textspeichern mit demselben Schlüssel und nimmt für geänderten Text einen neuen', async () => {
    fetchMock.mockImplementation(async (_input, options) =>
      options?.method === 'POST'
        ? Promise.reject(new Error('response lost'))
        : page([]),
    );
    const user = userEvent.setup();
    render(<FeedbackCollection projectId="p1" />);
    await user.type(screen.getByLabelText('Feedbacktext'), 'Ein Gedanke');
    await user.click(
      screen.getByRole('button', { name: 'Feedback speichern' }),
    );
    await screen.findByRole('alert');
    await user.click(
      screen.getByRole('button', { name: 'Feedback speichern' }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([, options]) => options?.method === 'POST',
        ),
      ).toHaveLength(2),
    );
    expect(body(1).requestKey).toBe(body(0).requestKey);
    await user.type(screen.getByLabelText('Feedbacktext'), ' verändert');
    await user.click(
      screen.getByRole('button', { name: 'Feedback speichern' }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([, options]) => options?.method === 'POST',
        ),
      ).toHaveLength(3),
    );
    expect(body(2).requestKey).not.toBe(body(1).requestKey);
  });

  it('speichert Text vor seriellen Uploads, unterscheidet Bytefortschritt und Prüfung und bewahrt fertige Dateien', async () => {
    const first = attachment();
    const second = attachment({ id: 'a2', name: 'zweites.png' });
    fetchMock.mockImplementation(async (_input, options) =>
      options?.method === 'POST'
        ? json(saved({ entry: entry({ attachments: [first, second] }) }), 201)
        : page([]),
    );
    const user = userEvent.setup();
    render(<FeedbackCollection projectId="p1" />);
    await user.type(
      screen.getByLabelText('Feedbacktext'),
      'Unabhängig gespeicherter Text',
    );
    await user.upload(screen.getByLabelText('Dateien hinzufügen'), [
      new File(['png!'], 'bild.png', { type: 'image/png' }),
      new File(['png!'], 'zweites.png', { type: 'image/png' }),
    ]);
    await user.click(
      screen.getByRole('button', { name: 'Feedback speichern' }),
    );
    await screen.findByText(
      'Text gespeichert. Dateien werden davon unabhängig übertragen.',
    );
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    const xhr = FakeXhr.instances[0];
    expect(xhr.headers['X-Luufi-Revision']).toBe('0');
    expect(xhr.withCredentials).toBe(true);
    act(() =>
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 }),
    );
    expect(screen.getByLabelText('50 % übertragen')).toHaveValue(50);
    act(() =>
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 4 }),
    );
    expect(
      screen.getByText('Übertragen · Serverprüfung läuft …'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Gespeichert und geprüft/),
    ).not.toBeInTheDocument();
    act(() => xhr.finish({ ...first, status: 'ready', revision: 1 }));
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(2));
    act(() => FakeXhr.instances[1].onerror?.());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Text bleibt erhalten',
    );
    expect(screen.getByRole('img', { name: 'bild.png' })).toHaveAttribute(
      'src',
      `${root}/f1/attachments/a1`,
    );
    expect(
      screen.getByRole('link', { name: 'Datei herunterladen: bild.png' }),
    ).toHaveAttribute('href', `${root}/f1/attachments/a1?download=1`);
    const failedKey = FakeXhr.instances[1].headers['X-Luufi-Request-Key'];
    await user.click(
      screen.getByRole('button', { name: 'Datei übertragen: zweites.png' }),
    );
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(3));
    expect(FakeXhr.instances[2].headers['X-Luufi-Request-Key']).toBe(failedKey);
    act(() =>
      FakeXhr.instances[2].finish({ ...second, status: 'ready', revision: 1 }),
    );
    await screen.findByRole('img', { name: 'zweites.png' });
  });

  it('lässt nach Neuladen nur zum reservierten Slot passende Dateien erneut auswählen', async () => {
    detailApi([
      entry({ attachments: [attachment({ status: 'expired', revision: 2 })] }),
    ]);
    const user = userEvent.setup();
    render(<FeedbackDetail projectId="p1" feedbackId="f1" />);
    const fileInput = await screen.findByLabelText(
      'Datei erneut auswählen: bild.png',
    );
    expect(screen.getByText(/Upload abgelaufen/)).toBeInTheDocument();
    await user.upload(
      fileInput,
      new File(['png!'], 'anders.png', { type: 'image/png' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Datei übertragen: bild.png' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'reservierten Namen',
    );
    expect(FakeXhr.instances).toHaveLength(0);
    await user.upload(
      fileInput,
      new File(['png!'], 'bild.png', { type: 'image/png' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Datei übertragen: bild.png' }),
    );
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    expect(FakeXhr.instances[0].headers['X-Luufi-Revision']).toBe('2');
    act(() =>
      FakeXhr.instances[0].finish({
        ...attachment(),
        status: 'ready',
        revision: 3,
      }),
    );
    await screen.findByRole('img', { name: 'bild.png' });
  });

  it('lädt bei Uploadkonflikt den Slot neu und ersetzt eine inzwischen fertige Datei nicht', async () => {
    let ready = false;
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).includes('/entries')
        ? page([
            entry({
              attachments: [
                attachment(ready ? { status: 'ready', revision: 1 } : {}),
              ],
            }),
          ])
        : requestUrl(input).includes('/refinements')
          ? page([])
          : json(feedback()),
    );
    const user = userEvent.setup();
    render(<FeedbackDetail projectId="p1" feedbackId="f1" />);
    await user.upload(
      await screen.findByLabelText('Datei erneut auswählen: bild.png'),
      new File(['png!'], 'bild.png', { type: 'image/png' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Datei übertragen: bild.png' }),
    );
    ready = true;
    act(() =>
      FakeXhr.instances[0].finish({ error: 'Inzwischen geändert.' }, 409),
    );
    await screen.findByRole('img', { name: 'bild.png' });
    expect(
      screen.queryByRole('button', { name: 'Datei übertragen: bild.png' }),
    ).not.toBeInTheDocument();
    expect(FakeXhr.instances).toHaveLength(1);
  });

  it('bietet bei nicht abspielbaren geschützten Videos den Downloadfallback an', async () => {
    detailApi([
      entry({
        attachments: [
          attachment({
            mimeType: 'video/quicktime',
            name: 'film.mov',
            status: 'ready',
            mediaUrl: 'https://untrusted.invalid/file',
            downloadUrl: 'javascript:alert(1)',
          }),
        ],
      }),
    ]);
    const view = render(<FeedbackDetail projectId="p1" feedbackId="f1" />);
    await screen.findByRole('link', { name: 'Datei herunterladen: film.mov' });
    const video = view.container.querySelector('video')!;
    expect(video).toHaveAttribute('src', `${root}/f1/attachments/a1`);
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('preload', 'metadata');
    fireEvent.error(video);
    await screen.findByText(/Bitte die Datei herunterladen/);
    expect(
      screen.getByRole('link', { name: 'Datei herunterladen: film.mov' }),
    ).toHaveAttribute('href', `${root}/f1/attachments/a1?download=1`);
  });

  it('verwendet nach einem Konflikt für einen unfertigen Slot die frische Revision und einen neuen Uploadschlüssel', async () => {
    let revision = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('/entries'))
        return page([entry({ attachments: [attachment({ revision })] })]);
      return url.includes('/refinements') ? page([]) : json(feedback());
    });
    const user = userEvent.setup();
    render(<FeedbackDetail projectId="p1" feedbackId="f1" />);
    await user.upload(
      await screen.findByLabelText('Datei erneut auswählen: bild.png'),
      new File(['png!'], 'bild.png', { type: 'image/png' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Datei übertragen: bild.png' }),
    );
    const oldKey = FakeXhr.instances[0].headers['X-Luufi-Request-Key'];
    revision = 2;
    act(() =>
      FakeXhr.instances[0].finish({ error: 'Veralteter Anhangsstand.' }, 409),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Anhangsstand wurde aktualisiert',
    );
    await user.click(
      screen.getByRole('button', { name: 'Datei übertragen: bild.png' }),
    );
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(2));
    expect(FakeXhr.instances[1].headers['X-Luufi-Revision']).toBe('2');
    expect(FakeXhr.instances[1].headers['X-Luufi-Request-Key']).not.toBe(
      oldKey,
    );
    act(() =>
      FakeXhr.instances[1].finish({
        ...attachment(),
        status: 'ready',
        revision: 3,
      }),
    );
    await screen.findByRole('img', { name: 'bild.png' });
  });

  it('ignoriert verspätete Quellantworten des vorherigen Projektkontexts', async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).includes('/old/')
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : page([]),
    );
    const view = render(<OrderFeedbackSources projectId="old" orderId="o1" />);
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    view.rerender(<OrderFeedbackSources projectId="new" orderId="o1" />);
    await screen.findByText('Keine Feedbackquellen verknüpft.');
    act(() =>
      finish(
        page([
          {
            feedbackId: 'private-old',
            refinementId: 'r1',
            inputContentRevision: 0,
            summary: 'Alter Projektinhalt',
            createdAt: now,
          },
        ]),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText('Alter Projektinhalt')).not.toBeInTheDocument(),
    );
  });

  it('zeigt gespeicherte versiongebundene Refinements und weitere Eingabeseiten ohne automatische Aktionen', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('/entries'))
        return url.includes('cursor=more')
          ? page([
              entry({
                id: 'e2',
                position: 1,
                kind: 'addition',
                text: 'Spätere Ergänzung',
              }),
            ])
          : page([entry()], 'more');
      if (url.includes('/refinements'))
        return url.includes('cursor=ref-more')
          ? page([
              refinement({
                id: 'r2',
                orderIds: [],
                questions: [],
                deferredReason: '',
                rejectedReason: 'Keine passende Umsetzung.',
              }),
            ])
          : page([refinement()], 'ref-more');
      return json(
        feedback({ needsRefinement: false, refinedContentRevision: 0 }),
      );
    });
    const user = userEvent.setup();
    render(<FeedbackDetail projectId="p1" feedbackId="f1" />);
    const region = await screen.findByRole('region', {
      name: 'Refinementergebnisse',
    });
    expect(
      await within(region).findByText('Welcher Einstieg ist betroffen?'),
    ).toBeInTheDocument();
    expect(region).toHaveTextContent('Eingaberevision 0');
    expect(region).toHaveTextContent('a'.repeat(40));
    expect(within(region).getByRole('link', { name: 'o1' })).toHaveAttribute(
      'href',
      '/projects/p1/orders/o1',
    );
    await user.click(
      within(region).getByRole('button', { name: 'Weitere laden' }),
    );
    await within(region).findByText('Verworfen: Keine passende Umsetzung.');
    await user.click(screen.getByRole('button', { name: 'Weitere laden' }));
    await screen.findByText('Spätere Ergänzung');
    expect(
      screen.getByRole('article', { name: 'Originalfeedback' }),
    ).toBeInTheDocument();
  });

  it('liest paginierte Auftragsquellen mit ihrer konkreten Eingaberevision und Rückverweis', async () => {
    const source = {
      feedbackId: 'f1',
      refinementId: 'r1',
      inputContentRevision: 3,
      summary: 'Aus dieser Quelle entstand der Auftrag.',
      createdAt: now,
    };
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).includes('cursor=more')
        ? page([{ ...source, feedbackId: 'f2', refinementId: 'r2' }])
        : page([source], 'more'),
    );
    const user = userEvent.setup();
    render(<OrderFeedbackSources projectId="p1" orderId="o1" />);
    expect(await screen.findByText(/Eingaberevision 3/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'Ursprüngliches Projektfeedback öffnen',
      }),
    ).toHaveAttribute('href', '/projects/p1/feedback/f1');
    await user.click(screen.getByRole('button', { name: 'Weitere laden' }));
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(2));
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/projects/p1/orders/o1/feedback-sources?limit=20&cursor=more',
    );
  });

  it('validiert leere Eingaben und Dateigrenzen vor dem Speichern', async () => {
    fetchMock.mockResolvedValue(page([]));
    const user = userEvent.setup();
    render(<FeedbackCollection projectId="p1" />);
    await user.click(
      screen.getByRole('button', { name: 'Feedback speichern' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Text oder mindestens eine Datei',
    );
    fireEvent.change(screen.getByLabelText('Dateien hinzufügen'), {
      target: {
        files: [new File(['x'], 'unbekannt.txt', { type: 'text/plain' })],
      },
    });
    await user.click(
      screen.getByRole('button', { name: 'Feedback speichern' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'JPEG, PNG, WebP, MP4, MOV und WebM',
    );
    expect(
      fetchMock.mock.calls.every(([, options]) => options?.method !== 'POST'),
    ).toBe(true);
  });
});
