import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { sharePages } from './src/music/share';
import type { Library } from './src/music/catalog';
// Serve the SAME isolated sandbox CSP locally; the rest of the app retains its normal Vite dev policy.
const sandboxCsp = readFileSync('public/_headers', 'utf8').split('/sandbox.html')[1].match(/Content-Security-Policy: (.+)/)![1];
function sandboxHeaders(server: { middlewares: { use: (handler: (req: { url?: string }, res: { setHeader: (name: string, value: string) => void }, next: () => void) => void) => void } }) {
  server.middlewares.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', req.url?.split('?')[0] === '/sandbox.html' ? sandboxCsp : "frame-src 'self'; object-src 'none'; base-uri 'self'"); next();
  });
}
// One static page per track so that a shared link shows the song's title and cover (see src/music/share.ts).
const shareLinkPages = {
  name: 'share-link-pages',
  generateBundle(this: { emitFile: (file: { type: 'asset'; fileName: string; source: string }) => unknown }) {
    const library = JSON.parse(readFileSync('public/music/library.json', 'utf8')) as Library;
    for (const page of sharePages(library)) this.emitFile({ type: 'asset', ...page });
  },
};
export default defineConfig({ plugins: [react(), shareLinkPages, { name: 'isolated-sandbox-headers', configureServer: sandboxHeaders, configurePreviewServer: sandboxHeaders }], test: { include: ['tests/**/*.test.ts'] } });
