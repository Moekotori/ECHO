/** Heuristic: same-timestamp LRC lines → main / 罗马音 / 中文翻译 */
function classifyLine(t) {
  const s = (t || '').trim()
  if (!s) return 'skip'
  const hasCJK = /[\u4e00-\u9fff]/.test(s)
  const hasKana = /[\u3040-\u30ff\u31f0-\u31ff]/.test(s)
  if (hasCJK && !hasKana) return 'translation'
  const latin = (s.match(/[a-zA-Z]/g) || []).length
  const nonSpace = s.replace(/\s/g, '').length || 1
  if (latin / nonSpace > 0.45 && !hasKana) return 'romaji'
  return 'main'
}

export function parseLRC(lrcString) {
  const lines = lrcString.split('\n')
  const timeReg = /\[(\d{2}):(\d{2})(\.|\:)(\d{2,3})\]/
  const raw = []

  for (const line of lines) {
    const match = timeReg.exec(line)
    if (!match) continue
    const minutes = parseInt(match[1], 10)
    const seconds = parseInt(match[2], 10)
    const ms = parseInt(match[4], 10)
    const time = minutes * 60 + seconds + ms / (match[4].length === 3 ? 1000 : 100)
    const text = line.replace(timeReg, '').trim()
    if (text) raw.push({ time, text })
  }

  raw.sort((a, b) => a.time - b.time || 0)

  const out = []
  for (const row of raw) {
    const last = out[out.length - 1]
    if (last && last.time === row.time) {
      const kind = classifyLine(row.text)
      if (kind === 'romaji' && !last.romaji) last.romaji = row.text
      else if (kind === 'translation' && !last.translation) last.translation = row.text
      else if (!last.romaji) last.romaji = row.text
      else if (!last.translation) last.translation = row.text
    } else {
      out.push({ time: row.time, text: row.text })
    }
  }

  return out
}

export function parsePlainLyrics(lyricsString) {
  if (!lyricsString) return []

  const lines = lyricsString
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^\[(ar|ti|al|by|offset|re|ve):/i.test(line) &&
        !/^\[\d{2}:\d{2}(?:[.:]\d{2,3})?\]$/i.test(line)
    )

  return lines.map((text, idx) => ({ time: idx * 3.5, text }))
}

export function parseAnyLyrics(lyricsString) {
  if (!lyricsString || !lyricsString.trim()) return []
  const lrcParsed = parseLRC(lyricsString)
  if (lrcParsed.length > 0) return lrcParsed
  return parsePlainLyrics(lyricsString)
}
