import { isAbsolute, relative, resolve, sep } from 'node:path';

export const scanCueFileIssueCodes = ['source_missing', 'source_denied', 'source_unreadable', 'source_limit', 'source_timeout'] as const;
export type ScanCueFileIssue = typeof scanCueFileIssueCodes[number];
export const isScanCueFileIssue = (value: unknown): value is ScanCueFileIssue =>
  typeof value === 'string' && (scanCueFileIssueCodes as readonly string[]).includes(value);

export const isCueSourceInsideRoot = (path: string, root: string | undefined): boolean => {
  if (!root) return true;
  const child = relative(resolve(root), resolve(path));
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};
