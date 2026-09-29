import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { LibraryTrack } from '../../shared/types/library';
import type { MvMatchCandidate } from '../../shared/types/mv';
import { isBrowserPlayableVideo, isSupportedVideoExtension } from '../../shared/constants/videoExtensions';
import { scoreLocalMvCandidate } from './MvScoring';

const directVideoFolders = ['MV', 'mv', 'video', 'videos'];
const minimumCandidateScore = 0.2;

const fileHashId = (filePath: string): string => `local:${createHash('sha1').update(filePath).digest('hex')}`;

const safeReadVideoFiles = (folderPath: string): string[] => {
  if (!existsSync(folderPath)) {
    return [];
  }

  try {
    if (!statSync(folderPath).isDirectory()) {
      return [];
    }

    return readdirSync(folderPath)
      .map((entry) => join(folderPath, entry))
      .filter((entryPath) => {
        try {
          return statSync(entryPath).isFile() && isSupportedVideoExtension(entryPath);
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
};

const candidateFolders = (audioPath: string): string[] => {
  const songFolder = dirname(audioPath);
  const parentFolder = dirname(songFolder);
  const folders = [
    songFolder,
    ...directVideoFolders.map((folder) => join(songFolder, folder)),
    join(parentFolder, 'MV'),
    join(parentFolder, 'video'),
  ];

  return [...new Set(folders)];
};

const candidateTitle = (filePath: string): string => basename(filePath, extname(filePath));
const pathKey = (filePath: string): string => (process.platform === 'win32' ? resolve(filePath).toLocaleLowerCase() : resolve(filePath));

export class LocalMvProvider {
  searchCandidates(track: LibraryTrack): MvMatchCandidate[] {
    const seen = new Set<string>();
    const candidates: MvMatchCandidate[] = [];

    for (const folder of candidateFolders(track.path)) {
      for (const filePath of safeReadVideoFiles(folder)) {
        const seenKey = pathKey(filePath);
        if (seen.has(seenKey)) {
          continue;
        }
        seen.add(seenKey);

        const scoring = scoreLocalMvCandidate(track, filePath);
        if (scoring.score < minimumCandidateScore) {
          continue;
        }

        candidates.push({
          id: randomUUID(),
          provider: 'local',
          sourceType: 'sidecar',
          title: candidateTitle(filePath),
          artist: track.artist || track.albumArtist || null,
          filePath,
          url: null,
          providerUrl: null,
          thumbnailUrl: null,
          uploader: null,
          availableQualities: [],
          durationSeconds: null,
          score: scoring.score,
          playableInApp: isBrowserPlayableVideo(filePath),
          reasons: scoring.reasons,
        });
      }
    }

    return candidates.sort((left, right) => right.score - left.score);
  }

  sourceIdForFile(filePath: string): string {
    return fileHashId(filePath);
  }
}
