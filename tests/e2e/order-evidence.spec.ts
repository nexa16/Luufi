import { expect, test } from '@playwright/test';

test('Freigabe, Integration und von Codex aufgezeichnete Nachweise sind auf Desktop und Handy lesbar', async ({
  page,
}) => {
  await page.goto('/projects/planning-e2e/orders/order-evidence-e2e');
  await expect(
    page.getByRole('heading', {
      name: 'Implementierung nachvollziehen',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Aktueller Auftragsstand' }),
  ).toContainText('Erledigt');
  const current = page.getByRole('region', {
    name: 'Aktueller Freigabe- und Bearbeitungsstand',
  });
  await expect(current).toContainText('Gültige Freigabe · Fassung 1');
  await expect(current).toContainText('Keine aktive Bearbeitung.');
  await expect(
    page.getByRole('region', {
      name: 'Freigabe, Bearbeitung und Nachweise',
      exact: true,
    }),
  ).toContainText('Gitfakten wurden von Codex lokal geprüft');
  const integrated = page.getByRole('article', {
    name: /^Integrationsnachweis /,
  });
  await expect(integrated).toContainText('Erfolgreich');
  await expect(integrated).toContainText('Normaler Merge');
  await expect(integrated).toContainText(
    'Kein Build bereitgestellt: Synthetischer Stand ohne Bereitstellung',
  );
  await expect(
    integrated.getByRole('link', {
      name: 'https://github.com/example/demo/pull/1',
      exact: true,
    }),
  ).toHaveAttribute('href', 'https://github.com/example/demo/pull/1');
  await expect(
    integrated.getByRole('link', {
      name: 'https://github.com/example/demo/actions/runs/1',
      exact: true,
    }),
  ).toHaveAttribute('href', 'https://github.com/example/demo/actions/runs/1');
  await page.reload();
  await expect(integrated).toContainText(
    'Als Integrationsnachweis referenziert.',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole('button', {
      name: /freigeben|starten|pausieren|übernehmen|speichern|archivieren/i,
    }),
  ).toHaveCount(0);
});
