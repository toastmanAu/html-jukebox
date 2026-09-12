import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
// Serve the SAME isolated sandbox CSP locally; the rest of the app retains its normal Vite dev policy.
const sandboxCsp = readFileSync('public/_headers', 'utf8').split('/sandbox.html')[1].match(/Content-Security-Policy: (.+)/)![1];
function sandboxHeaders(server: { middlewares: { use: (handler: (req: { url?: string }, res: { setHeader: (name: string, value: string) => void }, next: () => void) => void) => void } }) {
  server.middlewares.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', req.url?.split('?')[0] === '/sandbox.html' ? sandboxCsp : "frame-src 'self'; object-src 'none'; base-uri 'self'"); next();
  });
}
export default defineConfig({ plugins: [react(), { name: 'isolated-sandbox-headers', configureServer: sandboxHeaders, configurePreviewServer: sandboxHeaders }], test: { include: ['tests/**/*.test.ts'] } });
