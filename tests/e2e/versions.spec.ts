import { expect, test } from '@playwright/test';

test('Projektübersicht und Versionen zeigen verfügbare Vorschau, Quellstände und enthaltene Aufträge auf Desktop und Handy', async ({
  page,
}) => {
  await page.goto('/projects/planning-e2e');
  const latest = page.getByRole('region', {
    name: 'Letzte verfügbare Version',
    exact: true,
  });
  await expect(latest).toContainText('Develop-Vorschau');
  await expect(
    latest.getByRole('link', { name: 'Verfügbare Site öffnen' }),
  ).toHaveAttribute('href', 'https://example.invalid/demo-preview');
  await latest
    .getByRole('link', {
      name: 'Lokale Vorschau 1 · Nachvollziehbare Projektversion',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Nachvollziehbare Projektversion',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Versionen', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  const state = page.getByRole('region', { name: 'Versionsstand' });
  await expect(state).toContainText('c'.repeat(40));
  const site = page.getByRole('article', { name: /^Site / });
  await expect(site).toContainText('Als verfügbar beobachtet');
  await expect(site).toContainText('Privater Sites-Quellspeicher');
  await expect(site).toContainText('d'.repeat(40));
  await expect(
    site.getByRole('link', { name: 'Beobachteten Site-Link öffnen' }),
  ).toHaveAttribute('href', 'https://example.invalid/demo-preview');
  await expect(
    page
      .getByRole('region', { name: 'Enthaltene Aufträge' })
      .getByRole('link', {
        name: 'DEMO-3 · Implementierung nachvollziehen',
        exact: true,
      }),
  ).toHaveAttribute('href', '/projects/planning-e2e/orders/order-evidence-e2e');
  await expect(
    page.getByRole('region', { name: 'Produktionsreleasebelege' }),
  ).toContainText('Kein Produktionsrelease aufgezeichnet.');
  await page.reload();
  await expect(site).toContainText('d'.repeat(40));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole('link', { name: 'Zur Versionsliste', exact: true })
    .click();
  await expect(
    page.getByRole('link', {
      name: 'Lokale Vorschau 1 · Nachvollziehbare Projektversion',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /anlegen|speichern|freigeben|veröffentlichen/i,
    }),
  ).toHaveCount(0);
});
