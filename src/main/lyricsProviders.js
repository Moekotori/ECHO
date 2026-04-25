import axios from 'axios'

const REQUEST_TIMEOUT_MS = 4500
const QQ_REQUEST_TIMEOUT_MS = 2500
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeDurationMs(value) {
  if (typeof value === 'string' && value.includes(':')) {
    const parts = value.split(':').map((x) => Number(x))
    if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
      return parts[0] * 60 + parts[1]
    }
  }
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n > 10000 ? Math.round(n / 1000) : Math.round(n)
}

function decodeBase64Text(value) {
  if (!value || typeof value !== 'string') return ''
  try {
    return Buffer.from(value, 'base64').toString('utf8')
  } catch {
    return ''
  }
}

function normalizeLyricPayload(value) {
  if (typeof value !== 'string') return ''
  const raw = value.trim()
  if (!raw) return ''
  if (raw.includes('[') && raw.includes(']')) return raw
  const decoded = decodeBase64Text(raw).trim()
  return decoded || raw
}

function toLrcFromKuwoLines(list) {
  if (!Array.isArray(list)) return ''
  return list
    .map((line) => {
      const sec = Number(line?.time)
      const text = cleanText(line?.lineLyric)
      if (!Number.isFinite(sec) || !text) return ''
      const minutes = Math.floor(sec / 60)
      const seconds = Math.floor(sec % 60)
      const centiseconds = Math.floor((sec - Math.floor(sec)) * 100)
      return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]${text}`
    })
    .filter(Boolean)
    .join('\n')
}

function normalizeProviderItem(source, item, lrc, extras = {}) {
  const title = cleanText(item?.trackName || item?.songname || item?.songname_original || item?.name)
  const artist = cleanText(
    item?.artistName ||
      item?.singername ||
      item?.singerName ||
      item?.SingerName ||
      item?.artist ||
      item?.singer
  )
  const album = cleanText(item?.albumName || item?.album_name || item?.albumname || item?.album)
  const durationSec = normalizeDurationMs(
    item?.duration || item?.interval || item?.Duration || item?.durationMs || extras.durationMs
  )
  return {
    source,
    trackName: title,
    artistName: artist,
    albumName: album,
    duration: durationSec,
    syncedLyrics: lrc || '',
    plainLyrics: '',
    providerId: cleanText(extras.providerId || item?.songmid || item?.hash || item?.rid || item?.id),
    providerLabel: extras.providerLabel || source
  }
}

async function searchQqLyrics({ keywords, limit = 8 } = {}) {
  const q = cleanText(keywords)
  if (!q) return []
  const headers = {
    'User-Agent': USER_AGENT,
    Referer: 'https://y.qq.com/'
  }
  const search = await axios.get('https://c.y.qq.com/soso/fcgi-bin/client_search_cp', {
    params: { w: q, p: 1, n: Math.min(limit, 12), format: 'json' },
    headers,
    timeout: QQ_REQUEST_TIMEOUT_MS
  })
  const songs = search.data?.data?.song?.list
  if (!Array.isArray(songs) || songs.length === 0) return []

  const jobs = songs.slice(0, limit).map(async (song) => {
    const songmid = song?.songmid
    if (!songmid) return null
    const lyric = await axios.get('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
      params: { songmid, format: 'json', nobase64: 1 },
      headers,
      timeout: QQ_REQUEST_TIMEOUT_MS
    })
    const raw = normalizeLyricPayload(lyric.data?.lyric)
    if (!raw) return null
    return normalizeProviderItem(
      'qq',
      {
        trackName: song.songname,
        artistName: Array.isArray(song.singer) ? song.singer.map((s) => s?.name).filter(Boolean).join(' / ') : '',
        albumName: song.albumname,
        duration: song.interval
      },
      raw,
      { providerId: songmid, providerLabel: 'QQ Music' }
    )
  })
  const settled = await Promise.allSettled(jobs)
  return settled.map((r) => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean)
}

async function downloadKugouLyricForSong(song, keywords) {
  const hash = song?.hash || song?.FileHash || song?.Hash || song?.SQFileHash || ''
  const durationSec = normalizeDurationMs(song?.duration || song?.Duration)
  const lyricSearch = await axios.get('https://lyrics.kugou.com/search', {
    params: {
      ver: 1,
      man: 'yes',
      client: 'pc',
      keyword: cleanText(song?.filename || song?.FileName || song?.songname || keywords),
      duration: durationSec ? durationSec * 1000 : undefined,
      hash
    },
    timeout: REQUEST_TIMEOUT_MS
  })
  const cand =
    lyricSearch.data?.candidates?.[0] ||
    lyricSearch.data?.ugccandidates?.[0] ||
    lyricSearch.data?.ai_candidates?.[0]
  if (!cand?.id || !cand?.accesskey) return ''
  const download = await axios.get('https://lyrics.kugou.com/download', {
    params: {
      ver: 1,
      client: 'pc',
      id: cand.id,
      accesskey: cand.accesskey,
      fmt: 'lrc',
      charset: 'utf8'
    },
    timeout: REQUEST_TIMEOUT_MS
  })
  return normalizeLyricPayload(download.data?.content)
}

async function searchKugouLyrics({ keywords, limit = 8 } = {}) {
  const q = cleanText(keywords)
  if (!q) return []
  const search = await axios.get('http://mobilecdn.kugou.com/api/v3/search/song', {
    params: { keyword: q, page: 1, pagesize: Math.min(limit, 12), format: 'json' },
    headers: { 'User-Agent': USER_AGENT },
    timeout: REQUEST_TIMEOUT_MS
  })
  const songs = search.data?.data?.info
  if (!Array.isArray(songs) || songs.length === 0) return []
  const jobs = songs.slice(0, limit).map(async (song) => {
    const raw = await downloadKugouLyricForSong(song, q)
    if (!raw) return null
    return normalizeProviderItem('kugou', song, raw, {
      providerId: song?.hash,
      providerLabel: 'Kugou'
    })
  })
  const settled = await Promise.allSettled(jobs)
  return settled.map((r) => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean)
}

async function searchKuwoLyrics({ keywords, limit = 6 } = {}) {
  const q = cleanText(keywords)
  if (!q) return []
  const search = await axios.get('https://search.kuwo.cn/r.s', {
    params: {
      all: q,
      ft: 'music',
      itemset: 'web_2013',
      client: 'kt',
      pn: 0,
      rn: Math.min(limit, 10),
      rformat: 'json',
      encoding: 'utf8'
    },
    responseType: 'text',
    headers: { 'User-Agent': USER_AGENT, Referer: 'https://www.kuwo.cn/' },
    timeout: REQUEST_TIMEOUT_MS
  })
  const body = typeof search.data === 'string' ? search.data.replace(/'/g, '"') : search.data
  const parsed = typeof body === 'string' ? JSON.parse(body) : body
  const songs = parsed?.abslist
  if (!Array.isArray(songs) || songs.length === 0) return []
  const jobs = songs.slice(0, limit).map(async (song) => {
    const rid = cleanText(song?.MUSICRID || song?.musicrid || song?.rid).replace(/^MUSIC_/, '')
    if (!rid) return null
    const lyric = await axios.get('https://m.kuwo.cn/newh5/singles/songinfoandlrc', {
      params: { musicId: rid },
      headers: { 'User-Agent': USER_AGENT, Referer: 'https://m.kuwo.cn/' },
      timeout: REQUEST_TIMEOUT_MS
    })
    const raw = toLrcFromKuwoLines(lyric.data?.data?.lrclist)
    if (!raw) return null
    return normalizeProviderItem(
      'kuwo',
      {
        trackName: song?.SONGNAME || song?.name,
        artistName: song?.ARTIST || song?.artist,
        albumName: song?.ALBUM || song?.album,
        duration: song?.DURATION || song?.duration
      },
      raw,
      { providerId: rid, providerLabel: 'Kuwo' }
    )
  })
  const settled = await Promise.allSettled(jobs)
  return settled.map((r) => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean)
}

const PROVIDERS = {
  qq: searchQqLyrics,
  kugou: searchKugouLyrics,
  kuwo: searchKuwoLyrics
}

export async function searchExternalLyrics(payload = {}) {
  const q = cleanText(payload.keywords || payload.query)
  if (!q) return []
  const sources = Array.isArray(payload.sources) && payload.sources.length
    ? payload.sources
    : ['qq', 'kugou', 'kuwo']
  const uniqueSources = [...new Set(sources)].filter((source) => PROVIDERS[source])
  const jobs = uniqueSources.map(async (source) => {
    try {
      return await PROVIDERS[source]({ ...payload, keywords: q })
    } catch (error) {
      if (process.env.ECHO_DEBUG_LYRICS === '1') {
        console.warn(`[lyrics:${source}]`, error?.message || error)
      }
      return []
    }
  })
  const settled = await Promise.allSettled(jobs)
  return settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
}
