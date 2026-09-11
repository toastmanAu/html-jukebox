import { expect, test } from '@playwright/test';
test('cold proof screen is functional and signing is gated', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Prove the storage/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare & estimate' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Resolve & verify' })).toBeDisabled();
  await expect(page.getByText('No registry configured yet', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign & broadcast on Pudge' })).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('RPC failure remains actionable and never enables publishing', async ({ page }) => {
  await page.route('https://testnet.ckb.dev/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: 0, error: { code: -32603, message: 'PUDGE_RPC_UNAVAILABLE: test outage' } }) }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Verify Pudge deployment' }).click();
  await expect(page.getByRole('alert')).toContainText('PUDGE_RPC_UNAVAILABLE', { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Prepare & estimate' })).toBeDisabled();
});
test('proof selector and wallet dialog can be used without a signer', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Proof transaction').selectOption('append-1');
  await expect(page.getByLabel('Proof transaction')).toHaveValue('append-1');
  await page.getByRole('button', { name: 'Connect JoyID' }).click();
  await expect(page.getByText('JoyID Passkey', { exact: false })).toBeVisible({ timeout: 15000 });
});
test('diagnostic never creates an execution surface for arbitrary HTML', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('CKBFS Type ID or explicit outpoint').fill('<script>document.body.innerHTML="bad"</script>');
  await expect(page.getByRole('heading', { name: /Prove the storage/ })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});
test('live Pudge preflight and independent browser resolution', async ({ page }) => {
  test.skip(process.env.PUDGE_LIVE !== '1', 'Opt-in live RPC read test; does not publish or sign.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Verify Pudge deployment' }).click();
  await expect(page.getByText('✓ V3 + Adler32 verified')).toBeVisible({ timeout: 30000 });
  await page.getByLabel('CKBFS Type ID or explicit outpoint').fill('0xfe7f2f74a269a13eb7be5302fd28ce1ac117fff19e7dc5bf335318aa9a776732');
  await page.getByRole('button', { name: 'Resolve & verify' }).click();
  await expect(page.getByText('rfc-0017-tx-valid-since.md', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('10,495 bytes · 1 witnesses · 1 transactions')).toBeVisible();
});
