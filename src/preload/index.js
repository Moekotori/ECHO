import { contextBridge, ipcRenderer } from 'electron'
import { pathToFileURL } from 'node:url'

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled in the BrowserWindow')
}

const initialAppStateSnapshot = (() => {
  try {
    const snapshot = ipcRenderer.sendSync('appState:getSnapshotSync')
    return snapshot && typeof snapshot === 'object' ? snapshot : {}
  } catch {
    return {}
  }
})()

// Expose IPC methods to the renderer via window.api
contextBridge.exposeInMainWorld('api', {
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  setAutoUpdateEnabled: (enabled) => ipcRenderer.invoke('app:setAutoUpdateEnabled', !!enabled),
  onUpdaterEvent: (callback) => {
    const handler = (_, msg) => callback(msg)
    ipcRenderer.on('updater-message', handler)
    return () => ipcRenderer.removeListener('updater-message', handler)
  },
  appStateGet: (key) => ipcRenderer.invoke('appState:get', key),
  getInitialAppState: () => initialAppStateSnapshot,
  getInitialAppStateValue: (key) =>
    typeof key === 'string' ? initialAppStateSnapshot?.[key] ?? null : null,
  appStateSet: (key, value) => ipcRenderer.invoke('appState:set', key, value),
  openDirectoryHandler: () => ipcRenderer.invoke('dialog:openDirectory'),
  readDirectoryHandler: (path) => ipcRenderer.invoke('file:readDirectory', path),
  readBufferHandler: (path) => ipcRenderer.invoke('file:readBuffer', path),
  readTextFileHandler: (path) => ipcRenderer.invoke('file:readText', path),
  saveExportHandler: (arrayBuffer, defaultName, locale) =>
    ipcRenderer.invoke('dialog:saveExport', arrayBuffer, defaultName, {
      locale
    }),
  openFileHandler: (locale) => ipcRenderer.invoke('dialog:openFile', { locale }),
  openVstPluginHandler: (locale) => ipcRenderer.invoke('dialog:openVstPlugin', { locale }),
  openImageHandler: (locale) => ipcRenderer.invoke('dialog:openImage', { locale }),
  selectImageFile: () => ipcRenderer.invoke('dialog:selectImage'),
  openThemeJsonHandler: (locale) => ipcRenderer.invoke('dialog:openThemeJson', { locale }),
  openPlaylistFileHandler: () => ipcRenderer.invoke('dialog:openPlaylistFile'),
  saveThemeJsonHandler: (text, defaultName, locale) =>
    ipcRenderer.invoke('dialog:saveThemeJson', text, defaultName, {
      locale
    }),
  openLyricsFileHandler: (locale) => ipcRenderer.invoke('dialog:openLyricsFile', { locale }),
  openCookiesFileHandler: (locale) => ipcRenderer.invoke('dialog:openCookiesFile', { locale }),
  openFontFileHandler: (locale) => ipcRenderer.invoke('dialog:openFontFile', { locale }),
  getAudioFilesFromPaths: (paths) => ipcRenderer.invoke('file:getFilesFromPaths', paths),
  exportPlaylistM3U: (payload) => ipcRenderer.invoke('playlist:exportM3U', payload),
  exportPlaylistText: (payload) => ipcRenderer.invoke('playlist:exportText', payload),
  rescanFolders: (payload) => ipcRenderer.invoke('file:rescanFolders', payload),
  batchExistsHandler: (paths) => ipcRenderer.invoke('file:batchExists', paths),
  deleteAudioFileHandler: (filePath) => ipcRenderer.invoke('file:deleteAudioFile', filePath),
  watchLibraryFolders: (payload) => ipcRenderer.invoke('library:watchFolders', payload),
  stopWatchingLibraryFolders: () => ipcRenderer.invoke('library:stopWatchingFolders'),
  onLibraryFoldersChanged: (callback) => {
    const channel = 'library:folders-changed'
    const handler = (_, data) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  readLyricsHandler: (audioPath) => ipcRenderer.invoke('file:readLyrics', audioPath),
  toRomajiBatch: (texts) => ipcRenderer.invoke('lyrics:toRomajiBatch', texts),
  fetchNeteaseLyrics: (payload) => ipcRenderer.invoke('lyrics:neteaseFetch', payload),
  searchExternalLyrics: (payload) => ipcRenderer.invoke('lyrics:searchExternal', payload),
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
  hideToTrayHandler: () => ipcRenderer.invoke('window:hide-to-tray'),
  maximizeAppHandler: () => ipcRenderer.send('window:maximize'),
  minimizeAppHandler: () => ipcRenderer.send('window:minimize'),
  downloadSoundCloud: (url, downloadPath) =>
    ipcRenderer.invoke('soundcloud:download', url, downloadPath),
  getExtendedMetadataHandler: (path) => ipcRenderer.invoke('file:getExtendedMetadata', path),
  detectBpmHandler: (path) => ipcRenderer.invoke('file:detectBpm', path),
  updateExtendedMetadataHandler: (payload) =>
    ipcRenderer.invoke('file:updateExtendedMetadata', payload),
  readTags: (filePath) => ipcRenderer.invoke('tags:read', filePath),
  writeTags: (filePath, tags, newCoverPath) =>
    ipcRenderer.invoke('tags:write', filePath, tags, newCoverPath),
  batchRenameFilesHandler: (payload) => ipcRenderer.invoke('file:batchRenameFiles', payload),
  setDiscordActivity: (activity) => ipcRenderer.send('discord:setActivity', activity),
  clearDiscordActivity: () => ipcRenderer.send('discord:clearActivity'),
  toggleDiscordRPC: (enabled) => ipcRenderer.send('discord:toggle', enabled),
  neteaseSearch: (keywords, cookie) => ipcRenderer.invoke('netease:search', keywords, cookie),
  neteaseSearchAlbum: (payload) => ipcRenderer.invoke('netease:searchAlbum', payload),
  neteaseGetAlbumTracks: (albumId, cookie) =>
    ipcRenderer.invoke('netease:getAlbumTracks', { albumId, cookie }),
  getNeteaseSongUrl: (songId, level, cookie) =>
    ipcRenderer.invoke('netease:getSongUrl', songId, level, cookie),
  qqMusicSearch: (keywords, cookie) => ipcRenderer.invoke('qqMusic:search', keywords, cookie),
  qqMusicSearchAlbum: (payload) => ipcRenderer.invoke('qqMusic:searchAlbum', payload),
  qqMusicGetAlbumTracks: (album, cookie) =>
    ipcRenderer.invoke('qqMusic:getAlbumTracks', { ...(album || {}), cookie }),
  qqMusicGetSongUrl: (song, qualityPreset, cookie) =>
    ipcRenderer.invoke('qqMusic:getSongUrl', song, qualityPreset, cookie),
  lastfm: {
    login: (u, p) => ipcRenderer.invoke('lastfm:login', u, p),
    logout: () => ipcRenderer.invoke('lastfm:logout'),
    setSession: (sk, u) => ipcRenderer.invoke('lastfm:setSession', sk, u),
    nowPlaying: (artist, track, album, dur) =>
      ipcRenderer.invoke('lastfm:nowPlaying', artist, track, album, dur),
    scrobble: (artist, track, album, startedAt, dur) =>
      ipcRenderer.invoke('lastfm:scrobble', artist, track, album, startedAt, dur)
  },

  media: {
    fetchNeteaseLrcText: (params) => ipcRenderer.invoke('netease:fetchLrcText', params),
    writeFile: (filePath, text) => ipcRenderer.invoke('media:writeFile', filePath, text),
    getMetadata: (url, options) => ipcRenderer.invoke('media:getMetadata', url, options),
    downloadAudio: (url, folder, options) =>
      ipcRenderer.invoke('media:download', url, folder, options),
    downloadFromUrl: (opts) => ipcRenderer.invoke('media:downloadFromUrl', opts),
    applyDownloadedMetadata: (payload) => ipcRenderer.invoke('media:applyDownloadedMetadata', payload),
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
  playlistShare: {
    importPlaylists: (payload) => ipcRenderer.invoke('playlistShare:import', payload),
    onImportProgress: (callback) => {
      const channel = 'playlist-share:import-progress'
      const handler = (_, data) => callback(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  },
  // === Native Audio Engine ===
  getAudioDevices: () => ipcRenderer.invoke('audio:getDevices'),
  getAsioDevices: () => ipcRenderer.invoke('audio:getAsioDevices'),
  setAudioDevice: (id) => ipcRenderer.invoke('audio:setDevice', id),
  setAsioMode: (enabled) => ipcRenderer.invoke('audio:setAsio', enabled),
  setAudioExclusive: (exclusive) => ipcRenderer.invoke('audio:setExclusive', exclusive),
  setAudioOutputBufferProfile: (profile) =>
    ipcRenderer.invoke('audio:setOutputBufferProfile', profile),
  setAudioEqConfig: (eqConfig) => ipcRenderer.invoke('audio:setEqConfig', eqConfig),
  playAudio: (path, startTime, playbackRate, sourceSampleRateHint) =>
    ipcRenderer.invoke('audio:play', path, startTime, playbackRate, sourceSampleRateHint),
  setAudioPlaybackRate: (rate) => ipcRenderer.invoke('audio:setPlaybackRate', rate),
  pauseAudio: () => ipcRenderer.invoke('audio:pause'),
  resumeAudio: () => ipcRenderer.invoke('audio:resume'),
  audioStartFadeOut: (ms) => ipcRenderer.invoke('audio:startFadeOut', ms),
  audioStartFadeIn: (ms) => ipcRenderer.invoke('audio:startFadeIn', ms),
  audioCancelFade: () => ipcRenderer.invoke('audio:cancelFade'),
  stopAudio: () => ipcRenderer.invoke('audio:stop'),
  setAudioVolume: (vol) => ipcRenderer.invoke('audio:setVolume', vol),
  loadVstPlugin: (path) => ipcRenderer.invoke('audio:loadVst', path),
  disableVstPlugin: () => ipcRenderer.invoke('audio:disableVst'),
  showVstPluginUI: () => ipcRenderer.invoke('audio:showVstUI'),
  openLyricsDesktop: () => ipcRenderer.invoke('lyricsDesktop:open'),
  closeLyricsDesktop: () => ipcRenderer.invoke('lyricsDesktop:close'),
  setLyricsDesktopAlwaysOnTop: (isAlwaysOnTop) =>
    ipcRenderer.invoke('lyricsDesktop:setAlwaysOnTop', isAlwaysOnTop),
  setLyricsDesktopLocked: (isLocked) => ipcRenderer.invoke('lyricsDesktop:setLocked', isLocked),
  /** Close overlay and uncheck “desktop lyrics” in the main window (Escape / right-click). */
  dismissLyricsDesktop: () => ipcRenderer.invoke('lyricsDesktop:dismiss'),
  notifyLyricsDesktopReady: () => ipcRenderer.invoke('lyricsDesktop:ready'),
  onLyricsDesktopData: (callback) => {
    const ch = 'lyrics-desktop:data'
    const handler = (_, data) => callback(data)
    ipcRenderer.on(ch, handler)
    return () => ipcRenderer.removeListener(ch, handler)
  },
  onLyricsDesktopUncheck: (callback) => {
    const ch = 'lyrics-desktop:uncheck'
    const handler = () => callback()
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
  setAudioGapless: (enabled) => ipcRenderer.invoke('audio:setGapless', enabled),
  audioPrebufferNext: (filePath) => ipcRenderer.invoke('audio:prebufferNext', filePath),
  audioCancelPrebuffer: () => ipcRenderer.invoke('audio:cancelPrebuffer'),
  onGaplessTrackChanged: (callback) => {
    const channel = 'audio:gapless-track-changed'
    const handler = (_, nextPath) => callback(nextPath)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  onPlayerCmd: (cb) => {
    const channel = 'player:cmd'
    const handler = (_, cmd) => cb(cmd)
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
  openYoutubeSystemSignIn: (browser) => ipcRenderer.invoke('youtube:openSystemSignIn', browser),
  saveYoutubeSystemCookies: () => ipcRenderer.invoke('youtube:saveSystemCookies'),
  getYoutubeSystemCookieStatus: () => ipcRenderer.invoke('youtube:getSystemCookieStatus'),
  openBilibiliSignInWindow: () => ipcRenderer.invoke('bilibili:openSignInWindow'),
  openNeteaseSignInWindow: () => ipcRenderer.invoke('netease:openSignInWindow'),
  getNeteaseCookie: (preferredCookie) => ipcRenderer.invoke('netease:getCookie', preferredCookie),
  openQqMusicSignInWindow: () => ipcRenderer.invoke('qqMusic:openSignInWindow'),
  getQqMusicCookie: (preferredCookie) => ipcRenderer.invoke('qqMusic:getCookie', preferredCookie),
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
