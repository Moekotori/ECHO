import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Radio,
  Users,
  Link2,
  Upload,
  RefreshCw,
  X,
  Copy,
  Shield,
  Crown,
  UserRound,
  Lock,
  Server,
  SlidersHorizontal,
  Music2
} from 'lucide-react'
import { ListenTogetherClient } from '../utils/listenTogetherClient'
import {
  initMediaUpload,
  uploadMediaChunk,
  finishMediaUpload,
  appendTokenToStreamUrl
} from '../utils/listenTogetherMedia'

const CHUNK_SIZE = 1024 * 1024 * 2 // 2MB
const PLAYER_UPDATE_THROTTLE_MS = 1500

function isHttpUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim())
}

function encodeJoinKey(payload) {
  try {
    const json = JSON.stringify(payload)
    return `LT1:${btoa(unescape(encodeURIComponent(json)))}`
  } catch {
    return ''
  }
}

function decodeJoinKey(raw) {
  const value = (raw || '').trim()
  if (!value) return null
  const token = value.startsWith('LT1:') ? value.slice(4) : value
  const json = decodeURIComponent(escape(atob(token)))
  const out = JSON.parse(json)
  if (!out || typeof out !== 'object') return null
  return {
    serverBaseUrl: String(out.serverBaseUrl || '').trim(),
    roomId: String(out.roomId || '')
      .trim()
      .toUpperCase(),
    accessToken: String(out.accessToken || '').trim(),
    roomAccessKey: String(out.roomAccessKey || '')
      .trim()
      .toUpperCase()
  }
}

export default function ListenTogetherDrawer({
  open,
  onClose,
  t,
  currentTrack,
  nextTrack,
  isPlaying,
  currentTime,
  duration,
  syncContent,
  onRemotePlayState,
  onHostUploadStart,
  onHostPlayAfterBuffer,
  onHostUploadEnd
}) {
  const [serverBaseUrl, setServerBaseUrl] = useState('http://127.0.0.1:8787')
  const [accessToken, setAccessToken] = useState('')
  const [displayName, setDisplayName] = useState('Guest')
  const [roomIdInput, setRoomIdInput] = useState('')
  const [audioUrlInput, setAudioUrlInput] = useState('')
  const [joinKeyInput, setJoinKeyInput] = useState('')
  const [lockJoinKey, setLockJoinKey] = useState(false)
  const [roomAccessKey, setRoomAccessKey] = useState('')
  const [syncOffsetMs, setSyncOffsetMs] = useState(0)
  const [autoResyncEnabled, setAutoResyncEnabled] = useState(true)
  const [autoResyncIntervalSec, setAutoResyncIntervalSec] = useState(15)
  const [forceSeekThresholdSec, setForceSeekThresholdSec] = useState(2)
  const [uploadQualityMode, setUploadQualityMode] = useState('original')
  const [syncCoverEnabled, setSyncCoverEnabled] = useState(true)
  const [syncLyricsEnabled, setSyncLyricsEnabled] = useState(true)
  const [syncMvEnabled, setSyncMvEnabled] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [connectionState, setConnectionState] = useState('disconnected')
  const [roomState, setRoomState] = useState(null)
  const [memberId, setMemberId] = useState('')
  const [localFileBusy, setLocalFileBusy] = useState(false)
  const [activated, setActivated] = useState(false)
  const clientRef = useRef(null)
  const lastAutoPublishedTrackRef = useRef('')
  const memberIdRef = useRef('')
  const lastJoinedRoomIdRef = useRef('')
  const prevTrackIdRef = useRef('')
  const prevPlayingRef = useRef(false)
  const prevPositionRef = useRef(0)
  const lastUpdateAtRef = useRef(0)
  const hydratedRef = useRef(false)
  const ltSettingsHydratedRef = useRef(false)
  const activePublishTokenRef = useRef(0)
  const preUploadTaskRef = useRef({ path: '', promise: null, mediaId: '', streamUrl: '' })

  const inRoom = !!roomState?.roomId
  const isHost = inRoom && roomState?.hostId === memberId

  useEffect(() => {
    if (!isHost || !inRoom || !nextTrack?.path) return
    if (!window.api?.readBufferHandler || isHttpUrl(nextTrack.path)) return
    if (!duration || duration <= 0) return

    // Trigger if remaining time <= 15s
    if (duration - currentTime <= 15) {
      if (preUploadTaskRef.current.path === nextTrack.path) return

      const runPreUpload = async () => {
        try {
          const path = nextTrack.path
          preUploadTaskRef.current = { path, promise: null, mediaId: '', streamUrl: '' }

          const init = await initMediaUpload(serverBaseUrl, accessToken, {
            roomId: roomState.roomId,
            title: nextTrack?.info?.title || nextTrack?.name || 'track',
            qualityMode: uploadQualityMode
          })
          if (!init?.ok || !init.mediaId) return

          const buf = await window.api.readBufferHandler(path)
          const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
          for (let i = 0; i < u8.length; i += CHUNK_SIZE) {
            const chunk = u8.slice(i, Math.min(i + CHUNK_SIZE, u8.length))
            const out = await uploadMediaChunk(serverBaseUrl, accessToken, init.mediaId, chunk)
            if (!out?.ok) return
          }
          const finish = await finishMediaUpload(serverBaseUrl, accessToken, init.mediaId)
          if (finish?.ok && finish.streamUrl) {
            if (preUploadTaskRef.current.path === path) {
              preUploadTaskRef.current.mediaId = init.mediaId
              preUploadTaskRef.current.streamUrl = finish.streamUrl
            }
          }
        } catch (e) {
          // ignore pre-upload errors
        }
      }

      preUploadTaskRef.current.promise = runPreUpload()
    }
  }, [
    isHost,
    inRoom,
    nextTrack?.path,
    duration,
    currentTime,
    serverBaseUrl,
    accessToken,
    roomState?.roomId,
    uploadQualityMode
  ])

  useEffect(() => {
    memberIdRef.current = memberId
  }, [memberId])

  useEffect(() => {
    if (open) setActivated(true)
  }, [open])

  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      const savedBase = localStorage.getItem('lt_server_base_url')
      const savedToken = localStorage.getItem('lt_access_token')
      const savedName = localStorage.getItem('lt_display_name')
      const savedRoom = localStorage.getItem('lt_last_room_id')
      const savedOffset = Number(localStorage.getItem('lt_sync_offset_ms') || 0)
      const savedAutoResyncEnabled = localStorage.getItem('lt_auto_resync_enabled')
      const savedAutoResyncInterval = Number(
        localStorage.getItem('lt_auto_resync_interval_sec') || 15
      )
      const savedForceSeekThreshold = Number(
        localStorage.getItem('lt_force_seek_threshold_sec') || 2
      )
      const savedUploadQualityMode = localStorage.getItem('lt_upload_quality_mode')
      const savedSyncCoverEnabled = localStorage.getItem('lt_sync_cover_enabled')
      const savedSyncLyricsEnabled = localStorage.getItem('lt_sync_lyrics_enabled')
      const savedSyncMvEnabled = localStorage.getItem('lt_sync_mv_enabled')
      if (savedBase) setServerBaseUrl(savedBase)
      if (savedToken) setAccessToken(savedToken)
      if (savedName) setDisplayName(savedName)
      if (savedRoom) {
        lastJoinedRoomIdRef.current = savedRoom
        setRoomIdInput(savedRoom)
      }
      if (Number.isFinite(savedOffset))
        setSyncOffsetMs(Math.max(-3000, Math.min(3000, savedOffset)))
      if (savedAutoResyncEnabled != null) setAutoResyncEnabled(savedAutoResyncEnabled !== '0')
      if (Number.isFinite(savedAutoResyncInterval))
        setAutoResyncIntervalSec(Math.max(5, Math.min(120, savedAutoResyncInterval)))
      if (Number.isFinite(savedForceSeekThreshold))
        setForceSeekThresholdSec(Math.max(0.5, Math.min(8, savedForceSeekThreshold)))
      if (savedUploadQualityMode === 'compressed') setUploadQualityMode('compressed')
      if (savedSyncCoverEnabled != null) setSyncCoverEnabled(savedSyncCoverEnabled !== '0')
      if (savedSyncLyricsEnabled != null) setSyncLyricsEnabled(savedSyncLyricsEnabled !== '0')
      if (savedSyncMvEnabled != null) setSyncMvEnabled(savedSyncMvEnabled === '1')
      try {
        const persisted = await window.api?.appStateGet?.('ltSettings')
        if (!cancelled && persisted && typeof persisted === 'object') {
          if (typeof persisted.serverBaseUrl === 'string') setServerBaseUrl(persisted.serverBaseUrl)
          if (typeof persisted.accessToken === 'string') setAccessToken(persisted.accessToken)
          if (typeof persisted.displayName === 'string') setDisplayName(persisted.displayName)
          if (typeof persisted.lastRoomId === 'string' && persisted.lastRoomId) {
            lastJoinedRoomIdRef.current = persisted.lastRoomId
            setRoomIdInput(persisted.lastRoomId)
          }
          if (Number.isFinite(Number(persisted.syncOffsetMs)))
            setSyncOffsetMs(Math.max(-3000, Math.min(3000, Number(persisted.syncOffsetMs))))
          if (typeof persisted.autoResyncEnabled === 'boolean')
            setAutoResyncEnabled(persisted.autoResyncEnabled)
          if (Number.isFinite(Number(persisted.autoResyncIntervalSec)))
            setAutoResyncIntervalSec(
              Math.max(5, Math.min(120, Number(persisted.autoResyncIntervalSec)))
            )
          if (Number.isFinite(Number(persisted.forceSeekThresholdSec)))
            setForceSeekThresholdSec(
              Math.max(0.5, Math.min(8, Number(persisted.forceSeekThresholdSec)))
            )
          if (persisted.uploadQualityMode === 'compressed') setUploadQualityMode('compressed')
          if (typeof persisted.syncCoverEnabled === 'boolean')
            setSyncCoverEnabled(persisted.syncCoverEnabled)
          if (typeof persisted.syncLyricsEnabled === 'boolean')
            setSyncLyricsEnabled(persisted.syncLyricsEnabled)
          if (typeof persisted.syncMvEnabled === 'boolean')
            setSyncMvEnabled(persisted.syncMvEnabled)
        }
      } catch {}
      if (!cancelled) {
        hydratedRef.current = true
        ltSettingsHydratedRef.current = true
      }
    }
    hydrate()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem('lt_server_base_url', serverBaseUrl || '')
  }, [serverBaseUrl])
  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem('lt_access_token', accessToken || '')
  }, [accessToken])
  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem('lt_display_name', displayName || '')
  }, [displayName])
  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem('lt_sync_offset_ms', String(syncOffsetMs || 0))
  }, [syncOffsetMs])
  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem('lt_auto_resync_enabled', autoResyncEnabled ? '1' : '0')
  }, [autoResyncEnabled])
  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem('lt_auto_resync_interval_sec', String(autoResyncIntervalSec || 15))
  }, [autoResyncIntervalSec])
  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem('lt_force_seek_threshold_sec', String(forceSeekThresholdSec || 2))
  }, [forceSeekThresholdSec])
  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem('lt_upload_quality_mode', uploadQualityMode || 'original')
  }, [uploadQualityMode])
  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem('lt_sync_cover_enabled', syncCoverEnabled ? '1' : '0')
  }, [syncCoverEnabled])
  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem('lt_sync_lyrics_enabled', syncLyricsEnabled ? '1' : '0')
  }, [syncLyricsEnabled])
  useEffect(() => {
    if (!hydratedRef.current) return
    localStorage.setItem('lt_sync_mv_enabled', syncMvEnabled ? '1' : '0')
  }, [syncMvEnabled])

  useEffect(() => {
    if (!ltSettingsHydratedRef.current || !window.api?.appStateSet) return
    void window.api.appStateSet('ltSettings', {
      serverBaseUrl: serverBaseUrl || '',
      accessToken: accessToken || '',
      displayName: displayName || '',
      lastRoomId: (lastJoinedRoomIdRef.current || roomIdInput || '').trim().toUpperCase(),
      syncOffsetMs: Number(syncOffsetMs || 0),
      autoResyncEnabled: !!autoResyncEnabled,
      autoResyncIntervalSec: Number(autoResyncIntervalSec || 15),
      forceSeekThresholdSec: Number(forceSeekThresholdSec || 2),
      uploadQualityMode: uploadQualityMode || 'original',
      syncCoverEnabled: !!syncCoverEnabled,
      syncLyricsEnabled: !!syncLyricsEnabled,
      syncMvEnabled: !!syncMvEnabled
    })
  }, [
    serverBaseUrl,
    accessToken,
    displayName,
    roomIdInput,
    syncOffsetMs,
    autoResyncEnabled,
    autoResyncIntervalSec,
    forceSeekThresholdSec,
    uploadQualityMode,
    syncCoverEnabled,
    syncLyricsEnabled,
    syncMvEnabled
  ])

  const playbackSnapshot = useMemo(
    () => ({
      trackId: currentTrack?.path || '',
      title: currentTrack?.info?.title || currentTrack?.name || '',
      artist: currentTrack?.info?.artist || '',
      isPlaying: !!isPlaying,
      positionSec: Number(currentTime || 0)
    }),
    [currentTrack, isPlaying, currentTime]
  )

  const currentTrackMeta = useMemo(
    () => ({
      trackId: (currentTrack?.path || '').trim(),
      title: currentTrack?.info?.title || currentTrack?.name || '',
      artist: currentTrack?.info?.artist || ''
    }),
    [currentTrack]
  )

  const sharedSyncPayload = useMemo(() => {
    const payload = {
      syncCover: !!syncCoverEnabled,
      syncLyrics: !!syncLyricsEnabled,
      syncMv: !!syncMvEnabled
    }
    payload.coverUrl = syncCoverEnabled ? syncContent?.coverUrl || '' : ''
    payload.mvSync =
      syncMvEnabled && syncContent?.mvId?.id
        ? { id: syncContent.mvId.id, source: syncContent.mvId.source || 'youtube' }
        : null
    payload.syncedLyrics =
      syncLyricsEnabled && Array.isArray(syncContent?.lyrics)
        ? syncContent.lyrics.slice(0, 400)
        : []
    return payload
  }, [syncCoverEnabled, syncLyricsEnabled, syncMvEnabled, syncContent])

  useEffect(() => {
    if (!activated) return
    const c = new ListenTogetherClient({
      serverBaseUrl,
      onOpen: () => {
        setConnectionState('connected')
        const cachedRoomId = (lastJoinedRoomIdRef.current || '').trim().toUpperCase()
        if (cachedRoomId) {
          c.send('room:join', {
            roomId: cachedRoomId,
            name: displayName || 'Member'
          })
        }
      },
      onClose: () => setConnectionState('disconnected'),
      onMessage: (msg) => {
        if (msg.type === 'hello') {
          setMemberId(msg.payload.memberId || '')
          return
        }
        if (msg.type === 'room:state' || msg.type === 'room:presence') {
          setRoomState(msg.payload || null)
          if (msg.payload?.roomId) {
            lastJoinedRoomIdRef.current = msg.payload.roomId
            localStorage.setItem('lt_last_room_id', msg.payload.roomId)
          }
          if (typeof onRemotePlayState === 'function') {
            onRemotePlayState({
              roomState: msg.payload || null,
              memberId: memberIdRef.current,
              syncOffsetMs,
              forceSeekThresholdSec
            })
          }
          return
        }
        if (msg.type === 'error') {
          const code = msg.payload?.error || 'unknown'
          if (code === 'room_locked') setStatusText(t('listenTogether.roomLocked'))
          else setStatusText(`Error: ${code}`)
        }
      }
    })
    clientRef.current = c
    setConnectionState('connecting')
    try {
      c.connect()
    } catch (e) {
      setConnectionState('disconnected')
      setStatusText(e?.message || String(e))
    }
    return () => {
      c.disconnect()
      clientRef.current = null
    }
  }, [
    activated,
    serverBaseUrl,
    displayName,
    onRemotePlayState,
    syncOffsetMs,
    forceSeekThresholdSec
  ])

  useEffect(() => {
    if (!inRoom || isHost || !autoResyncEnabled) return
    const iv = setInterval(
      () => {
        if (!roomState || typeof onRemotePlayState !== 'function') return
        onRemotePlayState({
          roomState,
          memberId: memberIdRef.current,
          force: true,
          syncOffsetMs,
          forceSeekThresholdSec
        })
      },
      Math.max(5, autoResyncIntervalSec || 15) * 1000
    )
    return () => clearInterval(iv)
  }, [
    inRoom,
    isHost,
    autoResyncEnabled,
    autoResyncIntervalSec,
    roomState,
    onRemotePlayState,
    syncOffsetMs,
    forceSeekThresholdSec
  ])

  useEffect(() => {
    if (!isHost || !inRoom) return
    const now = Date.now()
    const trackChanged = prevTrackIdRef.current !== playbackSnapshot.trackId
    const playingChanged = prevPlayingRef.current !== playbackSnapshot.isPlaying
    const jumped =
      Math.abs((prevPositionRef.current || 0) - (playbackSnapshot.positionSec || 0)) > 3
    const due = now - lastUpdateAtRef.current >= PLAYER_UPDATE_THROTTLE_MS

    if (trackChanged) {
      clientRef.current?.send('player:event', {
        eventType: 'track-change',
        ...playbackSnapshot,
        ...sharedSyncPayload
      })
    } else if (playingChanged) {
      clientRef.current?.send('player:event', {
        eventType: playbackSnapshot.isPlaying ? 'play' : 'pause',
        ...playbackSnapshot,
        ...sharedSyncPayload
      })
    } else if (jumped) {
      clientRef.current?.send('player:event', {
        eventType: 'seek',
        ...playbackSnapshot,
        ...sharedSyncPayload
      })
    } else if (due) {
      clientRef.current?.send('player:update', {
        ...playbackSnapshot,
        ...sharedSyncPayload
      })
      lastUpdateAtRef.current = now
    }

    prevTrackIdRef.current = playbackSnapshot.trackId
    prevPlayingRef.current = playbackSnapshot.isPlaying
    prevPositionRef.current = playbackSnapshot.positionSec
  }, [isHost, inRoom, playbackSnapshot, sharedSyncPayload])

  const createRoom = () => {
    const generatedRoomAccessKey = Math.random().toString(36).slice(2, 10).toUpperCase()
    setRoomAccessKey(generatedRoomAccessKey)
    clientRef.current?.send('room:create', {
      name: displayName || 'Host',
      playback: playbackSnapshot,
      lockJoinKey,
      roomAccessKey: generatedRoomAccessKey
    })
  }

  const joinRoom = () => {
    const roomId = (roomIdInput || '').trim().toUpperCase()
    if (!roomId) return
    lastJoinedRoomIdRef.current = roomId
    localStorage.setItem('lt_last_room_id', roomId)
    clientRef.current?.send('room:join', {
      roomId,
      name: displayName || 'Member',
      roomAccessKey: roomAccessKey || ''
    })
  }

  const leaveRoom = () => {
    clientRef.current?.send('room:leave', {})
    setRoomState(null)
    setStatusText('')
  }

  const copyInvite = async () => {
    if (!roomState?.roomId) return
    const text = `${t('listenTogether.inviteText')}\n${serverBaseUrl}\n${t('listenTogether.roomCode')}: ${roomState.roomId}`
    try {
      if (window.api?.writeClipboardText) {
        await window.api.writeClipboardText(text)
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      }
      setStatusText(t('listenTogether.copied'))
    } catch (e) {
      setStatusText(e?.message || String(e))
    }
  }

  const copyJoinKey = async () => {
    if (!roomState?.roomId) return
    const key = encodeJoinKey({
      serverBaseUrl,
      roomId: roomState.roomId,
      accessToken,
      roomAccessKey
    })
    if (!key) return
    try {
      if (window.api?.writeClipboardText) {
        await window.api.writeClipboardText(key)
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(key)
      }
      setStatusText(t('listenTogether.keyCopied'))
    } catch (e) {
      setStatusText(e?.message || String(e))
    }
  }

  const applyJoinKey = (autoJoin = true) => {
    try {
      const parsed = decodeJoinKey(joinKeyInput)
      if (!parsed?.serverBaseUrl || !parsed?.roomId) {
        setStatusText(t('listenTogether.invalidJoinKey'))
        return
      }
      setServerBaseUrl(parsed.serverBaseUrl)
      setRoomIdInput(parsed.roomId)
      if (parsed.accessToken) setAccessToken(parsed.accessToken)
      if (parsed.roomAccessKey) setRoomAccessKey(parsed.roomAccessKey)
      setStatusText(t('listenTogether.keyApplied'))
      if (autoJoin) {
        lastJoinedRoomIdRef.current = parsed.roomId
        localStorage.setItem('lt_last_room_id', parsed.roomId)
        clientRef.current?.send('room:join', {
          roomId: parsed.roomId,
          name: displayName || 'Member',
          roomAccessKey: parsed.roomAccessKey || ''
        })
      }
    } catch {
      setStatusText(t('listenTogether.invalidJoinKey'))
    }
  }

  const forceResync = () => {
    if (!roomState) return
    if (typeof onRemotePlayState === 'function') {
      onRemotePlayState({
        roomState,
        memberId: memberIdRef.current,
        force: true,
        syncOffsetMs,
        forceSeekThresholdSec
      })
      setStatusText(t('listenTogether.resynced'))
    }
  }

  const publishUrl = () => {
    if (!isHost) return
    const raw = (audioUrlInput || '').trim()
    if (!/^https?:\/\//i.test(raw)) {
      setStatusText('audio url invalid')
      return
    }
    clientRef.current?.send('media:publish', {
      sourceType: 'url',
      streamUrl: appendTokenToStreamUrl(raw, accessToken),
      ...playbackSnapshot,
      ...currentTrackMeta,
      ...sharedSyncPayload
    })
    setStatusText('URL published')
  }

  const publishLocalTrackByPath = async (fullPath, displayName, meta = {}, publishToken = 0) => {
    const ensureNotStale = () => {
      if (publishToken && activePublishTokenRef.current !== publishToken) {
        throw new Error('publish_superseded')
      }
    }
    ensureNotStale()

    if (typeof onHostUploadStart === 'function') onHostUploadStart()
    setStatusText('正在同步音频到房间...')

    const init = await initMediaUpload(serverBaseUrl, accessToken, {
      roomId: roomState.roomId,
      title: displayName || 'track',
      qualityMode: uploadQualityMode
    })
    ensureNotStale()
    if (!init?.ok || !init.mediaId) throw new Error(init?.error || 'upload_init_failed')
    const buf = await window.api.readBufferHandler(fullPath)
    ensureNotStale()
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    for (let i = 0; i < u8.length; i += CHUNK_SIZE) {
      ensureNotStale()
      const chunk = u8.slice(i, Math.min(i + CHUNK_SIZE, u8.length))
      const out = await uploadMediaChunk(serverBaseUrl, accessToken, init.mediaId, chunk)
      if (!out?.ok) throw new Error(out?.error || 'chunk_upload_failed')
    }
    ensureNotStale()
    const finish = await finishMediaUpload(serverBaseUrl, accessToken, init.mediaId)
    if (!finish?.ok || !finish.streamUrl) throw new Error(finish?.error || 'upload_finish_failed')
    ensureNotStale()
    clientRef.current?.send('media:publish', {
      sourceType: 'local',
      mediaId: init.mediaId,
      streamUrl: appendTokenToStreamUrl(finish.streamUrl, accessToken),
      ...playbackSnapshot,
      isPlaying: false,
      positionSec: 0,
      trackId: meta.trackId || fullPath,
      title: meta.title || displayName || 'track',
      artist: meta.artist || '',
      ...sharedSyncPayload
    })

    setStatusText('音频已同步，缓冲等待中...')

    setTimeout(() => {
      if (publishToken && activePublishTokenRef.current === publishToken) {
        if (typeof onHostPlayAfterBuffer === 'function') onHostPlayAfterBuffer()

        clientRef.current?.send('player:event', {
          eventType: 'play',
          ...playbackSnapshot,
          isPlaying: true,
          positionSec: 0,
          trackId: meta.trackId || fullPath,
          title: meta.title || displayName || 'track',
          artist: meta.artist || '',
          ...sharedSyncPayload
        })

        setStatusText('发布成功，同步播放')
      }
    }, 2500)
  }

  const publishLocalFile = async () => {
    if (!isHost || localFileBusy) return
    if (!window.api?.openFileHandler || !window.api?.readBufferHandler) return
    setLocalFileBusy(true)
    const publishToken = Date.now()
    activePublishTokenRef.current = publishToken
    try {
      const picked = await window.api.openFileHandler('en')
      const first = Array.isArray(picked) ? picked[0] : null
      if (!first?.path) return
      await publishLocalTrackByPath(
        first.path,
        first.name,
        {
          trackId: first.path,
          title: first.name || 'track',
          artist: ''
        },
        publishToken
      )
    } catch (e) {
      if (typeof onHostUploadEnd === 'function') onHostUploadEnd()
      if (String(e?.message || '').includes('publish_superseded')) {
        setStatusText('Upload superseded by newer track')
      } else {
        setStatusText(e?.message || String(e))
      }
    } finally {
      setLocalFileBusy(false)
    }
  }

  useEffect(() => {
    if (!isHost || !inRoom || localFileBusy) return
    const path = (currentTrack?.path || '').trim()
    if (!path) return
    const trackKey = `${roomState.roomId}::${path}`
    if (lastAutoPublishedTrackRef.current === trackKey) return

    let cancelled = false
    const publishToken = Date.now()
    activePublishTokenRef.current = publishToken
    const run = async () => {
      try {
        if (isHttpUrl(path)) {
          if (activePublishTokenRef.current !== publishToken) return
          clientRef.current?.send('media:publish', {
            sourceType: 'url',
            streamUrl: appendTokenToStreamUrl(path, accessToken),
            ...playbackSnapshot,
            trackId: path,
            title: currentTrackMeta.title,
            artist: currentTrackMeta.artist,
            ...sharedSyncPayload
          })
          if (!cancelled) setStatusText('Auto-published host URL track')
        } else if (window.api?.readBufferHandler) {
          if (preUploadTaskRef.current.path === path && preUploadTaskRef.current.promise) {
            // Wait for pre-upload to finish if it's currently running
            await preUploadTaskRef.current.promise
          }

          if (preUploadTaskRef.current.path === path && preUploadTaskRef.current.streamUrl) {
            // Instant publish using pre-uploaded media
            clientRef.current?.send('media:publish', {
              sourceType: 'local',
              mediaId: preUploadTaskRef.current.mediaId,
              streamUrl: appendTokenToStreamUrl(preUploadTaskRef.current.streamUrl, accessToken),
              ...playbackSnapshot,
              isPlaying: false,
              positionSec: 0,
              trackId: path,
              title: currentTrackMeta.title || currentTrack?.name || 'track',
              artist: currentTrackMeta.artist,
              ...sharedSyncPayload
            })

            setStatusText('音频已预加载，缓冲等待中...')
            if (typeof onHostUploadStart === 'function') onHostUploadStart()

            setTimeout(() => {
              if (activePublishTokenRef.current === publishToken) {
                if (typeof onHostPlayAfterBuffer === 'function') onHostPlayAfterBuffer()

                clientRef.current?.send('player:event', {
                  eventType: 'play',
                  ...playbackSnapshot,
                  isPlaying: true,
                  positionSec: 0,
                  trackId: path,
                  title: currentTrackMeta.title || currentTrack?.name || 'track',
                  artist: currentTrackMeta.artist,
                  ...sharedSyncPayload
                })

                setStatusText('预加载发布成功，同步播放')
              }
            }, 2500)
          } else {
            setLocalFileBusy(true)
            await publishLocalTrackByPath(
              path,
              currentTrack?.name || 'track',
              {
                trackId: path,
                title: currentTrackMeta.title || currentTrack?.name || 'track',
                artist: currentTrackMeta.artist
              },
              publishToken
            )
          }
        }
        lastAutoPublishedTrackRef.current = trackKey
      } catch (e) {
        if (typeof onHostUploadEnd === 'function') onHostUploadEnd()
        const msg = e?.message || String(e)
        if (msg.includes('publish_superseded')) {
          if (!cancelled) setStatusText('Skipped outdated publish task')
        } else if (!cancelled) {
          setStatusText(`Auto publish failed: ${msg}`)
        }
      } finally {
        // Must always clear busy flag; otherwise rapid track switches can leave it stuck true
        // and block all subsequent auto-publish operations.
        setLocalFileBusy(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [
    isHost,
    inRoom,
    roomState?.roomId,
    currentTrack?.path,
    currentTrack?.name,
    currentTrackMeta.title,
    currentTrackMeta.artist,
    accessToken,
    playbackSnapshot,
    sharedSyncPayload,
    serverBaseUrl,
    localFileBusy
  ])

  return (
    <>
      <div
        className={`lyrics-drawer-backdrop ${open ? 'lyrics-drawer-backdrop--open' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`lyrics-drawer-panel ${open ? 'lyrics-drawer-panel--open' : ''}`}
        role="dialog"
        aria-label={t('drawer.listenTogetherAria')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lyrics-drawer-header">
          <h2 className="lyrics-drawer-title">{t('drawer.listenTogetherTitle')}</h2>
          <button
            type="button"
            className="lyrics-drawer-close"
            onClick={onClose}
            aria-label={t('aria.close')}
          >
            <X size={20} />
          </button>
        </div>
        <div className="lyrics-drawer-body">
          {inRoom ? (
            <div className="lt-status-badges">
              <span className={`lt-badge ${isHost ? 'is-host' : 'is-member'}`}>
                {isHost ? <Crown size={12} /> : <UserRound size={12} />}
                {isHost ? 'Host' : 'Member'}
              </span>
              {roomState?.lockJoinKey ? (
                <span className="lt-badge is-lock">
                  <Lock size={12} />
                  Locked
                </span>
              ) : null}
            </div>
          ) : null}
          <section className="lyrics-drawer-section listen-together-section">
            <h3 className="lyrics-drawer-section-title">
              <Server size={14} /> {t('listenTogether.connection')}
            </h3>
            <input
              className="lyrics-drawer-url-input"
              value={serverBaseUrl}
              onChange={(e) => setServerBaseUrl(e.target.value)}
            />
            <input
              className="lyrics-drawer-url-input"
              placeholder={t('listenTogether.tokenOptional')}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
            />
            <input
              className="lyrics-drawer-url-input"
              placeholder={t('listenTogether.name')}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <label className="lt-switch-row">
              <span>{t('listenTogether.lockByKey')}</span>
              <input
                type="checkbox"
                className="lt-switch-input"
                checked={lockJoinKey}
                onChange={(e) => setLockJoinKey(e.target.checked)}
              />
              <span className="lt-switch-slider" />
            </label>
            <p className="lyrics-drawer-hint">
              {t('listenTogether.connectionState')}: {connectionState}
            </p>
          </section>
          <section className="lyrics-drawer-section listen-together-section">
            <h3 className="lyrics-drawer-section-title">
              <Users size={14} /> {t('listenTogether.room')}
            </h3>
            <div className="lyrics-drawer-offset-controls">
              <button
                type="button"
                className="lyrics-drawer-primary-btn lt-btn-primary"
                onClick={createRoom}
              >
                <Radio size={16} /> {t('listenTogether.createRoom')}
              </button>
              <button
                type="button"
                className="lyrics-drawer-primary-btn lt-btn-soft"
                onClick={joinRoom}
              >
                <Users size={16} /> {t('listenTogether.joinRoom')}
              </button>
            </div>
            <input
              className="lyrics-drawer-url-input"
              placeholder={t('listenTogether.roomCode')}
              value={roomIdInput}
              onChange={(e) => setRoomIdInput(e.target.value)}
            />
            <input
              className="lyrics-drawer-url-input"
              placeholder={t('listenTogether.joinKey')}
              value={joinKeyInput}
              onChange={(e) => setJoinKeyInput(e.target.value)}
            />
            <input
              className="lyrics-drawer-url-input"
              placeholder={t('listenTogether.roomAccessKey')}
              value={roomAccessKey}
              onChange={(e) => setRoomAccessKey(e.target.value.trim().toUpperCase())}
            />
            <div className="lyrics-drawer-offset-controls">
              <button
                type="button"
                className="lyrics-drawer-primary-btn lt-btn-primary"
                onClick={() => applyJoinKey(true)}
              >
                <Link2 size={16} /> {t('listenTogether.useJoinKey')}
              </button>
            </div>
            {inRoom ? (
              <p className="lyrics-drawer-hint">
                Room: {roomState.roomId} · {isHost ? 'Host' : 'Member'} ·{' '}
                {roomState.members?.length || 0} online
              </p>
            ) : null}
            {inRoom ? (
              <div className="lyrics-drawer-offset-controls">
                <button type="button" className="lyrics-drawer-primary-btn" onClick={copyInvite}>
                  <Copy size={16} /> {t('listenTogether.copyInvite')}
                </button>
                <button
                  type="button"
                  className="lyrics-drawer-primary-btn lt-btn-soft"
                  onClick={copyJoinKey}
                >
                  <Copy size={16} /> {t('listenTogether.copyJoinKey')}
                </button>
                <button
                  type="button"
                  className="lyrics-drawer-primary-btn lt-btn-danger"
                  onClick={leaveRoom}
                >
                  <X size={16} /> {t('listenTogether.leaveRoom')}
                </button>
              </div>
            ) : null}
          </section>
          {inRoom && !isHost ? (
            <section className="lyrics-drawer-section listen-together-section">
              <h3 className="lyrics-drawer-section-title">
                <SlidersHorizontal size={14} /> {t('listenTogether.followMode')}
              </h3>
              <p className="lyrics-drawer-hint">
                <Shield size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                {t('listenTogether.memberReadonlyHint')}
              </p>
              <button
                type="button"
                className="lyrics-drawer-primary-btn lt-btn-primary"
                onClick={forceResync}
              >
                <RefreshCw size={16} /> {t('listenTogether.resyncNow')}
              </button>
              <div className="lyrics-drawer-offset-controls listen-together-compact-controls">
                <button
                  type="button"
                  className="lyrics-drawer-primary-btn"
                  onClick={() => setSyncOffsetMs((v) => Math.max(-3000, v - 200))}
                >
                  -200ms
                </button>
                <button
                  type="button"
                  className="lyrics-drawer-primary-btn"
                  onClick={() => setSyncOffsetMs((v) => Math.min(3000, v + 200))}
                >
                  +200ms
                </button>
              </div>
              <p className="lyrics-drawer-hint">
                {t('listenTogether.syncOffset')}: {syncOffsetMs}ms
              </p>
              <label className="lt-switch-row">
                <span>{t('listenTogether.autoResync')}</span>
                <input
                  type="checkbox"
                  className="lt-switch-input"
                  checked={autoResyncEnabled}
                  onChange={(e) => setAutoResyncEnabled(e.target.checked)}
                />
                <span className="lt-switch-slider" />
              </label>
              <p className="lyrics-drawer-hint">
                {t('listenTogether.autoResyncEvery')}: {autoResyncIntervalSec}s ·
                {t('listenTogether.forceSeekThreshold')}: {forceSeekThresholdSec}s
              </p>
              <div className="lyrics-drawer-offset-controls listen-together-compact-controls">
                <button
                  type="button"
                  className="lyrics-drawer-primary-btn"
                  onClick={() => setAutoResyncIntervalSec((v) => Math.max(5, v - 5))}
                >
                  -5s
                </button>
                <button
                  type="button"
                  className="lyrics-drawer-primary-btn"
                  onClick={() => setAutoResyncIntervalSec((v) => Math.min(120, v + 5))}
                >
                  +5s
                </button>
                <button
                  type="button"
                  className="lyrics-drawer-primary-btn"
                  onClick={() =>
                    setForceSeekThresholdSec((v) => Math.max(0.5, Number((v - 0.5).toFixed(1))))
                  }
                >
                  阈值-0.5s
                </button>
                <button
                  type="button"
                  className="lyrics-drawer-primary-btn"
                  onClick={() =>
                    setForceSeekThresholdSec((v) => Math.min(8, Number((v + 0.5).toFixed(1))))
                  }
                >
                  阈值+0.5s
                </button>
              </div>
            </section>
          ) : null}
          {isHost ? (
            <section className="lyrics-drawer-section listen-together-section">
              <h3 className="lyrics-drawer-section-title">
                <Music2 size={14} /> {t('listenTogether.shareAudio')}
              </h3>
              <input
                className="lyrics-drawer-url-input"
                placeholder={t('listenTogether.audioUrl')}
                value={audioUrlInput}
                onChange={(e) => setAudioUrlInput(e.target.value)}
              />
              <select
                className="lyrics-drawer-url-input"
                value={uploadQualityMode}
                onChange={(e) => setUploadQualityMode(e.target.value)}
              >
                <option value="original">{t('listenTogether.qualityOriginal')}</option>
                <option value="compressed">{t('listenTogether.qualityCompressed')}</option>
              </select>
              <label className="lt-switch-row">
                <span>{t('listenTogether.syncCover')}</span>
                <input
                  type="checkbox"
                  className="lt-switch-input"
                  checked={syncCoverEnabled}
                  onChange={(e) => setSyncCoverEnabled(e.target.checked)}
                />
                <span className="lt-switch-slider" />
              </label>
              <label className="lt-switch-row">
                <span>{t('listenTogether.syncLyrics')}</span>
                <input
                  type="checkbox"
                  className="lt-switch-input"
                  checked={syncLyricsEnabled}
                  onChange={(e) => setSyncLyricsEnabled(e.target.checked)}
                />
                <span className="lt-switch-slider" />
              </label>
              <label className="lt-switch-row">
                <span>{t('listenTogether.syncMvHeavy')}</span>
                <input
                  type="checkbox"
                  className="lt-switch-input"
                  checked={syncMvEnabled}
                  onChange={(e) => setSyncMvEnabled(e.target.checked)}
                />
                <span className="lt-switch-slider" />
              </label>
              <div className="lyrics-drawer-offset-controls">
                <button
                  type="button"
                  className="lyrics-drawer-primary-btn lt-btn-primary"
                  onClick={publishUrl}
                >
                  <Link2 size={16} /> {t('listenTogether.publishUrl')}
                </button>
                <button
                  type="button"
                  className="lyrics-drawer-primary-btn lt-btn-soft"
                  disabled={localFileBusy}
                  onClick={publishLocalFile}
                >
                  {localFileBusy ? <RefreshCw size={16} className="spin" /> : <Upload size={16} />}{' '}
                  {t('listenTogether.publishLocal')}
                </button>
              </div>
              {inRoom && (roomState?.members?.length || 0) > 1 ? (
                <div style={{ marginTop: 10 }}>
                  <p className="lyrics-drawer-hint">{t('listenTogether.transferHost')}</p>
                  <div className="lyrics-drawer-offset-controls">
                    {(roomState.members || [])
                      .filter((m) => m.memberId !== memberId)
                      .map((m) => (
                        <button
                          key={m.memberId}
                          type="button"
                          className="lyrics-drawer-primary-btn lt-btn-soft"
                          onClick={() =>
                            clientRef.current?.send('room:transfer-host', {
                              targetMemberId: m.memberId
                            })
                          }
                        >
                          {m.name || m.memberId}
                        </button>
                      ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
          {statusText ? <p className="lyrics-drawer-hint">{statusText}</p> : null}
        </div>
      </aside>
    </>
  )
}
