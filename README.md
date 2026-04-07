Here is a beautified and modernized version of your README. I've upgraded the visual hierarchy, unified the badge styles (using the clean `flat-square` look), added a Table of Contents for better navigation, and incorporated tasteful emojis to make the feature list pop while maintaining a professional, high-fidelity aesthetic.

I've also added a placeholder for a hero banner image at the top, which is highly recommended for desktop applications to show off the UI right away.

-----

````markdown
<div align="center">

<img src="https://via.placeholder.com/800x400/1a1a2e/ffffff?text=ECHO+Music+Player" alt="ECHO Banner" width="100%" style="border-radius: 8px; margin-bottom: 20px;">

# 🎵 ECHO

*A modern, feature-rich desktop music player built with Electron and React.*

<p align="center">
  <a href="https://github.com/Moekotori/Echoes/releases/latest">
    <img src="https://img.shields.io/github/v/release/Moekotori/Echoes?label=release&color=blue&style=flat-square" alt="Latest Release">
  </a>
  <a href="https://github.com/Moekotori/Echoes/releases">
    <img src="https://img.shields.io/github/downloads/Moekotori/Echoes/total?color=brightgreen&style=flat-square" alt="Downloads">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/electron-31.x-47848f?style=flat-square&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/react-18-61dafb?style=flat-square&logo=react&logoColor=black" alt="React">
</p>

[**Download Latest Release**](https://github.com/Moekotori/Echoes/releases/latest) • 
[Getting Started](#-getting-started) • 
[Plugin Development](#-plugin-development) • 
[Contributing](#-contributing)

</div>

---

## 📖 Overview

**ECHO** is a cross-platform desktop music player designed for audiophiles and developers alike. Focused on uncompromising audio quality, deep extensibility, and a meticulously clean listening experience, it features a native audio pipeline for high-fidelity playback. Whether you're customizing the UI, watching synchronized music videos, or building your own plugins, ECHO adapts to your rhythm.

---

## ✨ Feature Highlights

<table>
  <tr>
    <td valign="top" width="50%">
      <h3>🎧 HiFi Audio Engine</h3>
      <p>Out-of-process native audio host (<code>echo-audio-host</code>) for low-latency, high-fidelity playback. Features <b>WASAPI Exclusive Mode</b> for bit-perfect output on Windows, and real-time Parametric EQ with pre-amp controls.</p>
    </td>
    <td valign="top" width="50%">
      <h3>🎤 Synchronized Lyrics</h3>
      <p>Line-by-line and word-level karaoke highlights for LRC files. Includes NetEase auto-fetch, manual search, Japanese romaji conversion via Kuroshiro, and a floating desktop overlay.</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>📺 Music Video Integration</h3>
      <p>Automatically match and play YouTube or Bilibili MVs alongside your audio. Features quality selection, direct stream support, and an immersive full-screen MV-as-background mode.</p>
    </td>
    <td valign="top">
      <h3>🤝 Listen Together</h3>
      <p>Host room-based synchronized co-listening sessions via a self-hosted WebSocket server (optional token auth included). Plus, cast seamlessly to network renderers via DLNA.</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>📥 Media Management</h3>
      <p>Download audio directly from YouTube, Bilibili, and SoundCloud. Import NetEase playlists with automatic metadata tagging and cover art writing.</p>
    </td>
    <td valign="top">
      <h3>🧩 Plugin Ecosystem</h3>
      <p>First-class extensibility via a sandboxed API. Build plugins to contribute new music sources, lyrics providers, UI panels, and custom behaviors.</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>🎨 Advanced Theming</h3>
      <p>Fully customizable CSS variable-based theme engine. Create, edit, import, export, and audit your themes using built-in developer tools.</p>
    </td>
    <td valign="top">
      <h3>🔄 Seamless Updates</h3>
      <p>GitHub Releases-based OTA updates via <code>electron-updater</code>. Enjoy background downloads with non-intrusive restart prompts.</p>
    </td>
  </tr>
</table>

### 🧰 Additional Capabilities
- **Smart Library:** Drag-and-drop folder scanning, album view with cover art grouping, and custom queue management.
- **Playback Control:** Pitch-preserving playback rate control and gapless audio output device switching.
- **Tools & Integrations:** Bundled NCM format converter, Discord Rich Presence, and share-card image export.
- **Global:** Full i18n support featuring English, Simplified Chinese, and Japanese.

---

## 💻 Requirements

| Dependency | Required Version |
|:---|:---|
| **Node.js** | `>= 18` |
| **npm** | `>= 9` |
| **Electron** | `31.x` *(managed by devDependencies)* |

> 💡 **Note:** Windows is the primary development and test target. macOS and Linux builds are supported but not continuously validated.

---

## 🚀 Getting Started

### 1. Clone the repository
```bash
git clone [https://github.com/Moekotori/Echoes.git](https://github.com/Moekotori/Echoes.git)
cd Echoes
````

### 2\. Install dependencies

Native modules (`naudiodon`) are compiled automatically via `electron-builder install-app-deps` in the `postinstall` hook.

```bash
npm install
```

### 3\. Start the development server

This launches the Electron app with hot-reload via `electron-vite`.

```bash
npm run dev
```

-----

## 🛠️ Building the Application

**Windows**

```bash
npm run build:win
```

*Produces a distributable NSIS installer under `dist/`.*

**Windows (Release / OTA Ready)**

```bash
npm run build:win:release
```

*Outputs to `release/`, including the `.blockmap` and `latest.yml` required by `electron-updater`.*

**macOS & Linux**

```bash
npm run build:mac
npm run build:linux
```

-----

## 📡 Listen Together Server

Enable synchronized co-listening sessions by running the optional WebSocket server:

```bash
cd server/listen-together
npm install
PORT=8787 npm start
```

*For production deployment (Nginx reverse proxy + PM2), please refer to the [Zero-to-Hero Deployment Guide](https://www.google.com/search?q=server/listen-together/DEPLOY_FROM_ZERO_ZH.md).*

-----

## 🔌 Plugin Development

ECHO is built to be customized. Plugins are located in the user's plugin directory and loaded dynamically at startup.

A standard plugin folder contains:

  - `plugin.json` (Manifest)
  - `main.js` *(Optional Node.js sandbox)*
  - `renderer.js` *(Optional UI injection)*
  - `styles.css` *(Optional styling)*

📚 Read the full API reference and manifest specification in [`docs/plugin-development.md`](https://www.google.com/search?q=docs/plugin-development.md).  
💡 Check out boilerplate and examples in the [`examples/`](https://www.google.com/search?q=examples/) directory.

-----

## 📂 Project Structure

```text
Echoes/
├── src/
│   ├── main/          # Electron main process (IPC, audio engine, plugins)
│   │   ├── audio/     # Native audio bridge and AudioEngine wrapper
│   │   ├── cast/      # DLNA renderer
│   │   └── plugins/   # Plugin manager, sandbox, storage
│   ├── preload/       # Context bridge exposing APIs to renderer
│   └── renderer/      # React frontend
│       └── src/
│           ├── components/ # Reusable UI components
│           ├── locales/    # i18n translation files (en, zh, ja)
│           ├── styles/     # Global styles and theme variables
│           └── App.jsx     # Root application component
├── server/
│   └── listen-together/    # WebSocket-based co-listening server
├── scripts/           # Build and maintenance scripts
├── docs/              # Developer documentation
└── examples/          # Example plugins
```

-----

## 🤝 Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Adhere to code styles (`npm run lint` and `npm run format`)
4.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
5.  Push to the Branch (`git push origin feature/AmazingFeature`)
6.  Open a Pull Request

-----

## 🙏 Acknowledgements

ECHO stands on the shoulders of giants. A huge thank you to the maintainers of these amazing open-source projects:

  - [Electron](https://www.electronjs.org/) & [electron-vite](https://electron-vite.org/)
  - [React](https://react.dev/)
  - [naudiodon](https://github.com/Streampunk/naudiodon)
  - [Kuroshiro](https://kuroshiro.org/)
  - [music-metadata](https://github.com/borewit/music-metadata)
  - [yt-dlp](https://github.com/yt-dlp/yt-dlp) & [FFmpeg](https://ffmpeg.org/)
  - [lucide-react](https://lucide.dev/)

<!-- end list -->

```

***

Would you like me to help you draft the `docs/plugin-development.md` file next, or perhaps create a custom badge set for your plugins?
```
