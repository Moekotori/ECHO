import { globalShortcutActions, type GlobalShortcutAction } from '../../shared/types/globalShortcuts';

const ultraLightGpuRuntimeArg = '--echo-ultra-light-gpu-runtime';
const ultraLightGpuRuntimeEntryArgPrefix = '--echo-ultra-light-entry=';
const ultraLightRestoreActionArgPrefix = '--echo-ultra-light-restore-action=';
const ultraLightResumePlaybackArg = '--echo-ultra-light-resume-playback';

export type UltraLightGpuRuntimeEntryMode = 'manual' | 'tray-auto' | 'minimize-auto';

export type UltraLightNormalRuntimeHandoff = {
  pendingAction?: GlobalShortcutAction;
  resumePlayback?: boolean;
};

export type UltraLightGpuRuntimeHandoff = {
  resumePlayback?: boolean;
};

const isGlobalShortcutAction = (value: string): value is GlobalShortcutAction =>
  (globalShortcutActions as readonly string[]).includes(value);

const withoutUltraLightRuntimeArgs = (argv: readonly string[] = process.argv): string[] =>
  argv.slice(1).filter((arg) =>
    arg !== ultraLightGpuRuntimeArg &&
    arg !== ultraLightResumePlaybackArg &&
    !arg.startsWith(ultraLightGpuRuntimeEntryArgPrefix) &&
    !arg.startsWith(ultraLightRestoreActionArgPrefix),
  );

export const isUltraLightGpuRuntime = (argv: readonly string[] = process.argv): boolean =>
  argv.includes(ultraLightGpuRuntimeArg);

export const shouldInitializeFullMainControlPlane = (
  argv: readonly string[] = process.argv,
): boolean => !isUltraLightGpuRuntime(argv);

export const createUltraLightGpuRuntimeArgs = (
  argv: readonly string[] = process.argv,
  entryMode: UltraLightGpuRuntimeEntryMode = 'manual',
  handoff: UltraLightGpuRuntimeHandoff = {},
): string[] => [
  ...withoutUltraLightRuntimeArgs(argv),
  ultraLightGpuRuntimeArg,
  ...(entryMode === 'manual' ? [] : [`${ultraLightGpuRuntimeEntryArgPrefix}${entryMode}`]),
  ...(handoff.resumePlayback === true ? [ultraLightResumePlaybackArg] : []),
];

export const getUltraLightGpuRuntimeEntryMode = (
  argv: readonly string[] = process.argv,
): UltraLightGpuRuntimeEntryMode => {
  if (argv.includes(`${ultraLightGpuRuntimeEntryArgPrefix}minimize-auto`)) return 'minimize-auto';
  if (argv.includes(`${ultraLightGpuRuntimeEntryArgPrefix}tray-auto`)) return 'tray-auto';
  return 'manual';
};

export const getUltraLightGpuRuntimeResumePlayback = (
  argv: readonly string[] = process.argv,
): boolean => isUltraLightGpuRuntime(argv) && argv.includes(ultraLightResumePlaybackArg);

export const createNormalRuntimeArgs = (argv: readonly string[] = process.argv): string[] =>
  withoutUltraLightRuntimeArgs(argv);

export const prepareNormalRuntimeRelaunch = (
  argv: readonly string[] = process.argv,
  environment: NodeJS.ProcessEnv = process.env,
  handoff: UltraLightNormalRuntimeHandoff = {},
): string[] => {
  // electron-vite exits its renderer dev server when the original Electron
  // process closes. A relaunched process must therefore use the built renderer
  // instead of inheriting a URL that is about to disappear.
  delete environment.ELECTRON_RENDERER_URL;
  const args = createNormalRuntimeArgs(argv);
  if (handoff.pendingAction) {
    args.push(`${ultraLightRestoreActionArgPrefix}${handoff.pendingAction}`);
  }
  if (handoff.resumePlayback === true) {
    args.push(ultraLightResumePlaybackArg);
  }
  return args;
};

export const getUltraLightNormalRuntimeHandoff = (
  argv: readonly string[] = process.argv,
): UltraLightNormalRuntimeHandoff => {
  const rawAction = argv
    .find((arg) => arg.startsWith(ultraLightRestoreActionArgPrefix))
    ?.slice(ultraLightRestoreActionArgPrefix.length);
  return {
    pendingAction: rawAction && isGlobalShortcutAction(rawAction) ? rawAction : undefined,
    resumePlayback: argv.includes(ultraLightResumePlaybackArg),
  };
};
