import axios from 'axios'
import {
  buildQqMusicDownloadHeaders,
  buildQqMusicHeaders,
  getQqMusicUin
} from './qqMusicAuth.js'

const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const QQ_STREAM_HOST = 'https://dl.stream.qqmusic.qq.com/'

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function joinArtists(value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => item?.name || item?.singer_name || item?.title || '')
    .filter(Boolean)
    .join(' / ')
}

function normalizeSong(song) {
  const mid = pickString(song?.mid, song?.songmid, song?.songMid)
  const file = song?.file || {}
  const mediaMid = pickString(file?.media_mid, file?.mediaMid, song?.media_mid, song?.mediaMid, mid)
  const album = song?.album || {}
  const albumMid = pickString(album?.mid, album?.pmid, song?.albummid, song?.albumMid)
  const cover = albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : ''
  return {
    id: mid || String(song?.id || song?.songid || ''),
    mid,
    mediaMid,
    name: pickString(song?.name, song?.songname, song?.title),
    artists: joinArtists(song?.singer || song?.singers),
    artist: joinArtists(song?.singer || song?.singers),
    album: pickString(album?.name, song?.albumname, song?.albumName),
    albumMid,
    cover,
    duration: Number(song?.interval || song?.duration || 0) * 1000,
    fee: 0,
    source: 'qq'
  }
}

function normalizeAlbum(album) {
  const albumMid = pickString(album?.albumMID, album?.albummid, album?.mid, album?.albumMid)
  const albumId = album?.albumID || album?.albumid || album?.id || albumMid
  return {
    id: albumMid || String(albumId || ''),
    albumMid,
    albumId,
    name: pickString(album?.albumName, album?.albumname, album?.name),
    artist: pickString(album?.singerName, album?.singername, album?.singer),
    picUrl: albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : '',
    size: Number(album?.song_count || album?.songCount || album?.count || 0),
    source: 'qq'
  }
}

async function requestMusicu(payload, cookie) {
  const res = await axios.post(QQ_MUSICU_URL, payload, {
    params: { format: 'json', inCharset: 'utf8', outCharset: 'utf-8' },
    headers: buildQqMusicHeaders(cookie),
    timeout: 12000
  })
  return res?.data || {}
}

async function getMusicu(payload, cookie) {
  try {
    const res = await axios.get(QQ_MUSICU_URL, {
      params: { data: JSON.stringify(payload) },
      headers: buildQqMusicHeaders(cookie),
      timeout: 12000
    })
    return res?.data || {}
  } catch (error) {
    if (cookie && error?.response?.status >= 500) {
      const res = await axios.get(QQ_MUSICU_URL, {
        params: { data: JSON.stringify(payload) },
        headers: buildQqMusicHeaders(''),
        timeout: 12000
      })
      return res?.data || {}
    }
    throw error
  }
}

function buildSearchPayload(query, searchType, limit) {
  return {
    comm: {
      g_tk: 5381,
      uin: '0',
      format: 'json',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'h5',
      needNewCode: 1,
      ct: 23,
      cv: 0
    },
    req_0: {
      method: 'DoSearchForQQMusicDesktop',
      module: 'music.search.SearchCgiService',
      param: {
        remoteplace: 'txt.mqq.all',
        searchid: String(Date.now()),
        search_type: searchType,
        query,
        page_num: 1,
        num_per_page: limit
      }
    }
  }
}

export async function searchQqMusicSongs(keywords, { cookie = '', limit = 20 } = {}) {
  const key = String(keywords || '').trim()
  if (!key) return []
  try {
    const data = await getMusicu(buildSearchPayload(key, 0, limit), cookie)
    const list = data?.req_0?.data?.body?.song?.list || []
    return list.map(normalizeSong).filter((song) => song.mid)
  } catch (error) {
    const message = error?.response?.status
      ? `QQ Music search failed: HTTP ${error.response.status}`
      : error?.message || 'QQ Music search failed'
    throw new Error(message)
  }
}

export async function searchQqMusicAlbums({ albumName = '', artist = '', cookie = '' } = {}) {
  const key = `${albumName || ''} ${artist || ''}`.trim()
  if (!key) return []
  try {
    const data = await getMusicu(buildSearchPayload(key, 2, 8), cookie)
    const list = data?.req_0?.data?.body?.album?.list || []
    return list.map(normalizeAlbum).filter((album) => album.id)
  } catch (error) {
    const message = error?.response?.status
      ? `QQ Music album search failed: HTTP ${error.response.status}`
      : error?.message || 'QQ Music album search failed'
    throw new Error(message)
  }
}

export async function getQqMusicAlbumTracks({ albumMid = '', albumId = '', cookie = '' } = {}) {
  const payload = {
    req_0: {
      module: 'music.musichallAlbum.AlbumSongList',
      method: 'GetAlbumSongList',
      param: {
        albumMid,
        albumID: Number(albumId || 0),
        begin: 0,
        num: 200,
        order: 2
      }
    },
    comm: {
      ct: 24,
      cv: 0
    }
  }
  const data = await requestMusicu(payload, cookie)
  const list = data?.req_0?.data?.songList || data?.req_0?.data?.songlist || []
  return list
    .map((item) => normalizeSong(item?.songInfo || item))
    .filter((song) => song.mid)
}

export async function getQqMusicPlaylistTracks({ playlistId = '', cookie = '', limit = 1000 } = {}) {
  const disstid = String(playlistId || '').trim()
  if (!/^\d+$/.test(disstid)) {
    throw new Error('Invalid QQ Music playlist URL or ID')
  }
  const payload = {
    req_0: {
      module: 'music.srfDissInfo.DissInfo',
      method: 'CgiGetDiss',
      param: {
        disstid,
        dirid: Number(disstid),
        tag: 1,
        userinfo: 1,
        song_begin: 0,
        song_num: Math.max(1, Math.min(Number(limit) || 1000, 1000))
      }
    },
    comm: {
      ct: 24,
      cv: 0
    }
  }
  const data = await requestMusicu(payload, cookie)
  const body = data?.req_0?.data || {}
  const songlist = body.songlist || body.songList || body.cdlist?.[0]?.songlist || []
  const name =
    pickString(
      body.dissname,
      body.dirinfo?.title,
      body.dirinfo?.dissname,
      body.cdlist?.[0]?.dissname
    ) || 'QQ Music Playlist'
  return {
    name,
    tracks: songlist
      .map((item) => normalizeSong(item?.songInfo || item))
      .filter((song) => song.mid)
  }
}

function buildQualityCandidates(preset, mediaMid) {
  const all = [
    { quality: 'flac', filename: `F000${mediaMid}.flac`, ext: 'flac', label: 'FLAC' },
    { quality: 'ape', filename: `A000${mediaMid}.ape`, ext: 'ape', label: 'APE' },
    { quality: '320', filename: `M800${mediaMid}.mp3`, ext: 'mp3', label: '320k MP3' },
    { quality: '128', filename: `M500${mediaMid}.mp3`, ext: 'mp3', label: '128k MP3' },
    { quality: 'm4a', filename: `C400${mediaMid}.m4a`, ext: 'm4a', label: 'M4A' }
  ]
  const p = String(preset || 'auto').toLowerCase()
  if (p === 'lossless' || p === 'auto') return all
  if (p === 'high') return all.filter((item) => ['320', '128', 'm4a'].includes(item.quality))
  if (p === 'medium') return all.filter((item) => ['128', 'm4a'].includes(item.quality))
  if (p === 'low') return all.filter((item) => ['m4a', '128'].includes(item.quality))
  return all
}

export async function getQqMusicSongDirectUrl(
  song,
  { qualityPreset = 'auto', cookie = '' } = {}
) {
  const songMid = pickString(song?.mid, song?.songMid, song?.songmid, song?.id)
  const mediaMid = pickString(song?.mediaMid, song?.media_mid, song?.file?.media_mid, songMid)
  if (!songMid || !mediaMid) return null

  const uin = getQqMusicUin(cookie)
  const candidates = buildQualityCandidates(qualityPreset, mediaMid)
  for (const candidate of candidates) {
    const payload = {
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          guid: '10000',
          songmid: [songMid],
          songtype: [0],
          uin,
          loginflag: 1,
          platform: '20',
          filename: [candidate.filename]
        }
      },
      comm: {
        uin,
        format: 'json',
        ct: 24,
        cv: 0
      }
    }
    const data = await requestMusicu(payload, cookie)
    const info = data?.req_0?.data?.midurlinfo?.[0]
    const purl = info?.purl
    if (!purl) continue
    const host = data?.req_0?.data?.sip?.[0] || QQ_STREAM_HOST
    const degraded =
      String(qualityPreset || '').toLowerCase() === 'lossless' &&
      !['flac', 'ape'].includes(candidate.quality)
    return {
      url: `${host}${purl}`,
      ext: candidate.ext,
      type: candidate.ext,
      quality: candidate.quality,
      qualityLabel: candidate.label,
      degraded,
      headers: buildQqMusicDownloadHeaders(cookie)
    }
  }

  return null
}
