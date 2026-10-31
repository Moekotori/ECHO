import type { LibrarySort } from '../../shared/types/library';
import { toggleSongMultiSort } from './songSortSelection';

const songsSortPreferenceStorageKey = 'echo-next.songs.sort-preference';

export type SongSortPreference = {
  isMultiSortEnabled: boolean;
  selectedSorts: LibrarySort[];
};

const normalizeSongSortValue = (value: LibrarySort): LibrarySort => value === 'frequent' ? 'playCountDesc' : value;

export const readStoredSongSortPreference = (
  fallbackSort: LibrarySort,
  validSortValues: ReadonlySet<LibrarySort>,
): SongSortPreference => {
  const fallbackPreference = {
    isMultiSortEnabled: false,
    selectedSorts: [fallbackSort],
  };

  try {
    const stored = window.localStorage.getItem(songsSortPreferenceStorageKey);
    if (!stored) {
      return fallbackPreference;
    }

    const parsed = JSON.parse(stored) as { isMultiSortEnabled?: unknown; selectedSorts?: unknown };
    if (!Array.isArray(parsed.selectedSorts)) {
      return fallbackPreference;
    }

    const normalizedSorts = parsed.selectedSorts.reduce<LibrarySort[]>((current, value) => {
      if (typeof value !== 'string') {
        return current;
      }

      const normalized = normalizeSongSortValue(value as LibrarySort);
      if (!validSortValues.has(normalized) || current.includes(normalized)) {
        return current;
      }

      return toggleSongMultiSort(current, normalized);
    }, []);

    if (normalizedSorts.length === 0) {
      return fallbackPreference;
    }

    return {
      isMultiSortEnabled: parsed.isMultiSortEnabled === true,
      selectedSorts: normalizedSorts,
    };
  } catch {
    return fallbackPreference;
  }
};

export const writeStoredSongSortPreference = (preference: SongSortPreference): void => {
  try {
    window.localStorage.setItem(songsSortPreferenceStorageKey, JSON.stringify(preference));
  } catch {
    // Sort preference memory should not block the song list in restricted storage environments.
  }
};
