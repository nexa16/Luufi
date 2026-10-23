import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderEvidencePanel } from '@/app/order-evidence';
import type {
  Evidence,
  Execution,
  GitObservation,
  LifecycleEvent,
  LifecycleSummary,
  OrderApproval,
  Progress,
} from '@/lib/domain/execution';

const now = '2026-10-23T10:00:00.000Z';
const sha = 'a'.repeat(40);
const head = 'b'.repeat(40);
const root = '/api/projects/p1/orders/o1';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const page = <T,>(items: T[], nextCursor: string | null = null) =>
  json({ items, nextCursor });
const execution = (overrides: Partial<Execution> = {}): Execution => ({
  id: 'execution-1',
  projectId: 'p1',
  orderId: 'o1',
  specVersion: 2,
  approvalId: 'approval-1',
  worker: 'Codex',
  branch: 'codex/feature',
  generation: 3,
  revision: 0,
  phase: 'active',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const summary = (
  overrides: Partial<LifecycleSummary> = {},
): LifecycleSummary => ({
  orderId: 'o1',
  revision: 3,
  lifecycleRevision: 4,
  approval: null,
  execution: null,
  currentImplementationId: null,
  integrationId: null,
  ...overrides,
});
const approval = (overrides: Partial<OrderApproval> = {}): OrderApproval => ({
  id: 'approval-1',
  projectId: 'p1',
  revision: 0,
  mode: 'milestone',
  milestoneId: 'm1',
  confirmationReference: 'Chatfreigabe 23. Oktober',
  itemCount: 65,
  createdAt: now,
  revokedAt: null,
  scope: {
    orderId: 'o1',
    specVersion: 2,
    title: 'Freigegebener Titel',
    dependencyIds: ['dependency-1'],
    repository: 'example/demo',
    integrationBranch: 'develop',
    invalidatedAt: null,
    invalidatedReason: '',
  },
  valid: true,
  reason: '',
  ...overrides,
});
const progress = (overrides: Partial<Progress> = {}): Progress => ({
  id: 'progress-1',
  orderId: 'o1',
  executionId: 'execution-1',
  generation: 3,
  kind: 'obstacle',
  text: 'Eine Voraussetzung fehlt noch.',
  nextAction: 'Den fehlenden Nachweis prüfen.',
  createdAt: now,
  ...overrides,
});
const event = (overrides: Partial<LifecycleEvent> = {}): LifecycleEvent => ({
  id: 'event-1',
  orderId: 'o1',
  specVersion: 2,
  actor: 'Codex Owner-Verbindung',
  previousStatus: 'ready',
  nextStatus: 'implementing',
  reason: 'Freigegebene Bearbeitung begonnen.',
  reference: 'Chatreferenz',
  details: { generation: 3 },
  createdAt: now,
  ...overrides,
});
const observation = (
  overrides: Partial<GitObservation> = {},
): GitObservation => ({
  repository: 'example/demo',
  branch: 'develop',
  remoteRef: 'origin/develop',
  headSha: head,
  commitSha: sha,
  observedAt: now,
  source: 'codex-local-git',
  commitSubject: 'feat(DEMO-3): Nachweise lesen',
  parentShas: ['c'.repeat(40)],
  ancestorOfHead: true,
  pushed: true,
  pr: {
    url: 'https://github.com/example/demo/pull/1',
    baseBranch: 'develop',
    headSha: sha,
    merged: true,
    mergeSha: head,
    normalMerge: true,
  },
  ci: [
    {
      url: 'https://github.com/example/demo/actions/runs/1',
      name: 'verify',
      headSha: sha,
      conclusion: 'success',
    },
  ],
  ...overrides,
});
const evidence = (overrides: Partial<Evidence> = {}): Evidence => ({
  id: 'evidence-1',
  orderId: 'o1',
  specVersion: 2,
  kind: 'integration',
  outcome: 'success',
  executionId: 'execution-1',
  generation: 3,
  commitSha: sha,
  summary: 'Der aktuelle Auftragscommit ist normal integriert.',
  criteria: [
    { id: 'AC1', result: 'pass', reference: 'https://example.com/test/1' },
  ],
  documentationReference: 'docs/features/example.md',
  observation: observation(),
  validationId: 'validation-1',
  unavailableBuildReason: 'Für diesen synthetischen Stand fehlt ein Build.',
  supersedesId: null,
  createdAt: now,
  ...overrides,
});
const fetchMock = vi.fn<typeof fetch>();
const requestUrl = (input: Parameters<typeof fetch>[0]) =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
function api(
  options: {
    lifecycle?: LifecycleSummary;
    approvals?: OrderApproval[];
    progress?: Progress[];
    events?: LifecycleEvent[];
    evidence?: Evidence[];
  } = {},
) {
  fetchMock.mockImplementation(async (input) => {
    const url = requestUrl(input);
    if (url.endsWith('/lifecycle')) return json(options.lifecycle ?? summary());
    if (url.includes('/approvals')) return page(options.approvals ?? []);
    if (url.includes('/progress')) return page(options.progress ?? []);
    if (url.includes('/events')) return page(options.events ?? []);
    return page(options.evidence ?? []);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('LUUFI-15 lesende Freigabe- und Nachweisansicht', () => {
  it('benennt fehlende Freigabe, Bearbeitung und Nachweise ohne einen Start oder Erfolg zu erfinden', async () => {
    api();
    render(<OrderEvidencePanel projectId="p1" orderId="o1" />);
    expect(
      await screen.findByText('Keine Freigabe aufgezeichnet.'),
    ).toBeInTheDocument();
    await screen.findByText('Keine Prüf- oder Gitnachweise aufgezeichnet.');
    expect(screen.getByText('Keine aktive Bearbeitung.')).toBeInTheDocument();
    expect(
      screen.getByText('Kein aktueller Implementierungsnachweis hinterlegt.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Kein Integrationsnachweis hinterlegt.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/„Bereit“ allein ist keine Nutzerfreigabe/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /freigeben|starten|pausieren|übernehmen|speichern|archivieren/i,
      }),
    ).not.toBeInTheDocument();
    expect(fetchMock.mock.calls).toHaveLength(5);
    expect(
      fetchMock.mock.calls.every(
        ([, options]) => !options?.method && options?.cache === 'no-store',
      ),
    ).toBe(true);
  });

  it('zeigt den eingefrorenen Freigabescope und trennt unterbrochene Arbeit von einer gültigen Freigabe', async () => {
    api({
      lifecycle: summary({
        approval: { id: 'approval-1', specVersion: 2, valid: true, reason: '' },
        execution: execution({ phase: 'paused' }),
      }),
      approvals: [approval()],
    });
    render(<OrderEvidencePanel projectId="p1" orderId="o1" />);
    const current = screen.getByRole('region', {
      name: 'Aktueller Freigabe- und Bearbeitungsstand',
    });
    expect(
      await within(current).findByText('Bearbeitung unterbrochen'),
    ).toBeInTheDocument();
    expect(current).toHaveTextContent('Gültige Freigabe · Fassung 2');
    expect(current).toHaveTextContent('codex/feature');
    expect(current).toHaveTextContent('Codex');
    const approvals = screen.getByRole('region', { name: 'Freigabesnapshots' });
    await within(approvals).findByText('Freigegebener Titel');
    expect(approvals).toHaveTextContent('65 Aufträge');
    expect(approvals).toHaveTextContent('eingefrorene Auswahl');
    expect(approvals).toHaveTextContent('Chatfreigabe 23. Oktober');
    expect(
      within(approvals).getByRole('link', { name: 'dependency-1' }),
    ).toHaveAttribute('href', '/projects/p1/orders/dependency-1');
  });

  it('macht widerrufene und entwertete Freigaben mit konkretem Grund lesbar', async () => {
    api({
      lifecycle: summary({
        approval: {
          id: 'approval-1',
          specVersion: 2,
          valid: false,
          reason: 'Freigabe widerrufen.',
        },
      }),
      approvals: [
        approval({
          valid: false,
          reason: 'Voraussetzung geändert.',
          revokedAt: now,
          scope: {
            ...approval().scope,
            invalidatedAt: now,
            invalidatedReason: 'Anderer Integrationsbranch',
            dependencyIds: [],
          },
        }),
      ],
    });
    render(<OrderEvidencePanel projectId="p1" orderId="o1" />);
    const region = screen.getByRole('region', { name: 'Freigabesnapshots' });
    expect(
      await within(region).findByText('Voraussetzung geändert.'),
    ).toBeInTheDocument();
    expect(region).toHaveTextContent('Freigabe nicht gültig');
    expect(region).toHaveTextContent('Freigabe widerrufen');
    expect(region).toHaveTextContent('Auftragssnapshot entwertet');
    expect(region).toHaveTextContent('Anderer Integrationsbranch');
    expect(region).toHaveTextContent(
      'Keine Auftragsabhängigkeiten im Snapshot.',
    );
  });

  it('zeigt Hindernis, nächste Aktion und unveränderte Zustandsereignisse mit ihrer Provenienz', async () => {
    api({
      progress: [
        progress(),
        progress({
          id: 'p2',
          kind: 'handover',
          text: 'Stand an neuen Bearbeiter übergeben.',
          nextAction: '',
        }),
      ],
      events: [event()],
    });
    render(<OrderEvidencePanel projectId="p1" orderId="o1" />);
    const history = screen.getByRole('region', {
      name: 'Fortschritt und Hindernisse',
    });
    await within(history).findByText('Hindernis');
    expect(history).toHaveTextContent('Eine Voraussetzung fehlt noch.');
    expect(history).toHaveTextContent(
      'Nächste Aktion: Den fehlenden Nachweis prüfen.',
    );
    expect(history).toHaveTextContent('Generation 3');
    const events = screen.getByRole('region', {
      name: 'Lebenszyklusereignisse',
    });
    expect(
      await within(events).findByText('Bereit → In Implementierung'),
    ).toBeInTheDocument();
    expect(events).toHaveTextContent('Codex Owner-Verbindung');
    expect(events.querySelector('time')).toHaveAttribute('datetime', now);
    expect(events.querySelector('pre')).toHaveTextContent('"generation": 3');
  });

  it('zeigt Git-, PR- und CI-Fakten samt fehlendem Build und lässt historische Fehler fehlgeschlagen', async () => {
    api({
      lifecycle: summary({
        integrationId: 'evidence-1',
        currentImplementationId: 'implementation-1',
        execution: execution({ phase: 'closed' }),
      }),
      evidence: [
        evidence(),
        evidence({
          id: 'failed-1',
          kind: 'validation',
          outcome: 'failure',
          summary: 'Frühere Prüfung schlug fehl.',
          observation: observation({
            pushed: false,
            ancestorOfHead: false,
            ci: [
              {
                url: 'https://example.com/ci/fail',
                name: 'frühere Prüfung',
                headSha: sha,
                conclusion: 'failure',
              },
            ],
          }),
          criteria: [
            { id: 'AC1', result: 'fail', reference: 'Fehlerprotokoll' },
          ],
        }),
      ],
    });
    render(<OrderEvidencePanel projectId="p1" orderId="o1" />);
    const integrated = await screen.findByRole('article', {
      name: 'Integrationsnachweis evidence-1',
    });
    expect(integrated).toHaveTextContent('Erfolgreich');
    expect(integrated).toHaveTextContent('Normaler Merge');
    expect(integrated).toHaveTextContent(sha);
    expect(integrated).toHaveTextContent(
      'Kein Build bereitgestellt: Für diesen synthetischen Stand fehlt ein Build.',
    );
    expect(
      within(integrated).getByRole('link', {
        name: 'https://github.com/example/demo/pull/1',
      }),
    ).toHaveAttribute('href', 'https://github.com/example/demo/pull/1');
    expect(
      within(integrated).getByRole('link', {
        name: 'https://github.com/example/demo/actions/runs/1',
      }),
    ).toHaveAttribute('rel', 'noopener noreferrer');
    const failed = screen.getByRole('article', {
      name: 'Kriterien- und Dokumentationsprüfung failed-1',
    });
    expect(failed).toHaveTextContent('Fehlgeschlagen');
    expect(failed).toHaveTextContent('Nicht nachgewiesen');
    expect(failed).not.toHaveTextContent(
      'Als Integrationsnachweis referenziert.',
    );
    expect(screen.getByText('Bearbeitung beendet')).toBeInTheDocument();
  });

  it('verlinkt ausschließlich sichere absolute HTTP(S)-Referenzen und zeigt andere Werte als Text', async () => {
    api({
      evidence: [
        evidence({
          documentationReference: 'javascript:alert(1)',
          observation: observation({
            pr: { ...observation().pr!, url: 'data:text/html,bad' },
            ci: [
              {
                url: '//evil.invalid/ci',
                name: 'Keine Navigation',
                headSha: sha,
                conclusion: 'pending',
              },
            ],
          }),
          criteria: [
            {
              id: 'safe',
              result: 'pass',
              reference: 'http://example.com/trace',
            },
            {
              id: 'manual',
              result: 'manual-only',
              reference:
                'Nur visuell prüfbarer Aspekt, begründet dokumentiert.',
            },
            {
              id: 'credentials',
              result: 'pass',
              reference: 'https://name:secret@example.com/test',
            },
            {
              id: 'control',
              result: 'pass',
              reference: 'https://example.com/\npath',
            },
          ],
        }),
      ],
    });
    render(<OrderEvidencePanel projectId="p1" orderId="o1" />);
    const region = await screen.findByRole('article', {
      name: 'Integrationsnachweis evidence-1',
    });
    expect(within(region).getAllByRole('link')).toHaveLength(1);
    expect(within(region).getByRole('link')).toHaveAttribute(
      'href',
      'http://example.com/trace',
    );
    expect(region).toHaveTextContent('javascript:alert(1)');
    expect(region).toHaveTextContent('data:text/html,bad');
    expect(region).toHaveTextContent('//evil.invalid/ci');
    expect(region).toHaveTextContent('Manuelle Prüfebene');
  });

  it('ergänzt paginierte Kandidaten und kennzeichnet nur erfolgreiche belegte Ersetzungen', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith('/lifecycle'))
        return json(summary({ currentImplementationId: 'new-1' }));
      if (!url.includes('/evidence')) return page([]);
      return url.includes('cursor=next')
        ? page([
            evidence({
              id: 'new-1',
              kind: 'implementation',
              supersedesId: 'old-1',
            }),
          ])
        : page(
            [
              evidence({ id: 'old-1', kind: 'implementation' }),
              evidence({
                id: 'failed-replacement',
                kind: 'implementation',
                outcome: 'failure',
                supersedesId: 'old-1',
              }),
            ],
            'next',
          );
    });
    const user = userEvent.setup();
    render(<OrderEvidencePanel projectId="p1" orderId="o1" />);
    const old = await screen.findByRole('article', {
      name: 'Implementierungsnachweis old-1',
    });
    expect(old).toHaveTextContent('Historischer Kandidat');
    expect(old).not.toHaveTextContent('Ersetzt durch');
    const region = screen.getByRole('region', {
      name: 'Prüf- und Gitnachweise',
    });
    await user.click(
      within(region).getByRole('button', { name: 'Weitere laden' }),
    );
    await screen.findByRole('article', {
      name: 'Implementierungsnachweis new-1',
    });
    expect(old).toHaveTextContent('Ersetzt durch Nachweis: new-1');
    expect(
      screen.getByRole('article', { name: 'Implementierungsnachweis new-1' }),
    ).toHaveTextContent('Als aktueller Implementierungsnachweis referenziert.');
    expect(region.querySelectorAll('article')).toHaveLength(3);
  });

  it('hält Fehler einzelner Historien getrennt und startet nach Cursor-Konflikt die erste Seite neu', async () => {
    let stage = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith('/lifecycle')) return json(summary());
      if (url.includes('/progress')) return page([progress()]);
      if (!url.includes('/evidence')) return page([]);
      if (url.includes('cursor=old'))
        return json({ error: 'Der Lebenszyklus wurde geändert.' }, 409);
      return stage
        ? page([evidence({ id: 'new-state' })])
        : page([evidence()], 'old');
    });
    const user = userEvent.setup();
    render(<OrderEvidencePanel projectId="p1" orderId="o1" />);
    const region = screen.getByRole('region', {
      name: 'Prüf- und Gitnachweise',
    });
    await within(region).findByRole('article');
    await user.click(
      within(region).getByRole('button', { name: 'Weitere laden' }),
    );
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'Lebenszyklus wurde geändert',
    );
    expect(
      screen.getByText('Eine Voraussetzung fehlt noch.'),
    ).toBeInTheDocument();
    stage = 1;
    await user.click(
      within(region).getByRole('button', { name: 'Liste neu laden' }),
    );
    await within(region).findByRole('article', {
      name: 'Integrationsnachweis new-state',
    });
    expect(
      within(region).queryByRole('article', {
        name: 'Integrationsnachweis evidence-1',
      }),
    ).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(`${root}/evidence?limit=20`);
  });

  it('behält historische Nachweise bei fehlgeschlagener aktueller Zuordnung lesbar und wiederholt getrennt', async () => {
    let available = false;
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).endsWith('/lifecycle')
        ? available
          ? json(summary())
          : json({ error: 'Aktueller Stand fehlt.' }, 503)
        : requestUrl(input).includes('/evidence')
          ? page([evidence({ observation: null, criteria: [] })])
          : page([]),
    );
    const user = userEvent.setup();
    render(<OrderEvidencePanel projectId="p1" orderId="o1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Aktueller Stand fehlt',
    );
    const record = await screen.findByRole('article', {
      name: 'Integrationsnachweis evidence-1',
    });
    expect(record).toHaveTextContent(
      'Keine lokale Gitbeobachtung aufgezeichnet.',
    );
    expect(record).toHaveTextContent(
      'Keine Kriterienergebnisse aufgezeichnet.',
    );
    available = true;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByText('Keine Freigabe aufgezeichnet.');
    expect(record).toBeInTheDocument();
  });

  it('kennzeichnet referenzierte, aber fehlende Belege und nicht verfügbare Prüfungen ausdrücklich', async () => {
    api({
      lifecycle: summary({
        currentImplementationId: 'missing-implementation',
        integrationId: 'missing-integration',
      }),
      evidence: [
        evidence({
          id: 'unavailable-1',
          kind: 'validation',
          outcome: 'unavailable',
          summary: 'Die lokale Prüfung war nicht möglich.',
          criteria: [],
          observation: null,
          documentationReference: '',
          unavailableBuildReason: '',
        }),
      ],
    });
    render(<OrderEvidencePanel projectId="p1" orderId="o1" />);
    const region = screen.getByRole('region', {
      name: 'Prüf- und Gitnachweise',
    });
    expect(await within(region).findByRole('article')).toHaveTextContent(
      'Nicht verfügbar',
    );
    expect(region).toHaveTextContent(
      'Aktueller Implementierungsnachweis missing-implementation: In der geladenen Historie nicht verfügbar.',
    );
    expect(region).toHaveTextContent(
      'Integrationsnachweis missing-integration: In der geladenen Historie nicht verfügbar.',
    );
    expect(region).not.toHaveTextContent(
      'Als aktueller Implementierungsnachweis referenziert.',
    );
  });

  it('ignoriert verspätete Antworten nach Wechsel von Projekt und Auftrag', async () => {
    const pending: Array<(value: Response) => void> = [];
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('/old/'))
        return new Promise((resolve) => pending.push(resolve));
      return url.endsWith('/lifecycle') ? json(summary()) : page([]);
    });
    const view = render(<OrderEvidencePanel projectId="old" orderId="o1" />);
    await waitFor(() => expect(pending).toHaveLength(5));
    view.rerender(<OrderEvidencePanel projectId="new" orderId="o2" />);
    await screen.findByText('Keine Freigabe aufgezeichnet.');
    await act(async () => {
      for (let i = 0; i < pending.length; i++)
        pending[i](
          i === 0
            ? json(
                summary({
                  execution: execution({ worker: 'Alter privater Kontext' }),
                }),
              )
            : page([evidence({ summary: 'Alter privater Kontext' })]),
        );
    });
    expect(
      screen.queryByText(/Alter privater Kontext/),
    ).not.toBeInTheDocument();
  });
});
