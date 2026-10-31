import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import type { IntegrationPlaybackSnapshotV1 } from '../../shared/types/integrationPlatform';
import { fetchWithNetworkProxy } from '../network/networkFetch';

const maxArtworkBytes = 10 * 1024 * 1024;
const allowedArtworkMimeTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export type EchoLinkV2Artwork = {
  data: Buffer;
  mimeType: string;
};

type ArtworkCandidate = {
  coverId: string | null;
  sourceUrl: string | null;
};

const normalizedMimeType = (value: string | null | undefined): string | null => {
  const mimeType = value?.split(';')[0]?.trim().toLowerCase() ?? null;
  return mimeType && allowedArtworkMimeTypes.has(mimeType) ? mimeType : null;
};

const mimeTypeForPath = (filePath: string): string | null => {
  switch (extname(filePath).toLowerCase()) {
    case '.avif':
      return 'image/avif';
    case '.gif':
      return 'image/gif';
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return null;
  }
};

const coverIdFromUrl = (value: string | null): string | null => {
  if (!value?.startsWith('echo-cover://')) {
    return null;
  }
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.replace(/^\/+/u, '')) || null;
  } catch {
    return null;
  }
};

const remoteUrlFromSource = (
  value: string | null,
): { url: string; referer: string | null } | null => {
  if (!value) {
    return null;
  }
  try {
    const source = new URL(value);
    if (source.protocol === 'https:') {
      return { url: source.toString(), referer: null };
    }
    if (
      source.protocol !== 'echo-image:' ||
      (source.hostname !== 'remote' && source.hostname !== 'subsonic-cover')
    ) {
      return null;
    }
    return {
      url: source.toString(),
      referer: null,
    };
  } catch {
    return null;
  }
};

const readBoundedResponse = async (response: Response): Promise<Buffer | null> => {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxArtworkBytes) {
    return null;
  }
  if (!response.body) {
    return null;
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      size += result.value.byteLength;
      if (size > maxArtworkBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return size > 0 ? Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size) : null;
};

const readLocalArtwork = async (coverId: string): Promise<EchoLinkV2Artwork | null> => {
  try {
    const { getLibraryService } = await import('../library/LibraryService');
    const library = getLibraryService();
    for (const variant of ['large', 'album', 'thumb', 'original'] as const) {
      const asset = library.resolveCoverAsset(coverId, variant);
      if (!asset?.filePath) {
        continue;
      }
      const assetStat = await stat(asset.filePath).catch(() => null);
      if (!assetStat?.isFile() || assetStat.size <= 0 || assetStat.size > maxArtworkBytes) {
        continue;
      }
      const mimeType = normalizedMimeType(asset.mimeType) ?? mimeTypeForPath(asset.filePath);
      if (!mimeType) {
        continue;
      }
      return {
        data: await readFile(asset.filePath),
        mimeType,
      };
    }
  } catch {
    // The current track may be provider-only and absent from the local library.
  }
  return null;
};

const currentArtworkCandidate = async (
  snapshot: IntegrationPlaybackSnapshotV1,
): Promise<ArtworkCandidate> => {
  const sourceUrl = snapshot.track?.artworkUrl ?? null;
  let coverId = coverIdFromUrl(sourceUrl);
  let fallbackSourceUrl: string | null = null;

  if (snapshot.track?.id) {
    try {
      const { getLibraryService } = await import('../library/LibraryService');
      const track = getLibraryService().getTrack(snapshot.track.id);
      coverId ??= track?.coverId ?? null;
      fallbackSourceUrl = track?.coverThumb ?? null;
    } catch {
      // Keep using the semantic playback snapshot when the library is unavailable.
    }
  }

  return {
    coverId,
    sourceUrl: sourceUrl ?? fallbackSourceUrl,
  };
};

export const resolveEchoLinkV2CurrentArtwork = async (
  snapshot: IntegrationPlaybackSnapshotV1,
): Promise<EchoLinkV2Artwork | null> => {
  if (!snapshot.track) {
    return null;
  }

  const candidate = await currentArtworkCandidate(snapshot);
  if (candidate.coverId) {
    const local = await readLocalArtwork(candidate.coverId);
    if (local) {
      return local;
    }
  }

  const remote = remoteUrlFromSource(candidate.sourceUrl);
  if (!remote) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  timeout.unref?.();
  try {
    const response = await fetchWithNetworkProxy(remote.url, {
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        ...(remote.referer ? { referer: remote.referer } : {}),
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const mimeType = normalizedMimeType(response.headers.get('content-type'));
    if (!response.ok || !mimeType) {
      return null;
    }
    const data = await readBoundedResponse(response);
    return data ? { data, mimeType } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
