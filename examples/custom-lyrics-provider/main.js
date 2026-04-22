/**
 * Custom Lyrics Provider — example main-process plugin.
 *
 * This code runs inside a Node.js VM sandbox in the main process.
 * `echo` is the scoped API object (storage, events, network, log).
 */

module.exports = {
  activate(echo) {
    echo.log.info('Custom lyrics provider activated')

    echo.events.on('lyrics:search', async (data) => {
      echo.log.info('Lyrics search request:', data)
    })

    echo.storage.set('activatedAt', Date.now())
  },

  deactivate(echo) {
    echo.log.info('Custom lyrics provider deactivated')
  }
}
