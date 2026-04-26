import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Download,
  FolderHeart,
  Music,
  Loader2,
  CheckCircle2,
  AlertCircle,
  CloudDownload
} from 'lucide-react'
import { writeTrackMetaCache } from './utils/trackMetaCache'

function isSoundCloudUrl(value) {
  try {
    const hostname = new URL(String(value || '').trim()).hostname
    return /(^|\.)soundcloud\.com$/i.test(hostname)
  } catch {
    return false
  }
}

function normalizeYoutubeCookieBrowser(value) {
  const browser = String(value || 'edge').trim().toLowerCase()
  if (browser === 'chrome' || browser === 'edge' || browser === 'firefox') return browser
  if (browser === 'none') return 'none'
  return 'edge'
}

export default function DownloaderView({
  config,
  setConfig,
  albumContext = null,
  downloadFolder = '',
  onSuccess,
  userPlaylists = [],
  setUserPlaylists,
  setPlaylist,
  setSelectedUserPlaylistId
}) {
  const { t, i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const [url, setUrl] = useState('')
  const [metadata, setMetadata] = useState(null)
  const [isLoadingMeta, setIsLoadingMeta] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [linkImportUrl, setLinkImportUrl] = useState('')
  const [linkImportTarget, setLinkImportTarget] = useState('new')
  const [linkImporting, setLinkImporting] = useState(false)
  const [linkImportStatus, setLinkImportStatus] = useState('')
  const [downloadProvider, setDownloadProvider] = useState('netease')
  const [neteaseCookieInput, setNeteaseCookieInput] = useState('')
  const [neteaseCookieSaved, setNeteaseCookieSaved] = useState('')
  const [neteaseAuth, setNeteaseAuth] = useState({
    checking: true,
    valid: false,
    signedIn: false,
    isVip: false,
    error: ''
  })
  const [qqMusicCookieInput, setQqMusicCookieInput] = useState('')
  const [qqMusicCookieSaved, setQqMusicCookieSaved] = useState('')
  const [qqMusicAuth, setQqMusicAuth] = useState({
    checking: true,
    valid: false,
    signedIn: false,
    isVip: false,
    error: ''
  })
  const [audioQualityPreset, setAudioQualityPreset] = useState('auto')
  const [isNeteaseSigningIn, setIsNeteaseSigningIn] = useState(false)
  const [isQqMusicSigningIn, setIsQqMusicSigningIn] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [downloadNotice, setDownloadNotice] = useState('')
  const [use1music, setUse1music] = useState(() => {
    try {
      return localStorage.getItem('echoes.use1music') === '1'
    } catch {
      return false
    }
  })
  const [downloadingSongId, setDownloadingSongId] = useState(null)
  const [albumSearching, setAlbumSearching] = useState(false)
  const [albumMissingTracks, setAlbumMissingTracks] = useState([])
  const [albumError, setAlbumError] = useState('')
  const [albumDownloadingId, setAlbumDownloadingId] = useState(null)
  const [youtubeLoginSaving, setYoutubeLoginSaving] = useState(false)
  const [youtubeLoginStatus, setYoutubeLoginStatus] = useState('')
  const downloaderPrefsHydratedRef = useRef(false)

  const effectiveDownloadFolder = String(downloadFolder || config.downloadFolder || '').trim()
  const youtubeCookieBrowser = normalizeYoutubeCookieBrowser(config.youtubeCookieBrowser)
  const youtubeCookieFile = String(config.youtubeCookieFile || '').trim()

  const normalizeTrackCompareTitle = useCallback((value) => {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  }, [])

  const normalizeAlbumCompareTitle = useCallback((value) => {
    return String(value || '')
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）|【[^】]*】/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }, [])

  const formatDuration = useCallback((durationMs) => {
    const totalSeconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }, [])

  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      try {
        const savedCookie = localStorage.getItem('echoes.neteaseCookie') || ''
        const savedQqMusicCookie = localStorage.getItem('echoes.qqMusicCookie') || ''
        const savedQuality = localStorage.getItem('echoes.downloaderAudioQuality') || 'auto'
        const savedProvider = localStorage.getItem('echoes.downloaderProvider') || 'netease'
        if (!cancelled) {
          setNeteaseCookieSaved(savedCookie)
          setQqMusicCookieSaved(savedQqMusicCookie)
          setAudioQualityPreset(savedQuality)
          setDownloadProvider(savedProvider === 'qq' ? 'qq' : 'netease')
        }
      } catch (_) {}
      try {
        const prefs = await window.api?.appStateGet?.('downloaderSettings')
        if (
          !cancelled &&
          prefs &&
          typeof prefs === 'object' &&
          (typeof prefs.neteaseCookie === 'string' ||
            typeof prefs.qqMusicCookie === 'string' ||
            typeof prefs.audioQualityPreset === 'string' ||
            typeof prefs.downloadProvider === 'string')
        ) {
          if (typeof prefs.neteaseCookie === 'string') setNeteaseCookieSaved(prefs.neteaseCookie)
          if (typeof prefs.qqMusicCookie === 'string') setQqMusicCookieSaved(prefs.qqMusicCookie)
          if (typeof prefs.audioQualityPreset === 'string')
            setAudioQualityPreset(prefs.audioQualityPreset || 'auto')
          if (typeof prefs.downloadProvider === 'string')
            setDownloadProvider(prefs.downloadProvider === 'qq' ? 'qq' : 'netease')
        }
      } catch (_) {}
      if (!cancelled) downloaderPrefsHydratedRef.current = true
    }
    hydrate()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!downloaderPrefsHydratedRef.current || !window.api?.appStateSet) return
    void window.api.appStateSet('downloaderSettings', {
      neteaseCookie: neteaseCookieSaved || '',
      qqMusicCookie: qqMusicCookieSaved || '',
      downloadProvider,
      audioQualityPreset: audioQualityPreset || 'auto'
    })
  }, [neteaseCookieSaved, qqMusicCookieSaved, downloadProvider, audioQualityPreset])

  useEffect(() => {
    try {
      localStorage.setItem('echoes.use1music', use1music ? '1' : '0')
    } catch (_) {}
  }, [use1music])

  useEffect(() => {
    let cancelled = false
    const loadYoutubeCookieStatus = async () => {
      try {
        const status = await window.api?.getYoutubeSystemCookieStatus?.()
        if (cancelled || !status?.available) return
        setYoutubeLoginStatus(isZh ? '已保存 YouTube 登录状态' : 'YouTube sign-in saved')
      } catch (_) {}
    }
    void loadYoutubeCookieStatus()
    return () => {
      cancelled = true
    }
  }, [isZh])

  const applyNeteaseCookie = useCallback((cookie) => {
    const next = String(cookie || '').trim()
    setNeteaseCookieSaved(next)
    try {
      if (next) localStorage.setItem('echoes.neteaseCookie', next)
      else localStorage.removeItem('echoes.neteaseCookie')
    } catch (_) {}
  }, [])

  const applyQqMusicCookie = useCallback((cookie) => {
    const next = String(cookie || '').trim()
    setQqMusicCookieSaved(next)
    try {
      if (next) localStorage.setItem('echoes.qqMusicCookie', next)
      else localStorage.removeItem('echoes.qqMusicCookie')
    } catch (_) {}
  }, [])

  const updateDownloadProvider = useCallback((provider) => {
    const next = provider === 'qq' ? 'qq' : 'netease'
    setDownloadProvider(next)
    setSearchResults([])
    setAlbumMissingTracks([])
    setAlbumError('')
    setDownloadNotice('')
    try {
      localStorage.setItem('echoes.downloaderProvider', next)
    } catch (_) {}
  }, [])

  const refreshNeteaseCookieFromSession = useCallback(
    async (preferredCookie = '') => {
      if (!window.api?.getNeteaseCookie) return
      setNeteaseAuth((prev) => ({ ...prev, checking: true, error: '' }))
      try {
        const out = await window.api.getNeteaseCookie(preferredCookie || neteaseCookieSaved)
        if (out?.ok && out?.valid && out?.cookie) {
          applyNeteaseCookie(out.cookie)
        } else if (out?.checked) {
          applyNeteaseCookie('')
        }
        setNeteaseAuth({
          checking: false,
          valid: out?.valid === true,
          signedIn: out?.signedIn === true,
          isVip: out?.isVip === true,
          error: out?.error || ''
        })
      } catch (_) {
      } finally {
        setNeteaseAuth((prev) => ({ ...prev, checking: false }))
      }
    },
    [applyNeteaseCookie, neteaseCookieSaved]
  )

  const ensureUsableNeteaseCookie = useCallback(async () => {
    if (!window.api?.getNeteaseCookie) return ''
    try {
      const out = await window.api.getNeteaseCookie(neteaseCookieSaved)
      setNeteaseAuth({
        checking: false,
        valid: out?.valid === true,
        signedIn: out?.signedIn === true,
        isVip: out?.isVip === true,
        error: out?.error || ''
      })
      if (out?.ok && out?.valid && out?.cookie) {
        if (out.cookie !== neteaseCookieSaved) applyNeteaseCookie(out.cookie)
        return out.cookie
      }
      if (out?.checked) {
        applyNeteaseCookie('')
      }
    } catch (error) {
      setNeteaseAuth({
        checking: false,
        valid: false,
        signedIn: false,
        isVip: false,
        error: error?.message || String(error)
      })
    }
    return ''
  }, [applyNeteaseCookie, neteaseCookieSaved])

  const refreshQqMusicCookieFromSession = useCallback(
    async (preferredCookie = '') => {
      if (!window.api?.getQqMusicCookie) return
      setQqMusicAuth((prev) => ({ ...prev, checking: true, error: '' }))
      try {
        const out = await window.api.getQqMusicCookie(preferredCookie || qqMusicCookieSaved)
        if (out?.ok && out?.valid && out?.cookie) {
          applyQqMusicCookie(out.cookie)
        } else if (out?.checked) {
          applyQqMusicCookie('')
        }
        setQqMusicAuth({
          checking: false,
          valid: out?.valid === true,
          signedIn: out?.signedIn === true,
          isVip: out?.isVip === true,
          error: out?.error || ''
        })
      } catch (_) {
      } finally {
        setQqMusicAuth((prev) => ({ ...prev, checking: false }))
      }
    },
    [applyQqMusicCookie, qqMusicCookieSaved]
  )

  const ensureUsableQqMusicCookie = useCallback(async () => {
    if (!window.api?.getQqMusicCookie) return ''
    try {
      const out = await window.api.getQqMusicCookie(qqMusicCookieSaved)
      setQqMusicAuth({
        checking: false,
        valid: out?.valid === true,
        signedIn: out?.signedIn === true,
        isVip: out?.isVip === true,
        error: out?.error || ''
      })
      if (out?.ok && out?.valid && out?.cookie) {
        if (out.cookie !== qqMusicCookieSaved) applyQqMusicCookie(out.cookie)
        return out.cookie
      }
      if (out?.checked === false && out?.cookie) {
        if (out.cookie !== qqMusicCookieSaved) applyQqMusicCookie(out.cookie)
        return out.cookie
      }
      if (out?.checked) {
        applyQqMusicCookie('')
      }
    } catch (error) {
      setQqMusicAuth({
        checking: false,
        valid: false,
        signedIn: false,
        isVip: false,
        error: error?.message || String(error)
      })
    }
    return ''
  }, [applyQqMusicCookie, qqMusicCookieSaved])

  useEffect(() => {
    if (!window.api?.onSignInStatusChanged) return
    const unsub = window.api.onSignInStatusChanged(() => {
      void refreshNeteaseCookieFromSession()
      void refreshQqMusicCookieFromSession()
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [refreshNeteaseCookieFromSession, refreshQqMusicCookieFromSession])

  useEffect(() => {
    if (!downloaderPrefsHydratedRef.current) return
    void refreshNeteaseCookieFromSession(neteaseCookieSaved)
  }, [neteaseCookieSaved, refreshNeteaseCookieFromSession])

  useEffect(() => {
    if (!downloaderPrefsHydratedRef.current) return
    void refreshQqMusicCookieFromSession(qqMusicCookieSaved)
  }, [qqMusicCookieSaved, refreshQqMusicCookieFromSession])

  const openYoutubeSystemSignIn = useCallback(async () => {
    const browser = youtubeCookieBrowser === 'chrome' ? 'chrome' : 'edge'
    try {
      const result = await window.api?.openYoutubeSystemSignIn?.(browser)
      if (result?.ok) {
        setYoutubeLoginStatus(
          isZh
            ? `已打开 ${browser === 'chrome' ? 'Chrome' : 'Edge'}，登录完成后回到 ECHO 点“已登录”。`
            : `${browser === 'chrome' ? 'Chrome' : 'Edge'} opened. After signing in, return to ECHO and click Saved.`
        )
      } else {
        setYoutubeLoginStatus(
          isZh
            ? `无法打开 ${browser === 'chrome' ? 'Chrome' : 'Edge'}：${result?.error || '未知错误'}`
            : `Could not open ${browser === 'chrome' ? 'Chrome' : 'Edge'}: ${result?.error || 'unknown error'}`
        )
      }
    } catch (error) {
      setYoutubeLoginStatus(error?.message || String(error))
    }
  }, [isZh, youtubeCookieBrowser])

  const saveYoutubeSystemCookies = useCallback(async () => {
    setYoutubeLoginSaving(true)
    setYoutubeLoginStatus(isZh ? '正在保存 YouTube 登录状态…' : 'Saving YouTube sign-in...')
    try {
      const result = await window.api?.saveYoutubeSystemCookies?.()
      if (result?.ok) {
        setYoutubeLoginStatus(
          result.signedIn
            ? isZh
              ? '已保存 YouTube 登录状态，之后会自动用于解析/下载。'
              : 'YouTube sign-in saved. ECHO will use it automatically.'
            : isZh
              ? '已保存浏览器 cookies，但没有检测到完整登录状态；如果仍失败，请确认 YouTube 页面已登录。'
              : 'Browser cookies saved, but full sign-in was not detected. Please confirm YouTube is signed in if downloads still fail.'
        )
      } else {
        setYoutubeLoginStatus(
          isZh
            ? `保存失败：${result?.error || '请先打开登录窗口'}`
            : `Save failed: ${result?.error || 'open the sign-in window first'}`
        )
      }
    } catch (error) {
      setYoutubeLoginStatus(error?.message || String(error))
    } finally {
      setYoutubeLoginSaving(false)
    }
  }, [isZh])

  const handleLinkPlaylistImport = useCallback(async () => {
    if (!window.api?.playlistLink?.importPlaylist) return
    const playlistSaveDir = (config.playlistImportFolder || config.downloadFolder || '').trim()
    if (!playlistSaveDir) {
      alert(t('downloader.folderRequired'))
      return
    }
    const raw = linkImportUrl.trim()
    if (!raw) return
    const usableNeteaseCookie = await ensureUsableNeteaseCookie()
    const usableQqMusicCookie = await ensureUsableQqMusicCookie()
    setLinkImporting(true)
    setLinkImportStatus(t('downloader.connecting'))
    const tFn = i18n.getFixedT(i18n.language)
    const streamedPathSet = new Set()
    let createdPlaylistId = null
    let createdPlaylistName = ''
    const ensurePlaylistTarget = (playlistName) => {
      if (!setUserPlaylists || !setSelectedUserPlaylistId) return null
      if (linkImportTarget !== 'new') {
        setSelectedUserPlaylistId(linkImportTarget)
        return linkImportTarget
      }
      if (createdPlaylistId) {
        if (playlistName && playlistName !== createdPlaylistName) {
          createdPlaylistName = playlistName
          setUserPlaylists((prev) =>
            prev.map((pl) => (pl.id === createdPlaylistId ? { ...pl, name: playlistName } : pl))
          )
        }
        return createdPlaylistId
      }
      createdPlaylistId = crypto.randomUUID()
      createdPlaylistName = playlistName || 'Imported'
      setUserPlaylists((prev) => [
        ...prev,
        { id: createdPlaylistId, name: createdPlaylistName, paths: [] }
      ])
      setSelectedUserPlaylistId(createdPlaylistId)
      return createdPlaylistId
    }
    const appendImportedItems = (items) => {
      const normalizedItems = (items || []).filter((item) => item?.path)
      if (normalizedItems.length === 0) return
      const cacheEntries = {}
      for (const item of normalizedItems) {
        if (!item.cover && !item.title && !item.artist && !item.album) continue
        cacheEntries[item.path] = {
          title: item.title || item.trackTitle || null,
          artist: item.artist || item.artists || null,
          album: item.album || null,
          albumArtist: item.artist || item.artists || null,
          cover: item.cover || null,
          coverChecked: Boolean(item.cover)
        }
      }
      if (Object.keys(cacheEntries).length > 0) {
        void writeTrackMetaCache(cacheEntries)
      }
      if (setPlaylist) {
        setPlaylist((prev) => {
          const seen = new Set(prev.map((x) => x.path))
          const next = [...prev]
          for (const track of normalizedItems) {
            if (!seen.has(track.path)) {
              seen.add(track.path)
              next.push(track)
            }
          }
          return next
        })
      }
      const targetId = linkImportTarget === 'new' ? createdPlaylistId : linkImportTarget
      if (targetId && setUserPlaylists) {
        const paths = normalizedItems.map((x) => x.path)
        setUserPlaylists((prev) =>
          prev.map((p) =>
            p.id === targetId ? { ...p, paths: [...new Set([...p.paths, ...paths])] } : p
          )
        )
      }
    }
    const unsub = window.api.playlistLink.onImportProgress((p) => {
      if (p.phase === 'meta') {
        ensurePlaylistTarget(p.playlistName || 'Imported')
        setLinkImportStatus(
          tFn('downloader.linkMetaLine', {
            name: p.playlistName,
            total: p.total
          })
        )
      } else if (p.phase === 'download') {
        setLinkImportStatus(
          tFn('downloader.downloadProgress', {
            current: p.current,
            total: p.total,
            track: p.trackName || ''
          })
        )
      } else if (p.phase === 'bulk') {
        const pct =
          p.progress != null && Number.isFinite(p.progress) ? ` ${Math.round(p.progress)}%` : ''
        setLinkImportStatus(
          tFn('downloader.bulkProgress', {
            message: p.message || tFn('downloader.downloading'),
            pct
          })
        )
      } else if (p.phase === 'added' && p.path) {
        streamedPathSet.add(p.path)
        ensurePlaylistTarget(p.playlistName || createdPlaylistName || 'Imported')
        appendImportedItems([
          {
            name: p.path.split(/[/\\]/).pop() || p.trackTitle || 'track',
            path: p.path,
            type: 'local',
            ...(p.trackTitle ? { title: p.trackTitle } : {}),
            ...(p.artist ? { artist: p.artist, artists: p.artist } : {}),
            ...(p.album ? { album: p.album } : {}),
            ...(p.cover ? { cover: p.cover } : {}),
            ...(p.provider ? { downloadProvider: p.provider } : {}),
            ...(p.sourceUrl ? { sourceUrl: p.sourceUrl, mvOriginUrl: p.sourceUrl } : {})
          }
        ])
      }
    })
    try {
      const preferredFolderName =
        linkImportTarget === 'new'
          ? null
          : userPlaylists.find((pl) => pl.id === linkImportTarget)?.name || null
      const r = await window.api.playlistLink.importPlaylist({
        playlistInput: raw,
        downloadFolder: playlistSaveDir,
        preferredFolderName,
        neteaseCookie: usableNeteaseCookie,
        qqMusicCookie: usableQqMusicCookie,
        downloadProvider,
        audioQualityPreset,
        youtubeCookieBrowser,
        youtubeCookieFile,
        quickMode: config.downloaderQuickMode === true
      })
      const newItems = (r.added || [])
        .filter(({ path }) => path && !streamedPathSet.has(path))
        .map(({ path, trackTitle, sourceUrl, artist, album, cover, provider }) => ({
          name: path.split(/[/\\]/).pop() || trackTitle || 'track',
          path,
          type: 'local',
          ...(trackTitle ? { title: trackTitle } : {}),
          ...(artist ? { artist, artists: artist } : {}),
          ...(album ? { album } : {}),
          ...(cover ? { cover } : {}),
          ...(provider ? { downloadProvider: provider } : {}),
          ...(sourceUrl ? { sourceUrl, mvOriginUrl: sourceUrl } : {})
        }))
      if (r.playlistName) ensurePlaylistTarget(r.playlistName)
      if (newItems.length > 0) {
        appendImportedItems(newItems)
      }
      const failN = (r.failed || []).length
      const okN = (r.added || []).length
      if (failN > 0) {
        const first = r.failed[0]
        alert(
          t('downloader.importPartial', {
            ok: okN,
            fail: failN,
            name: first.name,
            error: first.error
          })
        )
      } else if (okN === 0) {
        alert(t('downloader.importNone'))
      }
      setLinkImportUrl('')
    } catch (e) {
      alert(e.message || String(e))
    } finally {
      unsub()
      setLinkImporting(false)
      setLinkImportStatus('')
    }
  }, [
    config.playlistImportFolder,
    config.downloadFolder,
    config.downloaderQuickMode,
    linkImportUrl,
    linkImportTarget,
    setPlaylist,
    setUserPlaylists,
    setSelectedUserPlaylistId,
    t,
    i18n,
    ensureUsableNeteaseCookie,
    ensureUsableQqMusicCookie,
    downloadProvider,
    audioQualityPreset,
    youtubeCookieBrowser,
    youtubeCookieFile
  ])

  useEffect(() => {
    const unsubscribe = window.api?.media?.onProgress?.((data) => {
      setProgress(data.progress)
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [])

  const handleFetchMetadata = async () => {
    const rawUrl = url.trim()
    if (!rawUrl) return
    if (!/^https?:\/\//i.test(rawUrl)) {
      // Treat as name search
      handleSearch(rawUrl)
      return
    }

    setIsLoadingMeta(true)
    setStatus('loading_meta')
    setErrorMsg('')
    setMetadata(null)
    setSearchResults([])
    try {
      const meta = await Promise.race([
        window.api.media.getMetadata(rawUrl, { youtubeCookieBrowser, youtubeCookieFile }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  isZh
                    ? '解析超时，请重新保存 YouTube 登录状态后再试'
                    : 'Metadata lookup timed out. Save YouTube sign-in again and retry.'
                )
              ),
            30000
          )
        )
      ])
      setMetadata(meta)
      setStatus('ready')
    } catch (err) {
      console.error(err)
      setErrorMsg(err.message || t('downloader.metaFailed'))
      setStatus('error')
    } finally {
      setIsLoadingMeta(false)
    }
  }

  const handleSearch = async (keywords) => {
    setIsSearching(true)
    setStatus('searching')
    setErrorMsg('')
    setDownloadNotice('')
    setMetadata(null)
    setSearchResults([])
    try {
      const res =
        downloadProvider === 'qq'
          ? await window.api.qqMusicSearch(keywords, await ensureUsableQqMusicCookie())
          : await window.api.neteaseSearch(keywords, await ensureUsableNeteaseCookie())
      setSearchResults(res || [])
      setStatus('search_ok')
    } catch (err) {
      console.error(err)
      const rawMessage = err?.message || ''
      setErrorMsg(
        downloadProvider === 'qq'
          ? isZh
            ? `QQ 音乐搜索失败${rawMessage ? `：${rawMessage}` : ''}`
            : `QQ Music search failed${rawMessage ? `: ${rawMessage}` : ''}`
          : rawMessage || 'Search failed'
      )
      setStatus('error')
    } finally {
      setIsSearching(false)
    }
  }

  const handleDownload = async () => {
    if (!url || !effectiveDownloadFolder) return
    setIsDownloading(true)
    setStatus('downloading')
    setProgress(0)
    setErrorMsg('')
    setDownloadNotice('')

    try {
      if (isSoundCloudUrl(url)) {
        const result = await window.api.downloadSoundCloud(url.trim(), effectiveDownloadFolder)
        if (!result?.success || !result?.path) {
          throw new Error(result?.error || t('downloader.downloadFailed'))
        }
        setProgress(100)
        setStatus('success')
        if (onSuccess) {
          onSuccess({
            path: result.path,
            sourceUrl: url.trim(),
            mvOriginUrl: url.trim(),
            hasLyrics: false
          })
        }
        return
      }

      const usableNeteaseCookie = await ensureUsableNeteaseCookie()
      const filesBefore = await window.api
        .readDirectoryHandler(effectiveDownloadFolder)
        .catch(() => [])

      await window.api.media.downloadAudio(url, effectiveDownloadFolder, {
        audioQualityPreset,
        neteaseCookie: usableNeteaseCookie,
        youtubeCookieBrowser,
        youtubeCookieFile,
        quickMode: config.downloaderQuickMode === true
      })
      setStatus('success')

      const filesAfter = await window.api
        .readDirectoryHandler(effectiveDownloadFolder)
        .catch(() => [])
      const newFiles = filesAfter.filter((fa) => !filesBefore.find((fb) => fb.path === fa.path))

      if (newFiles.length > 0) {
        const mId = url.match(/song\?id=(\d+)/) || url.match(/song\/(\d+)/i)
        const neteaseIdMatches = !!mId && newFiles.length === 1
        const downloadedMeta = {
          title: metadata?.title || null,
          artist: metadata?.artist || null,
          album: metadata?.album || null,
          albumArtist: metadata?.artist || null,
          cover: metadata?.thumbnail || null,
          coverChecked: Boolean(metadata?.thumbnail)
        }
        const hasDownloadedMeta =
          downloadedMeta.title ||
          downloadedMeta.artist ||
          downloadedMeta.album ||
          downloadedMeta.cover
        let hasLyrics = false

        if (hasDownloadedMeta) {
          const cacheEntries = {}
          for (const file of newFiles) {
            if (!file?.path) continue
            cacheEntries[file.path] = downloadedMeta
          }
          if (Object.keys(cacheEntries).length > 0) {
            void writeTrackMetaCache(cacheEntries)
          }
        }

        // Only apply matched NetEase lyrics when we know this download maps to a single file.
        if (neteaseIdMatches) {
          const filePath = newFiles[0].path
          try {
            console.log('[DownloaderView] Fetching matched lyrics for netease song id', mId[1])
            const lrcResult = await window.api.media
              .fetchNeteaseLrcText({ songId: mId[1], cookie: usableNeteaseCookie })
              .catch(() => null)
            const lrcText =
              typeof lrcResult === 'string' ? lrcResult : (lrcResult?.lrc ?? '')
            if (lrcText) {
              const lrcPath = filePath.replace(/\.[^/.]+$/, '.lrc')
              await window.api.media.writeFile(lrcPath, lrcText).catch(() => null)
              console.log('[DownloaderView] Saved LRC:', lrcPath)
              hasLyrics = true
            }
          } catch (err) {
            console.error('[DownloaderView] failed to dl lyrics:', err)
          }
        }

        if (onSuccess) {
          newFiles.forEach((file, index) => {
            onSuccess({
              path: file.path,
              sourceUrl: url.trim(),
              mvOriginUrl: url.trim(),
              hasLyrics: hasLyrics && index === 0,
              ...(downloadedMeta.title ? { title: downloadedMeta.title } : {}),
              ...(downloadedMeta.artist ? { artist: downloadedMeta.artist } : {}),
              ...(downloadedMeta.album ? { album: downloadedMeta.album } : {}),
              ...(downloadedMeta.cover ? { cover: downloadedMeta.cover } : {})
            })
          })
        }
      }
    } catch (err) {
      console.error(err)
      setErrorMsg(err.message || t('downloader.downloadFailed'))
      setStatus('error')
    } finally {
      setIsDownloading(false)
    }
  }

  const downloadNeteaseSong = useCallback(
    async (song, options = {}) => {
      if (!effectiveDownloadFolder) {
        throw new Error(t('downloader.noDirHint'))
      }

      const {
        onBeforeDownload,
        onAfterDownload,
        onFinallyDownload,
        updateGlobalStatus = false
      } = options

      const sanitize = (s) =>
        String(s || '')
          .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
          .trim()
      const safeName =
        sanitize(
          song.artist
            ? `${song.artist} - ${song.name}`
            : song.artists
              ? `${song.artists} - ${song.name}`
              : song.name
        ) || `nm_${song.id}`

      const usableNeteaseCookie = await ensureUsableNeteaseCookie()

      if (typeof onBeforeDownload === 'function') onBeforeDownload()
      if (updateGlobalStatus) {
        setIsDownloading(true)
        setProgress(0)
        setErrorMsg('')
        setStatus('downloading')
      }

      try {
        let filePath
        if (use1music) {
          const qualityMap = {
            lossless: 'lossless',
            high: 'exhigh',
            medium: 'higher',
            low: 'standard',
            auto: 'exhigh'
          }
          const level = qualityMap[audioQualityPreset] || 'exhigh'
          const urlInfo = await window.api.getNeteaseSongUrl(song.id, level, usableNeteaseCookie)
          if (!urlInfo?.url) throw new Error(t('downloader.directUrlFailed'))

          const ext = urlInfo.type || 'mp3'
          const filename = `${safeName}.${ext}`
          filePath = await window.api.media.downloadFromUrl({
            url: urlInfo.url,
            targetFolder: effectiveDownloadFolder,
            filename
          })
        } else {
          const neteaseUrl = `https://music.163.com/song?id=${song.id}`
          const filesBefore = await window.api
            .readDirectoryHandler(effectiveDownloadFolder)
            .catch(() => [])
          await window.api.media.downloadAudio(neteaseUrl, effectiveDownloadFolder, {
            audioQualityPreset,
            neteaseCookie: usableNeteaseCookie,
            quickMode: config.downloaderQuickMode === true
          })
          const filesAfter = await window.api
            .readDirectoryHandler(effectiveDownloadFolder)
            .catch(() => [])
          const newFiles = filesAfter.filter((fa) => !filesBefore.find((fb) => fb.path === fa.path))
          filePath = newFiles.length > 0 ? newFiles[0].path : null
        }

        let hasLyrics = false
        if (filePath) {
          try {
            const lrcResult = await window.api.media
              .fetchNeteaseLrcText({ songId: song.id, cookie: usableNeteaseCookie })
              .catch(() => null)
            const lrcText =
              typeof lrcResult === 'string' ? lrcResult : (lrcResult?.lrc ?? '')
            if (lrcText) {
              const lrcPath = filePath.replace(/\.[^/.]+$/, '.lrc')
              await window.api.media.writeFile(lrcPath, lrcText).catch(() => null)
              hasLyrics = true
            }
          } catch (_) {}
        }

        if (updateGlobalStatus) setStatus('success')
        if (filePath && onSuccess) {
          onSuccess({
            path: filePath,
            sourceUrl: `https://music.163.com/song?id=${song.id}`,
            mvOriginUrl: `https://music.163.com/song?id=${song.id}`,
            hasLyrics
          })
        }
        if (typeof onAfterDownload === 'function') onAfterDownload({ filePath, hasLyrics })
        return { filePath, hasLyrics }
      } catch (err) {
        if (updateGlobalStatus) {
          setErrorMsg(err.message || t('downloader.downloadFailed'))
          setStatus('error')
        }
        throw err
      } finally {
        if (updateGlobalStatus) setIsDownloading(false)
        if (typeof onFinallyDownload === 'function') onFinallyDownload()
      }
    },
    [
      audioQualityPreset,
      config.downloaderQuickMode,
      effectiveDownloadFolder,
      ensureUsableNeteaseCookie,
      onSuccess,
      t,
      use1music
    ]
  )

  const downloadQqMusicSong = useCallback(
    async (song, options = {}) => {
      if (!effectiveDownloadFolder) {
        throw new Error(t('downloader.noDirHint'))
      }

      const {
        onBeforeDownload,
        onAfterDownload,
        onFinallyDownload,
        updateGlobalStatus = false
      } = options

      const sanitize = (s) =>
        String(s || '')
          .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
          .trim()
      const artist = song.artist || song.artists || ''
      const safeName = sanitize(artist ? `${artist} - ${song.name}` : song.name) || `qq_${song.id}`
      const usableQqMusicCookie = await ensureUsableQqMusicCookie()

      if (typeof onBeforeDownload === 'function') onBeforeDownload()
      if (updateGlobalStatus) {
        setIsDownloading(true)
        setProgress(0)
        setErrorMsg('')
        setDownloadNotice('')
        setStatus('downloading')
      }

      try {
        const urlInfo = await window.api.qqMusicGetSongUrl(
          song,
          audioQualityPreset,
          usableQqMusicCookie
        )
        if (!urlInfo?.url) {
          throw new Error(
            isZh
              ? '无法获取 QQ 音乐直链，可能需要会员权限、单曲不可用或 Cookie 已失效'
              : 'Failed to get QQ Music direct URL; the track may require VIP, be unavailable, or the cookie expired'
          )
        }
        const filename = `${safeName}.${urlInfo.ext || urlInfo.type || 'mp3'}`
        const filePath = await window.api.media.downloadFromUrl({
          url: urlInfo.url,
          targetFolder: effectiveDownloadFolder,
          filename,
          headers: urlInfo.headers || {}
        })
        if (filePath && window.api.media.applyDownloadedMetadata) {
          try {
            await window.api.media.applyDownloadedMetadata({
              path: filePath,
              title: song.name || '',
              artist,
              album: song.album || '',
              albumArtist: artist,
              coverUrl: song.cover || ''
            })
          } catch (metadataError) {
            console.warn('[DownloaderView] failed to apply QQ Music metadata:', metadataError)
          }
        }
        if (filePath) {
          writeTrackMetaCache({
            [filePath]: {
              title: song.name || null,
              artist: artist || null,
              album: song.album || null,
              albumArtist: artist || null,
              cover: song.cover || null,
              coverChecked: true
            }
          })
        }

        if (urlInfo.degraded) {
          setDownloadNotice(
            isZh
              ? `QQ 音乐未返回无损音源，已降级保存为 ${urlInfo.qualityLabel || '最高可用音质'}。`
              : `QQ Music did not return a lossless stream; saved as ${urlInfo.qualityLabel || 'best available quality'}.`
          )
        }

        if (updateGlobalStatus) setStatus('success')
        if (filePath && onSuccess) {
          onSuccess({
            path: filePath,
            title: song.name || '',
            artist,
            artists: artist,
            album: song.album || '',
            albumArtist: artist,
            cover: song.cover || '',
            downloadProvider: 'qq',
            sourceUrl: song.mid ? `https://y.qq.com/n/ryqq/songDetail/${song.mid}` : '',
            mvOriginUrl: song.mid ? `https://y.qq.com/n/ryqq/songDetail/${song.mid}` : '',
            hasLyrics: false
          })
        }
        if (typeof onAfterDownload === 'function')
          onAfterDownload({ filePath, hasLyrics: false, degraded: urlInfo.degraded })
        return { filePath, hasLyrics: false, degraded: urlInfo.degraded }
      } catch (err) {
        if (updateGlobalStatus) {
          setErrorMsg(err.message || t('downloader.downloadFailed'))
          setStatus('error')
        }
        throw err
      } finally {
        if (updateGlobalStatus) setIsDownloading(false)
        if (typeof onFinallyDownload === 'function') onFinallyDownload()
      }
    },
    [
      audioQualityPreset,
      effectiveDownloadFolder,
      ensureUsableQqMusicCookie,
      isZh,
      onSuccess,
      t
    ]
  )

  const downloadProviderSong = useCallback(
    (song, options = {}) =>
      downloadProvider === 'qq' ? downloadQqMusicSong(song, options) : downloadNeteaseSong(song, options),
    [downloadProvider, downloadNeteaseSong, downloadQqMusicSong]
  )

  const handleSearchResultDownload = async (song) => {
    if (!effectiveDownloadFolder) {
      setErrorMsg(t('downloader.noDirHint'))
      setStatus('error')
      return
    }

    try {
      await downloadProviderSong(song, {
        updateGlobalStatus: true,
        onBeforeDownload: () => setDownloadingSongId(song.id),
        onFinallyDownload: () => setDownloadingSongId(null)
      })
    } catch (err) {
      console.error('[DownloaderView] search result download error:', err)
    }
  }

  useEffect(() => {
    setAlbumMissingTracks([])
    setAlbumError('')
    setAlbumSearching(false)
    setAlbumDownloadingId(null)
  }, [albumContext?.name, downloadProvider])

  const handleFindAlbumMissingTracks = useCallback(async () => {
    if (!albumContext?.name) return
    setAlbumSearching(true)
    setAlbumError('')
    setAlbumMissingTracks([])

    try {
      const searchResults =
        downloadProvider === 'qq'
          ? await window.api.qqMusicSearchAlbum({
              albumName: albumContext.name,
              artist: albumContext.artist || '',
              cookie: await ensureUsableQqMusicCookie()
            })
          : await window.api.neteaseSearchAlbum({
              albumName: albumContext.name,
              artist: albumContext.artist || '',
              cookie: neteaseCookieSaved || ''
            })

      if (!Array.isArray(searchResults) || searchResults.length === 0) {
        setAlbumError(
          t('downloader.neteaseSearchNoResults', isZh ? '未找到相关结果' : 'No related results found')
        )
        return
      }

      const targetAlbumNorm = normalizeAlbumCompareTitle(albumContext.name)
      const targetArtistNorm = normalizeAlbumCompareTitle(albumContext.artist)
      const bestAlbum = [...searchResults]
        .map((album) => {
          const nameNorm = normalizeAlbumCompareTitle(album.name)
          const artistNorm = normalizeAlbumCompareTitle(album.artist)
          let score = 0
          if (nameNorm === targetAlbumNorm) score += 100
          else if (nameNorm.includes(targetAlbumNorm) || targetAlbumNorm.includes(nameNorm)) score += 60
          if (artistNorm && targetArtistNorm && artistNorm === targetArtistNorm) score += 40
          else if (
            artistNorm &&
            targetArtistNorm &&
            (artistNorm.includes(targetArtistNorm) || targetArtistNorm.includes(artistNorm))
          ) {
            score += 20
          }
          return { album, score }
        })
        .sort((a, b) => b.score - a.score)[0]?.album

      if (!bestAlbum?.id) {
        setAlbumError(
          t('downloader.neteaseSearchNoResults', isZh ? '未找到相关结果' : 'No related results found')
        )
        return
      }

      const tracks =
        downloadProvider === 'qq'
          ? await window.api.qqMusicGetAlbumTracks(bestAlbum, await ensureUsableQqMusicCookie())
          : await window.api.neteaseGetAlbumTracks(bestAlbum.id, neteaseCookieSaved || '')
      if (!Array.isArray(tracks) || tracks.length === 0) {
        setAlbumError(t('downloader.importNone', isZh ? '未找到可用曲目' : 'No available tracks found'))
        return
      }

      const existingTitleSet = new Set(
        (albumContext.existingTracks || []).map((track) =>
          normalizeTrackCompareTitle(track?.info?.title || track?.name || '')
        )
      )
      const missing = tracks.filter(
        (track) => !existingTitleSet.has(normalizeTrackCompareTitle(track.name))
      )
      setAlbumMissingTracks(missing)
    } catch (error) {
      setAlbumError(error?.message || String(error))
    } finally {
      setAlbumSearching(false)
    }
  }, [
    albumContext,
    downloadProvider,
    ensureUsableQqMusicCookie,
    neteaseCookieSaved,
    normalizeAlbumCompareTitle,
    normalizeTrackCompareTitle,
    t
  ])

  const handleAlbumTrackDownload = useCallback(
    async (track) => {
      try {
        setAlbumError('')
        setAlbumDownloadingId(track.id)
        setProgress(0)
        await downloadProviderSong(track, {
          onFinallyDownload: () => setAlbumDownloadingId(null)
        })
      } catch (error) {
        console.error('[DownloaderView] album track download error:', error)
        setAlbumError(error?.message || t('downloader.downloadFailed'))
      }
    },
    [downloadProviderSong, t]
  )

  const handleDownloadAllMissingTracks = useCallback(async () => {
    const downloadableTracks = albumMissingTracks.filter((track) => Number(track.fee || 0) === 0)
    if (downloadableTracks.length === 0) return

    setAlbumError('')
    setAlbumDownloadingId(-1)
    setProgress(0)
    try {
      for (const track of downloadableTracks) {
        setAlbumDownloadingId(track.id)
        setProgress(0)
        await downloadProviderSong(track)
      }
    } catch (error) {
      console.error('[DownloaderView] album bulk download error:', error)
      setAlbumError(error?.message || t('downloader.downloadFailed'))
    } finally {
      setAlbumDownloadingId(null)
    }
  }, [albumMissingTracks, downloadProviderSong, t])

  const activeAuth = downloadProvider === 'qq' ? qqMusicAuth : neteaseAuth
  const activeCookieSaved = downloadProvider === 'qq' ? qqMusicCookieSaved : neteaseCookieSaved
  const providerName = downloadProvider === 'qq' ? 'QQ 音乐' : '网易云'

  return (
    <div className="md-root">
      <section className="md-section">
        <div className="md-quality-row">
          <div
            className="md-quality-group"
            role="group"
            aria-label={isZh ? '下载来源选择' : 'Download source'}
          >
            <button
              type="button"
              className={`md-quality-btn ${downloadProvider === 'netease' ? 'active' : ''}`}
              onClick={() => updateDownloadProvider('netease')}
              disabled={isDownloading}
            >
              网易云
            </button>
            <button
              type="button"
              className={`md-quality-btn ${downloadProvider === 'qq' ? 'active' : ''}`}
              onClick={() => updateDownloadProvider('qq')}
              disabled={isDownloading}
            >
              QQ 音乐
            </button>
          </div>
        </div>
        <div className="md-input-row md-netease-login-row">
          <input
            type="text"
            className="md-input"
            placeholder={
              downloadProvider === 'qq'
                ? isZh
                  ? '粘贴 QQ 音乐 Cookie 后点击登录'
                  : 'Paste QQ Music cookie, then sign in'
                : t('downloader.neteaseCookiePlaceholder')
            }
            value={downloadProvider === 'qq' ? qqMusicCookieInput : neteaseCookieInput}
            onChange={(e) =>
              downloadProvider === 'qq'
                ? setQqMusicCookieInput(e.target.value)
                : setNeteaseCookieInput(e.target.value)
            }
            disabled={isDownloading}
          />
          <button
            type="button"
            className="md-btn-parse"
            disabled={
              !(downloadProvider === 'qq' ? qqMusicCookieInput : neteaseCookieInput).trim() ||
              isDownloading
            }
            onClick={async () => {
              const next =
                downloadProvider === 'qq' ? qqMusicCookieInput.trim() : neteaseCookieInput.trim()
              if (downloadProvider === 'qq') {
                applyQqMusicCookie(next)
                setQqMusicCookieInput('')
                await refreshQqMusicCookieFromSession(next)
              } else {
                applyNeteaseCookie(next)
                setNeteaseCookieInput('')
                await refreshNeteaseCookieFromSession(next)
              }
            }}
          >
            {downloadProvider === 'qq'
              ? isZh
                ? '登录 QQ 音乐'
                : 'Sign in QQ Music'
              : t('downloader.neteaseLogin')}
          </button>
          <button
            type="button"
            className="md-btn-secondary md-btn-netease-oneclick"
            disabled={isDownloading || isNeteaseSigningIn || isQqMusicSigningIn}
            onClick={async () => {
              try {
                if (downloadProvider === 'qq') {
                  if (!window.api?.openQqMusicSignInWindow || !window.api?.getQqMusicCookie) {
                    throw new Error(t('downloader.neteaseFeatureNeedRestart'))
                  }
                  setIsQqMusicSigningIn(true)
                  const r = await window.api.openQqMusicSignInWindow()
                  if (!r?.ok) throw new Error(r?.error || 'open_failed')
                  await refreshQqMusicCookieFromSession()
                  return
                }
                if (!window.api?.openNeteaseSignInWindow || !window.api?.getNeteaseCookie) {
                  throw new Error(t('downloader.neteaseFeatureNeedRestart'))
                }
                setIsNeteaseSigningIn(true)
                const r = await window.api.openNeteaseSignInWindow()
                if (!r?.ok) throw new Error(r?.error || 'open_failed')
                await refreshNeteaseCookieFromSession()
              } catch (e) {
                setErrorMsg(
                  e?.message ||
                    (downloadProvider === 'qq'
                      ? isZh
                        ? '无法打开 QQ 音乐登录窗口'
                        : 'Failed to open QQ Music sign-in window'
                      : t('downloader.neteaseOpenLoginFailed'))
                )
                setStatus('error')
              } finally {
                setIsNeteaseSigningIn(false)
                setIsQqMusicSigningIn(false)
              }
            }}
          >
            {downloadProvider === 'qq'
              ? isQqMusicSigningIn
                ? isZh
                  ? '正在打开登录页…'
                  : 'Opening sign-in page...'
                : isZh
                  ? '一键登录获取'
                  : 'One-click Sign In'
              : isNeteaseSigningIn
                ? t('downloader.neteaseOpening')
                : t('downloader.neteaseOneClick')}
          </button>
        </div>
        <p className="md-netease-status">
          {activeAuth.checking
            ? downloadProvider === 'qq'
              ? isZh
                ? '正在检查 QQ 音乐登录状态…'
                : 'Checking QQ Music sign-in status...'
              : t('downloader.neteaseChecking')
            : activeAuth.valid
              ? downloadProvider === 'qq'
                ? isZh
                  ? 'QQ 音乐账号已登录（Cookie 已保存）'
                  : 'QQ Music account signed in (cookie saved)'
                : activeAuth.isVip
                  ? t('downloader.neteaseLoggedInVip')
                  : t('downloader.neteaseLoggedIn')
              : activeCookieSaved
                ? downloadProvider === 'qq'
                  ? isZh
                    ? '已保存的 QQ 音乐 Cookie 已失效，请重新登录'
                    : 'Saved QQ Music cookie expired. Please sign in again.'
                  : t('downloader.neteaseCookieExpired')
                : downloadProvider === 'qq'
                  ? isZh
                    ? '未登录 QQ 音乐账号（无损/高音质通常需要会员 Cookie）'
                    : 'Not signed in to QQ Music (lossless/high quality usually requires a VIP cookie)'
                  : t('downloader.neteaseNotLoggedIn')}
        </p>
        <div className="md-quality-row">
          <div
            className="md-quality-group"
            role="group"
            aria-label={t('downloader.qualityGroupLabel')}
          >
            {['auto', 'lossless', 'high', 'medium', 'low'].map((key) => (
              <button
                key={key}
                type="button"
                className={`md-quality-btn ${audioQualityPreset === key ? 'active' : ''}`}
                onClick={() => {
                  setAudioQualityPreset(key)
                  try {
                    localStorage.setItem('echoes.downloaderAudioQuality', key)
                  } catch (_) {}
                }}
                disabled={isDownloading}
              >
                {t(`downloader.quality${key.charAt(0).toUpperCase()}${key.slice(1)}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="md-quality-row" style={{ alignItems: 'flex-start', marginTop: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {isZh ? 'YouTube 登录来源' : 'YouTube sign-in source'}
            </div>
            <div
              className="md-quality-group"
              role="group"
              aria-label={isZh ? 'YouTube 登录来源' : 'YouTube sign-in source'}
            >
              {[
                ['edge', 'Edge'],
                ['chrome', 'Chrome'],
                ['firefox', 'Firefox'],
                ['none', isZh ? '不使用' : 'None']
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`md-quality-btn ${youtubeCookieBrowser === key ? 'active' : ''}`}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      youtubeCookieBrowser: key
                    }))
                  }
                  disabled={isDownloading}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-soft)', marginTop: 5 }}>
              {isZh
                ? '推荐用下面的一键登录：ECHO 会打开真正的系统浏览器，并自动保存登录状态给下载器使用。'
                : 'Recommended: use one-click sign-in below. ECHO opens the real system browser and saves the sign-in for downloads.'}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'center',
                marginTop: 8
              }}
            >
              <button
                type="button"
                className="md-btn-secondary"
                disabled={
                  isDownloading ||
                  youtubeCookieBrowser === 'firefox' ||
                  youtubeCookieBrowser === 'none'
                }
                onClick={openYoutubeSystemSignIn}
              >
                {isZh
                  ? `用 ${youtubeCookieBrowser === 'chrome' ? 'Chrome' : 'Edge'} 登录`
                  : `Sign in with ${youtubeCookieBrowser === 'chrome' ? 'Chrome' : 'Edge'}`}
              </button>
              <button
                type="button"
                className="md-btn-secondary"
                disabled={isDownloading || youtubeLoginSaving}
                onClick={saveYoutubeSystemCookies}
              >
                {youtubeLoginSaving ? (
                  <Loader2 size={14} className="spin" />
                ) : isZh ? (
                  '已登录，保存'
                ) : (
                  'Saved'
                )}
              </button>
            </div>
            {youtubeLoginStatus ? (
              <div style={{ fontSize: 11, color: 'var(--text-soft)', marginTop: 6 }}>
                {youtubeLoginStatus}
              </div>
            ) : null}
          </div>
        </div>
        <div
          className="md-1music-toggle-row"
          style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}
        >
          <button
            type="button"
            role="switch"
            aria-checked={config.downloaderQuickMode === true}
            className={`lyrics-drawer-switch ${config.downloaderQuickMode ? 'on' : ''}`}
            onClick={() => setConfig((prev) => ({ ...prev, downloaderQuickMode: !prev.downloaderQuickMode }))}
            disabled={isDownloading}
            style={{ flexShrink: 0 }}
          >
            <span className="lyrics-drawer-switch-thumb" />
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', userSelect: 'none' }}>
              {t('downloader.quickModeLabel')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-soft)', marginTop: 2 }}>
              {t('downloader.quickModeHint')}
            </div>
          </div>
          {config.downloaderQuickMode && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--accent-color)',
                fontWeight: 600,
                marginLeft: 'auto'
              }}
            >
              FAST
            </span>
          )}
        </div>
        {downloadProvider === 'netease' && (
          <div
            className="md-1music-toggle-row"
            style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}
          >
            <button
              type="button"
              role="switch"
              aria-checked={use1music}
              className={`lyrics-drawer-switch ${use1music ? 'on' : ''}`}
              onClick={() => setUse1music((v) => !v)}
              disabled={isDownloading}
              style={{ flexShrink: 0 }}
            >
              <span className="lyrics-drawer-switch-thumb" />
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', userSelect: 'none' }}>
              {t('downloader.use1musicLabel')}
            </span>
            {use1music && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--accent-color)',
                  fontWeight: 600,
                  marginLeft: 'auto'
                }}
              >
                1music
              </span>
            )}
          </div>
        )}
        {activeCookieSaved ? (
          <div className="md-logout-row">
            <button
              type="button"
              className="md-btn-secondary"
              disabled={isDownloading}
              onClick={() => {
                if (downloadProvider === 'qq') {
                  applyQqMusicCookie('')
                  setQqMusicAuth({
                    checking: false,
                    valid: false,
                    signedIn: false,
                    isVip: false,
                    error: ''
                  })
                } else {
                  applyNeteaseCookie('')
                  setNeteaseAuth({
                    checking: false,
                    valid: false,
                    signedIn: false,
                    isVip: false,
                    error: ''
                  })
                }
              }}
            >
              {downloadProvider === 'qq'
                ? isZh
                  ? '退出 QQ 音乐'
                  : 'Sign out QQ Music'
                : t('downloader.neteaseLogout')}
            </button>
          </div>
        ) : null}
      </section>

      {albumContext ? (
        <section className="md-section md-album-fill-section">
          <div className="md-album-fill-card">
            <div className="md-album-fill-copy">
              <div className="md-album-fill-title">
                <Music size={16} />
                <span>
                  {albumContext.name}
                  {albumContext.artist ? ` - ${albumContext.artist}` : ''}
                </span>
              </div>
              <div className="md-album-fill-sub">
                {albumMissingTracks.length > 0
                  ? t('downloader.albumFillLoaded', {
                      defaultValue: isZh
                        ? '本地已有 {{have}} 首，专辑共 {{total}} 首'
                        : 'Local library has {{have}} tracks, album total {{total}} tracks',
                      have: albumContext.existingTracks.length,
                      total: albumContext.existingTracks.length + albumMissingTracks.length
                    })
                  : t('downloader.albumFillHint', {
                      defaultValue: isZh
                        ? '本地已有 {{have}} 首，点击补齐专辑查询缺失曲目'
                        : 'Local library has {{have}} tracks. Click Fill Album to find missing tracks.',
                      have: albumContext.existingTracks.length
                    })}
              </div>
              <div className="md-album-fill-sub">
                {isZh ? `当前来源：${providerName}` : `Current source: ${providerName}`}
              </div>
            </div>
            <button
              type="button"
              className="md-btn-secondary md-album-fill-btn"
              disabled={albumSearching || albumDownloadingId !== null}
              onClick={handleFindAlbumMissingTracks}
            >
              {albumSearching ? (
                <Loader2 size={16} className="spin" />
              ) : (
                t('downloader.albumFillAction', isZh ? '补齐专辑' : 'Fill Album')
              )}
            </button>
          </div>

          {albumError ? (
            <div className="md-album-fill-error" role="alert">
              {albumError}
            </div>
          ) : null}

          {albumMissingTracks.length > 0 ? (
            <>
              <div className="md-search-heading">
                {t('downloader.albumMissingHeading', isZh ? '缺失曲目' : 'Missing Tracks')}
                <span className="md-search-via">
                  {t('downloader.albumMissingCount', {
                    defaultValue: isZh ? '{{count}} 首' : '{{count}} tracks',
                    count: albumMissingTracks.length
                  })}
                </span>
                <button
                  type="button"
                  className="md-btn-secondary md-album-fill-btn md-album-fill-btn--inline"
                  disabled={
                    albumDownloadingId !== null ||
                    albumMissingTracks.every((track) => Number(track.fee || 0) !== 0)
                  }
                  onClick={handleDownloadAllMissingTracks}
                >
                  {albumDownloadingId === -1
                    ? t('downloader.downloading', isZh ? '下载中…' : 'Downloading...')
                    : t('downloader.downloadAll', isZh ? '全部下载' : 'Download All')}
                </button>
              </div>
              <div className="md-search-list">
                {albumMissingTracks.map((track) => {
                  const isBusy = albumDownloadingId === track.id
                  const isLocked = Number(track.fee || 0) !== 0
                  return (
                    <div
                      key={track.id}
                      className={`md-search-item${isLocked ? ' md-search-item--locked' : ''}${albumDownloadingId !== null && !isBusy ? ' md-search-item--disabled' : ''}`}
                    >
                      <div className="md-search-cover-placeholder md-search-cover-placeholder--compact">
                        <Music size={18} />
                      </div>
                      <div className="md-search-info">
                        <span className="md-search-name">
                          {track.name}
                          {isLocked ? <span className="md-album-lock-badge">LOCK</span> : null}
                        </span>
                        <span className="md-search-sub">
                          {track.artist}
                          {track.duration ? ` - ${formatDuration(track.duration)}` : ''}
                        </span>
                        {isBusy && (
                          <div className="md-search-progress">
                            <div
                              className="md-search-progress-fill"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        className={`md-search-dl-btn md-search-dl-btn--visible${isBusy ? ' md-search-dl-btn--busy' : ''}`}
                        disabled={isLocked || albumDownloadingId !== null}
                        onClick={() => handleAlbumTrackDownload(track)}
                      >
                        {isBusy ? (
                          <Loader2 size={14} className="spin" />
                        ) : (
                          <>
                            <Download size={14} />
                            {t('downloader.downloadBtn', 'Download')}
                          </>
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="md-section">
        <div className="md-input-row">
          <input
            type="text"
            className="md-input"
            placeholder={t('downloader.placeholderUrl')}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && url.trim()) handleFetchMetadata()
            }}
          />
          <button
            type="button"
            className="md-btn-parse"
            onClick={handleFetchMetadata}
            disabled={!url || isLoadingMeta || isDownloading || isSearching}
          >
            {isLoadingMeta || isSearching ? (
              <Loader2 size={24} className="spin" />
            ) : (
              t('downloader.parseLink', '解析/搜索')
            )}
          </button>
        </div>
      </section>

      {status === 'searching' && (
        <section className="md-section">
          <div className="md-search-status">
            <Loader2 size={22} className="spin" />
            <span>Searching...</span>
          </div>
        </section>
      )}

      {status === 'search_ok' && searchResults.length === 0 && (
        <section className="md-section">
          <div className="md-search-status">
            {downloadProvider === 'qq'
              ? isZh
                ? 'QQ 音乐未找到相关歌曲'
                : 'No related QQ Music songs found'
              : t('downloader.neteaseSearchNoResults', 'No related songs found')}
          </div>
        </section>
      )}

      {status === 'search_ok' && searchResults.length > 0 && (
        <section className="md-section">
          <h3 className="md-search-heading">
            {t('downloader.neteaseSearchResults', 'Search Results')}
            <span className="md-search-via">{providerName}</span>
            {downloadProvider === 'netease' && use1music && (
              <span className="md-search-via">via 1music</span>
            )}
          </h3>
          <div className="md-search-list">
            {searchResults.map((s) => {
              const isBusy = downloadingSongId === s.id
              const coverSrc =
                s.cover && downloadProvider === 'netease' ? `${s.cover}?param=80y80` : s.cover
              return (
                <div
                  key={`${downloadProvider}-${s.id}-${s.mid || ''}`}
                  className={`md-search-item${isDownloading && !isBusy ? ' md-search-item--disabled' : ''}`}
                  onClick={() => {
                    if (isDownloading) return
                    handleSearchResultDownload(s)
                  }}
                >
                  {coverSrc ? (
                    <img
                      src={coverSrc}
                      alt=""
                      loading="lazy"
                      className="md-search-cover"
                    />
                  ) : (
                    <div className="md-search-cover-placeholder">
                      <Music size={20} />
                    </div>
                  )}
                  <div className="md-search-info">
                    <span className="md-search-name">{s.name}</span>
                    <span className="md-search-sub">
                      {s.artists} - {s.album}{' '}
                      {(s.alia || []).length ? `(${s.alia.join(' / ')})` : ''}
                    </span>
                    {isBusy && (
                      <div className="md-search-progress">
                        <div
                          className="md-search-progress-fill"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className={`md-search-dl-btn${isBusy ? ' md-search-dl-btn--busy' : ''}`}>
                    {isBusy ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <>
                        <Download size={14} />
                        {t('downloader.downloadBtn', 'Download')}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {metadata && (
        <section className="md-section md-meta-section">
          <div className="md-thumb">
            {metadata.thumbnail ? (
              <img src={metadata.thumbnail} alt="" />
            ) : (
              <Music size={48} className="md-thumb-placeholder" />
            )}
          </div>
          <div className="md-meta-body">
            <div className="md-badge-row">
              <span className="md-badge md-badge-pink">{t('downloader.badgeHiRes')}</span>
              <span className="md-badge md-badge-mint">{t('downloader.badgeMeta')}</span>
            </div>
            <h2 className="md-title">{metadata.title}</h2>
            <p className="md-artist">{metadata.artist || t('common.unknownArtist')}</p>
          </div>
        </section>
      )}

      {status === 'error' && (
        <div className="md-alert md-alert-error" role="alert">
          <AlertCircle size={20} />
          <span>{errorMsg}</span>
        </div>
      )}

      {status === 'success' && (
        <div className="md-alert md-alert-success" role="status">
          <CheckCircle2 size={24} />
          <span>
            {t('downloader.downloadComplete')}
            {downloadNotice ? ` ${downloadNotice}` : ''}
          </span>
        </div>
      )}

      <div className="md-footer">
        {!effectiveDownloadFolder ? (
          <div className="md-folder-card">
            <FolderHeart size={48} className="md-folder-icon" />
            <h3 className="md-folder-title">{t('downloader.noDirTitle')}</h3>
            <p className="md-folder-hint">{t('downloader.noDirHint')}</p>
            <button
              type="button"
              className="md-btn-secondary"
              onClick={async () => {
                const folders = await window.api.openDirectoryHandler()
                if (folders && folders.length > 0)
                  setConfig((p) => ({ ...p, downloadFolder: folders[0] }))
              }}
            >
              {t('downloader.setDownloadFolder')}
            </button>
          </div>
        ) : (
          <div className="md-actions">
            {isDownloading && (
              <div className="md-progress-block">
                <div className="md-progress-labels">
                  <span>{t('downloader.downloadingStream')}</span>
                  <span className="md-progress-pct">{progress.toFixed(1)}%</span>
                </div>
                <div className="md-progress-track">
                  <div className="md-progress-fill" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            <button
              type="button"
              className={
                status === 'ready' && !isDownloading
                  ? 'md-btn-download md-btn-download--ready'
                  : 'md-btn-download'
              }
              onClick={handleDownload}
              disabled={
                (status !== 'ready' && status !== 'success' && status !== 'error') || isDownloading
              }
            >
              <Download size={24} />
              {isDownloading ? t('downloader.extracting') : t('downloader.startExtraction')}
            </button>
          </div>
        )}
      </div>

      <section className="md-section md-playlist-link-wrap">
        <div className="playlist-link-panel no-drag">
          <div className="playlist-link-heading">
            <CloudDownload size={16} aria-hidden />
            <span>{t('downloader.addFromLink')}</span>
          </div>
          <p className="playlist-link-hint">
            {t('downloader.linkHintBefore')}
            <code className="playlist-link-code">{t('downloader.linkHintCode')}</code>
            {t('downloader.linkHintAfter')}
          </p>
          <div className="playlist-link-row">
            <input
              type="text"
              className="playlist-link-input"
              placeholder={t('downloader.linkPlaceholder')}
              value={linkImportUrl}
              onChange={(e) => setLinkImportUrl(e.target.value)}
              disabled={linkImporting}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLinkPlaylistImport()
              }}
            />
            <select
              className="playlist-link-select"
              value={linkImportTarget}
              onChange={(e) => setLinkImportTarget(e.target.value)}
              disabled={linkImporting}
            >
              <option value="new">{t('downloader.optNewPl')}</option>
              {userPlaylists.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {t('downloader.optMerge', { name: pl.name })}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn user-pl-btn playlist-link-submit"
              disabled={linkImporting || !linkImportUrl.trim()}
              onClick={handleLinkPlaylistImport}
            >
              {linkImporting ? t('downloader.adding') : t('downloader.add')}
            </button>
          </div>
          {linkImportStatus ? <p className="playlist-link-status">{linkImportStatus}</p> : null}
        </div>
      </section>
    </div>
  )
}
