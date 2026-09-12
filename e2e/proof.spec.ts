import { expect, test } from '@playwright/test';
test('service deep link exposes only the JoyID authorization gate', async ({ page }) => {
  await page.goto('/#service');
  await expect(page.getByRole('heading',{name:'Service panel.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Connect JoyID'})).toBeVisible();
  await expect(page.getByLabel('Single-file HTML')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Registry and manifest setup'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Prepare & estimate'})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('JoyID login is available from the locked service gate',async({page})=>{
  await page.goto('/#service');await page.getByRole('button',{name:'Connect JoyID'}).click();
  await expect(page.getByText('JoyID Passkey',{exact:false})).toBeVisible({timeout:15000});
});
