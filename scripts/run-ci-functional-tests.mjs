import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');

export const CI_FUNCTIONAL_TEST_GROUPS = Object.freeze({
  'identity-and-runtime': [
    'src/main/accounts/NeteaseQrLoginService.test.ts',
    'src/main/accounts/SpotifyAuthService.test.ts',
    'src/main/accounts/TidalAuthService.test.ts',
    'src/main/app/appSettings.test.ts',
    'src/main/app/autoUpdater.test.ts',
    'src/main/app/RuntimeComponentService.test.ts',
    'src/main/app/securityPolicy.test.ts',
  ],
  'audio-and-playback': [
    'src/main/audio/AudioBackendContract.test.ts',
    'src/main/audio/AudioEntitlementRuntime.test.ts',
    'src/main/audio/BackendLifecycle.test.ts',
    'src/main/audio/DaemonAudioBackend.test.ts',
    'src/main/audio/DaemonHostProcess.test.ts',
    'src/main/audio/DspStateSync.test.ts',
    'src/main/audio/JsonRpcBridge.test.ts',
    'src/main/audio/OutputFallbackPolicy.test.ts',
    'src/renderer/components/player/PlaybackCommandController.integration.test.tsx',
    'src/renderer/components/player/PlaybackQueueDrawer.test.tsx',
    'src/renderer/components/player/PlayerTransport.test.tsx',
    'src/renderer/stores/PlaybackQueueProvider.test.tsx',
  ],
  'library-and-connectivity': [
    'src/main/connect/AirPlayRtpReorderBuffer.test.ts',
    'src/main/connect/ConnectHttpServer.test.ts',
    'src/main/downloads/DownloadService.test.ts',
    'src/main/library/LibraryWatcherService.test.ts',
    'src/main/library/SearchIndexTokens.test.ts',
    'src/main/library/TrackFileDeletion.test.ts',
    'src/main/network/networkFetch.test.ts',
    'src/main/network/proxySettings.test.ts',
    'src/main/qobuz/QobuzDownloadService.test.ts',
    'src/main/streaming/StreamingMemoryCache.test.ts',
  ],
  integrations: [
    'src/main/integrations/core/IntegrationActionRouter.test.ts',
    'src/main/integrations/core/IntegrationEventHub.test.ts',
    'src/main/integrations/smtc/SmtcStatusSync.lifecycle.test.ts',
    'src/main/integrations/smtc/SmtcStatusSync.queue.test.ts',
    'src/main/plugins/LocalProEntitlements.test.ts',
    'src/main/plugins/PluginService.test.ts',
  ],
  'lyrics-and-mv': [
    'src/main/lyrics/LyricsMatchEngine.test.ts',
    'src/main/lyrics/lyricsParser.test.ts',
    'src/main/mv/MvScoring.test.ts',
    'src/renderer/components/lyrics/LyricsView.test.tsx',
    'src/renderer/components/lyrics/MvPanel.test.tsx',
  ],
  'ipc-and-preload': [
    'src/main/ipc/ipcRoundtrip.test.ts',
    'src/preload/echoApiShape.test.ts',
    'src/preload/index.test.ts',
    'src/preload/ipc-modules.test.ts',
  ],
  'renderer-shell': [
    'src/renderer/app/routes.test.tsx',
    'src/renderer/components/onboarding/FirstRunWizard.test.tsx',
    'src/renderer/pages/HomePage.test.tsx',
    'src/renderer/styles/mainWindowStyles.test.ts',
  ],
  shared: [
    'src/shared/constants/audioExtensions.test.ts',
    'src/shared/constants/featureUnlocks.test.ts',
    'src/shared/utils/audioChannels.test.ts',
    'src/shared/utils/performancePolicy.test.ts',
    'src/shared/utils/replayGain.test.ts',
    'src/shared/utils/sanitizeAccountData.test.ts',
  ],
  'ci-tooling': [
    'scripts/run-ci-functional-tests.test.mjs',
  ],
});

export const getCiFunctionalTestFiles = () =>
  Object.values(CI_FUNCTIONAL_TEST_GROUPS).flat();

export const CI_SERIAL_TEST_FILES = Object.freeze([
  'src/main/downloads/DownloadService.test.ts',
  'src/renderer/components/lyrics/MvPanel.test.tsx',
]);

const runVitest = (testFiles, forwardedArgs, workerArgs) => {
  const vitestCli = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
  return spawnSync(
    process.execPath,
    [vitestCli, 'run', ...testFiles, ...forwardedArgs, ...workerArgs],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    },
  );
};

const run = () => {
  const testFiles = getCiFunctionalTestFiles();
  const missing = testFiles.filter((filePath) => !existsSync(join(projectRoot, filePath)));
  if (missing.length > 0) {
    console.error(`[test:ci:functional] Missing test files:\n${missing.map((file) => `- ${file}`).join('\n')}`);
    process.exit(1);
  }

  for (const [group, files] of Object.entries(CI_FUNCTIONAL_TEST_GROUPS)) {
    console.log(`[test:ci:functional] ${group}: ${files.length} files`);
  }

  const forwardedArgs = process.argv.slice(2);
  const parallelFiles = testFiles.filter((file) => !CI_SERIAL_TEST_FILES.includes(file));
  const parallelWorkerArgs = forwardedArgs.some((arg) => arg.startsWith('--maxWorkers'))
    ? []
    : ['--maxWorkers=4'];
  const stages = [
    { label: 'parallel', files: parallelFiles, workers: parallelWorkerArgs },
    { label: 'serial', files: CI_SERIAL_TEST_FILES, workers: ['--maxWorkers=1'] },
  ];

  for (const stage of stages) {
    console.log(`[test:ci:functional] ${stage.label} stage: ${stage.files.length} files`);
    const result = runVitest(stage.files, forwardedArgs, stage.workers);
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
};

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  run();
}
