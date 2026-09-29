import { cpus } from 'node:os';
import { configDefaults, defineConfig } from 'vitest/config';

const maxWorkers = Math.max(2, Math.min(12, Math.floor(cpus().length / 2)));

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'out/**', '.codex-backups/**'],
    globalSetup: ['./scripts/vitest-global-setup.mjs'],
    maxWorkers,
  },
});
