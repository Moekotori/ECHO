import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CI_FUNCTIONAL_TEST_GROUPS,
  CI_SERIAL_TEST_FILES,
  getCiFunctionalTestFiles,
} from './run-ci-functional-tests.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');

describe('CI functional regression manifest', () => {
  it('covers every declared product area with at least one test', () => {
    expect(Object.keys(CI_FUNCTIONAL_TEST_GROUPS)).toEqual([
      'identity-and-runtime',
      'audio-and-playback',
      'library-and-connectivity',
      'integrations',
      'lyrics-and-mv',
      'ipc-and-preload',
      'renderer-shell',
      'shared',
      'ci-tooling',
    ]);
    expect(Object.values(CI_FUNCTIONAL_TEST_GROUPS).every((files) => files.length > 0)).toBe(true);
  });

  it('contains only unique, repository-backed test files', () => {
    const files = getCiFunctionalTestFiles();
    expect(new Set(files).size).toBe(files.length);
    expect(files.every((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file))).toBe(true);
    expect(files.every((file) => existsSync(join(projectRoot, file)))).toBe(true);
  });

  it('does not make live-network tests part of the deterministic gate', () => {
    expect(getCiFunctionalTestFiles().some((file) => file.includes('.live.test.'))).toBe(false);
  });

  it('keeps timing-sensitive suites in the manifest but runs them serially', () => {
    expect(CI_SERIAL_TEST_FILES).toEqual([
      'src/main/downloads/DownloadService.test.ts',
      'src/renderer/components/lyrics/MvPanel.test.tsx',
    ]);
    expect(CI_SERIAL_TEST_FILES.every((file) => getCiFunctionalTestFiles().includes(file))).toBe(true);
  });
});
