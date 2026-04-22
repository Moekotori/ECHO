/**
 * User playlist import/export helpers.
 * Keep old path-only JSON working while allowing richer share payloads.
 */

export const PLAYLISTS_FILE_TYPE = 'echoes-user-playlists'
export const PLAYLISTS_SHARE_VERSION = 2

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value.trim()))]
}

function normalizePlaylistName(name) {
  return String(name || 'Playlist')
}

function normalizeImportedPlaylistPaths(playlist) {
  const directPaths = Array.isArray(playlist?.paths) ? playlist.paths : []
  const trackPaths = Array.isArray(playlist?.tracks)
    ? playlist.tracks.map((track) => track?.path).filter((path) => typeof path === 'string')
    : []
  return uniqueStrings([...directPaths, ...trackPaths])
}

function normalizeShareTrack(track) {
  if (!track || typeof track !== 'object') return null
  const sourceUrl = typeof track.sourceUrl === 'string' ? track.sourceUrl.trim() : ''
  if (!sourceUrl) return null
  return {
    path: typeof track.path === 'string' ? track.path : '',
    title: typeof track.title === 'string' ? track.title : '',
    artist: typeof track.artist === 'string' ? track.artist : '',
    sourceUrl
  }
}

function normalizeSharePlaylist(playlist) {
  const tracks = Array.isArray(playlist?.tracks)
    ? playlist.tracks.map(normalizeShareTrack).filter(Boolean)
    : []
  if (tracks.length === 0) return null
  return {
    name: normalizePlaylistName(playlist?.name),
    tracks
  }
}

export function normalizeImportedPlaylists(data) {
  if (!data || typeof data !== 'object') return []
  if (data.type === PLAYLISTS_FILE_TYPE && Array.isArray(data.playlists)) {
    return data.playlists.map((playlist) => ({
      id: crypto.randomUUID(),
      name: normalizePlaylistName(playlist?.name),
      paths: normalizeImportedPlaylistPaths(playlist)
    }))
  }
  if (Array.isArray(data.playlists)) {
    return data.playlists.map((playlist) => ({
      id: crypto.randomUUID(),
      name: normalizePlaylistName(playlist?.name),
      paths: normalizeImportedPlaylistPaths(playlist)
    }))
  }
  if (data.name != null && (Array.isArray(data.paths) || Array.isArray(data.tracks))) {
    return [
      {
        id: crypto.randomUUID(),
        name: normalizePlaylistName(data.name),
        paths: normalizeImportedPlaylistPaths(data)
      }
    ]
  }
  return []
}

export function buildPlaylistsExportPayload(playlists) {
  const normalized = (playlists || []).map((playlist) => {
    const out = {
      name: normalizePlaylistName(playlist?.name),
      paths: uniqueStrings(Array.isArray(playlist?.paths) ? playlist.paths : [])
    }
    if (Array.isArray(playlist?.tracks) && playlist.tracks.length > 0) {
      out.tracks = playlist.tracks
        .map((track) => ({
          path: typeof track?.path === 'string' ? track.path : '',
          title: typeof track?.title === 'string' ? track.title : '',
          artist: typeof track?.artist === 'string' ? track.artist : '',
          sourceUrl: typeof track?.sourceUrl === 'string' ? track.sourceUrl : ''
        }))
        .filter((track) => track.path || track.title || track.artist || track.sourceUrl)
    }
    return out
  })

  return {
    type: PLAYLISTS_FILE_TYPE,
    version: PLAYLISTS_SHARE_VERSION,
    playlists: normalized
  }
}

export function extractDownloadablePlaylists(data) {
  if (!data || typeof data !== 'object') return []
  if (data.type === PLAYLISTS_FILE_TYPE && Array.isArray(data.playlists)) {
    return data.playlists.map(normalizeSharePlaylist).filter(Boolean)
  }
  if (Array.isArray(data.playlists)) {
    return data.playlists.map(normalizeSharePlaylist).filter(Boolean)
  }
  if (data.name != null && Array.isArray(data.tracks)) {
    const single = normalizeSharePlaylist(data)
    return single ? [single] : []
  }
  return []
}
