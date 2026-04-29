export function isSubsonicTrackPath(value) {
  return /^subsonic:\/\/[^/]+\/song\/.+/i.test(String(value || ''))
}

export function isNetworkFolderTrackPath(value) {
  return /^network-folder:\/\/[^/]+\/file\/.+/i.test(String(value || ''))
}

export function isWebDavTrackPath(value) {
  return /^webdav:\/\/[^/]+\/file\/.+/i.test(String(value || ''))
}

export function isRemoteTrackPath(value) {
  return isSubsonicTrackPath(value) || isNetworkFolderTrackPath(value) || isWebDavTrackPath(value)
}

export function formatRemoteDuration(seconds) {
  const total = Number(seconds || 0)
  if (!Number.isFinite(total) || total <= 0) return '--:--'
  const minutes = Math.floor(total / 60)
  const secs = Math.floor(total % 60)
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

export function buildRemoteTrackMeta(track) {
  const info = track?.info || {}
  const remoteType = track?.remoteType || info.remoteType || 'subsonic'
  const completeServerMeta = remoteType === 'subsonic'
  return {
    title: track?.title || track?.name || info.title || 'Unknown Title',
    artist: track?.artist || info.artist || 'Unknown Artist',
    album: track?.album || info.album || '',
    cover: info.cover || '',
    coverChecked: completeServerMeta,
    duration: Number(track?.duration || info.duration || 0) || undefined,
    codec: info.codec || undefined,
    bitrate: info.bitrate || undefined,
    bitrateKbps: info.bitrateKbps || undefined,
    sampleRate: info.sampleRate || undefined,
    sampleRateHz: info.sampleRateHz || undefined,
    bitDepth: info.bitDepth || undefined,
    channels: info.channels || undefined,
    bpm: info.bpm || undefined,
    bpmChecked: completeServerMeta,
    mqaChecked: completeServerMeta,
    isMqa: false,
    remoteType,
    remoteSourceId: track?.remoteSourceId || '',
    remoteSongId: track?.remoteSongId || ''
  }
}
