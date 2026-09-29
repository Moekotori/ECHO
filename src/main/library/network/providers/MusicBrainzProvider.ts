import type { NetworkMetadataProvider } from '../NetworkMetadataProvider';
import type { NetworkMetadataCandidateInput, NetworkTrackLookup } from '../networkTypes';
import { buildSearchQuery } from './providerFetch';
import { fetchWithNetworkProxy } from '../../../network/networkFetch';

const withTimeout = async (url: string, signal: AbortSignal | undefined): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetchWithNetworkProxy(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ECHO-Next/0.1 (https://example.invalid)',
      },
    });

    if (!response.ok) {
      throw new Error(`MusicBrainz ${response.status}`);
    }

    return response.json() as Promise<unknown>;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
};

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const number = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const isUnknownArtist = (value: string): boolean => {
  const normalized = value.trim().toLocaleLowerCase();
  return !normalized || normalized === 'unknown artist' || normalized === 'unknown';
};

export class MusicBrainzProvider implements NetworkMetadataProvider {
  readonly name = 'musicbrainz' as const;

  async findMetadata(track: NetworkTrackLookup, signal?: AbortSignal): Promise<NetworkMetadataCandidateInput[]> {
    const title = track.title && track.title !== 'Untitled' ? track.title : track.filename.replace(/\.[^.]+$/, '');
    const searchText =
      title && !isUnknownArtist(track.artist)
        ? `recording:"${title}" AND artist:"${track.artist}"`
        : title
          ? `recording:"${title}"`
          : buildSearchQuery(track.title, track.artist, track.filename);
    if (!searchText) {
      return [];
    }

    const query = encodeURIComponent(searchText);
    const data = asRecord(await withTimeout(`https://musicbrainz.org/ws/2/recording/?query=${query}&fmt=json&limit=5`, signal));
    const recordings = Array.isArray(data.recordings) ? data.recordings : [];

    return recordings.map((recordingValue): NetworkMetadataCandidateInput => {
      const recording = asRecord(recordingValue);
      const artistCredit = Array.isArray(recording['artist-credit']) ? asRecord(recording['artist-credit'][0]) : {};
      const artist = asRecord(artistCredit.artist);
      const releases = Array.isArray(recording.releases) ? recording.releases.map(asRecord) : [];
      const release = releases[0] ?? {};
      const media = Array.isArray(release.media) ? release.media.map(asRecord) : [];
      const medium = media[0] ?? {};

      return {
        provider: this.name,
        providerItemId: text(recording.id) ?? `${this.name}:${text(recording.title) ?? track.title}`,
        title: text(recording.title),
        artist: text(artist.name) ?? text(artistCredit.name),
        album: text(release.title),
        albumArtist: text(artist.name) ?? text(artistCredit.name),
        year: text(release.date) ? number(text(release.date)?.slice(0, 4)) : null,
        genre: null,
        duration: number(recording.length) ? Number(recording.length) / 1000 : null,
        trackNo: number(medium.position),
        discNo: null,
        coverUrl: text(release.id) ? `https://coverartarchive.org/release/${release.id}/front-250` : null,
        raw: recording,
      };
    });
  }
}
