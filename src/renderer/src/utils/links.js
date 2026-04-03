/** Last.fm 深层 /music/… 路径对多字节与异常元数据易触发防火墙 406；统一走搜索页更稳。 */
export const getArtistInfoUrl = (artist = '') => {
  const q = artist.trim()
  if (!q) return 'https://www.last.fm/'
  return `https://www.last.fm/search?q=${encodeURIComponent(q)}`
}

export const getAlbumInfoUrl = (artist = '', album = '', title = '') => {
  const safeArtist = (artist || '').trim()
  const safeAlbum = (album || '').trim()
  const safeTitle = (title || '').trim()
  const isUnknownAlbum = !safeAlbum || safeAlbum === 'Unknown Album'
  const isUnknownArtist = !safeArtist || safeArtist === 'Unknown Artist'

  if (!isUnknownAlbum && !isUnknownArtist) {
    const q = [safeArtist, safeAlbum].filter(Boolean).join(' ')
    return `https://www.last.fm/search/albums?q=${encodeURIComponent(q)}`
  }

  const q = [safeArtist, safeAlbum, safeTitle].filter(Boolean).join(' ')
  return `https://www.last.fm/search/albums?q=${encodeURIComponent(q)}`
}
