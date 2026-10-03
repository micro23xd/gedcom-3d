/**
 * Builds into dist/ with relative asset paths, so the bundle can be served
 * from any directory, next to the GEDCOM it is pointed at with `?ged=`.
 *
 * public/ holds only the invented demo tree. Nothing else is copied into the
 * bundle: a real tree is fetched at runtime from the same server, or read
 * from disk in the browser.
 *
 * The dev server binds to 127.0.0.1. To try it on a tree of your own, name the
 * directories it may serve, relative to a root:
 *
 *   GEDCOM3D_ROOT=~/my-tree GEDCOM3D_SERVE=data,media npm run dev
 *   → http://127.0.0.1:5173/?ged=/data/tree.ged
 */

import {createReadStream, existsSync, statSync} from 'node:fs';
import {extname, resolve} from 'node:path';
import {defineConfig, type Plugin} from 'vite';

const TYPES: Record<string, string> = {
  '.ged': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

function serveTreeFiles(): Plugin {
  const root = process.env.GEDCOM3D_ROOT ? resolve(process.env.GEDCOM3D_ROOT) : '';
  const dirs = (process.env.GEDCOM3D_SERVE ?? '').split(',').map((d) => d.trim()).filter(Boolean);
  return {
    name: 'serve-tree-files',
    apply: 'serve',
    configureServer(server) {
      if (!root || !dirs.length) return;
      const allowed = dirs.map((d) => resolve(root, d) + '/');
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]);
        const file = resolve(root, '.' + path);
        if (!allowed.some((a) => file.startsWith(a)) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serveTreeFiles()],
  server: {host: '127.0.0.1', port: 5173, strictPort: false},
  preview: {host: '127.0.0.1'},
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['test/**/*.spec.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
