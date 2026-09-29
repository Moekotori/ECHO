import { getLibraryService } from '../library/LibraryService';

/** Warm the existing community reader while the replacement renderer boots. */
export const warmMainProcessForRendererRestore = async () => {
  const startedAt = Date.now();
  let libraryReaderWarmed = false;
  try {
    getLibraryService();
    libraryReaderWarmed = true;
  } catch {
    // Normal renderer requests retain their existing error and retry paths.
  }
  return { durationMs: Date.now() - startedAt, libraryReaderWarmed, databaseMemoryRestored: false };
};
