import type { z } from 'zod';
import { capabilitiesSchema } from '../registry/manifest';
export type DemoCapabilities = z.infer<typeof capabilitiesSchema>;
export const DEFAULT_CAPABILITIES: DemoCapabilities = { network: false, audio: false, fullscreen: true, pointerLock: false, geolocation: false, clipboard: false };
export function iframePolicy(capabilities: DemoCapabilities) {
  const caps = capabilitiesSchema.parse(capabilities);
  const external = caps.network ? ' https:' : '';
  const csp = ["default-src 'none'", `script-src 'unsafe-inline' 'unsafe-eval' blob:${external}`, `style-src 'unsafe-inline'${external}`,
    `img-src data: blob:${external}`, `font-src data: blob:${external}`, `connect-src ${caps.network ? 'https: wss:' : "'none'"}`,
    `media-src ${caps.audio ? `data: blob:${external}` : "'none'"}`, "worker-src blob:", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
  return {
    sandbox: ['allow-scripts', ...(caps.pointerLock ? ['allow-pointer-lock'] : [])].join(' '),
    // Fullscreen belongs to the host wrapper so a demo cannot fullscreen away the toolbar.
    allow: [`autoplay ${caps.audio ? '*' : "'none'"}`, "fullscreen 'none'", `geolocation ${caps.geolocation ? '*' : "'none'"}`, `clipboard-read ${caps.clipboard ? '*' : "'none'"}`, `clipboard-write ${caps.clipboard ? '*' : "'none'"}`, "camera 'none'", "microphone 'none'", "payment 'none'", "usb 'none'", "serial 'none'", "display-capture 'none'"].join('; '),
    csp,
  };
}
export function sandboxDocument(bytes: Uint8Array, capabilities: DemoCapabilities): string {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const { csp } = iframePolicy(capabilities);
  // Both local preview and production use this identical envelope around the exact verified source.
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp.replaceAll('"', '&quot;')}">${source}`;
}
