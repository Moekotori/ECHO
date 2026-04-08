/**
 * LRCLIB (and similar) search-result ranking: same heuristics as legacy App.jsx logic.
 */

import { parseAnyLyrics } from './lyricsParse'

const TIME_TAG_REG = /\[(\d{2}):(\d{2})(\.|\:)(\d{2,3})\]/g

function readLyricText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
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
    const first = matches[0]
    const timeMs =
      (Number(first[1]) * 60 + Number(first[2])) * 1000 +
      (first[4].length === 3 ? Number(first[4]) : Number(first[4]) * 10)

    rows.push({ timeMs, tagText, text })

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
  if (main.rows.length === 0) return mainLyrics || ''

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

function buildCandidateLyricsText(item) {
  const synced = readLyricText(item?.syncedLyrics, item?.synced_lyrics)
  const plain = readLyricText(item?.plainLyrics, item?.plain_lyrics, item?.lyrics)
  const base = synced || plain
  if (!base) return ''

  const romaji = readLyricText(
    item?.romajiLyrics,
    item?.romaji_lyrics,
    item?.romanizedLyrics,
    item?.romanized_lyrics
  )
  const translation = readLyricText(
    item?.translatedLyrics,
    item?.translated_lyrics,
    item?.translationLyrics,
    item?.translation_lyrics
  )

  return mergeTimedLyrics(base, romaji, translation)
}

function stripTitleNoise(rawTitle = '') {
  if (!rawTitle) return ''
  let s = rawTitle
  s = s.replace(/【[^】]*】/g, ' ')
  s = s.replace(/〖[^〗]*〗/g, ' ')
  s = s.replace(/\(.*?翻唱.*?\)|（.*?翻唱.*?）/gi, '')
  s = s.replace(/\bcover\b/gi, '')
  s = s.replace(/翻唱/gi, '')
  s = s.replace(/\bremix\b/gi, '')
  s = s.replace(/\blive\b/gi, '')
  s = s.replace(/\bver\.?\b/gi, '')
  s = s.replace(/\bversion\b/gi, '')
  s = s.replace(/\bfeat\.?\b/gi, '')
  s = s.replace(/\bft\.?\b/gi, '')
  s = s.replace(/\[.*?\]/g, '')
  s = s.replace(/[《》]/g, ' ')
  s = s.replace(/\(.*?\)/g, '')
  s = s.replace(/[~`"'·、，。]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

export function normalizeLyricCompareText(raw = '') {
  return stripTitleNoise(String(raw || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeLyricCompareText(raw = '') {
  const norm = normalizeLyricCompareText(raw)
  const wordTokens = norm
    .split(' ')
    .map((x) => x.trim())
    .filter(Boolean)
  const cjkChars = norm
    .replace(/[a-z0-9\s]/gi, '')
    .split('')
    .filter(Boolean)
  if (cjkChars.length >= 2) {
    const bigrams = []
    for (let i = 0; i < cjkChars.length - 1; i++) {
      bigrams.push(cjkChars[i] + cjkChars[i + 1])
    }
    return [...new Set([...wordTokens, ...cjkChars, ...bigrams])]
  }
  return wordTokens
}

export function compareLyricTextSimilarity(aRaw = '', bRaw = '') {
  const a = normalizeLyricCompareText(aRaw)
  const b = normalizeLyricCompareText(bRaw)
  if (!a || !b) return 0
  if (a === b) return 1

  const aTokens = new Set(tokenizeLyricCompareText(a))
  const bTokens = new Set(tokenizeLyricCompareText(b))
  if (aTokens.size === 0 || bTokens.size === 0) return 0

  let common = 0
  for (const t of aTokens) {
    if (bTokens.has(t)) common += 1
  }
  const totalSize = aTokens.size + bTokens.size
  let score = (2 * common) / totalSize

  if (a.includes(b) || b.includes(a)) {
    const minLen = Math.min(a.length, b.length)
    const maxLen = Math.max(a.length, b.length)
    const containBoost = Math.min(0.96, (minLen / Math.max(1, maxLen)) * 0.9 + 0.05)
    score = Math.max(score, containBoost)
  }

  if (a.length < 12 && b.length < 12) {
    const maxLen = Math.max(a.length, b.length)
    const m = a.length
    const n = b.length
    const dp = Array.from({ length: m + 1 }, (_, i) => {
      const row = new Array(n + 1)
      row[0] = i
      return row
    })
    for (let j = 0; j <= n; j++) dp[0][j] = j
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
    const dist = dp[m][n]
    const editRatio = 1 - dist / maxLen
    score = Math.max(score, editRatio)
  }

  return Math.min(1, Math.max(0, score))
}

function scoreSyncedTimingFit(lyricsText, audioDuration) {
  const hasAudioDur = Number.isFinite(audioDuration) && audioDuration > 0
  if (!hasAudioDur) return 0
  const rows = parseAnyLyrics(lyricsText)
  if (!rows || rows.length < 3) return 0
  const firstT = Number(rows[0]?.time)
  const lastT = Number(rows[rows.length - 1]?.time)
  if (!Number.isFinite(firstT) || !Number.isFinite(lastT)) return 0

  let fit = 0
  const endDiff = Math.abs(lastT - audioDuration)
  if (endDiff <= 6) fit += 14
  else if (endDiff <= 12) fit += 10
  else if (endDiff <= 24) fit += 5
  else if (endDiff >= 90) fit -= 8

  if (firstT > 18) fit -= 6
  if (lastT < audioDuration * 0.45) fit -= 10
  if (lastT > audioDuration + 40) fit -= 6

  return fit
}

/**
 * @param {unknown} payload - LRCLIB get JSON or search array
 * @param {number} audioDuration
 * @param {{ titleCandidates?: string[], artistCandidates?: string[] }} options
 * @returns {Array<{ item: object, chosenLyrics: string, synced: boolean, diff: number, titleSim: number, artistSim: number, score: number }>}
 */
export function rankLrcLibCandidates(payload, audioDuration, options = {}) {
  if (!payload) return []

  const candidates = Array.isArray(payload) ? payload : [payload]
  const expectedTitles = [...new Set((options.titleCandidates || []).map(normalizeLyricCompareText))]
    .filter(Boolean)
    .slice(0, 8)

  const expandArtistCandidates = (arr) => {
    const out = []
    for (const raw of arr || []) {
      const s = String(raw || '').trim()
      if (!s) continue
      out.push(s)
      s.split(/[,/&+]| feat\.?| ft\.?| x /i)
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .forEach((x) => out.push(x))
    }
    return out
  }

  const expectedArtists = [...new Set(expandArtistCandidates(options.artistCandidates).map(normalizeLyricCompareText))]
    .filter(Boolean)
    .slice(0, 12)

  const scored = candidates
    .map((item) => {
      const synced = readLyricText(item?.syncedLyrics, item?.synced_lyrics)
      const chosenLyrics = buildCandidateLyricsText(item)
      if (!chosenLyrics) return null

      const candTitle =
        item?.trackName || item?.track_name || item?.title || item?.name || item?.song || ''
      const candArtist =
        item?.artistName || item?.artist_name || item?.artist || item?.artists || ''

      const titleSim =
        expectedTitles.length > 0
          ? Math.max(...expectedTitles.map((t) => compareLyricTextSimilarity(candTitle, t)))
          : 0
      const artistSim =
        expectedArtists.length > 0
          ? Math.max(...expectedArtists.map((a) => compareLyricTextSimilarity(candArtist, a)))
          : 0

      const dur = Number(item?.duration)
      const hasDur = Number.isFinite(dur) && dur > 0
      const hasAudioDur = Number.isFinite(audioDuration) && audioDuration > 0
      const diff = hasDur && hasAudioDur ? Math.abs(dur - audioDuration) : Number.POSITIVE_INFINITY

      let score = 0
      score += synced ? 26 : 10

      if (hasDur && hasAudioDur) {
        const durationScore = Math.max(0, 1 - Math.min(diff, 90) / 90)
        score += durationScore * 35
        if (diff > 140) score -= 12
      }

      const expectedTitleLen = expectedTitles.length > 0 ? expectedTitles[0].length : 0
      const isShortTitle = expectedTitleLen > 0 && expectedTitleLen <= 4

      if (expectedTitles.length > 0) {
        score += titleSim * (isShortTitle ? 16 : 28)
        if (titleSim < 0.08) score -= 8
      }

      if (expectedArtists.length > 0) {
        score += artistSim * (isShortTitle ? 30 : 16)
        if (artistSim < 0.08) score -= 6
        if (isShortTitle && artistSim < 0.34) score -= 18
      }

      if (synced && (titleSim > 0.65 || artistSim > 0.65)) score += 8
      if (!synced && titleSim < 0.2 && artistSim < 0.2) score -= 10
      if (synced) score += scoreSyncedTimingFit(chosenLyrics, audioDuration)

      return { item, chosenLyrics, synced: !!synced, diff, titleSim, artistSim, score }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.synced !== a.synced) return b.synced ? 1 : -1
      return a.diff - b.diff
    })

  return scored
}

const MIN_CONFIDENCE = 18

/**
 * @returns {string} LRC text or ''
 */
export function pickLyricsFromLrcLibResult(payload, audioDuration, options = {}) {
  const scored = rankLrcLibCandidates(payload, audioDuration, options)
  const best = scored[0]
  if (best) {
    console.log(
      `[Lyrics] Best candidate: score=${best.score.toFixed(2)}, titleSim=${best.titleSim.toFixed(2)}, artistSim=${best.artistSim.toFixed(2)}, diff=${Number.isFinite(best.diff) ? best.diff.toFixed(1) : 'n/a'}s`
    )
    if (best.score < MIN_CONFIDENCE) {
      console.log(`[Lyrics] Rejected: score ${best.score.toFixed(2)} < threshold ${MIN_CONFIDENCE}`)
      return ''
    }
    if (best.titleSim < 0.15 && best.artistSim < 0.15) {
      console.log(
        `[Lyrics] Rejected: titleSim=${best.titleSim.toFixed(2)} & artistSim=${best.artistSim.toFixed(2)} both too low`
      )
      return ''
    }
    return best.chosenLyrics
  }
  return ''
}
