import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const vendorFlame = path.join(rootDir, 'vendor', 'FlameCore');
const siblingFlame = path.resolve(rootDir, '..', '..', 'FlameCore');
const flameRoot = existsSync(path.join(vendorFlame, 'src', 'runtime')) ? vendorFlame : siblingFlame;

/** Vite config for World Portfolio — FlameCore runtime from vendor or sibling repo. */
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/world-portfolio/' : '/',
  resolve: {
    alias: {
      '@runtime': path.join(flameRoot, 'src', 'runtime'),
      '@shared': path.join(flameRoot, 'src', 'shared'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5180,
    open: true,
  },
  build: {
    target: 'es2022',
    // Pages deploy must not ship FlameCore source maps or reconstructable TS.
    sourcemap: process.env.GITHUB_PAGES === 'true' ? false : true,
  },
  publicDir: 'public',
});
