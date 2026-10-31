import { opendir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

/** Only inspect ancestor directory names; never read audio or collect the folder's files. */
export const hasNearbySidecarCue = async (
  rootPath: string, paths: readonly string[], isEligible: (path: string) => boolean,
  isCurrent: () => boolean = () => true,
): Promise<boolean> => {
  const root = resolve(rootPath);
  const checked = new Set<string>();
  for (const path of paths) {
    if (!isCurrent()) return false;
    if (!isEligible(path)) continue;
    if (extname(path).toLowerCase() === '.cue') return true;
    for (let parent = dirname(resolve(path)); ; parent = dirname(parent)) {
      if (!isCurrent()) return false;
      if (!checked.has(parent)) {
        // Keep the optional probe memo bounded even for deep, unrelated paths.
        if (checked.size >= 64) checked.delete(checked.values().next().value!);
        checked.add(parent);
        try {
          for await (const entry of await opendir(parent, { bufferSize: 32 })) {
            if (!isCurrent()) return false;
            if (entry.isFile() && extname(entry.name).toLowerCase() === '.cue' && isEligible(join(parent, entry.name))) return true;
          }
        } catch (error) {
          if (!isCurrent()) return false;
          if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return true;
        }
      }
      if (parent === root || dirname(parent) === parent) break;
    }
  }
  return false;
};
