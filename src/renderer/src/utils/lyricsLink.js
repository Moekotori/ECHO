function toUrl(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text) return null
  try {
    return new URL(text)
  } catch {
    return null
  }
}

export function parseLyricsSourceLink(raw) {
  const url = toUrl(raw)
  if (!url) return null

  const host = url.hostname.toLowerCase()
  const full = `${host}${url.pathname}${url.search}${url.hash}`

  // NetEase Cloud Music
  if (host.includes('music.163.com') || host.includes('163cn.tv')) {
    const idFromQuery = url.searchParams.get('id')
    if (idFromQuery && /^\d+$/.test(idFromQuery)) {
      return { provider: 'netease', songId: idFromQuery, url: url.toString() }
    }
    const m = full.match(/song\/(\d{5,})/i)
    if (m?.[1]) return { provider: 'netease', songId: m[1], url: url.toString() }
  }

  // QQ Music
  if (host.includes('qq.com')) {
    const songMid =
      url.searchParams.get('songmid') || full.match(/songDetail\/([A-Za-z0-9]+)/i)?.[1]
    if (songMid) return { provider: 'qq', songId: songMid, url: url.toString() }
  }

  // Kugou
  if (host.includes('kugou.com')) {
    const hash = url.searchParams.get('hash') || full.match(/hash=([A-Fa-f0-9]{8,})/i)?.[1]
    if (hash) return { provider: 'kugou', songId: hash, url: url.toString() }
  }

  // Kuwo
  if (host.includes('kuwo.cn')) {
    const m = full.match(/play_detail\/(\d{3,})/i)
    if (m?.[1]) return { provider: 'kuwo', songId: m[1], url: url.toString() }
  }

  return { provider: 'unknown', songId: '', url: url.toString() }
}
