<p align="center">
  <img src="./build-resources/icons/logo.png" alt="ECHO NEXT" width="520" />
</p>

<h1 align="center">ECHO Developers</h1>

<p align="center">
  <strong>ECHO NEXT developer entrypoint: local development, audio pipeline, packaging, validation, and contribution boundaries.</strong>
</p>

<p align="center">
  <a href="./README.md">Chinese README</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#current-focus">Current Focus</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#quick-start">Quick Start</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#build-dependencies">Build Dependencies</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#common-commands">Common Commands</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#architecture-boundaries">Architecture</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#documentation">Documentation</a>
</p>

---

## Project Scope

ECHO NEXT is the next-generation desktop music player in the ECHO family. This repository is for development, debugging, packaging, and contribution work. It is not a product landing page or the main user manual. For installation, feature usage, and troubleshooting, see the [official ECHO NEXT documentation](https://echonext.moe/zh/docs/) or [docs/USER_GUIDE.md](./docs/USER_GUIDE.md).

This README keeps the material developers need to move safely: how to start, where to change code, how to build, what to validate, and which boundaries must stay intact. Development priorities are stable local playback, reliable library data, clear audio boundaries, user data safety, and maintainable feature boundaries. For large PRs, cross-module changes, database migrations, playback pipeline work, native host work, packaging / release work, or entitlement / integrity / Pro feature work, notify the maintainers before starting a broad implementation.

## Current Focus

| Area | Current focus |
| --- | --- |
| Playback stability | Audio Core is the source of truth for playback; state, position, output device, fallback, and error reasons must stay explainable. |
| Audio / DSP | ECHO SRC, EQ, ReplayGain, PCM dither, channel processing, and safety limits must honestly mark their bit-perfect impact. |
| Annoying but important SDM | We are working on PCM -> SDM / DSD64-DSD512, DSD passthrough, DoP / ASIO Native DSD, CPU / CUDA compute, and explainable fallback. This is a high-risk experimental path: when device or output-mode requirements are not met, it must visibly fall back to PCM, and UI/status must never pretend SDM is active. |
| Library and data | Scanning, metadata, covers, playlists, remote sources, and import flows must protect user data; migrations need compatibility and rollback thinking. |
| Build and release | Dev/base builds may reuse safely verified artifacts; release builds must keep integrity signing, authorization checks, and Pro / paid features fail-closed. |

## Tech Stack

| Area | Current choice |
| --- | --- |
| Desktop runtime | Electron 42.x |
| Build framework | electron-vite 5.x, Vite 7.x |
| UI | React 18.2, TypeScript 5.x |
| Packaging | electron-builder 26.x, NSIS, portable, AppImage, deb |
| Library | SQLite, better-sqlite3, native scanner, metadata worker |
| Audio | HTML Audio fallback, Native Audio Host, WASAPI Shared / Exclusive, ASIO, DSD / DoP |
| DSP / HiFi | ECHO SRC, PCM dither, ECHO SDM / DSD, CPU / CUDA experimental compute |
| Extensions | Plugin SDK, remote sources, network metadata, downloader, LAN playback features |

Versions in [package.json](./package.json) and [package-lock.json](./package-lock.json) are authoritative. If docs disagree with the lockfile, trust the lockfile and submit a docs fix.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `src/renderer` | React pages, components, state, and UI interaction |
| `src/preload` | Typed bridge APIs exposed to the renderer |
| `src/main` | Electron main process, IPC, services, library, playback, settings, and system integration |
| `src/shared` | Shared types, constants, and pure utilities used across main, preload, and renderer |
| `electron-app` | Native hosts, build artifacts, FFmpeg toolchain, and packaging resources |
| `native` | Native modules and host-related source |
| `scripts` | Build, verification, repair, packaging, smoke-test, and maintenance scripts |
| `docs` | Architecture, library, audio, plugin, Linux build, and UI documentation |
| `build-resources` | Icons, installer resources, and build assets |

## Architecture Boundaries

```text
React Renderer
  pages, components, virtual lists, settings, player controls
        |
Typed Preload Bridge
        |
Electron Main Process
  IPC, windows, lifecycle, services, system integration
        |
        +-- Library Core
        |     SQLite, scans, metadata, covers, folders, playlists
        |
        +-- Audio Core
        |     AudioSession, decoder pipeline, output bridge, DSD / SDM / SRC state
        |
        +-- Native Hosts
        |     echo-audio-host, echo-src-cuda-worker, WASAPI, ASIO, EQ, SMTC helper
        |
        +-- Experience Services
              lyrics, MV, streaming, downloads, plugins, remote sources
```

The renderer owns interaction and presentation. It must not directly scan folders, generate covers, parse audio files, or calculate authoritative playback state. The main process exposes controlled capabilities through typed IPC, while heavy work is routed to Library Core, Audio Core, native hosts, or dedicated services.

See [docs/ECHO_NEXT_ARCHITECTURE.md](./docs/ECHO_NEXT_ARCHITECTURE.md) for the full architecture notes.

## Build Dependencies

Common dependencies:

| Dependency | Recommended version / requirement |
| --- | --- |
| Node.js | 22.23.1 LTS (pinned by `.nvmrc`, `.node-version`, and Volta; minimum 22.23) |
| npm | 10.8.2 (pinned by `package.json#packageManager`) |
| Git | 2.x |
| Python | 3.x, used by parts of the native dependency toolchain |
| C++ toolchain | C++17-capable |
| CMake | 3.24 or newer is safer |
| Electron | Use the version pinned by `package-lock.json`; do not upgrade manually |

Platform dependencies:

| Platform | Requirements |
| --- | --- |
| Windows build tools | Visual Studio 2022 Desktop development with C++ |
| Windows packaging tools | NSIS is handled by electron-builder; FFmpeg and yt-dlp are prepared from pinned manifests by the Windows build scripts |
| Linux build tools | CMake, g++, pkg-config, fakeroot, dpkg, rpm, binutils |
| Linux audio / desktop dependencies | ALSA, JACK, X11, fontconfig, freetype, GTK / NSS / XSS / XTest / DRM / GBM runtime libraries |
| Linux FFmpeg | x64 executable with at least `aresample`; see [Linux Build Guide](./docs/ECHO_NEXT_LINUX_BUILD.md) for the full checklist |

Common Ubuntu / Debian packages:

```bash
sudo apt update
sudo apt install cmake g++ pkg-config fakeroot dpkg rpm binutils
sudo apt install libasound2-dev libjack-jackd2-dev libfreetype-dev libfontconfig1-dev
sudo apt install libx11-dev libxcomposite-dev libxcursor-dev libxext-dev libxinerama-dev libxrandr-dev libxrender-dev
sudo apt install libgtk-3-0 libnss3 libxss1 libxtst6 libdrm2 libgbm1
```

## Mainland China Mirrors

Developers in mainland China should configure local mirrors first to reduce `npm ci`, Electron, and electron-builder download failures:

```powershell
npm config set registry https://registry.npmmirror.com
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm ci
```

For permanent use, put those environment variables in your user-level system environment. Use personal or system-level configuration; do not commit `.npmrc`, proxy URLs, account tokens, or private mirror credentials to the repository.

## Quick Start

```bash
git clone https://github.com/Moekotori/ECHODev.git
cd ECHODev
npm run setup
npm run dev
```

If the Electron runtime is incomplete, `npm run dev` may fail with `Error: Electron uninstall`. Repair Electron and restart:

```bash
npm run repair:electron
npx electron --version
npm run dev
```

If you also need to build the audio host and Windows SMTC host before launching development mode:

```bash
npm run dev:full
```

`npm run dev` performs safe incremental preflight checks by default: better-sqlite3 ABI, the AirPlay RAOP native backend, and the audio host are skipped quickly when they were already verified and their files have not changed.

## Multi-device Development

- Use the repository-declared Node/npm versions on every computer. nvm, fnm, and asdf can read `.nvmrc` or `.node-version`; Volta reads `package.json` automatically.
- Run `npm run setup` on a new computer or after the lockfile/toolchain version changes. After an ordinary source update, run `npm run dev`; incremental checks reuse valid native artifacts on that computer.
- Sync source, configuration, and `package-lock.json` through Git. Do not copy `node_modules`, `out`, `dist`, `build`, `.echo-local`, private keys, or `.env` files between computers; native modules must be built locally for each device's ABI.
- Use `npm ci` for routine dependency installation. When intentionally upgrading a dependency, commit `package.json` and `package-lock.json` together.

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | Check the toolchain and initialize this computer from the lockfile; append `-- --mirror` in mainland China |
| `npm run dev` | Start the Electron + Vite development environment |
| `npm run dev:full` | Build the audio host and SMTC host, then start development mode |
| `npm run repair:electron` | Reinstall / repair the Electron runtime |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run test` | Run Vitest tests |
| `npm run build` | Typecheck and build main, preload, and renderer output |
| `npm run prepare:win-ffmpeg` | Download and verify the manifest-pinned FFmpeg for Windows packaging |
| `npm run prepare:win-ytdlp` | Download and verify the manifest-pinned yt-dlp required for streaming playback |
| `npm run verify:ffmpeg` | Verify the FFmpeg toolchain |
| `npm run build:audio-host` | Build the audio host |
| `npm run build:src-cuda-worker` | Build the ECHO SRC CUDA worker |
| `npm run build:smtc-host` | Build the Windows SMTC host |
| `npm run build:native-scanner` | Build the native scanner |
| `npm run ensure:src-cuda-worker` | Incrementally check the CUDA worker; skip when the artifact is fresh |
| `npm run ensure:smtc-host` | Incrementally check the Windows SMTC host; skip when the artifact is fresh |
| `npm run ensure:native-scanner` | Incrementally check the native scanner; skip when the artifact is fresh |
| `npm run smoke:audio-host` | Smoke-test the audio host |
| `npm run smoke:dsd-direct` | Smoke-test DSD / DoP / Native DSD direct-output paths |
| `npm run smoke:smtc-host` | Smoke-test the Windows SMTC host |
| `npm run build:win` | Build Windows base/dev installer and portable artifacts |
| `npm run build:win:dir` | Quickly build the Windows unpacked directory package, skipping NSIS / portable compression |
| `npm run build:win:dir:quick` | Faster local unpacked directory package, skipping full TypeScript checking |
| `npm run build:win:release` | Build Windows release artifacts with Authenticode signing |
| `npm run build:linux` | Build Linux packages on a Linux x64 environment |

## Build Flows

Development startup:

```bash
npm run setup
npm run dev
```

On a fresh Windows machine, `npm run setup` checks Node.js, npm, Python, CMake, and the Visual Studio C++ toolchain before installing the exact lockfile. It stops with install commands when a prerequisite is missing; reopen the terminal and run it again after installing those tools.

If npm or Electron downloads are slow (especially from mainland China), use `npm run setup -- --mirror`. It configures the recommended npm and Electron mirrors and uses them for the same installation run.

Standard compile check:

```bash
npm run typecheck
npm run build
```

Windows base/dev packaging:

```bash
npm run build:win
```

`npm run build:win` uses safe incremental checks to reuse fresh audio host, SMTC host, native scanner, and CUDA worker artifacts. The project no longer uses a separate package-integrity private key, so no ECHO packaging key needs to be migrated or regenerated on a new machine.

If you only need to validate packaged resources / asar / app structure locally, prefer the faster directory package:

```bash
npm run build:win:dir
```

`build:win:dir` generates `dist/win-unpacked` and skips NSIS installer plus portable compression, which is better for repeated local checks.

If you already ran `npm run typecheck`, or only need to validate packaging-resource changes, use:

```bash
npm run build:win:dir:quick
```

This command skips full TypeScript checking and is only for fast local iteration. Before submitting or releasing, still run `npm run typecheck`, `npm run build:win`, or the relevant release build.

Use `npm run build:win:release` for Windows release artifacts. Release builds still require a Windows code-signing certificate and `ECHO_WINDOWS_PUBLISHER_NAME`; Authenticode verification remains enforced for published artifacts.

Linux packaging:

```bash
npm ci
npm run verify:ffmpeg
npm run build:linux
```

For Linux x64 details, see [docs/ECHO_NEXT_LINUX_BUILD.md](./docs/ECHO_NEXT_LINUX_BUILD.md).

## Nix / Flake

The project provides a Nix flake for a Linux development shell, build derivation, and nixpkgs overlay:

| Command | Purpose |
| --- | --- |
| `nix develop` | Enter the dev shell with Node 22, CMake, ALSA, GTK3, Electron, and related tools |
| `nix build` | Build ECHO NEXT with nixpkgs Electron, with output in `result/` |
| `nix run` | Run the built application directly |
| `nix flake check` | Verify flake outputs |

The license is source-available rather than OSS, so Nix builds must allow unfree packages explicitly:

```bash
NIXPKGS_ALLOW_UNFREE=1 nix build --impure .#echo-next
```

## Validation Strategy

Do not waste time running broad tests for small changes. Pick the smallest useful check for the touched area:

| Change area | Recommended validation |
| --- | --- |
| README / docs | Review content and diff |
| TypeScript / IPC types | `npm run typecheck` |
| Renderer logic | Relevant Vitest or focused manual check |
| Main-process service | `npm run typecheck` plus a focused service check |
| Library / SQLite | Relevant library test or minimal reproduction script |
| Audio host | `npm run build:audio-host`, `npm run smoke:audio-host` |
| ECHO SRC / CUDA worker | `npm run build:src-cuda-worker` plus focused Audio Core tests |
| SDM / DSD / ASIO Native | Focused Audio Core tests, `npm run smoke:dsd-direct`, and real DAC / ASIO smoke tests when needed |
| SMTC host | `npm run build:smtc-host`, `npm run smoke:smtc-host` |
| FFmpeg / yt-dlp / packaging resources | `npm run prepare:win-ffmpeg`, `npm run prepare:win-ytdlp`, `npm run verify:ffmpeg` |
| Windows packaging | `npm run build:win` |
| Linux packaging | `npm run build:linux` |

## Security Boundaries

Do not remove, bypass, mock, short-circuit, or weaken authentication, authorization, license verification, entitlement checks, subscription checks, download authorization, or anti-abuse logic. Audio components still verify file size and SHA-256 hashes from their manifest to reject damaged payloads.

Treat SDM, DSD, ASIO Native, CUDA worker, and audio hot-path changes as high risk too: keep them off by default, make failures visible, keep fallback explainable, and do not trade playback stability or device safety for a feature that only appears to work.

Do not commit private keys, tokens, passwords, real user data, local absolute paths, or private deployment information.

## Contribution Rules

| Type | Rule |
| --- | --- |
| Small fixes | Open a PR directly with scope and validation notes |
| Large PRs | Notify maintainers first through an issue, discussion, or maintainer contact |
| Cross-module refactors | Discuss boundaries first; do not mix unrelated formatting or cleanup |
| Major UI changes | Explain affected pages, interaction changes, and regression checks |
| Database migrations | Explain compatibility, backup / rollback risk, and test approach |
| Playback pipeline / native hosts | Include devices, formats, output modes, and smoke-test results |
| SDM / DSD / CUDA audio path | Explain device capability, output mode, target DSD rate, fallback behavior, and focused validation |
| Entitlement / integrity / Pro features | Read the maintainer notes first and keep behavior fail-closed |

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ECHO_NEXT_ARCHITECTURE.md](./docs/ECHO_NEXT_ARCHITECTURE.md) | Overall architecture |
| [docs/ECHO_NEXT_LIBRARY_CORE.md](./docs/ECHO_NEXT_LIBRARY_CORE.md) | Library core |
| [docs/ECHO_NEXT_AUDIO_CORE.md](./docs/ECHO_NEXT_AUDIO_CORE.md) | Audio core |
| [docs/ECHO_NEXT_EQ.md](./docs/ECHO_NEXT_EQ.md) | EQ and DSP boundaries |
| [docs/ECHO_NEXT_PLUGINS.md](./docs/ECHO_NEXT_PLUGINS.md) | Plugin authoring guide |
| [docs/plugin-sdk/ForAIReadme.md](./docs/plugin-sdk/ForAIReadme.md) | Plugin-writing rules and checklist for AI assistants |
| [docs/ECHO_NEXT_NETWORK_METADATA.md](./docs/ECHO_NEXT_NETWORK_METADATA.md) | Network metadata enrichment |
| [docs/ECHO_NEXT_LINUX_BUILD.md](./docs/ECHO_NEXT_LINUX_BUILD.md) | Linux builds |
| [docs/ECHO_NEXT_UI_GUIDE.md](./docs/ECHO_NEXT_UI_GUIDE.md) | UI guide |
| [flake.nix](./flake.nix) | Nix flake: dev shell, build, and overlay |
| [docs/security/entitlement-maintainer-notes.md](./docs/security/entitlement-maintainer-notes.md) | Entitlement, integrity, and paid-feature maintainer notes |

## License

ECHO NEXT is source-available under the [ECHO NEXT Source-Available License](./LICENSE). The license permits personal review, learning, and local builds, but prohibits cracks, bypassing entitlement or integrity checks, and unauthorized redistribution of modified builds.
