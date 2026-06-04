# Bundled download tools

Place the release `yt-dlp` binary for the target platform in this directory before packaging.

For Windows builds, the expected file name is:

```text
yt-dlp.exe
```

The application resolves this binary from packaged resources at runtime and does not ask users to configure a local path.
