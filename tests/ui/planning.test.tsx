import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectsPage from '@/app/page';
import ProjectPage from '@/app/projects/[projectId]/page';
import MilestonesPage from '@/app/projects/[projectId]/milestones/page';
import OrdersPage from '@/app/projects/[projectId]/orders/page';
import OrderPage from '@/app/projects/[projectId]/orders/[orderId]/page';
import {
  MilestoneCollection,
  OrderCollection,
  OrderDetail,
  ProjectOverview,
} from '@/app/planning';
import type {
  Milestone,
  Order,
  OrderSpec,
  Project,
} from '@/lib/domain/planning';

const fetchMock = vi.fn<typeof fetch>();
const requestUrl = (input: Parameters<typeof fetch>[0]) =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  key: 'TEST',
  name: 'Ein Beispielprojekt',
  repository: 'example/project',
  integrationBranch: 'develop',
  productionBranch: 'main',
  documentationPaths: ['README.md', 'docs/features'],
  deploymentHints: 'Private Vorschau',
  revision: 0,
  planningRevision: 0,
  nextOrderNumber: 1,
  ...overrides,
});
const milestone = (overrides: Partial<Milestone> = {}): Milestone => ({
  id: 'milestone-1',
  projectId: 'project-1',
  title: 'Erster Schritt',
  description: 'Ein überschaubares Ziel.',
  state: 'open',
  position: 0,
  revision: 0,
  ...overrides,
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const page = <T,>(items: T[], nextCursor: string | null = null) =>
  json({ items, nextCursor });

const spec = (overrides: Partial<OrderSpec> = {}): OrderSpec => ({
  title: 'Die Projektansicht lesen',
  goal: 'Den aktuellen Stand verstehen.',
  origin: 'Eine ursprüngliche Idee',
  problem: 'Es fehlt eine Übersicht.',
  scope: 'Lesende Ansichten',
  exclusions: 'Keine Bearbeitung im Browser',
  flows: 'Projekt öffnen und Auftrag lesen.',
  criteria: [{ id: 'AC1', text: 'Der aktuelle Stand ist lesbar.' }],
  testStrategy: 'Oberfläche und Datenabruf prüfen.',
  prerequisites: 'Ein registriertes Projekt',
  documentation: 'Featurebeschreibung aktualisieren.',
  context: { repositoryCommit: 'a'.repeat(40), documentationPolicy: '1.0.0' },
  sources: ['Eine erhaltene Originalquelle'],
  ...overrides,
});
const order = (overrides: Partial<Order> = {}): Order => ({
  id: 'order-1',
  projectId: 'project-1',
  number: 1,
  displayId: 'TEST-1',
  type: 'feature',
  status: 'draft',
  specVersion: 2,
  revision: 1,
  milestoneId: 'milestone-1',
  position: 0,
  spec: spec(),
  history: [
    {
      version: 1,
      spec: spec({ title: 'Eine frühere Fassung', goal: 'Das frühere Ziel' }),
      createdAt: '2026-10-22T10:00:00.000Z',
    },
    { version: 2, spec: spec(), createdAt: '2026-10-23T10:00:00.000Z' },
  ],
  relations: [],
  ...overrides,
});

function orderListApi(items: Order[], milestones: Milestone[] = [milestone()]) {
  fetchMock.mockImplementation(async (input) =>
    requestUrl(input).includes('/milestones') ? page(milestones) : page(items),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', (...args: Parameters<typeof fetch>) =>
    requestUrl(args[0]).includes('/feedback-sources')
      ? Promise.resolve(page([]))
      : fetchMock(...args),
  );
});

describe('LUUFI-9 Aufträge und Spezifikationen lesen', () => {
  it('zeigt IDs, Typ, Zustand, Fassung und Milestone in der Auftragsliste', async () => {
    orderListApi([
      order(),
      order({
        id: 'o2',
        displayId: 'TEST-2',
        type: 'defect',
        milestoneId: null,
        spec: spec({ title: 'Ein kleiner Fehler' }),
      }),
    ]);
    render(
      await OrdersPage({
        params: Promise.resolve({ projectId: 'project-1' }),
        searchParams: Promise.resolve({}),
      }),
    );
    await screen.findByRole('link', { name: 'Die Projektansicht lesen' });
    expect(screen.getByRole('article', { name: /TEST-1/ })).toHaveTextContent(
      'Feature',
    );
    expect(screen.getByRole('article', { name: /TEST-1/ })).toHaveTextContent(
      'Entwurf',
    );
    expect(screen.getByRole('article', { name: /TEST-1/ })).toHaveTextContent(
      'Fassung 2 · Erster Schritt',
    );
    expect(screen.getByRole('article', { name: /TEST-2/ })).toHaveTextContent(
      'Fehlerbehebung',
    );
    expect(screen.getByRole('article', { name: /TEST-2/ })).toHaveTextContent(
      'Unverplant',
    );
    expect(
      screen.getByRole('link', { name: 'Die Projektansicht lesen' }),
    ).toHaveAttribute('href', '/projects/project-1/orders/order-1');
    expect(screen.getByRole('link', { name: 'Aufträge' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      fetchMock.mock.calls.every(
        ([, options]) => !options?.method || options.method === 'GET',
      ),
    ).toBe(true);
  });

  it('kombiniert Milestone-, Zustands- und Typfilter und speichert die Auswahl in der URL', async () => {
    const user = userEvent.setup();
    orderListApi([]);
    render(<OrderCollection projectId="project-1" />);
    await screen.findByText('Keine Aufträge für diese Auswahl vorhanden.');
    await user.selectOptions(screen.getByLabelText('Milestone'), 'unplanned');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            url ===
            '/api/projects/project-1/orders?milestoneId=unplanned&limit=20',
        ),
      ).toBe(true),
    );
    await user.selectOptions(screen.getByLabelText('Zustand'), 'draft');
    await user.selectOptions(screen.getByLabelText('Typ'), 'defect');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            url ===
            '/api/projects/project-1/orders?milestoneId=unplanned&status=draft&type=defect&limit=20',
        ),
      ).toBe(true),
    );
    expect(window.location.search).toBe(
      '?milestoneId=unplanned&status=draft&type=defect',
    );
    await user.click(
      screen.getByRole('button', { name: 'Filter zurücksetzen' }),
    );
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.getByLabelText('Milestone')).toHaveValue('');
  });

  it('übernimmt Filter aus verlinkten URLs und ergänzt auch spätere Milestone-Optionen', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('cursor=more'))
        return page([
          milestone({ id: 'm2', title: 'Späterer Milestone', state: 'closed' }),
        ]);
      if (url.includes('/milestones')) return page([milestone()], 'more');
      return page([order({ milestoneId: 'm2' })]);
    });
    render(
      await OrdersPage({
        params: Promise.resolve({ projectId: 'project-1' }),
        searchParams: Promise.resolve({
          milestoneId: ['m2'],
          type: 'feature',
          status: 'draft',
        }),
      }),
    );
    await screen.findByRole('option', {
      name: 'Späterer Milestone · geschlossen',
    });
    expect(screen.getByLabelText('Milestone')).toHaveValue('m2');
    expect(screen.getByLabelText('Zustand')).toHaveValue('draft');
    expect(screen.getByLabelText('Typ')).toHaveValue('feature');
    expect(
      fetchMock.mock.calls.some(
        ([url]) =>
          url ===
          '/api/projects/project-1/orders?milestoneId=m2&status=draft&type=feature&limit=20',
      ),
    ).toBe(true);
    expect(await screen.findByRole('article')).toHaveTextContent(
      'Späterer Milestone',
    );
  });

  it('verbirgt alte Ergebnisse sofort beim Filterwechsel und ignoriert eine verspätete Antwort', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('/milestones')) return page([]);
      if (url.includes('type=feature'))
        return new Promise((resolve) => {
          finish = resolve;
        });
      if (url.includes('type=defect'))
        return page([
          order({
            id: 'o2',
            type: 'defect',
            spec: spec({ title: 'Ein kleiner Fehler' }),
          }),
        ]);
      return page([order()], 'old-cursor');
    });
    const user = userEvent.setup();
    render(<OrderCollection projectId="project-1" />);
    await screen.findByRole('link', { name: 'Die Projektansicht lesen' });
    await user.selectOptions(screen.getByLabelText('Typ'), 'feature');
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Typ'), 'defect');
    await screen.findByRole('link', { name: 'Ein kleiner Fehler' });
    finish(page([order()]));
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'Die Projektansicht lesen' }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: 'Weitere laden' }),
    ).not.toBeInTheDocument();
  });

  it('behält die lesbaren Aufträge bei ausgefallener Milestone-Auswahl', async () => {
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).includes('/milestones')
        ? json({ error: 'Milestones fehlen vorübergehend.' }, 503)
        : page([order()]),
    );
    render(
      <OrderCollection
        projectId="project-1"
        initialSelection={{
          milestoneId: 'milestone-1',
          status: 'invalid',
          type: 'invalid',
        }}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Milestones fehlen vorübergehend.',
    );
    expect(await screen.findByRole('article')).toHaveTextContent(
      'Milestone zugeordnet',
    );
    expect(screen.getByLabelText('Milestone')).toHaveValue('milestone-1');
    expect(screen.getByLabelText('Zustand')).toHaveValue('');
    expect(screen.getByLabelText('Typ')).toHaveValue('');
  });

  it('lädt weitere gefilterte Aufträge am selben Filter und kann die Auswahl aktualisieren', async () => {
    let nextPage = false;
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('/milestones')) return page([]);
      if (url.includes('cursor=more')) {
        nextPage = true;
        return page([
          order({ id: 'o2', spec: spec({ title: 'Weiterer Auftrag' }) }),
        ]);
      }
      return page([order()], nextPage ? null : 'more');
    });
    const user = userEvent.setup();
    render(
      <OrderCollection
        projectId="project-1"
        initialSelection={{ type: 'feature' }}
      />,
    );
    await screen.findByRole('article');
    await user.click(screen.getByRole('button', { name: 'Weitere laden' }));
    await screen.findByRole('link', { name: 'Weiterer Auftrag' });
    expect(
      fetchMock.mock.calls.some(
        ([url]) =>
          url ===
          '/api/projects/project-1/orders?type=feature&limit=20&cursor=more',
      ),
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'Weiterer Auftrag' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('macht die vollständige Spezifikation und frühere unveränderte Fassungen lesbar', async () => {
    fetchMock.mockResolvedValueOnce(json(order()));
    const user = userEvent.setup();
    render(
      await OrderPage({
        params: Promise.resolve({ projectId: 'project-1', orderId: 'order-1' }),
      }),
    );
    await screen.findByRole('heading', { level: 1, name: 'TEST-1' });
    const current = screen.getByRole('region', {
      name: 'Aktueller Auftragsstand',
    });
    expect(current).toHaveTextContent('Entwurf');
    expect(current).toHaveTextContent('Feature');
    const specification = screen.getByRole('region', { name: 'Spezifikation' });
    for (const expected of [
      'Den aktuellen Stand verstehen.',
      'Eine ursprüngliche Idee',
      'Es fehlt eine Übersicht.',
      'Lesende Ansichten',
      'Keine Bearbeitung im Browser',
      'Projekt öffnen und Auftrag lesen.',
      'Oberfläche und Datenabruf prüfen.',
      'Ein registriertes Projekt',
      'Featurebeschreibung aktualisieren.',
      'AC1',
      'Der aktuelle Stand ist lesbar.',
      'Eine erhaltene Originalquelle',
      'a'.repeat(40),
      '1.0.0',
    ])
      expect(specification).toHaveTextContent(expected);
    expect(
      within(specification).getByRole('heading', {
        name: 'Spezifikation · Fassung 2',
      }),
    ).toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText('Spezifikationsfassung'),
      '1',
    );
    expect(
      within(specification).getByText('Das frühere Ziel'),
    ).toBeInTheDocument();
    expect(
      within(specification).getByText('Eine frühere Fassung'),
    ).toBeInTheDocument();
    expect(current).toHaveTextContent('Die Projektansicht lesen');
    expect(
      screen.getByRole('link', { name: 'Aufträge im selben Milestone' }),
    ).toHaveAttribute(
      'href',
      '/projects/project-1/orders?milestoneId=milestone-1',
    );
    expect(
      screen.queryByRole('button', { name: /freigeben|starten|bearbeiten/i }),
    ).not.toBeInTheDocument();
  });

  it('zeigt unvollständige Entwürfe und fehlende optionale Inhalte ohne erfundene Regeln', async () => {
    const draft = spec({
      title: '',
      problem: '',
      criteria: [],
      sources: [],
      context: { repositoryCommit: '', documentationPolicy: '' },
    });
    fetchMock.mockResolvedValueOnce(
      json(
        order({
          milestoneId: null,
          specVersion: 1,
          spec: draft,
          history: [{ version: 1, spec: draft, createdAt: '' }],
        }),
      ),
    );
    render(<OrderDetail projectId="project-1" orderId="order-1" />);
    await screen.findByRole('heading', { level: 1, name: 'TEST-1' });
    expect(
      screen.getByRole('region', { name: 'Aktueller Auftragsstand' }),
    ).toHaveTextContent('Auftrag ohne Titel');
    expect(
      screen.getByRole('region', { name: 'Aktueller Auftragsstand' }),
    ).toHaveTextContent('Unverplant');
    expect(
      screen.getByText('Noch keine Kriterien hinterlegt.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Keine Quellen hinterlegt.')).toBeInTheDocument();
    expect(
      screen.getByText('Keine Beziehungen hinterlegt.'),
    ).toBeInTheDocument();
    for (const field of [
      'Titel',
      'Nutzerproblem',
      'Repository-Commit',
      'Dokumentationsrichtlinie',
    ])
      expect(screen.getByText(field).nextElementSibling).toHaveTextContent(
        'Nicht hinterlegt.',
      );
  });

  it('zeigt gerichtete Beziehungen mit lesbaren Zielkennungen und Verweisen', async () => {
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).endsWith('/order-1')
        ? json(
            order({
              relations: [
                { type: 'depends_on', targetId: 'order-2' },
                { type: 'related', targetId: 'order-3' },
                { type: 'originated_from', targetId: 'order-4' },
                { type: 'replaces', targetId: 'order-5' },
              ],
            }),
          )
        : json(
            order({
              id: 'order-2',
              displayId: 'TEST-2',
              spec: spec({ title: 'Vorarbeit' }),
            }),
          ),
    );
    render(<OrderDetail projectId="project-1" orderId="order-1" />);
    const relations = await screen.findByRole('region', {
      name: 'Ausgehende Beziehungen',
    });
    await within(relations).findAllByRole('link', {
      name: 'TEST-2 · Vorarbeit',
    });
    expect(relations).toHaveTextContent('von TEST-1');
    for (const type of [
      'Abhängig von',
      'Verwandt mit',
      'Entstanden aus',
      'Ersetzt',
    ])
      expect(within(relations).getByText(type)).toBeInTheDocument();
    expect(within(relations).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      '/projects/project-1/orders/order-2',
    );
  });

  it('stellt eine fehlgeschlagene Beziehungsauflösung separat wieder her', async () => {
    let available = false;
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).endsWith('/order-1')
        ? json(order({ relations: [{ type: 'related', targetId: 'order-2' }] }))
        : available
          ? json(
              order({
                displayId: 'TEST-2',
                spec: spec({ title: 'Wieder lesbar' }),
              }),
            )
          : json({ error: 'Dieser Auftrag wurde nicht gefunden.' }, 404),
    );
    const user = userEvent.setup();
    render(<OrderDetail projectId="project-1" orderId="order-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'nicht gefunden',
    );
    expect(
      screen.getByRole('region', { name: 'Spezifikation' }),
    ).toBeInTheDocument();
    available = true;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByRole('link', { name: 'TEST-2 · Wieder lesbar' });
  });

  it('stellt einen fehlenden Auftrag nach Wiederholung wieder her', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: 'Dieser Auftrag wurde nicht gefunden.' }, 404),
    );
    const user = userEvent.setup();
    render(<OrderDetail projectId="project-1" orderId="order-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'nicht gefunden',
    );
    fetchMock.mockResolvedValueOnce(json(order()));
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByRole('heading', { level: 1, name: 'TEST-1' });
  });
});

describe('LUUFI-8 Projekte und Milestones lesen', () => {
  it('zeigt Ladezustand, registrierte Projekte und direkte Projektlinks', async () => {
    fetchMock.mockResolvedValueOnce(page([project({ id: 'project/1' })]));
    render(<ProjectsPage />);
    expect(screen.getByText('Daten werden geladen …')).toBeInTheDocument();
    const link = await screen.findByRole('link', {
      name: 'Ein Beispielprojekt',
    });
    expect(link).toHaveAttribute('href', '/projects/project%2F1');
    expect(screen.getByText('TEST')).toBeInTheDocument();
    expect(screen.getByText('example/project')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /anlegen|bearbeiten|löschen/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projekte' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('erklärt eine leere Projektliste und erlaubt Aktualisieren', async () => {
    fetchMock.mockResolvedValueOnce(page([]));
    const user = userEvent.setup();
    render(<ProjectsPage />);
    expect(
      await screen.findByText(/Noch keine Projekte registriert/),
    ).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(page([project()]));
    await user.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    await screen.findByRole('link', { name: 'Ein Beispielprojekt' });
  });

  it('ergänzt Cursor-Seiten ohne doppelte Projekte und behält bei Seitenfehlern den bisherigen Stand', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(page([project()], 'next/+'));
    render(<ProjectsPage />);
    await screen.findByRole('link', { name: 'Ein Beispielprojekt' });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Weitere laden' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'nicht erreichbar',
    );
    expect(screen.getByRole('article')).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(
      page([project(), project({ id: 'p2', name: 'Zweites Projekt' })]),
    );
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByRole('link', { name: 'Zweites Projekt' });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/projects?limit=20&cursor=next%2F%2B',
    );
    expect(fetchMock.mock.calls[2][0]).toBe(fetchMock.mock.calls[1][0]);
  });

  it('beginnt nach einem veralteten Cursor bewusst wieder auf Seite eins', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(page([project()], 'old-cursor'));
    render(<ProjectsPage />);
    await screen.findByRole('article');
    fetchMock.mockResolvedValueOnce(
      json({ error: 'Die Planung wurde geändert.', code: 'conflict' }, 409),
    );
    await user.click(screen.getByRole('button', { name: 'Weitere laden' }));
    await screen.findByRole('alert');
    fetchMock.mockResolvedValueOnce(
      page([project({ id: 'p2', name: 'Neuer Stand' })]),
    );
    await user.click(screen.getByRole('button', { name: 'Liste neu laden' }));
    await screen.findByRole('link', { name: 'Neuer Stand' });
    expect(
      screen.queryByRole('link', { name: 'Ein Beispielprojekt' }),
    ).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[2][0]).toBe('/api/projects?limit=20');
  });

  it('zeigt Projekteinstellungen und findet den ersten offenen Milestone auch nach geschlossenen Seiten', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith('/project-1')) return json(project());
      if (url.includes('cursor=more')) return page([milestone()]);
      return page(
        [milestone({ title: 'Schon abgeschlossen', state: 'closed' })],
        'more',
      );
    });
    render(
      await ProjectPage({
        params: Promise.resolve({ projectId: 'project-1' }),
      }),
    );
    await screen.findByRole('heading', { name: 'Ein Beispielprojekt' });
    const next = screen.getByRole('region', { name: 'Nächster Milestone' });
    expect(await within(next).findByText('Erster Schritt')).toBeInTheDocument();
    expect(
      within(next).queryByText('Schon abgeschlossen'),
    ).not.toBeInTheDocument();
    const settings = screen.getByRole('region', {
      name: 'Projekteinstellungen',
    });
    expect(settings).toHaveTextContent('develop');
    expect(settings).toHaveTextContent('main');
    expect(settings).toHaveTextContent('docs/features');
    expect(settings).toHaveTextContent('Private Vorschau');
    expect(
      within(
        screen.getByRole('navigation', { name: 'Projektnavigation' }),
      ).getByRole('link', { name: 'Übersicht' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('nennt fehlende optionale Einstellungen und einen fehlenden offenen Milestone ehrlich', async () => {
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).endsWith('/project-1')
        ? json(project({ documentationPaths: [], deploymentHints: '' }))
        : page([]),
    );
    render(<ProjectOverview projectId="project-1" />);
    expect(
      await screen.findByText('Kein offener Milestone geplant.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Keine hinterlegt.')).toHaveLength(2);
  });

  it('zeigt Zugriff-/Projektfehler und kann die Projektübersicht wiederherstellen', async () => {
    let available = false;
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).endsWith('/project-1')
        ? available
          ? json(project())
          : json({ error: 'Bitte anmelden.', code: 'unauthorized' }, 401)
        : page([]),
    );
    const user = userEvent.setup();
    render(<ProjectOverview projectId="project-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bitte anmelden.',
    );
    expect(
      screen.queryByRole('region', { name: 'Projekteinstellungen' }),
    ).not.toBeInTheDocument();
    available = true;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByRole('heading', { name: 'Ein Beispielprojekt' });
  });

  it('wiederholt einen fehlgeschlagenen Milestone-Abruf unabhängig vom lesbaren Projekt', async () => {
    let available = false;
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).endsWith('/project-1')
        ? json(project())
        : available
          ? page([milestone()])
          : json({ error: 'Milestones sind nicht verfügbar.' }, 503),
    );
    const user = userEvent.setup();
    render(<ProjectOverview projectId="project-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Milestones sind nicht verfügbar.',
    );
    expect(
      screen.getByRole('region', { name: 'Projekteinstellungen' }),
    ).toBeInTheDocument();
    available = true;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByText('Erster Schritt');
  });

  it('zeigt geordnete offene und geschlossene Milestones ohne Verwaltungsaktionen', async () => {
    fetchMock.mockResolvedValueOnce(
      page([
        milestone({ title: 'Vorher', state: 'closed', description: '' }),
        milestone({ id: 'm2' }),
      ]),
    );
    render(
      await MilestonesPage({
        params: Promise.resolve({ projectId: 'project-1' }),
      }),
    );
    await screen.findByText('Geschlossen');
    expect(
      screen
        .getAllByRole('article')
        .map((item) => item.getAttribute('aria-label')),
    ).toEqual(['Vorher', 'Erster Schritt']);
    expect(screen.getByText('Offen')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /anlegen|verschieben/i }),
    ).not.toBeInTheDocument();
  });

  it('zeigt eine leere Milestone-Liste und wiederholt ungültige Serverantworten', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500));
    const user = userEvent.setup();
    render(<MilestoneCollection projectId="project-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Daten konnten nicht geladen werden.',
    );
    fetchMock.mockResolvedValueOnce(page([]));
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByText('Noch keine Milestones geplant.');
    fetchMock.mockResolvedValueOnce(page([milestone()]));
    await user.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    await screen.findByRole('article');
  });

  it('ignoriert verspätete Antworten des vorherigen Projekts', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url === '/api/projects/old')
        return new Promise((resolve) => {
          finish = resolve;
        });
      if (url === '/api/projects/new')
        return json(project({ id: 'new', name: 'Neues Projekt' }));
      return page([]);
    });
    const view = render(<ProjectOverview projectId="old" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    view.rerender(<ProjectOverview projectId="new" />);
    await screen.findByRole('heading', { name: 'Neues Projekt' });
    finish(json(project({ id: 'old', name: 'Altes Projekt' })));
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Altes Projekt' }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('heading', { name: 'Neues Projekt' }),
    ).toBeInTheDocument();
  });
});
