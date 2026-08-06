<p align="center">
  <a href="https://echonext.moe/zh/">
    <img src="https://echonext.moe/assets/product/brand-art-1200.webp" width="880" alt="ECHO NEXT" />
  </a>
</p>

<h1 align="center">ECHO NEXT</h1>

<p align="center">
  <strong>A desktop player built for music you actually own.</strong><br />
  Serious library management, resilient playback, native HiFi output, and an audio chain you can inspect.
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-actively%20maintained-7c5cff?style=flat-square" />
  <img alt="Development" src="https://img.shields.io/badge/development-closed%20source-f59e0b?style=flat-square" />
  <img alt="Focus" src="https://img.shields.io/badge/focus-local%20music%20%26%20HiFi-0ea5e9?style=flat-square" />
</p>

<p align="center">
  <a href="https://github.com/Moekotori/ECHO/releases">
    <img alt="Downloads" src="https://img.shields.io/github/downloads/Moekotori/ECHO/total?style=flat-square&logo=github&label=downloads&color=22c55e" />
  </a>
  <a href="https://github.com/Moekotori/ECHO">
    <img alt="GitHub Stars" src="https://img.shields.io/github/stars/Moekotori/ECHO?style=flat-square&logo=github&label=stars&color=fbbf24" />
  </a>
</p>

<p align="center">
  <a href="./README.md">中文</a>
  ·
  <a href="https://echonext.moe/zh/">Official site</a>
  ·
  <a href="https://echonext.moe/zh/download/">Download</a>
  ·
  <a href="https://echonext.moe/zh/docs/">Documentation</a>
  ·
  <a href="https://echonext.moe/zh/changelog/">Changelog</a>
  ·
  <a href="https://github.com/Moekotori/ECHO/issues">Issues</a>
</p>

---

## Meet ECHO NEXT

ECHO NEXT is a desktop music player engineered for large local libraries, native audio output, and professional DSP. It is not a web player wrapped in Electron, and it does not stop at “the file plays.” Scanning, metadata, covers, queues, decoding, DSP, device routing, and playback truth are treated as separate systems with explicit ownership.

| LOCAL LIBRARY | DSP CENTER | NATIVE OUTPUT |
| :--- | :--- | :--- |
| Folder scanning, SQLite, tags, covers, album wall, playlists | Parametric EQ, headroom, FIR, OPRA, channel tools, output safety | WASAPI Shared / Exclusive, ASIO, DSD / DoP, HQPlayer |

> [!IMPORTANT]
> ECHO NEXT is currently developed in a private repository, but it remains actively maintained and released. This public repository is the project home for release information, product documentation, feedback, and community updates.

## Recent engineering highlights — July 2026

This development wave has been less about adding another shiny toggle and more about rebuilding the parts that determine whether a music player still feels solid after ten thousand tracks, a device switch, a seek, or a decoder error.

| Area | What changed |
| :--- | :--- |
| Native library scanner | A session-resident C++ scanner now streams bounded batches, progress, directory snapshots, and diagnostics into the library pipeline. Incremental rescans can replay clean snapshots and send only dirty subtrees through the native walker. |
| Scanner performance | Five synthetic 10,000-file parity runs matched the TypeScript scanner's file/stat/snapshot output. The native file walk measured a median **4.57× speedup** in that focused benchmark. Results vary by disk, filesystem, folder shape, antivirus, and hardware. |
| Native audio data plane | Local file I/O, libav decoding, seek/prefetch, ECHO SRC, dither, SDM routing, FIFO/drain handling, and device output now live in the native audio host instead of riding on Electron's scheduling loop. |
| Playback resilience | Recent work tightened gapless queue transitions, HTTP-source playback, ALAC and DSD-container paths, output ownership, playback-speed buffering, and bounded recovery from malformed decoder frames. |
| Honest signal-path UI | The player exposes source format, processing stages, sample-rate changes, output mode, device state, bit-perfect candidacy, and fallback reasons instead of compressing the entire chain into one “HiFi” badge. |
| ECHO Everything Connected | ECHO Link is being built on a host-centered event and action core, with a focused mobile remote and provider-aware control path rather than a second, competing playback state machine. |

The scanner number above is a reproducible engineering result, not a promise that every library will scan exactly 4.57 times faster. We keep the TypeScript implementation as a safe fallback, and experimental native paths are rolled out only when they beat the existing path without weakening correctness.

## The scanner: fast is useful only when the library stays correct

Large-library performance starts before SQLite. ECHO's scanner is designed as a streaming worker, not a giant recursive call that blocks the app and returns one enormous array at the end.

```text
FOLDER ROOT
    |
    +-- clean directory snapshot ----> replay known entries
    |
    +-- dirty / new subtree ----------> native C++ walker
                                            |
                                      bounded batches
                                      progress + errors
                                      size + mtime
                                      fresh snapshots
                                            |
                                      Scan Job Queue
                                            |
                                 metadata / cover workers
                                            |
                                    SQLite transaction
                                            |
                                   paged library views
```

What matters in practice:

- **Incremental by design.** Clean directory snapshots can be reused; changed subtrees are scanned again.
- **Bounded and cancellable.** Results stream in batches, scan progress stays visible, and background work can be stopped.
- **Parity before speed.** Paths, file sizes, modification times, snapshot entries, long paths, and non-ASCII names are part of validation.
- **Failure-aware fallback.** If the native worker fails before emitting results, ECHO can return to the TypeScript scanner. It does not blindly restart after partial output and duplicate tracks.
- **Background manners.** The native worker can run at reduced priority and shuts down after an idle period instead of living forever.
- **Separate jobs, separate truths.** File discovery, metadata parsing, cover generation, and database writes remain independent stages, so a faster walker cannot silently redefine tags or albums.

## ECHO Audio Engine

ECHO NEXT does not hide its audio engine behind a single “sound enhancement” switch. The current source, processing stages, sample-rate changes, output mode, device state, bit-perfect candidacy, and fallback reason should all be inspectable.

### Control plane and real-time data plane

```text
RENDERER
play / pause / seek / settings / visible state
    |
    | typed IPC
    v
AUDIO SESSION
path selection / device plan / DSP plan / fallback explanation
    |
    | ordered JSON-RPC control
    v
NATIVE AUDIO HOST
    |
    +-- AudioDaemon + libav
    |     file or HTTP read / probe / decode / seek / prefetch
    |
    +-- NativePlaybackPipeline
    |     ECHO SRC / PCM / DoP / Native DSD / SDM routing
    |
    +-- Native ring source
    |     FIFO / pause / generation / input-ended / drain / frame counter
    |
    +-- Callback DSP
    |     EQ / convolution / channel tools / headroom / ReplayGain / dither
    |
    +-- Device backend
          WASAPI Shared / Exclusive / ASIO
    |
    v
DAC / AUDIO INTERFACE
```

This boundary is deliberate:

- Electron plans and controls playback; it does not carry real-time PCM for the native local path.
- Playback position comes from the native output frame counter, not a UI timer.
- Decoder EOF means “no more input.” A track ends only after the output FIFO has drained.
- Seek and source replacement reset stateful processing so old history cannot leak into the new position.
- Unsupported DSP/output combinations fail with a visible reason. They do not silently claim that SRC, SDM, DoP, or Native DSD is active.
- Device-changing commands are ordered and awaited, which keeps one authoritative owner across output switches.

That is the difference between an audio feature list and an audio architecture: the chain has a source of truth, every stage has an owner, and failure is part of the contract.

## DSP Center

DSP Center is a readable, adjustable, bypassable signal workbench rather than a collection of unrelated EQ sliders.

<p align="center">
  <img src="https://echonext.moe/assets/product/dsp-center-eq.webp" width="49%" alt="ECHO NEXT DSP Center parametric EQ" />
  <img src="https://echonext.moe/assets/product/dsp-center-headphone.webp" width="49%" alt="ECHO NEXT DSP Center OPRA headphone correction" />
</p>

<p align="center">
  <img src="https://echonext.moe/assets/product/dsp-center-fir.webp" width="49%" alt="ECHO NEXT DSP Center FIR room correction" />
  <img src="https://echonext.moe/assets/product/dsp-center-channel.webp" width="49%" alt="ECHO NEXT DSP Center channel tools" />
</p>

| Module | Capability |
| :--- | :--- |
| Parametric EQ | Quick tonal controls in Simple mode; frequency, gain, Q, and preamp control in Pro mode |
| Headroom / output safety | Auto gain, preamp margin, clipping risk, and output safety in one workflow |
| OPRA headphone correction | Model-based correction profiles with clear A/B and bypass behavior |
| FIR / room correction | Import impulse responses and manage trim, delay, convolution, and safety margin |
| Channel tools | Per-channel gain, balance, delay, mono, and channel swap |
| APO import / export | Bridge existing Equalizer APO configurations into ECHO's DSP workflow |

When EQ, FIR, ReplayGain, channel tools, dither, or sample-rate conversion changes the signal, ECHO leaves the bit-perfect candidate state. It returns only after the processing is genuinely bypassed and the output format still matches. There is no “DSP is on, but the badge still says direct” loophole.

[DSP beginner guide](https://echonext.moe/zh/docs/audio-output/dsp-beginner/) · [EQ guide](https://echonext.moe/zh/docs/audio-output/eq/)

## PCM, ECHO SRC, SDM, and DSD are not interchangeable

| Path | Input | What happens | Output target |
| :--- | :--- | :--- | :--- |
| Native PCM | PCM | Direct output where possible when extra DSP is bypassed | PCM DAC path |
| ECHO SRC | PCM | FIR sample-rate conversion creates new PCM samples | Higher-rate PCM |
| ECHO SDM | PCM | Oversampling, filtering, sigma-delta modulation, noise shaping | DSD/SDM-capable device; research preview |
| DSD Direct | DSF / DFF | DoP framing or vendor ASIO Native DSD transport | DAC DSD input path |

### ECHO SRC

ECHO SRC follows the 44.1 kHz and 48 kHz sample-rate families instead of forcing every track into one arbitrary fixed format. The CPU path is authoritative; accelerated paths are admitted only when their runtime and device conditions are satisfied, with active/fallback state kept visible.

Upsampling is not bit-perfect and cannot create information missing from the source. The useful part is not the largest number in the UI—it is the filter, compute path, driver, DAC, and full pipeline remaining stable together.

### ECHO SDM and DSD output

> [!NOTE]
> ECHO SDM and some Native DSD paths are research-preview capabilities. Availability depends on the output mode, official driver, device format support, compute headroom, and real DAC validation.

DoP uses PCM-looking frames to transport DSD bits to a compatible DAC. ASIO Native DSD uses a vendor-supported raw DSD path. Neither may be treated like normal PCM: software volume, EQ, mixing, or resampling would destroy the direct-stream goal.

ECHO therefore separates PCM upsampling, PCM-to-SDM conversion, and native DSD-file passthrough in both status and diagnostics. Seeing “ASIO” in an interface is not proof that a DAC is receiving Native DSD.

[Upsampling guide](https://echonext.moe/zh/docs/audio-output/upsampling/) · [DSD playback guide](https://echonext.moe/zh/docs/audio-output/dsd/) · [WASAPI Exclusive vs ASIO](https://echonext.moe/zh/docs/audio-output/asio-vs-exclusive/)

## Native output

| Output mode | Best fit | Boundary |
| :--- | :--- | :--- |
| System / WASAPI Shared | Everyday playback, Bluetooth, system mixing, fast troubleshooting | Most compatible; the system mixer may determine the final format |
| WASAPI Exclusive | Opening a DAC directly for a track or DSP target | Exclusive device ownership; more dependent on driver and DAC behavior |
| ASIO | Official vendor drivers, professional interfaces, low latency, Native DSD scenarios | Wrapper drivers are not treated as equivalent to vendor-native support |
| DSD over PCM | Carrying DSD through DoP-capable hardware | The carrier cannot be volume-adjusted, mixed, or resampled |
| ASIO Native DSD | Raw DSD to explicitly compatible hardware | Experimental; requires official driver support and strict volume safety |
| HQPlayer | ECHO manages the library and control surface; HQPlayer handles specialist filtering/modulation | Actual capability depends on HQPlayer, NAA, DAC, and network topology |

## ECHO Everything Connected

**ECHO Everything Connected** is the umbrella vision; **ECHO Link** is the device and protocol layer that carries it.

```text
Native Audio Host
        |
   AudioSession
        |
Integration Event Hub ------> ECHO Link / mobile remote / adapters
        ^
        |
Integration Action Router <--- provider-aware play / seek / volume commands
```

External devices receive a sanitized playback snapshot and semantic events rather than private file paths or native-host internals. Commands return through a provider-aware action path, so local playback, Connect, and streaming providers keep their correct control surfaces. The goal is one trustworthy playback truth across the desktop, phone, and future local integrations—not several clocks that merely look synchronized.

## Still a complete music player

| Capability | What it covers |
| :--- | :--- |
| Local library | Folder imports, SQLite, metadata, cover cache, albums, artists, likes, history, playlists, duplicate filtering |
| Lyrics and MV | Local and online candidates, translation, romanization, lyric offset, desktop lyrics, immersive playback, MV matching |
| Remote sources | WebDAV, SMB, Jellyfin, Emby, Subsonic, Navidrome, controlled remote indexing and playback |
| Extensions | Plugins, downloaders, network metadata, and background jobs behind explicit permission and diagnostic boundaries |
| Long-term maintenance | Logs, crash recovery, library health, cache migration, settings backup, and confirmation for destructive actions |

## Quick links

| I want to… | Go to |
| :--- | :--- |
| Download the latest stable version | [Official downloads](https://echonext.moe/zh/download/) · [GitHub Releases](https://github.com/Moekotori/ECHO/releases/latest) |
| Start using ECHO NEXT | [Documentation](https://echonext.moe/zh/docs/) |
| See the latest user-facing changes | [Changelog](https://echonext.moe/zh/changelog/) |
| Report a problem or suggest a feature | [GitHub Issues](https://github.com/Moekotori/ECHO/issues) |
| Support long-term development | [ECHO Pro](https://afdian.com/a/echonext) |
| Join deeper project collaboration | [ECHO Developer Plan](https://echonext.moe/zh/developer/) |

## Project status

Core development now takes place in private repositories and internal collaboration environments. This public repository no longer publishes the current source tree, internal architecture documents, build workflow, or full implementation roadmap.

It remains the public home for:

- clear project and maintenance status;
- official downloads, documentation, changelogs, and release notes;
- reproducible bug reports and product suggestions;
- ECHO Pro and the ECHO Developer Plan;
- required licensing material and issue templates.

## ECHO Pro

ECHO Pro is an advanced plan for long-term supporters. Support helps fund infrastructure, test hardware, design work, and sustained development. Pro entitlements, experimental features, and availability may change by release; the official page is authoritative.

<p align="center">
  <a href="https://afdian.com/a/echonext"><strong>Support ECHO NEXT · Explore ECHO Pro →</strong></a>
</p>

## ECHO Developer Plan

The Developer Plan is for people who want to contribute seriously over time. It is not limited to code: development, visual design, testing, documentation, community feedback, and product experience are all valuable.

| Area | Example contributions |
| :--- | :--- |
| Frontend / interaction | Player UI, library, lyrics, MV, settings, and workflow refinement |
| Desktop / engineering | Desktop integration, data management, diagnostics, stability, and platform support |
| Native / audio | Audio output, device compatibility, performance, playback stability, and validation |
| Art / visual design | UI visuals, icons, illustration, motion, and brand assets |
| Testing / documentation | Reproduction, release validation, tutorials, feedback triage, and documentation |

<p align="center">
  <a href="https://echonext.moe/zh/developer/"><strong>Read about the Developer Plan and apply →</strong></a>
</p>

## Reporting issues

Before opening an issue, confirm that you are using the latest release. A useful report includes:

- ECHO NEXT version and download channel;
- operating system, output device, and relevant driver information;
- clear reproduction steps;
- expected and actual behavior;
- screenshots, logs, or a short recording when useful.

For playback issues, also include the source format, output mode, selected device, and whether the problem affects one file or many. Remove account details, tokens, private filesystem paths, and other sensitive information before posting.

## License

ECHO NEXT is licensed under the [GNU Lesser General Public License v3.0](./LICENSE), using the SPDX identifier `LGPL-3.0-only`. Third-party components and assets remain subject to their own license terms.

---

<p align="center">
  Thank you to everyone who keeps listening, testing, reporting, and supporting ECHO NEXT.<br />
  <strong>The project is moving forward—and the foundations are getting serious.</strong>
</p>
