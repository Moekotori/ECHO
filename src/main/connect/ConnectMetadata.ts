import { basename } from 'node:path';
import type { AudioStatus } from '../../shared/types/audio';
import type { ConnectMetadata, ConnectPlaybackTarget } from '../../shared/types/connect';
import type { LibraryTrack } from '../../shared/types/library';

export type ConnectMetadataInput = {
  track: ConnectPlaybackTarget | LibraryTrack | null;
  status?: Pick<AudioStatus, 'currentFilePath' | 'currentTrackId' | 'durationSeconds' | 'positionSeconds'> | null;
  coverHttpUrl: string;
};

export type DlnaDidlInput = {
  id: string;
  streamUrl: string;
  metadata: ConnectMetadata;
  mimeType: string;
  sizeBytes?: number | null;
};

const unknownArtist = 'Unknown Artist';
const defaultTitle = 'ECHO Next';

const trimText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const titleFromPath = (filePath: string | null | undefined): string | null => {
  if (!filePath) {
    return null;
  }

  try {
    const url = new URL(filePath);
    return decodeURIComponent(basename(url.pathname)) || filePath;
  } catch {
    return basename(filePath) || filePath;
  }
};

export const createConnectMetadata = ({ track, status, coverHttpUrl }: ConnectMetadataInput): ConnectMetadata => {
  const fileTitle = titleFromPath(track?.path ?? status?.currentFilePath ?? null);
  const title = trimText(track?.title) ?? fileTitle ?? defaultTitle;
  const artist = trimText(track?.artist) ?? trimText(track?.albumArtist) ?? unknownArtist;
  const album = trimText(track?.album);
  const albumArtist = trimText(track?.albumArtist);
  const durationSeconds =
    typeof track?.duration === 'number' && Number.isFinite(track.duration) && track.duration > 0
      ? track.duration
      : typeof status?.durationSeconds === 'number' && Number.isFinite(status.durationSeconds) && status.durationSeconds > 0
        ? status.durationSeconds
        : 0;

  return {
    title,
    artist,
    album,
    albumArtist,
    durationSeconds,
    coverHttpUrl,
  };
};

export const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const dlnaProfileForMime = (mimeType: string): string => {
  switch (mimeType.toLowerCase()) {
    case 'audio/mpeg':
      return 'DLNA.ORG_PN=MP3;DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'DLNA.ORG_PN=WAV;DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    default:
      return 'DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000';
  }
};

export const protocolInfoForMime = (mimeType: string): string =>
  `http-get:*:${mimeType}:${dlnaProfileForMime(mimeType)}`;

export const buildDlnaDidlLite = ({ id, streamUrl, metadata, mimeType, sizeBytes }: DlnaDidlInput): string => {
  const protocolInfo = protocolInfoForMime(mimeType);
  const sizeAttribute = typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes > 0
    ? ` size="${Math.round(sizeBytes)}"`
    : '';
  const album = metadata.album ? `<upnp:album>${escapeXml(metadata.album)}</upnp:album>` : '';
  const albumArtist = metadata.albumArtist ? `<upnp:albumArtist>${escapeXml(metadata.albumArtist)}</upnp:albumArtist>` : '';

  return [
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"',
    ' xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">',
    `<item id="${escapeXml(id)}" parentID="0" restricted="1">`,
    `<dc:title>${escapeXml(metadata.title)}</dc:title>`,
    `<upnp:artist>${escapeXml(metadata.artist)}</upnp:artist>`,
    album,
    albumArtist,
    `<upnp:albumArtURI dlna:profileID="JPEG_TN">${escapeXml(metadata.coverHttpUrl)}</upnp:albumArtURI>`,
    '<upnp:class>object.item.audioItem.musicTrack</upnp:class>',
    `<res protocolInfo="${escapeXml(protocolInfo)}"${sizeAttribute}>${escapeXml(streamUrl)}</res>`,
    '</item>',
    '</DIDL-Lite>',
  ].join('');
};
