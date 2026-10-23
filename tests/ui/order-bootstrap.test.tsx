import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderBootstrapProvenance } from '@/app/order-bootstrap';
import type { BootstrapEntry } from '@/lib/domain/releases';

const now = '2026-10-23T10:00:00.000Z';
const proof = (overrides: Partial<BootstrapEntry> = {}): BootstrapEntry => ({
  number: 2,
  kind: 'public-git',
  implementationCommit: 'a'.repeat(40),
  integrationCommit: 'b'.repeat(40),
  prUrl: 'https://github.com/nexa16/Luufi/pull/1',
  ciUrl: 'https://github.com/nexa16/Luufi/actions/runs/1',
  sourceCommit: 'c'.repeat(40),
  verificationReference:
    'Tatsächlicher öffentlicher Git-/CI-Abgleich durch Codex',
  verifiedAt: now,
  orderId: 'bootstrap-luufi-order-2',
  displayId: 'LUUFI-2',
  specVersion: 1,
  manifestVersion: '1.0.0',
  createdAt: now,
  ...overrides,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('LUUFI-18 getrennte historische Bootstrapprovenienz', () => {
  it('zeigt den tatsächlichen historischen Beleg ohne rückwirkende Freigabe oder aktive Bearbeitung', async () => {
    fetchMock.mockResolvedValue(json(proof()));
    render(
      <OrderBootstrapProvenance
        projectId="luufi"
        orderId="bootstrap-luufi-order-2"
      />,
    );
    const region = await screen.findByRole('region', {
      name: 'Historischer Bootstrapbeleg',
    });
    expect(
      await within(region).findByText(/LUUFI-2 · Fassung 1 · Manifest 1.0.0/),
    ).toBeInTheDocument();
    expect(region).toHaveTextContent(
      'keine nachträglich erfundene Freigabe oder Bearbeitung',
    );
    expect(region).toHaveTextContent('Öffentliche Git-Integration');
    expect(region).toHaveTextContent('a'.repeat(40));
    expect(region).toHaveTextContent('b'.repeat(40));
    expect(region).toHaveTextContent('c'.repeat(40));
    expect(region).toHaveTextContent(
      'Tatsächlicher öffentlicher Git-/CI-Abgleich durch Codex',
    );
    expect(region.querySelector('time')).toHaveAttribute('datetime', now);
    expect(
      within(region).getByRole('link', { name: 'Pull Request öffnen' }),
    ).toHaveAttribute('href', 'https://github.com/nexa16/Luufi/pull/1');
    expect(
      within(region).getByRole('link', { name: 'CI öffnen' }),
    ).toHaveAttribute('rel', 'noreferrer');
    expect(region).not.toHaveTextContent('Gültige Freigabe');
    expect(region).not.toHaveTextContent('Bearbeitung aktiv');
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
  });

  it('erfindet für den privaten Sites-Proof weder öffentliche Commits noch PR oder CI', async () => {
    fetchMock.mockResolvedValue(
      json(
        proof({
          number: 1,
          orderId: 'bootstrap-luufi-order-1',
          displayId: 'LUUFI-1',
          kind: 'sites-proof',
          implementationCommit: null,
          integrationCommit: null,
          prUrl: null,
          ciUrl: null,
          verificationReference: '<script>Kein HTML ausführen</script>',
        }),
      ),
    );
    const view = render(
      <OrderBootstrapProvenance
        projectId="luufi"
        orderId="bootstrap-luufi-order-1"
      />,
    );
    const region = await screen.findByRole('region', {
      name: 'Historischer Bootstrapbeleg',
    });
    await within(region).findByText('Privater Sites-Techniknachweis');
    expect(
      within(region).queryByText('Auftragscommit'),
    ).not.toBeInTheDocument();
    expect(
      within(region).queryByText('Integrationscommit'),
    ).not.toBeInTheDocument();
    expect(within(region).queryByRole('link')).not.toBeInTheDocument();
    expect(
      within(region).getByText('<script>Kein HTML ausführen</script>'),
    ).toBeInTheDocument();
    expect(view.container.querySelector('script')).toBeNull();
  });

  it('zeigt bei null nach dem Ladezustand keinen Bootstrapabschnitt', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<OrderBootstrapProvenance projectId="p/1" orderId="o/2" />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Bootstrapbeleg wird geladen',
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/projects/p%2F1/orders/o%2F2/bootstrap-provenance',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
    await act(async () => finish(json(null)));
    expect(
      screen.queryByRole('region', { name: 'Historischer Bootstrapbeleg' }),
    ).not.toBeInTheDocument();
  });

  it('zeigt einen Serverfehler und wiederholt nur den lesenden Belegabruf', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: 'Der historische Beleg ist gerade nicht verfügbar.' }, 503),
    );
    const user = userEvent.setup();
    render(<OrderBootstrapProvenance projectId="luufi" orderId="o1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'historische Beleg ist gerade nicht verfügbar',
    );
    fetchMock.mockResolvedValueOnce(json(proof()));
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByText('Öffentliche Git-Integration');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls).toHaveLength(2);
    expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[0][0]);
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method)).toBe(
      true,
    );
  });

  it('benennt auch einen Fehler ohne fachlichen Meldungstext und kann eine Netzwerkunterbrechung wiederholen', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500));
    const user = userEvent.setup();
    render(<OrderBootstrapProvenance projectId="luufi" orderId="o1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bootstrapbeleg konnte nicht geladen werden.',
    );
    fetchMock.mockRejectedValueOnce(new Error('Netzwerk unterbrochen'));
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Netzwerk unterbrochen',
    );
    fetchMock.mockResolvedValueOnce(json(null));
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Historischer Bootstrapbeleg' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('bricht beim Projekt-/Auftragswechsel ab und ignoriert eine dennoch eintreffende alte Antwort', async () => {
    let finish!: (response: Response) => void;
    let firstSignal!: AbortSignal;
    fetchMock.mockImplementation((_input, options) => {
      if (fetchMock.mock.calls.length === 1) {
        firstSignal = options?.signal as AbortSignal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return Promise.resolve(
        json(proof({ orderId: 'new-order', displayId: 'LUUFI-3' })),
      );
    });
    const view = render(
      <OrderBootstrapProvenance projectId="old" orderId="old-order" />,
    );
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    view.rerender(
      <OrderBootstrapProvenance projectId="new" orderId="new-order" />,
    );
    expect(firstSignal.aborted).toBe(true);
    await screen.findByText(/LUUFI-3 · Fassung/);
    await act(async () =>
      finish(json(proof({ displayId: 'Alter privater Kontext' }))),
    );
    expect(
      screen.queryByText(/Alter privater Kontext/),
    ).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/projects/new/orders/new-order/bootstrap-provenance',
    );
  });

  it('bricht beim Verlassen der Ansicht den laufenden Abruf ab', async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    const view = render(
      <OrderBootstrapProvenance projectId="luufi" orderId="o1" />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,bad',
    '//evil.invalid/path',
    'file:///private/file',
    'https://name:secret@example.com/path',
    'not a URL',
  ])(
    'macht unsichere PR-/CI-Referenzen nicht anklickbar: %s',
    async (value) => {
      fetchMock.mockResolvedValue(json(proof({ prUrl: value, ciUrl: value })));
      render(<OrderBootstrapProvenance projectId="luufi" orderId="o1" />);
      await screen.findByText('Öffentliche Git-Integration');
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    },
  );
});
