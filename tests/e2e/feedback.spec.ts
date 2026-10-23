import { expect, test } from '@playwright/test';

const image = {
  name: 'feedback-test.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
    'base64',
  ),
};

test('Feedbacktext überlebt einen fehlgeschlagenen Upload und erhält unveränderte Originale und Ergänzungen', async ({
  page,
}) => {
  const original = `Browserbeobachtung ${crypto.randomUUID()}`;
  const addition = 'Eine datierte Ergänzung zum erhaltenen Original.';
  let interrupted = false;
  await page.route(
    '**/api/projects/planning-e2e/feedback/*/attachments/*',
    async (route) => {
      if (route.request().method() === 'PUT' && !interrupted) {
        interrupted = true;
        await route.abort('failed');
      } else await route.continue();
    },
  );
  await page.goto('/projects/planning-e2e/feedback');
  await page.getByLabel('Feedbacktext', { exact: true }).fill(original);
  await page.getByLabel('Dateien hinzufügen').setInputFiles(image);
  await page
    .getByRole('button', { name: 'Feedback speichern', exact: true })
    .click();
  await expect(
    page.getByText(
      'Text gespeichert. Dateien werden davon unabhängig übertragen.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Text bleibt erhalten');
  await page
    .getByRole('link', { name: 'Gespeichertes Feedback öffnen' })
    .click();
  await expect(
    page.getByRole('article', { name: 'Originalfeedback' }),
  ).toContainText(original);
  await page.reload();
  const originalEntry = page.getByRole('article', { name: 'Originalfeedback' });
  await expect(originalEntry).toContainText(original);
  await expect(originalEntry).toContainText('Unvollständig');
  await originalEntry
    .getByLabel('Datei erneut auswählen: feedback-test.png')
    .setInputFiles(image);
  await originalEntry
    .getByRole('button', { name: 'Datei übertragen: feedback-test.png' })
    .click();
  await expect(
    originalEntry.getByRole('img', { name: 'feedback-test.png' }),
  ).toBeVisible();
  await expect(originalEntry).toContainText('Gespeichert und geprüft');
  const download = originalEntry.getByRole('link', {
    name: 'Datei herunterladen: feedback-test.png',
  });
  await expect(download).toHaveAttribute(
    'href',
    /^\/api\/projects\/planning-e2e\/feedback\/[^/]+\/attachments\/[^/?]+\?download=1$/,
  );
  await page.getByLabel('Ergänzung', { exact: true }).fill(addition);
  await page
    .getByRole('button', { name: 'Ergänzung speichern', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Gespeicherte Eingabe' }),
  ).toContainText(addition);
  await page.reload();
  await expect(originalEntry).toContainText(original);
  await expect(
    page.getByRole('article', { name: 'Ergänzung 1' }),
  ).toContainText(addition);
  await expect(
    page.getByRole('region', { name: 'Refinementergebnisse' }),
  ).toContainText('Noch kein Refinement dokumentiert.');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole('button', {
      name: /bearbeiten|löschen|analysieren|freigeben/i,
    }),
  ).toHaveCount(0);
});
