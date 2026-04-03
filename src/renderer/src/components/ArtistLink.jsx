import { getArtistInfoUrl } from '../utils/links'
import { openExternalUrl } from '../utils/openExternal'

export function ArtistLink({ artist, className = '', stopPropagation = false }) {
  const displayArtist = (artist || 'Unknown Artist').trim()
  const isUnknown = !displayArtist || displayArtist === 'Unknown Artist'

  if (isUnknown) {
    return <span className={className || ''}>Unknown Artist</span>
  }

  const openArtistPage = (e) => {
    if (stopPropagation) e.stopPropagation()
    e.preventDefault()
    openExternalUrl(getArtistInfoUrl(displayArtist))
  }

  return (
    <span
      role="link"
      tabIndex={0}
      className={`artist-link ${className}`.trim()}
      title={`View ${displayArtist} details`}
      onClick={openArtistPage}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          openArtistPage(e)
        }
      }}
    >
      {displayArtist}
    </span>
  )
}
