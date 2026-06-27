import { execSync } from 'node:child_process';

const blockedPatterns = [
  /^vendor\//,
  /\/FlameCore\//,
  /^restore-points\//,
  /^downloads\//,
  /^Blender Assets\//,
  /^Blender Files\//,
  /^scripts\/blender\//,
  /^scripts\/\.glb-originals\//,
  /^PLAN\.md$/,
  /^showcase\.html$/,
  /^tile-layout\.html$/,
  /^src\/showcase\.ts$/,
  /^src\/tile-layout\.ts$/,
];

const tracked = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const blocked = tracked.filter((path) => blockedPatterns.some((pattern) => pattern.test(path)));

if (blocked.length > 0) {
  console.error('[verify-repo-contents] Proprietary or dev-only paths must not be committed:');
  for (const path of blocked) {
    console.error(`  - ${path}`);
  }
  process.exit(1);
}

console.log(`[verify-repo-contents] OK (${tracked.length} tracked files, no proprietary source paths).`);
