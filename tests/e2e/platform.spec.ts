import { expect, test } from '@playwright/test';

test('LUUFI-2 F-1 deutsche Grundnavigation bleibt auf Desktop und Handy erreichbar', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Projekte', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Projekte', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('link', { name: 'Projektideen', exact: true }),
  ).toHaveAttribute('href', '/ideas');
  await expect(
    page.getByRole('link', { name: 'Beispielprojekt', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
