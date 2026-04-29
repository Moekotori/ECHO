const GENERIC_ALBUM_ARTIST_NAMES = new Set([
  '',
  'unknown',
  'unknownartist',
  'various',
  'variousartists',
  'va',
  'v.a',
  'compilation',
  'compilations',
  'soundtrack',
  'originalsoundtrack',
  'ost'
])

function normalizeArtistToken(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function normalizeAlbumKey(value) {
  return String(value || 'Singles')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
}

function getTrackCoverCandidate(track, trackMetaMap = {}, albumCoverMap = {}) {
  const meta = trackMetaMap[track?.path] || {}
  const albumName = track?.info?.album || meta.album || 'Singles'
  const cover =
    meta.cover ||
    track?.info?.cover ||
    (albumName ? albumCoverMap[albumName] : null) ||
    null
  if (!cover) return null
  return {
    cover,
    source: meta.cover ? 'trackMeta' : track?.info?.cover ? 'trackInfo' : 'album'
  }
}

function coverFingerprint(cover) {
  const value = String(cover || '')
  if (!value) return ''
  return `${value.length}:${value.slice(0, 128)}:${value.slice(-128)}`
}

function isGenericAlbumArtist(value) {
  return GENERIC_ALBUM_ARTIST_NAMES.has(normalizeArtistToken(value))
}

function getArtistAvatarInitials(name) {
  const normalized = String(name || '')
    .normalize('NFKC')
    .trim()
  const letters = Array.from(normalized.replace(/[^\p{L}\p{N}]+/gu, ''))
  if (letters.length === 0) return '?'
  return letters.slice(0, 2).join('').toUpperCase()
}

function getArtistAvatarHue(name) {
  const value = String(name || '')
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 360
  }
  return hash
}

function getArtistTrackScore(track, artistName, trackMetaMap, albumArtistCountByAlbum) {
  const meta = trackMetaMap[track?.path] || {}
  const artistToken = normalizeArtistToken(artistName)
  const trackArtistToken = normalizeArtistToken(meta.artist || track?.info?.artist)
  const albumArtist = meta.albumArtist || track?.info?.albumArtist || ''
  const albumArtistToken = normalizeArtistToken(albumArtist)
  const albumKey = normalizeAlbumKey(meta.album || track?.info?.album || 'Singles')
  const albumArtistCount = albumArtistCountByAlbum.get(albumKey) || 0

  if (albumArtistToken && !isGenericAlbumArtist(albumArtist)) {
    return albumArtistToken === artistToken ? 80 : -100
  }
  if (trackArtistToken !== artistToken) return -100
  if (albumArtistCount > 1) return 10
  return 50
}

export function buildArtistBucketsWithAvatars(
  tracks,
  { unknownArtist = 'Unknown Artist', trackMetaMap = {}, albumCoverMap = {}, artistAvatarMap = {} } = {}
) {
  const groups = new Map()
  const albumArtistSets = new Map()
  const coverArtistSets = new Map()

  for (const track of Array.isArray(tracks) ? tracks : []) {
    const artistName = track?.info?.artist || unknownArtist
    if (!groups.has(artistName)) groups.set(artistName, { name: artistName, tracks: [] })
    groups.get(artistName).tracks.push(track)

    const albumKey = normalizeAlbumKey(track?.info?.album || 'Singles')
    if (!albumArtistSets.has(albumKey)) albumArtistSets.set(albumKey, new Set())
    const artistToken = normalizeArtistToken(artistName)
    if (artistToken && artistName !== unknownArtist) albumArtistSets.get(albumKey).add(artistToken)

    const coverCandidate = getTrackCoverCandidate(track, trackMetaMap, albumCoverMap)
    const fingerprint = coverFingerprint(coverCandidate?.cover)
    if (fingerprint) {
      if (!coverArtistSets.has(fingerprint)) coverArtistSets.set(fingerprint, new Set())
      coverArtistSets.get(fingerprint).add(artistName)
    }
  }

  const albumArtistCountByAlbum = new Map(
    Array.from(albumArtistSets.entries()).map(([albumKey, artistSet]) => [albumKey, artistSet.size])
  )

  const buckets = Array.from(groups.values()).map((artist) => {
    let best = null

    for (const track of artist.tracks) {
      const coverCandidate = getTrackCoverCandidate(track, trackMetaMap, albumCoverMap)
      if (!coverCandidate?.cover) continue
      const fingerprint = coverFingerprint(coverCandidate.cover)
      const sharedArtistCount = coverArtistSets.get(fingerprint)?.size || 0
      if (sharedArtistCount > 1) continue

      const ownershipScore = getArtistTrackScore(
        track,
        artist.name,
        trackMetaMap,
        albumArtistCountByAlbum
      )
      if (ownershipScore < 0) continue

      const score =
        ownershipScore +
        (coverCandidate.source === 'trackMeta' ? 12 : coverCandidate.source === 'trackInfo' ? 8 : 0)
      if (!best || score > best.score) {
        best = { cover: coverCandidate.cover, score }
      }
    }

    return {
      ...artist,
      cover: best?.cover || artistAvatarMap[artist.name] || null,
      hasLocalCover: !!best?.cover,
      hasRemoteAvatar: !best?.cover && !!artistAvatarMap[artist.name],
      avatarInitials: getArtistAvatarInitials(artist.name),
      avatarHue: getArtistAvatarHue(artist.name)
    }
  })

  return buckets.sort(
    (a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name)
  )
}
