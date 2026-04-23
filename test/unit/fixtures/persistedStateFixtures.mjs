export const legacyPlaybackHistoryFixture = [
  'C:\\Music\\alpha.flac',
  'C:\\Music\\beta.flac',
  '',
  null
]

export const modernPlaybackHistoryFixture = [
  {
    path: 'C:\\Music\\alpha.flac',
    title: 'Alpha',
    artist: 'Artist A',
    album: 'Album A',
    playedAt: 1710000000000
  },
  {
    path: 'C:\\Music\\beta.flac',
    title: 'Beta',
    artist: 'Artist B',
    album: 'Album B',
    playedAt: 1710000005000
  }
]

export const validPlaybackSessionFixture = {
  trackPath: 'C:\\Music\\alpha.flac',
  currentTimeSec: 83.25,
  playbackContext: {
    kind: 'userPlaylist',
    key: 'favorites',
    trackPaths: ['C:\\Music\\alpha.flac', 'C:\\Music\\beta.flac']
  },
  savedAt: 1710000010000
}

export const invalidPlaybackSessionsFixture = [
  null,
  {},
  { trackPath: '', currentTimeSec: 10 },
  { trackPath: 'C:\\Music\\gamma.flac', currentTimeSec: 'NaN', playbackContext: 'bad' }
]
