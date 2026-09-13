import { expect, test } from '@playwright/test';
test('a real demo load is shared with a separate visitor and its receipt can be retried', async ({ page, browser, baseURL }) => {
  test.skip(process.env.PUDGE_LIVE !== '1' || !process.env.E2E_BASE_URL, 'Requires hosted counters and the Pudge catalog');
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByRole('option', { name: /orbit-study/ }).click({ timeout: 90_000 });
  const recorded = page.waitForResponse(response => response.url().endsWith('/api/plays') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /PLAY THIS DEMO/ }).click();
  const receipt = await recorded;
  expect(receipt.status()).toBe(200);
  const value = await receipt.json();
  expect(value.plays).toBeGreaterThan(0);
  const payload = receipt.request().postDataJSON();
  // Replay the same receipt, not a synthetic play.
  const retry = await page.request.post('/api/plays', { headers: { Origin: new URL(baseURL!).origin }, data: payload });
  expect(retry.status()).toBe(200);
  const next = await retry.json();
  expect(next.plays).toBeGreaterThanOrEqual(value.plays); // Other visitors may play concurrently.
  const visitor = await browser.newContext({ baseURL });
  try {
    const other = await visitor.newPage();
    await other.goto('/');
    await other.getByRole('option', { name: /orbit-study/ }).click({ timeout: 90_000 });
    await expect.poll(async () => Number((await other.getByLabel('Shared play count').innerText()).replace(/[^0-9]/g, ''))).toBeGreaterThanOrEqual(value.plays);
  } finally { await visitor.close(); }
});
