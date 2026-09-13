import { expect, test } from '@playwright/test';
test('browser resizes and compresses a detailed screenshot within the upload budget', async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Exercises browser source module through local Vite');
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/screenshots/image.ts';
    const { optimizeScreenshot } = await import(/* @vite-ignore */ modulePath);
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1400;
    const context = canvas.getContext('2d')!; const data = context.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < data.data.length; i += 4) { data.data[i] = Math.random() * 255; data.data[i + 1] = Math.random() * 255; data.data[i + 2] = Math.random() * 255; data.data[i + 3] = 255; }
    context.putImageData(data, 0, 0);
    const source = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    const optimized = await optimizeScreenshot(new File([source], 'screenshot.png', { type: source.type }));
    const decoded = await createImageBitmap(new Blob([optimized.bytes], { type: optimized.contentType }));
    const value = { bytes: optimized.bytes.length, width: optimized.width, height: optimized.height, decodedWidth: decoded.width, decodedHeight: decoded.height, original: source.size, contentType: optimized.contentType };
    decoded.close(); return value;
  });
  expect(result.bytes).toBeLessThanOrEqual(48 * 1024); expect(result.bytes).toBeLessThan(result.original);
  expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(960);
  expect(result.width / result.height).toBeCloseTo(2400 / 1400, 1);
  expect(result.decodedWidth).toBe(result.width); expect(result.decodedHeight).toBe(result.height);
  expect(['image/webp', 'image/jpeg']).toContain(result.contentType);
});
