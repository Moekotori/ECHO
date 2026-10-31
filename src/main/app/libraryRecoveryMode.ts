export const libraryRecoveryModeArg = '--echo-library-recovery-mode';

export const isLibraryRecoveryMode = (argv: readonly string[] = process.argv): boolean =>
  argv.includes(libraryRecoveryModeArg);

export const createLibraryRecoveryRelaunchArgs = (argv: readonly string[] = process.argv): string[] => [
  ...argv.slice(1).filter((arg) => arg !== libraryRecoveryModeArg),
  libraryRecoveryModeArg,
];
