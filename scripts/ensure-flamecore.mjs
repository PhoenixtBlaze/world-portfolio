import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FLAMECORE_REPO = 'https://github.com/PhoenixtBlaze/FlameCore.git';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(projectRoot, 'vendor', 'FlameCore');
const vendorMarker = path.join(vendorDir, 'src', 'runtime', 'runtime.ts');
const siblingMarker = path.resolve(projectRoot, '..', '..', 'FlameCore', 'src', 'runtime', 'runtime.ts');

function hasFlameCore(markerPath) {
  return existsSync(markerPath);
}

function cloneFlameCore() {
  const token = process.env.FLAMECORE_PAT?.trim();
  if (!token) {
    return false;
  }

  mkdirSync(path.join(projectRoot, 'vendor'), { recursive: true });
  const cloneUrl = `https://x-access-token:${token}@github.com/PhoenixtBlaze/FlameCore.git`;
  console.log('[ensure-flamecore] Cloning private FlameCore into vendor/FlameCore …');

  const result = spawnSync(
    'git',
    ['clone', '--depth', '1', cloneUrl, vendorDir],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );

  return result.status === 0 && hasFlameCore(vendorMarker);
}

if (hasFlameCore(vendorMarker)) {
  process.exit(0);
}

if (hasFlameCore(siblingMarker)) {
  console.log('[ensure-flamecore] Using sibling FlameCore at ../../FlameCore');
  process.exit(0);
}

if (cloneFlameCore()) {
  process.exit(0);
}

console.error('[ensure-flamecore] FlameCore is required but not available.');
console.error('  Local dev: clone FlameCore as a sibling at ../../FlameCore');
console.error('  Or set FLAMECORE_PAT and re-run npm install to clone into vendor/FlameCore');
console.error('  CI: add repository secret FLAMECORE_PAT (read access to PhoenixtBlaze/FlameCore)');
process.exit(1);
