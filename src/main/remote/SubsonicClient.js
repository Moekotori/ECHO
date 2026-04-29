import axios from 'axios'
import { createHash, randomBytes } from 'crypto'

const API_VERSION = '1.16.1'
const CLIENT_NAME = 'ECHO'

function normalizeServerUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    throw new Error('服务器地址不能为空')
  }
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  const url = new URL(withProtocol)
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/rest$/i, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

function createAuthParams(username, password) {
  const salt = randomBytes(8).toString('hex')
  const token = createHash('md5').update(`${password || ''}${salt}`).digest('hex')
  return {
    u: username,
    t: token,
    s: salt,
    v: API_VERSION,
    c: CLIENT_NAME,
    f: 'json'
  }
}

function readResponse(payload) {
  const response = payload?.['subsonic-response']
  if (!response) {
    throw new Error('服务器返回不是 Subsonic JSON 响应')
  }
  if (response.status !== 'ok') {
    const code = response.error?.code
    const message = response.error?.message || 'Subsonic 请求失败'
    throw new Error(code ? `${message} (${code})` : message)
  }
  return response
}

function asArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function createSubsonicTrackPath(sourceId, songId) {
  return `subsonic://${encodeURIComponent(sourceId)}/song/${encodeURIComponent(songId)}`
}

export function parseSubsonicTrackPath(value) {
  const raw = String(value || '')
  const match = raw.match(/^subsonic:\/\/([^/]+)\/song\/(.+)$/i)
  if (!match) return null
  return {
    sourceId: decodeURIComponent(match[1]),
    songId: decodeURIComponent(match[2])
  }
}

export function isSubsonicTrackPath(value) {
  return Boolean(parseSubsonicTrackPath(value))
}

export function mapSubsonicSong(source, song, client) {
  const sourceId = source?.id || ''
  const songId = String(song?.id || '')
  const coverArtId = song?.coverArt || song?.albumId || songId
  const title = song?.title || song?.name || 'Unknown Title'
  const artist = song?.artist || song?.artistName || 'Unknown Artist'
  const album = song?.album || song?.albumName || ''
  const suffix = String(song?.suffix || song?.contentType || '').replace(/^\./, '').toUpperCase()
  const duration = Number(song?.duration || 0)
  const sampleRate = Number(song?.samplingRate || 0)
  const bitDepth = Number(song?.bitDepth || 0)
  const bitRate = Number(song?.bitRate || 0)
  const channels = Number(song?.channelCount || 0)

  return {
    path: createSubsonicTrackPath(sourceId, songId),
    name: title,
    title,
    artist,
    album,
    duration,
    remote: true,
    remoteType: 'subsonic',
    remoteSourceId: sourceId,
    remoteSourceName: source?.name || 'Subsonic',
    remoteSongId: songId,
    remoteCoverArtId: coverArtId ? String(coverArtId) : '',
    info: {
      title,
      artist,
      album,
      duration,
      codec: suffix || undefined,
      bitrate: bitRate ? `${bitRate}kbps` : undefined,
      bitrateKbps: bitRate || undefined,
      sampleRate: sampleRate ? `${sampleRate}Hz` : undefined,
      sampleRateHz: sampleRate || undefined,
      bitDepth: bitDepth || undefined,
      channels: channels || undefined,
      cover: coverArtId && client ? client.getCoverArtUrl(coverArtId) : undefined,
      coverArtId: coverArtId ? String(coverArtId) : undefined,
      source: source?.name || 'Subsonic'
    }
  }
}

export class SubsonicClient {
  constructor({ serverUrl, username, password, timeout = 12000 }) {
    this.serverUrl = normalizeServerUrl(serverUrl)
    this.username = String(username || '').trim()
    this.password = String(password || '')
    this.timeout = timeout
    if (!this.username) {
      throw new Error('用户名不能为空')
    }
  }

  buildUrl(endpoint, params = {}) {
    const url = new URL(`${this.serverUrl}/rest/${endpoint}.view`)
    const auth = createAuthParams(this.username, this.password)
    for (const [key, value] of Object.entries({ ...auth, ...params })) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
    return url.toString()
  }

  async request(endpoint, params = {}) {
    const url = this.buildUrl(endpoint, params)
    const result = await axios.get(url, {
      timeout: this.timeout,
      responseType: 'json',
      validateStatus: status => status >= 200 && status < 500
    })
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`HTTP ${result.status}`)
    }
    return readResponse(result.data)
  }

  async ping() {
    await this.request('ping')
    return true
  }

  async getMusicFolders() {
    const response = await this.request('getMusicFolders')
    return asArray(response.musicFolders?.musicFolder).map(folder => ({
      id: String(folder.id || ''),
      name: folder.name || 'Music'
    }))
  }

  async getArtists() {
    const response = await this.request('getArtists')
    const indexes = asArray(response.artists?.index)
    return indexes.flatMap(index => asArray(index.artist).map(artist => ({
      id: String(artist.id || ''),
      name: artist.name || 'Unknown Artist',
      albumCount: Number(artist.albumCount || 0),
      coverArt: artist.coverArt ? String(artist.coverArt) : ''
    })))
  }

  async getArtist(id) {
    const response = await this.request('getArtist', { id })
    const artist = response.artist || {}
    return {
      id: String(artist.id || id || ''),
      name: artist.name || 'Unknown Artist',
      albums: asArray(artist.album).map(album => this.mapAlbum(album))
    }
  }

  async getAlbum(id, source) {
    const response = await this.request('getAlbum', { id })
    const album = response.album || {}
    return {
      ...this.mapAlbum(album),
      songs: asArray(album.song).map(song => mapSubsonicSong(source, song, this))
    }
  }

  async getSong(id, source) {
    const response = await this.request('getSong', { id })
    return mapSubsonicSong(source, response.song || { id }, this)
  }

  async search(query, source) {
    const response = await this.request('search3', {
      query,
      artistCount: 20,
      albumCount: 40,
      songCount: 80
    })
    const result = response.searchResult3 || {}
    return {
      artists: asArray(result.artist).map(artist => ({
        id: String(artist.id || ''),
        name: artist.name || 'Unknown Artist',
        albumCount: Number(artist.albumCount || 0)
      })),
      albums: asArray(result.album).map(album => this.mapAlbum(album)),
      songs: asArray(result.song).map(song => mapSubsonicSong(source, song, this))
    }
  }

  async getStarred(source) {
    const response = await this.request('getStarred2')
    const result = response.starred2 || {}
    return {
      artists: asArray(result.artist).map(artist => ({
        id: String(artist.id || ''),
        name: artist.name || 'Unknown Artist',
        albumCount: Number(artist.albumCount || 0)
      })),
      albums: asArray(result.album).map(album => this.mapAlbum(album)),
      songs: asArray(result.song).map(song => mapSubsonicSong(source, song, this))
    }
  }

  async getRecentlyPlayed(source) {
    const response = await this.request('getRecentlyPlayed', { count: 80 })
    return {
      artists: [],
      albums: [],
      songs: asArray(response.recentlyPlayed?.song).map(song => mapSubsonicSong(source, song, this))
    }
  }

  async getPlaylists() {
    const response = await this.request('getPlaylists')
    return asArray(response.playlists?.playlist).map(playlist => ({
      id: String(playlist.id || ''),
      name: playlist.name || 'Playlist',
      title: playlist.name || 'Playlist',
      songCount: Number(playlist.songCount || 0),
      duration: Number(playlist.duration || 0),
      owner: playlist.owner || '',
      public: Boolean(playlist.public)
    }))
  }

  async getPlaylist(id, source) {
    const response = await this.request('getPlaylist', { id })
    const playlist = response.playlist || {}
    return {
      id: String(playlist.id || id || ''),
      name: playlist.name || 'Playlist',
      title: playlist.name || 'Playlist',
      artist: playlist.owner || source?.name || 'Subsonic',
      songCount: Number(playlist.songCount || 0),
      duration: Number(playlist.duration || 0),
      songs: asArray(playlist.entry).map(song => mapSubsonicSong(source, song, this))
    }
  }

  mapAlbum(album) {
    const coverArt = album?.coverArt ? String(album.coverArt) : ''
    return {
      id: String(album?.id || ''),
      name: album?.name || album?.title || 'Unknown Album',
      title: album?.title || album?.name || 'Unknown Album',
      artist: album?.artist || album?.artistName || 'Unknown Artist',
      songCount: Number(album?.songCount || 0),
      duration: Number(album?.duration || 0),
      year: album?.year ? Number(album.year) : undefined,
      coverArt,
      cover: coverArt ? this.getCoverArtUrl(coverArt) : undefined
    }
  }

  getCoverArtUrl(id) {
    return this.buildUrl('getCoverArt', { id })
  }

  getStreamUrl(songId) {
    return this.buildUrl('stream', { id: songId, format: 'raw' })
  }
}
