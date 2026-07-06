import { expect, test } from '@playwright/test';

const player = {
  id: 1,
  displayName: 'Blitzen',
  updatedAt: '2026-07-04T18:00:00.000Z',
  pbs: [{ boss: 'zulrah', timeSeconds: 80, updatedAt: '2026-07-04T18:00:00.000Z' }],
};

const leaderboardRows = [
  { displayName: 'Fast', timeSeconds: 80, updatedAt: '2026-07-04T18:00:00.000Z' },
  { displayName: 'Slow', timeSeconds: 100, updatedAt: '2026-07-04T18:00:00.000Z' },
];

const recentSyncs = [
  {
    id: 1,
    displayName: 'Blitzen',
    updatedAt: '2026-07-04T18:00:00.000Z',
    pbCount: 1,
  },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/bosses', (route) => route.fulfill({ json: ['vorkath', 'zulrah'] }));
  await page.route('**/api/search**', (route) => route.fulfill({ json: ['Blitzen'] }));
  await page.route('**/api/recent-syncs**', (route) => route.fulfill({ json: recentSyncs }));
});

test('initial load shows the search experience and recent syncs', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByLabel('Player name')).toBeVisible();
  await expect(page.getByText('Search a player above')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent Syncs' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Blitzen/ })).toBeVisible();
});

test('player search success renders the PB table', async ({ page }) => {
  await page.route('**/api/players/Blitzen', (route) => route.fulfill({ json: player }));
  await page.goto('/');

  await page.getByLabel('Player name').fill('Blitzen');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page.getByRole('heading', { name: 'Blitzen' })).toBeVisible();
  await expect(page.getByText('Zulrah')).toBeVisible();
  await expect(page.getByText('1:20')).toBeVisible();
});

test('unknown player shows the not-found state', async ({ page }) => {
  await page.route('**/api/players/Nobody', (route) =>
    route.fulfill({ status: 404, json: { error: 'Player not found' } })
  );
  await page.goto('/');

  await page.getByLabel('Player name').fill('Nobody');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page.getByText('No PB data found for')).toBeVisible();
});

test('ambiguous names show the picker and resolve by id', async ({ page }) => {
  await page.route('**/api/players/Blitzen', (route) =>
    route.fulfill({
      json: {
        ambiguous: true,
        matches: [
          { id: 1, displayName: 'Blitzen', updatedAt: '2026-07-04T18:00:00.000Z' },
          { id: 2, displayName: 'Blitzen', updatedAt: '2026-07-03T18:00:00.000Z' },
        ],
      },
    })
  );
  await page.route('**/api/players/by-id/1', (route) => route.fulfill({ json: player }));

  await page.goto('/player/Blitzen');
  await expect(page.getByText('Multiple synced players')).toBeVisible();
  await page.locator('.match-option').first().click();

  await expect(page.getByRole('heading', { name: 'Blitzen' })).toBeVisible();
});

test('boss leaderboard loads via the combobox', async ({ page }) => {
  await page.route('**/api/leaderboard/zulrah**', (route) =>
    route.fulfill({ json: leaderboardRows })
  );
  await page.goto('/');

  await page.getByRole('button', { name: /Select a boss/ }).click();
  await page.getByRole('option', { name: 'Zulrah' }).click();

  await expect(page.getByRole('heading', { name: /Zulrah - Top times/ })).toBeVisible();
  await expect(page.getByText('Fast')).toBeVisible();
});

test('recent sync rows navigate to player results', async ({ page }) => {
  await page.route('**/api/players/Blitzen', (route) => route.fulfill({ json: player }));
  await page.goto('/');

  await page.getByRole('button', { name: /Blitzen/ }).click();

  await expect(page).toHaveURL(/\/player\/Blitzen/);
  await expect(page.getByRole('heading', { name: 'Blitzen' })).toBeVisible();
});

test('shared URLs restore player and boss views', async ({ page }) => {
  await page.route('**/api/players/Blitzen', (route) => route.fulfill({ json: player }));
  await page.goto('/player/Blitzen');
  await expect(page.getByRole('heading', { name: 'Blitzen' })).toBeVisible();

  await page.route('**/api/leaderboard/zulrah**', (route) =>
    route.fulfill({ json: leaderboardRows })
  );
  await page.goto('/boss/zulrah');
  await expect(page.getByRole('heading', { name: /Zulrah - Top times/ })).toBeVisible();
});
