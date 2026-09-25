<p align="center">
  <img src="./docs/readme-assets/echo-header.png" alt="ECHO mascot illustration" width="560" />
</p>

<h1 align="center">ECHO</h1>

<p align="center"><strong>Make your music library your own.</strong></p>

<p align="center">
  A desktop player built around local music, thoughtful library management, and dependable playback.
</p>

<p align="center">
  <a href="https://github.com/Moekotori/ECHO/releases"><img src="https://img.shields.io/github/downloads/Moekotori/ECHO/total?label=GitHub%20Releases%20downloads&amp;style=flat-square&amp;color=22b8cf" alt="Total GitHub Releases downloads" /></a>
  <a href="https://github.com/Moekotori/ECHO/stargazers"><img src="https://img.shields.io/github/stars/Moekotori/ECHO?label=GitHub%20stars&amp;style=flat-square&amp;color=f7b955" alt="GitHub stars" /></a>
  <a href="https://github.com/Moekotori/ECHO/releases"><img src="https://img.shields.io/github/v/release/Moekotori/ECHO?label=Latest%20GitHub%20release&amp;style=flat-square&amp;color=e98cbd" alt="Latest GitHub release" /></a>
</p>

<p align="center">
  <a href="./docs/ECHO_NEXT_ARCHITECTURE.md"><img src="https://img.shields.io/badge/Renderer-React%20%2B%20TypeScript-45b8da?style=flat-square" alt="Renderer: React and TypeScript" /></a>
  <a href="./docs/ECHO_NEXT_ARCHITECTURE.md"><img src="https://img.shields.io/badge/Bridge-Typed%20IPC-9b78d6?style=flat-square" alt="Bridge: typed IPC" /></a>
  <a href="./docs/ECHO_NEXT_ARCHITECTURE.md"><img src="https://img.shields.io/badge/Main-Electron-47848f?style=flat-square" alt="Main process: Electron" /></a>
  <a href="./docs/ECHO_NEXT_ARCHITECTURE.md"><img src="https://img.shields.io/badge/Library-SQLite-4f9de8?style=flat-square" alt="Library: SQLite" /></a>
  <a href="./docs/ECHO_NEXT_ARCHITECTURE.md"><img src="https://img.shields.io/badge/Audio-Audio%20Core%20%2B%20Native%20Host-e98cbd?style=flat-square" alt="Audio: Audio Core and native host" /></a>
</p>

<p align="center">
  <a href="https://store.steampowered.com/app/5105090/ECHO/">Explore ECHO on Steam</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/Moekotori/ECHO/releases">Get the community edition</a>
  &nbsp;·&nbsp;
  <a href="https://echonext.moe/zh/docs/">Documentation</a>
  &nbsp;·&nbsp;
  <a href="./README.md">简体中文</a>
</p>

---

## Community edition: free forever, public source

The community edition is **free forever**, with public source and maintenance that depends on everyone pitching in. Get the player from [GitHub Releases](https://github.com/Moekotori/ECHO/releases), and help fix issues, improve features, documentation, and translations.

## Steam edition: take listening further

ECHO on Steam keeps your own music at the center, then adds Steam updates, Cloud sync for selected settings, achievements, friend presence, and the Workshop. Organize your library, follow the lyrics, and make the player and your desktop feel like your space.

**All four images below show the Steam edition.**

### 01 / 16,813 tracks, still light on its feet

**16,813 tracks, 1,856 albums, and music playing.** Windows Task Manager shows the ECHO process group using **589.2 MB of memory and 1.1% CPU**. Scanning, metadata work, and playback have distinct responsibilities; low-spec mode and reduced background work keep a large library nimble.

![Task Manager snapshot of ECHO playing from a 16,813-track library, showing 589.2 MB of memory and 1.1% CPU](./docs/readme-assets/steam-performance.png)

### 02 / Your library, your taste

Artwork, albums, artists, recent listening, lyrics, and queue controls share one desktop interface. Switch between light and dark themes or other visual styles while keeping playback close at hand.

![ECHO Steam edition in a light theme, with local-library home, cover art, recommendations, and player controls](./docs/readme-assets/steam-ui.png)

### 03 / Let your desktop move with the music

Turn album covers into a desktop wall and let track information, progress, and visualizations move with the music. ECHO includes a bridge for Wallpaper Engine; creators can start with the [Web wallpaper example](./examples/wallpaper-engine/echo-web-wallpaper/README.md).

![Steam edition desktop wallpaper wall with album-cover collage and a central now-playing card](./docs/readme-assets/steam-wallpaper.webp)

### 04 / Give creators the stage

Explore and subscribe to themes, lyric scenes, visualizers, and extensions in the [Steam Workshop](https://steamcommunity.com/app/5105090/workshop/). The **ECHO Code** example below brings synchronized lyrics, playhead, audio-stream details, and a live spectrum into an interactive terminal-style panel.

![ECHO Code Workshop creation showing terminal-style lyrics, playback progress, and a live spectrum](./docs/readme-assets/steam-workshop.png)

### Go deeper

| What you want | What ECHO offers |
| --- | --- |
| Listen to your own music | Local library, albums and artists, playlists, dynamic lyrics, and listening history |
| Choose an output path | System output, WASAPI Shared / Exclusive, and ASIO for headphones, speakers, and external DACs |
| See the audio path | Codec, sample rate, output device, and processing status at a glance |
| Change the atmosphere | Themes, visualizers, wallpaper integration, and Workshop creations |
| Use the Steam ecosystem | Updates, Cloud sync for selected settings, achievements, friend presence, and Workshop |

Audio Core and the native host own real playback state. Output modes, device capabilities, and fallback reasons stay traceable, while the interface makes every switch clear.

<p align="center">
  <strong>Open your music. Hear your world.</strong><br />
  <a href="https://store.steampowered.com/app/5105090/ECHO/">Visit ECHO on Steam →</a>
</p>
