function buildOsuQuery(context) {
  var parts = []
  var title = typeof context.title === 'string' ? context.title.trim() : ''
  var artist = typeof context.artist === 'string' ? context.artist.trim() : ''

  if (title) parts.push(title)
  if (artist && artist !== 'Unknown Artist') parts.push(artist)

  return parts.join(' ').trim()
}

function buildSearchUrl(query) {
  return 'https://osu.ppy.sh/beatmapsets?q=' + encodeURIComponent(query)
}

function OsuSearchButton(props) {
  var context = props.context || {}
  var query = buildOsuQuery(context)
  var disabled = !query
  var title = disabled ? 'Play a track first to search osu!' : 'Search osu! beatmaps for: ' + query

  return React.createElement(
    'button',
    {
      type: 'button',
      className: 'btn btn--transport osu-plugin-btn',
      style: { width: 40, height: 40 },
      disabled: disabled,
      title: title,
      'aria-label': title,
      onClick: function () {
        if (disabled) return
        window.open(buildSearchUrl(query), '_blank', 'noopener,noreferrer')
      }
    },
    React.createElement(
      'span',
      { className: 'osu-plugin-btn-label', 'aria-hidden': 'true' },
      'osu!'
    )
  )
}

module.exports = {
  activate: function (echo) {
    echo.ui.registerSlot('playerTransportExtras', {
      component: OsuSearchButton,
      label: 'osu! Beatmap Search',
      order: 60
    })
    console.log('[osu-beatmap-search] activated')
  },

  deactivate: function (echo) {
    echo.ui.unregisterAll()
    console.log('[osu-beatmap-search] deactivated')
  }
}
