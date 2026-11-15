import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(here, '..', '..', '..');

export function testDataPath(...parts) {
  const base = process.env.C64_TEST_DATA || join(PROJECT_ROOT, 'test-data');
  return join(base, ...parts);
}

export function romPath(name) {
  const base = process.env.C64_ROM_DIR || join(PROJECT_ROOT, 'rom');
  return join(base, name);
}
