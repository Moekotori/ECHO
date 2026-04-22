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

export default function DownloaderView({
  config,
  setConfig,
  onSuccess,
  userPlaylists = [],
  setUserPlaylists,
  setPlaylist,
  setSelectedUserPlaylistId
}) {
  const { t, i18n } = useTranslation()
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
  const [neteaseCookieInput, setNeteaseCookieInput] = useState('')
  const [neteaseCookieSaved, setNeteaseCookieSaved] = useState('')
  const [neteaseAuth, setNeteaseAuth] = useState({
    checking: true,
    valid: false,
    signedIn: false,
    isVip: false,
    error: ''
  })
  const [audioQualityPreset, setAudioQualityPreset] = useState('auto')
  const [isNeteaseSigningIn, setIsNeteaseSigningIn] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [use1music, setUse1music] = useState(() => {
    try {
      return localStorage.getItem('echoes.use1music') === '1'
    } catch {
      return false
    }
  })
  const [downloadingSongId, setDownloadingSongId] = useState(null)
  const downloaderPrefsHydratedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      try {
        const savedCookie = localStorage.getItem('echoes.neteaseCookie') || ''
        const savedQuality = localStorage.getItem('echoes.downloaderAudioQuality') || 'auto'
        if (!cancelled) {
          setNeteaseCookieSaved(savedCookie)
          setAudioQualityPreset(savedQuality)
        }
      } catch (_) {}
      try {
        const prefs = await window.api?.appStateGet?.('downloaderSettings')
        if (
          !cancelled &&
          prefs &&
          typeof prefs === 'object' &&
          (typeof prefs.neteaseCookie === 'string' || typeof prefs.audioQualityPreset === 'string')
        ) {
          if (typeof prefs.neteaseCookie === 'string') setNeteaseCookieSaved(prefs.neteaseCookie)
          if (typeof prefs.audioQualityPreset === 'string')
            setAudioQualityPreset(prefs.audioQualityPreset || 'auto')
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
      audioQualityPreset: audioQualityPreset || 'auto'
    })
  }, [neteaseCookieSaved, audioQualityPreset])

  useEffect(() => {
    try {
      localStorage.setItem('echoes.use1music', use1music ? '1' : '0')
    } catch (_) {}
  }, [use1music])

  const applyNeteaseCookie = useCallback((cookie) => {
    const next = String(cookie || '').trim()
    setNeteaseCookieSaved(next)
    try {
      if (next) localStorage.setItem('echoes.neteaseCookie', next)
      else localStorage.removeItem('echoes.neteaseCookie')
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

  useEffect(() => {
    if (!window.api?.onSignInStatusChanged) return
    const unsub = window.api.onSignInStatusChanged(() => {
      void refreshNeteaseCookieFromSession()
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [refreshNeteaseCookieFromSession])

  useEffect(() => {
    if (!downloaderPrefsHydratedRef.current) return
    void refreshNeteaseCookieFromSession(neteaseCookieSaved)
  }, [neteaseCookieSaved, refreshNeteaseCookieFromSession])

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
        neteaseCookie: usableNeteaseCookie
      })
      const newItems = (r.added || [])
        .filter(({ path }) => path && !streamedPathSet.has(path))
        .map(({ path, trackTitle, sourceUrl }) => ({
          name: path.split(/[/\\]/).pop() || trackTitle || 'track',
          path,
          type: 'local',
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
    linkImportUrl,
    linkImportTarget,
    setPlaylist,
    setUserPlaylists,
    setSelectedUserPlaylistId,
    t,
    i18n,
    ensureUsableNeteaseCookie
  ])

  useEffect(() => {
    const unsubscribe = window.api.media.onProgress((data) => {
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
      const meta = await window.api.media.getMetadata(url)
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
    setMetadata(null)
    setSearchResults([])
    try {
      const usableNeteaseCookie = await ensureUsableNeteaseCookie()
      const res = await window.api.neteaseSearch(keywords, usableNeteaseCookie)
      setSearchResults(res || [])
      setStatus('search_ok')
    } catch (err) {
      console.error(err)
      setErrorMsg(err.message || 'Search failed')
      setStatus('error')
    } finally {
      setIsSearching(false)
    }
  }

  const handleDownload = async () => {
    if (!url || !config.downloadFolder) return
    const usableNeteaseCookie = await ensureUsableNeteaseCookie()
    setIsDownloading(true)
    setStatus('downloading')
    setProgress(0)
    setErrorMsg('')

    const filesBefore = await window.api.readDirectoryHandler(config.downloadFolder).catch(() => [])

    try {
      await window.api.media.downloadAudio(url, config.downloadFolder, {
        audioQualityPreset,
        neteaseCookie: usableNeteaseCookie
      })
      setStatus('success')

      const filesAfter = await window.api
        .readDirectoryHandler(config.downloadFolder)
        .catch(() => [])
      const newFiles = filesAfter.filter((fa) => !filesBefore.find((fb) => fb.path === fa.path))

      if (newFiles.length > 0) {
        const mId = url.match(/song\?id=(\d+)/) || url.match(/song\/(\d+)/i)
        const neteaseIdMatches = !!mId && newFiles.length === 1
        let hasLyrics = false

        // Only apply matched NetEase lyrics when we know this download maps to a single file.
        if (neteaseIdMatches) {
          const filePath = newFiles[0].path
          try {
            console.log('[DownloaderView] Fetching matched lyrics for netease song id', mId[1])
            const lrcText = await window.api.media
              .fetchNeteaseLrcText({ songId: mId[1], cookie: usableNeteaseCookie })
              .catch(() => null)
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
              hasLyrics: hasLyrics && index === 0
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

  /**
   * 搜索结果点击后直接下载：
   * - use1music ON  → 通过 NCM API song_url 获取直接链接并下载（1music 模式）
   * - use1music OFF → 走 yt-dlp 流程（网易云模式，原有行为）
   */
  const handleSearchResultDownload = async (song) => {
    if (!config.downloadFolder) {
      setErrorMsg(t('downloader.noDirHint'))
      setStatus('error')
      return
    }
    setDownloadingSongId(song.id)
    setIsDownloading(true)
    setProgress(0)
    setErrorMsg('')
    setStatus('downloading')

    const sanitize = (s) =>
      String(s || '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .trim()
    const safeName =
      sanitize(song.artists ? `${song.artists} - ${song.name}` : song.name) || `nm_${song.id}`
    const usableNeteaseCookie = await ensureUsableNeteaseCookie()

    try {
      let filePath
      if (use1music) {
        // ── 1music 模式：NCM API 直接下载 ──
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
          targetFolder: config.downloadFolder,
          filename
        })
      } else {
        // ── 网易云模式：yt-dlp ──
        const neteaseUrl = `https://music.163.com/song?id=${song.id}`
        const filesBefore = await window.api
          .readDirectoryHandler(config.downloadFolder)
          .catch(() => [])
        await window.api.media.downloadAudio(neteaseUrl, config.downloadFolder, {
          audioQualityPreset,
          neteaseCookie: usableNeteaseCookie
        })
        const filesAfter = await window.api
          .readDirectoryHandler(config.downloadFolder)
          .catch(() => [])
        const newFiles = filesAfter.filter((fa) => !filesBefore.find((fb) => fb.path === fa.path))
        filePath = newFiles.length > 0 ? newFiles[0].path : null
      }

      // 自动获取歌词
      let hasLyrics = false
      if (filePath) {
        try {
          const lrcText = await window.api.media
            .fetchNeteaseLrcText({ songId: song.id, cookie: usableNeteaseCookie })
            .catch(() => null)
          if (lrcText) {
            const lrcPath = filePath.replace(/\.[^/.]+$/, '.lrc')
            await window.api.media.writeFile(lrcPath, lrcText).catch(() => null)
            hasLyrics = true
          }
        } catch (_) {}
      }

      setStatus('success')
      if (filePath && onSuccess) {
        onSuccess({
          path: filePath,
          sourceUrl: `https://music.163.com/song?id=${song.id}`,
          mvOriginUrl: `https://music.163.com/song?id=${song.id}`,
          hasLyrics
        })
      }
    } catch (err) {
      console.error('[DownloaderView] search result download error:', err)
      setErrorMsg(err.message || t('downloader.downloadFailed'))
      setStatus('error')
    } finally {
      setIsDownloading(false)
      setDownloadingSongId(null)
    }
  }

  return (
    <div className="md-root">
      <section className="md-section">
        <div className="md-input-row md-netease-login-row">
          <input
            type="text"
            className="md-input"
            placeholder={t('downloader.neteaseCookiePlaceholder')}
            value={neteaseCookieInput}
            onChange={(e) => setNeteaseCookieInput(e.target.value)}
            disabled={isDownloading}
          />
          <button
            type="button"
            className="md-btn-parse"
            disabled={!neteaseCookieInput.trim() || isDownloading}
            onClick={async () => {
              const next = neteaseCookieInput.trim()
              applyNeteaseCookie(next)
              setNeteaseCookieInput('')
              await refreshNeteaseCookieFromSession(next)
            }}
          >
            {t('downloader.neteaseLogin')}
          </button>
          <button
            type="button"
            className="md-btn-secondary md-btn-netease-oneclick"
            disabled={isDownloading || isNeteaseSigningIn}
            onClick={async () => {
              try {
                if (!window.api?.openNeteaseSignInWindow || !window.api?.getNeteaseCookie) {
                  throw new Error(t('downloader.neteaseFeatureNeedRestart'))
                }
                setIsNeteaseSigningIn(true)
                const r = await window.api.openNeteaseSignInWindow()
                if (!r?.ok) throw new Error(r?.error || 'open_failed')
                await refreshNeteaseCookieFromSession()
              } catch (e) {
                setErrorMsg(e?.message || t('downloader.neteaseOpenLoginFailed'))
                setStatus('error')
              } finally {
                setIsNeteaseSigningIn(false)
              }
            }}
          >
            {isNeteaseSigningIn ? t('downloader.neteaseOpening') : t('downloader.neteaseOneClick')}
          </button>
        </div>
        <p className="md-netease-status">
          {neteaseAuth.checking
            ? t('downloader.neteaseChecking')
            : neteaseAuth.valid
              ? neteaseAuth.isVip
                ? t('downloader.neteaseLoggedInVip')
                : t('downloader.neteaseLoggedIn')
              : neteaseCookieSaved
                ? t('downloader.neteaseCookieExpired')
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
        {neteaseCookieSaved ? (
          <div className="md-logout-row">
            <button
              type="button"
              className="md-btn-secondary"
              disabled={isDownloading}
              onClick={() => {
                applyNeteaseCookie('')
                setNeteaseAuth({
                  checking: false,
                  valid: false,
                  signedIn: false,
                  isVip: false,
                  error: ''
                })
              }}
            >
              {t('downloader.neteaseLogout')}
            </button>
          </div>
        ) : null}
      </section>

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
            <span>搜索中...</span>
          </div>
        </section>
      )}

      {status === 'search_ok' && searchResults.length === 0 && (
        <section className="md-section">
          <div className="md-search-status">
            {t('downloader.neteaseSearchNoResults', '未找到相关歌曲')}
          </div>
        </section>
      )}

      {status === 'search_ok' && searchResults.length > 0 && (
        <section className="md-section">
          <h3 className="md-search-heading">
            {t('downloader.neteaseSearchResults', '搜索结果')}
            {use1music && <span className="md-search-via">via 1music</span>}
          </h3>
          <div className="md-search-list">
            {searchResults.map((s) => {
              const isBusy = downloadingSongId === s.id
              return (
                <div
                  key={s.id}
                  className={`md-search-item${isDownloading && !isBusy ? ' md-search-item--disabled' : ''}`}
                  onClick={() => {
                    if (isDownloading) return
                    handleSearchResultDownload(s)
                  }}
                >
                  {s.cover ? (
                    <img
                      src={`${s.cover}?param=80y80`}
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
                      {s.artists} · {s.album}{' '}
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
                        {t('downloader.downloadBtn', '下载')}
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
          <span>{t('downloader.downloadComplete')}</span>
        </div>
      )}

      <div className="md-footer">
        {!config.downloadFolder ? (
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
