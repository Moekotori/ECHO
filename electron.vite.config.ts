import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          libraryScanWorkerHost: resolve(__dirname, 'src/main/library/workers/LibraryScanWorkerHost.ts'),
        },
        output: {
          footer: '\nimport "node:module";\n',
        },
        onLog(level, log, handler) {
          if (
            level === 'warn' &&
            log.message.includes('dynamic import will not move module into another chunk')
          ) {
            return;
          }
          handler(level, log);
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          devConsole: resolve(__dirname, 'src/preload/devConsole.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
  },
});
