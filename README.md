<div align="center">

<h1>ECHO</h1>

<p>A modern, feature-rich desktop music player built with Electron and React.</p>

<p>
  <a href="https://github.com/Moekotori/Echoes/releases/latest">
    <img src="https://img.shields.io/github/v/release/Moekotori/Echoes?label=release&color=blue" alt="Latest Release">
  </a>
  <a href="https://github.com/Moekotori/Echoes/releases">
    <img src="https://img.shields.io/github/downloads/Moekotori/Echoes/total?color=brightgreen" alt="Downloads">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/electron-31.x-47848f" alt="Electron">
  <img src="https://img.shields.io/badge/react-18-61dafb" alt="React">
</p>

<p>
  <a href="https://github.com/Moekotori/Echoes/releases/latest">
    <strong>Download latest release</strong>
  </a>
  &nbsp;&middot;&nbsp;
  <a href="docs/plugin-development.md">Plugin Development</a>
  &nbsp;&middot;&nbsp;
  <a href="#getting-started">Getting Started</a>
</p>

</div>

---

---

---

## Overview

ECHO is a cross-platform desktop music player focused on audio quality, extensibility, and a clean listening experience. It provides a native audio pipeline for high-fidelity local playback, an integrated lyrics system, MV playback via YouTube and Bilibili, and a plugin architecture for extending core functionality.

---

## Feature Highlights

<table>
  <tr>
    <td valign="top" width="50%">
      <b>HiFi Audio Engine</b><br>
      Out-of-process native audio host (<code>echo-audio-host</code>) for low-latency, high-fidelity playback. WASAPI Exclusive Mode for bit-perfect output on Windows. Parametric EQ with pre-amp, applied in real time.
    </td>
    <td valign="top" width="50%">
      <b>Synchronized Lyrics</b><br>
      Line-by-line and word-level karaoke highlight for LRC files. NetEase lyrics auto-fetch and manual candidate search. Japanese romaji conversion via Kuroshiro. Floating desktop overlay window.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>Music Video</b><br>
      Auto-match and play YouTube or Bilibili MV alongside playback. Quality selection, direct stream support, and full-screen MV-as-background mode.
    </td>
    <td valign="top">
      <b>Listen Together</b><br>
      Room-based synchronized co-listening via a self-hosted WebSocket server. Optional token authentication. DLNA cast to network renderers.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>Media Download</b><br>
      Download audio from YouTube, Bilibili, and SoundCloud. NetEase playlist import. Metadata and cover art written automatically.
    </td>
    <td valign="top">
      <b>Plugin System</b><br>
      First-class extensibility via a sandboxed plugin API. Plugins can contribute music sources, lyrics providers, UI panels, and more.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>Theming</b><br>
      Full CSS variable-based theme engine with an in-app editor. Import, export, and audit themes via built-in tooling.
    </td>
    <td valign="top">
      <b>Auto-Update</b><br>
      GitHub Releases-based OTA updates via <code>electron-updater</code>. Background download with a restart prompt. Manual check available in Settings.
    </td>
  </tr>
</table>

---

## Additional Features

- Local library management with drag-and-drop folder scanning
- Album view with cover art grouping
- User playlists, liked tracks, and queue management
- Playback rate control with pitch preservation
- Audio output device switching without interruption
- NCM format conversion via bundled converter
- Discord Rich Presence integration
- Share card image export
- Crash reporter with in-app log viewer
- English, Simplified Chinese, and Japanese UI (i18n)

---

---

## Requirements

| Dependency | Version |
|---|---|
| Node.js | >= 18 |
| npm | >= 9 |
| Electron | 31.x (managed by devDependencies) |

> Windows is the primary development and test target. macOS and Linux builds are supported but not continuously validated.

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Moekotori/Echoes.git
cd Echoes
```

### 2. Install dependencies

```bash
npm install
```

Native modules (`naudiodon`) are compiled automatically via `electron-builder install-app-deps` in the `postinstall` hook.

### 3. Start the development server

```bash
npm run dev
```

This launches the Electron app with hot-reload via `electron-vite`.

---

## Building

### Windows

```bash
npm run build:win
```

Produces a distributable NSIS installer under `dist/`.

### Windows (Release with auto-update artifacts)

```bash
npm run build:win:release
```

Outputs to `release/` including the `.blockmap` and `latest.yml` required by `electron-updater`.

### macOS

```bash
npm run build:mac
```

### Linux

```bash
npm run build:linux
```

---

## Listen Together Server

The optional server enables synchronized co-listening sessions.

```bash
cd server/listen-together
npm install
PORT=8787 npm start
```

For production deployment with Nginx reverse proxy and PM2, see [`server/listen-together/DEPLOY_FROM_ZERO_ZH.md`](server/listen-together/DEPLOY_FROM_ZERO_ZH.md).

---

## Plugin Development

Plugins are placed in the user's plugin directory and loaded at startup. Each plugin is a folder containing a `plugin.json` manifest and optional `main.js` (Node.js sandbox), `renderer.js`, and `styles.css` files.

For the full API reference and manifest specification, see [`docs/plugin-development.md`](docs/plugin-development.md).

Example plugins are provided in [`examples/`](examples/).

---

## Project Structure

```
src/
  main/           # Electron main process (IPC, audio engine, plugins, cast)
    audio/        # Native audio bridge and AudioEngine wrapper
    cast/         # DLNA renderer
    plugins/      # Plugin manager, sandbox, storage
  preload/        # Context bridge exposing APIs to renderer
  renderer/
    src/
      components/ # Reusable UI components
      locales/    # i18n translation files (en, zh, ja)
      styles/     # Global styles and theme variables
      App.jsx     # Root application component
server/
  listen-together/  # WebSocket-based co-listening server
scripts/            # Build and maintenance scripts
docs/               # Developer documentation
examples/           # Example plugins
```

---

## Contributing

1. Fork the repository and create a feature branch.
2. Follow the existing code style (`npm run lint` and `npm run format`).
3. Open a pull request with a clear description of the change.

---

## Acknowledgements

ECHO uses the following open-source projects:

- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [electron-vite](https://electron-vite.org/)
- [naudiodon](https://github.com/Streampunk/naudiodon)
- [Kuroshiro](https://kuroshiro.org/)
- [music-metadata](https://github.com/borewit/music-metadata)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [FFmpeg](https://ffmpeg.org/)
- [lucide-react](https://lucide.dev/)
