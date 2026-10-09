const { chromium, expect } = require('@playwright/test');
const { mkdir } = require('node:fs/promises');
(async () => {
  await mkdir('docs/screenshots', { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1505, height: 1045 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto(process.env.UI_BASE_URL || 'http://127.0.0.1:3001');
  await page.locator('#health-text').waitFor();
  await page.waitForFunction(
    () => document.querySelector('#health-text').textContent === 'Backend connected',
  );
  await page.screenshot({ path: 'docs/screenshots/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/screenshots/dashboard-mobile.png', fullPage: true });
  if (process.argv.includes('--change-request-demo')) {
    const prefix = 'CHANGE-' + Date.now().toString(36).toUpperCase();
    const source = prefix + '-LINE';
    await page.setViewportSize({ width: 1505, height: 1045 });
    await page.locator('#payload').fill(
      JSON.stringify(
        [450, 501].map((quantity) => ({
          source_id: source,
          event_id: prefix + '-' + quantity,
          type: 'COUNT',
          quantity,
          event_time: new Date().toISOString(),
        })),
        null,
        2,
      ),
    );
    await page.locator('#submit').click();
    await expect(page.locator('#submit-results')).toContainText('REJECTED');
    await page.locator('#source').fill(source);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.locator('[data-metric="net_total"]')).toHaveText('450');
    await expect(page.locator('[data-metric="rejected_submissions"]')).toHaveText('1');
    await page.screenshot({ path: 'docs/screenshots/change-request-desktop.png', fullPage: true });
    await page.getByRole('tab', { name: 'Exceptions' }).click();
    await expect(page.locator('#table-body')).toContainText(prefix + '-501');
    await page.screenshot({
      path: 'docs/screenshots/change-request-exceptions.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'docs/screenshots/change-request-mobile.png', fullPage: true });
  }
  console.log(
    JSON.stringify({
      title: await page.title(),
      url: page.url(),
      pageErrors: errors,
      consoleErrors,
      mobileOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    }),
  );
  await browser.close();
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
