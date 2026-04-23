import fs from 'fs'
import { join } from 'path'
import MediaDownloader from './MediaDownloader.js'
import { buildNeteaseHeaderArgs } from './neteaseAuth.js'

function ytDlpExtraArgs() {
  return process.env.ECHOES_YTDLP_EXTRA
    ? process.env.ECHOES_YTDLP_EXTRA.split(/\s+/).filter(Boolean)
    : []
}

function sanitizeFolderName(name) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return cleaned || 'Imported playlist'
}

function ensurePlaylistFolder(baseDir, folderName) {
  const resolved = join(baseDir, sanitizeFolderName(folderName))
  fs.mkdirSync(resolved, { recursive: true })
  return resolved
}

function buildTrackFilename(track, fallbackIndex) {
  const title = String(track?.title || '').trim()
  const artist = String(track?.artist || '').trim()
  if (artist && title) return `${artist} - ${title}`
  return title || `track_${fallbackIndex}`
}

function buildExtraArgsForSourceUrl(sourceUrl) {
  const extraArgs = ytDlpExtraArgs()
  if (/music\.163\.com/i.test(String(sourceUrl || ''))) {
    return ['--geo-bypass-country', 'CN', ...extraArgs]
  }
  return extraArgs
}

function normalizeSharedTrack(track) {
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

function normalizeSharedPlaylist(playlist) {
  const tracks = Array.isArray(playlist?.tracks)
    ? playlist.tracks.map(normalizeSharedTrack).filter(Boolean)
    : []
  if (tracks.length === 0) return null
  return {
    name: sanitizeFolderName(playlist?.name || 'Imported playlist'),
    tracks
  }
}

export async function importSharedPlaylists(playlists, downloadFolder, eventSender, options = {}) {
  if (!downloadFolder || !fs.existsSync(downloadFolder)) {
    throw new Error('Invalid save folder; choose a valid directory in Settings.')
  }

  const normalizedPlaylists = Array.isArray(playlists)
    ? playlists.map(normalizeSharedPlaylist).filter(Boolean)
    : []

  if (normalizedPlaylists.length === 0) {
    throw new Error('No downloadable tracks found in this JSON.')
  }

  const results = []

  for (let playlistIndex = 0; playlistIndex < normalizedPlaylists.length; playlistIndex++) {
    const playlist = normalizedPlaylists[playlistIndex]
    const targetFolder = ensurePlaylistFolder(downloadFolder, playlist.name)
    const total = playlist.tracks.length
    const added = []
    const failed = []

    eventSender?.send('playlist-share:import-progress', {
      phase: 'meta',
      playlistName: playlist.name,
      playlistIndex: playlistIndex + 1,
      playlistCount: normalizedPlaylists.length,
      total
    })

    for (let trackIndex = 0; trackIndex < playlist.tracks.length; trackIndex++) {
      const track = playlist.tracks[trackIndex]
      const trackName = track.title || `Track ${trackIndex + 1}`

      eventSender?.send('playlist-share:import-progress', {
        phase: 'download',
        playlistName: playlist.name,
        playlistIndex: playlistIndex + 1,
        playlistCount: normalizedPlaylists.length,
        current: trackIndex + 1,
        total,
        trackName,
        artist: track.artist || ''
      })

      const basename = `share_${Date.now()}_${playlistIndex}_${trackIndex}`
      try {
        const downloadedPath = await MediaDownloader.downloadAudioWithBasename(
          track.sourceUrl,
          targetFolder,
          basename,
          eventSender,
          {
            extraArgs: [
              ...buildNeteaseHeaderArgs(
                /music\.163\.com/i.test(String(track.sourceUrl || '')) ? options.cookie : ''
              ),
              ...buildExtraArgsForSourceUrl(track.sourceUrl)
            ]
          }
        )
        const filePath = MediaDownloader.renameDownloadedMedia(
          downloadedPath,
          buildTrackFilename(track, trackIndex + 1)
        )
        const item = {
          path: filePath,
          trackTitle: trackName,
          artist: track.artist || '',
          sourceUrl: track.sourceUrl
        }
        added.push(item)
        eventSender?.send('playlist-share:import-progress', {
          phase: 'added',
          playlistName: playlist.name,
          playlistIndex: playlistIndex + 1,
          playlistCount: normalizedPlaylists.length,
          ...item
        })
      } catch (error) {
        failed.push({
          name: trackName,
          error: error?.message || String(error)
        })
      }

      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    results.push({
      playlistName: playlist.name,
      added,
      failed
    })
  }

  return { playlists: results }
}
