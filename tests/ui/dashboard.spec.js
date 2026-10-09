const { test, expect } = require('@playwright/test');
test('operator flow: count, duplicate, inspect, acknowledge, correction, exceptions, audit', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle(/NorthBridge/);
  await expect(page.locator('#health-text')).toHaveText('Backend connected');
  const id = 'UI-' + Date.now(),
    source = 'UI-TEST-' + id,
    count = {
      source_id: source,
      event_id: id,
      type: 'COUNT',
      quantity: 5,
      event_time: new Date().toISOString(),
    };
  await page.locator('#payload').fill(JSON.stringify(count));
  await page.locator('#submit').click();
  await expect(page.locator('#submit-results')).toContainText('ACCEPTED');
  await page.locator('#source').fill(source);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('[data-metric="net_total"]')).toHaveText('5');
  await page.locator('#submit').click();
  await expect(page.locator('#submit-results')).toContainText('DUPLICATE');
  await expect(page.locator('[data-metric="duplicates"]')).toHaveText('1');
  await page.getByRole('button', { name: id, exact: true }).click();
  await expect(page.locator('#detail-dialog')).toBeVisible();
  await expect(page.locator('#detail-json')).toContainText('normalized_payload');
  await page.locator('#close-detail').click();
  await page.getByRole('checkbox', { name: 'Select ' + id, exact: true }).check();
  await page.locator('#ack').click();
  await expect(page.locator('#empty strong')).toHaveText('No events waiting for review');
  await page.locator('#payload').fill(
    JSON.stringify({
      source_id: source,
      event_id: id + '-VOID',
      type: 'VOID',
      target_event_id: id,
      event_time: new Date().toISOString(),
    }),
  );
  await page.locator('#submit').click();
  await expect(page.locator('[data-metric="net_total"]')).toHaveText('0');
  await page
    .locator('#payload')
    .fill(JSON.stringify({ ...count, quantity: 501, event_id: id + '-INVALID' }));
  await page.locator('#submit').click();
  await expect(page.locator('#submit-results')).toContainText('REJECTED');
  await expect(page.locator('#submit-results')).toContainText('1 to 500');
  await expect(page.locator('[data-metric="rejected_submissions"]')).toHaveText('1');
  await page.getByRole('tab', { name: 'Exceptions' }).click();
  await expect(page.locator('#table-body')).toContainText(id + '-INVALID');
  await page.getByRole('button', { name: 'Audit history', exact: true }).click();
  await expect(page.locator('#table-body')).toContainText('DUPLICATE');
  await page.getByRole('button', { name: 'Connection settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.locator('#close-settings').click();
  await page.locator('#payload').fill('{');
  await page.locator('#submit').click();
  await expect(page.locator('#notice')).toContainText('Invalid JSON');
  expect(errors).toEqual([]);
});
test('narrow mobile layout and controls remain usable without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#health-text')).toHaveText('Backend connected');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Count', exact: true }).click();
  await expect(page.locator('#payload')).toHaveValue(/"type": "COUNT"/);
  await page.getByRole('button', { name: 'Device connection', exact: true }).click();
  await expect(page.locator('#device')).toBeInViewport();
});
test('API outage is visible and metric values are unavailable', async ({ page }) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"Database unavailable"}',
    }),
  );
  await page.goto('/');
  await expect(page.locator('#notice')).toContainText('Unable to refresh');
  await expect(page.locator('[data-metric="net_total"]')).toHaveText('—');
  await expect(page.locator('#empty strong')).toHaveText('Unable to load events');
});

test('source input filters summary, pending and exceptions; Clear restores all sources', async ({
  page,
  request,
}) => {
  const prefix = 'FILTER-' + Date.now();
  const sourceA = prefix + '-A',
    sourceB = prefix + '-B';
  const initial = await (await request.get('/api/state?view=summary')).json();
  const event = (source, suffix, quantity) => ({
    source_id: source,
    event_id: prefix + suffix,
    type: 'COUNT',
    quantity,
    event_time: new Date().toISOString(),
  });
  const seed = await request.post('/api/events', {
    data: [
      event(sourceA, '-ACCEPT-A', 450),
      event(sourceA, '-REJECT-A', 501),
      event(sourceB, '-ACCEPT-B', 20),
      event(sourceB, '-REJECT-B', 501),
    ],
  });
  expect(seed.ok()).toBeTruthy();
  const requested = [];
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.pathname === '/api/state') requested.push(u);
  });
  await page.goto('/');
  await expect(page.locator('#health-text')).toHaveText('Backend connected');
  await page.getByLabel('Production source', { exact: true }).fill(sourceA);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('[data-metric="net_total"]')).toHaveText('450');
  await expect(page.locator('[data-metric="rejected_submissions"]')).toHaveText('1');
  await expect(page.locator('#table-body')).toContainText(prefix + '-ACCEPT-A');
  await expect(page.locator('#table-body')).not.toContainText(prefix + '-ACCEPT-B');
  await page.getByRole('tab', { name: 'Exceptions' }).click();
  await expect(page.locator('#table-body')).toContainText(prefix + '-REJECT-A');
  await expect(page.locator('#table-body')).not.toContainText(prefix + '-REJECT-B');
  for (const view of ['summary', 'pending', 'exceptions'])
    expect(
      requested.some(
        (u) => u.searchParams.get('view') === view && u.searchParams.get('source_id') === sourceA,
      ),
    ).toBe(true);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator('#source')).toHaveValue('');
  await expect(page.locator('[data-metric="net_total"]')).toHaveText(
    (initial.net_total + 470).toLocaleString(),
  );
  await expect(page.locator('[data-metric="rejected_submissions"]')).toHaveText(
    (initial.rejected_submissions + 2).toLocaleString(),
  );
  await page.locator('#source').fill(prefix + '-EMPTY');
  await page.locator('#source').press('Enter');
  await expect(page.locator('[data-metric="rejected_submissions"]')).toHaveText('0');
  await expect(page.locator('#empty strong')).toHaveText('No exceptions to resolve');
  await page.getByRole('tab', { name: 'Pending review' }).click();
  await expect(page.locator('#empty strong')).toHaveText('No events waiting for review');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('[data-metric="rejected_submissions"]')).toBeVisible();
});

test('filter loading and failure do not display rows from a previous source', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#health-text')).toHaveText('Backend connected');
  let finish;
  const waiting = new Promise((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/state?**', async (route) => {
    await waiting;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"Database unavailable"}',
    });
  });
  await page.locator('#source').fill('UNAVAILABLE-LINE');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('#empty strong')).toHaveText('Loading events…');
  await expect(page.locator('#table-body')).toBeHidden();
  finish();
  await expect(page.locator('#empty strong')).toHaveText('Unable to load events');
  await expect(page.locator('#table-body')).toBeEmpty();
  await expect(page.locator('[data-metric="rejected_submissions"]')).toHaveText('—');
});
