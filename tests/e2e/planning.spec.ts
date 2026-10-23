import { expect, test } from '@playwright/test';

test('registriertes Projekt, nächster Milestone und Einstellungen sind auf Desktop und Handy lesbar', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('link', { name: 'Beispielprojekt', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Beispielprojekt' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Nächster Milestone' }),
  ).toContainText('Erster Meilenstein');
  await expect(
    page.getByRole('region', { name: 'Projekteinstellungen' }),
  ).toContainText('develop');
  await expect(
    page.getByRole('region', { name: 'Projekteinstellungen' }),
  ).toContainText('main');
  await page.getByRole('link', { name: 'Milestones', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Milestones' }),
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Erster Meilenstein' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('article', { name: 'Erster Meilenstein' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole('button', { name: /anlegen|bearbeiten|löschen/i }),
  ).toHaveCount(0);
});

test('Auftragsfilter, Spezifikationsfassungen und gerichtete Beziehungen lesen', async ({
  page,
}) => {
  await page.goto('/projects/planning-e2e/milestones');
  await page
    .getByRole('article', { name: 'Erster Meilenstein' })
    .getByRole('link', { name: 'Aufträge ansehen' })
    .click();
  await expect(
    page.getByRole('combobox', { name: 'Milestone', exact: true }),
  ).toHaveValue('milestone-e2e');
  await expect(
    page.getByRole('article', {
      name: 'DEMO-1 Projektübersicht lesen',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('article', { name: /DEMO-2/ })).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Milestone', exact: true })
    .selectOption('unplanned');
  await page
    .getByRole('combobox', { name: 'Typ', exact: true })
    .selectOption('defect');
  await page
    .getByRole('combobox', { name: 'Zustand', exact: true })
    .selectOption('draft');
  await expect(
    page.getByRole('article', {
      name: 'DEMO-2 Kleinen Fehler beheben',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('article', { name: /DEMO-1/ })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: 'Milestone', exact: true }),
  ).toHaveValue('unplanned');
  await expect(
    page.getByRole('combobox', { name: 'Typ', exact: true }),
  ).toHaveValue('defect');
  await expect(
    page.getByRole('combobox', { name: 'Zustand', exact: true }),
  ).toHaveValue('draft');
  await expect(page.getByRole('article', { name: /DEMO-2/ })).toBeVisible();
  await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
  await page
    .getByRole('link', { name: 'Projektübersicht lesen', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'DEMO-1' }),
  ).toBeVisible();
  const specification = page.getByRole('region', {
    name: 'Spezifikation',
    exact: true,
  });
  await expect(specification).toContainText('Planung nachvollziehen');
  await expect(specification).toContainText(
    'Projekt und Auftrag sind sichtbar',
  );
  await page
    .getByRole('combobox', { name: 'Spezifikationsfassung', exact: true })
    .selectOption('1');
  await expect(specification).toContainText('Früherer Entwurf');
  await expect(
    page.getByRole('region', { name: 'Aktueller Auftragsstand' }),
  ).toContainText('Entwurf');
  const relations = page.getByRole('region', {
    name: 'Ausgehende Beziehungen',
  });
  await expect(relations).toContainText('Verwandt mit');
  await relations
    .getByRole('link', { name: 'DEMO-2 · Kleinen Fehler beheben', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'DEMO-2' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole('button', { name: /freigeben|starten|bearbeiten|löschen/i }),
  ).toHaveCount(0);
});
