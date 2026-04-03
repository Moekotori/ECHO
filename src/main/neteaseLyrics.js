import { createRequire } from 'module'

const require = createRequire(import.meta.url)

function getNcmApi() {
  return require('@neteasecloudmusicapienhanced/api')
}

function ncmRequestOptions() {
  const opts = {}
  const cookie = process.env.ECHOES_NETEASE_COOKIE?.trim()
  if (cookie) opts.cookie = cookie
  const proxy = process.env.ECHOES_NETEASE_PROXY?.trim()
  if (proxy) opts.proxy = proxy
  return opts
}

/**
 * 根据关键词在网易云搜索并拉取 LRC 文本（与歌单导入共用 Cookie/代理）
 * @param {{ keywords?: string, durationSec?: number, songId?: string|number }} params
 * @returns {Promise<string|null>}
 */
export async function fetchNeteaseLrcText(params) {
  const rawSongId = params?.songId
  const songId =
    typeof rawSongId === 'number'
      ? rawSongId
      : typeof rawSongId === 'string' && /^\d+$/.test(rawSongId.trim())
        ? Number(rawSongId.trim())
        : 0
  const keywords = (params?.keywords || '').trim()
  if (!songId && !keywords) return null

  const durationSec =
    typeof params.durationSec === 'number' && params.durationSec > 0 ? params.durationSec : 0

  const ncm = getNcmApi()
  const base = ncmRequestOptions()

  let id = songId
  if (!id) {
    let searchRes
    try {
      searchRes = await ncm.search({
        keywords,
        limit: 10,
        type: 1,
        ...base
      })
    } catch (e) {
      console.warn('[netease lyrics] search', e?.message || e)
      return null
    }

    const songs = searchRes?.body?.result?.songs
    if (!Array.isArray(songs) || songs.length === 0) return null

    const normalize = (s) => (s || '').toLowerCase().replace(/[\s\-_()（）【】「」『』\[\]]/g, '').trim()
    const kwNorm = normalize(keywords)

    const scored = songs.map((s) => {
      const songName = normalize(s.name || '')
      const artistNames = (s.ar || s.artists || []).map((a) => normalize(a.name || '')).join(' ')
      const allText = songName + ' ' + artistNames

      let score = 0

      // Title match: exact or substring
      if (songName === kwNorm) score += 50
      else if (songName && kwNorm.includes(songName)) score += 35
      else if (songName && songName.includes(kwNorm)) score += 30
      else {
        // Character overlap ratio for partial matches
        const chars = new Set(kwNorm)
        let hits = 0
        for (const c of songName) { if (chars.has(c)) hits++ }
        score += (hits / Math.max(songName.length, 1)) * 20
      }

      // Check if any keyword token appears in the song name + artist
      const kwTokens = keywords.split(/\s+/).filter(Boolean)
      for (const tok of kwTokens) {
        if (allText.includes(normalize(tok))) score += 5
      }

      // Duration proximity bonus
      const diff = s.dt && s.dt > 0 && durationSec > 0
        ? Math.abs(s.dt / 1000 - durationSec)
        : Number.POSITIVE_INFINITY
      if (diff <= 3) score += 30
      else if (diff <= 10) score += 20
      else if (diff <= 30) score += 10
      else if (diff <= 45) score += 5
      else if (diff > 90) score -= 10

      return { song: s, score, diff }
    }).sort((a, b) => b.score - a.score)

    const best = scored[0]
    // Only accept if the match has a reasonable confidence
    if (!best || best.score < 15) {
      console.log(`[netease lyrics] No confident match (best score: ${best?.score ?? 0})`)
      return null
    }
    id = best.song?.id
  }
  if (!id) return null

  let lyricRes
  try {
    lyricRes = await ncm.lyric({ id, ...base })
  } catch (e) {
    console.warn('[netease lyrics] lyric', e?.message || e)
    return null
  }

  const lrc = lyricRes?.body?.lrc?.lyric?.trim()
  if (lrc) return lrc

  return null
}
