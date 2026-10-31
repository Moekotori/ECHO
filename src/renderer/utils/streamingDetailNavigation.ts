import type { StreamingAlbum, StreamingArtist } from '../../shared/types/streaming';

export const streamingDetailNavigationEvent = 'app:navigate:streaming-detail';

export type StreamingDetailReturnTarget = 'playlists';

export type StreamingDetailNavigationRequest =
  | { kind: 'album'; album: StreamingAlbum; returnTo?: StreamingDetailReturnTarget }
  | { kind: 'artist'; artist: StreamingArtist; returnTo?: StreamingDetailReturnTarget };

let pendingStreamingDetail: StreamingDetailNavigationRequest | null = null;

const requestStreamingDetailNavigation = (request: StreamingDetailNavigationRequest): void => {
  pendingStreamingDetail = request;
  window.dispatchEvent(new CustomEvent<StreamingDetailNavigationRequest>(streamingDetailNavigationEvent, { detail: request }));
  window.dispatchEvent(new CustomEvent('app:navigate:route', { detail: 'streaming' }));
};

export const requestStreamingAlbumDetailNavigation = (
  album: StreamingAlbum,
  options: { returnTo?: StreamingDetailReturnTarget } = {},
): void => requestStreamingDetailNavigation({ kind: 'album', album, returnTo: options.returnTo });

export const requestStreamingArtistDetailNavigation = (
  artist: StreamingArtist,
  options: { returnTo?: StreamingDetailReturnTarget } = {},
): void => requestStreamingDetailNavigation({ kind: 'artist', artist, returnTo: options.returnTo });

export const consumePendingStreamingDetailNavigation = (): StreamingDetailNavigationRequest | null => {
  const request = pendingStreamingDetail;
  pendingStreamingDetail = null;
  return request;
};
