import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProjectsPage from '@/app/page';
import RootLayout, { metadata, viewport } from '@/app/layout';
import { PrimaryNavigation } from '@/components/primary-navigation';
import { EnvironmentBanner } from '@/components/environment-banner';

vi.mock('cloudflare:workers', () => ({
  env: {
    LUUFI_ENVIRONMENT: 'preview',
    LUUFI_SOURCE_BRANCH: 'develop',
    LUUFI_COMMIT_SHA: 'a'.repeat(40),
  },
}));
describe('LUUFI-2 deutsche Plattform', () => {
  it('zeigt ehrliche Projekte-Vorbereitung und eine eigenständige Ideenroute', () => {
    render(<ProjectsPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Projekte' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Die neue Projektverwaltung wird vorbereitet/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Projektideen öffnen' }),
    ).toHaveAttribute('href', '/ideas');
    const nav = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    expect(within(nav).getByRole('link', { name: 'Projekte' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(nav).getByRole('link', { name: 'Projektideen' }),
    ).not.toHaveAttribute('aria-current');
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });
  it('kennzeichnet die Ideenroute eindeutig', () => {
    render(<PrimaryNavigation active="ideas" />);
    expect(screen.getByRole('link', { name: 'Projektideen' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Projekte' })).not.toHaveAttribute(
      'aria-current',
    );
  });
  it('zeigt Vorschau-Branch und SHA und blendet Produktion aus', () => {
    const identity = {
      environment: 'preview' as const,
      sourceBranch: 'main',
      commitSha: 'a'.repeat(40),
    };
    const view = render(<EnvironmentBanner identity={identity} />);
    expect(screen.getByLabelText('Vorschauumgebung')).toHaveTextContent(
      'Vorschau · main · aaaaaaa',
    );
    view.rerender(
      <EnvironmentBanner
        identity={{ ...identity, environment: 'production' }}
      />,
    );
    expect(screen.queryByLabelText('Vorschauumgebung')).not.toBeInTheDocument();
    view.rerender(<EnvironmentBanner identity={null} />);
    expect(view.container).toBeEmptyDOMElement();
  });
  it('liefert deutsches Root-Layout und Metadaten', () => {
    // Inspect the thin server wrapper without nesting another html element in jsdom.
    const element = RootLayout({ children: <p>Kind</p> });
    expect(element.type).toBe('html');
    expect(element.props.lang).toBe('de');
    expect(metadata.title).toBe('Luufi');
    expect(viewport.colorScheme).toBe('dark');
    expect(element.props.children.props.children[1].props.children).toBe(
      'Kind',
    );
  });
});
