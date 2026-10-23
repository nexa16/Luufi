import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import type { ProjectIdea } from '../../lib/domain/project-ideas';

const mutationHeaders = { Origin: 'http://127.0.0.1:4175' };

async function allIdeas(request: APIRequestContext) {
  let cursor: string | null = null;
  const items: ProjectIdea[] = [];
  do {
    const response = await request.get(
      `/api/ideas?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    expect(response.ok()).toBe(true);
    const page = (await response.json()) as {
      items: ProjectIdea[];
      nextCursor: string | null;
    };
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

async function cleanUp(page: Page, prefix: string) {
  for (const idea of (await allIdeas(page.request)).filter((item) =>
    item.text.startsWith(prefix),
  )) {
    const response = await page.request.delete(
      `/api/ideas/${encodeURIComponent(idea.id)}`,
      {
        headers: mutationHeaders,
        data: {
          expectedRevision: idea.revision,
          requestKey: crypto.randomUUID(),
        },
      },
    );
    expect(response.ok()).toBe(true);
  }
}

test('Idee ohne Projekt anlegen, nach Neuladen bearbeiten und bestätigt löschen', async ({
  page,
}, testInfo) => {
  const prefix = `Browser ${testInfo.project.name} ${crypto.randomUUID()}`;
  try {
    await page.goto('/ideas');
    await expect(
      page.getByRole('heading', { name: 'Projektideen', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '+ Neue Idee' }).click();
    const dialog = page.getByRole('dialog', { name: 'Neue Idee', exact: true });
    await dialog.getByLabel('Titel').fill(prefix);
    await dialog
      .getByLabel('Details')
      .fill('Ein Gedanke ohne Projektzuordnung.\nMit einer zweiten Zeile.');
    const createdResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/ideas') &&
        response.request().method() === 'POST',
    );
    await dialog
      .getByRole('button', { name: 'Speichern', exact: true })
      .click();
    const created = (await (await createdResponse).json()) as {
      idea: ProjectIdea;
    };
    const card = page.getByRole('article', { name: prefix, exact: true });
    await expect(card).toBeVisible();
    await page.reload();
    await expect(card).toBeVisible();
    await expect(card).toContainText(`ID ${created.idea.id}`);
    await card.getByRole('button', { name: 'Bearbeiten' }).click();
    await page.getByLabel('Titel').fill(`${prefix} überarbeitet`);
    await page.getByLabel('Details').fill('Überarbeitete Beschreibung');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Speichern' })
      .click();
    const edited = page.getByRole('article', {
      name: `${prefix} überarbeitet`,
      exact: true,
    });
    await expect(edited).toBeVisible();
    await expect(edited).toContainText(`ID ${created.idea.id}`);
    await expect(edited).toContainText('Überarbeitete Beschreibung');
    const persisted = (await allIdeas(page.request)).find(
      (item) => item.id === created.idea.id,
    );
    expect(persisted?.revision).toBe(created.idea.revision + 1);
    expect(persisted?.text).toBe(`${prefix} überarbeitet`);
    await expect(
      page.getByRole('link', { name: 'Projektideen', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await edited.getByRole('button', { name: 'Löschen', exact: true }).click();
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(edited).toBeVisible();
    await edited.getByRole('button', { name: 'Löschen', exact: true }).click();
    await page.getByRole('button', { name: 'Endgültig löschen' }).click();
    await expect(edited).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Ideen werden geladen …')).toHaveCount(0);
    expect(
      (await allIdeas(page.request)).some(
        (item) => item.id === created.idea.id,
      ),
    ).toBe(false);
  } finally {
    await cleanUp(page, prefix);
  }
});

test('echter Revisionskonflikt erhält den Entwurf und verlangt bewusste Wiederholung', async ({
  page,
}, testInfo) => {
  const prefix = `Konflikt ${testInfo.project.name} ${crypto.randomUUID()}`;
  const created = await page.request.post('/api/ideas', {
    headers: mutationHeaders,
    data: { text: prefix, detail: '', requestKey: crypto.randomUUID() },
  });
  expect(created.ok()).toBe(true);
  const { idea } = (await created.json()) as { idea: ProjectIdea };
  try {
    await page.goto('/ideas');
    await page
      .getByRole('article', { name: prefix, exact: true })
      .getByRole('button', { name: 'Bearbeiten' })
      .click();
    await page.getByLabel('Titel').fill(`${prefix} Entwurf`);
    const external = await page.request.patch(`/api/ideas/${idea.id}`, {
      headers: mutationHeaders,
      data: {
        text: `${prefix} anderer Stand`,
        detail: 'Zwischenzeitliche Änderung',
        expectedRevision: idea.revision,
        requestKey: crypto.randomUUID(),
      },
    });
    expect(external.ok()).toBe(true);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Speichern' })
      .click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel('Titel')).toHaveValue(`${prefix} Entwurf`);
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Speichern' }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Aktuellen Stand laden' }).click();
    await expect(page.getByText(/Aktueller Stand:/)).toContainText(
      'Zwischenzeitliche Änderung',
    );
    await expect(page.getByLabel('Titel')).toHaveValue(`${prefix} Entwurf`);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Speichern' })
      .click();
    await expect(
      page.getByRole('article', { name: `${prefix} Entwurf`, exact: true }),
    ).toBeVisible();
    const saved = (await allIdeas(page.request)).find(
      (item) => item.id === idea.id,
    );
    expect(saved?.revision).toBe(idea.revision + 2);
  } finally {
    await cleanUp(page, prefix);
  }
});

test('verlorene Antwort nach echtem Speichern erzeugt bei Wiederholung keine zweite Idee', async ({
  page,
}, testInfo) => {
  const prefix = `Wiederholung ${testInfo.project.name} ${crypto.randomUUID()}`;
  try {
    await page.goto('/ideas');
    await page.getByRole('button', { name: '+ Neue Idee' }).click();
    await page.getByLabel('Titel').fill(prefix);
    await page
      .getByLabel('Details')
      .fill('Dieser Entwurf bleibt bei einem Verbindungsfehler erhalten.');
    await page.route('**/api/ideas', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const actual = await route.fetch();
      expect(actual.ok()).toBe(true);
      await route.abort('failed');
    });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Speichern' })
      .click();
    await expect(page.getByRole('alert')).toContainText('nicht erreichbar');
    await expect(page.getByLabel('Titel')).toHaveValue(prefix);
    await expect(page.getByLabel('Details')).toHaveValue(
      'Dieser Entwurf bleibt bei einem Verbindungsfehler erhalten.',
    );
    await page.unroute('**/api/ideas');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Speichern' })
      .click();
    await expect(
      page.getByRole('article', { name: prefix, exact: true }),
    ).toBeVisible();
    expect(
      (await allIdeas(page.request)).filter((item) => item.text === prefix),
    ).toHaveLength(1);
  } finally {
    await cleanUp(page, prefix);
  }
});
