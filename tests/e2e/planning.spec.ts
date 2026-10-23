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
