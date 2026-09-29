# Windows bundled tools

This directory is copied to packaged Windows resources as `resources/tools`.

Expected files for a Windows package:

```text
ffmpeg.exe
ffmpeg-manifest.json
yt-dlp.exe
yt-dlp-manifest.json
```

`ffmpeg.exe` is required for the Windows release gate. Large binaries stay out of git, so prepare the pinned FFmpeg build from `ffmpeg-manifest.json` before packaging:

```bash
npm run prepare:win-ffmpeg
npm run verify:ffmpeg
```

`yt-dlp.exe` is required for Windows builds because Bilibili, YouTube, and SoundCloud streaming playback use it. Windows build scripts download and verify the pinned artifact from `yt-dlp-manifest.json`; do not remove it from the package.
