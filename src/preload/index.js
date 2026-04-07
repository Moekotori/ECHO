import { contextBridge, ipcRenderer } from 'electron'
import { pathToFileURL } from 'node:url'

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled in the BrowserWindow')
}

// Expose IPC methods to the renderer via window.api
contextBridge.exposeInMainWorld('api', {
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  appStateGet: (key) => ipcRenderer.invoke('appState:get', key),
  appStateSet: (key, value) => ipcRenderer.invoke('appState:set', key, value),
  openDirectoryHandler: () => ipcRenderer.invoke('dialog:openDirectory'),
  readDirectoryHandler: (path) => ipcRenderer.invoke('file:readDirectory', path),
  readBufferHandler: (path) => ipcRenderer.invoke('file:readBuffer', path),
  saveExportHandler: (arrayBuffer, defaultName, locale) =>
    ipcRenderer.invoke('dialog:saveExport', arrayBuffer, defaultName, {
      locale
    }),
  openFileHandler: (locale) => ipcRenderer.invoke('dialog:openFile', { locale }),
  openImageHandler: (locale) => ipcRenderer.invoke('dialog:openImage', { locale }),
  openThemeJsonHandler: (locale) => ipcRenderer.invoke('dialog:openThemeJson', { locale }),
  saveThemeJsonHandler: (text, defaultName, locale) =>
    ipcRenderer.invoke('dialog:saveThemeJson', text, defaultName, {
      locale
    }),
  openLyricsFileHandler: (locale) => ipcRenderer.invoke('dialog:openLyricsFile', { locale }),
  openFontFileHandler: (locale) => ipcRenderer.invoke('dialog:openFontFile', { locale }),
  getAudioFilesFromPaths: (paths) => ipcRenderer.invoke('file:getFilesFromPaths', paths),
  readLyricsHandler: (audioPath) => ipcRenderer.invoke('file:readLyrics', audioPath),
  toRomajiBatch: (texts) => ipcRenderer.invoke('lyrics:toRomajiBatch', texts),
  fetchNeteaseLyrics: (payload) => ipcRenderer.invoke('lyrics:neteaseFetch', payload),
  readInfoJsonHandler: (audioPath) => ipcRenderer.invoke('file:readInfoJson', audioPath),
  searchMVHandler: (query, source) => ipcRenderer.invoke('api:searchMV', query, source),
  convertNcmHandler: (filePath) => ipcRenderer.invoke('file:convertNcm', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (fullPath) => ipcRenderer.invoke('shell:showItemInFolder', fullPath),
  openPath: (fullPath) => ipcRenderer.invoke('shell:openPath', fullPath),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  writeClipboardImage: (dataUrl) => ipcRenderer.invoke('clipboard:writeImage', dataUrl),
  saveImageHandler: (dataUrl, defaultName) =>
    ipcRenderer.invoke('dialog:saveImage', dataUrl, defaultName),
  /** 本地绝对路径 → 合法 file: URL（路径中含 #、空格、Unicode 时必须用这个，勿手写 file://） */
  pathToFileURL: (filePath) => {
    try {
      if (typeof filePath !== 'string' || !filePath.trim()) return ''
      return pathToFileURL(filePath.trim()).href
    } catch {
      return ''
    }
  },
  closeAppHandler: () => ipcRenderer.send('window:close'),
  maximizeAppHandler: () => ipcRenderer.send('window:maximize'),
  minimizeAppHandler: () => ipcRenderer.send('window:minimize'),
  downloadSoundCloud: (url, downloadPath) =>
    ipcRenderer.invoke('soundcloud:download', url, downloadPath),
  getExtendedMetadataHandler: (path) => ipcRenderer.invoke('file:getExtendedMetadata', path),
  setDiscordActivity: (activity) => ipcRenderer.send('discord:setActivity', activity),
  clearDiscordActivity: () => ipcRenderer.send('discord:clearActivity'),
  toggleDiscordRPC: (enabled) => ipcRenderer.send('discord:toggle', enabled),
  neteaseSearch: (keywords) => ipcRenderer.invoke('netease:search', keywords),
  
  media: {
    fetchNeteaseLrcText: (params) => ipcRenderer.invoke('netease:fetchLrcText', params),
    writeFile: (filePath, text) => ipcRenderer.invoke('media:writeFile', filePath, text),
    getMetadata: (url) => ipcRenderer.invoke('media:getMetadata', url),
    downloadAudio: (url, folder, options) => ipcRenderer.invoke('media:download', url, folder, options),
    onProgress: (callback) => {
      const channel = 'media:download-progress'
      const handler = (_, data) => callback(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  },
  playlistLink: {
    importPlaylist: (payload) => ipcRenderer.invoke('playlistLink:importPlaylist', payload),
    onImportProgress: (callback) => {
      const channel = 'playlist-link:import-progress'
      const handler = (_, data) => callback(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  },
  // === Native Audio Engine ===
  getAudioDevices: () => ipcRenderer.invoke('audio:getDevices'),
  setAudioDevice: (id) => ipcRenderer.invoke('audio:setDevice', id),
  setAudioExclusive: (exclusive) => ipcRenderer.invoke('audio:setExclusive', exclusive),
  setAudioOutputBufferProfile: (profile) =>
    ipcRenderer.invoke('audio:setOutputBufferProfile', profile),
  setAudioEqConfig: (eqConfig) => ipcRenderer.invoke('audio:setEqConfig', eqConfig),
  playAudio: (path, startTime, playbackRate, sourceSampleRateHint) =>
    ipcRenderer.invoke('audio:play', path, startTime, playbackRate, sourceSampleRateHint),
  setAudioPlaybackRate: (rate) => ipcRenderer.invoke('audio:setPlaybackRate', rate),
  pauseAudio: () => ipcRenderer.invoke('audio:pause'),
  resumeAudio: () => ipcRenderer.invoke('audio:resume'),
  stopAudio: () => ipcRenderer.invoke('audio:stop'),
  setAudioVolume: (vol) => ipcRenderer.invoke('audio:setVolume', vol),
  openLyricsDesktop: () => ipcRenderer.invoke('lyricsDesktop:open'),
  closeLyricsDesktop: () => ipcRenderer.invoke('lyricsDesktop:close'),
  syncLyricsDesktop: (payload) => ipcRenderer.invoke('lyricsDesktop:sync', payload),
  onLyricsDesktopData: (callback) => {
    const ch = 'lyrics-desktop:data'
    const handler = (_, data) => callback(data)
    ipcRenderer.on(ch, handler)
    return () => ipcRenderer.removeListener(ch, handler)
  },
  clearAudioStatusListeners: () => ipcRenderer.removeAllListeners('audio:status-update'),
  onAudioStatus: (callback) => {
    const channel = 'audio:status-update'
    const handler = (_, status) => callback(status)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  onAudioTrackEnded: (callback) => {
    const channel = 'audio:track-ended'
    const handler = () => callback()
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  cast: {
    dlnaStart: (opts) => ipcRenderer.invoke('cast:dlnaStart', opts),
    dlnaStop: () => ipcRenderer.invoke('cast:dlnaStop'),
    getStatus: () => ipcRenderer.invoke('cast:getStatus'),
    onPauseLocal: (callback) => {
      const ch = 'cast:pause-local'
      const handler = () => callback()
      ipcRenderer.on(ch, handler)
      return () => ipcRenderer.removeListener(ch, handler)
    },
    onStatus: (callback) => {
      const ch = 'cast:status'
      const handler = (_, status) => callback(status)
      ipcRenderer.on(ch, handler)
      return () => ipcRenderer.removeListener(ch, handler)
    }
  },
  // === Crash Reporter ===
  getCrashReportDir: () => ipcRenderer.invoke('crash:getReportDir'),
  listCrashReports: () => ipcRenderer.invoke('crash:listReports'),
  openCrashDir: () => ipcRenderer.send('crash:openDir'),
  openYoutubeSignInWindow: () => ipcRenderer.invoke('youtube:openSignInWindow'),
  openBilibiliSignInWindow: () => ipcRenderer.invoke('bilibili:openSignInWindow'),
  openNeteaseSignInWindow: () => ipcRenderer.invoke('netease:openSignInWindow'),
  getNeteaseCookie: () => ipcRenderer.invoke('netease:getCookie'),
  resolveBilibiliStream: (bvid, quality) =>
    ipcRenderer.invoke('bilibili:resolveStream', bvid, quality),
  checkSignInStatus: () => ipcRenderer.invoke('signin:checkStatus'),
  onSignInStatusChanged: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('signin:status-changed', handler)
    return () => ipcRenderer.removeListener('signin:status-changed', handler)
  },
  dev: {
    openDevTools: () => ipcRenderer.invoke('dev:openDevTools'),
    reloadWindow: () => ipcRenderer.invoke('dev:reloadWindow'),
    openUserData: () => ipcRenderer.invoke('dev:openUserData')
  },
  plugin: {
    list: () => ipcRenderer.invoke('plugin:list'),
    enable: (id) => ipcRenderer.invoke('plugin:enable', id),
    disable: (id) => ipcRenderer.invoke('plugin:disable', id),
    install: (sourcePath) => ipcRenderer.invoke('plugin:install', sourcePath),
    uninstall: (id) => ipcRenderer.invoke('plugin:uninstall', id),
    getSettings: (id) => ipcRenderer.invoke('plugin:getSettings', id),
    setSettings: (id, settings) => ipcRenderer.invoke('plugin:setSettings', id, settings),
    getRendererPayload: (id) => ipcRenderer.invoke('plugin:getRendererPayload', id),
    getActiveRendererPayloads: () => ipcRenderer.invoke('plugin:getActiveRendererPayloads'),
    openPluginsDir: () => ipcRenderer.invoke('plugin:openPluginsDir'),
    selectInstallDir: () => ipcRenderer.invoke('plugin:selectInstallDir'),
    onListChanged: (callback) => {
      const ch = 'plugin:list-changed'
      const handler = (_, data) => callback(data)
      ipcRenderer.on(ch, handler)
      return () => ipcRenderer.removeListener(ch, handler)
    }
  }
})
