# ECHO Plugin Development Guide

## Overview

ECHO supports a plugin system that lets you extend the player with custom music sources, lyrics providers, UI panels, and more. Plugins run in a sandboxed environment with a controlled API surface.

## Plugin Structure

Each plugin is a folder with at least a `plugin.json` manifest:

```
my-plugin/
  plugin.json          # Required: plugin manifest
  main.js              # Optional: main-process code (Node.js sandbox)
  renderer.js          # Optional: renderer-process code (browser)
  styles.css           # Optional: CSS styles
  locales/             # Optional: i18n translation files
    en.json
    zh.json
    ja.json
  icon.png             # Optional: plugin icon
```

## plugin.json Manifest

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "author": "Your Name",
  "license": "MIT",
  "echoVersion": ">=1.0.0",
  "main": "main.js",
  "renderer": "renderer.js",
  "styles": "styles.css",
  "permissions": ["network", "storage"],
  "contributes": {
    "musicSource": true,
    "lyricsProvider": true,
    "settings": [
      { "id": "apiUrl", "type": "string", "default": "", "label": "API URL" }
    ],
    "uiSlots": ["sidebar", "settingsPanel"]
  }
}
```

### Required Fields

| Field     | Type   | Description                                                |
|-----------|--------|------------------------------------------------------------|
| `id`      | string | Unique ID (lowercase, alphanumeric, dots/hyphens/underscores) |
| `name`    | string | Display name                                                |
| `version` | string | Semantic version                                            |

### Optional Fields

| Field          | Type     | Description                                     |
|----------------|----------|-------------------------------------------------|
| `description`  | string   | Short description                               |
| `author`       | string   | Author name                                     |
| `license`      | string   | License identifier                              |
| `echoVersion`  | string   | Minimum ECHO version required                   |
| `main`         | string   | Main-process entry file                         |
| `renderer`     | string   | Renderer-process entry file                     |
| `styles`       | string   | CSS file to inject                              |
| `permissions`  | string[] | Required permissions (see below)                |
| `contributes`  | object   | What this plugin provides                       |

### Permissions

| Permission      | Grants                                    |
|-----------------|-------------------------------------------|
| `network`       | HTTP requests from main process           |
| `storage`       | Persistent key-value storage              |
| `ui:sidebar`    | Inject UI into the sidebar                |
| `ui:settings`   | Inject UI into settings page              |
| `ui:playerBar`  | Inject UI near the player controls        |

## Main-Process Plugins (main.js)

Main-process code runs inside a Node.js `vm` sandbox. You have no access to `require`, `fs`, `child_process`, or any Node.js built-ins directly. Instead, use the provided `echo` API.

```javascript
module.exports = {
  activate(echo) {
    // Called when plugin is enabled
    echo.log.info('Plugin activated!')

    // Use storage
    echo.storage.set('key', 'value')
    const val = echo.storage.get('key')

    // Listen to events
    echo.events.on('plugin:myEvent', (data) => {
      echo.log.info('Received:', data)
    })

    // Network (requires "network" permission)
    if (echo.network) {
      echo.network.fetch('https://api.example.com/data')
        .then(res => echo.log.info('Response:', res.status))
    }
  },

  deactivate(echo) {
    // Called when plugin is disabled — clean up resources
    echo.log.info('Plugin deactivated')
  }
}
```

### Main-Process API Reference

#### `echo.storage`

| Method                 | Description                    |
|------------------------|--------------------------------|
| `get(key)`             | Get a stored value             |
| `set(key, value)`      | Store a value                  |
| `getAll()`             | Get all stored key-value pairs |
| `remove(key)`          | Remove a stored key            |

#### `echo.events`

| Method                     | Description                |
|----------------------------|----------------------------|
| `on(name, handler)`        | Listen for an event        |
| `off(name, handler)`       | Remove a listener          |
| `emit(name, data)`         | Emit an event              |

#### `echo.network` (requires `network` permission)

| Method                      | Description              |
|-----------------------------|--------------------------|
| `fetch(url, options?)`      | HTTP request (returns `{ ok, status, headers, text, json() }`) |

#### `echo.log`

| Method                | Description         |
|-----------------------|---------------------|
| `info(...args)`       | Log info            |
| `warn(...args)`       | Log warning         |
| `error(...args)`      | Log error           |

## Renderer-Process Plugins (renderer.js)

Renderer code runs in the browser context. `React` is provided as a global. Use `module.exports` to export `activate` and `deactivate`.

```javascript
function MyPanel() {
  return React.createElement('div', { className: 'my-panel' },
    React.createElement('h3', null, 'My Plugin'),
    React.createElement('p', null, 'Hello from a plugin!')
  )
}

module.exports = {
  activate(echo) {
    // Register a UI component in the sidebar
    echo.ui.registerSlot('sidebar', {
      component: MyPanel,
      label: 'My Plugin',
      order: 50
    })

    // Listen to hooks
    echo.hooks.on('track:didPlay', (data) => {
      console.log('Now playing:', data)
    })

    // Intercept hooks (waterfall)
    echo.hooks.tap('track:willPlay', async (ctx) => {
      // Modify context or return { __cancel: true } to stop
      return { ...ctx, modified: true }
    }, 10)
  },

  deactivate(echo) {
    echo.ui.unregisterAll()
  }
}
```

### Renderer API Reference

#### `echo.ui`

| Method                            | Description                            |
|-----------------------------------|----------------------------------------|
| `registerSlot(name, config)`      | Register a component in a UI slot      |
| `unregisterSlot(name)`            | Remove component from a slot           |
| `unregisterAll()`                 | Remove all registered components       |
| `showNotification(msg, opts?)`    | Show a notification                    |
| `registerSettingsSection(config)` | Add a section to settings              |

#### Slot Names

| Slot Name        | Location                          |
|------------------|-----------------------------------|
| `sidebar`        | Bottom of the library sidebar     |
| `settingsPanel`  | Settings page (before danger zone)|
| `drawers`        | Overlay area for drawer panels    |
| `playerBar`      | Near player controls              |

#### Slot Config

```javascript
{
  component: ReactComponent,  // React component (receives { context, pluginId } props)
  label: 'Display name',      // For accessibility
  icon: 'music',              // Optional icon name
  order: 50                   // Sort order (lower = earlier)
}
```

#### `echo.hooks`

| Method                               | Description                        |
|--------------------------------------|------------------------------------|
| `tap(hookName, handler, priority?)`  | Register an interceptable handler  |
| `on(eventName, handler)`             | Listen to a notification event     |
| `off(eventName, handler)`            | Remove a listener                  |

#### Available Hooks

| Hook Name          | Type       | Context                               |
|--------------------|------------|---------------------------------------|
| `track:willPlay`   | Waterfall  | `{ track, url }` — can modify or cancel |
| `track:didPlay`    | Notify     | `{ track }`                           |
| `track:willPause`  | Waterfall  | `{ track }`                           |
| `track:ended`      | Notify     | `{ track }`                           |
| `lyrics:willFetch` | Waterfall  | `{ track, source }` — provide lyrics  |
| `lyrics:didFetch`  | Waterfall  | `{ track, lyrics }` — modify lyrics   |
| `playlist:willAdd` | Waterfall  | `{ tracks }` — filter/modify          |
| `ui:themeChanged`  | Notify     | `{ theme, colors }`                   |
| `config:changed`   | Notify     | `{ config }`                          |
| `app:ready`        | Notify     | `{}`                                  |

#### `echo.storage` (renderer-side, uses localStorage)

Same API as main-process storage, scoped per plugin.

#### `echo.musicSource`

```javascript
echo.musicSource.register({
  id: 'my-source',
  name: 'My Music Source',
  icon: 'music',
  async search(query) {
    return [{ id: '1', title: 'Song', artist: 'Artist', url: '...' }]
  },
  async getTrack(id) { ... },
  async getPlaylist(id) { ... },
  async resolveStreamUrl(track) { ... }
})
```

#### `echo.lyricsProvider`

```javascript
echo.lyricsProvider.register({
  id: 'my-lyrics',
  name: 'My Lyrics Source',
  priority: 5,
  async search(track) {
    return [{ id: '1', title: track.title, artist: track.artist }]
  },
  async fetch(lyricsId) {
    return { text: '[00:00.00] Lyrics here...' }
  }
})
```

#### `echo.network`

```javascript
const res = await echo.network.fetch('https://api.example.com/data')
const data = await res.json()
```

#### `echo.app` (read-only)

| Property   | Description              |
|------------|--------------------------|
| `version`  | ECHO app version string  |
| `locale`   | Current UI locale        |

## Installation

### For Users

1. Download or create a plugin folder
2. Open ECHO → Click the **Plugins** (puzzle piece) icon in the title bar
3. Click **Install** and select the plugin folder, OR
4. Click **Open Folder** and copy the plugin folder into the plugins directory
5. Toggle the plugin on/off with the switch

### For Developers

During development, you can symlink your plugin folder into the plugins directory:

```bash
# Windows
mklink /D "%APPDATA%\echoes\plugins\my-plugin" "C:\path\to\my-plugin"

# macOS
ln -s /path/to/my-plugin ~/Library/Application\ Support/echoes/plugins/my-plugin

# Linux
ln -s /path/to/my-plugin ~/.config/echoes/plugins/my-plugin
```

## Security Model

| Layer              | Protection                                                     |
|--------------------|----------------------------------------------------------------|
| Main-process code  | Runs in Node.js `vm` sandbox; no `require`/`fs`/`child_process` |
| Renderer code      | Receives controlled `echo` API; no direct `window.api` access  |
| Permissions        | Declared in manifest; shown to user before install              |
| Storage            | Each plugin has isolated namespace                              |
| UI                 | Wrapped in React ErrorBoundary; crashes don't affect host       |

## Examples

See the `examples/` directory:

- **`hello-world-plugin/`** — Minimal plugin with sidebar panel and settings injection
- **`custom-lyrics-provider/`** — Main-process plugin registering a lyrics provider
