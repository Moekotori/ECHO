# Linux bundled tools

This directory is used only for Linux packaging. It is copied to packaged resources as `resources/tools`.

Expected files for a Linux x64 package:

```text
ffmpeg
ffmpeg-manifest.json
yt-dlp
```

`ffmpeg` is required for the Linux release gate. `yt-dlp` is optional; when it is missing, download and some streaming helpers report the extractor as unavailable, but local library scan and playback packaging are not blocked.

Large binaries stay out of git. Prepare them locally or in CI, then update `ffmpeg-manifest.json` with the exact artifact path, version string, SHA256, and required filters before running:

```bash
npm run verify:ffmpeg
npm run build:linux
```
