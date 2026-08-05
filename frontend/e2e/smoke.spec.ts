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
  await page.route('**/api/feedback', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/search/all**', (route) => route.fulfill({
    json: [{ type: 'player', value: 'Blitzen' }],
  }));
  await page.route('**/api/recent-syncs**', (route) => route.fulfill({ json: recentSyncs }));
  await page.route('**/api/stats', (route) =>
    route.fulfill({ json: { trackedPlayers: 1284, personalBestRecords: 18492 } })
  );
});

test('initial load shows the search experience and recent syncs', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByLabel('Search players or bosses')).toBeVisible();
  await expect(page.getByText('1,284')).toBeVisible();
  await expect(page.getByText('18,492')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Recent syncs' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Blitzen/ })).toBeVisible();
});

test('feedback control is visible and submits page-aware context', async ({ page }) => {
  let submittedBody: unknown;
  await page.route('**/api/feedback', async (route) => {
    submittedBody = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/boss/zulrah');

  await page.getByRole('button', { name: 'Feedback' }).click();
  await expect(page.getByRole('dialog', { name: 'Send feedback' })).toBeVisible();
  await page.getByLabel('Found a bug, a wrong PB, or something confusing? Say so here.').fill(
    'The leaderboard looks wrong.'
  );
  await page.getByRole('button', { name: 'Send feedback' }).click();

  await expect(page.getByText('Thanks - that helps a lot while this is still in beta.')).toBeVisible();
  expect(submittedBody).toEqual({
    message: 'The leaderboard looks wrong.',
    context: 'boss:zulrah',
  });
});

test('feedback panel stays fully usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('button', { name: /Feedback/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Send feedback' });
  await expect(dialog).toBeVisible();

  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);

  await page.getByLabel('Found a bug, a wrong PB, or something confusing? Say so here.').fill(
    'Mobile feedback check.'
  );
  await expect(page.getByRole('button', { name: 'Send feedback' })).toBeEnabled();
});

test('player search success renders the PB table', async ({ page }) => {
  await page.route('**/api/players/blitzen', (route) => route.fulfill({ json: player }));
  await page.goto('/');

  await page.getByLabel('Search players or bosses').fill('Blitzen');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page.getByRole('heading', { name: 'Blitzen' })).toBeVisible();
  await expect(page.getByText('Zulrah')).toBeVisible();
  await expect(page.getByText('1:20')).toBeVisible();
});

test('raid aliases show only mode choices before navigating to variants', async ({ page }) => {
  const normalKey = 'theatre of blood - fastest overall (3 player)';
  await page.route('**/api/bosses', (route) => route.fulfill({ json: [
    'theatre of blood - entry - fastest overall (1 player entry mode)',
    normalKey,
    'theatre of blood - hard - fastest overall (4 player hard mode)',
    'zulrah',
  ] }));
  await page.route('**/api/leaderboard/**', (route) =>
    route.fulfill({ json: { rows: leaderboardRows, total: leaderboardRows.length, limit: 50, offset: 0 } })
  );
  await page.goto('/');

  await page.getByLabel('Search players or bosses').fill('ToB');
  await expect(page.getByRole('button', { name: 'boss Theatre Of Blood — Entry' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'boss Theatre Of Blood — Normal' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'boss Theatre Of Blood — Hard' })).toBeVisible();
  await expect(page.getByText(/Fastest Overall/)).toHaveCount(0);
  await page.getByRole('button', { name: 'boss Theatre Of Blood — Normal' }).click();

  await expect(page).toHaveURL((url) => decodeURIComponent(url.pathname) === `/boss/${normalKey}`);
  await expect(page.getByRole('heading', { name: 'Theatre Of Blood' })).toBeVisible();
});

test('unknown player shows the not-found state', async ({ page }) => {
  await page.route('**/api/players/nobody', (route) =>
    route.fulfill({ status: 404, json: { error: 'Player not found' } })
  );
  await page.goto('/');

  await page.getByLabel('Search players or bosses').fill('Nobody');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page.getByText('No synced profile found for')).toBeVisible();
});

test('ambiguous names show the matching-profile state', async ({ page }) => {
  await page.route('**/api/players/blitzen', (route) =>
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
  await page.goto('/player/Blitzen');
  await expect(page.getByText('2 matching profiles found for')).toBeVisible();
});

test('boss leaderboard loads via the combobox', async ({ page }) => {
  await page.route('**/api/leaderboard/zulrah**', (route) =>
    route.fulfill({ json: { rows: leaderboardRows, total: leaderboardRows.length, limit: 50, offset: 0 } })
  );
  await page.goto('/');

  await page.getByRole('button', { name: 'Leaderboards' }).click();
  await page.locator('.combobox-trigger').click();
  await page.getByRole('option', { name: 'Zulrah' }).click();

  await expect(page.getByRole('heading', { name: 'Zulrah' })).toBeVisible();
  await expect(page.getByText('Fast')).toBeVisible();
});

test('grouped boss picker opens raid variants and restores the selected mode from the URL', async ({ page }) => {
  const groupedBosses = [
    'zulrah',
    'chambers of xeric',
    'chambers of xeric - fastest overall (solo)',
    'chambers of xeric - fastest room (solo)',
    'chambers of xeric - challenge mode - fastest overall (3 players)',
    'chambers of xeric - challenge mode - fastest room (3 players)',
    'chambers of xeric - fastest room (former)',
    'the nightmare - fastest overall (solo)',
    'the nightmare - fastest overall (2 players)',
  ];
  const challengeKey = 'chambers of xeric - challenge mode - fastest overall (3 players)';

  await page.route('**/api/bosses', (route) => route.fulfill({ json: groupedBosses }));
  await page.route('**/api/leaderboard/**', (route) => route.fulfill({
    json: { rows: leaderboardRows, total: leaderboardRows.length, limit: 50, offset: 0 },
  }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Leaderboards' }).click();
  await page.locator('.combobox-trigger').click();

  await expect(page.getByText('Raids')).toBeVisible();
  await expect(page.getByText('Bosses')).toBeVisible();
  await expect(page.getByRole('option', { name: /Chambers Of Xeric/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /The Nightmare/ })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Zulrah' })).toBeVisible();
  await expect(page.getByRole('option', { name: /Challenge Mode/ })).toHaveCount(0);

  await page.getByRole('option', { name: /Chambers Of Xeric/ }).click();

  await expect(page.getByRole('button', { name: 'Normal', exact: true })).toHaveClass(/active/);
  await expect(page.locator('.raid-kind-tab', { hasText: 'Overall' })).toHaveClass(/active/);
  await expect(page.locator('.raid-variant-button', { hasText: 'Solo' })).toHaveClass(/active/);

  await page.locator('.raid-variant-button', { hasText: 'Overall' }).click();

  await expect(page).toHaveURL((url) => decodeURIComponent(url.pathname) === '/boss/chambers of xeric');
  await expect(page.getByRole('heading', { name: 'Chambers Of Xeric' })).toBeVisible();

  await page.getByRole('button', { name: 'Challenge Mode', exact: true }).click();

  await expect(page).toHaveURL((url) => decodeURIComponent(url.pathname) === `/boss/${challengeKey}`);
  await expect(page.getByRole('heading', { name: 'Chambers Of Xeric' })).toBeVisible();
  await expect(page.getByText('Challenge Mode - Fastest Overall (3 Players)', { exact: true })).toBeVisible();

  await page.reload();

  await expect(page.getByRole('button', { name: 'Challenge Mode', exact: true })).toHaveClass(/active/);
  await expect(page.locator('.raid-kind-tab', { hasText: 'Overall' })).toHaveClass(/active/);
  await expect(page.locator('.raid-variant-button', { hasText: 'Trio' })).toHaveClass(/active/);
});

test('recent sync rows navigate to player results', async ({ page }) => {
  await page.route('**/api/players/blitzen', (route) => route.fulfill({ json: player }));
  await page.goto('/');

  await page.getByRole('button', { name: /Blitzen/ }).click();

  await expect(page).toHaveURL(/\/player\/Blitzen/);
  await expect(page.getByRole('heading', { name: 'Blitzen' })).toBeVisible();
});

test('shared URLs restore player and boss views', async ({ page }) => {
  await page.route('**/api/players/blitzen', (route) => route.fulfill({ json: player }));
  await page.goto('/player/Blitzen');
  await expect(page.getByRole('heading', { name: 'Blitzen' })).toBeVisible();

  await page.route('**/api/leaderboard/zulrah**', (route) =>
    route.fulfill({ json: { rows: leaderboardRows, total: leaderboardRows.length, limit: 50, offset: 0 } })
  );
  await page.goto('/boss/zulrah');
  await expect(page.getByRole('heading', { name: 'Zulrah' })).toBeVisible();
});

test('player-linked boss leaderboards can paginate past the highlighted player', async ({ page }) => {
  const rankedPlayer = {
    ...player,
    pbs: [{ ...player.pbs[0], rank: 51 }],
  };
  const leaderboardRequests: string[] = [];

  await page.route('**/api/players/blitzen', (route) => route.fulfill({ json: rankedPlayer }));
  await page.route('**/api/leaderboard/zulrah**', (route) => {
    const url = new URL(route.request().url());
    leaderboardRequests.push(url.search);
    const requestedOffset = Number(url.searchParams.get('offset'));
    const offset = url.searchParams.has('highlight') ? 50 : requestedOffset;
    return route.fulfill({
      json: {
        rows: [{
          displayName: offset === 50 ? 'Blitzen' : `Player${offset + 1}`,
          timeSeconds: 80 + offset,
          updatedAt: '2026-07-04T18:00:00.000Z',
        }],
        total: 150,
        limit: 50,
        offset,
      },
    });
  });

  await page.goto('/player/Blitzen');
  await page.getByRole('button', { name: /Zulrah/ }).click();

  await expect(page).toHaveURL(/\/boss\/zulrah\?highlight=Blitzen/);
  await expect(page.getByRole('button', { name: 'Page 2' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Page 2' }).first()).toHaveAttribute('aria-current', 'page');
  expect(leaderboardRequests.at(-1)).toContain('highlight=blitzen');

  await page.getByRole('navigation', { name: 'Leaderboard pages (top)' }).getByRole('button', { name: 'Next' }).click();

  await expect(page.getByText('Player101')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Page 3' }).first()).toHaveAttribute('aria-current', 'page');
  expect(leaderboardRequests.at(-1)).toContain('offset=100');
  expect(leaderboardRequests.at(-1)).not.toContain('highlight=');
});

test('raid variants collapse into one expandable row on a player page', async ({ page }) => {
  const raidPlayer = {
    id: 1,
    displayName: 'Blitzen',
    updatedAt: '2026-07-04T18:00:00.000Z',
    pbs: [
      { boss: 'zulrah', timeSeconds: 80, rank: 1, updatedAt: '2026-07-04T18:00:00.000Z' },
      {
        boss: 'chambers of xeric - fastest overall (solo)',
        timeSeconds: 2000,
        rank: 5,
        updatedAt: '2026-07-04T18:00:00.000Z',
      },
      {
        boss: 'chambers of xeric - fastest overall (3 players)',
        timeSeconds: 1000,
        rank: 2,
        updatedAt: '2026-07-05T18:00:00.000Z',
      },
    ],
  };
  await page.route('**/api/players/blitzen', (route) => route.fulfill({ json: raidPlayer }));
  await page.goto('/player/Blitzen');

  await expect(page.getByRole('heading', { name: 'Blitzen' })).toBeVisible();
  // Two raid variants collapse to one summary row (the faster Trio time),
  // instead of two separate flat rows.
  await expect(page.getByRole('button', { name: /Chambers Of Xeric/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /16:40.*Trio/ })).toBeVisible();
  await expect(page.getByText('Solo', { exact: true })).not.toBeVisible();

  await page.getByRole('button', { name: 'Show all 2 variants', exact: true }).click();

  await expect(page.getByText('Solo', { exact: true })).toBeVisible();
  await expect(page.getByText('Trio', { exact: true })).toBeVisible();
});
