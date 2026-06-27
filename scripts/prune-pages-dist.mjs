import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/** Remove source maps and sourceMappingURL comments from the Pages deploy bundle. */
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (entry.name.endsWith('.map')) {
      unlinkSync(fullPath);
      continue;
    }

    if (entry.name.endsWith('.js')) {
      const text = readFileSync(fullPath, 'utf8');
      const stripped = text.replace(/\n?\/\/# sourceMappingURL=.*$/gm, '');
      if (stripped !== text) {
        writeFileSync(fullPath, stripped);
      }
    }
  }
}

walk(distDir);
console.log('[prune-pages-dist] Removed source maps from dist/');
