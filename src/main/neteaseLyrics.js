import { createRequire } from 'module'
import { buildNcmRequestOptions } from './neteaseAuth.js'
import { logLine } from './utils/logLine.js'

const require = createRequire(import.meta.url)
let iconvLite = null
try {
  iconvLite = require('iconv-lite')
} catch {
  iconvLite = null
}

function getNcmApi() {
  return require('@neteasecloudmusicapienhanced/api')
}

const TIME_TAG_REG = /\[(\d{2}):(\d{2})(\.|\:)(\d{2,3})\]/g
const MOJIBAKE_HINT_REG = /[锛鍚鎿璇銆鈥€]/u

function repairPossiblyMojibakeText(value) {
  const text = typeof value === 'string' ? value : String(value || '')
  if (!text || !MOJIBAKE_HINT_REG.test(text) || !iconvLite?.encode) return text
  try {
    const repaired = iconvLite.encode(text, 'cp936').toString('utf8').trim()
    return repaired || text
  } catch {
    return text
  }
}

function normalizeNeteaseLogValue(value) {
  if (typeof value === 'string') return repairPossiblyMojibakeText(value)
  if (Array.isArray(value)) return value.map((item) => normalizeNeteaseLogValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeNeteaseLogValue(item)])
    )
  }
  return value
}

function buildNeteaseErrorLogPayload(error) {
  const body = error?.response?.body ?? error?.body ?? null
  const status = error?.response?.status ?? error?.status ?? null
  const cookie =
    error?.response?.headers?.['set-cookie'] ??
    error?.headers?.['set-cookie'] ??
    error?.cookie ??
    undefined

  return normalizeNeteaseLogValue({
    status,
    body,
    message: error?.message || String(error || ''),
    ...(cookie ? { cookie } : {})
  })
}

function parseTimedLyric(raw) {
  const rows = []
  const byTime = new Map()

  for (const line of String(raw || '').split(/\r?\n/)) {
    const matches = [...line.matchAll(TIME_TAG_REG)]
    if (matches.length === 0) continue

    const text = line.replace(TIME_TAG_REG, '').trim()
    if (!text) continue

    const tagText = matches.map((m) => m[0]).join('')
    const primary = matches[0]
    const primaryMs =
      (Number(primary[1]) * 60 + Number(primary[2])) * 1000 +
      (primary[4].length === 3 ? Number(primary[4]) : Number(primary[4]) * 10)

    rows.push({ timeMs: primaryMs, tagText, text })

    for (const match of matches) {
      const ms =
        (Number(match[1]) * 60 + Number(match[2])) * 1000 +
        (match[4].length === 3 ? Number(match[4]) : Number(match[4]) * 10)
      if (!byTime.has(ms)) byTime.set(ms, text)
    }
  }

  return { rows, byTime }
}

function mergeTimedLyrics(mainLyrics, romajiLyrics, translatedLyrics) {
  const main = parseTimedLyric(mainLyrics)
  if (main.rows.length === 0) return ''

  const romaji = parseTimedLyric(romajiLyrics).byTime
  const translation = parseTimedLyric(translatedLyrics).byTime
  const merged = []

  for (const row of main.rows) {
    merged.push(`${row.tagText}${row.text}`)

    const seen = new Set([row.text])
    const extras = [romaji.get(row.timeMs), translation.get(row.timeMs)]
    for (const extra of extras) {
      const text = String(extra || '').trim()
      if (!text || seen.has(text)) continue
      merged.push(`${row.tagText}${text}`)
      seen.add(text)
    }
  }

  return merged.join('\n')
}

export async function searchNeteaseSongs(keywords, opts = {}) {
  if (!keywords || !keywords.trim()) return []
  const ncm = getNcmApi()
  const base = buildNcmRequestOptions(opts.cookie)
  try {
    const res = await ncm.cloudsearch({
      keywords: keywords.trim(),
      limit: 30,
      type: 1,
      ...base
    })
    const songs = res?.body?.result?.songs
    if (!Array.isArray(songs)) return []
    return songs.map((s) => ({
      id: s.id,
      name: s.name,
      artists: (s.ar || s.artists || []).map((a) => a.name).join(' / '),
      album: s.al?.name || s.album?.name || '',
      cover: s.al?.picUrl || s.album?.picUrl || null,
      duration: s.dt || 0,
      fee: s.fee || 0,
      alia: [].concat(s.alia || []).concat(s.alias || [])
    }))
  } catch (e) {
    logLine(`[neteaseLyrics] search error: ${JSON.stringify(buildNeteaseErrorLogPayload(e))}`)
    return []
  }
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
  const base = buildNcmRequestOptions(params?.cookie)

  let id = songId
  let confidence = songId ? 100 : 0
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
      logLine(`[netease lyrics] search ${JSON.stringify(buildNeteaseErrorLogPayload(e))}`)
      return null
    }

    const songs = searchRes?.body?.result?.songs
    if (!Array.isArray(songs) || songs.length === 0) return null

    const normalize = (s) =>
      (s || '')
        .toLowerCase()
        .replace(/[\s\-_()（）【】「」『』\[\]]/g, '')
        .trim()
    const kwNorm = normalize(keywords)

    const scored = songs
      .map((s) => {
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
          for (const c of songName) {
            if (chars.has(c)) hits++
          }
          score += (hits / Math.max(songName.length, 1)) * 20
        }

        // Check if any keyword token appears in the song name + artist
        const kwTokens = keywords.split(/\s+/).filter(Boolean)
        for (const tok of kwTokens) {
          const normTok = normalize(tok)
          if (!normTok) continue
          if (artistNames.includes(normTok))
            score += 40 // Artist match is extremely important
          else if (songName.includes(normTok)) score += 15
          else if (allText.includes(normTok)) score += 10
        }

        // Prefer original songs over covers/inst/english versions if possible
        const lowerName = (s.name || '').toLowerCase()
        const aliases = [].concat(s.alia || []).concat(s.alias || [])
        const searchStr = lowerName + ' ' + aliases.join(' ').toLowerCase()
        // 用原始标题（rawKeywords）判断用户意图，而非清理后的 keywords（remix/live 已被删掉）
        const rawKw = (params?.rawKeywords || keywords).toLowerCase()

        const versionRules = [
          { userTerms: ['cover', '翻唱', 'カバー'], resultTerms: ['cover', '翻唱'], penalty: -60, boost: +20 },
          { userTerms: ['remix', 'rmx'],             resultTerms: ['remix', 'rmx'],   penalty: -30, boost: +25 },
          { userTerms: ['live'],                      resultTerms: ['live'],           penalty: -20, boost: +20 },
          { userTerms: ['acoustic'],                  resultTerms: ['acoustic'],       penalty: -20, boost: +20 },
          { userTerms: ['inst', 'instrumental', '伴奏'], resultTerms: ['inst', 'karaoke', 'instrumental', '伴奏', 'off vocal'], penalty: -60, boost: +15 },
          { userTerms: ['english', 'eng'],            resultTerms: ['english', 'eng ver', 'english ver'], penalty: -80, boost: +10 },
        ]
        for (const rule of versionRules) {
          const userWants = rule.userTerms.some((t) => rawKw.includes(t))
          const resultHas = rule.resultTerms.some((t) => searchStr.includes(t))
          if (userWants && resultHas) score += rule.boost
          else if (userWants && !resultHas) score -= 8
          else if (!userWants && resultHas) score += rule.penalty
        }

        // Duration proximity bonus
        const diff =
          s.dt && s.dt > 0 && durationSec > 0
            ? Math.abs(s.dt / 1000 - durationSec)
            : Number.POSITIVE_INFINITY
        if (diff <= 3) score += 30
        else if (diff <= 10) score += 20
        else if (diff <= 30) score += 10
        else if (diff <= 45) score += 5
        else if (diff > 90) score -= 10

        return { song: s, score, diff }
      })
      .sort((a, b) => b.score - a.score)

    const best = scored[0]
    // Only accept if the match has a reasonable confidence
    if (!best || best.score < 30) {
      console.log(`[netease lyrics] No confident match (best score: ${best?.score ?? 0})`)
      return null
    }
    id = best.song?.id
    confidence = best.score
  }
  if (!id) return null

  let lyricRes
  try {
    lyricRes = await ncm.lyric({ id, ...base })
  } catch (e) {
    logLine(`[netease lyrics] lyric ${JSON.stringify(buildNeteaseErrorLogPayload(e))}`)
    return null
  }

  const lrc = lyricRes?.body?.lrc?.lyric?.trim()
  const tlyric = lyricRes?.body?.tlyric?.lyric?.trim()
  const romalrc = lyricRes?.body?.romalrc?.lyric?.trim()

  if (lrc) {
    const merged = mergeTimedLyrics(lrc, romalrc, tlyric)
    return { lrc: merged || lrc, confidence }
  }

  return null
}

/**
 * 获取网易云歌曲直接下载 URL（通过 NCM API song_url_v1）。
 * @param {number|string} songId  网易云歌曲 ID
 * @param {string} [level]        音质等级：standard / higher / exhigh / lossless / hires
 * @returns {Promise<{url:string, type:string, size:number, br:number}|null>}
 */
export async function getNeteaseSongDirectUrl(songId, level, opts = {}) {
  const id = typeof songId === 'number' ? songId : Number(songId)
  if (!id || !Number.isFinite(id)) return null

  const ncm = getNcmApi()
  const base = buildNcmRequestOptions(opts.cookie)
  const qualityLevel = level || 'exhigh'

  try {
    const res = await ncm.song_url_v1({ id, level: qualityLevel, ...base })
    const data = res?.body?.data
    if (!Array.isArray(data) || data.length === 0) return null
    const entry = data[0]
    if (!entry?.url) return null
    return {
      url: entry.url,
      type: entry.type || 'mp3',
      size: entry.size || 0,
      br: entry.br || 0
    }
  } catch (e) {
    logLine(`[neteaseLyrics] getSongDirectUrl error: ${JSON.stringify(buildNeteaseErrorLogPayload(e))}`)
    return null
  }
}
