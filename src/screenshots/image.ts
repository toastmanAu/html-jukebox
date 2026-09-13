import { invariant } from '../ckbfs/errors';
export const SCREENSHOT_MAX_BYTES = 48 * 1024;
export const SCREENSHOT_MAX_EDGE = 960;
export type ScreenshotMime = 'image/webp' | 'image/jpeg' | 'image/png';
export interface OptimizedScreenshot { filename: string; bytes: Uint8Array; contentType: ScreenshotMime; width: number; height: number; originalBytes: number }
export function imageMime(bytes: Uint8Array): ScreenshotMime | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) return 'image/png';
  const text = new TextDecoder('ascii');
  if (text.decode(bytes.slice(0, 4)) === 'RIFF' && text.decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
}
export function validateScreenshot(bytes: Uint8Array, contentType: string) {
  invariant(bytes.length > 0 && bytes.length <= SCREENSHOT_MAX_BYTES, 'SCREENSHOT_SIZE', 'Screenshot must be optimized to at most 48 KiB.');
  invariant(['image/webp', 'image/jpeg', 'image/png'].includes(contentType) && imageMime(bytes) === contentType, 'SCREENSHOT_FORMAT', 'Screenshot bytes do not match an approved PNG, JPEG or WebP format.');
}
/** Re-encode raster pixels locally; strip source metadata and never execute SVG/HTML. */
export async function optimizeScreenshot(file: File): Promise<OptimizedScreenshot> {
  invariant(file.size > 0 && file.size <= 20 * 1024 * 1024, 'SCREENSHOT_SIZE', 'Choose a PNG, JPEG or WebP screenshot up to 20 MiB.');
  invariant(imageMime(new Uint8Array(await file.slice(0, 16).arrayBuffer())), 'SCREENSHOT_FORMAT', 'Choose a PNG, JPEG or WebP image; SVG and animated GIF are not supported.');
  invariant(typeof createImageBitmap === 'function', 'UNSUPPORTED_CONTEXT', 'This browser does not support screenshot decoding. Use a current browser.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => { throw new Error('SCREENSHOT_DECODE: The image could not be decoded. Export it as PNG or JPEG.'); });
  const canvas = document.createElement('canvas');
  try {
    invariant(bitmap.width > 0 && bitmap.height > 0 && bitmap.width * bitmap.height <= 40_000_000, 'SCREENSHOT_DIMENSIONS', 'Choose an image with at most 40 million pixels.');
    const scale = Math.min(1, SCREENSHOT_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    let width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    for (let step = 0; step < 12; step++) {
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      invariant(context, 'UNSUPPORTED_CONTEXT', 'Canvas image processing is unavailable.');
      context.fillStyle = '#151b18'; context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.86, 0.72, 0.58, 0.44, 0.3]) {
        let blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob?.type !== 'image/webp') blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        invariant(blob, 'SCREENSHOT_ENCODE', 'The browser could not encode the screenshot.');
        if (blob.size <= SCREENSHOT_MAX_BYTES) {
          const bytes = new Uint8Array(await blob.arrayBuffer()); const contentType = imageMime(bytes)!; validateScreenshot(bytes, contentType);
          return { filename: `screenshot.${contentType === 'image/webp' ? 'webp' : contentType === 'image/jpeg' ? 'jpg' : 'png'}`, contentType, bytes, width, height, originalBytes: file.size };
        }
      }
      width = Math.max(1, Math.floor(width * 0.8)); height = Math.max(1, Math.floor(height * 0.8));
    }
    throw new Error('SCREENSHOT_SIZE: Could not fit this screenshot into 48 KiB. Choose a simpler or smaller image.');
  } finally { bitmap.close(); canvas.width = canvas.height = 1; }
}
