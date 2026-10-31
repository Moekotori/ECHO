const compareLibraryText = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
import type { LibrarySort, LibraryTrack } from '../../shared/types/library';

const compareMissingLastNumber = (
  left: number | null | undefined,
  right: number | null | undefined,
  direction: 1 | -1,
): number => {
  const leftMissing = left == null || left <= 0;
  const rightMissing = right == null || right <= 0;
  if (leftMissing !== rightMissing) {
    return Number(leftMissing) - Number(rightMissing);
  }
  return direction * ((left ?? 0) - (right ?? 0));
};

export const sortRemotePreviewTracks = (tracks: LibraryTrack[], sort: LibrarySort): LibraryTrack[] => {
  if (tracks.length < 2) {
    return tracks;
  }

  if (sort === 'random') {
    const shuffled = [...tracks];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return shuffled;
  }

  return [...tracks].sort((left, right) => {
    switch (sort) {
      case 'artist':
        return compareLibraryText(left.artist, right.artist) || compareLibraryText(left.title, right.title);
      case 'artistDesc':
        return compareLibraryText(right.artist, left.artist) || compareLibraryText(left.title, right.title);
      case 'artistAlbum':
        return compareLibraryText(left.artist, right.artist)
          || compareLibraryText(left.album, right.album)
          || (left.discNo ?? 0) - (right.discNo ?? 0)
          || (left.trackNo ?? 999999) - (right.trackNo ?? 999999)
          || compareLibraryText(left.title, right.title);
      case 'album':
        return compareLibraryText(left.album, right.album)
          || (left.discNo ?? 0) - (right.discNo ?? 0)
          || (left.trackNo ?? 999999) - (right.trackNo ?? 999999)
          || compareLibraryText(left.title, right.title);
      case 'albumDesc':
        return compareLibraryText(right.album, left.album)
          || (left.discNo ?? 0) - (right.discNo ?? 0)
          || (left.trackNo ?? 999999) - (right.trackNo ?? 999999)
          || compareLibraryText(left.title, right.title);
      case 'trackNumber':
        return Number(left.trackNo == null) - Number(right.trackNo == null)
          || (left.discNo ?? 1) - (right.discNo ?? 1)
          || (left.trackNo ?? 0) - (right.trackNo ?? 0)
          || compareLibraryText(left.title, right.title)
          || compareLibraryText(left.path, right.path);
      case 'yearAsc':
      case 'yearDesc':
        return Number(left.year == null) - Number(right.year == null)
          || (sort === 'yearDesc' ? -1 : 1) * ((left.year ?? 0) - (right.year ?? 0))
          || compareLibraryText(left.title, right.title);
      case 'qualityDesc':
        return (right.bitrate ?? 0) - (left.bitrate ?? 0) || compareLibraryText(left.title, right.title);
      case 'codecAsc':
      case 'codecDesc':
        return (sort === 'codecDesc' ? -1 : 1) * compareLibraryText(left.codec ?? '', right.codec ?? '')
          || compareLibraryText(left.title, right.title);
      case 'audioSpecAsc':
      case 'audioSpecDesc': {
        const direction = sort === 'audioSpecDesc' ? -1 : 1;
        return compareMissingLastNumber(left.sampleRate, right.sampleRate, direction)
          || compareMissingLastNumber(left.bitDepth, right.bitDepth, direction)
          || compareLibraryText(left.title, right.title);
      }
      case 'bitrateAsc':
      case 'bitrateDesc':
      case 'qualityAsc':
        return (sort === 'bitrateDesc' ? -1 : 1) * ((left.bitrate ?? 0) - (right.bitrate ?? 0))
          || compareLibraryText(left.title, right.title);
      case 'bpmAsc':
      case 'bpmDesc':
        return compareMissingLastNumber(left.bpm, right.bpm, sort === 'bpmDesc' ? -1 : 1)
          || compareLibraryText(left.title, right.title);
      case 'durationAsc':
      case 'durationDesc':
        return (sort === 'durationDesc' ? -1 : 1) * ((left.duration ?? 0) - (right.duration ?? 0))
          || compareLibraryText(left.title, right.title);
      case 'titleDesc':
        return compareLibraryText(right.title, left.title);
      default:
        return compareLibraryText(left.title, right.title);
    }
  });
};
