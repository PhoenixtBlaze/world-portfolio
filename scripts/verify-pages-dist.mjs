import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const forbidden = ['.ts', '.tsx', '.map'];
const leaks = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'vendor' || entry.name === 'FlameCore') {
        leaks.push(fullPath);
      }
      walk(fullPath);
      continue;
    }

    if (forbidden.some((ext) => entry.name.endsWith(ext))) {
      leaks.push(fullPath);
      continue;
    }

    if (entry.name.endsWith('.js') || entry.name.endsWith('.html')) {
      const text = readFileSync(fullPath, 'utf8');
      if (
        text.includes('vendor/FlameCore') ||
        text.includes('FlameCore/src/') ||
        text.includes('sourceMappingURL')
      ) {
        leaks.push(fullPath);
      }
    }
  }
}

walk(distDir);

if (leaks.length > 0) {
  console.error('[verify-pages-dist] FlameCore source must not be deployed. Found:');
  for (const file of leaks) {
    console.error(`  - ${path.relative(distDir, file)}`);
  }
  process.exit(1);
}

console.log('[verify-pages-dist] dist/ is free of FlameCore source artifacts.');
