import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IdeasPage from '@/app/ideas/page';
import type { ProjectIdea } from '@/lib/domain/project-ideas';

const fetchMock = vi.fn<typeof fetch>();
const idea = (overrides: Partial<ProjectIdea> = {}): ProjectIdea => ({
  id: 'idea-1',
  text: 'Ein Gartenplaner',
  detail: 'Für den Balkon\nAuch im Winter',
  createdAt: '2026-10-23T08:00:00.000Z',
  revision: 1,
  ...overrides,
});
const reply = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
const pageReply = (
  items: ProjectIdea[] = [],
  nextCursor: string | null = null,
) => reply({ items, nextCursor });
const body = (call: number) => {
  const input = fetchMock.mock.calls[call][1]?.body;
  if (typeof input !== 'string') throw new Error('JSON request body expected');
  return JSON.parse(input);
};
const editor = () =>
  screen.getByRole('dialog', { name: /Neue Idee|Idee bearbeiten/ });
const title = () => within(editor()).getByLabelText('Titel');
const details = () => within(editor()).getByLabelText(/Details/);
const save = () => within(editor()).getByRole('button', { name: 'Speichern' });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
});

async function start(items: ProjectIdea[] = [], cursor: string | null = null) {
  pageReply(items, cursor);
  const user = userEvent.setup();
  render(<IdeasPage />);
  await waitFor(() =>
    expect(
      screen.queryByText('Ideen werden geladen …'),
    ).not.toBeInTheDocument(),
  );
  return user;
}

async function newDraft(text = 'Ein Lesetagebuch', detail = 'Meine Notizen') {
  const user = await start();
  await user.click(screen.getByRole('button', { name: '+ Neue Idee' }));
  await user.type(title(), text);
  if (detail) await user.type(details(), detail);
  return user;
}

describe('Projektideen', () => {
  it('zeigt Ladezustand, Sammlung, feste ID und deutsche Navigation', async () => {
    pageReply([idea()]);
    render(<IdeasPage />);
    expect(screen.getByText('Ideen werden geladen …')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Ein Gartenplaner' }),
    ).toBeInTheDocument();
    expect(screen.getByText('ID idea-1')).toBeInTheDocument();
    expect(screen.getByText(/Auch im Winter/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projektideen' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('legt eine eigenständige Idee ohne Projekt an und zeigt das gespeicherte Ergebnis', async () => {
    const user = await newDraft();
    reply({
      idea: idea({ text: 'Ein Lesetagebuch', detail: 'Meine Notizen' }),
    });
    await user.click(save());
    expect(
      await screen.findByRole('heading', { name: 'Ein Lesetagebuch' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(body(1)).toEqual({
      text: 'Ein Lesetagebuch',
      detail: 'Meine Notizen',
      requestKey: expect.any(String),
    });
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST');
    expect(screen.getByText('Idee angelegt.')).toBeInTheDocument();
  });

  it('beginnt aus der leeren Sammlung und erlaubt einen Titel ohne Details', async () => {
    const user = await start();
    expect(screen.getByText('Der erste Gedanke zählt.')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Erste Idee festhalten' }),
    );
    await user.type(title(), 'Nur ein Gedanke');
    reply({ idea: idea({ text: 'Nur ein Gedanke', detail: '' }) });
    await user.click(save());
    expect(
      await screen.findByRole('heading', { name: 'Nur ein Gedanke' }),
    ).toBeInTheDocument();
    expect(body(1).detail).toBe('');
  });

  it('bewahrt Text und Wiederholungsschlüssel bei unklarer Netzwerkantwort, auch nach Schließen', async () => {
    const user = await newDraft();
    fetchMock.mockRejectedValueOnce(new TypeError('Network failure'));
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'nicht erreichbar',
    );
    const original = body(1);
    expect(title()).toHaveValue('Ein Lesetagebuch');
    expect(details()).toHaveValue('Meine Notizen');
    await user.click(
      within(editor()).getByRole('button', { name: 'Schließen' }),
    );
    await user.click(screen.getByRole('button', { name: '+ Neue Idee' }));
    reply({ idea: idea() });
    await user.click(save());
    await screen.findByRole('heading', { name: 'Ein Gartenplaner' });
    expect(body(2)).toEqual(original);
  });

  it('verwendet nach einer Textänderung einen neuen Schlüssel', async () => {
    const user = await newDraft();
    reply({ error: 'Bitte später wiederholen.', code: 'unavailable' }, 503);
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bitte später wiederholen.',
    );
    const previousKey = body(1).requestKey;
    await user.type(title(), ' mit Suche');
    reply({ idea: idea({ text: 'Ein Lesetagebuch mit Suche' }) });
    await user.click(save());
    await screen.findByRole('heading', { name: 'Ein Lesetagebuch mit Suche' });
    expect(body(2).requestKey).not.toBe(previousKey);
  });

  it('überschreibt eine bestehende Idee mit derselben ID und erwarteter Revision', async () => {
    const user = await start([idea({ id: 'id/mit leerzeichen' })]);
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    expect(title()).toHaveValue('Ein Gartenplaner');
    expect(details()).toHaveValue('Für den Balkon\nAuch im Winter');
    await user.clear(title());
    await user.type(title(), 'Der neue Titel');
    reply({
      idea: idea({
        id: 'id/mit leerzeichen',
        text: 'Der neue Titel',
        revision: 2,
      }),
    });
    await user.click(save());
    expect(
      await screen.findByRole('heading', { name: 'Der neue Titel' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/ideas/id%2Fmit%20leerzeichen',
    );
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PATCH');
    expect(body(1).expectedRevision).toBe(1);
    expect(screen.getByText('Idee gespeichert.')).toBeInTheDocument();
  });

  it('macht Revisionskonflikte sichtbar und erhält den Entwurf beim Laden des aktuellen Stands', async () => {
    const user = await start([idea()]);
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    await user.clear(title());
    await user.type(title(), 'Mein Entwurf');
    reply(
      { error: 'Die Idee wurde inzwischen geändert.', code: 'conflict' },
      409,
    );
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'inzwischen geändert',
    );
    expect(save()).toBeDisabled();
    pageReply([idea({ id: 'other', text: 'Andere Idee' })], 'zweite seite');
    pageReply([
      idea({
        text: 'Aktueller Titel',
        detail: 'Neue fremde Details',
        revision: 3,
      }),
    ]);
    await user.click(
      screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
    );
    await waitFor(() => expect(save()).toBeEnabled());
    expect(title()).toHaveValue('Mein Entwurf');
    expect(screen.getByText(/Aktueller Stand:/)).toHaveTextContent(
      'Neue fremde Details',
    );
    expect(fetchMock.mock.calls[3][0]).toBe(
      '/api/ideas?limit=50&cursor=zweite%20seite',
    );
    reply({ idea: idea({ text: 'Mein Entwurf', revision: 4 }) });
    await user.click(save());
    await screen.findByRole('heading', { name: 'Mein Entwurf' });
    expect(body(4).expectedRevision).toBe(3);
    expect(body(4).requestKey).not.toBe(body(1).requestKey);
  });

  it('bewahrt Konflikt und Entwurf bei fehlgeschlagener Konflikt-Neuladung', async () => {
    const user = await start([idea()]);
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    reply({ error: 'Konflikt' }, 409);
    await user.click(save());
    await screen.findByRole('alert');
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await user.click(
      screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('nicht erreichbar'),
    );
    expect(title()).toHaveValue('Ein Gartenplaner');
    expect(save()).toBeDisabled();
    pageReply([idea({ revision: 2, detail: '' })]);
    await user.click(
      screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
    );
    await waitFor(() => expect(save()).toBeEnabled());
  });

  it('kann einen Entwurf nach zwischenzeitlicher Löschung als neue Idee speichern', async () => {
    const user = await start([idea()]);
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    reply(
      { error: 'Diese Idee wurde nicht gefunden.', code: 'not_found' },
      404,
    );
    await user.click(save());
    await screen.findByRole('alert');
    pageReply();
    await user.click(
      screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
    );
    await waitFor(() => expect(save()).toBeEnabled());
    expect(
      screen.getByText(/kann als neue Idee gespeichert/),
    ).toBeInTheDocument();
    reply({ idea: idea({ id: 'new-id' }) });
    await user.click(save());
    await screen.findByText('ID new-id');
    expect(fetchMock.mock.calls[3][0]).toBe('/api/ideas');
    expect(fetchMock.mock.calls[3][1]?.method).toBe('POST');
  });

  it('lädt über Cursor weitere Ideen ohne doppelte IDs oder Zurücksetzen neuer Revisionen', async () => {
    const user = await start([idea({ revision: 3 })], 'cursor/+');
    pageReply(
      [
        idea({ revision: 2, text: 'Veralteter Titel' }),
        idea({ id: 'two', text: 'Zweite Idee' }),
      ],
      'last',
    );
    await user.click(
      screen.getByRole('button', { name: 'Weitere Ideen laden' }),
    );
    await screen.findByRole('heading', { name: 'Zweite Idee' });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByText('Veralteter Titel')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/ideas?limit=20&cursor=cursor%2F%2B',
    );
    pageReply([idea({ revision: 4, text: 'Aktualisierte Idee' })]);
    await user.click(
      screen.getByRole('button', { name: 'Weitere Ideen laden' }),
    );
    await screen.findByRole('heading', { name: 'Aktualisierte Idee' });
    expect(
      screen.queryByRole('button', { name: 'Weitere Ideen laden' }),
    ).not.toBeInTheDocument();
  });

  it('wiederholt eine fehlgeschlagene Folgeseite am selben Cursor und erhält geladene Ideen', async () => {
    const user = await start([idea()], 'next');
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await user.click(
      screen.getByRole('button', { name: 'Weitere Ideen laden' }),
    );
    await screen.findByRole('alert');
    expect(
      screen.getByRole('heading', { name: 'Ein Gartenplaner' }),
    ).toBeInTheDocument();
    pageReply([idea({ id: 'two', text: 'Noch eine Idee' })]);
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByRole('heading', { name: 'Noch eine Idee' });
    expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[2][0]);
  });

  it('zeigt fehlende Sammlung als Fehler mit Wiederholung und ersetzt beim Aktualisieren den Stand', async () => {
    reply({}, 500);
    const user = userEvent.setup();
    render(<IdeasPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Anfrage ist fehlgeschlagen.',
    );
    pageReply([idea()]);
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByRole('heading', { name: 'Ein Gartenplaner' });
    pageReply();
    await user.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    await screen.findByText('Der erste Gedanke zählt.');
  });

  it('fragt vor dauerhaftem Löschen nach und lässt die Aktion abbrechen', async () => {
    const user = await start([idea()]);
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    const confirmation = screen.getByRole('dialog', { name: 'Idee löschen?' });
    expect(
      within(confirmation).getByText(/dauerhaft gelöscht/),
    ).toHaveTextContent('Ein Gartenplaner');
    await user.click(
      within(confirmation).getByRole('button', { name: 'Abbrechen' }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('article')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    reply({ deleted: true });
    await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    await screen.findByText('Idee gelöscht.');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(body(1)).toEqual({
      expectedRevision: 1,
      requestKey: expect.any(String),
    });
  });

  it('wiederholt eine unklare Löschung mit demselben Schlüssel', async () => {
    const user = await start([idea()]);
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('article')).toBeInTheDocument();
    reply({ deleted: true });
    await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    await screen.findByText('Idee gelöscht.');
    expect(body(2)).toEqual(body(1));
  });

  it('verlangt bei Löschkonflikt eine neue Bestätigung des aktuellen Stands', async () => {
    const user = await start([idea()]);
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    reply({ error: 'Die Idee wurde geändert.' }, 409);
    await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    await screen.findByRole('alert');
    expect(
      screen.getByRole('button', { name: 'Endgültig löschen' }),
    ).toBeDisabled();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await user.click(
      screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('nicht erreichbar'),
    );
    pageReply([idea({ text: 'Neuer Inhalt', revision: 2 })]);
    await user.click(
      screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Endgültig löschen' }),
      ).toBeEnabled(),
    );
    expect(
      within(screen.getByRole('dialog')).getByText(/dauerhaft gelöscht/),
    ).toHaveTextContent('Neuer Inhalt');
    reply({ deleted: true });
    await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    await screen.findByText('Idee gelöscht.');
    expect(body(4).expectedRevision).toBe(2);
    expect(body(4).requestKey).not.toBe(body(1).requestKey);
  });

  it('schließt die Löschbestätigung, wenn die Idee inzwischen entfernt wurde', async () => {
    const user = await start([idea()]);
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    reply(
      { error: 'Diese Idee wurde nicht gefunden.', code: 'not_found' },
      404,
    );
    await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    await screen.findByRole('alert');
    pageReply();
    await user.click(
      screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
    );
    await screen.findByText('Die Idee wurde bereits gelöscht.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('validiert Leerraum und zeigt die Textgrenzen ohne Text zu verlieren', async () => {
    const user = await newDraft('   ', 'Details');
    fireEvent.submit(
      within(editor())
        .getByRole('button', { name: 'Speichern' })
        .closest('form')!,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('höchstens 280');
    expect(title()).toHaveAttribute('maxlength', '280');
    expect(details()).toHaveAttribute('maxlength', '4000');
    expect(title()).toHaveValue('   ');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(title(), { target: { value: 'x'.repeat(281) } });
    fireEvent.submit(save().closest('form')!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(title(), { target: { value: 'Titel' } });
    fireEvent.change(details(), { target: { value: 'x'.repeat(4001) } });
    fireEvent.submit(save().closest('form')!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(
      within(editor()).getByRole('button', { name: 'Schließen' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('verhindert doppelte Aktionen und Schließen während einer laufenden Speicherung', async () => {
    const user = await newDraft();
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(save());
    expect(
      screen.getByRole('button', { name: 'Wird gespeichert …' }),
    ).toBeDisabled();
    expect(title()).toBeDisabled();
    fireEvent(editor(), new Event('cancel', { cancelable: true }));
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Wird gespeichert …' })
        .closest('form')!,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    finish(new Response(JSON.stringify({ idea: idea() })));
    await screen.findByText('Idee angelegt.');
  });

  it('verhindert doppelte Löschung und erlaubt Escape nach dem Fehler', async () => {
    const user = await start([idea()]);
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { cancelable: true }),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Wird gelöscht …' }),
    ).toBeDisabled();
    finish(
      new Response(JSON.stringify({ error: 'Später versuchen.' }), {
        status: 503,
      }),
    );
    await screen.findByRole('alert');
    fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { cancelable: true }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('behält einen nicht gespeicherten neuen Entwurf bei Escape und startet nach Bearbeiten eine leere neue Idee', async () => {
    const user = await start([idea()]);
    await user.click(screen.getByRole('button', { name: '+ Neue Idee' }));
    await user.type(title(), 'Entwurf');
    fireEvent(editor(), new Event('cancel', { cancelable: true }));
    await user.click(screen.getByRole('button', { name: '+ Neue Idee' }));
    expect(title()).toHaveValue('Entwurf');
    fireEvent(editor(), new Event('cancel', { cancelable: true }));
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    fireEvent(editor(), new Event('cancel', { cancelable: true }));
    await user.click(screen.getByRole('button', { name: '+ Neue Idee' }));
    expect(title()).toHaveValue('');
    expect(details()).toHaveValue('');
  });

  it('behandelt ungültige JSON-Antworten als technischen Fehler', async () => {
    const user = await newDraft();
    fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 502 }));
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'nicht erreichbar',
    );
    expect(title()).toHaveValue('Ein Lesetagebuch');
  });
});
