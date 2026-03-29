import { contextBridge, ipcRenderer } from "electron";

if (!process.contextIsolated) {
  throw new Error("contextIsolation must be enabled in the BrowserWindow");
}

// Expose IPC methods to the renderer via window.api
contextBridge.exposeInMainWorld("api", {
  openDirectoryHandler: () => ipcRenderer.invoke("dialog:openDirectory"),
  readDirectoryHandler: (path) =>
    ipcRenderer.invoke("file:readDirectory", path),
  readBufferHandler: (path) => ipcRenderer.invoke("file:readBuffer", path),
  saveExportHandler: (arrayBuffer, defaultName) =>
    ipcRenderer.invoke("dialog:saveExport", arrayBuffer, defaultName),
  openFileHandler: () => ipcRenderer.invoke("dialog:openFile"),
  openImageHandler: () => ipcRenderer.invoke("dialog:openImage"),
  openThemeJsonHandler: () => ipcRenderer.invoke("dialog:openThemeJson"),
  saveThemeJsonHandler: (text, defaultName) =>
    ipcRenderer.invoke("dialog:saveThemeJson", text, defaultName),
  openLyricsFileHandler: () => ipcRenderer.invoke("dialog:openLyricsFile"),
  getAudioFilesFromPaths: (paths) =>
    ipcRenderer.invoke("file:getFilesFromPaths", paths),
  readLyricsHandler: (audioPath) =>
    ipcRenderer.invoke("file:readLyrics", audioPath),
  toRomajiBatch: (texts) => ipcRenderer.invoke("lyrics:toRomajiBatch", texts),
  readInfoJsonHandler: (audioPath) =>
    ipcRenderer.invoke("file:readInfoJson", audioPath),
  searchMVHandler: (query, source) =>
    ipcRenderer.invoke("api:searchMV", query, source),
  convertNcmHandler: (filePath) =>
    ipcRenderer.invoke("file:convertNcm", filePath),
  closeAppHandler: () => ipcRenderer.send("window:close"),
  maximizeAppHandler: () => ipcRenderer.send("window:maximize"),
  minimizeAppHandler: () => ipcRenderer.send("window:minimize"),
  downloadSoundCloud: (url, downloadPath) =>
    ipcRenderer.invoke("soundcloud:download", url, downloadPath),
  getExtendedMetadataHandler: (path) =>
    ipcRenderer.invoke("file:getExtendedMetadata", path),
  setDiscordActivity: (activity) =>
    ipcRenderer.send("discord:setActivity", activity),
  clearDiscordActivity: () => ipcRenderer.send("discord:clearActivity"),
  toggleDiscordRPC: (enabled) => ipcRenderer.send("discord:toggle", enabled),
  media: {
    getMetadata: (url) => ipcRenderer.invoke("media:getMetadata", url),
    downloadAudio: (url, folder) =>
      ipcRenderer.invoke("media:download", url, folder),
    onProgress: (callback) => {
      const channel = "media:download-progress";
      const handler = (_, data) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  },
  playlistLink: {
    importPlaylist: (payload) =>
      ipcRenderer.invoke("playlistLink:importPlaylist", payload),
    onImportProgress: (callback) => {
      const channel = "playlist-link:import-progress";
      const handler = (_, data) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  },
  // === Native Audio Engine ===
  getAudioDevices: () => ipcRenderer.invoke("audio:getDevices"),
  setAudioDevice: (id) => ipcRenderer.invoke("audio:setDevice", id),
  playAudio: (path, startTime, playbackRate) =>
    ipcRenderer.invoke("audio:play", path, startTime, playbackRate),
  setAudioPlaybackRate: (rate) =>
    ipcRenderer.invoke("audio:setPlaybackRate", rate),
  pauseAudio: () => ipcRenderer.invoke("audio:pause"),
  resumeAudio: () => ipcRenderer.invoke("audio:resume"),
  stopAudio: () => ipcRenderer.invoke("audio:stop"),
  setAudioVolume: (vol) => ipcRenderer.invoke("audio:setVolume", vol),
  onAudioStatus: (callback) =>
    ipcRenderer.on("audio:status-update", (_, status) => callback(status)),
  cast: {
    dlnaStart: (opts) => ipcRenderer.invoke("cast:dlnaStart", opts),
    dlnaStop: () => ipcRenderer.invoke("cast:dlnaStop"),
    getStatus: () => ipcRenderer.invoke("cast:getStatus"),
    onPauseLocal: (callback) => {
      const ch = "cast:pause-local";
      const handler = () => callback();
      ipcRenderer.on(ch, handler);
      return () => ipcRenderer.removeListener(ch, handler);
    },
    onStatus: (callback) => {
      const ch = "cast:status";
      const handler = (_, status) => callback(status);
      ipcRenderer.on(ch, handler);
      return () => ipcRenderer.removeListener(ch, handler);
    },
  },
  // === Crash Reporter ===
  getCrashReportDir: () => ipcRenderer.invoke("crash:getReportDir"),
  listCrashReports: () => ipcRenderer.invoke("crash:listReports"),
  openCrashDir: () => ipcRenderer.send("crash:openDir"),
  openYoutubeSignInWindow: () => ipcRenderer.invoke("youtube:openSignInWindow"),
  openBilibiliSignInWindow: () =>
    ipcRenderer.invoke("bilibili:openSignInWindow"),
  resolveBilibiliStream: (bvid, quality) =>
    ipcRenderer.invoke("bilibili:resolveStream", bvid, quality),
  checkSignInStatus: () => ipcRenderer.invoke("signin:checkStatus"),
  onSignInStatusChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("signin:status-changed", handler);
    return () => ipcRenderer.removeListener("signin:status-changed", handler);
  },
});
