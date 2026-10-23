import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectsPage from '@/app/page';
import ProjectPage from '@/app/projects/[projectId]/page';
import MilestonesPage from '@/app/projects/[projectId]/milestones/page';
import { MilestoneCollection, ProjectOverview } from '@/app/planning';
import type { Milestone, Project } from '@/lib/domain/planning';

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

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
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
