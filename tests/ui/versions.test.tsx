import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LatestVersion,
  VersionCollection,
  VersionDetail,
} from '@/app/versions';
import VersionsPage from '@/app/projects/[projectId]/versions/page';
import VersionPage from '@/app/projects/[projectId]/versions/[versionId]/page';
import type {
  BuildRecord,
  ProjectVersion,
  ReleaseRecord,
  VersionOrder,
} from '@/lib/domain/releases';

const now = '2026-10-23T10:00:00.000Z';
const sha = 'c'.repeat(40);
const hostingSha = 'd'.repeat(40);
const version = (overrides: Partial<ProjectVersion> = {}): ProjectVersion => ({
  id: 'v1',
  projectId: 'p1',
  label: 'Vorschau 1',
  channel: 'develop',
  title: 'Nachvollziehbare Version',
  changelog: 'Deutsche Änderungen\nmit erhaltener Reihenfolge.',
  repositoryCommit: sha,
  sourceBranch: 'develop',
  orderCount: 1,
  revision: 0,
  releaseId: null,
  createdAt: now,
  ...overrides,
});
const build = (overrides: Partial<BuildRecord> = {}): BuildRecord => ({
  id: 'b1',
  versionId: 'v1',
  kind: 'site',
  outcome: 'available',
  url: 'https://example.com/preview',
  reason: '',
  environment: 'preview',
  projectCommit: sha,
  sourceKind: 'sites',
  sourceBranch: 'main',
  sourceCommit: hostingSha,
  versionCommitIncluded: true,
  mappingReference: 'Quellvergleich im privaten Hostingnachweis',
  observedAt: now,
  verificationReference: 'Authentifizierter Health-/Bannervergleich',
  createdAt: now,
  ...overrides,
});
const order = (overrides: Partial<VersionOrder> = {}): VersionOrder => ({
  id: 'vo1',
  versionId: 'v1',
  orderId: 'o1',
  displayId: 'DEMO-3',
  title: 'Implementierung nachvollziehen',
  specVersion: 1,
  implementationId: 'i1',
  integrationId: 'integration1',
  implementationCommit: 'a'.repeat(40),
  integrationReference: 'https://github.com/example/demo/pull/1',
  provenanceKind: 'execution',
  ...overrides,
});
const release = (overrides: Partial<ReleaseRecord> = {}): ReleaseRecord => ({
  id: 'r1',
  versionId: 'v1',
  confirmationReference: 'Explizite Nutzerfreigabe im Chat',
  productionBranch: 'main',
  productionCommit: sha,
  tag: 'v1.0',
  tagCommit: sha,
  buildId: 'b1',
  observation: {
    repository: 'example/demo',
    productionBranch: 'main',
    productionHead: sha,
    tag: 'v1.0',
    tagCommit: sha,
    versionCommit: sha,
    versionCommitIncluded: true,
    observedAt: now,
    source: 'codex-local-git',
    ci: [
      {
        url: 'https://github.com/example/demo/actions/runs/1',
        name: 'verify',
        headSha: sha,
        conclusion: 'success',
      },
    ],
  },
  deploymentReference: 'https://example.com/deployment/1',
  createdAt: now,
  ...overrides,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const page = <T,>(items: T[], nextCursor: string | null = null) =>
  json({ items, nextCursor });
const fetchMock = vi.fn<typeof fetch>();
const requestUrl = (input: Parameters<typeof fetch>[0]) =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
function detailApi(
  values: {
    version?: ProjectVersion;
    orders?: VersionOrder[];
    builds?: BuildRecord[];
    releases?: ReleaseRecord[];
  } = {},
) {
  fetchMock.mockImplementation(async (input) => {
    const url = requestUrl(input);
    return url.includes('/orders?')
      ? page(values.orders ?? [order()])
      : url.includes('/builds?')
        ? page(values.builds ?? [build()])
        : url.includes('/releases?')
          ? page(values.releases ?? [])
          : json(values.version ?? version());
  });
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('LUUFI-17 Versionen lesen', () => {
  it('unterscheidet Develop-Vorschau und Produktionskandidat in der lesenden Versionsliste', async () => {
    fetchMock.mockResolvedValue(
      page([
        version(),
        version({ id: 'candidate', label: 'Kandidat', channel: 'production' }),
      ]),
    );
    render(
      await VersionsPage({ params: Promise.resolve({ projectId: 'p1' }) }),
    );
    expect(
      await screen.findByRole('link', {
        name: 'Vorschau 1 · Nachvollziehbare Version',
      }),
    ).toHaveAttribute('href', '/projects/p1/versions/v1');
    expect(
      screen.getAllByText('Produktionskandidat · kein Releasebeleg'),
    ).toHaveLength(2);
    expect(
      screen.queryByText('Produktion · Release aufgezeichnet'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Versionen' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.queryByRole('button', {
        name: /speichern|veröffentlichen|freigeben|anlegen/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('zeigt deutsche Änderungen, eingefrorene Aufträge und öffentliche sowie Sites-SHAs getrennt', async () => {
    detailApi();
    render(
      await VersionPage({
        params: Promise.resolve({ projectId: 'p1', versionId: 'v1' }),
      }),
    );
    const state = await screen.findByRole('region', { name: 'Versionsstand' });
    expect(state).toHaveTextContent(
      'Deutsche Änderungen mit erhaltener Reihenfolge.',
    );
    expect(state).toHaveTextContent(`Öffentlicher Versionscommit${sha}`);
    const orders = screen.getByRole('region', { name: 'Enthaltene Aufträge' });
    const link = await within(orders).findByRole('link', {
      name: 'DEMO-3 · Implementierung nachvollziehen',
    });
    expect(link).toHaveAttribute('href', '/projects/p1/orders/o1');
    expect(orders).toHaveTextContent('Fassung 1');
    const site = await screen.findByRole('article', { name: 'Site b1' });
    expect(site).toHaveTextContent(`Gebauter öffentlicher Commit${sha}`);
    expect(site).toHaveTextContent(`Hostingquellcommit${hostingSha}`);
    expect(site).toHaveTextContent('Privater Sites-Quellspeicher');
    expect(site).toHaveTextContent(
      'Quellvergleich im privaten Hostingnachweis',
    );
    expect(
      within(site).getByRole('link', { name: 'Beobachteten Site-Link öffnen' }),
    ).toHaveAttribute('href', 'https://example.com/preview');
    expect(site.querySelector('time')).toHaveAttribute('datetime', now);
    expect(
      fetchMock.mock.calls.every(
        ([, options]) => !options?.method && options?.cache === 'no-store',
      ),
    ).toBe(true);
  });

  it('zeigt fehlende und fehlgeschlagene Builds mit Grund und bewahrt Bootstrapprovenienz ohne erfundene Claims', async () => {
    detailApi({
      orders: [
        order({
          provenanceKind: 'bootstrap',
          implementationId: null,
          integrationId: null,
        }),
      ],
      builds: [
        build({
          outcome: 'unavailable',
          url: null,
          reason: 'Noch kein APK gebaut.',
          kind: 'apk',
        }),
        build({
          id: 'b2',
          outcome: 'failure',
          url: null,
          reason: 'Veröffentlichung ist gescheitert.',
          sourceKind: 'github',
          sourceCommit: sha,
        }),
      ],
    });
    render(<VersionDetail projectId="p1" versionId="v1" />);
    expect(
      await screen.findByRole('article', { name: 'APK b1' }),
    ).toHaveTextContent('Nicht verfügbar');
    expect(
      screen.getByText('Grund: Noch kein APK gebaut.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Site b2' })).toHaveTextContent(
      'Bereitstellung fehlgeschlagen',
    );
    expect(
      screen.getByText('Grund: Veröffentlichung ist gescheitert.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Bootstrapbeleg, kein historischer W5-Claim.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Beobachteten/ }),
    ).not.toBeInTheDocument();
  });

  it('zeigt Freigabe, Tag-/Produktionsfakten und erfolgreiche CI nur beim gespeicherten Releasebeleg', async () => {
    detailApi({
      version: version({
        channel: 'production',
        releaseId: 'r1',
        sourceBranch: 'main',
      }),
      releases: [release()],
    });
    render(<VersionDetail projectId="p1" versionId="v1" />);
    const record = await screen.findByRole('article', {
      name: 'Produktionsrelease r1',
    });
    expect(record).toHaveTextContent('v1.0');
    expect(record).toHaveTextContent('Explizite Nutzerfreigabe im Chat');
    expect(record).toHaveTextContent(`Produktionscommit${sha}`);
    expect(record).toHaveTextContent(`Tagziel${sha}`);
    expect(record).toHaveTextContent('verify · Erfolgreich');
    expect(
      within(record).getByRole('link', {
        name: 'https://github.com/example/demo/actions/runs/1',
      }),
    ).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      screen.getByRole('region', { name: 'Versionsstand' }),
    ).toHaveTextContent('Produktion · Release aufgezeichnet');
    expect(
      screen.queryByText(
        'Produktionskandidat: Es liegt noch kein zugeordneter Releasebeleg vor.',
      ),
    ).not.toBeInTheDocument();
  });

  it('zeigt die serverseitig bestimmte ältere verfügbare Version neben einer neueren unverfügbaren Version', async () => {
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).includes('/latest-available-version')
        ? json({ version: version(), build: build() })
        : page([version({ id: 'newer', label: 'Neuer Stand' })]),
    );
    render(
      <>
        <LatestVersion projectId="p1" />
        <VersionCollection projectId="p1" />
      </>,
    );
    const latest = screen.getByRole('region', {
      name: 'Letzte verfügbare Version',
    });
    expect(
      await within(latest).findByRole('link', {
        name: 'Vorschau 1 · Nachvollziehbare Version',
      }),
    ).toBeInTheDocument();
    expect(latest).not.toHaveTextContent('Neuer Stand');
    expect(latest).toHaveTextContent('Preview');
    expect(latest.querySelector('time')).toHaveAttribute('datetime', now);
    expect(
      within(latest).getByRole('link', { name: 'Verfügbare Site öffnen' }),
    ).toHaveAttribute('href', 'https://example.com/preview');
    expect(
      await screen.findByRole('link', {
        name: 'Neuer Stand · Nachvollziehbare Version',
      }),
    ).toBeInTheDocument();
  });

  it('erklärt eine fehlende verfügbare Version und kann den eigenen Abruf wiederholen', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<LatestVersion projectId="p1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'nicht erreichbar',
    );
    fetchMock.mockResolvedValueOnce(json(null));
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByText('Noch keine verfügbare Version beobachtet.');
    fetchMock.mockResolvedValueOnce(
      json({
        version: version({ channel: 'production', releaseId: null }),
        build: build({ environment: 'production', kind: 'apk' }),
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    expect(
      await screen.findByText('Produktionskandidat · kein Releasebeleg'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Verfügbare APK öffnen' }),
    ).toBeInTheDocument();
  });

  it('behandelt Seitencursor unabhängig und lädt nach Konflikt bewusst wieder die erste Seite', async () => {
    let fresh = false;
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('/orders?'))
        return url.includes('cursor=old')
          ? json({ error: 'Der Versionsstand wurde geändert.' }, 409)
          : page(
              fresh ? [order({ id: 'vo2', displayId: 'DEMO-4' })] : [order()],
              fresh ? null : 'old',
            );
      return url.includes('/builds?')
        ? page([build()])
        : url.includes('/releases?')
          ? page([])
          : json(version());
    });
    const user = userEvent.setup();
    render(<VersionDetail projectId="p1" versionId="v1" />);
    const orders = screen.getByRole('region', { name: 'Enthaltene Aufträge' });
    await within(orders).findByRole('link', { name: /DEMO-3/ });
    await user.click(
      within(orders).getByRole('button', { name: 'Weitere laden' }),
    );
    expect(await within(orders).findByRole('alert')).toHaveTextContent(
      'Versionsstand wurde geändert',
    );
    expect(
      screen.getByRole('article', { name: 'Site b1' }),
    ).toBeInTheDocument();
    fresh = true;
    await user.click(
      within(orders).getByRole('button', { name: 'Liste neu laden' }),
    );
    await within(orders).findByRole('link', { name: /DEMO-4/ });
    expect(
      within(orders).queryByRole('link', { name: /DEMO-3/ }),
    ).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      '/api/projects/p1/versions/v1/orders?limit=20',
    );
  });

  it('ergänzt weitere Versionen ohne Duplikate und nennt leere Historien ehrlich', async () => {
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).includes('cursor=more')
        ? page([version(), version({ id: 'v2', label: 'Vorschau 2' })])
        : page([version()], 'more'),
    );
    const user = userEvent.setup();
    const view = render(<VersionCollection projectId="p1" />);
    await screen.findByRole('link', {
      name: 'Vorschau 1 · Nachvollziehbare Version',
    });
    await user.click(screen.getByRole('button', { name: 'Weitere laden' }));
    await screen.findByRole('link', {
      name: 'Vorschau 2 · Nachvollziehbare Version',
    });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    view.unmount();
    detailApi({ orders: [], builds: [], releases: [] });
    render(<VersionDetail projectId="p1" versionId="v1" />);
    await screen.findByText('Keine Bereitstellung aufgezeichnet.');
    expect(
      screen.getByText('Kein Produktionsrelease aufgezeichnet.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Keine Aufträge im Versionsumfang hinterlegt.'),
    ).toBeInTheDocument();
  });

  it('macht unsichere Site-/Nachweis-URLs nicht anklickbar und führt Änderungsnotizen nicht als HTML aus', async () => {
    detailApi({
      version: version({ changelog: '<script>untrusted()</script>' }),
      builds: [
        build({
          url: 'javascript:untrusted()',
          mappingReference: 'https://name:secret@example.com/test',
          verificationReference: '//evil.invalid/path',
        }),
      ],
    });
    render(<VersionDetail projectId="p1" versionId="v1" />);
    const card = await screen.findByRole('article', { name: 'Site b1' });
    expect(card.querySelectorAll('a')).toHaveLength(0);
    expect(card).toHaveTextContent('javascript:untrusted()');
    expect(card).toHaveTextContent('//evil.invalid/path');
    expect(
      screen.getByText('<script>untrusted()</script>'),
    ).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });

  it('verwirft verspätete Antworten des vorherigen Projekts in der Übersicht und im Detail', async () => {
    const pending: Array<(value: Response) => void> = [];
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).includes('/old/')
        ? new Promise((resolve) => pending.push(resolve))
        : requestUrl(input).includes('/latest-available-version')
          ? json(null)
          : requestUrl(input).includes('?')
            ? page([])
            : json(version({ title: 'Neuer Projektkontext' })),
    );
    const view = render(
      <>
        <LatestVersion projectId="old" />
        <VersionDetail projectId="old" versionId="v1" />
      </>,
    );
    await waitFor(() => expect(pending).toHaveLength(5));
    view.rerender(
      <>
        <LatestVersion projectId="new" />
        <VersionDetail projectId="new" versionId="v1" />
      </>,
    );
    await screen.findByRole('heading', { name: 'Neuer Projektkontext' });
    await act(async () => {
      for (const finish of pending)
        finish(
          json({
            version: version({ title: 'Alter privater Kontext' }),
            build: build(),
          }),
        );
    });
    expect(
      screen.queryByText(/Alter privater Kontext/),
    ).not.toBeInTheDocument();
  });
});
