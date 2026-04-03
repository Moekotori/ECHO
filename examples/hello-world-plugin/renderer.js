/**
 * Hello World — example ECHO renderer plugin.
 *
 * This file is evaluated inside the renderer process.
 * `module.exports` must expose `activate(echo)` and optionally `deactivate(echo)`.
 * `React` is provided as a global by the plugin host.
 */

function HelloSidebarPanel() {
  var _React$useState = React.useState(0)
  var count = _React$useState[0]
  var setCount = _React$useState[1]

  return React.createElement(
    'div',
    { className: 'hello-plugin-panel' },
    React.createElement('h3', null, 'Hello World Plugin'),
    React.createElement('p', null, 'This panel was injected by a plugin.'),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'hello-plugin-btn',
        onClick: function () { setCount(count + 1) }
      },
      'Greetings sent: ' + count
    )
  )
}

// Simpler version without useState for maximum compatibility
function HelloSettingsPanel() {
  return React.createElement(
    'div',
    { className: 'hello-plugin-settings' },
    React.createElement('p', { style: { opacity: 0.7, fontSize: 13 } },
      'The Hello World plugin is active. This section was injected into settings by the plugin system.'
    )
  )
}

module.exports = {
  activate(echo) {
    echo.ui.registerSlot('sidebar', {
      component: HelloSidebarPanel,
      label: 'Hello World',
      order: 99
    })

    echo.ui.registerSlot('settingsPanel', {
      component: HelloSettingsPanel,
      label: 'Hello World Settings',
      order: 99
    })

    echo.hooks.on('app:ready', () => {
      console.log('[HelloPlugin] App is ready!')
    })

    console.log('[HelloPlugin] activated')
  },

  deactivate(echo) {
    echo.ui.unregisterAll()
    console.log('[HelloPlugin] deactivated')
  }
}
