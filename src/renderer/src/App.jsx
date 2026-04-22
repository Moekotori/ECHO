import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  memo,
  startTransition,
  useDeferredValue
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import i18n from './i18n'
import {
  FolderHeart,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Download,
  Music,
  X,
  Square,
  Volume2,
  VolumeX,
  Shuffle,
  Repeat,
  Repeat1,
  FileAudio,
  Trash2,
  Mic2,
  ChevronLeft,
  Search,
  Settings,
  ToggleLeft,
  ToggleRight,
  Sliders,
  Info,
  Zap,
  Image,
  MessageSquare,
  Palette,
  Wand2,
  CheckCircle2,
  ChevronDown,
  Check,
  Minus,
  ListMusic,
  ListPlus,
  Plus,
  Upload,
  Pencil,
  MoreHorizontal,
  Film,
  Radio,
  Users,
  Terminal,
  Heart,
  FolderOpen,
  Copy,
  AppWindow,
  Blocks,
  Headphones,
  History
} from 'lucide-react'
import LyricsSettingsDrawer from './components/LyricsSettingsDrawer'
import MediaDownloaderDrawer from './components/MediaDownloaderDrawer'
import MvSettingsDrawer from './components/MvSettingsDrawer'
import AudioSettingsDrawer from './components/AudioSettingsDrawer'
import CastReceiveDrawer from './components/CastReceiveDrawer'
import ListenTogetherDrawer from './components/ListenTogetherDrawer'
import LyricsCandidatePicker from './components/LyricsCandidatePicker'
import MetadataEditorDrawer from './components/MetadataEditorDrawer'
import { UiButton } from './components/ui'
import { parseAnyLyrics } from './utils/lyricsParse'
import { pickLyricsFromLrcLibResult, rankLrcLibCandidates } from './utils/lyricsCandidateRank'
import {
  getLyricsOverrideForPath,
  setLyricsOverrideForPath,
  clearLyricsOverrideForPath,
  remapLyricsOverrides
} from './utils/lyricsOverrideStorage'
import {
  getMvOverrideForPath,
  setMvOverrideForPath,
  remapMvOverrides
} from './utils/trackMemoryStorage'
import { extractVideoId } from './utils/mvUrlParse'
import { buildDesktopLyricsPayload } from './utils/desktopLyricsPayload'
import { PRESET_THEMES, hexToRgbStr, hexToRgbaString, generateRandomPalette } from './utils/color'
import {
  getUiFontStack,
  buildUiCustomFontFaceCss,
  normalizeThemeColors,
  getAppThemeBackgroundStyle
} from './utils/themeColors'
import { pickThemeExportSlice, mergeThemeImport, parseThemeBundleJson } from './utils/themeBundle'
import {
  parseTrackInfo,
  compareTrackOrder,
  stripExtension,
  parseArtistTitleFromName
} from './utils/trackUtils'
import { ArtistLink } from './components/ArtistLink'
import { MiniWaveform } from './components/MiniWaveform'
import { EqPlot } from './components/EqPlot'
import { EQ_PRESETS } from './constants/eq'
import { DEFAULT_CONFIG, migrateEqBandsTo16 } from './config/defaultConfig'
import {
  normalizeImportedPlaylists,
  buildPlaylistsExportPayload,
  extractDownloadablePlaylists
} from './utils/userPlaylists'
import {
  createEmptySmartCollectionRules,
  normalizeSmartCollectionRules,
  normalizeUserSmartCollections,
  hasActiveSmartCollectionRules,
  matchTrackAgainstSmartCollection
} from './utils/smartCollections'
import { inferUiLocaleFromNavigator, normalizeUiLocale, bcp47ForUiLocale } from './utils/uiLocale'
import { clampBiquadQ } from './utils/eqBiquad'
import { copySongCardImage, saveSongCardImage } from './utils/songCardImage'
import { parseLyricsSourceLink } from './utils/lyricsLink'
import PluginSlot from './plugins/PluginSlot'
import PluginManagerDrawer from './components/PluginManagerDrawer'
import { extractAverageHexFromSrc, generatePaletteFromHex } from './utils/color'
import {
  containsLegacyPlaybackHistoryEntries,
  createPlaybackContext,
  dedupePathList,
  normalizePlaybackContext,
  normalizePlaybackHistory,
  normalizePlaybackHistoryEntry,
  normalizePlaybackSession,
  pickInitialPersistedValue,
  remapPlaybackHistoryEntries
} from '../../shared/playbackPersistence.mjs'

/** `<audio src>` 必须用编码后的 file: URL；路径里的 `#`、`%`、Unicode 等手写 `file://` 会失效 */
function localPathToAudioSrc(filePath) {
  if (!filePath || typeof filePath !== 'string') return ''
  const href = typeof window !== 'undefined' && window.api?.pathToFileURL?.(filePath)
  if (href) return href
  return `file://${filePath}`
}

const MENU_ANIM_MS = 160
const GITHUB_RELEASES_API_URL = 'https://api.github.com/repos/Moekotori/Echoes/releases?per_page=6'
const GITHUB_RELEASES_PAGE_URL = 'https://github.com/Moekotori/Echoes/releases'
const MAX_PLAYBACK_HISTORY = 40
const STORED_VOLUME_KEY = 'nc_volume'
const SIDEBAR_LIST_OVERSCAN = 10
const SIDEBAR_ROW_HEIGHT = 64
const SIDEBAR_DETAIL_ROW_HEIGHT = 60
const RENDERER_PERSIST_DEBOUNCE_MS = 600
const PLAYBACK_SESSION_LOCAL_KEY = 'nc_playback_session'
const USER_SMART_COLLECTIONS_LOCAL_KEY = 'nc_user_smart_collections'
const DISPLAY_METADATA_OVERRIDES_LOCAL_KEY = 'nc_display_metadata_overrides'

function getInitialAppStateValue(key) {
  try {
    if (typeof window === 'undefined' || !window.api?.getInitialAppStateValue) return null
    return window.api.getInitialAppStateValue(key)
  } catch {
    return null
  }
}

function readStoredJson(localKey) {
  try {
    const raw = localStorage.getItem(localKey)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function normalizeDisplayMetadataOverrides(value) {
  if (!value || typeof value !== 'object') return {}
  const next = {}
  for (const [path, item] of Object.entries(value)) {
    if (typeof path !== 'string' || !path || !item || typeof item !== 'object') continue
    const normalizedItem = {}
    for (const key of ['title', 'artist', 'album', 'albumArtist', 'cover', 'coverPath']) {
      if (typeof item[key] === 'string') normalizedItem[key] = item[key]
    }
    for (const key of ['trackNo', 'discNo']) {
      const raw = item[key]
      const parsed = Number.parseInt(String(raw ?? ''), 10)
      if (Number.isFinite(parsed) && parsed > 0) normalizedItem[key] = parsed
    }
    if (Object.keys(normalizedItem).length > 0) next[path] = normalizedItem
  }
  return next
}

function normalizeReleaseVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
}

function buildReleasePreviewLines(body) {
  return String(body || '')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^#{1,6}\s*/, '')
        .trim()
    )
    .filter(Boolean)
    .slice(0, 8)
}

function clampVolume(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 1
  return Math.min(1, Math.max(0, num))
}

function readStoredVolume() {
  try {
    const saved = getInitialAppStateValue('volume')
    if (typeof saved === 'number' && Number.isFinite(saved)) return clampVolume(saved)
    const localSaved = localStorage.getItem(STORED_VOLUME_KEY)
    if (localSaved == null) return 1
    return clampVolume(localSaved)
  } catch {
    return 1
  }
}

function isLocalAudioFilePath(p) {
  if (!p || typeof p !== 'string') return false
  const t = p.trim()
  if (!t) return false
  if (/^https?:\/\//i.test(t)) return false
  if (t.startsWith('\\\\')) return true
  if (/^[a-zA-Z]:[\\/]/.test(t)) return true
  if (t.startsWith('/')) return true
  return false
}

function fileNameFromPath(filePath = '') {
  return (
    String(filePath || '')
      .split(/[/\\]/)
      .pop() || String(filePath || '')
  )
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildPlaybackHistoryEntry(track, trackMetaMap, playedAt = Date.now()) {
  if (!track?.path) return null
  const info = parseTrackInfo(track, trackMetaMap?.[track.path])
  return {
    path: track.path,
    title: info?.title || stripExtension(track.name || fileNameFromPath(track.path)),
    artist:
      info?.artist && info.artist !== 'Unknown Artist'
        ? info.artist
        : track?.info?.artist && track.info.artist !== 'Unknown Artist'
          ? track.info.artist
          : '',
    album:
      info?.album && info.album !== 'Unknown Album'
        ? info.album
        : track?.info?.album && track.info.album !== 'Unknown Album'
          ? track.info.album
          : '',
    playedAt
  }
}

function normalizeConfigState(raw) {
  const source = raw && typeof raw === 'object' ? raw : null
  if (!source) {
    return { ...DEFAULT_CONFIG, uiLocale: inferUiLocaleFromNavigator() }
  }

  const oldRev = source.configRevision ?? 0
  const appRev = DEFAULT_CONFIG.configRevision ?? 1
  const merged = {
    ...DEFAULT_CONFIG,
    ...source,
    customColors: normalizeThemeColors({
      ...DEFAULT_CONFIG.customColors,
      ...(source.customColors || {})
    })
  }
  if (!Object.prototype.hasOwnProperty.call(source, 'lyricsShowRomaji')) {
    merged.lyricsShowRomaji = DEFAULT_CONFIG.lyricsShowRomaji
  }
  if (!Object.prototype.hasOwnProperty.call(source, 'lyricsShowTranslation')) {
    merged.lyricsShowTranslation = DEFAULT_CONFIG.lyricsShowTranslation
  }
  if (!Object.prototype.hasOwnProperty.call(source, 'lyricsWordHighlight')) {
    merged.lyricsWordHighlight = DEFAULT_CONFIG.lyricsWordHighlight
  }
  if (!Object.prototype.hasOwnProperty.call(source, 'uiLocale')) {
    merged.uiLocale = inferUiLocaleFromNavigator()
  } else {
    merged.uiLocale = normalizeUiLocale(merged.uiLocale)
  }
  if (oldRev < appRev) {
    merged.configRevision = appRev
  }
  if (oldRev < appRev && Array.isArray(source.eqBands) && source.eqBands.length === 10) {
    merged.eqBands = migrateEqBandsTo16(source.eqBands)
  }
  if (!['low', 'balanced', 'stable'].includes(merged.audioOutputBufferProfile)) {
    merged.audioOutputBufferProfile = 'balanced'
  }
  if (
    merged.theme !== 'custom' &&
    !Object.prototype.hasOwnProperty.call(PRESET_THEMES, merged.theme)
  ) {
    merged.theme = 'minimal'
    merged.customColors = normalizeThemeColors(PRESET_THEMES.minimal.colors)
  }
  if (oldRev < 4) {
    const legacy = merged.lyricsFontColor
    if (!merged.lyricsColor && typeof legacy === 'string' && legacy.trim()) {
      const hex = legacy.trim()
      merged.lyricsColor = {
        version: 1,
        layers: {
          main: {
            active: { hex, a: 1 },
            normal: { hex, a: 0.82 },
            past: { hex, a: 0.6 }
          }
        }
      }
    }
  }
  return merged
}

function normalizeWatchedTrack(track) {
  if (!track?.path) return null
  return {
    name: track.name || fileNameFromPath(track.path),
    path: track.path,
    folder: track.folder,
    birthtimeMs: track.birthtimeMs || 0,
    mtimeMs: track.mtimeMs || 0,
    sizeBytes: track.sizeBytes || 0
  }
}

function remapPathList(paths, pathMap, removedSet) {
  const seen = new Set()
  const next = []
  for (const path of Array.isArray(paths) ? paths : []) {
    if (typeof path !== 'string' || !path) continue
    const mappedPath = pathMap[path] || path
    if (!mappedPath || removedSet.has(mappedPath) || seen.has(mappedPath)) continue
    seen.add(mappedPath)
    next.push(mappedPath)
  }
  return next
}

function remapQueueItems(items, pathMap, removedSet) {
  const seen = new Set()
  const next = []
  for (const item of Array.isArray(items) ? items : []) {
    const path = item?.path
    if (typeof path !== 'string' || !path) continue
    const mappedPath = pathMap[path] || path
    if (!mappedPath || removedSet.has(mappedPath) || seen.has(mappedPath)) continue
    seen.add(mappedPath)
    next.push({ path: mappedPath })
  }
  return next
}

function remapTrackMetaEntries(metaMap, pathMap, removedSet) {
  const next = {}
  for (const [path, value] of Object.entries(metaMap || {})) {
    const mappedPath = pathMap[path] || path
    if (!mappedPath || removedSet.has(mappedPath)) continue
    if (!Object.prototype.hasOwnProperty.call(next, mappedPath)) {
      next[mappedPath] = value
    }
  }
  return next
}

function remapTrackStatsEntries(statsMap, pathMap, removedSet) {
  const next = {}
  for (const [path, value] of Object.entries(statsMap || {})) {
    const mappedPath = pathMap[path] || path
    if (!mappedPath || removedSet.has(mappedPath)) continue
    if (!Object.prototype.hasOwnProperty.call(next, mappedPath)) {
      next[mappedPath] = value
    }
  }
  return next
}

function withUpdatedTrackPath(track, nextPath) {
  if (!track?.path || !nextPath || track.path === nextPath) return track
  return {
    ...track,
    path: nextPath,
    name: fileNameFromPath(nextPath)
  }
}

function isTrackInsideImportedFolders(trackPath, folders) {
  if (!trackPath || !Array.isArray(folders) || !folders.length) return false
  const normalizedPath = String(trackPath).replace(/\\/g, '/').toLowerCase()
  return folders.some((folder) => {
    const normalizedFolder = String(folder || '')
      .replace(/[\\/]+$/, '')
      .replace(/\\/g, '/')
      .toLowerCase()
    if (!normalizedFolder) return false
    return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`)
  })
}

function buildLibraryTrackFingerprint(track) {
  if (!track) return ''
  if (track.birthtimeMs) return `birth:${track.birthtimeMs}`
  if (track.sizeBytes || track.mtimeMs) return `stat:${track.sizeBytes || 0}:${track.mtimeMs || 0}`
  return ''
}

function diffImportedFolderSnapshot(previousTracks, currentTracks) {
  const previousByPath = new Map((previousTracks || []).map((track) => [track.path, track]))
  const currentByPath = new Map((currentTracks || []).map((track) => [track.path, track]))
  const removedEntries = []
  const addedEntries = []

  for (const [path, track] of previousByPath) {
    if (!currentByPath.has(path)) removedEntries.push(track)
  }
  for (const [path, track] of currentByPath) {
    if (!previousByPath.has(path)) addedEntries.push(track)
  }

  const removedByFingerprint = new Map()
  const addedByFingerprint = new Map()
  const pushFingerprint = (map, track) => {
    const key = buildLibraryTrackFingerprint(track)
    if (!key) return
    const group = map.get(key)
    if (group) group.push(track)
    else map.set(key, [track])
  }

  removedEntries.forEach((track) => pushFingerprint(removedByFingerprint, track))
  addedEntries.forEach((track) => pushFingerprint(addedByFingerprint, track))

  const renamed = []
  for (const [fingerprint, removedGroup] of removedByFingerprint) {
    const addedGroup = addedByFingerprint.get(fingerprint)
    if (!addedGroup || removedGroup.length !== 1 || addedGroup.length !== 1) continue
    renamed.push({
      from: removedGroup[0].path,
      to: addedGroup[0].path,
      entry: addedGroup[0]
    })
  }

  const renamedFromSet = new Set(renamed.map((item) => item.from))
  const renamedToSet = new Set(renamed.map((item) => item.to))
  return {
    renamed,
    removedPaths: removedEntries
      .filter((track) => !renamedFromSet.has(track.path))
      .map((track) => track.path),
    added: addedEntries.filter((track) => !renamedToSet.has(track.path))
  }
}

function collectReferencedLibraryPaths({
  playlist = [],
  userPlaylists = [],
  likedPaths = [],
  playbackHistory = [],
  trackStats = {}
}) {
  const seen = new Set()
  const next = []
  const pushPath = (path) => {
    if (typeof path !== 'string' || !path || seen.has(path)) return
    seen.add(path)
    next.push(path)
  }

  for (const track of playlist) pushPath(track?.path)
  for (const playlistItem of userPlaylists) {
    for (const path of playlistItem?.paths || []) pushPath(path)
  }
  for (const path of likedPaths) pushPath(path)
  for (const entry of playbackHistory) pushPath(entry?.path)
  for (const path of Object.keys(trackStats || {})) pushPath(path)
  return next
}

function normalizeTrackStatsMap(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const next = {}
  for (const [path, value] of Object.entries(raw)) {
    if (typeof path !== 'string' || !path || !value || typeof value !== 'object') continue
    const playCount = Number(value.playCount)
    const lastPlayedAt = Number(value.lastPlayedAt)
    next[path] = {
      playCount: Number.isFinite(playCount) && playCount > 0 ? Math.floor(playCount) : 0,
      lastPlayedAt: Number.isFinite(lastPlayedAt) && lastPlayedAt > 0 ? lastPlayedAt : 0
    }
  }
  return next
}

function createSmartCollectionDraft(source = null) {
  const rules = normalizeSmartCollectionRules(source?.rules)
  return {
    name: source?.name || '',
    matchMode: rules.matchMode,
    likedOnly: rules.likedOnly,
    minPlayCount: rules.minPlayCount ? String(rules.minPlayCount) : '',
    playedWithinDays: rules.playedWithinDays ? String(rules.playedWithinDays) : '',
    addedWithinDays: rules.addedWithinDays ? String(rules.addedWithinDays) : '',
    titleIncludes: rules.titleIncludes || '',
    artistIncludes: rules.artistIncludes || '',
    albumIncludes: rules.albumIncludes || ''
  }
}

function normalizeSmartCollectionDraft(draft) {
  const source = draft && typeof draft === 'object' ? draft : {}
  return {
    name: String(source.name || '').trim(),
    rules: normalizeSmartCollectionRules({
      matchMode: source.matchMode,
      likedOnly: source.likedOnly === true,
      minPlayCount: source.minPlayCount,
      playedWithinDays: source.playedWithinDays,
      addedWithinDays: source.addedWithinDays,
      titleIncludes: source.titleIncludes,
      artistIncludes: source.artistIncludes,
      albumIncludes: source.albumIncludes
    })
  }
}

function createSmartCollectionTemplateDraft(templateKey) {
  switch (templateKey) {
    case 'recent-added':
      return createSmartCollectionDraft({
        name: 'Recently added',
        rules: { addedWithinDays: 14, matchMode: 'all' }
      })
    case 'recently-played':
      return createSmartCollectionDraft({
        name: 'Recently played a lot',
        rules: { playedWithinDays: 30, minPlayCount: 3, matchMode: 'all' }
      })
    case 'liked':
      return createSmartCollectionDraft({
        name: 'My likes',
        rules: { likedOnly: true, matchMode: 'all' }
      })
    default:
      return createSmartCollectionDraft({ rules: createEmptySmartCollectionRules() })
  }
}

function createUniqueSmartCollectionName(baseName, existingCollections = []) {
  const normalizedBase = String(baseName || '').trim() || 'Smart collection'
  const existingNames = new Set(
    (existingCollections || []).map((item) =>
      String(item?.name || '')
        .trim()
        .toLowerCase()
    )
  )
  if (!existingNames.has(normalizedBase.toLowerCase())) return normalizedBase
  let nextIndex = 2
  while (existingNames.has(`${normalizedBase} ${nextIndex}`.toLowerCase())) {
    nextIndex += 1
  }
  return `${normalizedBase} ${nextIndex}`
}

const AlbumSidebarCard = memo(function AlbumSidebarCard({
  album,
  isSelected,
  onPickAlbum,
  onContextMenu
}) {
  const { t } = useTranslation()
  const [coverFailed, setCoverFailed] = useState(false)

  useEffect(() => {
    setCoverFailed(false)
  }, [album.cover])

  return (
    <button
      type="button"
      className={`album-card ${isSelected ? 'active' : ''}`}
      onClick={() => onPickAlbum(album)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, album) : undefined}
      title={t('albumCard.title', {
        name: album.name,
        count: album.tracks.length
      })}
    >
      {album.cover && !coverFailed ? (
        <img
          src={album.cover}
          alt={album.name}
          className="album-cover-image"
          loading={String(album.cover).startsWith('data:') ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setCoverFailed(true)}
        />
      ) : (
        <div className="album-cover-fallback">
          <Image size={20} />
        </div>
      )}
      <div className="album-meta">
        <div className="album-title">{album.name}</div>
        <div className="album-subtitle">
          <span className="album-subtitle-artist">
            <ArtistLink
              artist={album.artist}
              className="artist-link-subtle album-subtitle-artist-link"
              stopPropagation
            />
          </span>
          <span className="album-subtitle-sep">·</span>
          <span className="album-subtitle-count">{album.tracks.length} tracks</span>
        </div>
      </div>
    </button>
  )
})

export default function App() {
  const { t } = useTranslation()
  const [appVersion, setAppVersion] = useState('')
  const [dynamicCoverTheme, setDynamicCoverTheme] = useState(null)
  const [updateStatus, setUpdateStatus] = useState(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [releaseNotes, setReleaseNotes] = useState([])
  const [releaseNotesLoading, setReleaseNotesLoading] = useState(false)
  const [releaseNotesError, setReleaseNotesError] = useState('')
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)

  const [playlist, setPlaylist] = useState(() => {
    return pickInitialPersistedValue({
      snapshotValue: getInitialAppStateValue('playlist'),
      localValue: readStoredJson('nc_playlist'),
      normalize: (value) => (Array.isArray(value) ? value : undefined),
      fallback: []
    })
  })
  const [upNextQueue, setUpNextQueue] = useState([])
  const [playbackHistory, setPlaybackHistory] = useState(() => {
    return pickInitialPersistedValue({
      snapshotValue: getInitialAppStateValue('playbackHistory'),
      localValue: readStoredJson('nc_playback_history'),
      normalize: (value) =>
        Array.isArray(value) ? normalizePlaybackHistory(value, MAX_PLAYBACK_HISTORY) : undefined,
      fallback: []
    })
  })
  const [queuePlaybackEnabled, setQueuePlaybackEnabled] = useState(() => {
    return pickInitialPersistedValue({
      snapshotValue: getInitialAppStateValue('queuePlaybackEnabled'),
      localValue: localStorage.getItem('nc_queue_playback_enabled'),
      normalize: (value) => {
        if (typeof value === 'boolean') return value
        if (value == null) return undefined
        return value !== '0'
      },
      fallback: true
    })
  })
  const [playMode, setPlayMode] = useState(() => {
    return pickInitialPersistedValue({
      snapshotValue: getInitialAppStateValue('playMode'),
      localValue: localStorage.getItem('nc_playmode'),
      normalize: (value) => (typeof value === 'string' && value ? value : undefined),
      fallback: 'loop'
    })
  })

  const [currentIndex, setCurrentIndex] = useState(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [coverUrl, setCoverUrl] = useState(null)

  const [playbackRate, setPlaybackRate] = useState(1.0)
  const [volume, setVolume] = useState(() => readStoredVolume())
  const [useNativeEngine, setUseNativeEngine] = useState(false)
  const [isAudioExclusive, setIsAudioExclusive] = useState(false)
  const useNativeEngineRef = useRef(false)
  const nativePlayJustCalledRef = useRef(false)
  /** Avoid duplicate native playAudio for the same track (React Strict Mode double-invokes effects). */
  const nativePlayDedupeRef = useRef({ path: '', index: -1, t: 0 })
  const [isProgressDragging, setIsProgressDragging] = useState(false)
  const isProgressDraggingRef = useRef(false)
  const progressSeekValueRef = useRef(0)
  const [isSpeedDragging, setIsSpeedDragging] = useState(false)
  const [isVolumeDragging, setIsVolumeDragging] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [lyricsRenderTime, setLyricsRenderTime] = useState(0)
  const [isSeeking, setIsSeeking] = useState(false)
  const isSeekingRef = useRef(false)
  useEffect(() => {
    isSeekingRef.current = isSeeking
  }, [isSeeking])

  useEffect(() => {
    if (window.api?.getAppVersion) {
      window.api
        .getAppVersion()
        .then((v) => {
          if (v) setAppVersion(v)
        })
        .catch(console.error)
    }

    if (window.api?.onUpdaterEvent) {
      return window.api.onUpdaterEvent((msg) => {
        setUpdateStatus(msg)
        if (msg.event === 'update-available' || msg.event === 'update-downloaded') {
          setReleaseNotesOpen(true)
        }
        if (
          msg.event === 'update-available' ||
          msg.event === 'update-downloaded' ||
          msg.event === 'error' ||
          msg.event === 'update-not-available'
        ) {
          setIsUpdating(false)
        }
      })
    }
  }, [])

  const seekTimerRef = useRef(null)
  const [isPresetOpen, setIsPresetOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isCardActionBusy, setIsCardActionBusy] = useState(false)
  const [shareCardSnapshot, setShareCardSnapshot] = useState(null)

  // MV State
  const [mvId, setMvId] = useState(null)
  const [isSearchingMV, setIsSearchingMV] = useState(false)
  const [youtubeMvLoginHint, setYoutubeMvLoginHint] = useState(false)
  const [signInStatus, setSignInStatus] = useState({
    youtube: false,
    bilibili: false
  })
  const [biliDirectStream, setBiliDirectStream] = useState(null)

  useEffect(() => {
    const refresh = () => {
      window.api
        ?.checkSignInStatus?.()
        .then((s) => {
          if (s) setSignInStatus(s)
        })
        .catch(() => {})
    }
    refresh()
    const unsub = window.api?.onSignInStatusChanged?.(refresh)
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  // Lyrics States
  const [showLyrics, setShowLyrics] = useState(false)
  const [lyrics, setLyrics] = useState([])
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1)
  const [lyricsDrawerOpen, setLyricsDrawerOpen] = useState(false)
  const [lyricsCandidateOpen, setLyricsCandidateOpen] = useState(false)
  const [lyricsCandidateLoading, setLyricsCandidateLoading] = useState(false)
  const [lyricsCandidateItems, setLyricsCandidateItems] = useState([])
  const [downloaderDrawerOpen, setDownloaderDrawerOpen] = useState(false)
  const [mvDrawerOpen, setMvDrawerOpen] = useState(false)
  const [castDrawerOpen, setCastDrawerOpen] = useState(false)
  const [listenTogetherDrawerOpen, setListenTogetherDrawerOpen] = useState(false)
  const [pluginDrawerOpen, setPluginDrawerOpen] = useState(false)
  const [audioSettingsDrawerOpen, setAudioSettingsDrawerOpen] = useState(false)
  const [metadataEditorOpen, setMetadataEditorOpen] = useState(false)
  const [metadataEditorTrack, setMetadataEditorTrack] = useState(null)
  const [batchRenameOpen, setBatchRenameOpen] = useState(false)
  const [quickEditField, setQuickEditField] = useState(null)
  const [quickEditDraft, setQuickEditDraft] = useState('')
  const [quickEditBusy, setQuickEditBusy] = useState(false)
  const [quickEditModifierActive, setQuickEditModifierActive] = useState(false)
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false)
  const [listenTogetherRoomState, setListenTogetherRoomState] = useState(null)
  const [castRemoteActive, setCastRemoteActive] = useState(false)
  const [castDlnaListening, setCastDlnaListening] = useState(false)
  /** 主进程合并的投流状态（含 dlnaMeta、进度），用于主页展示 DLNA 歌曲信息 */
  const [lastCastStatus, setLastCastStatus] = useState(null)
  const [mvPlaybackQuality, setMvPlaybackQuality] = useState(null)
  const [lyricsMatchStatus, setLyricsMatchStatus] = useState('idle')
  const [lyricsSourceStatus, setLyricsSourceStatus] = useState({
    kind: 'idle',
    detail: '',
    origin: ''
  })
  /** 与 lyrics 等长：主行罗马音（LRC 自带或 Kuroshiro 生成） */
  // Romaji display removed from UI for simplicity; keep state empty.
  const [romajiDisplayLines, setRomajiDisplayLines] = useState([])
  const [metadata, setMetadata] = useState({
    title: '',
    artist: '',
    album: '',
    albumArtist: '',
    trackNo: null,
    discNo: null
  })
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [listMode, setListMode] = useState('songs')
  const [userPlaylists, setUserPlaylists] = useState(() => {
    return pickInitialPersistedValue({
      snapshotValue: getInitialAppStateValue('userPlaylists'),
      localValue: readStoredJson('nc_user_playlists'),
      normalize: (value) => (Array.isArray(value) ? value : undefined),
      fallback: []
    })
  })
  const [userSmartCollections, setUserSmartCollections] = useState(() => {
    return pickInitialPersistedValue({
      snapshotValue: getInitialAppStateValue('userSmartCollections'),
      localValue: readStoredJson(USER_SMART_COLLECTIONS_LOCAL_KEY),
      normalize: (value) => {
        const normalized = normalizeUserSmartCollections(value)
        return Array.isArray(normalized) ? normalized : undefined
      },
      fallback: []
    })
  })
  const [displayMetadataOverrides, setDisplayMetadataOverrides] = useState(() => {
    return pickInitialPersistedValue({
      snapshotValue: getInitialAppStateValue('displayMetadataOverrides'),
      localValue: readStoredJson(DISPLAY_METADATA_OVERRIDES_LOCAL_KEY),
      normalize: (value) => normalizeDisplayMetadataOverrides(value),
      fallback: {}
    })
  })
  const playlistStoreHydratedRef = useRef(false)
  const userPlaylistsStoreHydratedRef = useRef(false)
  const userSmartCollectionsStoreHydratedRef = useRef(false)
  const displayMetadataOverridesHydratedRef = useRef(false)
  const configStoreHydratedRef = useRef(false)
  const likedPathsStoreHydratedRef = useRef(false)
  const playModeStoreHydratedRef = useRef(false)
  const queuePlaybackStoreHydratedRef = useRef(false)
  const trackStatsStoreHydratedRef = useRef(false)
  const playbackHistoryStoreHydratedRef = useRef(false)
  const volumeStoreHydratedRef = useRef(false)
  const [selectedUserPlaylistId, setSelectedUserPlaylistId] = useState(null)
  const [selectedSmartCollectionId, setSelectedSmartCollectionId] = useState(null)
  const [smartCollectionEditorOpen, setSmartCollectionEditorOpen] = useState(false)
  const [editingSmartCollectionId, setEditingSmartCollectionId] = useState(null)
  const [smartCollectionDraft, setSmartCollectionDraft] = useState(() =>
    createSmartCollectionDraft({ rules: createEmptySmartCollectionRules() })
  )
  const [playlistLibraryMoreOpen, setPlaylistLibraryMoreOpen] = useState(false)
  const playlistLibraryMoreRef = useRef(null)
  /** { originalIdx, path, top, left, width } | null — 浮层用 fixed + portal，避免被侧边栏裁切 */
  const [addToPlaylistMenu, setAddToPlaylistMenu] = useState(null)
  const [likedPaths, setLikedPaths] = useState(() => {
    return pickInitialPersistedValue({
      snapshotValue: getInitialAppStateValue('likedPaths'),
      localValue: readStoredJson('nc_liked_paths'),
      normalize: (value) =>
        Array.isArray(value) ? value.filter((x) => typeof x === 'string') : undefined,
      fallback: []
    })
  })
  const [trackStats, setTrackStats] = useState(() => {
    return pickInitialPersistedValue({
      snapshotValue: getInitialAppStateValue('trackStats'),
      localValue: readStoredJson('nc_track_stats'),
      normalize: (value) =>
        value && typeof value === 'object' ? normalizeTrackStatsMap(value) : undefined,
      fallback: {}
    })
  })
  const [activePlaybackContext, setActivePlaybackContext] = useState(() =>
    createPlaybackContext('library', 'library', [])
  )
  const [showLikedOnly, setShowLikedOnly] = useState(false)
  /** 侧栏曲目右键菜单 { clientX, clientY, track } */
  const [trackContextMenu, setTrackContextMenu] = useState(null)
  const [ctxMenuVisualOpen, setCtxMenuVisualOpen] = useState(false)
  const ctxMenuCloseTimerRef = useRef(null)
  const trackContextMenuRef = useRef(null)
  const [coverContextMenu, setCoverContextMenu] = useState(null)
  const [coverCtxVisualOpen, setCoverCtxVisualOpen] = useState(false)
  const coverCtxCloseTimerRef = useRef(null)
  const coverContextMenuRef = useRef(null)
  const [groupContextMenu, setGroupContextMenu] = useState(null)
  const [groupCtxVisualOpen, setGroupCtxVisualOpen] = useState(false)
  const groupCtxCloseTimerRef = useRef(null)
  const groupContextMenuRef = useRef(null)
  const songCardCaptureRef = useRef(null)
  const [addPlVisualOpen, setAddPlVisualOpen] = useState(false)
  const addPlCloseTimerRef = useRef(null)
  const playlistRef = useRef(playlist)
  const currentIndexRef = useRef(currentIndex)
  const currentTimeRef = useRef(currentTime)
  const upNextQueueRef = useRef(upNextQueue)
  const playbackHistoryRef = useRef(playbackHistory)
  const userPlaylistsRef = useRef(userPlaylists)
  const likedPathsRef = useRef(likedPaths)
  const trackStatsRef = useRef(trackStats)
  const displayMetadataOverridesRef = useRef(displayMetadataOverrides)
  const activePlaybackContextRef = useRef(activePlaybackContext)
  const playbackSessionSeedRef = useRef(
    normalizePlaybackSession(getInitialAppStateValue('playbackSession')) ||
      normalizePlaybackSession(readStoredJson(PLAYBACK_SESSION_LOCAL_KEY))
  )
  const playbackSessionRestoreAttemptedRef = useRef(false)
  const pendingTrackStartRef = useRef(null)
  const lastLoadedTrackPathRef = useRef('')
  const historyNavigationRef = useRef(false)
  const lastHistoryTrackedPathRef = useRef('')
  const lastStatsTrackedPathRef = useRef('')
  const startupExclusiveResetRef = useRef(false)
  const releaseNotesFetchedRef = useRef(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [quickNewPlaylistName, setQuickNewPlaylistName] = useState('')
  const [selectedAlbum, setSelectedAlbum] = useState('all')
  const [selectedFolder, setSelectedFolder] = useState('all')
  const [songSortMode, setSongSortMode] = useState('default') // 'default' | 'dateAsc' | 'dateDesc'
  const [songSortOpen, setSongSortOpen] = useState(false)
  const songSortRef = useRef(null)
  const [folderSortMode, setFolderSortMode] = useState('default') // 'default' | 'dateAsc' | 'dateDesc'
  const [folderSortOpen, setFolderSortOpen] = useState(false)
  const folderSortRef = useRef(null)
  const [importedFolders, setImportedFolders] = useState(() => {
    return pickInitialPersistedValue({
      snapshotValue: getInitialAppStateValue('importedFolders'),
      localValue: readStoredJson('nc_imported_folders'),
      normalize: (value) => (Array.isArray(value) ? value : undefined),
      fallback: []
    })
  })
  const importedFoldersHydratedRef = useRef(false)
  const [libraryStateReady, setLibraryStateReady] = useState(false)
  const [playbackSessionRestoreReady, setPlaybackSessionRestoreReady] = useState(false)
  const [libraryCleanupBusy, setLibraryCleanupBusy] = useState(false)
  const [missingLibraryPaths, setMissingLibraryPaths] = useState([])
  const [trackMetaMap, setTrackMetaMap] = useState({})
  const trackMetaMapRef = useRef(trackMetaMap)
  const [technicalInfo, setTechnicalInfo] = useState({
    sampleRate: null,
    originalBpm: null,
    channels: null,
    bitrate: null,
    codec: null
  })
  const [isConverting, setIsConverting] = useState(false)
  const [conversionMsg, setConversionMsg] = useState('')
  const [audioDevices, setAudioDevices] = useState([])
  const [queueDragOver, setQueueDragOver] = useState(false)

  // Hi-Fi & Navigation States
  const [view, setView] = useState('player') // 'player', 'lyrics', 'settings'
  const [config, setConfig] = useState(() => {
    const saved = getInitialAppStateValue('config')
    if (saved && typeof saved === 'object') return normalizeConfigState(saved)
    return normalizeConfigState(readStoredJson('nc_config'))
  })

  const configRef = useRef(config)
  useEffect(() => {
    configRef.current = config
  }, [config])

  const loadReleaseNotes = useCallback(
    async (force = false) => {
      if (releaseNotesLoading) return
      if (releaseNotesFetchedRef.current && !force) return

      setReleaseNotesLoading(true)
      setReleaseNotesError('')

      try {
        const response = await fetch(GITHUB_RELEASES_API_URL, {
          headers: {
            Accept: 'application/vnd.github+json'
          }
        })
        if (!response.ok) {
          throw new Error(`github_${response.status}`)
        }
        const data = await response.json()
        const releases = Array.isArray(data)
          ? data
              .filter((item) => item && item.draft !== true)
              .map((item) => ({
                version: normalizeReleaseVersion(item.tag_name || item.name || ''),
                title: item.name || item.tag_name || 'Release',
                url: item.html_url || GITHUB_RELEASES_PAGE_URL,
                publishedAt: item.published_at || '',
                publishedLabel: item.published_at
                  ? new Date(item.published_at).toLocaleDateString()
                  : '',
                previewLines: buildReleasePreviewLines(item.body)
              }))
              .filter((item) => item.version || item.title)
          : []
        setReleaseNotes(releases)
        releaseNotesFetchedRef.current = true
      } catch (e) {
        setReleaseNotesError(e?.message || 'release_notes_unavailable')
      } finally {
        setReleaseNotesLoading(false)
      }
    },
    [releaseNotesLoading]
  )

  const openExternalLink = useCallback((url) => {
    const target = String(url || '').trim()
    if (!target) return
    if (window.api?.openExternal) {
      void window.api.openExternal(target)
      return
    }
    window.open(target, '_blank', 'noopener,noreferrer')
  }, [])

  useEffect(() => {
    if ((view === 'settings' || releaseNotesOpen) && !releaseNotesFetchedRef.current) {
      void loadReleaseNotes()
    }
  }, [view, releaseNotesOpen, loadReleaseNotes])

  useEffect(() => {
    if (updateStatus?.event === 'update-available' || updateStatus?.event === 'update-downloaded') {
      void loadReleaseNotes()
    }
  }, [updateStatus, loadReleaseNotes])

  useEffect(() => {
    if (!window.api?.onLyricsDesktopUncheck) return undefined
    return window.api.onLyricsDesktopUncheck(() => {
      setConfig((p) => ({ ...p, desktopLyricsEnabled: false }))
    })
  }, [setConfig])

  const persistQueueRef = useRef(new Map())
  const likedSet = useMemo(() => new Set(likedPaths), [likedPaths])
  const upNextPathSet = useMemo(
    () => new Set(upNextQueue.map((item) => item?.path).filter((x) => typeof x === 'string')),
    [upNextQueue]
  )

  const flushPersistedState = useCallback((targetKey = null) => {
    const queue = persistQueueRef.current
    const keys = targetKey ? [targetKey] : Array.from(queue.keys())

    for (const persistKey of keys) {
      const pending = queue.get(persistKey)
      if (!pending) continue
      if (pending.timer) clearTimeout(pending.timer)
      queue.delete(persistKey)

      if (pending.localKey) {
        try {
          localStorage.setItem(pending.localKey, JSON.stringify(pending.value))
        } catch {
          /* ignore storage quota / serialization failures */
        }
      }

      if (pending.writeToAppState && window.api?.appStateSet) {
        void window.api.appStateSet(persistKey, pending.value)
      }
    }
  }, [])

  const schedulePersistedState = useCallback(
    (persistKey, localKey, value, writeToAppState = true) => {
      const queue = persistQueueRef.current
      const existing = queue.get(persistKey)
      if (
        existing &&
        existing.value === value &&
        existing.localKey === localKey &&
        existing.writeToAppState === writeToAppState
      ) {
        return
      }

      if (existing?.timer) clearTimeout(existing.timer)

      const timer = window.setTimeout(() => {
        flushPersistedState(persistKey)
      }, RENDERER_PERSIST_DEBOUNCE_MS)

      queue.set(persistKey, {
        localKey,
        value,
        writeToAppState,
        timer
      })
    },
    [flushPersistedState]
  )

  const getPlaybackSessionSnapshot = useCallback(() => {
    const currentTrack = playlistRef.current[currentIndexRef.current]
    if (!currentTrack?.path) return null

    const pendingSession = pendingTrackStartRef.current
    const currentTimeSec =
      pendingSession?.trackPath === currentTrack.path
        ? pendingSession.currentTimeSec
        : lastLoadedTrackPathRef.current === currentTrack.path
          ? currentTimeRef.current
          : 0

    return {
      trackPath: currentTrack.path,
      currentTimeSec: Math.max(0, Number(currentTimeSec) || 0),
      playbackContext: normalizePlaybackContext(activePlaybackContextRef.current),
      savedAt: Date.now()
    }
  }, [])

  const persistPlaybackSession = useCallback(
    (value, writeToAppState = true) => {
      playbackSessionSeedRef.current = value
      schedulePersistedState('playbackSession', PLAYBACK_SESSION_LOCAL_KEY, value, writeToAppState)
    },
    [schedulePersistedState]
  )

  useEffect(() => {
    const handleBeforeUnload = () => {
      flushPersistedState()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      flushPersistedState()
    }
  }, [flushPersistedState])

  useEffect(() => {
    schedulePersistedState(
      'likedPaths',
      'nc_liked_paths',
      likedPaths,
      config.autoSaveLibrary !== false && likedPathsStoreHydratedRef.current
    )
  }, [likedPaths, config.autoSaveLibrary, schedulePersistedState])

  useEffect(() => {
    schedulePersistedState(
      'trackStats',
      'nc_track_stats',
      trackStats,
      config.autoSaveLibrary !== false && trackStatsStoreHydratedRef.current
    )
  }, [trackStats, config.autoSaveLibrary, schedulePersistedState])

  useEffect(() => {
    playlistRef.current = playlist
  }, [playlist])

  useEffect(() => {
    currentIndexRef.current = currentIndex
  }, [currentIndex])

  useEffect(() => {
    currentTimeRef.current = currentTime
  }, [currentTime])

  useEffect(() => {
    upNextQueueRef.current = upNextQueue
  }, [upNextQueue])

  useEffect(() => {
    playbackHistoryRef.current = playbackHistory
  }, [playbackHistory])

  useEffect(() => {
    userPlaylistsRef.current = userPlaylists
  }, [userPlaylists])

  useEffect(() => {
    likedPathsRef.current = likedPaths
  }, [likedPaths])

  useEffect(() => {
    trackStatsRef.current = trackStats
  }, [trackStats])

  useEffect(() => {
    activePlaybackContextRef.current = activePlaybackContext
  }, [activePlaybackContext])

  const getLibraryPlaybackPaths = useCallback(() => {
    return dedupePathList((playlistRef.current || []).map((track) => track?.path))
  }, [])

  const getPlaybackSequenceSnapshot = useCallback(() => {
    const libraryPaths = getLibraryPlaybackPaths()
    const currentPath = playlistRef.current[currentIndexRef.current]?.path || ''
    const context =
      activePlaybackContextRef.current || createPlaybackContext('library', 'library', [])

    if (context.kind === 'library') {
      return {
        context,
        currentPath,
        paths: libraryPaths,
        currentSeqIndex: currentPath ? libraryPaths.indexOf(currentPath) : -1
      }
    }

    const libraryPathSet = new Set(libraryPaths)
    const contextPaths = dedupePathList(context.trackPaths).filter((path) =>
      libraryPathSet.has(path)
    )
    if (contextPaths.length > 0 && currentPath && contextPaths.includes(currentPath)) {
      return {
        context,
        currentPath,
        paths: contextPaths,
        currentSeqIndex: contextPaths.indexOf(currentPath)
      }
    }

    return {
      context: createPlaybackContext('library', 'library', []),
      currentPath,
      paths: libraryPaths,
      currentSeqIndex: currentPath ? libraryPaths.indexOf(currentPath) : -1
    }
  }, [getLibraryPlaybackPaths])

  useEffect(() => {
    trackMetaMapRef.current = trackMetaMap
  }, [trackMetaMap])

  useEffect(() => {
    displayMetadataOverridesRef.current = displayMetadataOverrides
  }, [displayMetadataOverrides])

  useEffect(() => {
    const syncModifier = (event) => {
      setQuickEditModifierActive(Boolean(event?.ctrlKey || event?.metaKey))
    }
    const clearModifier = () => setQuickEditModifierActive(false)

    window.addEventListener('keydown', syncModifier)
    window.addEventListener('keyup', syncModifier)
    window.addEventListener('blur', clearModifier)
    return () => {
      window.removeEventListener('keydown', syncModifier)
      window.removeEventListener('keyup', syncModifier)
      window.removeEventListener('blur', clearModifier)
    }
  }, [])

  useEffect(() => {
    if (!missingLibraryPaths.length) return
    const currentReferenced = new Set(
      collectReferencedLibraryPaths({
        playlist,
        userPlaylists,
        likedPaths,
        playbackHistory,
        trackStats
      })
    )
    setMissingLibraryPaths((prev) => {
      const next = prev.filter((path) => currentReferenced.has(path))
      return next.length === prev.length ? prev : next
    })
  }, [playlist, userPlaylists, likedPaths, playbackHistory, trackStats, missingLibraryPaths.length])

  useEffect(() => {
    const currentPath = playlist[currentIndex]?.path || ''
    const previousPath = lastHistoryTrackedPathRef.current

    if (!currentPath) {
      lastHistoryTrackedPathRef.current = ''
      lastStatsTrackedPathRef.current = ''
      return
    }

    if (isPlaying && lastStatsTrackedPathRef.current !== currentPath) {
      setTrackStats((prev) => {
        const current = prev[currentPath] || {}
        return {
          ...prev,
          [currentPath]: {
            playCount: (Number(current.playCount) || 0) + 1,
            lastPlayedAt: Date.now()
          }
        }
      })
      lastStatsTrackedPathRef.current = currentPath
    }

    lastHistoryTrackedPathRef.current = currentPath
    if (!previousPath || previousPath === currentPath) return

    if (historyNavigationRef.current) {
      historyNavigationRef.current = false
      return
    }

    setPlaybackHistory((prev) => {
      const previousTrack = playlist.find((track) => track?.path === previousPath)
      const nextEntry = buildPlaybackHistoryEntry(
        previousTrack,
        trackMetaMapRef.current,
        Date.now()
      ) || {
        path: previousPath,
        title: '',
        artist: '',
        album: '',
        playedAt: Date.now()
      }
      const next = [...prev, nextEntry]
      return next.slice(-MAX_PLAYBACK_HISTORY)
    })
  }, [currentIndex, playlist, isPlaying])

  const toggleLike = useCallback((path) => {
    if (!path) return
    setLikedPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    )
  }, [])

  const enqueueUpNextTrack = useCallback((track) => {
    const path = track?.path
    if (!path) return { ok: false, reason: 'invalid_path' }
    let inserted = false
    setUpNextQueue((prev) => {
      if (prev.some((item) => item?.path === path)) return prev
      inserted = true
      return [...prev, { path }]
    })
    return inserted ? { ok: true } : { ok: false, reason: 'duplicate' }
  }, [])

  const enqueueUpNextTracks = useCallback((tracks) => {
    const validTracks = Array.isArray(tracks) ? tracks.filter((track) => track?.path) : []
    if (validTracks.length === 0) return { ok: false, reason: 'invalid_path' }

    let addedCount = 0
    setUpNextQueue((prev) => {
      const seen = new Set(prev.map((item) => item?.path).filter(Boolean))
      const next = [...prev]
      for (const track of validTracks) {
        if (seen.has(track.path)) continue
        seen.add(track.path)
        next.push({ path: track.path })
        addedCount += 1
      }
      return next
    })

    return addedCount > 0 ? { ok: true, addedCount } : { ok: false, reason: 'duplicate' }
  }, [])

  const removeTrackFromMainPlaylist = useCallback((path) => {
    const prev = playlistRef.current
    const ri = prev.findIndex((t) => t.path === path)
    if (ri === -1) return
    const next = prev.filter((t) => t.path !== path)
    const ci = currentIndexRef.current
    let newCi = ci
    if (next.length === 0) newCi = -1
    else if (ci === ri) newCi = Math.min(ri, next.length - 1)
    else if (ci > ri) newCi = ci - 1
    else newCi = ci
    setPlaylist(next)
    setUpNextQueue((prev) => prev.filter((item) => item?.path !== path))
    setPlaybackHistory((prev) => {
      const nextHistory = prev.filter((entry) => entry?.path !== path)
      playbackHistoryRef.current = nextHistory
      return nextHistory
    })
    setCurrentIndex(newCi)
    if (next.length === 0) setIsPlaying(false)
  }, [])

  const removeFromUpNextQueue = useCallback((path) => {
    if (!path) return
    setUpNextQueue((prev) => prev.filter((item) => item?.path !== path))
  }, [])

  const applyLibraryFolderDelta = useCallback((payload) => {
    const renamed = Array.isArray(payload?.renamed)
      ? payload.renamed.filter(
          (item) =>
            item &&
            typeof item.from === 'string' &&
            item.from &&
            typeof item.to === 'string' &&
            item.to
        )
      : []
    const removedPaths = Array.isArray(payload?.removedPaths)
      ? payload.removedPaths.filter((item) => typeof item === 'string' && item)
      : []
    const addedTracks = Array.isArray(payload?.added)
      ? payload.added.map(normalizeWatchedTrack).filter(Boolean)
      : []

    if (!renamed.length && !removedPaths.length && !addedTracks.length) return

    const pathMap = Object.fromEntries(renamed.map((item) => [item.from, item.to]))
    const removedSet = new Set(removedPaths)

    remapLyricsOverrides(pathMap, removedPaths)
    remapMvOverrides(pathMap, removedPaths)

    const nextTrackStats = remapTrackStatsEntries(trackStatsRef.current, pathMap, removedSet)
    trackStatsRef.current = nextTrackStats
    setTrackStats(nextTrackStats)

    const nextTrackMetaMap = remapTrackMetaEntries(trackMetaMapRef.current, pathMap, removedSet)
    trackMetaMapRef.current = nextTrackMetaMap
    setTrackMetaMap(nextTrackMetaMap)

    const nextDisplayMetadataOverrides = remapTrackMetaEntries(
      displayMetadataOverridesRef.current,
      pathMap,
      removedSet
    )
    displayMetadataOverridesRef.current = nextDisplayMetadataOverrides
    setDisplayMetadataOverrides(nextDisplayMetadataOverrides)

    const nextLikedPaths = remapPathList(likedPathsRef.current, pathMap, removedSet)
    likedPathsRef.current = nextLikedPaths
    setLikedPaths(nextLikedPaths)

    const nextUserPlaylists = (userPlaylistsRef.current || []).map((playlistItem) => ({
      ...playlistItem,
      paths: remapPathList(playlistItem?.paths || [], pathMap, removedSet)
    }))
    userPlaylistsRef.current = nextUserPlaylists
    setUserPlaylists(nextUserPlaylists)

    const nextUpNextQueue = remapQueueItems(upNextQueueRef.current, pathMap, removedSet)
    upNextQueueRef.current = nextUpNextQueue
    setUpNextQueue(nextUpNextQueue)

    const nextPlaybackHistory = remapPlaybackHistoryEntries(
      playbackHistoryRef.current,
      pathMap,
      removedSet
    )
    playbackHistoryRef.current = nextPlaybackHistory
    setPlaybackHistory(nextPlaybackHistory)

    const savedSession = playbackSessionSeedRef.current
    if (savedSession?.trackPath) {
      const mappedSessionPath = pathMap[savedSession.trackPath] || savedSession.trackPath
      playbackSessionSeedRef.current =
        !mappedSessionPath || removedSet.has(mappedSessionPath)
          ? null
          : {
              ...savedSession,
              trackPath: mappedSessionPath
            }
    }

    const previousPlaylist = playlistRef.current
    const previousCurrentIndex = currentIndexRef.current
    const previousCurrentPath = previousPlaylist[previousCurrentIndex]?.path || ''
    const nextPlaylist = []
    const seenPaths = new Set()

    for (const track of previousPlaylist) {
      const oldPath = track?.path
      if (!oldPath || removedSet.has(oldPath)) continue
      const nextPath = pathMap[oldPath] || oldPath
      if (!nextPath || removedSet.has(nextPath) || seenPaths.has(nextPath)) continue
      seenPaths.add(nextPath)
      nextPlaylist.push(withUpdatedTrackPath(track, nextPath))
    }

    for (const track of addedTracks) {
      if (!track?.path || seenPaths.has(track.path)) continue
      seenPaths.add(track.path)
      nextPlaylist.push(track)
    }

    let nextCurrentIndex = -1
    if (previousCurrentPath) {
      const preferredPath = removedSet.has(previousCurrentPath)
        ? pathMap[previousCurrentPath] || ''
        : pathMap[previousCurrentPath] || previousCurrentPath

      if (preferredPath) {
        nextCurrentIndex = nextPlaylist.findIndex((track) => track.path === preferredPath)
      }

      if (nextCurrentIndex === -1 && nextPlaylist.length > 0) {
        nextCurrentIndex = Math.min(previousCurrentIndex, nextPlaylist.length - 1)
      }
    }

    if (nextPlaylist.length === 0) {
      nextCurrentIndex = -1
    }

    playlistRef.current = nextPlaylist
    currentIndexRef.current = nextCurrentIndex
    setPlaylist(nextPlaylist)
    setCurrentIndex(nextCurrentIndex)

    if (previousCurrentPath && pathMap[previousCurrentPath]) {
      lastHistoryTrackedPathRef.current = pathMap[previousCurrentPath]
      if (lastStatsTrackedPathRef.current === previousCurrentPath) {
        lastStatsTrackedPathRef.current = pathMap[previousCurrentPath]
      }
    } else if (previousCurrentPath && removedSet.has(previousCurrentPath)) {
      lastHistoryTrackedPathRef.current = nextPlaylist[nextCurrentIndex]?.path || ''
      if (lastStatsTrackedPathRef.current === previousCurrentPath) {
        lastStatsTrackedPathRef.current = nextPlaylist[nextCurrentIndex]?.path || ''
      }
      setIsPlaying(false)
    }
  }, [])

  const scanMissingLibraryPaths = useCallback(async () => {
    if (!window.api?.batchExistsHandler) return []

    const referencedPaths = collectReferencedLibraryPaths({
      playlist: playlistRef.current,
      userPlaylists: userPlaylistsRef.current,
      likedPaths: likedPathsRef.current,
      playbackHistory: playbackHistoryRef.current,
      trackStats: trackStatsRef.current
    })

    if (!referencedPaths.length) {
      setMissingLibraryPaths([])
      return []
    }

    setLibraryCleanupBusy(true)
    try {
      const missing = []
      for (let i = 0; i < referencedPaths.length; i += 200) {
        const batch = referencedPaths.slice(i, i + 200)
        const result = await window.api.batchExistsHandler(batch)
        for (const path of batch) {
          if (result?.[path] === false) missing.push(path)
        }
      }
      setMissingLibraryPaths(missing)
      return missing
    } finally {
      setLibraryCleanupBusy(false)
    }
  }, [])

  const cleanupMissingLibraryPaths = useCallback(async () => {
    const missing = missingLibraryPaths.length
      ? missingLibraryPaths
      : await scanMissingLibraryPaths()
    if (!missing.length) return
    applyLibraryFolderDelta({ renamed: [], removedPaths: missing, added: [] })
    setMissingLibraryPaths([])
  }, [applyLibraryFolderDelta, missingLibraryPaths, scanMissingLibraryPaths])

  useEffect(() => {
    if (playlist.length === 0) {
      setUpNextQueue((prev) => (prev.length ? [] : prev))
      return
    }
    const pathSet = new Set(playlist.map((item) => item.path))
    setUpNextQueue((prev) => {
      const filtered = prev.filter((item) => item?.path && pathSet.has(item.path))
      return filtered.length === prev.length ? prev : filtered
    })
  }, [playlist])

  useEffect(() => {
    const loc = normalizeUiLocale(config.uiLocale)
    i18n.changeLanguage(loc)
    document.documentElement.lang = bcp47ForUiLocale(loc)
  }, [config.uiLocale])

  useEffect(() => {
    playlistStoreHydratedRef.current = true
    userPlaylistsStoreHydratedRef.current = true
    userSmartCollectionsStoreHydratedRef.current = true
    displayMetadataOverridesHydratedRef.current = true
    configStoreHydratedRef.current = true
    likedPathsStoreHydratedRef.current = true
    trackStatsStoreHydratedRef.current = true
    importedFoldersHydratedRef.current = true
    playModeStoreHydratedRef.current = true
    queuePlaybackStoreHydratedRef.current = true
    playbackHistoryStoreHydratedRef.current = true
    volumeStoreHydratedRef.current = true
    setLibraryStateReady(true)
  }, [])

  useEffect(() => {
    if (!libraryStateReady || startupExclusiveResetRef.current) return
    startupExclusiveResetRef.current = true
    setIsAudioExclusive(false)
    if (window.api?.setAudioExclusive) {
      void window.api.setAudioExclusive(false)
    }
    setConfig((prev) => (prev.audioExclusive === false ? prev : { ...prev, audioExclusive: false }))
  }, [libraryStateReady])

  useEffect(() => {
    const snapshotHistory = getInitialAppStateValue('playbackHistory')
    const localHistory = readStoredJson('nc_playback_history')
    const loadedHistory = snapshotHistory ?? localHistory
    if (containsLegacyPlaybackHistoryEntries(loadedHistory)) {
      console.info('[PlaybackHistory] Loaded legacy string[] history and upgraded it in memory')
    }
  }, [])

  useEffect(() => {
    if (!libraryStateReady || playbackSessionRestoreAttemptedRef.current) return
    playbackSessionRestoreAttemptedRef.current = true

    const savedSession = playbackSessionSeedRef.current
    if (!savedSession) {
      console.info('[PlaybackSession] No saved playback session to restore')
      setPlaybackSessionRestoreReady(true)
      return
    }

    const nextIndex = playlist.findIndex((track) => track?.path === savedSession.trackPath)
    if (nextIndex === -1) {
      console.warn(
        `[PlaybackSession] Saved track no longer exists, clearing session for ${savedSession.trackPath}`
      )
      playbackSessionSeedRef.current = null
      if (window.api?.appStateSet) {
        void window.api.appStateSet('playbackSession', null)
      }
      setPlaybackSessionRestoreReady(true)
      return
    }

    pendingTrackStartRef.current = savedSession
    setActivePlaybackContext(normalizePlaybackContext(savedSession.playbackContext))
    setCurrentTime(Math.max(0, savedSession.currentTimeSec || 0))
    setCurrentIndex(nextIndex)
    setIsPlaying(false)
    console.info(
      `[PlaybackSession] Restored paused session for ${savedSession.trackPath} at ${Math.max(
        0,
        savedSession.currentTimeSec || 0
      ).toFixed(2)}s`
    )
    setPlaybackSessionRestoreReady(true)
  }, [libraryStateReady, playlist])

  useEffect(() => {
    if (
      !config.devModeEnabled ||
      !config.devOpenDevToolsOnStartup ||
      !window.api?.dev?.openDevTools
    ) {
      return undefined
    }
    const id = window.setTimeout(() => {
      window.api.dev.openDevTools()
    }, 500)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const themeBackdropStyle = useMemo(() => {
    const raw =
      config.themeDynamicCoverColor && dynamicCoverTheme
        ? dynamicCoverTheme
        : config.theme === 'custom' && config.customColors
          ? config.customColors
          : PRESET_THEMES[config.theme]?.colors || PRESET_THEMES.minimal.colors
    return getAppThemeBackgroundStyle(raw, config.uiAccentBackgroundGlow !== false)
  }, [
    config.theme,
    config.customColors,
    config.uiAccentBackgroundGlow,
    config.themeDynamicCoverColor,
    dynamicCoverTheme
  ])

  const activeAccentHex = useMemo(() => {
    const raw =
      config.themeDynamicCoverColor && dynamicCoverTheme
        ? dynamicCoverTheme
        : config.theme === 'custom' && config.customColors
          ? config.customColors
          : PRESET_THEMES[config.theme]?.colors || PRESET_THEMES.minimal.colors
    return normalizeThemeColors(raw).accent1
  }, [config.theme, config.customColors, config.themeDynamicCoverColor, dynamicCoverTheme])

  const customThemePreviewBg = useMemo(() => {
    const c = normalizeThemeColors(config.customColors || PRESET_THEMES.minimal.colors)
    return `linear-gradient(135deg, ${c.accent1}, ${c.accent2}, ${c.accent3})`
  }, [config.customColors])

  const handleResetAllConfig = () => {
    if (confirm(t('settings.resetConfirm'))) {
      setConfig(DEFAULT_CONFIG)
      localStorage.removeItem('nc_config')
      localStorage.removeItem(STORED_VOLUME_KEY)
      setVolume(1)
    }
  }

  const handleResetThemeConfig = () => {
    if (!confirm(t('settings.resetThemeConfirm'))) return

    setConfig((prev) => ({
      ...prev,
      // Theme / appearance related settings only
      theme: DEFAULT_CONFIG.theme,
      customColors: DEFAULT_CONFIG.customColors,
      customBgPath: DEFAULT_CONFIG.customBgPath,
      customBgOpacity: DEFAULT_CONFIG.customBgOpacity,
      uiBgOpacity: DEFAULT_CONFIG.uiBgOpacity,
      uiBlur: DEFAULT_CONFIG.uiBlur,
      uiFontFamily: DEFAULT_CONFIG.uiFontFamily,
      uiCustomFontPath: DEFAULT_CONFIG.uiCustomFontPath,
      uiBaseFontSize: DEFAULT_CONFIG.uiBaseFontSize,
      uiRadiusScale: DEFAULT_CONFIG.uiRadiusScale,
      uiShadowIntensity: DEFAULT_CONFIG.uiShadowIntensity,
      uiSaturation: DEFAULT_CONFIG.uiSaturation,
      uiAccentBackgroundGlow: DEFAULT_CONFIG.uiAccentBackgroundGlow,
      playerCoverSize: DEFAULT_CONFIG.playerCoverSize
    }))
  }

  const pickUiCustomFont = useCallback(async () => {
    if (!window.api?.openFontFileHandler) return
    const path = await window.api.openFontFileHandler(configRef.current.uiLocale)
    if (!path) return
    setConfig((prev) => ({
      ...prev,
      uiFontFamily: 'custom',
      uiCustomFontPath: path
    }))
  }, [])

  useEffect(() => {
    schedulePersistedState('config', 'nc_config', config, configStoreHydratedRef.current)
  }, [config, schedulePersistedState])

  useEffect(() => {
    const root = document.documentElement

    let rawTheme = PRESET_THEMES.minimal.colors
    if (config.themeDynamicCoverColor && dynamicCoverTheme) {
      rawTheme = dynamicCoverTheme
    } else if (config.theme === 'custom' && config.customColors) {
      rawTheme = config.customColors
    } else if (PRESET_THEMES[config.theme]) {
      rawTheme = PRESET_THEMES[config.theme].colors
    }
    const activeTheme = normalizeThemeColors(rawTheme)

    root.style.setProperty('--bg-color', activeTheme.bgColor)
    root.style.setProperty('--bg-gradient-end', activeTheme.bgGradientEnd)
    root.style.setProperty('--bg-gradient-angle', `${activeTheme.bgGradientAngle}deg`)
    root.style.setProperty('--accent-pink', activeTheme.accent1)
    root.style.setProperty('--accent-blue', activeTheme.accent2)
    root.style.setProperty('--accent-mint', activeTheme.accent3)
    root.style.setProperty('--text-main', activeTheme.textMain)
    root.style.setProperty('--text-soft', activeTheme.textSoft)

    const faceId = 'echoes-ui-user-font-face'
    const faceCss = buildUiCustomFontFaceCss(config.uiCustomFontPath)
    let faceEl = document.getElementById(faceId)
    if (faceCss) {
      if (!faceEl) {
        faceEl = document.createElement('style')
        faceEl.id = faceId
        document.head.appendChild(faceEl)
      }
      faceEl.textContent = faceCss
    } else if (faceEl) {
      faceEl.remove()
    }
    root.style.setProperty('--font-family-main', getUiFontStack(config))

    const baseFs = config.uiBaseFontSize ?? 15
    root.style.fontSize = `${baseFs}px`
    const playerCoverSize = Math.max(180, Math.min(360, Number(config.playerCoverSize ?? 360)))
    root.style.setProperty('--player-cover-size', `${playerCoverSize}px`)

    const rs = config.uiRadiusScale ?? 1
    root.style.setProperty('--border-radius-lg', `${20 * rs}px`)
    root.style.setProperty('--border-radius-md', `${14 * rs}px`)
    root.style.setProperty('--border-radius-sm', `${8 * rs}px`)

    const uiOpa = config.uiBgOpacity !== undefined ? config.uiBgOpacity : 0.6
    const uiBlur = config.uiBlur !== undefined ? config.uiBlur : 20
    const glassRgbStr = hexToRgbStr(activeTheme.glassColor || '#ffffff')

    root.style.setProperty('--glass-bg', `rgba(${glassRgbStr}, ${uiOpa})`)
    root.style.setProperty('--glass-border', `rgba(${glassRgbStr}, ${Math.min(uiOpa + 0.2, 1)})`)
    root.style.setProperty('--glass-blur', `${uiBlur}px`)

    const lyricLegacyColor = config.lyricsFontColor
    if (typeof lyricLegacyColor === 'string' && lyricLegacyColor.trim()) {
      root.style.setProperty('--lyrics-user-color', lyricLegacyColor.trim())
    } else {
      root.style.removeProperty('--lyrics-user-color')
    }

    const setLyricVar = (name, v) => {
      if (v && typeof v.hex === 'string' && v.hex.trim()) {
        const a = typeof v.a === 'number' ? Math.min(1, Math.max(0, v.a)) : 1
        root.style.setProperty(name, hexToRgbaString(v.hex.trim(), a))
      } else {
        root.style.removeProperty(name)
      }
    }

    const lc = config.lyricsColor
    if (lc && typeof lc === 'object' && lc.layers && typeof lc.layers === 'object') {
      const layers = ['main', 'karaoke', 'romaji', 'translation']
      const states = ['active', 'normal']
      for (const layer of layers) {
        for (const st of states) {
          setLyricVar(`--lyrics-${layer}-${st}`, lc.layers?.[layer]?.[st] || null)
        }
      }
    } else {
      // Ensure old vars cleared when user resets panel.
      const layers = ['main', 'karaoke', 'romaji', 'translation']
      const states = ['active', 'normal']
      for (const layer of layers) {
        for (const st of states) root.style.removeProperty(`--lyrics-${layer}-${st}`)
      }
    }

    const isDark =
      activeTheme.glassColor !== '#ffffff' &&
      parseInt(String(glassRgbStr).split(',')[0].trim(), 10) < 100
    const shadowMul = config.uiShadowIntensity ?? 1
    const baseA = isDark ? 0.4 : 0.2
    root.style.setProperty(
      '--shadow-color',
      isDark
        ? `rgba(0, 0, 0, ${Math.min(0.62, baseA * shadowMul)})`
        : `rgba(200, 180, 190, ${Math.min(0.42, baseA * shadowMul)})`
    )

    root.style.setProperty(
      '--surface-elevated',
      isDark ? 'rgba(255, 255, 255, 0.085)' : 'rgba(255, 255, 255, 0.45)'
    )

    const sat = config.uiSaturation ?? 1
    root.style.filter = sat !== 1 && sat > 0 ? `saturate(${sat})` : ''
  }, [config, dynamicCoverTheme])

  const audioRef = useRef(new Audio())
  const listenTogetherSyncRef = useRef({
    trackId: '',
    streamUrl: '',
    isPlaying: null,
    lastSeekAt: 0
  })
  const playbackRateRef = useRef(playbackRate)

  // Web Audio Refs
  const audioContext = useRef(null)
  const sourceNode = useRef(null)
  const analyserNode = useRef(null)
  const gainNode = useRef(null)
  const preampNode = useRef(null)
  const eqFilters = useRef([])
  const canvasRef = useRef(null)
  const visualizerGradientRef = useRef({ key: '', gradient: null })
  const animationRef = useRef(null)

  // Initialize Web Audio
  const initAudioContext = useCallback(() => {
    if (audioContext.current) return

    const Context = window.AudioContext || window.webkitAudioContext
    const ctx = new Context()
    audioContext.current = ctx

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024 // 512 bins; lighter CPU, still enough for RTA / main visualizer
    analyser.smoothingTimeConstant = 0.72 // More responsive for mini waveform / visualizer
    analyserNode.current = analyser

    const gain = ctx.createGain()
    gainNode.current = gain

    const preamp = ctx.createGain()
    preamp.gain.value = Math.pow(10, (config.preamp || 0) / 20)
    preampNode.current = preamp

    // Create Parametric EQ chain
    const filters = config.eqBands.map((band) => {
      const filter = ctx.createBiquadFilter()
      filter.type = band.type
      filter.frequency.value = band.freq
      filter.Q.value = clampBiquadQ(band.type, band.q)
      filter.gain.value = config.useEQ && band.enabled ? band.gain : 0
      return filter
    })
    eqFilters.current = filters

    const source = ctx.createMediaElementSource(audioRef.current)
    sourceNode.current = source

    // Connect chain: Source -> Preamp -> EQ... -> Analyser -> Gain -> Destination
    source.connect(preamp)
    let lastNode = preamp
    filters.forEach((f) => {
      lastNode.connect(f)
      lastNode = f
    })

    lastNode.connect(analyser)
    analyser.connect(gain)
    gain.connect(ctx.destination)

    if (useNativeEngineRef.current) {
      gain.gain.value = 0
    }
  }, [config.useEQ, config.eqBands, config.preamp])

  useEffect(() => {
    // Update EQ Filters in real-time
    const now = audioContext.current?.currentTime || 0
    if (preampNode.current) {
      preampNode.current.gain.setTargetAtTime(Math.pow(10, (config.preamp || 0) / 20), now, 0.05)
    }
    if (eqFilters.current.length > 0 && eqFilters.current.length === config.eqBands.length) {
      eqFilters.current.forEach((filter, i) => {
        const band = config.eqBands[i]
        if (filter.type !== band.type) filter.type = band.type
        filter.frequency.setTargetAtTime(band.freq, now, 0.05)
        filter.Q.setTargetAtTime(clampBiquadQ(band.type, band.q), now, 0.05)
        filter.gain.setTargetAtTime(config.useEQ && band.enabled ? band.gain : 0, now, 0.05)
      })
    }
  }, [config.eqBands, config.useEQ, config.preamp])

  useEffect(() => {
    const ctx = audioContext.current
    const preamp = preampNode.current
    const analyser = analyserNode.current
    if (!ctx || !preamp || !analyser || !sourceNode.current) return

    const bands = configRef.current.eqBands
    if (eqFilters.current.length === bands.length) return

    preamp.disconnect()
    for (const f of eqFilters.current) {
      try {
        f.disconnect()
      } catch {
        /* node may already be GC'd */
      }
    }

    const useEQ = configRef.current.useEQ
    const filters = bands.map((band) => {
      const filter = ctx.createBiquadFilter()
      filter.type = band.type
      filter.frequency.value = band.freq
      filter.Q.value = clampBiquadQ(band.type, band.q)
      filter.gain.value = useEQ && band.enabled ? band.gain : 0
      return filter
    })
    eqFilters.current = filters

    let lastNode = preamp
    filters.forEach((f) => {
      lastNode.connect(f)
      lastNode = f
    })
    lastNode.connect(analyser)
  }, [config.eqBands.length])

  useEffect(() => {
    const p = config.audioOutputBufferProfile
    if (!p || !window.api?.setAudioOutputBufferProfile) return
    void window.api.setAudioOutputBufferProfile(p)
  }, [config.audioOutputBufferProfile])

  useEffect(() => {
    if (!window.api?.setAudioExclusive) return
    void window.api.setAudioExclusive(config.audioExclusive === true)
  }, [config.audioExclusive])

  useEffect(() => {
    if (!window.api?.setAudioDevice) return
    const savedDeviceId = config.audioDeviceId
    if (savedDeviceId == null || savedDeviceId === '') {
      void window.api.setAudioDevice('')
      return
    }
    if (!Array.isArray(audioDevices) || audioDevices.length === 0) return
    const matched = audioDevices.find((device) => String(device?.id) === String(savedDeviceId))
    if (!matched) return
    void window.api.setAudioDevice(matched.id)
  }, [config.audioDeviceId, audioDevices])

  // Persist playlist and mode
  useEffect(() => {
    schedulePersistedState(
      'playlist',
      'nc_playlist',
      playlist,
      config.autoSaveLibrary !== false && playlistStoreHydratedRef.current
    )
  }, [playlist, config.autoSaveLibrary, schedulePersistedState])

  useEffect(() => {
    localStorage.setItem('nc_queue_playback_enabled', queuePlaybackEnabled ? '1' : '0')
    if (
      config.autoSaveLibrary !== false &&
      queuePlaybackStoreHydratedRef.current &&
      window.api?.appStateSet
    ) {
      void window.api.appStateSet('queuePlaybackEnabled', !!queuePlaybackEnabled)
    }
  }, [queuePlaybackEnabled, config.autoSaveLibrary])

  useEffect(() => {
    localStorage.setItem('nc_playmode', playMode)
    if (
      config.autoSaveLibrary !== false &&
      playModeStoreHydratedRef.current &&
      window.api?.appStateSet
    ) {
      void window.api.appStateSet('playMode', playMode)
    }
  }, [playMode, config.autoSaveLibrary])

  useEffect(() => {
    localStorage.setItem(STORED_VOLUME_KEY, String(clampVolume(volume)))
    if (volumeStoreHydratedRef.current && window.api?.appStateSet) {
      void window.api.appStateSet('volume', clampVolume(volume))
    }
  }, [volume])

  useEffect(() => {
    schedulePersistedState(
      'playbackHistory',
      'nc_playback_history',
      playbackHistory,
      playbackHistoryStoreHydratedRef.current
    )
  }, [playbackHistory, schedulePersistedState])

  useEffect(() => {
    schedulePersistedState(
      'userPlaylists',
      'nc_user_playlists',
      userPlaylists,
      config.autoSaveLibrary !== false && userPlaylistsStoreHydratedRef.current
    )
  }, [userPlaylists, config.autoSaveLibrary, schedulePersistedState])

  useEffect(() => {
    schedulePersistedState(
      'userSmartCollections',
      USER_SMART_COLLECTIONS_LOCAL_KEY,
      userSmartCollections,
      config.autoSaveLibrary !== false && userSmartCollectionsStoreHydratedRef.current
    )
  }, [userSmartCollections, config.autoSaveLibrary, schedulePersistedState])

  useEffect(() => {
    schedulePersistedState(
      'displayMetadataOverrides',
      DISPLAY_METADATA_OVERRIDES_LOCAL_KEY,
      displayMetadataOverrides,
      config.autoSaveLibrary !== false && displayMetadataOverridesHydratedRef.current
    )
  }, [displayMetadataOverrides, config.autoSaveLibrary, schedulePersistedState])

  // Persist imported folders
  useEffect(() => {
    schedulePersistedState(
      'importedFolders',
      'nc_imported_folders',
      importedFolders,
      importedFoldersHydratedRef.current
    )
  }, [importedFolders, schedulePersistedState])

  useEffect(() => {
    if (!libraryStateReady || !playbackSessionRestoreReady) return
    persistPlaybackSession(getPlaybackSessionSnapshot(), true)
  }, [
    currentIndex,
    playlist,
    activePlaybackContext,
    libraryStateReady,
    playbackSessionRestoreReady,
    getPlaybackSessionSnapshot,
    persistPlaybackSession
  ])

  useEffect(() => {
    if (!libraryStateReady || !playbackSessionRestoreReady || isSeeking || currentIndex < 0) return
    persistPlaybackSession(getPlaybackSessionSnapshot(), true)
  }, [
    Math.floor(Math.max(0, currentTime)),
    isPlaying,
    isSeeking,
    currentIndex,
    libraryStateReady,
    playbackSessionRestoreReady,
    getPlaybackSessionSnapshot,
    persistPlaybackSession
  ])

  useEffect(() => {
    if (!libraryStateReady || !playbackSessionRestoreReady || isSeeking || currentIndex < 0) return
    persistPlaybackSession(getPlaybackSessionSnapshot(), true)
  }, [
    isSeeking,
    currentIndex,
    libraryStateReady,
    playbackSessionRestoreReady,
    getPlaybackSessionSnapshot,
    persistPlaybackSession
  ])

  useEffect(() => {
    if (!window.api?.onLibraryFoldersChanged) return undefined
    return window.api.onLibraryFoldersChanged((payload) => {
      applyLibraryFolderDelta(payload)
    })
  }, [applyLibraryFolderDelta])

  useEffect(() => {
    if (!window.api?.watchLibraryFolders || !window.api?.stopWatchingLibraryFolders)
      return undefined
    if (!importedFolders.length) {
      void window.api.stopWatchingLibraryFolders().catch(() => {})
      return undefined
    }

    let disposed = false
    window.api.watchLibraryFolders({ folders: importedFolders }).catch((error) => {
      if (!disposed) {
        console.error('Library watch start failed:', error)
      }
    })

    return () => {
      disposed = true
      void window.api.stopWatchingLibraryFolders().catch(() => {})
    }
  }, [importedFolders])

  // Auto-rescan imported folders on startup to discover new files
  useEffect(() => {
    if (!libraryStateReady || !importedFolders.length || !window.api?.rescanFolders) return
    let cancelled = false
    const doRescan = async () => {
      try {
        const scannedTracks = await window.api.rescanFolders({ folders: importedFolders })
        if (cancelled || !Array.isArray(scannedTracks)) return

        const previousImportedTracks = playlistRef.current.filter((track) =>
          isTrackInsideImportedFolders(track?.path, importedFolders)
        )
        const delta = diffImportedFolderSnapshot(
          previousImportedTracks,
          scannedTracks.map(normalizeWatchedTrack).filter(Boolean)
        )

        if (delta.renamed.length || delta.removedPaths.length || delta.added.length) {
          applyLibraryFolderDelta(delta)
        }
      } catch (e) {
        console.error('Folder rescan failed:', e)
      }
    }
    doRescan()
    return () => {
      cancelled = true
    }
  }, [libraryStateReady, importedFolders, applyLibraryFolderDelta])

  // Update playback speed whenever it changes
  useEffect(() => {
    playbackRateRef.current = playbackRate
    if (useNativeEngineRef.current) {
      window.api?.setAudioPlaybackRate?.(playbackRate)
    } else if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate
    }
  }, [playbackRate])

  // Update volume — HTML audio / gain node (no IPC)
  useEffect(() => {
    if (useNativeEngineRef.current) {
      // Native mode: HTML audio at full volume so Web Audio analyser gets data,
      // but mute the final gain node so no sound comes from the Web Audio pipeline.
      if (audioRef.current) audioRef.current.volume = 1
      if (gainNode.current) gainNode.current.gain.value = 0
    } else {
      if (audioRef.current) {
        audioRef.current.volume = volume
      }
      if (gainNode.current) gainNode.current.gain.value = 1
    }
  }, [volume, useNativeEngine])

  // Native engine volume via main process (rAF while dragging to reduce IPC flood)
  useEffect(() => {
    if (!useNativeEngineRef.current || !window.api?.setAudioVolume) return
    if (!isVolumeDragging) {
      window.api.setAudioVolume(volume)
      return
    }
    const id = requestAnimationFrame(() => {
      window.api.setAudioVolume(volume)
    })
    return () => cancelAnimationFrame(id)
  }, [volume, useNativeEngine, isVolumeDragging])

  // Keep main-process HiFi EQ in sync (PCM DSP on native bridge path)
  useEffect(() => {
    if (!window.api?.setAudioEqConfig) return
    void window.api.setAudioEqConfig({
      useEQ: config.useEQ,
      preamp: config.preamp ?? 0,
      eqBands: config.eqBands
    })
  }, [config.useEQ, config.preamp, config.eqBands])

  const handleTrackEndedAdvance = useCallback(() => {
    const libraryPaths = getLibraryPlaybackPaths()
    if (libraryPaths.length === 0) return

    if (queuePlaybackEnabled) {
      const queueSnapshot = upNextQueueRef.current
      if (queueSnapshot.length > 0) {
        let nextPath = null
        const remaining = []
        for (const item of queueSnapshot) {
          const path = item?.path
          if (typeof path !== 'string' || !path) continue
          const exists = playlistRef.current.some((track) => track.path === path)
          if (!exists) continue
          if (!nextPath) nextPath = path
          else remaining.push({ path })
        }
        if (nextPath) {
          const nextIdx = playlistRef.current.findIndex((track) => track.path === nextPath)
          setUpNextQueue(remaining)
          if (nextIdx !== -1) {
            setCurrentIndex(nextIdx)
            setIsPlaying(true)
            return
          }
        }
      }
    }

    if (playMode === 'single') {
      setCurrentTime(0)

      if (useNativeEngineRef.current && window.api?.playAudio) {
        const trackPath = playlistRef.current[currentIndexRef.current]?.path
        if (trackPath) {
          window.api.playAudio(trackPath, 0, playbackRateRef.current).catch(console.error)
          setIsPlaying(true)
          return
        }
      }

      const audio = audioRef.current
      if (audio) {
        audio.currentTime = 0
        audio.play().catch(console.error)
        setIsPlaying(true)
        return
      }
    }

    if (playMode === 'shuffle') {
      const { currentPath, paths } = getPlaybackSequenceSnapshot()
      if (paths.length === 0) return
      let nextPath = paths[Math.floor(Math.random() * paths.length)]
      if (nextPath === currentPath && paths.length > 1) {
        const currentSeqIndex = paths.indexOf(currentPath)
        nextPath = paths[(currentSeqIndex + 1 + paths.length) % paths.length]
      }
      const nextIdx = playlistRef.current.findIndex((track) => track.path === nextPath)
      if (nextIdx === -1) return
      setCurrentIndex(nextIdx)
    } else {
      const { currentSeqIndex, paths } = getPlaybackSequenceSnapshot()
      if (paths.length === 0) return
      const baseIndex = currentSeqIndex >= 0 ? currentSeqIndex : 0
      const nextPath = paths[(baseIndex + 1) % paths.length]
      const nextIdx = playlistRef.current.findIndex((track) => track.path === nextPath)
      if (nextIdx === -1) return
      setCurrentIndex(nextIdx)
    }
    setIsPlaying(true)
  }, [queuePlaybackEnabled, playMode, getLibraryPlaybackPaths, getPlaybackSequenceSnapshot])

  // Audio setup
  useEffect(() => {
    const audio = audioRef.current
    audio.preservesPitch = false // THE MAGIC: disabling pitch preservation!

    const setAudioData = () => {
      const track = playlist[currentIndex]
      const path = track?.path || ''
      const dsdLocal = useNativeEngineRef.current && path && /\.(dsf|dff)$/i.test(path)
      // Browser cannot decode DSD; audio.duration is bogus — duration comes from main (ffprobe).
      if (!dsdLocal) {
        setDuration(audio.duration)
      }
      audio.playbackRate = playbackRateRef.current // Preserves NC speed naturally!
    }
    const updateTime = () => {
      if (useNativeEngineRef.current) return
      if (isSeekingRef.current) return
      const time = audio.currentTime
      setCurrentTime(time)

      if (lyricsRef.current.length > 0) {
        const offsetSec = (configRef.current.lyricsOffsetMs ?? 0) / 1000
        let index = -1
        for (let i = 0; i < lyricsRef.current.length; i++) {
          if (time + 1e-9 >= lyricsRef.current[i].time + offsetSec) {
            index = i
          } else {
            break
          }
        }
        setActiveLyricIndex(index)
      }
    }
    const onEnded = () => {
      if (useNativeEngineRef.current) return
      handleTrackEndedAdvance()
    }

    audio.addEventListener('loadeddata', setAudioData)
    audio.addEventListener('timeupdate', updateTime)
    audio.addEventListener('ended', onEnded)

    return () => {
      audio.removeEventListener('loadeddata', setAudioData)
      audio.removeEventListener('timeupdate', updateTime)
      audio.removeEventListener('ended', onEnded)
    }
  }, [playlist, currentIndex, handleTrackEndedAdvance])
  // Play track logic
  useEffect(() => {
    if (currentIndex >= 0 && playlist[currentIndex]) {
      const track = playlist[currentIndex]
      const pendingSession = pendingTrackStartRef.current
      const restoreStartTime =
        pendingSession?.trackPath === track.path
          ? Math.max(0, Number(pendingSession.currentTimeSec) || 0)
          : lastLoadedTrackPathRef.current === track.path
            ? Math.max(0, Number(currentTimeRef.current) || 0)
            : 0

      const applyStartTimeToAudio = (audio, nextTime) => {
        if (!audio || !(nextTime > 0)) return
        const apply = () => {
          try {
            if (Math.abs((audio.currentTime || 0) - nextTime) > 0.25) {
              audio.currentTime = nextTime
            }
          } catch {
            /* ignore */
          }
        }
        if (audio.readyState >= 1) {
          apply()
          return
        }
        const once = () => {
          audio.removeEventListener('loadedmetadata', once)
          audio.removeEventListener('loadeddata', once)
          apply()
        }
        audio.addEventListener('loadedmetadata', once)
        audio.addEventListener('loadeddata', once)
      }

      if (useNativeEngineRef.current && window.api?.playAudio) {
        const now = Date.now()
        const d = nativePlayDedupeRef.current
        if (d.path === track.path && d.index === currentIndex && now - d.t < 120) {
          loadTrackData(track.path, {
            mvOriginUrl: track.mvOriginUrl,
            hasLyrics: track.hasLyrics === true
          })
          return
        }
        d.path = track.path
        d.index = currentIndex
        d.t = now
        audioRef.current.src = localPathToAudioSrc(track.path)
        audioRef.current.load()
        applyStartTimeToAudio(audioRef.current, restoreStartTime)
        // Important: do NOT start native playback when UI is paused.
        // Otherwise a state refresh (e.g. after window resize/background) can restart from 0
        // while the play button still shows "paused".
        if (isPlaying) {
          audioRef.current.play().catch(() => {})
          nativePlayJustCalledRef.current = true
          window.api
            .playAudio(track.path, restoreStartTime, playbackRateRef.current)
            .catch((e) => console.error('[App] Native playAudio failed:', e))
        } else {
          nativePlayJustCalledRef.current = false
          audioRef.current.pause()
          // Ensure native engine is not accidentally left playing.
          window.api.pauseAudio?.()
        }
      } else {
        // Legacy path: play through HTML <audio> element
        audioRef.current.src = localPathToAudioSrc(track.path)
        audioRef.current.load()
        applyStartTimeToAudio(audioRef.current, restoreStartTime)
        if (isPlaying) {
          audioRef.current.play().catch(console.error)
        }
      }

      if (pendingSession?.trackPath === track.path) {
        pendingTrackStartRef.current = null
        setCurrentTime(restoreStartTime)
      }
      lastLoadedTrackPathRef.current = track.path

      // Load cover art & Metadata & Lyrics
      loadTrackData(track.path, {
        mvOriginUrl: track.mvOriginUrl,
        hasLyrics: track.hasLyrics === true
      })
    }
  }, [currentIndex, isPlaying, playlist])

  useEffect(() => {
    if (window.api?.getAudioDevices) {
      window.api.getAudioDevices().then(setAudioDevices)
    }
  }, [])

  // Detect if native HiFi engine is available via first status update
  useEffect(() => {
    if (!window.api?.onAudioStatus) return
    let detected = false
    return window.api.onAudioStatus((status) => {
      if (detected) return
      if (status && typeof status.nativeBridge === 'boolean') {
        detected = true
        setUseNativeEngine(status.nativeBridge)
        useNativeEngineRef.current = status.nativeBridge
        if (status.nativeBridge) {
          console.log('[App] HiFi native engine detected, switching playback path')
        }
      }
    })
  }, [])

  useEffect(() => {
    if (!window.api?.cast?.onPauseLocal) return
    return window.api.cast.onPauseLocal(() => {
      setIsPlaying(false)
      if (audioRef.current) audioRef.current.pause()
    })
  }, [])

  useEffect(() => {
    if (window.api?.cast?.getStatus) {
      window.api.cast.getStatus().then((s) => {
        setLastCastStatus(s)
        setCastDlnaListening(!!s.dlnaEnabled)
        const dlnaActive =
          s.dlnaEnabled &&
          (s.transportState === 'PLAYING' || s.transportState === 'PAUSED_PLAYBACK')
        setCastRemoteActive(dlnaActive)
      })
    }
  }, [])

  useEffect(() => {
    if (!window.api?.cast?.onStatus) return
    return window.api.cast.onStatus((s) => {
      setLastCastStatus(s)
      setCastDlnaListening(!!s.dlnaEnabled)
      const dlnaActive =
        s.dlnaEnabled && (s.transportState === 'PLAYING' || s.transportState === 'PAUSED_PLAYBACK')
      setCastRemoteActive(dlnaActive)
    })
  }, [])

  useEffect(() => {
    if (!castRemoteActive || !window.api?.setAudioVolume) return
    window.api.setAudioVolume(volume)
  }, [volume, castRemoteActive])

  // Hi-Fi Native Audio Status Listener
  useEffect(() => {
    if (!window.api?.onAudioStatus) return
    let lastExclusive = false
    return window.api.onAudioStatus((status) => {
      if (!status) return
      if (status.exclusive !== lastExclusive) {
        lastExclusive = !!status.exclusive
        setIsAudioExclusive(!!status.exclusive)
        setConfig((prev) =>
          prev.audioExclusive === !!status.exclusive
            ? prev
            : { ...prev, audioExclusive: !!status.exclusive }
        )
      }
      if (!status.nativeBridge) return
      if (isSeekingRef.current) return

      if (status.filePath === playlist[currentIndex]?.path) {
        setCurrentTime(status.currentTime)

        // Keep HTML audio element in sync with native engine position
        // so waveform analyser, MV sync, and lyrics all read correct time
        const audio = audioRef.current
        if (audio && Math.abs((audio.currentTime || 0) - status.currentTime) > 0.5) {
          try {
            audio.currentTime = status.currentTime
          } catch {
            /* ignore */
          }
        }

        if (lyricsRef.current.length > 0) {
          const offsetSec = (configRef.current.lyricsOffsetMs ?? 0) / 1000
          const t = status.currentTime
          let index = -1
          for (let i = 0; i < lyricsRef.current.length; i++) {
            if (t + 1e-9 >= lyricsRef.current[i].time + offsetSec) {
              index = i
            } else {
              break
            }
          }
          setActiveLyricIndex(index)
        }
      }
    })
  }, [currentIndex, playlist])

  useEffect(() => {
    if (useNativeEngineRef.current && window.api) {
      if (isPlaying) {
        initAudioContext()
        if (audioContext.current?.state === 'suspended') {
          audioContext.current.resume()
        }
        // Keep HTML audio playing for waveform analyser + MV sync
        // (gainNode is muted so no double audio; actual sound from native engine)
        audioRef.current.play().catch(() => {})
        if (nativePlayJustCalledRef.current) {
          nativePlayJustCalledRef.current = false
        } else {
          window.api.resumeAudio?.()
        }
      } else {
        nativePlayJustCalledRef.current = false
        audioRef.current.pause()
        window.api.pauseAudio?.()
      }
    } else {
      if (isPlaying) {
        initAudioContext()
        if (audioContext.current?.state === 'suspended') {
          audioContext.current.resume()
        }
        audioRef.current.play().catch(console.error)
      } else {
        audioRef.current.pause()
      }
    }
  }, [isPlaying, initAudioContext])

  const lyricsRef = useRef([])
  const lyricsRequestSeqRef = useRef(0)
  const scrollAreaRef = useRef(null)
  const sidebarPlaylistRef = useRef(null)
  const previousSongSortModeRef = useRef(songSortMode)
  const previousFolderSortModeRef = useRef(folderSortMode)

  useEffect(() => {
    lyricsRef.current = lyrics
  }, [lyrics])

  useEffect(() => {
    if (showLyrics && !config.lyricsHidden && activeLyricIndex !== -1 && scrollAreaRef.current) {
      const activeElement = scrollAreaRef.current.querySelector('.lyric-line.active')
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [activeLyricIndex, showLyrics, config.lyricsHidden])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || lyricsRef.current.length === 0) return
    const time = audio.currentTime
    const offsetSec = (config.lyricsOffsetMs ?? 0) / 1000
    let index = -1
    for (let i = 0; i < lyricsRef.current.length; i++) {
      if (time + 1e-9 >= lyricsRef.current[i].time + offsetSec) index = i
      else break
    }
    setActiveLyricIndex(index)
  }, [config.lyricsOffsetMs])

  useEffect(() => {
    if (!config.lyricsShowRomaji) {
      setRomajiDisplayLines([])
      return
    }
    let cancelled = false
    ;(async () => {
      if (!lyrics.length) {
        setRomajiDisplayLines([])
        return
      }
      const merged = new Array(lyrics.length).fill('')
      const batch = []
      const batchLineIdx = []
      lyrics.forEach((l, i) => {
        if (l.romaji) {
          merged[i] = (l.romaji || '').trim()
          return
        }
        const lineText = (l.text || '').trim()
        const none = i18n.t('lyrics.none')
        if (!lineText || lineText === none) return
        batch.push(lineText)
        batchLineIdx.push(i)
      })
      if (batch.length > 0 && window.api?.toRomajiBatch) {
        try {
          const converted = await window.api.toRomajiBatch(batch)
          batchLineIdx.forEach((lineIdx, j) => {
            merged[lineIdx] = ((converted && converted[j]) || '').trim()
          })
        } catch (e) {
          console.error('toRomajiBatch', e)
        }
      }
      if (!cancelled) setRomajiDisplayLines(merged)
    })()
    return () => {
      cancelled = true
    }
  }, [lyrics, config.lyricsShowRomaji, config.uiLocale])

  const cleanTitleForSearch = (rawTitle = '') => {
    if (!rawTitle) return ''
    let s = rawTitle
    s = s.replace(/【[^】]*】/g, ' ')
    s = s.replace(/〖[^〗]*〗/g, ' ')
    // Remove common noise words (cover, 翻唱, remix, live, ver., version, ft., feat.)
    s = s.replace(/\(.*?翻唱.*?\)|（.*?翻唱.*?）/gi, '')
    s = s.replace(/\bcover\b/gi, '')
    s = s.replace(/翻唱/gi, '')
    s = s.replace(/\bremix\b/gi, '')
    s = s.replace(/\blive\b/gi, '')
    s = s.replace(/\bver\.?\b/gi, '')
    s = s.replace(/\bversion\b/gi, '')
    s = s.replace(/\bfeat\.?\b/gi, '')
    s = s.replace(/\bft\.?\b/gi, '')
    // Remove bracketed translator/arranger notes
    s = s.replace(/\[.*?\]/g, '')
    s = s.replace(/[《》]/g, ' ')
    s = s.replace(/\(.*?\)/g, '')
    // Collapse extra spaces and punctuation
    s = s.replace(/[~`"'·、，。]/g, ' ')
    s = s.replace(/\s+/g, ' ').trim()
    return s
  }

  /** B站/转载常见《真歌名》；优先用于歌词检索 */
  const extractBookTitleQuotes = (rawTitle = '') => {
    const out = []
    const re = /《([^》]+)》/g
    let m
    while ((m = re.exec(rawTitle)) !== null) {
      const inner = (m[1] || '').trim()
      if (inner && inner.length <= 120) out.push(inner)
    }
    return out
  }

  const extractCornerQuotes = (rawTitle = '') => {
    const out = []
    const re = /「([^」]+)」/g
    let m
    while ((m = re.exec(rawTitle)) !== null) {
      const inner = (m[1] || '').trim()
      if (inner && inner.length <= 120) out.push(inner)
    }
    return out
  }

  /** 嵌入标签里常见「Vtuber/翻唱」；搜原曲前应 stripped */
  const cleanArtistForLyrics = (raw = '') => {
    let s = (raw || '').trim()
    if (!s) return ''
    s = s.replace(/\s*\/\s*翻唱\s*/gi, ' ')
    s = s.replace(/\/\s*翻唱/gi, '')
    s = s.replace(/翻唱\s*\//gi, '')
    s = s.replace(/翻唱/g, '')
    s = s.replace(/\//g, ' ')
    s = s.replace(/\s+/g, ' ').trim()
    return s
  }

  const buildLyricTitleVariants = (rawTitle = '') => {
    const seen = new Set()
    const list = []
    const add = (candidate) => {
      const cleaned = (cleanTitleForSearch(candidate) || candidate || '').trim()
      if (!cleaned || seen.has(cleaned)) return
      seen.add(cleaned)
      list.push(cleaned)
    }
    const rt = (rawTitle || '').trim()
    if (!rt) return list
    for (const q of extractBookTitleQuotes(rt)) add(q)
    for (const q of extractCornerQuotes(rt)) add(q)
    add(rt)
    return list
  }

  /** 半角/全角括号内常为原唱、本家名；翻唱上传者会误导 LRCLIB，优先用这些提示 */
  const extractParenArtistHints = (rawTitle = '') => {
    if (!rawTitle) return []
    const seen = new Set()
    const out = []
    const re = /\(([^)]+)\)|（([^）]+)）/g
    let m
    while ((m = re.exec(rawTitle)) !== null) {
      const inner = (m[1] || m[2] || '').trim()
      if (!inner || inner.length > 80) continue
      if (
        /TV|サイズ|\bsize\b|instrumental|\binst\.?\b|カラオケ|off\s*vocal|伴奏|ver\.|バージョン|翻唱|cover|カバー|\bMV\b|mv\b/i.test(
          inner
        )
      ) {
        continue
      }
      const key = inner.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(inner)
    }
    return out
  }

  const searchBilibiliMv = useCallback(async (title = '', artist = '') => {
    if (!window.api?.searchMVHandler) return null

    const safeTitle = cleanTitleForSearch(title || '')
    const safeArtist = (artist || '').trim()
    const queries = [
      safeArtist ? `${safeTitle} ${safeArtist} MV` : `${safeTitle} MV`,
      safeArtist ? `${safeTitle} ${safeArtist} 官方` : `${safeTitle} 官方MV`,
      `${safeTitle} ${safeArtist}`.trim(),
      safeTitle
    ].filter((q) => q && q.trim())

    for (const q of queries) {
      try {
        const result = await window.api.searchMVHandler(q.trim(), 'bilibili')
        if (result) {
          const id = typeof result === 'string' ? result : result.id
          if (id) return id
        }
      } catch (_) {
        // try next query
      }
    }

    return null
  }, [])

  const retryFetchLyrics = async () => {
    const track = playlist[currentIndex]
    if (!track) return
    clearLyricsOverrideForPath(track.path)
    const metaTitle = metadata.title || (track ? stripExtension(track.name) : '')
    const metaArtist = metadata.artist || track?.info?.artist || ''
    const cleaned = cleanTitleForSearch(metaTitle)
    try {
      await fetchLyrics(track.path, cleaned || metaTitle, metaArtist, {
        album: track.info?.album || '',
        embeddedLyrics: track.info?.lyrics || null,
        mvOriginUrl: track.mvOriginUrl
      })
    } catch (e) {
      console.error('Retry fetchLyrics error', e)
    }
  }

  const fetchLyricsFromSourceLink = async () => {
    const link = (configRef.current.lyricsSourceLink || '').trim()
    if (!link) return
    setLyrics([])
    setActiveLyricIndex(-1)
    setLyricsMatchStatus('loading')
    setLyricsSourceStatus({ kind: 'loading', detail: '', origin: '' })
    try {
      if (await tryApplyLyricsBySourceLink(link)) return
    } catch (e) {
      console.warn('[lyrics] manual source link fetch failed:', e?.message || e)
    }
    setLyrics([{ time: 0, text: i18n.t('lyrics.none') }])
    setLyricsMatchStatus('none')
    setLyricsSourceStatus({ kind: 'none', detail: '', origin: '' })
  }

  const applyLyricsFromText = useCallback((raw, sourceMeta = {}) => {
    const parsed = parseAnyLyrics(raw)
    if (parsed.length > 0) {
      setLyrics(parsed)
      setLyricsMatchStatus('matched')
      setActiveLyricIndex(-1)
      setLyricsSourceStatus({
        kind: 'manual',
        detail: '',
        origin: typeof sourceMeta.origin === 'string' ? sourceMeta.origin : ''
      })
      const path = playlistRef.current[currentIndexRef.current]?.path
      if (path && typeof raw === 'string' && raw.trim()) {
        setLyricsOverrideForPath(path, raw, {
          source: 'manual',
          origin: typeof sourceMeta.origin === 'string' ? sourceMeta.origin : ''
        })
      }
    }
  }, [])

  const pickLyricsFileNative = useCallback(async () => {
    if (!window.api?.openLyricsFileHandler || !window.api?.readBufferHandler) return
    const path = await window.api.openLyricsFileHandler(configRef.current.uiLocale)
    if (!path) return
    const buf = await window.api.readBufferHandler(path)
    if (!buf) return
    let u8
    if (buf instanceof Uint8Array) u8 = buf
    else if (buf instanceof ArrayBuffer) u8 = new Uint8Array(buf)
    else if (Array.isArray(buf)) u8 = new Uint8Array(buf)
    else if (buf?.data && Array.isArray(buf.data)) u8 = new Uint8Array(buf.data)
    else u8 = new Uint8Array(buf)
    const text = new TextDecoder('utf-8').decode(u8)
    applyLyricsFromText(text, { origin: 'local' })
  }, [applyLyricsFromText])

  const requestLrcLib = async (url) => {
    const response = await fetch(url)
    if (!response.ok) return null
    return response.json()
  }

  const searchLyricsCandidates = async (customQuery) => {
    const track = playlist[currentIndex]
    if (!track) return
    const metaTitle = metadata.title || stripExtension(track.name) || ''
    const metaArtist = metadata.artist || track?.info?.artist || ''
    const title = (cleanTitleForSearch(metaTitle) || metaTitle || '').trim()
    if (!title && !customQuery) return

    setLyricsCandidateLoading(true)
    setLyricsCandidateOpen(true)
    setLyricsCandidateItems([])
    try {
      const titleVariants = buildLyricTitleVariants(title)
      if (titleVariants.length === 0 && !customQuery) return

      const globalParenHints = extractParenArtistHints(title)
      const coverArtistRaw = (metaArtist || '').trim()
      const coverArtistClean = cleanArtistForLyrics(coverArtistRaw)
      const audioDur = audioRef.current?.duration || duration || 0

      const rankOpts = {
        titleCandidates: customQuery ? [customQuery] : titleVariants,
        artistCandidates: customQuery
          ? []
          : [...globalParenHints, coverArtistClean, coverArtistRaw].filter(Boolean)
      }
      const q = customQuery || `${titleVariants[0]} ${coverArtistClean || coverArtistRaw}`.trim()

      const data = await requestLrcLib(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`)
      const ranked = rankLrcLibCandidates(data, audioDur, rankOpts)
      const lrItems = ranked.slice(0, 30).map((r, i) => {
        const tn = r.item?.trackName || r.item?.track_name || ''
        const an = r.item?.artistName || r.item?.artist_name || ''
        return {
          key: `lrclib-${i}-${tn}`,
          source: 'lrclib',
          title: tn || '—',
          subtitle: an || '—',
          badge: `LRCLIB · ${r.score.toFixed(0)}`,
          raw: r.chosenLyrics
        }
      })
      let neItems = []
      if (window.api?.neteaseSearch) {
        try {
          const songs = await window.api.neteaseSearch(q)
          neItems = (songs || []).slice(0, 25).map((s) => ({
            key: `ne-${s.id}`,
            source: 'netease',
            title: s.name || '—',
            subtitle: s.artists || '—',
            badge:
              typeof s.duration === 'number' && s.duration > 0
                ? `NetEase · ${(s.duration / 1000).toFixed(0)}s`
                : 'NetEase',
            songId: s.id
          }))
        } catch (e) {
          console.warn('[lyrics] neteaseSearch', e)
        }
      }
      setLyricsCandidateItems([...lrItems, ...neItems])
    } finally {
      setLyricsCandidateLoading(false)
    }
  }

  const openLyricsCandidatePicker = () => {
    searchLyricsCandidates()
  }

  const handleLyricsCandidatePick = async (row) => {
    const track = playlist[currentIndex]
    if (!track) return
    try {
      if (row.source === 'lrclib' && row.raw) {
        const parsed = parseAnyLyrics(row.raw)
        if (parsed.length > 0) {
          setLyrics(parsed)
          setLyricsMatchStatus('matched')
          setActiveLyricIndex(-1)
          setLyricsSourceStatus({ kind: 'manual', detail: '', origin: 'lrclib' })
          setLyricsOverrideForPath(track.path, row.raw, {
            source: 'manual',
            origin: 'lrclib'
          })
        }
        return
      }
      if (row.source === 'netease' && row.songId && window.api?.fetchNeteaseLyrics) {
        const res = await window.api.fetchNeteaseLyrics({ songId: row.songId })
        if (res?.ok && res.lrc) {
          const parsed = parseAnyLyrics(res.lrc)
          if (parsed.length > 0) {
            setLyrics(parsed)
            setLyricsMatchStatus('matched')
            setActiveLyricIndex(-1)
            setLyricsSourceStatus({ kind: 'manual', detail: '', origin: 'netease' })
            setLyricsOverrideForPath(track.path, res.lrc, {
              source: 'manual',
              origin: 'netease'
            })
          }
        }
      }
    } catch (e) {
      console.error('[lyrics] candidate pick', e)
    }
  }

  const tryApplyLyricsBySourceLink = async (rawLink) => {
    const parsed = parseLyricsSourceLink(rawLink)
    if (!parsed?.url) return false

    // NetEase supports direct songId lookup via main-process API.
    if (parsed.provider === 'netease' && parsed.songId && window.api?.fetchNeteaseLyrics) {
      const res = await window.api.fetchNeteaseLyrics({ songId: parsed.songId })
      if (res?.ok && res.lrc) {
        const rows = parseAnyLyrics(res.lrc)
        if (rows.length > 0) {
          setLyrics(rows)
          setLyricsMatchStatus('matched')
          setActiveLyricIndex(-1)
          setLyricsSourceStatus({ kind: 'link', detail: '', origin: 'netease' })
          const p = playlistRef.current[currentIndexRef.current]?.path
          if (p) {
            setLyricsOverrideForPath(p, res.lrc, {
              source: 'link',
              origin: 'netease'
            })
          }
          return true
        }
      }
    }

    // Other music links: fallback to LRCLIB keyword search (best effort).
    const lib = await requestLrcLib(
      `https://lrclib.net/api/search?q=${encodeURIComponent(parsed.url)}`
    )
    const currentTrack = currentIndex >= 0 ? playlist[currentIndex] : null
    const expectedTitle =
      metadata.title || (currentTrack?.name ? stripExtension(currentTrack.name) : '') || ''
    const expectedArtist = metadata.artist || currentTrack?.info?.artist || ''
    const raw = pickLyricsFromLrcLibResult(lib, audioRef.current?.duration || duration || 0, {
      titleCandidates: buildLyricTitleVariants(expectedTitle),
      artistCandidates: [cleanArtistForLyrics(expectedArtist), expectedArtist]
    })
    const rows = parseAnyLyrics(raw)
    if (rows.length > 0) {
      setLyrics(rows)
      setLyricsMatchStatus('matched')
      setActiveLyricIndex(-1)
      setLyricsSourceStatus({ kind: 'link', detail: '', origin: 'lrclib' })
      if (currentTrack?.path && raw?.trim()) {
        setLyricsOverrideForPath(currentTrack.path, raw, {
          source: 'link',
          origin: 'lrclib'
        })
      }
      return true
    }
    return false
  }

  const fetchLyrics = async (filePath, title, artist, hints = {}) => {
    const requestSeq = ++lyricsRequestSeqRef.current
    const isStaleRequest = () => requestSeq !== lyricsRequestSeqRef.current
    const applyLyricsResult = (rows, matchStatus, sourceStatus) => {
      if (isStaleRequest()) return true
      setLyrics(rows)
      setLyricsMatchStatus(matchStatus)
      setLyricsSourceStatus(sourceStatus)
      return false
    }

    setLyrics([])
    setActiveLyricIndex(-1)
    setLyricsMatchStatus('loading')
    setLyricsSourceStatus({ kind: 'loading', detail: '', origin: '' })

    // MV Search
    if (
      window.api.searchMVHandler &&
      (configRef.current.enableMV ||
        configRef.current.mvAsBackground ||
        configRef.current.mvAsBackgroundMain)
    ) {
      setIsSearchingMV(true)
      setMvId(null)
      try {
        let foundId = null
        let mvSource = configRef.current.mvSource || 'bilibili'
        const isPackagedFileProtocol =
          typeof window !== 'undefined' && window.location?.protocol === 'file:'

        // Try reading yt-dlp local JSON for exact MV match
        let mvFromInfoJson = false
        const infoJson = await window.api.readInfoJsonHandler(filePath).catch(() => null)
        if (isStaleRequest()) return
        if (infoJson) {
          if (infoJson.extractor && infoJson.extractor.toLowerCase().includes('youtube')) {
            foundId = infoJson.id
            mvSource = 'youtube'
            mvFromInfoJson = true
          } else if (infoJson.extractor && infoJson.extractor.toLowerCase().includes('bilibili')) {
            // bvid or aid
            foundId = infoJson.id
            mvSource = 'bilibili'
            mvFromInfoJson = true
          }
        }

        if (!foundId && hints?.mvOriginUrl) {
          const parsed = extractVideoId(String(hints.mvOriginUrl))
          if (parsed) {
            foundId = parsed.id
            mvSource = parsed.source
          }
        }

        if (!foundId) {
          const persistedMv = getMvOverrideForPath(filePath)
          if (persistedMv?.id && persistedMv?.source) {
            foundId = persistedMv.id
            mvSource = persistedMv.source
          }
        }

        if (!foundId && title) {
          const cleanedTitle = cleanTitleForSearch(title)
          const mvQuery =
            mvSource === 'bilibili'
              ? `${cleanedTitle} ${artist || ''} MV`.trim()
              : `${cleanedTitle} ${artist || ''} official mv`.trim()
          const searchResult = await window.api.searchMVHandler(mvQuery, mvSource)
          if (isStaleRequest()) return
          if (searchResult) {
            if (typeof searchResult === 'string') {
              foundId = searchResult
            } else {
              foundId = searchResult.id
              if (searchResult.source) mvSource = searchResult.source
              console.log(
                `[MV] ${mvSource}: "${searchResult.title || '?'}" | id=${foundId}${searchResult.resolution ? ` | source_res=${searchResult.resolution}` : ''}`
              )
            }
          }
        }

        // 打包后 file:// 场景下 YouTube 更容易触发 153，无 .info.json 时可预降级到 B 站。
        // 若 MV 已来自 yt-dlp info.json，勿替换为搜索结果，以保持「下载源 = 画面」一致。
        if (
          foundId &&
          mvSource === 'youtube' &&
          !mvFromInfoJson &&
          isPackagedFileProtocol &&
          configRef.current.autoFallbackToBilibili
        ) {
          const bilibiliId = await searchBilibiliMv(title || '', artist || '')
          if (isStaleRequest()) return
          if (bilibiliId) {
            foundId = bilibiliId
            mvSource = 'bilibili'
            console.warn('[MV Fallback] Pre-fallback in packaged mode: YouTube -> Bilibili')
          }
        }

        if (foundId) {
          if (isStaleRequest()) return
          setMvId({ id: foundId, source: mvSource })
          setMvOverrideForPath(filePath, { id: foundId, source: mvSource })
        }
      } catch (e) {
        console.error('MV search error', e)
      } finally {
        setIsSearchingMV(false)
      }
    }

    // 1. Saved manual pick for this file (Highest Priority)
    const savedOverride = getLyricsOverrideForPath(filePath)
    if (savedOverride?.raw) {
      const parsedOv = parseAnyLyrics(savedOverride.raw)
      if (parsedOv.length > 0) {
        if (
          applyLyricsResult(parsedOv, 'matched', {
            kind: 'cache',
            detail: savedOverride.source || 'manual',
            origin: savedOverride.origin || ''
          })
        )
          return
        return
      }
    }

    // 2. Try local LRC
    try {
      const expectSidecarLyrics = hints?.hasLyrics === true
      const localReadAttempts = expectSidecarLyrics ? 8 : 1
      const localRetryDelayMs = expectSidecarLyrics ? 250 : 0

      for (let attempt = 0; attempt < localReadAttempts; attempt++) {
        const localLrc = await window.api.readLyricsHandler(filePath)
        if (isStaleRequest()) return
        if (localLrc) {
          const parsed = parseAnyLyrics(localLrc)
          if (parsed.length > 0) {
            if (applyLyricsResult(parsed, 'matched', { kind: 'local', detail: '', origin: '' })) {
              return
            }
            return
          }
        }
        if (attempt < localReadAttempts - 1) {
          await wait(localRetryDelayMs)
          if (isStaleRequest()) return
        }
      }
    } catch (e) {
      console.error('Local LRC error', e)
    }

    // 1.5 Try embedded metadata lyrics
    if (hints?.embeddedLyrics) {
      const embeddedParsed = parseAnyLyrics(hints.embeddedLyrics)
      if (embeddedParsed.length > 0) {
        if (
          applyLyricsResult(embeddedParsed, 'matched', {
            kind: 'embedded',
            detail: '',
            origin: ''
          })
        )
          return
        return
      }
    }

    const lyricsSource = configRef.current.lyricsSource || 'lrclib'
    const useOnlineLyrics =
      lyricsSource !== 'local' && ['lrclib', 'netease', 'qq'].includes(lyricsSource)

    const audioDur = audioRef.current?.duration || duration || 0

    if (title && useOnlineLyrics) {
      try {
        const titleVariants = buildLyricTitleVariants(title)
        if (titleVariants.length === 0) throw new Error('empty lyrics title')
        const globalParenHints = extractParenArtistHints(title)
        const coverArtistRaw = (artist || '').trim()
        const coverArtistClean = cleanArtistForLyrics(coverArtistRaw)
        const albumName = hints?.album || ''

        const applyLrcLibPayload = (payload) => {
          const raw = pickLyricsFromLrcLibResult(payload, audioDur, {
            titleCandidates: titleVariants,
            artistCandidates: [...globalParenHints, coverArtistClean, coverArtistRaw].filter(
              Boolean
            )
          })
          const parsed = parseAnyLyrics(raw)
          if (parsed.length > 0) {
            if (
              applyLyricsResult(parsed, 'matched', {
                kind: 'lrclib',
                detail: '',
                origin: ''
              })
            )
              return true
            if (raw && String(raw).trim()) {
              setLyricsOverrideForPath(filePath, raw, {
                source: 'lrclib',
                origin: ''
              })
            }
            return true
          }
          return false
        }

        const getFromLib = async (trackName, artistName) => {
          const params = new URLSearchParams({ track_name: trackName })
          if (artistName) params.set('artist_name', artistName)
          if (albumName) params.set('album_name', albumName)
          /** 不传 duration：翻唱与 LRCLIB 里原版时长不一致时 get 会直接空 */
          return requestLrcLib(`https://lrclib.net/api/get?${params.toString()}`)
        }

        const searchLib = (q) =>
          requestLrcLib(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`)

        const triedGet = new Set()
        const tryGet = async (tn, an) => {
          const key = `${tn}\0${an}`
          if (triedGet.has(key)) return false
          triedGet.add(key)
          const data = await getFromLib(tn, an)
          if (isStaleRequest()) return true
          return applyLrcLibPayload(data)
        }

        const triedSearch = new Set()
        const trySearch = async (q) => {
          const key = (q || '').trim()
          if (!key || triedSearch.has(key)) return false
          triedSearch.add(key)
          const data = await searchLib(key)
          if (isStaleRequest()) return true
          return applyLrcLibPayload(data)
        }

        const runLrcLibAttempts = async () => {
          for (const cleanedTitle of titleVariants) {
            const parenHints = [
              ...new Set([...globalParenHints, ...extractParenArtistHints(cleanedTitle)])
            ]
            for (const hint of parenHints) {
              if (await tryGet(cleanedTitle, hint)) return true
            }
            if (coverArtistRaw && coverArtistRaw !== 'Unknown Artist') {
              if (await tryGet(cleanedTitle, coverArtistRaw)) return true
            }
            if (
              coverArtistClean &&
              coverArtistClean !== coverArtistRaw &&
              coverArtistClean !== 'Unknown Artist'
            ) {
              if (await tryGet(cleanedTitle, coverArtistClean)) return true
            }
            if (await tryGet(cleanedTitle, '')) return true

            for (const hint of parenHints) {
              if (await trySearch(`${cleanedTitle} ${hint}`.trim())) return true
            }
            if (coverArtistRaw && coverArtistRaw !== 'Unknown Artist') {
              if (await trySearch(`${cleanedTitle} ${coverArtistRaw}`.trim())) return true
            }
            if (coverArtistClean) {
              if (await trySearch(`${cleanedTitle} ${coverArtistClean}`.trim())) return true
            }
            // Short titles are extremely ambiguous — include album name when available.
            if ((cleanedTitle || '').length <= 4 && albumName) {
              if (
                coverArtistClean &&
                (await trySearch(`${cleanedTitle} ${coverArtistClean} ${albumName}`.trim()))
              )
                return true
              if (await trySearch(`${cleanedTitle} ${albumName}`.trim())) return true
            }
            if (await trySearch(cleanedTitle)) return true

            const rawTrim = title.trim()
            if (rawTrim && rawTrim !== cleanedTitle) {
              if (
                coverArtistRaw &&
                coverArtistRaw !== 'Unknown Artist' &&
                (await trySearch(`${rawTrim} ${coverArtistRaw}`.trim()))
              ) {
                return true
              }
              if (await trySearch(rawTrim)) return true
            }
          }
          return false
        }

        const tryNeteaseVariants = async () => {
          if (!window.api?.fetchNeteaseLyrics) return false
          const triedKw = new Set()
          // Build queries: prioritize "title artist" combos over bare title
          const allQueries = []
          for (const tv of titleVariants) {
            if (coverArtistClean) allQueries.push(`${tv} ${coverArtistClean}`)
            for (const hint of globalParenHints) {
              allQueries.push(`${tv} ${hint}`.trim())
            }
            if (
              coverArtistRaw &&
              coverArtistRaw !== 'Unknown Artist' &&
              coverArtistRaw !== coverArtistClean
            ) {
              allQueries.push(`${tv} ${coverArtistRaw}`.trim())
            }
            allQueries.push(tv)
          }
          for (const kw of allQueries) {
            const k = (kw || '').trim()
            if (!k || triedKw.has(k)) continue
            triedKw.add(k)
            console.log(`[Lyrics NetEase] trying: "${k}"`)
            const res = await window.api.fetchNeteaseLyrics({
              keywords: k,
              durationSec: audioDur
            })
            if (isStaleRequest()) return true
            if (res?.ok && res.lrc) {
              const parsed = parseAnyLyrics(res.lrc)
              if (parsed.length >= 3) {
                console.log(`[Lyrics NetEase] matched with "${k}" (${parsed.length} lines)`)
                if (
                  applyLyricsResult(parsed, 'matched', {
                    kind: 'netease',
                    detail: '',
                    origin: ''
                  })
                )
                  return true
                setLyricsOverrideForPath(filePath, res.lrc, {
                  source: 'netease',
                  origin: ''
                })
                return true
              }
            }
          }
          return false
        }

        if (lyricsSource === 'netease') {
          // User chose NetEase — try it first since it's better for CJK metadata,
          // then fall back to LRCLIB for Western songs NetEase may not have.
          if (await tryNeteaseVariants()) return
          if (await runLrcLibAttempts()) return
        } else {
          // Default (lrclib) — LRCLIB first, NetEase as fallback.
          if (await runLrcLibAttempts()) return
          if (await tryNeteaseVariants()) return
        }
      } catch (e) {
        console.error('Online lyrics error', e)
      }
    }

    if (
      applyLyricsResult([{ time: 0, text: i18n.t('lyrics.none') }], 'none', {
        kind: 'none',
        detail: '',
        origin: ''
      })
    )
      return
  }

  const detectBPM = (buffer) => {
    const data = buffer.getChannelData(0)
    const sampleRate = buffer.sampleRate

    // 1. Calculate an envelope (moving average of absolute values)
    // We'll use a larger step to speed up processing
    const step = 100
    const envelope = []
    for (let i = 0; i < data.length; i += step) {
      let sum = 0
      for (let j = 0; j < step && i + j < data.length; j++) {
        sum += Math.abs(data[i + j])
      }
      envelope.push(sum / step)
    }

    // 2. Normalization
    const max = Math.max(...envelope)
    if (max < 0.01) return null
    const normalized = envelope.map((v) => v / max)

    // 3. Peak Detection (Onset Detection)
    // We look for points where the envelope is high and increasing
    const peaks = []
    const threshold = 0.3
    const minDistance = (sampleRate / step) * 0.3 // ~200 BPM max limit

    for (let i = 1; i < normalized.length - 1; i++) {
      if (
        normalized[i] > threshold &&
        normalized[i] > normalized[i - 1] &&
        normalized[i] > normalized[i + 1]
      ) {
        peaks.push(i)
        i += Math.floor(minDistance)
      }
    }

    if (peaks.length < 5) return null

    // 4. Interval Histogram
    const intervals = []
    for (let i = 1; i < peaks.length; i++) {
      const interval = peaks[i] - peaks[i - 1]
      const bpm = Math.round(60 / ((interval * step) / sampleRate))
      if (bpm >= 60 && bpm <= 200) {
        intervals.push(bpm)
      }
    }

    if (intervals.length === 0) return null

    // 5. Find the most frequent BPM range (the mode)
    const counts = {}
    let maxCount = 0
    let bestBpm = null

    intervals.forEach((bpm) => {
      // Group similar BPMs into buckets of 2
      const bucket = Math.round(bpm / 2) * 2
      counts[bucket] = (counts[bucket] || 0) + 1
      if (counts[bucket] > maxCount) {
        maxCount = counts[bucket]
        bestBpm = bucket
      }
    })

    return bestBpm
  }

  const loadTrackData = async (filePath, trackHints = {}) => {
    setCoverUrl(null)
    setMetadata({
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      trackNo: null,
      discNo: null
    })
    setTechnicalInfo({
      sampleRate: null,
      originalBpm: null,
      bitrate: null,
      codec: null
    })

    try {
      // 1. Get Extended Metadata from Main Process (Music-Metadata)
      const data = await window.api.getExtendedMetadataHandler(filePath)

      if (data.success) {
        const { technical, common } = data
        const fallbackFromTitle = parseArtistTitleFromName(common.title || '')
        const resolvedTitle = fallbackFromTitle?.title || common.title
        const resolvedArtist =
          (common.artist && common.artist !== 'Unknown Artist' ? common.artist : null) ||
          common.albumArtist ||
          fallbackFromTitle?.artist ||
          'Unknown Artist'

        setMetadata({
          title: resolvedTitle,
          artist: resolvedArtist,
          album: common.album || '',
          albumArtist: common.albumArtist || '',
          trackNo: common.trackNo ?? null,
          discNo: common.discNo ?? null
        })
        setTechnicalInfo((prev) => ({
          ...prev,
          sampleRate: technical.sampleRate,
          bitrate: technical.bitrate,
          channels: technical.channels,
          codec: technical.codec,
          originalBpm: null // Will be updated by detection or tags below
        }))

        // DSD / native HiFi: <audio> duration is unreliable (browser does not decode DSD correctly).
        if (
          typeof technical.duration === 'number' &&
          technical.duration > 0 &&
          (useNativeEngineRef.current || /\.(dsf|dff)$/i.test(filePath))
        ) {
          setDuration(technical.duration)
        }

        if (common.cover) {
          setCoverUrl(common.cover)
        } else {
          fetchCloudCover(resolvedTitle, resolvedArtist)
        }

        fetchLyrics(filePath, resolvedTitle, resolvedArtist, {
          album: common.album || '',
          embeddedLyrics: common.lyrics || '',
          mvOriginUrl: trackHints.mvOriginUrl
        })
      } else {
        // Fallback for failed extraction
        const title = filePath
          .split('\\')
          .pop()
          .split('/')
          .pop()
          .replace(/\.[^/.]+$/, '')
        const fallbackFromTitle = parseArtistTitleFromName(title || '')
        const resolvedTitle = fallbackFromTitle?.title || title
        const resolvedArtist = fallbackFromTitle?.artist || 'Unknown Artist'

        setMetadata({
          title: resolvedTitle,
          artist: resolvedArtist,
          album: '',
          albumArtist: '',
          trackNo: null,
          discNo: null
        })
        fetchCloudCover(resolvedTitle, resolvedArtist)
        fetchLyrics(filePath, resolvedTitle, resolvedArtist, {
          mvOriginUrl: trackHints.mvOriginUrl
        })
      }

      // 2. BPM Detection (Keep as is, but use less memory)
      const arrayBuffer = await window.api.readBufferHandler(filePath)
      if (arrayBuffer) {
        try {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
          const slice = arrayBuffer.slice(0, 1024 * 1024 * 10)
          const decodedBuffer = await audioCtx.decodeAudioData(slice.buffer || slice)
          const detectedBpm = detectBPM(decodedBuffer)
          setTechnicalInfo((prev) => ({ ...prev, originalBpm: detectedBpm }))
        } catch (e) {
          console.error('BPM detection error:', e)
        }
      }
    } catch (e) {
      console.error('Track data extraction error:', e)
    }
  }

  const openMetadataEditorForTrack = useCallback((track) => {
    if (!track?.path) return
    setMetadataEditorTrack(track)
    setMetadataEditorOpen(true)
  }, [])

  const buildEditableMetadataDraft = useCallback(
    (track) => {
      if (!track?.path) return null
      const stored = {
        ...(trackMetaMapRef.current?.[track.path] || {}),
        ...(displayMetadataOverridesRef.current?.[track.path] || {})
      }
      const parsed = parseTrackInfo(track, stored)
      const isActiveTrack = playlistRef.current[currentIndexRef.current]?.path === track.path
      return {
        path: track.path,
        title: isActiveTrack ? metadata.title || parsed.title || '' : stored.title || parsed.title || '',
        artist:
          isActiveTrack
            ? metadata.artist || parsed.artist || ''
            : stored.artist || parsed.artist || '',
        album: isActiveTrack ? metadata.album || parsed.album || '' : stored.album || parsed.album || '',
        albumArtist: isActiveTrack
          ? metadata.albumArtist || stored.albumArtist || ''
          : stored.albumArtist || '',
        trackNo: isActiveTrack ? metadata.trackNo ?? stored.trackNo ?? null : stored.trackNo ?? null,
        discNo: isActiveTrack ? metadata.discNo ?? stored.discNo ?? null : stored.discNo ?? null
      }
    },
    [metadata]
  )

  const handleSaveTrackMetadata = useCallback(
    async (draft) => {
      if (!draft?.path || !window.api?.updateExtendedMetadataHandler) return
      const response = await window.api.updateExtendedMetadataHandler(draft)
      if (!response?.success) {
        throw new Error(response?.error || t('metadataEditor.saveFailed', 'Failed to save tags'))
      }

      const common = response.common || {}
      const technical = response.technical || {}
      const nextMetaEntry = {
        title: common.title || null,
        artist: common.artist || null,
        album: common.album || null,
        albumArtist: common.albumArtist || null,
        trackNo: common.trackNo ?? null,
        discNo: common.discNo ?? null,
        cover: common.cover || null,
        duration: technical.duration || null
      }

      setTrackMetaMap((prev) => ({
        ...prev,
        [draft.path]: nextMetaEntry
      }))

      const activeTrack = playlistRef.current[currentIndexRef.current] || null
      if (activeTrack?.path === draft.path) {
        setMetadata({
          title: common.title || '',
          artist: common.artist || '',
          album: common.album || '',
          albumArtist: common.albumArtist || '',
          trackNo: common.trackNo ?? null,
          discNo: common.discNo ?? null
        })
        if (common.cover) setCoverUrl(common.cover)
        await loadTrackData(draft.path, {
          mvOriginUrl: activeTrack?.mvOriginUrl,
          hasLyrics: activeTrack?.hasLyrics === true
        })
      }
    },
    [loadTrackData, t]
  )

  const openQuickMetadataFieldEditor = useCallback(
    (field) => {
      const activeTrack = playlistRef.current[currentIndexRef.current] || null
      if (!activeTrack?.path || !isLocalAudioFilePath(activeTrack.path)) return
      const draft = buildEditableMetadataDraft(activeTrack)
      if (!draft) return
      setQuickEditField(field)
      setQuickEditDraft(String(draft[field] ?? ''))
    },
    [buildEditableMetadataDraft]
  )

  const handleQuickFieldTrigger = useCallback(
    (field, event) => {
      if (!(event?.ctrlKey || event?.metaKey)) return
      event.preventDefault()
      event.stopPropagation()
      openQuickMetadataFieldEditor(field)
    },
    [openQuickMetadataFieldEditor]
  )

  const commitQuickMetadataFieldEdit = useCallback(async () => {
    if (!quickEditField || quickEditBusy) return
    const activeTrack = playlistRef.current[currentIndexRef.current] || null
    if (!activeTrack?.path || !isLocalAudioFilePath(activeTrack.path)) {
      setQuickEditField(null)
      setQuickEditDraft('')
      return
    }

    const nextDraft = buildEditableMetadataDraft(activeTrack)
    if (!nextDraft) return
    const nextValue = String(quickEditDraft || '').trim()

    setQuickEditBusy(true)
    try {
      setDisplayMetadataOverrides((prev) => {
        const current = { ...(prev?.[activeTrack.path] || {}) }
        if (nextValue) current[quickEditField] = nextValue
        else delete current[quickEditField]
        const next = { ...(prev || {}) }
        if (Object.keys(current).length > 0) next[activeTrack.path] = current
        else delete next[activeTrack.path]
        return next
      })
      if (playlistRef.current[currentIndexRef.current]?.path === activeTrack.path) {
        setMetadata((prev) => ({
          ...prev,
          [quickEditField]: nextValue
        }))
      }
      setQuickEditField(null)
      setQuickEditDraft('')
    } catch (error) {
      alert(error?.message || String(error))
    } finally {
      setQuickEditBusy(false)
    }
  }, [buildEditableMetadataDraft, quickEditBusy, quickEditDraft, quickEditField])

  const cancelQuickMetadataFieldEdit = useCallback(() => {
    if (quickEditBusy) return
    setQuickEditField(null)
    setQuickEditDraft('')
  }, [quickEditBusy])

  const handleQuickCoverPick = useCallback(
    async (event) => {
      if (!(event?.ctrlKey || event?.metaKey)) return
      const activeTrack = playlistRef.current[currentIndexRef.current] || null
      if (!activeTrack?.path || !isLocalAudioFilePath(activeTrack.path)) return

      event.preventDefault()
      event.stopPropagation()

      const coverPath = await window.api?.openImageHandler?.(configRef.current.uiLocale)
      if (!coverPath) return

      const coverHref = window.api?.pathToFileURL?.(coverPath) || coverPath

      setQuickEditBusy(true)
      try {
        setDisplayMetadataOverrides((prev) => {
          const current = { ...(prev?.[activeTrack.path] || {}) }
          current.coverPath = coverPath
          current.cover = coverHref
          return {
            ...(prev || {}),
            [activeTrack.path]: current
          }
        })
      } catch (error) {
        alert(error?.message || String(error))
      } finally {
        setQuickEditBusy(false)
      }
    },
    []
  )

  const openBatchRenameDrawer = useCallback(() => {
    setBatchRenameOpen(true)
  }, [])

  const handleApplyBatchRename = useCallback(
    async (items) => {
      if (!window.api?.batchRenameFilesHandler) return
      const response = await window.api.batchRenameFilesHandler(items)
      if (!response?.success) {
        throw new Error(response?.error || t('batchRename.failed', 'Failed to rename files'))
      }
      if (Array.isArray(response.renamed) && response.renamed.length > 0) {
        applyLibraryFolderDelta({ renamed: response.renamed, removedPaths: [], added: [] })
      }
    },
    [applyLibraryFolderDelta, t]
  )

  const fetchCloudCover = async (title, artist) => {
    if (!title) return
    try {
      const query = encodeURIComponent(`${title} ${artist || ''}`)
      const response = await fetch(
        `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`
      )
      const data = await response.json()
      if (data && data.results && data.results.length > 0) {
        const artwork = data.results[0].artworkUrl100
        // Get high-res version: 1000x1000
        const highRes = artwork.replace('100x100bb.jpg', '1000x1000bb.jpg')
        setCoverUrl(highRes)
      }
    } catch (e) {
      console.error('Cloud cover fetch error:', e)
    }
  }

  /** @returns {Promise<string[]>} Paths to reference (new or already in library), for user playlists etc. */
  const processFiles = async (files) => {
    setIsConverting(true)
    const processed = []
    const existingPaths = new Set(playlist.map((p) => p.path))
    const pathsForPlaylist = []

    for (const file of files) {
      if (existingPaths.has(file.path)) {
        pathsForPlaylist.push(file.path)
        continue
      }

      if (file.path.toLowerCase().endsWith('.ncm')) {
        setConversionMsg(t('settings.decrypting', { name: file.name }))
        const result = await window.api.convertNcmHandler(file.path)
        if (result.success) {
          const item = { name: result.name, path: result.path }
          processed.push(item)
          existingPaths.add(result.path)
          pathsForPlaylist.push(result.path)
        } else {
          console.error('Failed to convert:', file.path, result.error)
        }
      } else {
        processed.push(file)
        existingPaths.add(file.path)
        pathsForPlaylist.push(file.path)
      }
    }

    if (processed.length > 0) {
      setPlaylist((prev) => [...prev, ...processed])
      if (currentIndex === -1) setCurrentIndex(0)
    }
    setIsConverting(false)
    setConversionMsg('')
    return [...new Set(pathsForPlaylist)]
  }

  const handleImport = async () => {
    const folders = await window.api.openDirectoryHandler()
    if (folders && folders.length > 0) {
      const folderPath = folders[0]
      const audioFiles = await window.api.readDirectoryHandler(folderPath)
      if (audioFiles.length > 0) {
        await processFiles(audioFiles)
      }
      // Save folder path for auto-rescan
      setImportedFolders((prev) => {
        const normalized = folderPath.replace(/[\\/]+$/, '')
        if (prev.some((f) => f.toLowerCase() === normalized.toLowerCase())) return prev
        return [...prev, normalized]
      })
    }
  }

  const handleImportFile = async () => {
    const files = await window.api.openFileHandler(configRef.current.uiLocale)
    if (files && files.length > 0) {
      await processFiles(files)
    }
  }

  const importSharedPlaylistsFromPayload = useCallback(
    async (sharedPlaylists) => {
      if (!Array.isArray(sharedPlaylists) || sharedPlaylists.length === 0) return false
      if (!window.api?.playlistShare?.importPlaylists) return false

      const playlistSaveDir = (
        configRef.current.playlistImportFolder ||
        configRef.current.downloadFolder ||
        ''
      ).trim()
      if (!playlistSaveDir) {
        alert(t('downloader.folderRequired'))
        return false
      }

      setIsConverting(true)
      setConversionMsg(t('downloader.connecting'))

      const createdPlaylistIds = new Map()
      const streamedPathSet = new Set()
      const ensureImportedPlaylistTarget = (playlistName) => {
        const normalizedName = String(playlistName || 'Imported').trim() || 'Imported'
        if (createdPlaylistIds.has(normalizedName)) {
          return createdPlaylistIds.get(normalizedName)
        }
        const newId = crypto.randomUUID()
        createdPlaylistIds.set(normalizedName, newId)
        setUserPlaylists((prev) => [...prev, { id: newId, name: normalizedName, paths: [] }])
        setSelectedSmartCollectionId(null)
        setSelectedUserPlaylistId(newId)
        return newId
      }
      const appendImportedTracks = (playlistName, items) => {
        const normalizedItems = (items || []).filter((item) => item?.path)
        if (normalizedItems.length === 0) return
        const targetId = ensureImportedPlaylistTarget(playlistName)
        const trackItems = normalizedItems.map((item) => ({
          name: item.name || item.path.split(/[/\\]/).pop() || 'track',
          path: item.path,
          type: 'local',
          ...(item.sourceUrl ? { sourceUrl: item.sourceUrl, mvOriginUrl: item.sourceUrl } : {})
        }))
        setPlaylist((prev) => {
          const seen = new Set(prev.map((track) => track.path))
          const next = [...prev]
          for (const track of trackItems) {
            if (!seen.has(track.path)) {
              seen.add(track.path)
              next.push(track)
            }
          }
          return next
        })
        const importedPaths = trackItems.map((track) => track.path)
        setUserPlaylists((prev) =>
          prev.map((playlistItem) =>
            playlistItem.id === targetId
              ? {
                  ...playlistItem,
                  paths: [...new Set([...(playlistItem.paths || []), ...importedPaths])]
                }
              : playlistItem
          )
        )
      }

      const unsub = window.api.playlistShare.onImportProgress((payload) => {
        if (payload?.phase === 'meta') {
          ensureImportedPlaylistTarget(payload.playlistName || 'Imported')
          setConversionMsg(
            t('downloader.linkMetaLine', {
              name: payload.playlistName || 'Imported',
              total: payload.total ?? 0
            })
          )
          return
        }
        if (payload?.phase === 'download') {
          setConversionMsg(
            t('downloader.downloadProgress', {
              current: payload.current ?? 0,
              total: payload.total ?? 0,
              track: payload.trackName || ''
            })
          )
          return
        }
        if (payload?.phase === 'added' && payload.path) {
          streamedPathSet.add(payload.path)
          appendImportedTracks(payload.playlistName || 'Imported', [
            {
              name: payload.trackTitle || payload.path.split(/[/\\]/).pop() || 'track',
              path: payload.path,
              sourceUrl: payload.sourceUrl || ''
            }
          ])
        }
      })

      try {
        const result = await window.api.playlistShare.importPlaylists({
          playlists: sharedPlaylists,
          downloadFolder: playlistSaveDir
        })
        const importedPlaylists = Array.isArray(result?.playlists) ? result.playlists : []
        let okCount = 0
        let failCount = 0
        let firstFailure = null

        for (const playlistItem of importedPlaylists) {
          const addedItems = Array.isArray(playlistItem?.added) ? playlistItem.added : []
          const failedItems = Array.isArray(playlistItem?.failed) ? playlistItem.failed : []
          okCount += addedItems.length
          failCount += failedItems.length
          if (!firstFailure && failedItems.length > 0) firstFailure = failedItems[0]

          const pendingItems = addedItems
            .filter((item) => item?.path && !streamedPathSet.has(item.path))
            .map((item) => ({
              name: item.trackTitle || item.path.split(/[/\\]/).pop() || 'track',
              path: item.path,
              sourceUrl: item.sourceUrl || ''
            }))

          if (pendingItems.length > 0) {
            appendImportedTracks(playlistItem.playlistName || 'Imported', pendingItems)
          }
        }

        if (failCount > 0 && firstFailure) {
          alert(
            t('downloader.importPartial', {
              ok: okCount,
              fail: failCount,
              name: firstFailure.name,
              error: firstFailure.error
            })
          )
        } else if (okCount === 0) {
          alert(t('downloader.importNone'))
        }

        return okCount > 0
      } catch (error) {
        alert(error?.message || String(error))
        return false
      } finally {
        if (typeof unsub === 'function') unsub()
        setIsConverting(false)
        setConversionMsg('')
      }
    },
    [t]
  )

  const handleDroppedJsonFiles = useCallback(
    async (jsonPaths) => {
      if (!Array.isArray(jsonPaths) || jsonPaths.length === 0) return false

      const importedPlaylists = []
      const sharedPlaylists = []

      for (const jsonPath of jsonPaths) {
        try {
          const content = await window.api.readTextFileHandler(jsonPath)
          if (!content) continue
          const parsed = JSON.parse(content)
          const downloadable = extractDownloadablePlaylists(parsed)
          if (downloadable.length > 0) {
            sharedPlaylists.push(...downloadable)
            continue
          }
          const imported = normalizeImportedPlaylists(parsed)
          if (imported.length > 0) {
            importedPlaylists.push(...imported)
          }
        } catch (error) {
          alert(error?.message || String(error))
        }
      }

      if (importedPlaylists.length > 0) {
        setUserPlaylists((prev) => [...prev, ...importedPlaylists])
        setSelectedSmartCollectionId(null)
        setSelectedUserPlaylistId(importedPlaylists[importedPlaylists.length - 1]?.id || null)
      }

      const sharedImported = await importSharedPlaylistsFromPayload(sharedPlaylists)
      return importedPlaylists.length > 0 || sharedImported
    },
    [importSharedPlaylistsFromPayload]
  )

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      const droppedPaths = Array.from(files)
        .map((file) => file.path)
        .filter(Boolean)
      const jsonPaths = droppedPaths.filter((filePath) => filePath.toLowerCase().endsWith('.json'))
      const otherPaths = droppedPaths.filter(
        (filePath) => !filePath.toLowerCase().endsWith('.json')
      )

      if (jsonPaths.length > 0) {
        await handleDroppedJsonFiles(jsonPaths)
      }

      const audioFiles = await window.api.getAudioFilesFromPaths(otherPaths)
      if (audioFiles && audioFiles.length > 0) {
        await processFiles(audioFiles)
      }
    }
  }

  const handleClearPlaylist = () => {
    if (useNativeEngineRef.current) window.api?.stopAudio?.()
    setPlaylist([])
    setActivePlaybackContext(createPlaybackContext('library', 'library', []))
    setUpNextQueue([])
    playbackHistoryRef.current = []
    setPlaybackHistory([])
    setCurrentIndex(-1)
    setIsPlaying(false)
    setDuration(0)
    setCurrentTime(0)
    setCoverUrl(null)
    setLyricsSourceStatus({ kind: 'idle', detail: '', origin: '' })
    lastHistoryTrackedPathRef.current = ''
    pendingTrackStartRef.current = null
    playbackSessionSeedRef.current = null
    lastLoadedTrackPathRef.current = ''
    if (audioRef.current) audioRef.current.src = ''
  }

  const togglePlay = useCallback(async () => {
    const s = lastCastStatus
    if (s?.dlnaEnabled && s?.currentUri && window.api?.pauseAudio && window.api?.playAudio) {
      if (s.transportState === 'PLAYING') {
        await window.api.pauseAudio()
      } else {
        await window.api.playAudio(
          s.currentUri,
          typeof s.positionSec === 'number' ? s.positionSec : 0,
          1.0
        )
      }
      return
    }
    if (currentIndex === -1 && playlist.length > 0) {
      setCurrentIndex(0)
    }
    setIsPlaying((prev) => !prev)
  }, [lastCastStatus, currentIndex, playlist.length])

  // Handle Spacebar to pause/play
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if user is typing in an input
      const activeTag = document.activeElement?.tagName?.toLowerCase()
      if (activeTag === 'input' || activeTag === 'textarea') return

      if (e.code === 'Space') {
        e.preventDefault() // Prevent page from scrolling
        togglePlay()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePlay])

  const handleNext = useCallback(() => {
    if (playlist.length > 0) {
      if (queuePlaybackEnabled) {
        const queueSnapshot = upNextQueueRef.current
        if (queueSnapshot.length > 0) {
          let nextPath = null
          const remaining = []
          for (const item of queueSnapshot) {
            const path = item?.path
            if (typeof path !== 'string' || !path) continue
            const exists = playlistRef.current.some((track) => track.path === path)
            if (!exists) continue
            if (!nextPath) nextPath = path
            else remaining.push({ path })
          }
          if (nextPath) {
            const nextIdx = playlistRef.current.findIndex((track) => track.path === nextPath)
            setUpNextQueue(remaining)
            if (nextIdx !== -1) {
              setCurrentIndex(nextIdx)
              setIsPlaying(true)
              return
            }
          }
        }
      }
      if (playMode === 'shuffle') {
        let nextIdx = Math.floor(Math.random() * playlist.length)
        if (nextIdx === currentIndex && playlist.length > 1) {
          nextIdx = (nextIdx + 1) % playlist.length
        }
        setCurrentIndex(nextIdx)
      } else {
        setCurrentIndex((prev) => (prev + 1) % playlist.length)
      }
      setIsPlaying(true)
    }
  }, [playlist, queuePlaybackEnabled, playMode, currentIndex])

  const jumpToPlaybackHistory = useCallback((targetHistoryIndex) => {
    const historySnapshot = playbackHistoryRef.current
    if (!Array.isArray(historySnapshot) || historySnapshot.length === 0) return false

    const boundedIndex = Math.max(
      0,
      Math.min(
        Number.isFinite(targetHistoryIndex) ? targetHistoryIndex : historySnapshot.length - 1,
        historySnapshot.length - 1
      )
    )

    for (let idx = boundedIndex; idx >= 0; idx -= 1) {
      const candidatePath = historySnapshot[idx]?.path
      const nextIdx = playlistRef.current.findIndex((track) => track.path === candidatePath)
      if (nextIdx === -1) continue

      historyNavigationRef.current = true
      setCurrentIndex(nextIdx)
      setIsPlaying(true)
      return true
    }

    return false
  }, [])

  const goBackInPlaybackHistory = useCallback(() => {
    return jumpToPlaybackHistory(playbackHistoryRef.current.length - 1)
  }, [jumpToPlaybackHistory])

  const clearPlaybackHistory = useCallback(() => {
    playbackHistoryRef.current = []
    setPlaybackHistory([])
  }, [])

  const handleHistoryMenuBack = useCallback(() => {
    goBackInPlaybackHistory()
  }, [goBackInPlaybackHistory])

  const handleHistoryMenuJump = useCallback(
    (historyIndex) => {
      jumpToPlaybackHistory(historyIndex)
    },
    [jumpToPlaybackHistory]
  )

  const handleHistoryMenuClear = useCallback(() => {
    clearPlaybackHistory()
  }, [clearPlaybackHistory])

  // Native bridge: track ended → advance using the same rules as HTML audio
  useEffect(() => {
    if (window.api?.onAudioTrackEnded) {
      return window.api.onAudioTrackEnded(() => {
        handleTrackEndedAdvance()
      })
    }
  }, [handleTrackEndedAdvance])

  const getNextTrack = useCallback(() => {
    if (playlist.length === 0) return null
    if (queuePlaybackEnabled) {
      const queueSnapshot = upNextQueueRef.current
      if (queueSnapshot.length > 0) {
        for (const item of queueSnapshot) {
          const path = item?.path
          if (typeof path !== 'string' || !path) continue
          const exists = playlistRef.current.find((track) => track.path === path)
          if (exists) return exists
        }
      }
    }
    if (playMode === 'shuffle') {
      return null // Cannot reliably predict next track in shuffle
    } else if (playMode === 'single') {
      return playlist[currentIndex]
    } else {
      const { currentSeqIndex, paths } = getPlaybackSequenceSnapshot()
      if (paths.length === 0) return null
      const baseIndex = currentSeqIndex >= 0 ? currentSeqIndex : 0
      const nextPath = paths[(baseIndex + 1) % paths.length]
      return playlistRef.current.find((track) => track.path === nextPath) || null
    }
  }, [playlist, queuePlaybackEnabled, playMode, currentIndex, getPlaybackSequenceSnapshot])

  const nextTrack = getNextTrack()

  const handlePrev = () => {
    const { currentPath, currentSeqIndex, paths } = getPlaybackSequenceSnapshot()
    if (paths.length === 0) return

    if (playMode === 'shuffle') {
      let prevPath = paths[Math.floor(Math.random() * paths.length)]
      if (prevPath === currentPath && paths.length > 1) {
        prevPath = paths[(currentSeqIndex - 1 + paths.length) % paths.length]
      }
      const prevIdx = playlistRef.current.findIndex((track) => track.path === prevPath)
      if (prevIdx === -1) return
      setCurrentIndex(prevIdx)
    } else {
      const baseIndex = currentSeqIndex >= 0 ? currentSeqIndex : 0
      const prevPath = paths[(baseIndex - 1 + paths.length) % paths.length]
      const prevIdx = playlistRef.current.findIndex((track) => track.path === prevPath)
      if (prevIdx === -1) return
      setCurrentIndex(prevIdx)
    }
    setIsPlaying(true)
  }

  const formatTime = (time) => {
    if (isNaN(time)) return '0:00'
    const min = Math.floor(time / 60)
    const sec = Math.floor(time % 60)
    return `${min}:${sec < 10 ? '0' : ''}${sec}`
  }

  const ytIframeRef = useRef(null)
  const ytBackgroundIframeRef = useRef(null)
  const ytReadyRef = useRef(false)
  const ytFallbackTimerRef = useRef(null)
  const mvContainerRef = useRef(null)
  const biliVideoRef = useRef(null)
  const biliBackgroundVideoRef = useRef(null)
  const biliAudioRef = useRef(null)

  /** 侧栏 MV：嵌入 iframe 按 1920×1080 布局再整体缩放，减轻“小窗=低清档” */
  useEffect(() => {
    if (!mvId || !config.enableMV || config.mvAsBackground || !showLyrics) {
      return undefined
    }
    const el = mvContainerRef.current
    if (!el) return undefined
    const BASE_W = 1920
    const BASE_H = 1080
    const apply = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w <= 0 || h <= 0) return
      // Use a "cover" scale (max) to avoid letterboxing inside the MV card.
      const scale = Math.max(w / BASE_W, h / BASE_H) * 1.02
      el.style.setProperty('--mv-embed-scale', String(Math.max(scale, 0.0001)))
    }
    apply()
    const ro = new ResizeObserver(() => apply())
    ro.observe(el)
    return () => ro.disconnect()
  }, [mvId?.id, mvId?.source, config.enableMV, config.mvAsBackground, showLyrics])

  useEffect(() => {
    setYoutubeMvLoginHint(false)
    setBiliDirectStream(null)
    if (mvId?.source === 'bilibili') {
      setMvPlaybackQuality(null)
    } else {
      setMvPlaybackQuality(null)
    }
  }, [mvId?.id, mvId?.source])

  useEffect(() => {
    if (!mvId || mvId.source !== 'bilibili') return
    const qMap = { ultra: 120, highfps: 116, high: 80, medium: 64, low: 16 }
    const qn = qMap[config.mvQuality || 'high'] || 80
    let cancelled = false
    setBiliDirectStream(null)
    window.api
      ?.resolveBilibiliStream?.(mvId.id, qn)
      .then((r) => {
        if (cancelled) return
        if (r?.ok) {
          setBiliDirectStream(r)
          setMvPlaybackQuality(r.qualityDesc)
          console.log(`[Bilibili] Direct stream: ${r.qualityDesc} (${r.format})`)
        } else {
          console.warn('[Bilibili] Stream resolve failed:', r?.error)
          const q = config.mvQuality || 'high'
          const biliMax = signInStatus.bilibili
            ? { high: '1080p', medium: '720p', low: '360p' }
            : { high: '480p', medium: '480p', low: '360p' }
          setMvPlaybackQuality(biliMax[q] || '480p')
        }
      })
      .catch((e) => {
        if (cancelled) return
        console.warn('[Bilibili] Stream resolve error:', e)
      })
    return () => {
      cancelled = true
    }
  }, [mvId?.id, mvId?.source, config.mvQuality, signInStatus.bilibili])

  const refreshSignInStatus = useCallback(() => {
    window.api
      ?.checkSignInStatus?.()
      .then((s) => {
        if (s) setSignInStatus(s)
      })
      .catch(() => {})
  }, [])

  const handleOpenYoutubeSignIn = useCallback(async () => {
    try {
      const r = await window.api?.openYoutubeSignInWindow?.()
      if (r && !r.ok) {
        console.warn('[YouTube sign-in]', r.error || r)
      }
    } catch (e) {
      console.warn('[YouTube sign-in]', e?.message || e)
    }
  }, [])

  const handleOpenBilibiliSignIn = useCallback(async () => {
    try {
      const r = await window.api?.openBilibiliSignInWindow?.()
      if (r && !r.ok) {
        console.warn('[Bilibili sign-in]', r.error || r)
      }
    } catch (e) {
      console.warn('[Bilibili sign-in]', e?.message || e)
    }
  }, [])

  // Sync YouTube playback state and rate
  useEffect(() => {
    if (!mvId || mvId.source === 'bilibili') return
    const func = isPlaying ? 'playVideo' : 'pauseVideo'
    ;[ytIframeRef, ytBackgroundIframeRef].forEach((ref) => {
      if (ref.current && ref.current.contentWindow) {
        ref.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: func,
            args: []
          }),
          '*'
        )
      }
    })
  }, [isPlaying, mvId])

  useEffect(() => {
    if (!mvId || mvId.source === 'bilibili') return
    ;[ytIframeRef, ytBackgroundIframeRef].forEach((ref) => {
      if (ref.current && ref.current.contentWindow) {
        ref.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'setPlaybackRate',
            args: [playbackRate]
          }),
          '*'
        )
      }
    })
  }, [playbackRate, mvId])

  // Handle MV Muting via postMessage
  useEffect(() => {
    if (!mvId || mvId.source === 'bilibili') return
    const func = config.mvMuted ? 'mute' : 'unMute'
    ;[ytIframeRef, ytBackgroundIframeRef].forEach((ref) => {
      if (ref.current && ref.current.contentWindow) {
        ref.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: func,
            args: []
          }),
          '*'
        )
      }
    })
  }, [config.mvMuted, mvId, view, showLyrics])

  // Bilibili direct video: play/pause sync
  useEffect(() => {
    if (!mvId || mvId.source !== 'bilibili' || !biliDirectStream) return
    ;[biliVideoRef, biliBackgroundVideoRef].forEach((ref) => {
      if (!ref.current) return
      if (isPlaying) {
        ref.current.play().catch(() => {})
      } else {
        ref.current.pause()
      }
    })
    if (biliAudioRef.current) {
      if (isPlaying) {
        biliAudioRef.current.play().catch(() => {})
      } else {
        biliAudioRef.current.pause()
      }
    }
  }, [isPlaying, mvId, biliDirectStream])

  // Bilibili direct video: playback rate sync
  useEffect(() => {
    if (!mvId || mvId.source !== 'bilibili' || !biliDirectStream) return
    ;[biliVideoRef, biliBackgroundVideoRef].forEach((ref) => {
      if (ref.current) ref.current.playbackRate = playbackRate
    })
    if (biliAudioRef.current) biliAudioRef.current.playbackRate = playbackRate
  }, [playbackRate, mvId, biliDirectStream])

  // Bilibili direct video: WASAPI Exclusive Hardware Stutter Fix
  useEffect(() => {
    if (!isAudioExclusive || !biliDirectStream || !mvId || mvId.source !== 'bilibili') return
    let ctx = null
    const tmr = setTimeout(() => {
      const refs = [biliVideoRef.current, biliBackgroundVideoRef.current].filter(Boolean)
      if (!refs.length) return
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext
        ctx = new AudioContext()
        ctx.suspend()
        refs.forEach((el) => {
          ctx.createMediaElementSource(el) // Bypasses Chromium audio sync waiting for locked WASAPI endpoint
        })
        console.log(
          '[Fix] WebAudio WASAPI exclusive playback stutter fix applied to Bilibili video'
        )
      } catch (err) {
        console.warn('Failed to apply exclusive mode stutter fix', err)
      }
    }, 50)

    return () => {
      clearTimeout(tmr)
      if (ctx) ctx.close().catch(() => {})
    }
  }, [isAudioExclusive, biliDirectStream, mvId])

  const postToAllMvIframes = useCallback((msg, target = '*') => {
    ;[ytIframeRef, ytBackgroundIframeRef].forEach((ref) => {
      if (ref.current?.contentWindow) {
        ref.current.contentWindow.postMessage(msg, target)
      }
    })
  }, [])

  const pushYTQuality = useCallback(() => {
    const qMap = { high: 'hd1080', medium: 'hd720', low: 'small' }
    const q = qMap[config.mvQuality || 'high'] || 'hd1080'
    postToAllMvIframes(
      JSON.stringify({
        event: 'command',
        func: 'setPlaybackQuality',
        args: [q]
      })
    )
  }, [config.mvQuality, postToAllMvIframes])

  const biliSeekDebounceRef = useRef(null)

  const syncYTVideo = (time) => {
    const audioT = Number(time) || 0
    const mvOffSec = (configRef.current.mvOffsetMs ?? 0) / 1000
    const t = Math.max(0, audioT + mvOffSec)

    if (mvId?.source === 'bilibili') {
      if (biliDirectStream?.videoUrl) {
        ;[biliVideoRef, biliBackgroundVideoRef].forEach((ref) => {
          if (ref.current) ref.current.currentTime = t
        })
        if (biliAudioRef.current) biliAudioRef.current.currentTime = t
        return
      }
      if (biliSeekDebounceRef.current) clearTimeout(biliSeekDebounceRef.current)
      biliSeekDebounceRef.current = setTimeout(() => {
        const secs = Math.floor(t)
        ;[ytIframeRef, ytBackgroundIframeRef].forEach((ref) => {
          if (!ref.current) return
          const cur = ref.current.src || ''
          const base = cur.replace(/[&?]t=\d+/g, '')
          ref.current.src = base + `&t=${secs}`
        })
      }, 300)
      return
    }

    ;[ytIframeRef, ytBackgroundIframeRef].forEach((ref) => {
      if (ref.current && ref.current.contentWindow) {
        ref.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'seekTo',
            args: [t, true]
          }),
          '*'
        )

        if (isPlaying) {
          ref.current.contentWindow.postMessage(
            JSON.stringify({
              event: 'command',
              func: 'playVideo',
              args: []
            }),
            '*'
          )
        }
      }
    })
  }

  const syncYTVideoRef = useRef(syncYTVideo)
  syncYTVideoRef.current = syncYTVideo

  /** YouTube / Bilibili 嵌入 iframe：定期按本地音频时间软校正，减轻长播漂移 */
  useEffect(() => {
    if (!isPlaying || !mvId) return
    const biliEmbedOnly = mvId.source === 'bilibili' && !biliDirectStream?.videoUrl
    if (mvId.source !== 'youtube' && !biliEmbedOnly) return
    const id = window.setInterval(() => {
      if (isSeekingRef.current) return
      const audio = audioRef.current
      if (!audio) return
      syncYTVideoRef.current(audio.currentTime || 0)
    }, 3000)
    return () => clearInterval(id)
  }, [isPlaying, mvId?.id, mvId?.source, biliDirectStream?.videoUrl])

  /** Bilibili 直连 HTML5 video：偏差超过阈值再对齐，避免每帧 seek */
  useEffect(() => {
    if (!isPlaying || !mvId || mvId.source !== 'bilibili' || !biliDirectStream?.videoUrl) return
    let raf = 0
    const driftThresholdSec = 0.35
    const tick = () => {
      if (!isSeekingRef.current) {
        const audio = audioRef.current
        const v = biliVideoRef.current || biliBackgroundVideoRef.current
        if (audio && v) {
          const audioTime = useNativeEngineRef.current ? audio.currentTime || 0 : audio.currentTime
          const target = Math.max(0, audioTime + (configRef.current.mvOffsetMs ?? 0) / 1000)
          if (Math.abs(v.currentTime - target) > driftThresholdSec) {
            v.currentTime = target
            if (biliAudioRef.current) biliAudioRef.current.currentTime = target
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, mvId?.id, mvId?.source, biliDirectStream?.videoUrl])

  const handleSeek = (e) => {
    if (lastCastStatus?.dlnaEnabled && lastCastStatus?.currentUri) return
    const val = parseFloat(e.target.value)
    if (!Number.isFinite(val)) return

    progressSeekValueRef.current = val
    setCurrentTime(val)
    syncYTVideo(val)

    if (!isProgressDraggingRef.current) {
      const trackPath = playlist[currentIndex]?.path
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current)
      if (useNativeEngineRef.current && window.api?.playAudio && trackPath) {
        if (audioRef.current) audioRef.current.currentTime = val
        window.api.playAudio(trackPath, val, playbackRateRef.current).catch(console.error)
        seekTimerRef.current = setTimeout(() => setIsSeeking(false), 350)
      } else if (audioRef.current) {
        audioRef.current.currentTime = val
        seekTimerRef.current = setTimeout(() => setIsSeeking(false), 120)
      }
    }
  }

  const commitProgressSeek = useCallback(
    (overrideValue) => {
      if (!isProgressDraggingRef.current && !Number.isFinite(overrideValue)) return

      isProgressDraggingRef.current = false
      setIsProgressDragging(false)

      if (lastCastStatus?.dlnaEnabled && lastCastStatus?.currentUri) {
        setIsSeeking(false)
        return
      }

      const val = Number.isFinite(overrideValue) ? overrideValue : progressSeekValueRef.current
      if (!Number.isFinite(val)) {
        setIsSeeking(false)
        return
      }

      setCurrentTime(val)
      syncYTVideo(val)

      const trackPath = playlist[currentIndex]?.path
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current)

      if (useNativeEngineRef.current && window.api?.playAudio && trackPath) {
        if (audioRef.current) audioRef.current.currentTime = val
        window.api.playAudio(trackPath, val, playbackRateRef.current).catch(console.error)
        seekTimerRef.current = setTimeout(() => setIsSeeking(false), 350)
      } else if (audioRef.current) {
        audioRef.current.currentTime = val
        seekTimerRef.current = setTimeout(() => setIsSeeking(false), 120)
      } else {
        setIsSeeking(false)
      }
    },
    [currentIndex, lastCastStatus?.currentUri, lastCastStatus?.dlnaEnabled, playlist, syncYTVideo]
  )

  useEffect(() => {
    if (!isProgressDragging) return undefined

    const finishSeek = () => {
      commitProgressSeek()
    }

    window.addEventListener('mouseup', finishSeek)
    window.addEventListener('touchend', finishSeek)
    window.addEventListener('touchcancel', finishSeek)

    return () => {
      window.removeEventListener('mouseup', finishSeek)
      window.removeEventListener('touchend', finishSeek)
      window.removeEventListener('touchcancel', finishSeek)
    }
  }, [isProgressDragging, commitProgressSeek])

  useEffect(() => {
    if (!mvId) return
    const ax = audioRef.current?.currentTime
    const t = typeof ax === 'number' && !Number.isNaN(ax) ? ax : currentTime
    syncYTVideo(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在用户调整 MV 偏移时重新对齐画面
  }, [config.mvOffsetMs])

  const handleExport = async () => {
    if (currentIndex === -1 || !playlist[currentIndex]) return
    setIsExporting(true)
    try {
      const track = playlist[currentIndex]
      const arrayBuffer = await window.api.readBufferHandler(track.path)

      // Offline Audio Processing
      const audioCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
        2,
        1,
        44100
      )
      const audioData = await audioCtx.decodeAudioData(arrayBuffer.buffer || arrayBuffer)

      const rate = playbackRate
      const duration = audioData.duration / rate
      const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
        audioData.numberOfChannels,
        audioCtx.sampleRate * duration,
        audioCtx.sampleRate
      )

      const source = offlineCtx.createBufferSource()
      source.buffer = audioData
      source.playbackRate.value = rate

      source.connect(offlineCtx.destination)
      source.start(0)

      const renderedBuffer = await offlineCtx.startRendering()

      // Encode to WAV (simple implementation)
      const wavBuffer = audioBufferToWav(renderedBuffer)

      // Save it via IPC
      const result = await window.api.saveExportHandler(
        new Uint8Array(wavBuffer).buffer,
        `Nightcore_${track.name.replace('.mp3', '.wav')}`,
        configRef.current.uiLocale
      )

      if (result.success) {
        alert(t('player.exportWavSuccess'))
      }
    } catch (e) {
      console.error(e)
      alert(t('player.exportWavFailed', { message: e.message }))
    }
    setIsExporting(false)
  }

  // AudioBuffer to pure PCM WAV conversion helper
  const audioBufferToWav = (buffer) => {
    const numOfChan = buffer.numberOfChannels
    const length = buffer.length * numOfChan * 2 + 44
    const bufferArray = new ArrayBuffer(length)
    const view = new DataView(bufferArray)
    const channels = []
    let sample = 0
    let offset = 0
    let pos = 0

    const setUint16 = (data) => {
      view.setUint16(pos, data, true)
      pos += 2
    }
    const setUint32 = (data) => {
      view.setUint32(pos, data, true)
      pos += 4
    }

    setUint32(0x46464952) // "RIFF"
    setUint32(length - 8)
    setUint32(0x45564157) // "WAVE"
    setUint32(0x20746d66) // "fmt " chunk
    setUint32(16) // length = 16
    setUint16(1) // PCM (uncompressed)
    setUint16(numOfChan)
    setUint32(buffer.sampleRate)
    setUint32(buffer.sampleRate * 2 * numOfChan) // avg. bytes/sec
    setUint16(numOfChan * 2) // block-align
    setUint16(16) // 16-bit
    setUint32(0x61746164) // "data" - chunk
    setUint32(length - pos - 4) // chunk length

    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i))
    }

    while (pos < length) {
      for (let i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][offset]))
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0
        view.setInt16(pos, sample, true)
        pos += 2
      }
      offset++
    }
    return bufferArray
  }

  const effectiveTrackMetaMap = useMemo(() => {
    const next = { ...trackMetaMap }
    for (const [path, override] of Object.entries(displayMetadataOverrides || {})) {
      const prev = next[path] || {}
      next[path] = {
        ...prev,
        ...override,
        cover: override?.cover || prev.cover || null
      }
    }
    return next
  }, [trackMetaMap, displayMetadataOverrides])

  const currentTrack = currentIndex >= 0 ? playlist[currentIndex] : null
  const currentDisplayOverride = currentTrack?.path ? displayMetadataOverrides[currentTrack.path] || null : null
  const listenTogetherSyncContent = useMemo(
    () => ({
      coverUrl: coverUrl || '',
      mvId: mvId || null,
      lyrics: Array.isArray(lyrics) ? lyrics : []
    }),
    [coverUrl, mvId, lyrics]
  )
  const currentTrackInfo = useMemo(
    () => (currentTrack ? parseTrackInfo(currentTrack, effectiveTrackMetaMap[currentTrack.path]) : null),
    [currentTrack, effectiveTrackMetaMap]
  )
  const mvFallbackRunningRef = useRef(false)
  const mvFallbackAttemptKeyRef = useRef('')

  const triggerAutoMvFallback = useCallback(
    async (reason = 'youtube-error') => {
      if (!window.api?.searchMVHandler) return
      if (!configRef.current?.autoFallbackToBilibili) return
      if (!mvId || mvId.source !== 'youtube') return

      const title =
        metadata.title ||
        currentTrackInfo?.title ||
        (currentTrack ? stripExtension(currentTrack.name) : '')
      const artist =
        metadata.artist && metadata.artist !== 'Unknown Artist'
          ? metadata.artist
          : currentTrackInfo?.artist || ''

      const key = `${currentTrack?.path || title}::${mvId.id}`
      if (mvFallbackRunningRef.current || mvFallbackAttemptKeyRef.current === key) {
        return
      }

      mvFallbackRunningRef.current = true
      mvFallbackAttemptKeyRef.current = key

      try {
        const bilibiliId = await searchBilibiliMv(title || 'music', artist || '')
        if (bilibiliId) {
          console.warn(
            `[MV Fallback] YouTube failed (${reason}), switched to Bilibili: ${bilibiliId}`
          )
          setMvId({ id: bilibiliId, source: 'bilibili' })
        } else {
          console.warn(`[MV Fallback] YouTube failed (${reason}), no Bilibili result.`)
        }
      } catch (e) {
        console.warn(`[MV Fallback] fallback search failed: ${e?.message || e}`)
      } finally {
        mvFallbackRunningRef.current = false
      }
    },
    [mvId, metadata.title, metadata.artist, currentTrack, currentTrackInfo, searchBilibiliMv]
  )

  useEffect(() => {
    return () => {
      if (ytFallbackTimerRef.current) {
        clearTimeout(ytFallbackTimerRef.current)
        ytFallbackTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const handleYouTubeMessage = (event) => {
      const origin = event?.origin || ''
      if (!/youtube\.com$|youtube-nocookie\.com$/i.test(origin.replace(/^https?:\/\//, ''))) {
        return
      }

      let payload = event.data
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload)
        } catch (_) {
          return
        }
      }

      if (!payload || typeof payload !== 'object') return
      if (payload.event === 'onReady') {
        ytReadyRef.current = true
        if (ytFallbackTimerRef.current) {
          clearTimeout(ytFallbackTimerRef.current)
          ytFallbackTimerRef.current = null
        }
        pushYTQuality()
        return
      }

      if (payload.event === 'onPlaybackQualityChange') {
        console.log(`[MV Quality] YouTube playing at: ${payload.info}`)
        setMvPlaybackQuality(payload.info)
        return
      }

      if (payload.event !== 'onError') return

      const code = Number(payload.info)
      if ([153, 150, 101].includes(code) && config.autoFallbackToBilibili) {
        triggerAutoMvFallback(`youtube-error-${code}`)
      }
    }

    window.addEventListener('message', handleYouTubeMessage)
    return () => window.removeEventListener('message', handleYouTubeMessage)
  }, [config.autoFallbackToBilibili, triggerAutoMvFallback, pushYTQuality])

  useEffect(() => {
    if (!mvId || mvId.source !== 'youtube' || !ytReadyRef.current) return
    pushYTQuality()
  }, [config.mvQuality, mvId, pushYTQuality])

  const resolvedDisplayArtist = useMemo(() => {
    if (currentDisplayOverride?.artist) return currentDisplayOverride.artist
    if (metadata.artist && metadata.artist !== 'Unknown Artist') return metadata.artist
    if (currentTrackInfo?.artist && currentTrackInfo.artist !== 'Unknown Artist')
      return currentTrackInfo.artist
    return currentTrack ? t('player.nightcoreMode') : t('player.ellipsis')
  }, [currentDisplayOverride, metadata.artist, currentTrackInfo, currentTrack, t])

  const dlnaUiOn = useMemo(
    () => !!(lastCastStatus?.dlnaEnabled && lastCastStatus?.currentUri),
    [lastCastStatus]
  )

  const displayMainTitle = useMemo(() => {
    const s = lastCastStatus
    if (s?.dlnaEnabled && s?.currentUri) {
      const title = (s.dlnaMeta?.title || '').trim()
      return title || t('dlna.castTitle')
    }
    if (currentDisplayOverride?.title) return currentDisplayOverride.title
    if (metadata.title) return metadata.title
    if (currentTrack) return currentTrack.name.replace(/\.[^/.]+$/, '')
    return t('player.selectTrack')
  }, [lastCastStatus, currentDisplayOverride, metadata.title, currentTrack, t])

  const displayMainArtist = useMemo(() => {
    const s = lastCastStatus
    if (s?.dlnaEnabled && s?.currentUri) {
      const a = (s.dlnaMeta?.artist || '').trim()
      return a || t('dlna.networkMedia')
    }
    return resolvedDisplayArtist
  }, [lastCastStatus, resolvedDisplayArtist, t])

  const displayMainAlbum = useMemo(() => {
    const s = lastCastStatus
    if (s?.dlnaEnabled && s?.currentUri) {
      return (s.dlnaMeta?.album || '').trim() || 'Unknown Album'
    }
    if (currentDisplayOverride?.album) return currentDisplayOverride.album
    return metadata.album || currentTrack?.info?.album || 'Unknown Album'
  }, [lastCastStatus, currentDisplayOverride, metadata.album, currentTrack])

  const displayMainCoverUrl = useMemo(() => {
    const s = lastCastStatus
    if (s?.dlnaEnabled && s?.currentUri) {
      const u = (s.dlnaMeta?.albumArtUrl || '').trim()
      return u || null
    }
    if (currentDisplayOverride?.cover) return currentDisplayOverride.cover
    return coverUrl
  }, [lastCastStatus, currentDisplayOverride, coverUrl])

  useEffect(() => {
    if (!config.themeDynamicCoverColor || !displayMainCoverUrl) {
      setDynamicCoverTheme(null)
      return
    }
    let cancelled = false
    extractAverageHexFromSrc(displayMainCoverUrl)
      .then((hex) => {
        if (cancelled) return
        if (hex) setDynamicCoverTheme(generatePaletteFromHex(hex))
        else setDynamicCoverTheme(null)
      })
      .catch(() => {
        if (!cancelled) setDynamicCoverTheme(null)
      })
    return () => {
      cancelled = true
    }
  }, [config.themeDynamicCoverColor, displayMainCoverUrl])

  const buildShareCardSnapshot = useCallback(
    (track) => {
      if (!track) return null
      const info = parseTrackInfo(track, trackMetaMap[track.path])
      const title = info?.title || stripExtension(track.name || '') || t('player.selectTrack')
      const artist =
        info?.artist && info.artist !== 'Unknown Artist' ? info.artist : t('common.unknownArtist')
      const album = info?.album || 'Unknown Album'
      const cover =
        info?.cover ||
        trackMetaMap?.[track.path]?.cover ||
        (currentTrack?.path === track.path ? displayMainCoverUrl : null) ||
        null
      return { title, artist, album, cover }
    },
    [trackMetaMap, currentTrack, displayMainCoverUrl, t]
  )

  const waitForShareCardPaint = useCallback(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }),
    []
  )

  const handleCopyTrackCardImage = useCallback(
    async (track) => {
      if (isCardActionBusy) return
      const snapshot = buildShareCardSnapshot(track)
      if (!snapshot) return
      setIsCardActionBusy(true)
      try {
        setShareCardSnapshot(snapshot)
        await waitForShareCardPaint()
        await copySongCardImage(songCardCaptureRef.current, window.api)
      } catch (err) {
        alert(t('contextMenu.actionFailed', { detail: err?.message || String(err) }))
      } finally {
        setIsCardActionBusy(false)
      }
    },
    [isCardActionBusy, buildShareCardSnapshot, waitForShareCardPaint, t]
  )

  const handleSaveTrackCardImage = useCallback(
    async (track) => {
      if (isCardActionBusy) return
      const snapshot = buildShareCardSnapshot(track)
      if (!snapshot) return
      setIsCardActionBusy(true)
      try {
        setShareCardSnapshot(snapshot)
        await waitForShareCardPaint()
        await saveSongCardImage(
          songCardCaptureRef.current,
          window.api,
          `${snapshot.title}-share-card`
        )
      } catch (err) {
        alert(t('contextMenu.actionFailed', { detail: err?.message || String(err) }))
      } finally {
        setIsCardActionBusy(false)
      }
    },
    [isCardActionBusy, buildShareCardSnapshot, waitForShareCardPaint, t]
  )

  const transportIsPlaying = useMemo(() => {
    const s = lastCastStatus
    if (s?.dlnaEnabled && s?.currentUri) {
      return s.transportState === 'PLAYING'
    }
    return isPlaying
  }, [lastCastStatus, isPlaying])

  const playerTransportPluginContext = useMemo(
    () => ({
      trackPath: currentTrack?.path || '',
      title: displayMainTitle || '',
      artist: displayMainArtist || '',
      album: displayMainAlbum || '',
      isPlaying: transportIsPlaying === true
    }),
    [currentTrack?.path, displayMainTitle, displayMainArtist, displayMainAlbum, transportIsPlaying]
  )

  const displayProgressTime = useMemo(() => {
    const s = lastCastStatus
    if (s?.dlnaEnabled && s?.currentUri) {
      return typeof s.positionSec === 'number' ? s.positionSec : 0
    }
    return currentTime
  }, [lastCastStatus, currentTime])

  const displayProgressDuration = useMemo(() => {
    const s = lastCastStatus
    if (s?.dlnaEnabled && s?.currentUri && (s.trackDurationSec ?? 0) > 0) {
      return s.trackDurationSec
    }
    return duration
  }, [lastCastStatus, duration])

  useEffect(() => {
    if (!showLyrics || config.lyricsWordHighlight === false) {
      setLyricsRenderTime(displayProgressTime)
      return
    }

    if (!transportIsPlaying) {
      const s = lastCastStatus
      if (s?.dlnaEnabled && s?.currentUri) {
        setLyricsRenderTime(typeof s.positionSec === 'number' ? s.positionSec : displayProgressTime)
      } else if (useNativeEngineRef.current) {
        setLyricsRenderTime(displayProgressTime)
      } else {
        setLyricsRenderTime(audioRef.current?.currentTime ?? displayProgressTime)
      }
      return
    }

    let rafId = 0
    const tick = () => {
      const s = lastCastStatus
      if (s?.dlnaEnabled && s?.currentUri) {
        setLyricsRenderTime(typeof s.positionSec === 'number' ? s.positionSec : displayProgressTime)
      } else if (useNativeEngineRef.current) {
        setLyricsRenderTime(displayProgressTime)
      } else {
        setLyricsRenderTime(audioRef.current?.currentTime ?? displayProgressTime)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [
    showLyrics,
    config.lyricsWordHighlight,
    transportIsPlaying,
    lastCastStatus,
    displayProgressTime
  ])

  const lyricTimelineValid = useMemo(() => {
    if (!Array.isArray(lyrics) || lyrics.length < 2) return false

    let firstTime = null
    let lastTime = null
    let prevTime = null
    let positiveGapCount = 0
    let nearPlainGapCount = 0

    for (const line of lyrics) {
      const t = Number(line?.time)
      if (!Number.isFinite(t)) continue

      if (firstTime == null) firstTime = t
      if (lastTime == null || t > lastTime) lastTime = t

      if (prevTime != null) {
        const gap = t - prevTime
        if (gap < -1e-3) return false
        if (gap > 1e-3) {
          positiveGapCount += 1
          if (Math.abs(gap - 3.5) < 0.03) nearPlainGapCount += 1
        }
      }
      prevTime = t
    }

    if (firstTime == null || lastTime == null || positiveGapCount < 1) return false

    const span = lastTime - firstTime
    if (!Number.isFinite(span) || span <= 0.2) return false

    // parsePlainLyrics 产生的“每行固定 3.5 秒”伪时间轴，不适合逐字高亮
    if (positiveGapCount >= 4 && nearPlainGapCount / positiveGapCount > 0.75) return false

    if (
      Number.isFinite(displayProgressDuration) &&
      displayProgressDuration > 0 &&
      span > Math.max(displayProgressDuration * 1.5, displayProgressDuration + 45)
    ) {
      return false
    }

    return true
  }, [lyrics, displayProgressDuration])

  const lyricKaraokeProgressList = useMemo(() => {
    if (!Array.isArray(lyrics) || lyrics.length === 0) return []
    if (!lyricTimelineValid) return lyrics.map(() => 0)

    const currentSec = Number.isFinite(lyricsRenderTime) ? lyricsRenderTime : 0
    const karaokeLeadSec = (config.lyricsWordLeadMs ?? 100) / 1000
    const renderSec = currentSec + karaokeLeadSec
    const offsetSec = (config.lyricsOffsetMs ?? 0) / 1000
    const fillRatio = Math.max(0.7, Math.min(1, config.lyricsWordFillRatio ?? 0.88))
    const fallbackTail = Math.max(1.8, (displayProgressDuration || 0) > 0 ? 2.4 : 3.2)

    return lyrics.map((line, idx) => {
      const startSec = (line?.time ?? 0) + offsetSec
      const nextLineTime = lyrics[idx + 1]?.time
      const nextSec =
        typeof nextLineTime === 'number' && Number.isFinite(nextLineTime)
          ? nextLineTime + offsetSec
          : NaN

      const baseSpan = Number.isFinite(nextSec)
        ? Math.max(0.12, nextSec - startSec)
        : (displayProgressDuration || 0) > startSec
          ? Math.max(0.8, (displayProgressDuration || 0) - startSec)
          : fallbackTail
      const endSec = startSec + baseSpan * fillRatio

      if (renderSec <= startSec) return 0
      if (renderSec >= endSec) return 1

      const raw = (renderSec - startSec) / (endSec - startSec)
      return Math.min(1, Math.max(0, raw))
    })
  }, [
    lyrics,
    lyricTimelineValid,
    lyricsRenderTime,
    displayProgressDuration,
    config.lyricsOffsetMs,
    config.lyricsWordLeadMs,
    config.lyricsWordFillRatio
  ])

  const lyricsStatusUi = useMemo(() => {
    if (lyricsMatchStatus === 'loading')
      return { tone: 'pending', text: t('lyricsDrawer.statusLoading') }
    if (lyricsMatchStatus === 'none') return { tone: 'bad', text: t('lyricsDrawer.statusNone') }
    if (
      lyricsMatchStatus === 'matched' &&
      config.lyricsWordHighlight !== false &&
      !lyricTimelineValid
    ) {
      return { tone: 'warn', text: t('lyricsDrawer.statusDegraded') }
    }
    if (lyricsMatchStatus === 'matched')
      return { tone: 'ok', text: t('lyricsDrawer.statusMatched') }
    return { tone: 'idle', text: t('lyricsDrawer.statusDash') }
  }, [lyricsMatchStatus, lyricTimelineValid, config.lyricsWordHighlight, t])

  const lyricsSourceUi = useMemo(() => {
    const labelMap = {
      idle: t('lyricsDrawer.sourceStateIdle', '—'),
      loading: t('lyricsDrawer.sourceStateLoading', 'Loading'),
      none: t('lyricsDrawer.sourceStateNone', 'No lyrics'),
      local: t('lyricsDrawer.sourceStateLocal', 'Local file'),
      embedded: t('lyricsDrawer.sourceStateEmbedded', 'Embedded tags'),
      lrclib: t('lyricsDrawer.sourceStateLrclib', 'LRCLIB'),
      netease: t('lyricsDrawer.sourceStateNetease', 'NetEase'),
      manual: t('lyricsDrawer.sourceStateManual', 'Manual'),
      link: t('lyricsDrawer.sourceStateLink', 'Song link'),
      cache: t('lyricsDrawer.sourceStateCache', 'Cache')
    }
    const detail = lyricsSourceStatus?.detail
      ? labelMap[lyricsSourceStatus.detail] || lyricsSourceStatus.detail
      : ''
    const origin = lyricsSourceStatus?.origin
      ? labelMap[lyricsSourceStatus.origin] || lyricsSourceStatus.origin
      : ''

    let text = labelMap[lyricsSourceStatus?.kind] || labelMap.idle
    if (lyricsSourceStatus?.kind === 'cache' && detail) {
      text = `${labelMap.cache} · ${detail}${origin && origin !== detail ? ` · ${origin}` : ''}`
    } else if (
      (lyricsSourceStatus?.kind === 'manual' || lyricsSourceStatus?.kind === 'link') &&
      origin
    ) {
      text = `${text} · ${origin}`
    }

    return text
  }, [lyricsSourceStatus, t])

  const preferredReleaseVersion = useMemo(
    () => normalizeReleaseVersion(updateStatus?.version || appVersion),
    [updateStatus, appVersion]
  )

  const visibleReleaseNotes = useMemo(() => {
    if (!Array.isArray(releaseNotes) || releaseNotes.length === 0) return []
    const preferred = preferredReleaseVersion
      ? releaseNotes.find(
          (item) => normalizeReleaseVersion(item.version) === preferredReleaseVersion
        )
      : null
    if (!preferred) return releaseNotes.slice(0, 3)
    return [preferred, ...releaseNotes.filter((item) => item !== preferred).slice(0, 2)]
  }, [releaseNotes, preferredReleaseVersion])

  const customThemeColorFields = useMemo(
    () => [
      {
        key: 'bgColor',
        label: t('customTheme.bg'),
        desc: t('customTheme.bgDesc')
      },
      {
        key: 'accent1',
        label: t('customTheme.accent1'),
        desc: t('customTheme.accent1Desc')
      },
      {
        key: 'accent2',
        label: t('customTheme.accent2'),
        desc: t('customTheme.accent2Desc')
      },
      {
        key: 'accent3',
        label: t('customTheme.accent3'),
        desc: t('customTheme.accent3Desc')
      },
      {
        key: 'textMain',
        label: t('customTheme.textMain'),
        desc: t('customTheme.textMainDesc')
      },
      {
        key: 'textSoft',
        label: t('customTheme.textSoft'),
        desc: t('customTheme.textSoftDesc')
      },
      {
        key: 'glassColor',
        label: t('customTheme.glassColor'),
        desc: t('customTheme.glassColorDesc')
      }
    ],
    [t]
  )

  const parsedPlaylist = useMemo(
    () =>
      playlist.map((track, originalIdx) => ({
        ...track,
        originalIdx,
        info: parseTrackInfo(track, effectiveTrackMetaMap[track.path])
      })),
    [playlist, effectiveTrackMetaMap]
  )

  useEffect(() => {
    if (!playlist.length) return

    const pending = playlist.filter((track) => !trackMetaMap[track.path]).slice(0, 8)
    if (!pending.length) return

    let cancelled = false

    const loadMetadata = async () => {
      const loaded = {}

      await Promise.all(
        pending.map(async (track) => {
          try {
            const data = await window.api.getExtendedMetadataHandler(track.path)
            if (data?.success) {
              const common = data.common || {}
              const technical = data.technical || {}
              loaded[track.path] = {
                title: common.title || null,
                artist: common.artist || null,
                album: common.album || null,
                albumArtist: common.albumArtist || null,
                trackNo: common.trackNo ?? null,
                discNo: common.discNo ?? null,
                cover: common.cover || null,
                duration: technical.duration || null
              }
            } else {
              loaded[track.path] = {
                title: null,
                artist: null,
                album: null,
                albumArtist: null,
                trackNo: null,
                discNo: null,
                cover: null,
                duration: null
              }
            }
          } catch (error) {
            loaded[track.path] = {
              title: null,
              artist: null,
              album: null,
              albumArtist: null,
              trackNo: null,
              discNo: null,
              cover: null,
              duration: null
            }
          }
        })
      )

      if (!cancelled && Object.keys(loaded).length > 0) {
        setTrackMetaMap((prev) => ({ ...prev, ...loaded }))
      }
    }

    loadMetadata()

    return () => {
      cancelled = true
    }
  }, [playlist, trackMetaMap])

  const queryFilteredPlaylist = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase()
    if (!q) return parsedPlaylist

    return parsedPlaylist.filter(({ info }) => {
      return (
        info.fileName.toLowerCase().includes(q) ||
        info.title.toLowerCase().includes(q) ||
        info.artist.toLowerCase().includes(q) ||
        info.album.toLowerCase().includes(q)
      )
    })
  }, [parsedPlaylist, deferredSearchQuery])

  const albumArtistByName = useMemo(() => {
    const m = {}
    for (const track of queryFilteredPlaylist) {
      const name = track.info.album || 'Singles'
      if (m[name] == null && track.info.artist && track.info.artist !== 'Unknown Artist') {
        m[name] = track.info.artist
      }
    }
    return m
  }, [queryFilteredPlaylist])

  const albumNamesSet = useMemo(() => {
    const s = new Set()
    for (const t of queryFilteredPlaylist) {
      s.add(t.info.album || 'Singles')
    }
    return s
  }, [queryFilteredPlaylist])

  /* Keep album grouping off listMode so switching to Albums does not re-run reduce/sort on the main thread. */
  const albumBuckets = useMemo(() => {
    const groups = queryFilteredPlaylist.reduce((acc, track) => {
      const key = track.info.album || 'Singles'
      if (!acc.has(key)) acc.set(key, [])
      acc.get(key).push(track)
      return acc
    }, new Map())

    return Array.from(groups.entries())
      .map(([name, tracks]) => ({
        name,
        tracks,
        artist:
          tracks.find((t) => t.info.artist && t.info.artist !== 'Unknown Artist')?.info.artist ||
          'Unknown Artist',
        cover: tracks.find((t) => t.info.cover)?.info.cover || null
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [queryFilteredPlaylist])

  const albumGroups = listMode === 'album' ? albumBuckets : []

  /* Folder grouping – extract parent folder from track path */
  const folderBuckets = useMemo(() => {
    const groups = queryFilteredPlaylist.reduce((acc, track) => {
      const parts = (track.path || '').replace(/\\/g, '/').split('/')
      const folderPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '/'
      const folderName = parts.length > 1 ? parts[parts.length - 2] : '/'
      if (!acc.has(folderPath)) acc.set(folderPath, { name: folderName, folderPath, tracks: [] })
      acc.get(folderPath).tracks.push(track)
      return acc
    }, new Map())

    const buckets = Array.from(groups.values())
    if (folderSortMode === 'dateAsc') {
      buckets.sort((a, b) => {
        const aTime = Math.min(...a.tracks.map((t) => t.birthtimeMs || Infinity))
        const bTime = Math.min(...b.tracks.map((t) => t.birthtimeMs || Infinity))
        return aTime - bTime
      })
    } else if (folderSortMode === 'dateDesc') {
      buckets.sort((a, b) => {
        const aTime = Math.min(...a.tracks.map((t) => t.birthtimeMs || Infinity))
        const bTime = Math.min(...b.tracks.map((t) => t.birthtimeMs || Infinity))
        return bTime - aTime
      })
    } else {
      buckets.sort((a, b) => a.name.localeCompare(b.name))
    }
    return buckets
  }, [queryFilteredPlaylist, folderSortMode])

  const folderNamesSet = useMemo(() => {
    const s = new Set()
    for (const b of folderBuckets) s.add(b.folderPath)
    return s
  }, [folderBuckets])

  const folderGroups = listMode === 'folders' ? folderBuckets : []

  const filteredPlaylist = useMemo(() => {
    let result = queryFilteredPlaylist
    if (listMode === 'folders' && selectedFolder !== 'all') {
      result = queryFilteredPlaylist.filter((track) => {
        const parts = (track.path || '').replace(/\\/g, '/').split('/')
        const fp = parts.length > 1 ? parts.slice(0, -1).join('/') : '/'
        return fp === selectedFolder
      })
    } else if (selectedAlbum !== 'all') {
      result = queryFilteredPlaylist
        .filter((track) => track.info.album === selectedAlbum)
        .sort(compareTrackOrder)
    }

    if (listMode === 'songs') {
      const mode = songSortMode
      if (mode === 'dateAsc') {
        return [...result].sort((a, b) => (a.birthtimeMs || Infinity) - (b.birthtimeMs || Infinity))
      } else if (mode === 'dateDesc') {
        return [...result].sort((a, b) => (b.birthtimeMs || 0) - (a.birthtimeMs || 0))
      } else if (mode === 'nameAsc') {
        return [...result].sort((a, b) => a.info.title.localeCompare(b.info.title))
      } else if (mode === 'nameDesc') {
        return [...result].sort((a, b) => b.info.title.localeCompare(a.info.title))
      } else if (mode === 'durationAsc') {
        return [...result].sort(
          (a, b) => (a.info.duration || Infinity) - (b.info.duration || Infinity)
        )
      } else if (mode === 'durationDesc') {
        return [...result].sort((a, b) => (b.info.duration || 0) - (a.info.duration || 0))
      } else if (mode === 'qualityAsc') {
        return [...result].sort(
          (a, b) => (a.info.sizeBytes || Infinity) - (b.info.sizeBytes || Infinity)
        )
      } else if (mode === 'qualityDesc') {
        return [...result].sort((a, b) => (b.info.sizeBytes || 0) - (a.info.sizeBytes || 0))
      }
    }
    return result
  }, [queryFilteredPlaylist, selectedAlbum, selectedFolder, listMode, songSortMode])

  useEffect(() => {
    if (selectedAlbum === 'all') return
    if (!albumNamesSet.has(selectedAlbum)) setSelectedAlbum('all')
  }, [albumNamesSet, selectedAlbum])

  useEffect(() => {
    if (selectedFolder === 'all') return
    if (!folderNamesSet.has(selectedFolder)) setSelectedFolder('all')
  }, [folderNamesSet, selectedFolder])

  const selectedUserPlaylist = useMemo(
    () => userPlaylists.find((p) => p.id === selectedUserPlaylistId) || null,
    [userPlaylists, selectedUserPlaylistId]
  )

  const recentPlayedTracks = useMemo(() => {
    return parsedPlaylist
      .filter((track) => Number(trackStats[track.path]?.lastPlayedAt) > 0)
      .sort((a, b) => {
        const diff =
          Number(trackStats[b.path]?.lastPlayedAt || 0) -
          Number(trackStats[a.path]?.lastPlayedAt || 0)
        if (diff !== 0) return diff
        return a.info.title.localeCompare(b.info.title)
      })
  }, [parsedPlaylist, trackStats])

  const mostPlayedTracks = useMemo(() => {
    return parsedPlaylist
      .filter((track) => Number(trackStats[track.path]?.playCount) > 0)
      .sort((a, b) => {
        const playDiff =
          Number(trackStats[b.path]?.playCount || 0) - Number(trackStats[a.path]?.playCount || 0)
        if (playDiff !== 0) return playDiff
        const recentDiff =
          Number(trackStats[b.path]?.lastPlayedAt || 0) -
          Number(trackStats[a.path]?.lastPlayedAt || 0)
        if (recentDiff !== 0) return recentDiff
        return a.info.title.localeCompare(b.info.title)
      })
  }, [parsedPlaylist, trackStats])

  const likedPathSet = useMemo(() => new Set(likedPaths), [likedPaths])

  const customSmartCollections = useMemo(() => {
    const now = Date.now()
    return userSmartCollections.map((collection) => ({
      ...collection,
      kind: 'custom',
      icon: Wand2,
      tracks: parsedPlaylist.filter((track) =>
        matchTrackAgainstSmartCollection(track, collection.rules, trackStats, likedPathSet, now)
      )
    }))
  }, [userSmartCollections, parsedPlaylist, trackStats, likedPathSet])

  const smartCollections = useMemo(
    () => [
      {
        id: 'recent-played',
        name: t('playlists.recentPlayed', 'Recently played'),
        icon: History,
        kind: 'builtin',
        tracks: recentPlayedTracks
      },
      {
        id: 'most-played',
        name: t('playlists.mostPlayed', 'Most played'),
        icon: Repeat1,
        kind: 'builtin',
        tracks: mostPlayedTracks
      },
      ...customSmartCollections
    ],
    [t, recentPlayedTracks, mostPlayedTracks, customSmartCollections]
  )

  const selectedSmartCollection = useMemo(
    () => smartCollections.find((item) => item.id === selectedSmartCollectionId) || null,
    [smartCollections, selectedSmartCollectionId]
  )

  useEffect(() => {
    if (selectedSmartCollectionId && !selectedSmartCollection) {
      setSelectedSmartCollectionId(null)
    }
  }, [selectedSmartCollectionId, selectedSmartCollection])

  const describeSmartCollectionRules = useCallback(
    (rules) => {
      const normalized = normalizeSmartCollectionRules(rules)
      const items = []
      if (normalized.likedOnly) items.push(t('playlists.smartRuleLikedOnly', 'Liked songs'))
      if (normalized.minPlayCount) {
        items.push(
          t('playlists.smartRuleMinPlayCount', {
            count: normalized.minPlayCount,
            defaultValue: 'Played at least {{count}} times'
          })
        )
      }
      if (normalized.playedWithinDays) {
        items.push(
          t('playlists.smartRulePlayedWithinDays', {
            count: normalized.playedWithinDays,
            defaultValue: 'Played in the last {{count}} days'
          })
        )
      }
      if (normalized.addedWithinDays) {
        items.push(
          t('playlists.smartRuleAddedWithinDays', {
            count: normalized.addedWithinDays,
            defaultValue: 'Added in the last {{count}} days'
          })
        )
      }
      if (normalized.titleIncludes) {
        items.push(
          t('playlists.smartRuleTitleContains', {
            value: normalized.titleIncludes,
            defaultValue: 'Title contains "{{value}}"'
          })
        )
      }
      if (normalized.artistIncludes) {
        items.push(
          t('playlists.smartRuleArtistContains', {
            value: normalized.artistIncludes,
            defaultValue: 'Artist contains "{{value}}"'
          })
        )
      }
      if (normalized.albumIncludes) {
        items.push(
          t('playlists.smartRuleAlbumContains', {
            value: normalized.albumIncludes,
            defaultValue: 'Album contains "{{value}}"'
          })
        )
      }
      return items
    },
    [t]
  )

  const describeSmartCollectionDraft = useCallback(
    (draft) => {
      const normalized = normalizeSmartCollectionDraft(draft)
      const clauses = describeSmartCollectionRules(normalized.rules)
      if (clauses.length === 0) {
        return t(
          'playlists.smartPreviewEmpty',
          'This collection will start matching songs after you add a rule.'
        )
      }
      const joiner =
        normalized.rules.matchMode === 'any'
          ? t('playlists.smartPreviewAnyJoiner', ' or ')
          : t('playlists.smartPreviewAllJoiner', ' and ')
      return t('playlists.smartPreviewSentence', {
        rules: clauses.join(joiner),
        defaultValue: 'This collection will include songs that match {{rules}}.'
      })
    },
    [describeSmartCollectionRules, t]
  )

  const smartCollectionTemplates = useMemo(
    () => [
      {
        id: 'recent-added',
        label: t('playlists.templateRecentAdded', 'Recently added'),
        buildDraft: () => ({
          ...createSmartCollectionTemplateDraft('recent-added'),
          name: t('playlists.templateRecentAdded', 'Recently added')
        })
      },
      {
        id: 'recently-played',
        label: t('playlists.templateRecentListened', 'Recently listened'),
        buildDraft: () => ({
          ...createSmartCollectionTemplateDraft('recently-played'),
          name: t('playlists.templateRecentListened', 'Recently listened')
        })
      },
      {
        id: 'liked',
        label: t('playlists.templateMyLikes', 'My likes'),
        buildDraft: () => ({
          ...createSmartCollectionTemplateDraft('liked'),
          name: t('playlists.templateMyLikes', 'My likes')
        })
      }
    ],
    [t]
  )

  const userPlaylistTracks = useMemo(() => {
    if (!selectedUserPlaylist) return []
    const pathToTrack = new Map(parsedPlaylist.map((t) => [t.path, t]))
    return selectedUserPlaylist.paths.map((p) => pathToTrack.get(p)).filter(Boolean)
  }, [selectedUserPlaylist, parsedPlaylist])

  const smartCollectionTracks = useMemo(() => {
    if (!selectedSmartCollection || listMode !== 'playlists') return []
    return selectedSmartCollection.tracks
  }, [selectedSmartCollection, listMode])

  const playlistDetailFiltered = useMemo(() => {
    if (listMode !== 'playlists' || (!selectedUserPlaylistId && !selectedSmartCollectionId))
      return []
    const q = searchQuery.trim().toLowerCase()
    let list = selectedSmartCollectionId ? smartCollectionTracks : userPlaylistTracks
    if (!q) return list
    return list.filter(({ info }) => {
      return (
        info.fileName.toLowerCase().includes(q) ||
        info.title.toLowerCase().includes(q) ||
        info.artist.toLowerCase().includes(q) ||
        info.album.toLowerCase().includes(q)
      )
    })
  }, [
    userPlaylistTracks,
    smartCollectionTracks,
    searchQuery,
    selectedUserPlaylistId,
    selectedSmartCollectionId,
    listMode
  ])

  const sidebarPlaybackContext = useMemo(() => {
    if (listMode === 'playlists' && selectedUserPlaylistId && selectedUserPlaylist) {
      return createPlaybackContext(
        'userPlaylist',
        selectedUserPlaylistId,
        selectedUserPlaylist.paths
      )
    }
    if (listMode === 'playlists' && selectedSmartCollectionId && selectedSmartCollection) {
      return createPlaybackContext(
        'smartCollection',
        selectedSmartCollectionId,
        smartCollectionTracks.map((track) => track.path)
      )
    }
    return createPlaybackContext('library', 'library', [])
  }, [
    listMode,
    selectedUserPlaylistId,
    selectedUserPlaylist,
    selectedSmartCollectionId,
    selectedSmartCollection,
    smartCollectionTracks
  ])

  const startPlaybackForTrack = useCallback((track, playbackContext = null) => {
    if (!track) return
    setActivePlaybackContext(playbackContext || createPlaybackContext('library', 'library', []))
    setCurrentIndex(track.originalIdx)
    setIsPlaying(true)
  }, [])

  const playPlaylistContextNow = useCallback(
    (options = {}) => {
      const context = sidebarPlaybackContext
      const candidatePaths =
        context.kind === 'library'
          ? getLibraryPlaybackPaths()
          : dedupePathList(context.trackPaths).filter((path) =>
              playlistRef.current.some((track) => track.path === path)
            )

      if (candidatePaths.length === 0) return

      const shuffle = options?.shuffle === true
      const targetPath = shuffle
        ? candidatePaths[Math.floor(Math.random() * candidatePaths.length)]
        : candidatePaths[0]
      const nextIdx = playlistRef.current.findIndex((track) => track.path === targetPath)
      if (nextIdx === -1) return

      setActivePlaybackContext(context)
      setCurrentIndex(nextIdx)
      setIsPlaying(true)
    },
    [sidebarPlaybackContext, getLibraryPlaybackPaths]
  )

  const upNextPreviewTracks = useMemo(() => {
    if (upNextQueue.length === 0) return []
    const pathToTrack = new Map(parsedPlaylist.map((track) => [track.path, track]))
    return upNextQueue.map((item) => pathToTrack.get(item?.path)).filter(Boolean)
  }, [upNextQueue, parsedPlaylist])

  const playbackHistoryEntries = useMemo(() => {
    if (playbackHistory.length === 0) return []
    const pathToTrack = new Map(parsedPlaylist.map((track) => [track.path, track]))
    return playbackHistory
      .map((entry, historyIndex) => {
        const normalizedEntry = normalizePlaybackHistoryEntry(entry)
        if (!normalizedEntry) return null
        return {
          ...normalizedEntry,
          historyIndex,
          track: pathToTrack.get(normalizedEntry.path)
        }
      })
      .filter(Boolean)
      .reverse()
      .sort((a, b) => {
        const timeA = Number(a.playedAt || 0)
        const timeB = Number(b.playedAt || 0)
        if (timeA !== timeB) return timeB - timeA
        return b.historyIndex - a.historyIndex
      })
  }, [playbackHistory, parsedPlaylist, trackStats])

  const tracksForSidebarList = useMemo(() => {
    if (listMode === 'playlists' && (selectedUserPlaylistId || selectedSmartCollectionId)) {
      return playlistDetailFiltered
    }
    return filteredPlaylist
  }, [
    listMode,
    selectedUserPlaylistId,
    selectedSmartCollectionId,
    playlistDetailFiltered,
    filteredPlaylist
  ])

  const tracksForSidebarListFiltered = useMemo(() => {
    if (
      !showLikedOnly ||
      (listMode !== 'songs' &&
        listMode !== 'folders' &&
        !(listMode === 'playlists' && (selectedUserPlaylistId || selectedSmartCollectionId)))
    ) {
      return tracksForSidebarList
    }
    return tracksForSidebarList.filter((t) => likedSet.has(t.path))
  }, [
    tracksForSidebarList,
    showLikedOnly,
    listMode,
    selectedUserPlaylistId,
    selectedSmartCollectionId,
    likedSet
  ])

  const sidebarListIsDetail = useMemo(
    () => listMode === 'playlists' && (selectedUserPlaylistId || selectedSmartCollectionId),
    [listMode, selectedUserPlaylistId, selectedSmartCollectionId]
  )
  const renamableVisibleTracks = useMemo(
    () => tracksForSidebarListFiltered.filter((track) => isLocalAudioFilePath(track?.path)),
    [tracksForSidebarListFiltered]
  )
  const sidebarRowHeight = sidebarListIsDetail ? SIDEBAR_DETAIL_ROW_HEIGHT : SIDEBAR_ROW_HEIGHT
  const [sidebarScrollTop, setSidebarScrollTop] = useState(0)
  const [sidebarViewportHeight, setSidebarViewportHeight] = useState(0)

  const visibleSidebarRange = useMemo(() => {
    const total = tracksForSidebarListFiltered.length
    if (total <= 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        topSpacer: 0,
        bottomSpacer: 0
      }
    }

    const effectiveViewportHeight = Math.max(sidebarViewportHeight, sidebarRowHeight * 8)
    const startIndex = Math.max(
      0,
      Math.floor(sidebarScrollTop / sidebarRowHeight) - SIDEBAR_LIST_OVERSCAN
    )
    const endIndex = Math.min(
      total,
      Math.ceil((sidebarScrollTop + effectiveViewportHeight) / sidebarRowHeight) +
        SIDEBAR_LIST_OVERSCAN
    )

    return {
      startIndex,
      endIndex,
      topSpacer: startIndex * sidebarRowHeight,
      bottomSpacer: Math.max(0, (total - endIndex) * sidebarRowHeight)
    }
  }, [
    tracksForSidebarListFiltered.length,
    sidebarScrollTop,
    sidebarViewportHeight,
    sidebarRowHeight
  ])

  const visibleSidebarTracks = useMemo(
    () =>
      tracksForSidebarListFiltered.slice(
        visibleSidebarRange.startIndex,
        visibleSidebarRange.endIndex
      ),
    [tracksForSidebarListFiltered, visibleSidebarRange]
  )

  useEffect(() => {
    const playlistElement = sidebarPlaylistRef.current
    if (!playlistElement) return undefined

    const syncMetrics = () => {
      setSidebarViewportHeight(playlistElement.clientHeight || 0)
      setSidebarScrollTop(playlistElement.scrollTop || 0)
    }

    syncMetrics()

    if (typeof ResizeObserver === 'undefined') {
      const fallbackId = window.setInterval(syncMetrics, 250)
      return () => clearInterval(fallbackId)
    }

    const ro = new ResizeObserver(() => {
      syncMetrics()
    })
    ro.observe(playlistElement)
    return () => ro.disconnect()
  }, [listMode, selectedUserPlaylistId, selectedSmartCollectionId])

  const handleSidebarScroll = useCallback((event) => {
    setSidebarScrollTop(event.currentTarget.scrollTop || 0)
  }, [])

  const handleQueueDragOver = useCallback(
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!queueDragOver) setQueueDragOver(true)
    },
    [queueDragOver]
  )

  const handleQueueDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === e.target || !e.relatedTarget) setQueueDragOver(false)
  }, [])

  const handleQueueDrop = useCallback(
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      setQueueDragOver(false)
      const path =
        e.dataTransfer.getData('application/x-echo-track-path') ||
        e.dataTransfer.getData('text/plain')
      if (!path) return
      const track = playlistRef.current.find((item) => item.path === path)
      if (!track) return
      enqueueUpNextTrack(track)
    },
    [enqueueUpNextTrack]
  )

  const albumGroupsFiltered = useMemo(() => {
    if (!showLikedOnly || listMode !== 'album') return albumGroups
    return albumGroups
      .map((album) => ({
        ...album,
        tracks: album.tracks.filter((t) => likedSet.has(t.path))
      }))
      .filter((album) => album.tracks.length > 0)
  }, [albumGroups, showLikedOnly, listMode, likedSet])

  const folderGroupsFiltered = useMemo(() => {
    if (!showLikedOnly || listMode !== 'folders') return folderGroups
    return folderGroups
      .map((folder) => ({
        ...folder,
        tracks: folder.tracks.filter((t) => likedSet.has(t.path))
      }))
      .filter((folder) => folder.tracks.length > 0)
  }, [folderGroups, showLikedOnly, listMode, likedSet])
  const selectedFolderGroup = useMemo(() => {
    if (listMode !== 'folders' || selectedFolder === 'all') return null
    return folderGroupsFiltered.find((folder) => folder.folderPath === selectedFolder) || null
  }, [folderGroupsFiltered, listMode, selectedFolder])
  const renameScopeLabel = useMemo(() => {
    if (listMode === 'playlists' && selectedUserPlaylist) return selectedUserPlaylist.name
    if (listMode === 'playlists' && selectedSmartCollection) return selectedSmartCollection.name
    if (listMode === 'folders' && selectedFolderGroup?.name) return selectedFolderGroup.name
    if (listMode === 'album' && selectedAlbum) return selectedAlbum
    if (listMode === 'folders') return t('listMode.folders')
    if (listMode === 'album') return t('listMode.albums')
    return t('listMode.songs')
  }, [
    listMode,
    selectedUserPlaylist,
    selectedSmartCollection,
    selectedFolderGroup,
    selectedAlbum,
    t
  ])

  const forceCloseTrackContextMenu = useCallback(() => {
    if (ctxMenuCloseTimerRef.current) {
      clearTimeout(ctxMenuCloseTimerRef.current)
      ctxMenuCloseTimerRef.current = null
    }
    setCtxMenuVisualOpen(false)
    setTrackContextMenu(null)
  }, [])

  const closeTrackContextMenuAnimated = useCallback(() => {
    setCtxMenuVisualOpen(false)
    if (ctxMenuCloseTimerRef.current) clearTimeout(ctxMenuCloseTimerRef.current)
    ctxMenuCloseTimerRef.current = window.setTimeout(() => {
      setTrackContextMenu(null)
      ctxMenuCloseTimerRef.current = null
    }, MENU_ANIM_MS)
  }, [])

  const forceCloseCoverContextMenu = useCallback(() => {
    if (coverCtxCloseTimerRef.current) {
      clearTimeout(coverCtxCloseTimerRef.current)
      coverCtxCloseTimerRef.current = null
    }
    setCoverCtxVisualOpen(false)
    setCoverContextMenu(null)
  }, [])

  const closeCoverContextMenuAnimated = useCallback(() => {
    setCoverCtxVisualOpen(false)
    if (coverCtxCloseTimerRef.current) clearTimeout(coverCtxCloseTimerRef.current)
    coverCtxCloseTimerRef.current = window.setTimeout(() => {
      setCoverContextMenu(null)
      coverCtxCloseTimerRef.current = null
    }, MENU_ANIM_MS)
  }, [])

  const forceCloseGroupContextMenu = useCallback(() => {
    if (groupCtxCloseTimerRef.current) {
      clearTimeout(groupCtxCloseTimerRef.current)
      groupCtxCloseTimerRef.current = null
    }
    setGroupCtxVisualOpen(false)
    setGroupContextMenu(null)
  }, [])

  const closeGroupContextMenuAnimated = useCallback(() => {
    setGroupCtxVisualOpen(false)
    if (groupCtxCloseTimerRef.current) clearTimeout(groupCtxCloseTimerRef.current)
    groupCtxCloseTimerRef.current = window.setTimeout(() => {
      setGroupContextMenu(null)
      groupCtxCloseTimerRef.current = null
    }, MENU_ANIM_MS)
  }, [])

  const forceCloseAddToPlaylistMenu = useCallback(() => {
    if (addPlCloseTimerRef.current) {
      clearTimeout(addPlCloseTimerRef.current)
      addPlCloseTimerRef.current = null
    }
    setAddPlVisualOpen(false)
    setAddToPlaylistMenu(null)
  }, [])

  const closeAddToPlaylistAnimated = useCallback(() => {
    setAddPlVisualOpen(false)
    if (addPlCloseTimerRef.current) clearTimeout(addPlCloseTimerRef.current)
    addPlCloseTimerRef.current = window.setTimeout(() => {
      setAddToPlaylistMenu(null)
      addPlCloseTimerRef.current = null
    }, MENU_ANIM_MS)
  }, [])

  const handleListMode = useCallback(
    (mode) => {
      startTransition(() => {
        forceCloseTrackContextMenu()
        forceCloseCoverContextMenu()
        forceCloseGroupContextMenu()
        setListMode(mode)
        if (mode !== 'playlists') {
          setSelectedUserPlaylistId(null)
          setSelectedSmartCollectionId(null)
          setPlaylistLibraryMoreOpen(false)
        }
        forceCloseAddToPlaylistMenu()
      })
    },
    [
      forceCloseTrackContextMenu,
      forceCloseCoverContextMenu,
      forceCloseGroupContextMenu,
      forceCloseAddToPlaylistMenu
    ]
  )

  const handlePickAlbumFromSidebar = useCallback(
    (album) => {
      setSelectedAlbum(album.name)
      handleListMode('songs')
    },
    [handleListMode]
  )

  const handlePickFolderFromSidebar = useCallback((folder) => {
    setSelectedFolder(folder.folderPath)
    setSelectedSmartCollectionId(null)
    setListMode('folders')
  }, [])

  const openSmartCollection = useCallback((collectionId) => {
    setSelectedUserPlaylistId(null)
    setSelectedSmartCollectionId(collectionId)
    setListMode('playlists')
  }, [])

  const resetSmartCollectionEditor = useCallback(() => {
    setSmartCollectionDraft(
      createSmartCollectionDraft({ rules: createEmptySmartCollectionRules() })
    )
    setEditingSmartCollectionId(null)
    setSmartCollectionEditorOpen(false)
  }, [])

  const openCreateSmartCollectionEditor = useCallback(() => {
    setEditingSmartCollectionId(null)
    setSmartCollectionDraft(
      createSmartCollectionDraft({ rules: createEmptySmartCollectionRules() })
    )
    setSmartCollectionEditorOpen(true)
  }, [])

  const openEditSmartCollectionEditor = useCallback(
    (collectionId) => {
      const target = userSmartCollections.find((item) => item.id === collectionId)
      if (!target) return
      setEditingSmartCollectionId(collectionId)
      setSmartCollectionDraft(createSmartCollectionDraft(target))
      setSmartCollectionEditorOpen(true)
      setSelectedUserPlaylistId(null)
      setSelectedSmartCollectionId(null)
      setListMode('playlists')
    },
    [userSmartCollections]
  )

  const createSmartCollectionFromDraft = useCallback(
    (draft, options = {}) => {
      const normalized = normalizeSmartCollectionDraft(draft)
      if (!normalized.name) {
        alert(t('playlists.smartNameRequired', 'Enter a name for the smart collection.'))
        return false
      }
      if (!hasActiveSmartCollectionRules(normalized.rules)) {
        alert(
          t(
            'playlists.smartRulesRequired',
            'Add at least one rule so this smart collection knows what to match.'
          )
        )
        return false
      }

      const nextId = options.id || crypto.randomUUID()
      const finalName = options.keepName
        ? normalized.name
        : createUniqueSmartCollectionName(normalized.name, userSmartCollections)
      setUserSmartCollections((prev) => {
        const nextItem = { id: nextId, name: finalName, rules: normalized.rules }
        if (options.id) return prev.map((item) => (item.id === options.id ? nextItem : item))
        return [...prev, nextItem]
      })
      setSelectedUserPlaylistId(null)
      setSelectedSmartCollectionId(nextId)
      setListMode('playlists')
      return true
    },
    [t, userSmartCollections]
  )

  const applySmartCollectionTemplate = useCallback(
    (templateBuilder) => {
      setEditingSmartCollectionId(null)
      setSmartCollectionEditorOpen(false)
      createSmartCollectionFromDraft(templateBuilder())
    },
    [createSmartCollectionFromDraft]
  )

  const saveSmartCollectionDraft = useCallback(() => {
    const ok = createSmartCollectionFromDraft(smartCollectionDraft, {
      id: editingSmartCollectionId || null,
      keepName: Boolean(editingSmartCollectionId)
    })
    if (ok) resetSmartCollectionEditor()
  }, [
    smartCollectionDraft,
    editingSmartCollectionId,
    createSmartCollectionFromDraft,
    resetSmartCollectionEditor
  ])

  const deleteSmartCollection = useCallback(
    (id) => {
      if (!confirm(t('playlists.confirmDeleteSmartCollection', 'Delete this smart collection?'))) {
        return
      }
      setUserSmartCollections((prev) => prev.filter((item) => item.id !== id))
      setSelectedSmartCollectionId((cur) => (cur === id ? null : cur))
      if (editingSmartCollectionId === id) {
        resetSmartCollectionEditor()
      }
    },
    [editingSmartCollectionId, resetSmartCollectionEditor, t]
  )

  const openGroupContextMenu = useCallback(
    (e, type, group) => {
      e.preventDefault()
      e.stopPropagation()
      setFolderSortOpen(false)
      forceCloseAddToPlaylistMenu()
      forceCloseTrackContextMenu()
      forceCloseCoverContextMenu()
      setGroupContextMenu({
        clientX: e.clientX,
        clientY: e.clientY,
        type,
        group
      })
    },
    [forceCloseAddToPlaylistMenu, forceCloseTrackContextMenu, forceCloseCoverContextMenu]
  )

  const openCoverContextMenu = useCallback(
    (e) => {
      if (!currentTrack) return
      e.preventDefault()
      e.stopPropagation()
      forceCloseCoverContextMenu()
      forceCloseAddToPlaylistMenu()
      forceCloseTrackContextMenu()
      forceCloseGroupContextMenu()
      setCoverContextMenu({
        clientX: e.clientX,
        clientY: e.clientY,
        track: currentTrack
      })
    },
    [
      currentTrack,
      forceCloseCoverContextMenu,
      forceCloseAddToPlaylistMenu,
      forceCloseTrackContextMenu,
      forceCloseGroupContextMenu
    ]
  )

  const playGroupNow = useCallback(
    (type, group) => {
      const firstTrack = group?.tracks?.[0]
      if (!firstTrack) return
      const groupKey = type === 'album' ? group?.name || 'album' : group?.folderPath || 'folder'
      const playbackContext = createPlaybackContext(
        type === 'album' ? 'albumGroup' : 'folderGroup',
        groupKey,
        (group?.tracks || []).map((track) => track.path)
      )
      if (type === 'album') {
        handlePickAlbumFromSidebar(group)
      } else if (type === 'folder') {
        handlePickFolderFromSidebar(group)
      }
      setActivePlaybackContext(playbackContext)
      setCurrentIndex(firstTrack.originalIdx)
      setIsPlaying(true)
      closeGroupContextMenuAnimated()
    },
    [handlePickAlbumFromSidebar, handlePickFolderFromSidebar, closeGroupContextMenuAnimated]
  )

  const queueGroupNext = useCallback(
    (group) => {
      enqueueUpNextTracks(group?.tracks || [])
      closeGroupContextMenuAnimated()
    },
    [enqueueUpNextTracks, closeGroupContextMenuAnimated]
  )

  const revealGroupInExplorer = useCallback(
    async (type, group) => {
      try {
        if (type === 'folder' && isLocalAudioFilePath(group?.folderPath) && window.api?.openPath) {
          const r = await window.api.openPath(group.folderPath)
          if (r && r.ok === false && r.error) {
            alert(t('contextMenu.actionFailed', { detail: r.error }))
          }
          closeGroupContextMenuAnimated()
          return
        }

        const firstLocalTrack = (group?.tracks || []).find((track) =>
          isLocalAudioFilePath(track?.path)
        )
        if (!firstLocalTrack?.path || !window.api?.showItemInFolder) {
          alert(t('contextMenu.actionFailed', { detail: 'path_unavailable' }))
          return
        }

        const r = await window.api.showItemInFolder(firstLocalTrack.path)
        if (r && r.ok === false && r.error) {
          alert(t('contextMenu.actionFailed', { detail: r.error }))
        }
      } catch (err) {
        alert(t('contextMenu.actionFailed', { detail: err?.message || String(err) }))
      }
      closeGroupContextMenuAnimated()
    },
    [closeGroupContextMenuAnimated, t]
  )

  const addPathToUserPlaylist = useCallback(
    (playlistId, path) => {
      if (!path) return
      setUserPlaylists((prev) =>
        prev.map((p) =>
          p.id === playlistId
            ? {
                ...p,
                paths: p.paths.includes(path) ? p.paths : [...p.paths, path]
              }
            : p
        )
      )
      closeAddToPlaylistAnimated()
    },
    [closeAddToPlaylistAnimated]
  )

  const removePathFromUserPlaylist = useCallback((playlistId, path) => {
    setUserPlaylists((prev) =>
      prev.map((p) =>
        p.id === playlistId ? { ...p, paths: p.paths.filter((x) => x !== path) } : p
      )
    )
  }, [])

  const submitNewPlaylistFromToolbar = useCallback(() => {
    const name = newPlaylistName.trim()
    if (!name) return
    const id = crypto.randomUUID()
    setUserPlaylists((prev) => [...prev, { id, name, paths: [] }])
    setNewPlaylistName('')
    setSelectedSmartCollectionId(null)
    setSelectedUserPlaylistId(id)
  }, [newPlaylistName])

  const updateSmartCollectionDraftField = useCallback((field, value) => {
    setSmartCollectionDraft((prev) => ({ ...prev, [field]: value }))
  }, [])

  const openAddToPlaylistPopover = useCallback(
    (e, track) => {
      e.stopPropagation()
      forceCloseTrackContextMenu()
      forceCloseGroupContextMenu()
      if (addToPlaylistMenu?.originalIdx === track.originalIdx) {
        closeAddToPlaylistAnimated()
        return
      }
      const r = e.currentTarget.getBoundingClientRect()
      const w = 268
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8))
      const menuH = 300
      let top = r.bottom + 8
      if (top + menuH > window.innerHeight - 12) {
        top = Math.max(12, r.top - menuH - 8)
      }
      setAddToPlaylistMenu({
        originalIdx: track.originalIdx,
        path: track.path,
        top,
        left,
        width: w
      })
    },
    [
      addToPlaylistMenu,
      forceCloseTrackContextMenu,
      forceCloseGroupContextMenu,
      closeAddToPlaylistAnimated
    ]
  )

  const openAddToPlaylistAtPoint = useCallback(
    (clientX, clientY, track) => {
      const w = 268
      const left = Math.max(8, Math.min(clientX, window.innerWidth - w - 8))
      const menuH = 300
      let top = clientY + 4
      if (top + menuH > window.innerHeight - 12) {
        top = Math.max(12, clientY - menuH - 4)
      }
      forceCloseTrackContextMenu()
      forceCloseGroupContextMenu()
      setAddToPlaylistMenu({
        originalIdx: track.originalIdx,
        path: track.path,
        top,
        left,
        width: w
      })
    },
    [forceCloseTrackContextMenu, forceCloseGroupContextMenu]
  )

  const createPlaylistAndAddTrackFromPopover = useCallback(() => {
    const name = quickNewPlaylistName.trim()
    if (!name || !addToPlaylistMenu?.path) return
    const id = crypto.randomUUID()
    setUserPlaylists((prev) => [...prev, { id, name, paths: [addToPlaylistMenu.path] }])
    closeAddToPlaylistAnimated()
    setQuickNewPlaylistName('')
  }, [quickNewPlaylistName, addToPlaylistMenu, closeAddToPlaylistAnimated])

  useEffect(() => {
    if (!addToPlaylistMenu) {
      setQuickNewPlaylistName('')
      setAddPlVisualOpen(false)
      return
    }
    if (addPlCloseTimerRef.current) {
      clearTimeout(addPlCloseTimerRef.current)
      addPlCloseTimerRef.current = null
    }
    setAddPlVisualOpen(false)
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setAddPlVisualOpen(true))
    })
    const onKey = (e) => {
      if (e.key === 'Escape') closeAddToPlaylistAnimated()
    }
    const onResize = () => forceCloseAddToPlaylistMenu()
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    document.addEventListener('scroll', onResize, true)
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('scroll', onResize, true)
    }
  }, [addToPlaylistMenu, closeAddToPlaylistAnimated, forceCloseAddToPlaylistMenu])

  useEffect(() => {
    if (!trackContextMenu) {
      setCtxMenuVisualOpen(false)
      return
    }
    if (ctxMenuCloseTimerRef.current) {
      clearTimeout(ctxMenuCloseTimerRef.current)
      ctxMenuCloseTimerRef.current = null
    }
    setCtxMenuVisualOpen(false)
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setCtxMenuVisualOpen(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [trackContextMenu])

  useEffect(() => {
    if (!coverContextMenu) {
      setCoverCtxVisualOpen(false)
      return
    }
    if (coverCtxCloseTimerRef.current) {
      clearTimeout(coverCtxCloseTimerRef.current)
      coverCtxCloseTimerRef.current = null
    }
    setCoverCtxVisualOpen(false)
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setCoverCtxVisualOpen(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [coverContextMenu])

  useEffect(() => {
    if (!groupContextMenu) {
      setGroupCtxVisualOpen(false)
      return
    }
    if (groupCtxCloseTimerRef.current) {
      clearTimeout(groupCtxCloseTimerRef.current)
      groupCtxCloseTimerRef.current = null
    }
    setGroupCtxVisualOpen(false)
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setGroupCtxVisualOpen(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [groupContextMenu])

  useEffect(() => {
    if (!trackContextMenu) return
    const onKey = (e) => {
      if (e.key === 'Escape') closeTrackContextMenuAnimated()
    }
    const onPointerDown = (e) => {
      const el = trackContextMenuRef.current
      if (el && !el.contains(e.target)) closeTrackContextMenuAnimated()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [trackContextMenu, closeTrackContextMenuAnimated])

  useEffect(() => {
    if (!coverContextMenu) return
    const onKey = (e) => {
      if (e.key === 'Escape') closeCoverContextMenuAnimated()
    }
    const onPointerDown = (e) => {
      const el = coverContextMenuRef.current
      if (el && !el.contains(e.target)) closeCoverContextMenuAnimated()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [coverContextMenu, closeCoverContextMenuAnimated])

  useEffect(() => {
    if (!groupContextMenu) return
    const onKey = (e) => {
      if (e.key === 'Escape') closeGroupContextMenuAnimated()
    }
    const onPointerDown = (e) => {
      const el = groupContextMenuRef.current
      if (el && !el.contains(e.target)) closeGroupContextMenuAnimated()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [groupContextMenu, closeGroupContextMenuAnimated])

  useEffect(() => {
    if (!playlistLibraryMoreOpen) return
    const onDocMouseDown = (e) => {
      if (playlistLibraryMoreRef.current && !playlistLibraryMoreRef.current.contains(e.target)) {
        setPlaylistLibraryMoreOpen(false)
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setPlaylistLibraryMoreOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [playlistLibraryMoreOpen])

  useEffect(() => {
    if (!folderSortOpen) return
    const onDocMouseDown = (e) => {
      if (folderSortRef.current && !folderSortRef.current.contains(e.target)) {
        setFolderSortOpen(false)
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setFolderSortOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [folderSortOpen])

  useEffect(() => {
    if (!songSortOpen) return
    const onDocMouseDown = (e) => {
      if (songSortRef.current && !songSortRef.current.contains(e.target)) {
        setSongSortOpen(false)
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setSongSortOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [songSortOpen])

  useEffect(() => {
    if (!historyMenuOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') setHistoryMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [historyMenuOpen])

  const deleteUserPlaylist = useCallback(
    (id) => {
      if (!confirm(t('playlists.confirmDelete'))) return
      setUserPlaylists((prev) => prev.filter((p) => p.id !== id))
      setSelectedUserPlaylistId((cur) => (cur === id ? null : cur))
    },
    [t]
  )

  const renameUserPlaylist = useCallback(
    (id) => {
      const pl = userPlaylists.find((p) => p.id === id)
      if (!pl) return
      const name = window.prompt(t('playlists.promptRename'), pl.name)
      if (!name || !String(name).trim()) return
      setUserPlaylists((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: String(name).trim() } : p))
      )
    },
    [userPlaylists, t]
  )

  const libraryTrackByPath = useMemo(() => {
    const next = Object.create(null)
    for (const track of playlist) {
      if (track?.path) next[track.path] = track
    }
    return next
  }, [playlist])

  const buildExportTrackFromPath = useCallback(
    async (trackPath) => {
      if (!trackPath || typeof trackPath !== 'string') return null
      const existingTrack = libraryTrackByPath[trackPath]
      const fallbackName = trackPath.split(/[/\\]/).pop() || trackPath
      const baseTrack = existingTrack || { path: trackPath, name: fallbackName }
      const info = parseTrackInfo(baseTrack, trackMetaMap[trackPath])
      let sourceUrl =
        typeof existingTrack?.sourceUrl === 'string' && existingTrack.sourceUrl.trim()
          ? existingTrack.sourceUrl.trim()
          : typeof existingTrack?.mvOriginUrl === 'string' && existingTrack.mvOriginUrl.trim()
            ? existingTrack.mvOriginUrl.trim()
            : ''

      if (!sourceUrl && window.api?.readInfoJsonHandler) {
        const infoJson = await window.api.readInfoJsonHandler(trackPath).catch(() => null)
        const maybeUrl =
          (typeof infoJson?.webpage_url === 'string' && infoJson.webpage_url.trim()) ||
          (typeof infoJson?.original_url === 'string' && infoJson.original_url.trim()) ||
          (typeof infoJson?.url === 'string' && /^https?:\/\//i.test(infoJson.url)
            ? infoJson.url.trim()
            : '')
        if (maybeUrl) sourceUrl = maybeUrl
      }

      return {
        path: trackPath,
        title: info?.title || stripExtension(baseTrack.name || fallbackName) || fallbackName,
        artist: info?.artist && info.artist !== 'Unknown Artist' ? info.artist : '',
        ...(sourceUrl ? { sourceUrl } : {})
      }
    },
    [libraryTrackByPath, trackMetaMap]
  )

  const buildPlaylistsExportJson = useCallback(
    async (playlistsToExport) => {
      const enrichedPlaylists = await Promise.all(
        (playlistsToExport || []).map(async (playlistItem) => {
          const paths = Array.isArray(playlistItem?.paths) ? playlistItem.paths : []
          const tracks = (
            await Promise.all(paths.map((trackPath) => buildExportTrackFromPath(trackPath)))
          ).filter(Boolean)
          return {
            name: playlistItem?.name || 'Playlist',
            paths,
            tracks
          }
        })
      )
      return JSON.stringify(buildPlaylistsExportPayload(enrichedPlaylists), null, 2)
    },
    [buildExportTrackFromPath]
  )

  const exportNamedUserPlaylists = useCallback(
    async (playlistsToExport, defaultName) => {
      const json = await buildPlaylistsExportJson(playlistsToExport)
      const r = await window.api.saveThemeJsonHandler(json, defaultName, configRef.current.uiLocale)
      if (r && r.success === false && r.error) alert(r.error)
    },
    [buildPlaylistsExportJson]
  )

  const exportUserPlaylists = useCallback(async () => {
    await exportNamedUserPlaylists(userPlaylists, 'echoes-playlists.json')
  }, [exportNamedUserPlaylists, userPlaylists])

  const importUserPlaylists = useCallback(async () => {
    const r = await window.api.openThemeJsonHandler(configRef.current.uiLocale)
    if (r?.error) {
      alert(r.error)
      return
    }
    if (!r?.content) return
    try {
      const data = JSON.parse(r.content)
      const imported = normalizeImportedPlaylists(data)
      if (!imported.length) {
        alert(t('playlists.noPlaylistsInFile'))
        return
      }
      setUserPlaylists((prev) => [...prev, ...imported])
    } catch (e) {
      alert(e.message || String(e))
    }
  }, [t])

  const addAllLibraryVisibleToPlaylist = useCallback(() => {
    if (!selectedUserPlaylistId) return
    const paths = queryFilteredPlaylist.map((t) => t.path)
    setUserPlaylists((prev) =>
      prev.map((p) =>
        p.id === selectedUserPlaylistId ? { ...p, paths: [...new Set([...p.paths, ...paths])] } : p
      )
    )
  }, [selectedUserPlaylistId, queryFilteredPlaylist])

  const importAudioIntoSelectedUserPlaylist = async () => {
    if (!selectedUserPlaylistId) return
    const files = await window.api.openFileHandler(configRef.current.uiLocale)
    if (!files || files.length === 0) return
    const paths = await processFiles(files)
    if (paths.length === 0) return
    setUserPlaylists((prev) =>
      prev.map((p) =>
        p.id === selectedUserPlaylistId ? { ...p, paths: [...new Set([...p.paths, ...paths])] } : p
      )
    )
  }

  // Discord Rich Presence（单一同步源：enable + show 均开才上报）
  useEffect(() => {
    if (!window.api?.setDiscordActivity) return

    if (!config.enableDiscordRPC || !config.showDiscordRPC) {
      window.api.clearDiscordActivity()
      return
    }

    if (currentIndex >= 0 && playlist[currentIndex]) {
      const track = playlist[currentIndex]
      const rawName = track.name.replace(/\.[^/.]+$/, '')
      const title = (metadata.title && metadata.title.trim()) || rawName
      const artist = (metadata.artist && metadata.artist.trim()) || track?.info?.artist || 'ECHO'

      window.api.setDiscordActivity({
        title,
        artist,
        isPlaying,
        playbackRate: playbackRate.toFixed(2),
        coverUrl,
        startTimestamp: isPlaying
          ? Math.floor(Date.now() - (currentTime * 1000) / playbackRate)
          : null,
        endTimestamp: isPlaying
          ? Math.floor(Date.now() + ((duration - currentTime) * 1000) / playbackRate)
          : null
      })
    } else {
      window.api.clearDiscordActivity()
    }
  }, [
    currentIndex,
    playlist,
    metadata.title,
    metadata.artist,
    isPlaying,
    playbackRate,
    config.enableDiscordRPC,
    config.showDiscordRPC,
    coverUrl,
    duration,
    currentTime
  ])

  // Sync Discord Toggle with Main Process
  useEffect(() => {
    if (window.api?.toggleDiscordRPC) {
      window.api.toggleDiscordRPC(config.enableDiscordRPC)
    }
  }, [config.enableDiscordRPC])

  // Compute inline style for lyrics panel when immersive MV background is enabled
  const lyricsPanelStyle = React.useMemo(() => {
    if (!(config.mvAsBackground && mvId && showLyrics)) return {}

    const useShadow = config.lyricsShadow !== undefined ? config.lyricsShadow : true
    const opa = config.lyricsShadowOpacity !== undefined ? config.lyricsShadowOpacity : 0.6

    if (!useShadow) {
      return {
        background: 'transparent',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        border: 'none',
        boxShadow: 'none'
      }
    }

    // When shadow enabled, we used to show blur, but user wants it GONE for MV clarity.
    // We will only use a very faint dark gradient at the bottom/top if needed, or just transparent.
    return {
      background: 'transparent',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      border: 'none',
      boxShadow: 'none'
    }
  }, [
    config.mvAsBackground,
    config.lyricsShadow,
    config.lyricsShadowOpacity,
    config.uiBlur,
    mvId,
    showLyrics
  ])

  const hideImmersiveMvChrome = useMemo(
    () => showLyrics && Boolean(mvId) && config.mvAsBackground && config.mvHideImmersiveChrome,
    [showLyrics, mvId, config.mvAsBackground, config.mvHideImmersiveChrome]
  )

  /** Full-bleed MV or custom wallpaper behind lyrics — need high-contrast chrome + lyric text */
  const brightLyricsBackdrop = useMemo(
    () => Boolean(showLyrics) && ((config.mvAsBackground && mvId) || Boolean(config.customBgPath)),
    [showLyrics, config.mvAsBackground, mvId, config.customBgPath]
  )

  useEffect(() => {
    if (!hideImmersiveMvChrome) return undefined
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowLyrics(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hideImmersiveMvChrome])

  // Visualizer Animation — subsampled bars + cached gradient (see MiniWaveform pattern)
  useEffect(() => {
    if (!config.showVisualizer || !isPlaying || view === 'settings') {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      return
    }

    const accent = activeAccentHex

    const render = () => {
      if (!canvasRef.current || !analyserNode.current) return
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      const bufferLength = analyserNode.current.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)

      analyserNode.current.getByteFrequencyData(dataArray)

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const barSlots = Math.min(72, Math.max(32, Math.floor(bufferLength / 6)))
      const barWidth = canvas.width / barSlots - 1
      let x = 0

      const gradKey = `${accent}|${canvas.width}|${canvas.height}`
      let gradient = visualizerGradientRef.current.gradient
      if (visualizerGradientRef.current.key !== gradKey) {
        gradient = ctx.createLinearGradient(0, canvas.height, 0, 0)
        gradient.addColorStop(0, hexToRgbaString(accent, 0.2))
        gradient.addColorStop(0.5, hexToRgbaString(accent, 0.6))
        gradient.addColorStop(1, hexToRgbaString(accent, 1))
        visualizerGradientRef.current = { key: gradKey, gradient }
      }

      for (let s = 0; s < barSlots; s++) {
        const i = Math.min(bufferLength - 1, Math.floor((s / barSlots) * bufferLength))
        const barHeight = (dataArray[i] / 255) * canvas.height
        ctx.fillStyle = gradient
        ctx.fillRect(x, canvas.height - barHeight, Math.max(1, barWidth), barHeight)
        x += barWidth + 1
      }

      animationRef.current = requestAnimationFrame(render)
    }

    render()
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [config.showVisualizer, isPlaying, view, activeAccentHex])

  const renderMvIframe = (mvObj, isBackground) => {
    if (!mvObj || !mvObj.id) return null

    const ytHost = 'https://www.youtube.com'
    const pageOrigin =
      typeof window !== 'undefined'
        ? window.location?.origin || 'https://www.youtube.com'
        : 'https://www.youtube.com'
    const ytOrigin = encodeURIComponent(pageOrigin)

    const qualitySetting = config.mvQuality || 'high'
    const biliQualityMap = { high: 80, medium: 64, low: 16 }
    const ytVqMap = { high: 'hd1080', medium: 'hd720', low: 'small' }
    const biliQuality = biliQualityMap[qualitySetting] || 80
    const ytVq = ytVqMap[qualitySetting] || 'hd1080'

    if (mvObj.source === 'bilibili') {
      if (biliDirectStream?.videoUrl) {
        const videoMuted = biliDirectStream.format === 'dash' || config.mvMuted || isAudioExclusive
        return (
          <>
            <video
              key={`bili_direct_v_${isAudioExclusive ? 'exc' : 'shared'}`}
              ref={isBackground ? biliBackgroundVideoRef : biliVideoRef}
              src={biliDirectStream.videoUrl}
              autoPlay
              muted={videoMuted}
              loop
              playsInline
              style={
                isBackground
                  ? {
                      width: '100%',
                      height: '100%',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      objectFit: 'cover'
                    }
                  : {}
              }
              className={isBackground ? '' : 'mv-iframe mv-direct-video'}
              onError={() => {
                console.warn('[Bilibili Video] Playback error, falling back to embed')
                setBiliDirectStream(null)
              }}
            />
            {biliDirectStream.format === 'dash' &&
              biliDirectStream.audioUrl &&
              !config.mvMuted &&
              !isAudioExclusive && (
                <audio
                  ref={biliAudioRef}
                  src={biliDirectStream.audioUrl}
                  autoPlay
                  loop
                  onLoadedMetadata={() => {
                    const vEl = biliVideoRef.current || biliBackgroundVideoRef.current
                    if (vEl && biliAudioRef.current) {
                      biliAudioRef.current.currentTime = vEl.currentTime
                    }
                  }}
                />
              )}
          </>
        )
      }
      return (
        <iframe
          ref={isBackground ? ytBackgroundIframeRef : ytIframeRef}
          src={`https://player.bilibili.com/player.html?bvid=${mvObj.id}&autoplay=1&muted=${config.mvMuted || isAudioExclusive ? 1 : 0}&high_quality=${qualitySetting === 'low' ? 0 : 1}&quality=${biliQuality}&danmaku=0`}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={
            isBackground
              ? {
                  width: '100%',
                  height: '100%',
                  position: 'absolute',
                  top: 0,
                  left: 0
                }
              : {}
          }
          className={isBackground ? '' : 'mv-iframe'}
        />
      )
    }

    return (
      <iframe
        ref={isBackground ? ytBackgroundIframeRef : ytIframeRef}
        src={`${ytHost}/embed/${mvObj.id}?autoplay=1&mute=${config.mvMuted || isAudioExclusive ? 1 : 0}&controls=0&disablekb=1&fs=0&loop=1&playlist=${mvObj.id}&modestbranding=1&enablejsapi=1&playsinline=1&rel=0&vq=${ytVq}&origin=${ytOrigin}&widgetid=${isBackground ? 2 : 1}`}
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        style={
          isBackground
            ? {
                width: '100%',
                height: '100%',
                position: 'absolute',
                top: 0,
                left: 0
              }
            : {}
        }
        className={isBackground ? '' : 'mv-iframe'}
        onLoad={() => {
          ytReadyRef.current = false

          const iframe = isBackground ? ytBackgroundIframeRef.current : ytIframeRef.current
          if (iframe?.contentWindow && mvObj.source !== 'bilibili') {
            iframe.contentWindow.postMessage(
              JSON.stringify({
                event: 'listening',
                id: isBackground ? 'yt-bg' : 'yt-main',
                channel: 'widget'
              }),
              '*'
            )

            // 某些打包环境下 onError 不一定会被稳定上报；加一层超时兜底（提示登录 + 可选 B 站降级）。
            if (mvObj.source === 'youtube') {
              if (ytFallbackTimerRef.current) {
                clearTimeout(ytFallbackTimerRef.current)
              }
              ytFallbackTimerRef.current = setTimeout(() => {
                if (!ytReadyRef.current) {
                  setYoutubeMvLoginHint(true)
                  if (config.autoFallbackToBilibili) {
                    triggerAutoMvFallback('youtube-timeout-no-ready')
                  }
                }
              }, 5000)
            }
          }

          syncYTVideo(currentTime)
          if (!isPlaying) {
            if (iframe?.contentWindow && mvObj.source !== 'bilibili') {
              iframe.contentWindow.postMessage(
                JSON.stringify({
                  event: 'command',
                  func: 'pauseVideo',
                  args: []
                }),
                '*'
              )
            }
          }
        }}
      />
    )
  }

  const [isListenTogetherLoading, setIsListenTogetherLoading] = useState(false)

  const handleHostUploadStart = useCallback(() => {
    setIsPlaying(false)
    setIsListenTogetherLoading(true)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setCurrentTime(0)
  }, [])

  const handleHostPlayAfterBuffer = useCallback(() => {
    setIsListenTogetherLoading(false)
    setIsPlaying(true)
    if (audioRef.current) {
      audioRef.current.play().catch(console.error)
    }
  }, [])

  const handleHostUploadEnd = useCallback(() => {
    setIsListenTogetherLoading(false)
  }, [])

  const handleListenTogetherRemoteState = useCallback(
    ({ roomState, memberId, force = false, syncOffsetMs = 0, forceSeekThresholdSec = 2 }) => {
      setListenTogetherRoomState(roomState || null)
      const playback = roomState?.playback
      if (!playback?.streamUrl) return
      const isHost = !!memberId && roomState?.hostId === memberId
      if (isHost) return
      // Keep UI metadata in sync for members even without local track objects.
      setMetadata((prev) => ({
        ...prev,
        title: playback.title || prev.title || '',
        artist: playback.artist || prev.artist || ''
      }))
      if (playback.syncCover && playback.coverUrl) {
        setCoverUrl(playback.coverUrl)
      }
      if (playback.syncMv && playback.mvSync?.id) {
        setMvId({ id: playback.mvSync.id, source: playback.mvSync.source || 'youtube' })
      }
      if (
        playback.syncLyrics &&
        Array.isArray(playback.syncedLyrics) &&
        playback.syncedLyrics.length
      ) {
        setLyrics(playback.syncedLyrics)
        setLyricsMatchStatus('matched')
      }
      const streamUrl = playback.streamUrl
      const trackId = (playback.trackId || '').trim()
      const audio = audioRef.current
      if (!audio) return
      const syncState = listenTogetherSyncRef.current

      if (
        syncState.trackId !== trackId ||
        syncState.streamUrl !== streamUrl ||
        audio.src !== streamUrl
      ) {
        syncState.trackId = trackId
        syncState.streamUrl = streamUrl
        syncState.isPlaying = null
        syncState.lastSeekAt = 0
        try {
          audio.pause()
        } catch {}
        try {
          audio.src = streamUrl
          audio.load()
        } catch {}
      }

      const expectedPos = Number(playback.positionSec || 0) + Number(syncOffsetMs || 0) / 1000
      const now = Date.now()
      if (Number.isFinite(expectedPos) && audio.readyState >= 1) {
        const diff = Math.abs((audio.currentTime || 0) - expectedPos)
        const seekThreshold = Math.max(0.5, Number(forceSeekThresholdSec || 2))
        if ((force || diff > seekThreshold) && now - syncState.lastSeekAt > 1800) {
          try {
            audio.currentTime = Math.max(0, expectedPos)
            syncState.lastSeekAt = now
          } catch {}
        }
      }

      if (playback.isPlaying !== syncState.isPlaying) {
        syncState.isPlaying = !!playback.isPlaying
        if (playback.isPlaying) {
          audio.play().catch(() => {})
          setIsPlaying(true)
        } else {
          try {
            audio.pause()
          } catch {}
          setIsPlaying(false)
        }
      }
    },
    []
  )

  const desktopLyricsSyncRef = useRef({
    lyrics: [],
    activeLyricIndex: -1,
    romajiDisplayLines: [],
    displayMainTitle: ''
  })
  useEffect(() => {
    desktopLyricsSyncRef.current = {
      lyrics,
      activeLyricIndex,
      romajiDisplayLines,
      displayMainTitle
    }
  }, [lyrics, activeLyricIndex, romajiDisplayLines, displayMainTitle])

  /** Pulled by main process setInterval (not throttled when ECHO is minimized). */
  useEffect(() => {
    if (!config.desktopLyricsEnabled) {
      try {
        delete window.__getDesktopLyricsPayload
      } catch {
        /* ignore */
      }
      ;(async () => {
        try {
          if (window.api?.closeLyricsDesktop) await window.api.closeLyricsDesktop()
        } catch (e) {
          console.error('[desktop lyrics close]', e)
        }
      })()
      return undefined
    }

    window.__getDesktopLyricsPayload = () => {
      try {
        return buildDesktopLyricsPayload(
          configRef.current,
          desktopLyricsSyncRef.current,
          i18n.t('lyrics.none')
        )
      } catch (e) {
        console.error('[desktop lyrics] payload', e)
        return null
      }
    }
    ;(async () => {
      try {
        if (window.api?.openLyricsDesktop) await window.api.openLyricsDesktop()
        if (window.api?.setLyricsDesktopLocked) {
          await window.api.setLyricsDesktopLocked(configRef.current.desktopLyricsLocked === true)
        }
      } catch (e) {
        console.error('[desktop lyrics open]', e)
      }
    })()

    return () => {
      try {
        delete window.__getDesktopLyricsPayload
      } catch {
        /* ignore */
      }
    }
  }, [config.desktopLyricsEnabled])

  useEffect(() => {
    if (!config.desktopLyricsEnabled || !window.api?.setLyricsDesktopLocked) return
    window.api.setLyricsDesktopLocked(config.desktopLyricsLocked === true).catch((e) => {
      console.error('[desktop lyrics lock]', e)
    })
  }, [config.desktopLyricsEnabled, config.desktopLyricsLocked])

  return (
    <div
      className="app-container"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="app-theme-backdrop" style={themeBackdropStyle} aria-hidden />
      {config.customBgPath && !config.themeCoverAsBackground && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundImage: `url("file:///${config.customBgPath.replace(/\\/g, '/')}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: config.customBgOpacity,
            zIndex: -2,
            pointerEvents: 'none'
          }}
        />
      )}
      {config.themeCoverAsBackground && displayMainCoverUrl && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundImage: `url("${displayMainCoverUrl.replace(/\\/g, '/')}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(20px)',
            transform: 'scale(1.1)',
            opacity: config.customBgOpacity !== undefined ? config.customBgOpacity : 1.0,
            zIndex: -2,
            pointerEvents: 'none'
          }}
        />
      )}
      {config.lyricsFluidBackground !== false && showLyrics && dynamicCoverTheme && (
        <div
          className="fluid-background"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: -1,
            pointerEvents: 'none',
            background: `
              radial-gradient(circle at 0% 0%, ${dynamicCoverTheme.accent1} 0%, transparent 60%),
              radial-gradient(circle at 100% 100%, ${dynamicCoverTheme.accent2} 0%, transparent 60%),
              radial-gradient(circle at 50% 50%, ${dynamicCoverTheme.bgColor} 0%, transparent 100%)
            `,
            mixBlendMode: config.themeCoverAsBackground || config.customBgPath ? 'color' : 'normal',
            opacity: 0.85,
            filter: 'blur(40px)',
            animation: 'fluidPan 20s ease-in-out infinite alternate',
            transform: 'scale(1.2)'
          }}
        />
      )}
      {mvId && (showLyrics ? config.mvAsBackground : config.mvAsBackgroundMain) && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: -1,
            opacity: config.mvBackgroundOpacity !== undefined ? config.mvBackgroundOpacity : 0.8,
            pointerEvents: 'none',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '100%',
              height: '100%',
              transform: 'translate(-50%, -50%) scale(1.2)',
              filter: `blur(${Math.max(0, Number(config.mvBackgroundBlur || 0))}px) saturate(1.05)`,
              willChange: 'transform, filter',
              pointerEvents: 'none'
            }}
          >
            {renderMvIframe(mvId, true)}
          </div>
        </div>
      )}
      {isConverting && (
        <div className="conversion-overlay">
          <div className="loader-box glass-panel">
            <div className="spinner"></div>
            <p>{conversionMsg}</p>
          </div>
        </div>
      )}
      <div
        className={`titlebar ${showLyrics ? 'titlebar--lyrics' : ''} ${brightLyricsBackdrop ? 'titlebar--bright-backdrop' : ''}`}
      >
        <span className="titlebar-appname">{t('app.title')}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
          <button
            className="no-drag"
            type="button"
            onClick={() => setLyricsDrawerOpen(true)}
            style={{
              background: 'none',
              border: 'none',
              color: lyricsDrawerOpen ? 'var(--accent-pink)' : 'inherit',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = 'var(--accent-pink)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = lyricsDrawerOpen ? 'var(--accent-pink)' : 'inherit'
            }}
            title={t('titlebar.lyricsSettings')}
          >
            <ListMusic size={18} />
          </button>
          <button
            className="no-drag"
            type="button"
            aria-expanded={historyMenuOpen}
            aria-haspopup="dialog"
            onClick={() => setHistoryMenuOpen((open) => !open)}
            style={{
              background: 'none',
              border: 'none',
              color: historyMenuOpen ? 'var(--accent-pink)' : 'inherit',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = 'var(--accent-pink)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = historyMenuOpen ? 'var(--accent-pink)' : 'inherit'
            }}
            title={t('player.playbackHistory', 'Playback history')}
          >
            <History size={18} />
          </button>
          <button
            className="no-drag"
            onClick={() => setDownloaderDrawerOpen((o) => !o)}
            style={{
              background: 'none',
              border: 'none',
              color: downloaderDrawerOpen ? 'var(--accent-pink)' : 'inherit',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = 'var(--accent-pink)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = downloaderDrawerOpen ? 'var(--accent-pink)' : 'inherit'
            }}
            title={t('titlebar.studioDownloader')}
          >
            <Download size={18} />
          </button>
          <button
            className="no-drag"
            type="button"
            onClick={() => setAudioSettingsDrawerOpen((o) => !o)}
            style={{
              background: 'none',
              border: 'none',
              color: audioSettingsDrawerOpen ? 'var(--accent-pink)' : 'inherit',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = 'var(--accent-pink)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = audioSettingsDrawerOpen
                ? 'var(--accent-pink)'
                : 'inherit'
            }}
            title={t('titlebar.audioSettings', 'Audio Settings')}
          >
            <Headphones size={18} />
          </button>
          <button
            className="no-drag"
            type="button"
            onClick={() => setMvDrawerOpen((o) => !o)}
            style={{
              background: 'none',
              border: 'none',
              color: mvDrawerOpen ? 'var(--accent-pink)' : 'inherit',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = 'var(--accent-pink)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = mvDrawerOpen ? 'var(--accent-pink)' : 'inherit'
            }}
            title={t('titlebar.mvSettings')}
          >
            <Film size={18} />
          </button>
          <button
            className="no-drag"
            type="button"
            onClick={() => setCastDrawerOpen((o) => !o)}
            style={{
              background: 'none',
              border: 'none',
              color: castDrawerOpen || castDlnaListening ? 'var(--accent-pink)' : 'inherit',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = 'var(--accent-pink)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color =
                castDrawerOpen || castDlnaListening ? 'var(--accent-pink)' : 'inherit'
            }}
            title={t('titlebar.castReceiver')}
          >
            <Radio size={18} />
          </button>
          <button
            className="no-drag"
            type="button"
            onClick={() => setListenTogetherDrawerOpen((o) => !o)}
            style={{
              background: 'none',
              border: 'none',
              color:
                listenTogetherDrawerOpen || listenTogetherRoomState?.roomId
                  ? 'var(--accent-pink)'
                  : 'inherit',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = 'var(--accent-pink)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color =
                listenTogetherDrawerOpen || listenTogetherRoomState?.roomId
                  ? 'var(--accent-pink)'
                  : 'inherit'
            }}
            title={t('titlebar.listenTogether')}
          >
            <Users size={18} />
          </button>
          <button
            className="no-drag"
            onClick={() => setPluginDrawerOpen((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: pluginDrawerOpen ? 'var(--accent-pink)' : 'inherit',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = 'var(--accent-pink)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = pluginDrawerOpen ? 'var(--accent-pink)' : 'inherit'
            }}
            title={t('titlebar.plugins')}
          >
            <Blocks size={18} />
          </button>
          <button
            className="no-drag"
            onClick={() => setView(view === 'settings' ? 'player' : 'settings')}
            style={{
              background: 'none',
              border: 'none',
              color: view === 'settings' ? 'var(--accent-pink)' : 'inherit',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = 'var(--accent-pink)'
              e.currentTarget.style.transform = 'rotate(45deg)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = view === 'settings' ? 'var(--accent-pink)' : 'inherit'
              e.currentTarget.style.transform = 'rotate(0deg)'
            }}
          >
            <Settings size={18} />
          </button>
          <button
            className="no-drag"
            onClick={() => window.api.minimizeAppHandler()}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = 'var(--text-main)'
              e.currentTarget.style.background = 'rgba(255,255,255,0.4)'
              e.currentTarget.style.borderRadius = '50%'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = 'inherit'
              e.currentTarget.style.background = 'none'
              e.currentTarget.style.borderRadius = '0'
            }}
          >
            <Minus size={18} />
          </button>
          <button
            className="no-drag"
            onClick={() => window.api.maximizeAppHandler()}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = 'var(--text-main)'
              e.currentTarget.style.background = 'rgba(255,255,255,0.4)'
              e.currentTarget.style.borderRadius = '50%'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = 'inherit'
              e.currentTarget.style.background = 'none'
              e.currentTarget.style.borderRadius = '0'
            }}
          >
            <Square size={14} />
          </button>
          <button
            className="no-drag"
            onClick={() => window.api.closeAppHandler()}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = 'white'
              e.currentTarget.style.background = 'var(--accent-pink)'
              e.currentTarget.style.borderRadius = '50%'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = 'inherit'
              e.currentTarget.style.background = 'none'
              e.currentTarget.style.borderRadius = '0'
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div
        className={`sidebar glass-panel sidebar-panel-root no-drag ${showLyrics || view === 'settings' ? 'hidden' : ''}`}
      >
        <div style={{ display: 'flex', gap: '8px', zIndex: 10, flexShrink: 0 }}>
          <button
            className="import-btn"
            style={{ flex: 1, padding: '10px' }}
            onClick={handleImport}
            title={t('import.folder')}
          >
            <FolderHeart size={18} />
          </button>
          <button
            className="import-btn"
            style={{ flex: 1, padding: '10px' }}
            onClick={handleImportFile}
            title={t('import.files')}
          >
            <FileAudio size={18} />
          </button>
          <button
            className="import-btn"
            style={{
              padding: '10px',
              background: 'rgba(255,255,255,0.4)',
              color: 'var(--text-main)',
              boxShadow: 'none'
            }}
            onClick={handleClearPlaylist}
            title={t('import.clearPlaylist')}
          >
            <Trash2 size={18} />
          </button>
        </div>

        <div className="search-container no-drag" style={{ flexShrink: 0 }}>
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder={t('search.placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div
          className={`sidebar-list-stack${listMode === 'playlists' && (selectedUserPlaylistId || selectedSmartCollectionId) ? ' sidebar-list-stack--pl-detail' : ''}`}
        >
          <div className="list-filter-bar no-drag">
            <button
              type="button"
              className={`list-filter-chip ${listMode === 'songs' ? 'active' : ''}`}
              onClick={() => handleListMode('songs')}
            >
              {t('listMode.songs')}
            </button>
            <button
              type="button"
              className={`list-filter-chip ${listMode === 'album' ? 'active' : ''}`}
              onClick={() => handleListMode('album')}
            >
              {t('listMode.albums')}
            </button>
            <button
              type="button"
              className={`list-filter-chip ${listMode === 'playlists' ? 'active' : ''}`}
              onClick={() => handleListMode('playlists')}
            >
              {t('listMode.playlists')}
            </button>
            <button
              type="button"
              className={`list-filter-chip ${listMode === 'folders' ? 'active' : ''}`}
              onClick={() => handleListMode('folders')}
            >
              {t('listMode.folders')}
            </button>
            <button
              type="button"
              className={`list-filter-chip list-filter-chip--icon-only ${showLikedOnly ? 'active' : ''}`}
              onClick={() => setShowLikedOnly((v) => !v)}
              title={t('like.filterOnlyTitle')}
            >
              <Heart size={13} strokeWidth={1.5} />
            </button>
          </div>
          <div
            className={`queue-filter-row no-drag${queueDragOver ? ' queue-filter-row--drag-over' : ''}`}
            onDragOver={handleQueueDragOver}
            onDragLeave={handleQueueDragLeave}
            onDrop={handleQueueDrop}
          >
            <div className="queue-filter-row-head">
              <span className="queue-filter-row-title">{t('listMode.queue')}</span>
              <div className="queue-filter-row-head-right">
                <button
                  type="button"
                  className={`queue-toggle-btn ${queuePlaybackEnabled ? 'active' : ''}`}
                  onClick={() => setQueuePlaybackEnabled((v) => !v)}
                  title={t('queue.playbackToggleTitle')}
                  aria-pressed={queuePlaybackEnabled}
                >
                  {queuePlaybackEnabled ? t('queue.playbackOn') : t('queue.playbackOff')}
                </button>
                <span className="queue-filter-row-count">{upNextPreviewTracks.length}</span>
              </div>
            </div>
            <div className="queue-preview-list">
              {upNextPreviewTracks.length === 0 ? (
                <div className="queue-preview-empty">{t('empty.queueEmpty')}</div>
              ) : (
                upNextPreviewTracks.map((track, idx) => {
                  const displayArtist =
                    track.info.artist === 'Unknown Artist'
                      ? albumArtistByName[track.info.album] || track.info.artist
                      : track.info.artist
                  return (
                    <div key={`${track.path}-upnext-${idx}`} className="queue-preview-item">
                      <span className="queue-preview-index">{idx + 1}.</span>
                      <span
                        className="queue-preview-text"
                        title={`${track.info.title} — ${displayArtist}`}
                      >
                        {track.info.title} - {displayArtist}
                      </span>
                      <button
                        type="button"
                        className="queue-preview-remove"
                        onClick={() => removeFromUpNextQueue(track.path)}
                        title={t('contextMenu.removeFromUpNext')}
                      >
                        <Minus size={14} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
            <div className="queue-drop-hint">{t('queue.dropHint')}</div>
          </div>

          {selectedAlbum !== 'all' && listMode === 'songs' && (
            <div className="album-filter-pill no-drag">
              <span>{t('albumFilter.label', { name: selectedAlbum })}</span>
              <button onClick={() => setSelectedAlbum('all')}>{t('albumFilter.clear')}</button>
            </div>
          )}

          {selectedFolder !== 'all' && listMode === 'folders' && (
            <div className="album-filter-pill no-drag">
              <span>{t('folderFilter.label', { name: selectedFolder.split('/').pop() })}</span>
              <button onClick={() => setSelectedFolder('all')}>{t('folderFilter.clear')}</button>
            </div>
          )}

          {playlist.length > 0 && listMode === 'folders' && selectedFolder === 'all' && (
            <div className="folder-browser-header no-drag" style={{ margin: '0 12px 8px' }}>
              <span className="folder-browser-title">{t('folders.heading')}</span>
              <span className="folder-browser-count">({folderGroupsFiltered.length})</span>
              <div className="folder-sort-wrap" ref={folderSortRef}>
                <button
                  type="button"
                  className="folder-sort-trigger"
                  onClick={() => setFolderSortOpen((v) => !v)}
                  aria-expanded={folderSortOpen}
                >
                  {folderSortMode === 'dateAsc'
                    ? t('folders.sortDateAsc')
                    : folderSortMode === 'dateDesc'
                      ? t('folders.sortDateDesc')
                      : t('folders.sortName')}
                  <ChevronDown size={12} style={{ marginLeft: 2, opacity: 0.6 }} />
                </button>
                {folderSortOpen && (
                  <div className="folder-sort-menu" role="menu">
                    {[
                      { key: 'default', label: t('folders.sortName') },
                      { key: 'dateAsc', label: t('folders.sortDateAsc') },
                      { key: 'dateDesc', label: t('folders.sortDateDesc') }
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        role="menuitem"
                        className={`folder-sort-menu-item${folderSortMode === opt.key ? ' active' : ''}`}
                        onClick={() => {
                          setFolderSortMode(opt.key)
                          setFolderSortOpen(false)
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {(listMode === 'songs' || (listMode === 'folders' && selectedFolder !== 'all')) && (
            <div className="folder-browser-header no-drag" style={{ margin: '0 12px 8px' }}>
              <span className="folder-browser-title" style={{ flex: 1 }}>
                {listMode === 'folders' && selectedFolder !== 'all'
                  ? selectedFolder.split(/[\\/]/).pop() || t('folders.heading')
                  : t('songs.heading', 'Songs')}
              </span>
              <div className="folder-sort-wrap" ref={songSortRef}>
                <button
                  type="button"
                  className="folder-sort-trigger"
                  onClick={() => setSongSortOpen((v) => !v)}
                  aria-expanded={songSortOpen}
                >
                  {songSortMode === 'dateAsc'
                    ? t('songs.sortDateAsc', 'Oldest added')
                    : songSortMode === 'dateDesc'
                      ? t('songs.sortDateDesc', 'Newest added')
                      : songSortMode === 'nameAsc'
                        ? t('songs.sortNameAsc', 'Name (A-Z)')
                        : songSortMode === 'nameDesc'
                          ? t('songs.sortNameDesc', 'Name (Z-A)')
                          : songSortMode === 'durationAsc'
                            ? t('songs.sortDurationAsc', 'Duration (Short)')
                            : songSortMode === 'durationDesc'
                              ? t('songs.sortDurationDesc', 'Duration (Long)')
                              : songSortMode === 'qualityAsc'
                                ? t('songs.sortQualityAsc', 'Quality (Low)')
                                : songSortMode === 'qualityDesc'
                                  ? t('songs.sortQualityDesc', 'Quality (High)')
                                  : t('songs.sortDefault', 'Default')}
                  <ChevronDown size={14} aria-hidden strokeWidth={1.5} />
                </button>
                {songSortOpen && (
                  <div className="folder-sort-menu" role="menu">
                    {[
                      { key: 'default', label: t('songs.sortDefault', 'Default') },
                      { key: 'dateAsc', label: t('songs.sortDateAsc', 'Oldest added') },
                      { key: 'dateDesc', label: t('songs.sortDateDesc', 'Newest added') },
                      { key: 'nameAsc', label: t('songs.sortNameAsc', 'Name (A-Z)') },
                      { key: 'nameDesc', label: t('songs.sortNameDesc', 'Name (Z-A)') },
                      { key: 'durationAsc', label: t('songs.sortDurationAsc', 'Duration (Short)') },
                      {
                        key: 'durationDesc',
                        label: t('songs.sortDurationDesc', 'Duration (Long)')
                      },
                      { key: 'qualityAsc', label: t('songs.sortQualityAsc', 'Quality (Low)') },
                      { key: 'qualityDesc', label: t('songs.sortQualityDesc', 'Quality (High)') }
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        role="menuitem"
                        className={`folder-sort-menu-item${songSortMode === opt.key ? ' active' : ''}`}
                        onClick={() => {
                          setSongSortMode(opt.key)
                          setSongSortOpen(false)
                        }}
                      >
                        <div className="folder-sort-chk">
                          {songSortMode === opt.key && <Check size={14} strokeWidth={2} />}
                        </div>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div
            className={`playlist${listMode === 'album' ? ' playlist-album-mode' : ''}${listMode === 'folders' ? ' playlist-album-mode' : ''}${listMode === 'playlists' && (selectedUserPlaylistId || selectedSmartCollectionId) ? ' playlist--pl-detail' : ''}`}
            ref={sidebarPlaylistRef}
            onScroll={handleSidebarScroll}
          >
            {playlist.length === 0 && listMode !== 'playlists' && (
              <div className="app-empty-state app-empty-state--minimal">
                <p className="app-empty-state__title">{t('empty.noTracks')}</p>
                <p className="app-empty-state__hint">{t('empty.importFolder')}</p>
              </div>
            )}

            {listMode === 'playlists' && !selectedUserPlaylistId && !selectedSmartCollectionId && (
              <div className="user-playlist-library no-drag">
                <div className="user-playlist-library-chrome" style={{ marginBottom: 14 }}>
                  <div className="user-playlist-library-header">
                    <span className="user-playlist-library-heading">
                      {t('playlists.smartCollections', 'Smart collections')}
                    </span>
                    <span className="user-playlist-library-count">{smartCollections.length}</span>
                    <button
                      type="button"
                      className="user-playlist-detail-btn"
                      style={{ marginLeft: 'auto' }}
                      onClick={() =>
                        smartCollectionEditorOpen && !editingSmartCollectionId
                          ? resetSmartCollectionEditor()
                          : openCreateSmartCollectionEditor()
                      }
                    >
                      <Wand2 size={14} aria-hidden />
                      {smartCollectionEditorOpen && !editingSmartCollectionId
                        ? t('common.cancel', { defaultValue: 'Cancel' })
                        : t('playlists.customSmartCollection', 'Custom rules')}
                    </button>
                  </div>
                  <p className="smart-collection-hint">
                    {t(
                      'playlists.smartCollectionsHint',
                      'Tap a template to create it instantly, or open custom rules if you want something more specific.'
                    )}
                  </p>
                  <div className="smart-collection-template-row">
                    {smartCollectionTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className="smart-collection-template-chip"
                        onClick={() => applySmartCollectionTemplate(template.buildDraft)}
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                  {smartCollectionEditorOpen && (
                    <div className="smart-collection-editor">
                      <div className="smart-collection-preview">
                        {describeSmartCollectionDraft(smartCollectionDraft)}
                      </div>
                      <div className="smart-collection-editor-grid">
                        <label className="smart-collection-field">
                          <span className="smart-collection-field-label">
                            {t('playlists.smartCollectionName', 'Name')}
                          </span>
                          <input
                            type="text"
                            className="new-playlist-input"
                            placeholder={t(
                              'playlists.smartCollectionNamePlaceholder',
                              'Late-night favorites'
                            )}
                            value={smartCollectionDraft.name}
                            onChange={(e) =>
                              updateSmartCollectionDraftField('name', e.target.value)
                            }
                          />
                        </label>
                        <label className="smart-collection-field">
                          <span className="smart-collection-field-label">
                            {t('playlists.smartMatchMode', 'Match')}
                          </span>
                          <select
                            className="new-playlist-input smart-collection-select"
                            value={smartCollectionDraft.matchMode}
                            onChange={(e) =>
                              updateSmartCollectionDraftField('matchMode', e.target.value)
                            }
                          >
                            <option value="all">{t('playlists.smartMatchAll', 'All rules')}</option>
                            <option value="any">{t('playlists.smartMatchAny', 'Any rule')}</option>
                          </select>
                        </label>
                      </div>
                      <div className="smart-collection-natural-list">
                        <label className="smart-collection-natural-row">
                          <input
                            type="checkbox"
                            checked={smartCollectionDraft.likedOnly}
                            onChange={(e) =>
                              updateSmartCollectionDraftField('likedOnly', e.target.checked)
                            }
                          />
                          <span>
                            {t('playlists.smartNaturalLikedOnly', 'Only include liked songs')}
                          </span>
                        </label>
                        <label className="smart-collection-natural-row">
                          <span>
                            {t(
                              'playlists.smartNaturalMinPlayPrefix',
                              'Include songs played at least'
                            )}
                          </span>
                          <input
                            type="number"
                            min="1"
                            className="smart-collection-inline-input"
                            placeholder="5"
                            value={smartCollectionDraft.minPlayCount}
                            onChange={(e) =>
                              updateSmartCollectionDraftField('minPlayCount', e.target.value)
                            }
                          />
                          <span>{t('playlists.smartNaturalMinPlaySuffix', 'times')}</span>
                        </label>
                        <label className="smart-collection-natural-row">
                          <span>
                            {t(
                              'playlists.smartNaturalPlayedPrefix',
                              'Include songs played in the last'
                            )}
                          </span>
                          <input
                            type="number"
                            min="1"
                            className="smart-collection-inline-input"
                            placeholder="30"
                            value={smartCollectionDraft.playedWithinDays}
                            onChange={(e) =>
                              updateSmartCollectionDraftField('playedWithinDays', e.target.value)
                            }
                          />
                          <span>{t('playlists.smartNaturalDaysSuffix', 'days')}</span>
                        </label>
                        <label className="smart-collection-natural-row">
                          <span>
                            {t(
                              'playlists.smartNaturalAddedPrefix',
                              'Include songs added in the last'
                            )}
                          </span>
                          <input
                            type="number"
                            min="1"
                            className="smart-collection-inline-input"
                            placeholder="14"
                            value={smartCollectionDraft.addedWithinDays}
                            onChange={(e) =>
                              updateSmartCollectionDraftField('addedWithinDays', e.target.value)
                            }
                          />
                          <span>{t('playlists.smartNaturalDaysSuffix', 'days')}</span>
                        </label>
                        <label className="smart-collection-natural-row">
                          <span>
                            {t(
                              'playlists.smartNaturalTitlePrefix',
                              'Include songs whose title contains'
                            )}
                          </span>
                          <input
                            type="text"
                            className="smart-collection-inline-input smart-collection-inline-input--text"
                            placeholder={t('playlists.smartTitleContainsPlaceholder', 'night')}
                            value={smartCollectionDraft.titleIncludes}
                            onChange={(e) =>
                              updateSmartCollectionDraftField('titleIncludes', e.target.value)
                            }
                          />
                        </label>
                        <label className="smart-collection-natural-row">
                          <span>
                            {t(
                              'playlists.smartNaturalArtistPrefix',
                              'Include songs whose artist contains'
                            )}
                          </span>
                          <input
                            type="text"
                            className="smart-collection-inline-input smart-collection-inline-input--text"
                            placeholder="Aimer"
                            value={smartCollectionDraft.artistIncludes}
                            onChange={(e) =>
                              updateSmartCollectionDraftField('artistIncludes', e.target.value)
                            }
                          />
                        </label>
                        <label className="smart-collection-natural-row">
                          <span>
                            {t(
                              'playlists.smartNaturalAlbumPrefix',
                              'Include songs whose album contains'
                            )}
                          </span>
                          <input
                            type="text"
                            className="smart-collection-inline-input smart-collection-inline-input--text"
                            placeholder={t('playlists.smartAlbumContainsPlaceholder', 'live')}
                            value={smartCollectionDraft.albumIncludes}
                            onChange={(e) =>
                              updateSmartCollectionDraftField('albumIncludes', e.target.value)
                            }
                          />
                        </label>
                      </div>
                      <div className="smart-collection-editor-actions">
                        <button
                          type="button"
                          className="user-playlist-detail-btn user-playlist-detail-btn--primary"
                          onClick={saveSmartCollectionDraft}
                        >
                          <Check size={14} aria-hidden />
                          {editingSmartCollectionId
                            ? t('common.save', { defaultValue: 'Save' })
                            : t('playlists.createSmartCollection', 'Create smart collection')}
                        </button>
                        <button
                          type="button"
                          className="user-playlist-detail-btn"
                          onClick={resetSmartCollectionEditor}
                        >
                          <X size={14} aria-hidden />
                          {t('common.cancel', { defaultValue: 'Cancel' })}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="user-playlist-list" style={{ marginBottom: 18 }}>
                  {smartCollections.map((collection) => {
                    const Icon = collection.icon
                    const isActive =
                      listMode === 'playlists' && selectedSmartCollectionId === collection.id
                    return (
                      <div
                        key={collection.id}
                        className={`user-playlist-card${isActive ? ' user-playlist-card--active' : ''}`}
                      >
                        <button
                          type="button"
                          className="user-playlist-card-main"
                          onClick={() => openSmartCollection(collection.id)}
                        >
                          <Icon size={16} className="user-playlist-card-icon" aria-hidden />
                          <span className="user-playlist-name">{collection.name}</span>
                          <span className="user-playlist-count">
                            {t('playlists.detailTrackCount', {
                              count: collection.tracks.length
                            })}
                          </span>
                        </button>
                        {collection.kind === 'custom' && (
                          <div className="user-playlist-card-actions">
                            <button
                              type="button"
                              className="user-playlist-card-icon-btn"
                              aria-label={t(
                                'playlists.editSmartCollection',
                                'Edit smart collection'
                              )}
                              title={t('playlists.editSmartCollection', 'Edit smart collection')}
                              onClick={(e) => {
                                e.stopPropagation()
                                openEditSmartCollectionEditor(collection.id)
                              }}
                            >
                              <Pencil size={15} strokeWidth={1.5} />
                            </button>
                            <button
                              type="button"
                              className="user-playlist-card-icon-btn"
                              aria-label={t(
                                'playlists.deleteSmartCollection',
                                'Delete smart collection'
                              )}
                              title={t(
                                'playlists.deleteSmartCollection',
                                'Delete smart collection'
                              )}
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteSmartCollection(collection.id)
                              }}
                            >
                              <Trash2 size={15} strokeWidth={1.5} />
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="user-playlist-library-chrome">
                  <div className="user-playlist-library-header">
                    <span className="user-playlist-library-heading">
                      {t('playlists.yourPlaylists')}
                    </span>
                    <span className="user-playlist-library-count">{userPlaylists.length}</span>
                    <div className="user-playlist-more-wrap" ref={playlistLibraryMoreRef}>
                      <button
                        type="button"
                        className="user-playlist-more-trigger"
                        aria-expanded={playlistLibraryMoreOpen}
                        aria-haspopup="menu"
                        aria-label={t('aria.playlistLibraryOptions')}
                        title={t('playlists.more')}
                        onClick={() => setPlaylistLibraryMoreOpen((open) => !open)}
                      >
                        <MoreHorizontal size={18} strokeWidth={1.5} />
                      </button>
                      {playlistLibraryMoreOpen && (
                        <div className="user-playlist-more-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            className="user-playlist-more-item"
                            onClick={() => {
                              setPlaylistLibraryMoreOpen(false)
                              importUserPlaylists()
                            }}
                          >
                            <Upload size={14} aria-hidden />
                            {t('playlists.importLibrary')}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="user-playlist-more-item"
                            onClick={() => {
                              setPlaylistLibraryMoreOpen(false)
                              exportUserPlaylists()
                            }}
                          >
                            <Download size={14} aria-hidden />
                            {t('playlists.exportAll')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="new-playlist-inline">
                    <input
                      type="text"
                      className="new-playlist-input"
                      placeholder={t('playlists.newNamePlaceholder')}
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitNewPlaylistFromToolbar()
                      }}
                    />
                    <button
                      type="button"
                      className="new-playlist-submit"
                      onClick={submitNewPlaylistFromToolbar}
                    >
                      <Plus size={16} />
                      {t('playlists.create')}
                    </button>
                  </div>
                </div>
                {userPlaylists.length === 0 ? (
                  <div className="app-empty-state app-empty-state--minimal user-playlist-empty">
                    <p className="app-empty-state__title">{t('empty.noPlaylists')}</p>
                  </div>
                ) : (
                  <div className="user-playlist-list">
                    {userPlaylists.map((pl) => (
                      <div
                        key={pl.id}
                        className={`user-playlist-card${listMode === 'playlists' && selectedUserPlaylistId === pl.id ? ' user-playlist-card--active' : ''}`}
                      >
                        <button
                          type="button"
                          className="user-playlist-card-main"
                          onClick={() => {
                            setSelectedSmartCollectionId(null)
                            setSelectedUserPlaylistId(pl.id)
                          }}
                        >
                          <ListMusic size={16} className="user-playlist-card-icon" aria-hidden />
                          <span className="user-playlist-name">{pl.name}</span>
                          <span className="user-playlist-count">
                            {t('playlists.detailTrackCount', {
                              count: pl.paths.length
                            })}
                          </span>
                        </button>
                        <div className="user-playlist-card-actions">
                          <button
                            type="button"
                            className="user-playlist-card-icon-btn"
                            aria-label={t('aria.renamePlaylist')}
                            title={t('playlists.rename')}
                            onClick={(e) => {
                              e.stopPropagation()
                              renameUserPlaylist(pl.id)
                            }}
                          >
                            <Pencil size={15} strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            className="user-playlist-card-icon-btn"
                            aria-label={t('aria.deletePlaylist')}
                            title={t('playlists.delete')}
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteUserPlaylist(pl.id)
                            }}
                          >
                            <Trash2 size={15} strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {playlist.length > 0 && listMode === 'album' && (
              <div className="album-browser no-drag">
                <div className="album-browser-header">
                  <h3>{t('playlists.albumsHeading')}</h3>
                  <span>{t('playlists.groups', { count: albumGroupsFiltered.length })}</span>
                </div>
                <div className="album-grid album-grid-deferred">
                  {albumGroupsFiltered.map((album) => (
                    <AlbumSidebarCard
                      key={album.name}
                      album={album}
                      isSelected={selectedAlbum === album.name}
                      onPickAlbum={handlePickAlbumFromSidebar}
                      onContextMenu={(e, pickedAlbum) =>
                        openGroupContextMenu(e, 'album', pickedAlbum)
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {playlist.length > 0 && listMode === 'folders' && selectedFolder === 'all' && (
              <div className="folder-browser no-drag">
                <div className="folder-list">
                  {folderGroupsFiltered.map((folder) => (
                    <button
                      key={folder.folderPath}
                      type="button"
                      className={`folder-list-item${selectedFolder === folder.folderPath ? ' active' : ''}`}
                      onClick={() => handlePickFolderFromSidebar(folder)}
                      onContextMenu={(e) => openGroupContextMenu(e, 'folder', folder)}
                      title={folder.folderPath}
                    >
                      <FolderOpen size={15} className="folder-list-icon" />
                      <span className="folder-list-name">{folder.name}</span>
                      <span className="folder-list-count">{folder.tracks.length}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {listMode === 'playlists' && selectedSmartCollectionId && selectedSmartCollection && (
              <div
                key={`smart-${selectedSmartCollectionId}`}
                className="user-playlist-detail no-drag"
              >
                <div className="user-playlist-detail-head">
                  <button
                    type="button"
                    className="user-playlist-detail-back"
                    onClick={() => setSelectedSmartCollectionId(null)}
                    aria-label={t('aria.backToPlaylists')}
                    title={t('nav.back')}
                  >
                    <ChevronLeft size={20} strokeWidth={1.5} />
                  </button>
                  <div className="user-playlist-detail-text">
                    <span
                      className="user-playlist-detail-name"
                      title={selectedSmartCollection.name}
                    >
                      {selectedSmartCollection.name}
                    </span>
                    <span className="user-playlist-detail-meta">
                      {t('playlists.detailTrackCount', {
                        count: selectedSmartCollection.tracks.length
                      })}
                    </span>
                    {selectedSmartCollection.kind === 'custom' && (
                      <div className="smart-collection-rule-list">
                        {describeSmartCollectionRules(selectedSmartCollection.rules).map((item) => (
                          <span key={item} className="smart-collection-rule-chip">
                            {item}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="user-playlist-detail-actions">
                  <button
                    type="button"
                    className="user-playlist-detail-btn user-playlist-detail-btn--primary"
                    onClick={() => playPlaylistContextNow()}
                  >
                    <Play size={14} aria-hidden />
                    {t('playlists.playAll', { defaultValue: 'Play all' })}
                  </button>
                  <button
                    type="button"
                    className="user-playlist-detail-btn"
                    onClick={() => playPlaylistContextNow({ shuffle: true })}
                  >
                    <Shuffle size={14} aria-hidden />
                    {t('playlists.shufflePlay', { defaultValue: 'Shuffle' })}
                  </button>
                  {selectedSmartCollection.kind === 'custom' ? (
                    <>
                      <button
                        type="button"
                        className="user-playlist-detail-btn"
                        onClick={() => openEditSmartCollectionEditor(selectedSmartCollection.id)}
                      >
                        <Pencil size={14} aria-hidden />
                        {t('playlists.editSmartCollection', 'Edit smart collection')}
                      </button>
                      <button
                        type="button"
                        className="user-playlist-detail-btn"
                        onClick={() => deleteSmartCollection(selectedSmartCollection.id)}
                      >
                        <Trash2 size={14} aria-hidden />
                        {t('playlists.deleteSmartCollection', 'Delete smart collection')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="user-playlist-detail-btn"
                      disabled
                      style={{ opacity: 0.65 }}
                    >
                      <History size={14} aria-hidden />
                      {t('playlists.readonlyCollection', 'Read only')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {listMode === 'playlists' && selectedUserPlaylistId && selectedUserPlaylist && (
              <div
                key={`playlist-${selectedUserPlaylistId}`}
                className="user-playlist-detail no-drag"
              >
                <div className="user-playlist-detail-head">
                  <button
                    type="button"
                    className="user-playlist-detail-back"
                    onClick={() => setSelectedUserPlaylistId(null)}
                    aria-label={t('aria.backToPlaylists')}
                    title={t('nav.back')}
                  >
                    <ChevronLeft size={20} strokeWidth={1.5} />
                  </button>
                  <div className="user-playlist-detail-text">
                    <span className="user-playlist-detail-name" title={selectedUserPlaylist.name}>
                      {selectedUserPlaylist.name}
                    </span>
                    <span className="user-playlist-detail-meta">
                      {t('playlists.detailTrackCount', {
                        count: selectedUserPlaylist.paths.length
                      })}
                    </span>
                  </div>
                </div>
                <div className="user-playlist-detail-actions">
                  <button
                    type="button"
                    className="user-playlist-detail-btn user-playlist-detail-btn--primary"
                    onClick={() => playPlaylistContextNow()}
                  >
                    <Play size={14} aria-hidden />
                    {t('playlists.playAll', { defaultValue: 'Play all' })}
                  </button>
                  <button
                    type="button"
                    className="user-playlist-detail-btn"
                    onClick={() => playPlaylistContextNow({ shuffle: true })}
                  >
                    <Shuffle size={14} aria-hidden />
                    {t('playlists.shufflePlay', { defaultValue: 'Shuffle' })}
                  </button>
                  {playlist.length > 0 && (
                    <button
                      type="button"
                      className="user-playlist-detail-btn user-playlist-detail-btn--primary"
                      onClick={addAllLibraryVisibleToPlaylist}
                      title={t('playlists.addFromResultsTitle')}
                    >
                      <ListPlus size={14} aria-hidden />
                      {t('playlists.addFromResults')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="user-playlist-detail-btn"
                    onClick={importAudioIntoSelectedUserPlaylist}
                    title={t('playlists.importTitle')}
                  >
                    <Upload size={14} aria-hidden />
                    {t('playlists.import')}
                  </button>
                  <button
                    type="button"
                    className="user-playlist-detail-btn"
                    onClick={async () => {
                      await exportNamedUserPlaylists(
                        [selectedUserPlaylist],
                        `${selectedUserPlaylist.name.replace(/[^\w.-]+/g, '_')}.json`
                      )
                    }}
                  >
                    <Download size={14} aria-hidden />
                    {t('playlists.export')}
                  </button>
                </div>
              </div>
            )}

            {(listMode === 'songs' ||
              (listMode === 'folders' && selectedFolder !== 'all') ||
              (listMode === 'playlists' &&
                (selectedUserPlaylistId || selectedSmartCollectionId))) && (
              <>
                {tracksForSidebarListFiltered.length === 0 && (
                  <div className="app-empty-state app-empty-state--minimal sidebar-empty-hint">
                    <p className="app-empty-state__title">
                      {showLikedOnly
                        ? t('empty.noLikedInView')
                        : listMode === 'playlists'
                          ? t(
                              selectedSmartCollectionId
                                ? 'empty.smartCollectionEmpty'
                                : 'empty.playlistEmpty',
                              selectedSmartCollectionId
                                ? 'No tracks in this collection yet.'
                                : undefined
                            )
                          : t('empty.noSearchMatch')}
                    </p>
                  </div>
                )}
                {tracksForSidebarListFiltered.length > 0 && (
                  <div className="playlist-virtual-list">
                    {visibleSidebarRange.topSpacer > 0 && (
                      <div
                        className="playlist-spacer"
                        style={{ height: `${visibleSidebarRange.topSpacer}px` }}
                        aria-hidden
                      />
                    )}
                    {visibleSidebarTracks.map((track) => {
                      const displayArtist =
                        track.info.artist === 'Unknown Artist'
                          ? albumArtistByName[track.info.album] || track.info.artist
                          : track.info.artist

                      const liked = likedSet.has(track.path)
                      return (
                        <div
                          key={`${track.path}-${track.originalIdx}`}
                          className={`track-item${track.originalIdx === currentIndex ? ' active' : ''}${listMode === 'playlists' && (selectedUserPlaylistId || selectedSmartCollectionId) ? ' track-item--in-pl' : ''}`}
                          data-track-index={track.originalIdx}
                          data-track-path={track.path}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'copy'
                            e.dataTransfer.setData('application/x-echo-track-path', track.path)
                            e.dataTransfer.setData('text/plain', track.path)
                          }}
                          onClick={() => {
                            startPlaybackForTrack(track, sidebarPlaybackContext)
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            forceCloseCoverContextMenu()
                            forceCloseGroupContextMenu()
                            forceCloseAddToPlaylistMenu()
                            setTrackContextMenu({ clientX: e.clientX, clientY: e.clientY, track })
                          }}
                        >
                          <Music size={16} style={{ marginRight: 8, opacity: 0.5 }} />
                          <div className="track-text-group">
                            <div className="track-name" title={track.info.title}>
                              {track.info.title}
                            </div>
                            <div
                              className="track-subtitle"
                              title={`${displayArtist} · ${track.info.album}`}
                            >
                              <ArtistLink
                                artist={displayArtist}
                                className="artist-link-subtle"
                                stopPropagation
                              />{' '}
                              · {track.info.album}
                            </div>
                          </div>
                          {(listMode === 'songs' ||
                            listMode === 'folders' ||
                            (listMode === 'playlists' &&
                              (selectedUserPlaylistId || selectedSmartCollectionId))) && (
                            <div className="track-add-pl-wrap">
                              <button
                                type="button"
                                className={`track-like-btn ${liked ? 'active' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleLike(track.path)
                                }}
                                title={liked ? t('like.unlike') : t('like.like')}
                                aria-pressed={liked}
                              >
                                <Heart
                                  size={16}
                                  fill={liked ? 'currentColor' : 'none'}
                                  strokeWidth={liked ? 1.5 : 1.5}
                                />
                              </button>
                              {(listMode === 'songs' || listMode === 'folders') && (
                                <button
                                  type="button"
                                  className={`track-add-pl-btn ${addToPlaylistMenu?.originalIdx === track.originalIdx ? 'active' : ''}`}
                                  onClick={(e) => openAddToPlaylistPopover(e, track)}
                                  title={t('aria.addToPlaylist')}
                                >
                                  <ListPlus size={16} />
                                </button>
                              )}
                            </div>
                          )}
                          {listMode === 'playlists' && selectedUserPlaylistId && (
                            <button
                              type="button"
                              className="track-remove-pl-btn"
                              title={t('aria.removeFromPlaylist')}
                              onClick={(e) => {
                                e.stopPropagation()
                                removePathFromUserPlaylist(selectedUserPlaylistId, track.path)
                              }}
                            >
                              <Minus size={16} />
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {visibleSidebarRange.bottomSpacer > 0 && (
                      <div
                        className="playlist-spacer"
                        style={{ height: `${visibleSidebarRange.bottomSpacer}px` }}
                        aria-hidden
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <PluginSlot name="sidebar" />
      </div>

      <div
        className={`main-player glass-panel no-drag ${showLyrics ? 'lyrics-mode' : ''} ${showLyrics && config.mvAsBackground && mvId ? 'immersive-mode' : ''} ${brightLyricsBackdrop ? 'main-player--bright-lyrics-bg' : ''} ${view === 'settings' ? 'hidden' : ''} ${config.lyricsBlurEffect ? 'lyrics-blur-on' : ''}`}
      >
        {showLyrics ? (
          <div className="lyrics-view-container" style={lyricsPanelStyle}>
            {!hideImmersiveMvChrome && (
              <>
                <button className="back-btn" onClick={() => setShowLyrics(false)}>
                  <ChevronLeft size={32} />
                </button>

                <div className="lyrics-header">
                  <div className="mini-cover">
                    {displayMainCoverUrl ? <img src={displayMainCoverUrl} alt="" /> : <Music />}
                  </div>
                  <div className="lyrics-meta">
                    <h2>{displayMainTitle}</h2>
                    <p>
                      <ArtistLink artist={displayMainArtist} className="artist-link-lyrics" />
                    </p>
                    <div className="technical-info-mini">
                      <span
                        className={`mini-pill lyrics-sync-pill lyrics-sync-pill--${lyricsStatusUi.tone}`}
                      >
                        {lyricsStatusUi.text}
                      </span>
                      {dlnaUiOn && (
                        <span
                          className="mini-pill"
                          style={{
                            fontWeight: 800,
                            letterSpacing: '0.06em',
                            borderColor: 'var(--accent-pink)',
                            color: 'var(--accent-pink)'
                          }}
                        >
                          DLNA
                        </span>
                      )}
                      {technicalInfo.codec && (
                        <span className="mini-pill">{technicalInfo.codec.toUpperCase()}</span>
                      )}
                      {technicalInfo.bitrate && (
                        <span className="mini-pill">
                          {Math.round(technicalInfo.bitrate / 1000)} kbps
                        </span>
                      )}
                      {technicalInfo.sampleRate && (
                        <span className="mini-pill">{technicalInfo.sampleRate} Hz</span>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {hideImmersiveMvChrome && (
              <button
                type="button"
                className="immersive-mv-minimal-exit no-drag"
                onClick={() => setShowLyrics(false)}
                title={t('mvDrawer.exitImmersiveLyrics')}
                aria-label={t('mvDrawer.exitImmersiveLyrics')}
              >
                <ChevronLeft size={28} />
              </button>
            )}

            <div
              className={`lyrics-and-mv-wrapper${config.lyricsHidden || (lyrics.length > 0 && lyrics.filter((l) => l.text.trim()).every((l) => l.text.match(/纯音乐|instrumental|.*欣赏.*|.*enjoy.*/i))) ? ' lyrics-and-mv-wrapper--lyrics-hidden' : ''}`}
            >
              {!(
                config.lyricsHidden ||
                (lyrics.length > 0 &&
                  lyrics
                    .filter((l) => l.text.trim())
                    .every((l) => l.text.match(/纯音乐|instrumental|.*欣赏.*|.*enjoy.*/i)))
              ) && (
                <div className="lyrics-scroll-area" ref={scrollAreaRef}>
                  {lyrics.length > 0 ? (
                    lyrics.map((line, idx) => (
                      <div
                        key={idx}
                        className={`lyric-line ${idx === activeLyricIndex ? 'active' : ''} ${idx < activeLyricIndex ? 'past' : ''} ${Math.abs(idx - activeLyricIndex) === 1 ? 'near' : ''} ${Math.abs(idx - activeLyricIndex) >= 2 ? 'far' : ''}`}
                        style={{
                          fontSize: `${config.lyricsFontSize ?? 32}px`
                        }}
                        onClick={() => {
                          const newTime = parseFloat(line.time)
                          if (isNaN(newTime)) return

                          setIsSeeking(true)
                          setCurrentTime(newTime)
                          syncYTVideo(newTime)

                          // Clear existing timer
                          if (seekTimerRef.current) clearTimeout(seekTimerRef.current)

                          if (useNativeEngineRef.current && window.api?.playAudio) {
                            const tp = playlist[currentIndex]?.path
                            if (audioRef.current) audioRef.current.currentTime = newTime
                            if (tp)
                              window.api
                                .playAudio(tp, newTime, playbackRateRef.current)
                                .catch(console.error)
                            seekTimerRef.current = setTimeout(() => setIsSeeking(false), 500)
                          } else if (audioRef.current) {
                            audioRef.current.currentTime = newTime
                            seekTimerRef.current = setTimeout(() => setIsSeeking(false), 500)
                          }
                        }}
                      >
                        {config.lyricsWordHighlight !== false && lyricTimelineValid ? (
                          <span
                            className="lyric-line-main lyric-line-main--karaoke"
                            style={{
                              '--karaoke-progress': `${((lyricKaraokeProgressList[idx] || 0) * 100).toFixed(3)}%`
                            }}
                          >
                            <span className="lyric-line-main-base">{line.text}</span>
                            <span className="lyric-line-main-highlight">{line.text}</span>
                          </span>
                        ) : (
                          <span className="lyric-line-main">{line.text}</span>
                        )}
                        {config.lyricsShowRomaji && (romajiDisplayLines[idx] || line.romaji) ? (
                          <span className="lyric-line-romaji">
                            {line.romaji || romajiDisplayLines[idx]}
                          </span>
                        ) : null}
                        {config.lyricsShowTranslation && line.translation ? (
                          <span className="lyric-line-translation">{line.translation}</span>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="lyric-line active" style={{ opacity: 0.5 }}>
                      {isSearchingMV ? (
                        t('lyrics.searchingMv')
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 8
                          }}
                        >
                          <div>{t('lyrics.none')}</div>
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 8,
                              justifyContent: 'center'
                            }}
                          >
                            <button
                              className="retry-lyrics-btn"
                              onClick={() => retryFetchLyrics()}
                              style={{
                                padding: '6px 10px',
                                borderRadius: 6,
                                border: 'none',
                                background: 'var(--accent-color)',
                                color: 'white',
                                cursor: 'pointer'
                              }}
                            >
                              {t('lyrics.fetchAgain')}
                            </button>
                            <button
                              type="button"
                              onClick={() => openLyricsCandidatePicker()}
                              style={{
                                padding: '6px 10px',
                                borderRadius: 6,
                                border: '1px solid rgba(255,255,255,0.25)',
                                background: 'rgba(255,255,255,0.08)',
                                color: 'inherit',
                                cursor: 'pointer'
                              }}
                            >
                              {t('lyrics.pickManual')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {mvId && config.enableMV && !config.mvAsBackground && (
                <div ref={mvContainerRef} className="mv-container glass-panel">
                  <div className="mv-aspect-ratio-wrapper">
                    {mvId.source === 'bilibili' && biliDirectStream?.videoUrl ? (
                      renderMvIframe(mvId, false)
                    ) : (
                      <div className="mv-hi-res-stage">{renderMvIframe(mvId, false)}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="main-player-body">
            <div
              className={`cover-wrapper${quickEditModifierActive ? ' quick-edit-target quick-edit-target--armed' : ''}`}
              onContextMenu={openCoverContextMenu}
              onClick={handleQuickCoverPick}
              title={
                currentTrack?.path && isLocalAudioFilePath(currentTrack.path)
                  ? t('metadataQuick.coverHint', 'Ctrl+click to change cover')
                  : undefined
              }
            >
              {displayMainCoverUrl ? (
                <img
                  src={displayMainCoverUrl}
                  draggable={false}
                  className={`cover-image ${transportIsPlaying ? 'playing' : ''}`}
                  alt={t('lyrics.coverAlt')}
                />
              ) : (
                <div className="no-cover">
                  <Music size={64} style={{ opacity: 0.3 }} />
                </div>
              )}
            </div>

            <div className="track-info">
              <h1
                className={quickEditModifierActive ? 'quick-edit-target quick-edit-target--armed' : ''}
                onClick={(event) => handleQuickFieldTrigger('title', event)}
                title={
                  currentTrack?.path && isLocalAudioFilePath(currentTrack.path)
                    ? t('metadataQuick.titleHint', 'Ctrl+click to edit title')
                    : undefined
                }
              >
                {quickEditField === 'title' ? (
                  <input
                    className="quick-edit-input quick-edit-input--title"
                    value={quickEditDraft}
                    onChange={(event) => setQuickEditDraft(event.target.value)}
                    onBlur={() => {
                      void commitQuickMetadataFieldEdit()
                    }}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        event.currentTarget.blur()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelQuickMetadataFieldEdit()
                      }
                    }}
                    autoFocus
                    disabled={quickEditBusy}
                  />
                ) : (
                  displayMainTitle
                )}
              </h1>
              <p
                className={`artist-text${quickEditModifierActive ? ' quick-edit-target quick-edit-target--armed' : ''}`}
                onClickCapture={(event) => handleQuickFieldTrigger('artist', event)}
                title={
                  currentTrack?.path && isLocalAudioFilePath(currentTrack.path)
                    ? t('metadataQuick.artistHint', 'Ctrl+click to edit artist')
                    : undefined
                }
              >
                {quickEditField === 'artist' ? (
                  <input
                    className="quick-edit-input quick-edit-input--artist"
                    value={quickEditDraft}
                    onChange={(event) => setQuickEditDraft(event.target.value)}
                    onBlur={() => {
                      void commitQuickMetadataFieldEdit()
                    }}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        event.currentTarget.blur()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelQuickMetadataFieldEdit()
                      }
                    }}
                    autoFocus
                    disabled={quickEditBusy}
                  />
                ) : (
                  <ArtistLink artist={displayMainArtist} className="artist-link-main" />
                )}
              </p>

              <div className="tech-pills-container">
                {isListenTogetherLoading && (
                  <div
                    className="tech-pill"
                    style={{
                      fontWeight: 800,
                      letterSpacing: '0.05em',
                      fontSize: 11,
                      borderColor: 'var(--accent-pink)',
                      color: 'var(--accent-pink)',
                      boxShadow: '0 0 12px rgba(236, 72, 153, 0.25)',
                      animation: 'pulse 1.5s infinite'
                    }}
                  >
                    [Together] LOADING...
                  </div>
                )}
                {dlnaUiOn && (
                  <div
                    className="tech-pill"
                    style={{
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      fontSize: 11,
                      borderColor: 'var(--accent-pink)',
                      color: 'var(--accent-pink)',
                      boxShadow: '0 0 12px rgba(236, 72, 153, 0.25)'
                    }}
                  >
                    DLNA
                  </div>
                )}
                {technicalInfo.codec && (
                  <div className="tech-pill codec-pill">{technicalInfo.codec.toUpperCase()}</div>
                )}
                {technicalInfo.bitrate && (
                  <div className="tech-pill">{Math.round(technicalInfo.bitrate / 1000)}kbps</div>
                )}
                {technicalInfo.sampleRate && (
                  <div
                    className={`tech-pill ${technicalInfo.sampleRate > 44100 || technicalInfo.bitrate > 500000 ? 'lossless-glow' : ''}`}
                  >
                    {(technicalInfo.sampleRate > 44100 || technicalInfo.bitrate > 500000) && (
                      <Zap size={14} style={{ marginRight: 4 }} />
                    )}
                    {technicalInfo.sampleRate / 1000}KHZ
                  </div>
                )}
                {technicalInfo.channels && (
                  <div className="tech-pill">
                    {technicalInfo.channels > 1 ? t('tech.stereo') : t('tech.mono')}
                  </div>
                )}
                {technicalInfo.originalBpm && (
                  <div className="tech-pill bpm-pill">
                    <span className="bpm-orig">
                      {t('tech.bpm', { orig: technicalInfo.originalBpm })}
                    </span>
                    {playbackRate !== 1 && (
                      <>
                        <span className="bpm-arrow">→</span>
                        <span className="bpm-nc">
                          {Math.round(technicalInfo.originalBpm * playbackRate)}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {config.showMiniWaveform && (
                <MiniWaveform analyser={analyserNode.current} isPlaying={isPlaying} />
              )}
            </div>

            {config.showVisualizer && (
              <canvas ref={canvasRef} className="visualizer-canvas" width={400} height={100} />
            )}
          </div>
        )}

        {!(showLyrics && hideImmersiveMvChrome) && (
          <div className="controls-container">
            <div className="progress-area">
              <input
                type="range"
                className={`player-progress ${isProgressDragging ? 'is-dragging' : ''}`}
                min={0}
                max={displayProgressDuration || 0}
                value={displayProgressTime}
                onChange={handleSeek}
                onMouseDown={() => {
                  progressSeekValueRef.current = displayProgressTime
                  isProgressDraggingRef.current = true
                  setIsSeeking(true)
                  setIsProgressDragging(true)
                }}
                onMouseUp={(e) => commitProgressSeek(parseFloat(e.currentTarget.value))}
                onTouchStart={() => {
                  progressSeekValueRef.current = displayProgressTime
                  isProgressDraggingRef.current = true
                  setIsSeeking(true)
                  setIsProgressDragging(true)
                }}
                onTouchEnd={(e) => commitProgressSeek(parseFloat(e.currentTarget.value))}
                disabled={dlnaUiOn}
                style={{
                  padding: 0,
                  opacity: dlnaUiOn ? 0.65 : 1,
                  cursor: dlnaUiOn ? 'not-allowed' : undefined,
                  ['--seek-pct']:
                    displayProgressDuration > 0
                      ? `${Math.min(100, Math.max(0, (displayProgressTime / displayProgressDuration) * 100))}%`
                      : '0%'
                }}
              />
              <div className="time-info">
                <span>{formatTime(displayProgressTime)}</span>
                <span>
                  {dlnaUiOn && (!displayProgressDuration || displayProgressDuration <= 0)
                    ? '--:--'
                    : formatTime(displayProgressDuration)}
                </span>
              </div>
            </div>

            <div className="buttons buttons--transport">
              <div className="transport-cluster transport-cluster--primary">
                <button
                  className="btn btn--transport"
                  style={{ width: 40, height: 40 }}
                  onClick={() => setPlayMode(playMode === 'shuffle' ? 'loop' : 'shuffle')}
                >
                  <Shuffle
                    size={18}
                    color={playMode === 'shuffle' ? 'var(--accent-pink)' : 'var(--text-soft)'}
                  />
                </button>
                <button className="btn btn--transport" onClick={handlePrev}>
                  <SkipBack size={24} color="var(--text-soft)" />
                </button>
                <button className="btn play-btn" onClick={togglePlay}>
                  {transportIsPlaying ? (
                    <Pause size={32} />
                  ) : (
                    <Play size={32} style={{ marginLeft: 4 }} />
                  )}
                </button>
                <button className="btn btn--transport" onClick={handleNext}>
                  <SkipForward size={24} color="var(--text-soft)" />
                </button>
                <button
                  className="btn btn--transport"
                  style={{ width: 40, height: 40 }}
                  onClick={() => setPlayMode(playMode === 'single' ? 'loop' : 'single')}
                >
                  {playMode === 'single' ? (
                    <Repeat1 size={18} color="var(--accent-pink)" />
                  ) : (
                    <Repeat
                      size={18}
                      color={playMode === 'loop' ? 'var(--accent-pink)' : 'var(--text-soft)'}
                    />
                  )}
                </button>
              </div>

              <div className="transport-cluster transport-cluster--utility">
                <button
                  className={`btn btn--transport lyrics-toggle ${showLyrics ? 'active' : ''}`}
                  style={{ width: 40, height: 40 }}
                  onClick={() => setShowLyrics(!showLyrics)}
                >
                  <Mic2 size={18} color={showLyrics ? 'var(--accent-pink)' : 'var(--text-soft)'} />
                </button>
                <PluginSlot
                  name="playerTransportExtras"
                  context={playerTransportPluginContext}
                  className="no-drag transport-plugin-slot"
                  style={{ display: 'flex', alignItems: 'center' }}
                />
              </div>
            </div>

            <div className="nightcore-controls deck-panel">
              <div className="nc-header">
                <span>{t('player.speed')}</span>
                <span className="nc-badge">{playbackRate.toFixed(2)}x</span>
              </div>
              <div
                className={`slider-wrapper deck-slider-row ${isSpeedDragging ? 'is-dragging' : ''}`}
                style={{ marginBottom: view === 'player' && !showLyrics ? 8 : 0 }}
              >
                <span className="deck-scale-label">0.5</span>
                <input
                  type="range"
                  className={`deck-slider ${isSpeedDragging ? 'is-dragging' : ''}`}
                  min={0.5}
                  max={2.0}
                  step={0.05}
                  value={playbackRate}
                  onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                  onMouseDown={() => setIsSpeedDragging(true)}
                  onMouseUp={() => setIsSpeedDragging(false)}
                  onMouseLeave={() => setIsSpeedDragging(false)}
                  onTouchStart={() => setIsSpeedDragging(true)}
                  onTouchEnd={() => setIsSpeedDragging(false)}
                />
                <span className="deck-scale-label">2.0</span>
              </div>

              <div className="deck-divider" role="presentation" />

              <div className="nc-header" style={{ marginLeft: showLyrics ? 8 : 0 }}>
                <span>{t('player.vol')}</span>
                <span className="nc-badge">{Math.round(volume * 100)}%</span>
              </div>
              <div
                className={`slider-wrapper deck-slider-row ${isVolumeDragging ? 'is-dragging' : ''}`}
              >
                <Volume2 className="deck-vol-icon" size={16} aria-hidden />
                <input
                  type="range"
                  className={`deck-slider ${isVolumeDragging ? 'is-dragging' : ''}`}
                  min={0.0}
                  max={1.0}
                  step={0.01}
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  onMouseDown={() => setIsVolumeDragging(true)}
                  onMouseUp={() => setIsVolumeDragging(false)}
                  onMouseLeave={() => setIsVolumeDragging(false)}
                  onTouchStart={() => setIsVolumeDragging(true)}
                  onTouchEnd={() => setIsVolumeDragging(false)}
                />
              </div>

              <button
                className="export-btn"
                style={{ marginTop: 8 }}
                onClick={handleExport}
                disabled={isExporting || !currentTrack}
              >
                <Download size={16} />
                {isExporting ? t('player.exportRendering') : t('player.exportButton')}
              </button>
            </div>
          </div>
        )}
      </div>
      {view === 'settings' && (
        <div className="settings-page glass-panel no-drag">
          <div className="settings-header">
            <button className="back-view-btn" onClick={() => setView('player')}>
              <ChevronLeft size={32} />
            </button>
            <h1>{t('settings.pageTitle')}</h1>
          </div>

          <div className="settings-content">
            <section className="settings-section">
              <div className="section-title">
                <MessageSquare size={20} />
                <h2>{t('settings.language')}</h2>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <p style={{ opacity: 0.85, marginTop: 0 }}>{t('settings.languageHint')}</p>
                </div>
                <div className="settings-chip-row no-drag">
                  {['en', 'zh', 'ja'].map((code) => (
                    <button
                      key={code}
                      type="button"
                      className={`list-filter-chip ${normalizeUiLocale(config.uiLocale) === code ? 'active' : ''}`}
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          uiLocale: normalizeUiLocale(code)
                        }))
                      }
                    >
                      {code === 'en'
                        ? t('settings.langEn')
                        : code === 'zh'
                          ? t('settings.langZh')
                          : t('settings.langJa')}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <Zap size={20} />
                <h2>{t('settings.engineMastery')}</h2>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t('settings.spectrumTitle')}</h3>
                  <p>{t('settings.spectrumDesc')}</p>
                </div>
                <button
                  className={`toggle-btn ${config.showVisualizer ? 'active' : ''}`}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      showVisualizer: !prev.showVisualizer
                    }))
                  }
                >
                  {config.showVisualizer ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                </button>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t('settings.miniWaveTitle')}</h3>
                  <p>{t('settings.miniWaveDesc')}</p>
                </div>
                <button
                  className={`toggle-btn ${config.showMiniWaveform ? 'active' : ''}`}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      showMiniWaveform: !prev.showMiniWaveform
                    }))
                  }
                >
                  {config.showMiniWaveform ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                </button>
              </div>

              <p className="settings-visualizer-exclusive-hint">
                {t('settings.visualizerExclusiveHint')}
              </p>

              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t('settings.outputBufferTitle')}</h3>
                  <p>{t('settings.outputBufferDesc')}</p>
                </div>
                <div className="settings-chip-row no-drag">
                  {['low', 'balanced', 'stable'].map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`list-filter-chip ${config.audioOutputBufferProfile === key ? 'active' : ''}`}
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          audioOutputBufferProfile: key
                        }))
                      }
                    >
                      {t(`settings.outputBuffer.${key}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t('settings.eqMasterTitle')}</h3>
                  <p>{t('settings.eqMasterDesc')}</p>
                </div>
                <button
                  className={`toggle-btn ${config.useEQ ? 'active' : ''}`}
                  onClick={() => setConfig((prev) => ({ ...prev, useEQ: !prev.useEQ }))}
                >
                  {config.useEQ ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                </button>
              </div>

              {config.mvAsBackground && (
                <>
                  <div
                    className="setting-row"
                    style={{
                      marginTop: '8px',
                      borderTop: 'none',
                      paddingTop: 0
                    }}
                  >
                    <div className="setting-info">
                      <h3>{t('settings.lyricsShadowTitle')}</h3>
                      <p>{t('settings.lyricsShadowDesc')}</p>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: 12
                        }}
                      >
                        <button
                          className={`toggle-btn ${config.lyricsShadow ? 'active' : ''}`}
                          onClick={() =>
                            setConfig((prev) => ({
                              ...prev,
                              lyricsShadow: !prev.lyricsShadow
                            }))
                          }
                        >
                          {config.lyricsShadow ? (
                            <ToggleRight size={28} />
                          ) : (
                            <ToggleLeft size={28} />
                          )}
                        </button>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          width: '220px'
                        }}
                      >
                        <span style={{ fontSize: 12, opacity: 0.5 }}>0%</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={
                            config.lyricsShadowOpacity !== undefined
                              ? config.lyricsShadowOpacity
                              : 0.6
                          }
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              lyricsShadowOpacity: parseFloat(e.target.value)
                            }))
                          }
                          style={{ flex: 1 }}
                        />
                        <span style={{ fontSize: 12, opacity: 0.5 }}>100%</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </section>

            <section className="settings-section">
              <div className="section-title">
                <Zap size={20} />
                <h2>{t('settings.integrations')}</h2>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t('settings.discordTitle')}</h3>
                  <p>{t('settings.discordDesc')}</p>
                </div>
                <button
                  className={`toggle-btn ${config.enableDiscordRPC ? 'active' : ''}`}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      enableDiscordRPC: !prev.enableDiscordRPC
                    }))
                  }
                >
                  {config.enableDiscordRPC ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                </button>
              </div>
            </section>

            <section className={`settings-section eq-section ${!config.useEQ ? 'disabled' : ''}`}>
              <div
                className="section-title"
                style={{ justifyContent: 'space-between', width: '100%' }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '6px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Sliders size={20} />
                    <h2>{t('settings.eqSection')}</h2>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '12px',
                      color: 'var(--text-muted, #888)',
                      maxWidth: '52rem'
                    }}
                  >
                    {useNativeEngine
                      ? t('settings.eqEngineHintHifi')
                      : t('settings.eqEngineHintStandard')}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    className="eq-toolbar-btn"
                    onClick={() => {
                      const resetBands = config.eqBands.map((b) => ({
                        ...b,
                        gain: 0
                      }))
                      setConfig((prev) => ({
                        ...prev,
                        eqBands: resetBands,
                        preamp: 0
                      }))
                    }}
                  >
                    <Repeat size={14} /> {t('settings.reset')}
                  </button>

                  {/* Custom Preamp Styled Dropdown */}
                  <div className="custom-dropdown-container">
                    <div
                      className="dropdown-trigger"
                      onClick={() => setIsPresetOpen(!isPresetOpen)}
                    >
                      <span>
                        {t(`eqPreset.${config.activePreset || 'Custom'}`, {
                          defaultValue: config.activePreset || 'Custom'
                        })}
                      </span>
                      <ChevronDown size={14} />
                    </div>
                    {isPresetOpen && (
                      <div className="dropdown-menu show">
                        {Object.keys(EQ_PRESETS).map((name) => (
                          <div
                            key={name}
                            className="dropdown-item"
                            onClick={() => {
                              const preset = EQ_PRESETS[name]
                              if (preset) {
                                const newBands = config.eqBands?.map((b, i) => ({
                                  ...b,
                                  gain: preset.bands[i] !== undefined ? preset.bands[i] : b.gain
                                }))
                                setConfig((prev) => ({
                                  ...prev,
                                  eqBands: newBands,
                                  preamp: preset.preamp,
                                  activePreset: name
                                }))
                              } else {
                                setConfig((prev) => ({
                                  ...prev,
                                  activePreset: 'Custom'
                                }))
                              }
                              setIsPresetOpen(false)
                            }}
                          >
                            {t(`eqPreset.${name}`, { defaultValue: name })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <EqPlot
                accentHex={activeAccentHex}
                bands={config.eqBands}
                enabled={config.useEQ}
                preamp={config.preamp || 0}
                analyser={analyserNode.current}
                onPreampChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    preamp: val,
                    activePreset: 'Custom'
                  }))
                }
                onBandChange={(idx, updates) => {
                  const newBands = [...config.eqBands]
                  newBands[idx] = { ...newBands[idx], ...updates }
                  setConfig((prev) => ({
                    ...prev,
                    eqBands: newBands,
                    activePreset: 'Custom'
                  }))
                }}
              />
            </section>

            <section className="settings-section">
              <div
                className="section-title"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  width: '100%',
                  alignItems: 'center'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Palette size={20} />
                  <h2>{t('settings.aesthetics')}</h2>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    alignItems: 'center',
                    justifyContent: 'flex-end'
                  }}
                >
                  <UiButton
                    variant="secondary"
                    size="compact"
                    onClick={async () => {
                      const slice = pickThemeExportSlice(config)
                      const json = JSON.stringify(
                        {
                          type: 'echoes-studio-theme',
                          v: 1,
                          payload: slice
                        },
                        null,
                        2
                      )
                      const r = await window.api.saveThemeJsonHandler(
                        json,
                        'echoes-studio-theme.json',
                        configRef.current.uiLocale
                      )
                      if (r && r.success === false && r.error) alert(r.error)
                    }}
                  >
                    <Download size={14} /> {t('settings.exportTheme')}
                  </UiButton>
                  <UiButton
                    variant="secondary"
                    size="compact"
                    onClick={async () => {
                      const r = await window.api.openThemeJsonHandler(configRef.current.uiLocale)
                      if (r?.error) {
                        alert(r.error)
                        return
                      }
                      if (r?.content) {
                        try {
                          const bundle = parseThemeBundleJson(r.content)
                          setConfig((prev) => mergeThemeImport(prev, bundle))
                        } catch (e) {
                          alert(e.message || String(e))
                        }
                      }
                    }}
                  >
                    <Upload size={14} /> {t('settings.importTheme')}
                  </UiButton>
                  <UiButton
                    variant="primary"
                    size="compact"
                    onClick={() => {
                      const theme = normalizeThemeColors(generateRandomPalette())
                      setConfig((prev) => ({
                        ...prev,
                        theme: 'custom',
                        customColors: theme
                      }))
                    }}
                  >
                    <Wand2 size={16} /> {t('settings.randomize')}
                  </UiButton>
                </div>
              </div>

              <div
                className="themes-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '16px',
                  marginBottom: '24px'
                }}
              >
                {Object.entries(PRESET_THEMES).map(([key, theme]) => {
                  const tc = normalizeThemeColors(theme.colors)
                  const previewBg =
                    tc.bgMode === 'linear'
                      ? `linear-gradient(${tc.bgGradientAngle}deg, ${tc.bgColor}, ${tc.bgGradientEnd})`
                      : tc.bgColor
                  return (
                    <div
                      key={key}
                      style={{
                        position: 'relative',
                        padding: '12px',
                        borderRadius: '16px',
                        border: `2px solid ${config.theme === key ? 'var(--accent-pink)' : 'transparent'}`,
                        background: 'var(--glass-bg)',
                        color: 'var(--text-main)',
                        textAlign: 'center',
                        boxShadow:
                          config.theme === key
                            ? `0 8px 24px ${hexToRgbaString(tc.accent1, 0.22)}`
                            : '0 4px 12px rgba(0,0,0,0.05)',
                        transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: '8px',
                        overflow: 'hidden'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-4px)')}
                      onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setConfig({ ...config, theme: key })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setConfig({ ...config, theme: key })
                          }
                        }}
                        style={{
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '12px'
                        }}
                      >
                        <div
                          style={{
                            width: '100%',
                            height: '40px',
                            borderRadius: '8px',
                            background: previewBg,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                          }}
                        />
                        <span
                          style={{
                            fontSize: '13px',
                            zIndex: 1,
                            fontWeight: 700
                          }}
                        >
                          {t(`themePreset.${key}`, {
                            defaultValue: theme.name
                          })}
                        </span>
                        {config.theme === key && (
                          <CheckCircle2
                            size={18}
                            color="var(--accent-pink)"
                            style={{
                              position: 'absolute',
                              top: '8px',
                              right: '8px',
                              background: 'white',
                              borderRadius: '50%',
                              boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
                            }}
                          />
                        )}
                      </div>
                      <button
                        type="button"
                        className="no-drag"
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfig((prev) => ({
                            ...prev,
                            theme: 'custom',
                            customColors: normalizeThemeColors({
                              ...PRESET_THEMES[key].colors
                            })
                          }))
                        }}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          fontSize: '11px',
                          fontWeight: 700,
                          borderRadius: '10px',
                          border: '1px solid var(--glass-border)',
                          background: 'rgba(255,255,255,0.25)',
                          color: 'var(--text-main)',
                          cursor: 'pointer'
                        }}
                      >
                        Customize…
                      </button>
                    </div>
                  )
                })}

                <div
                  onClick={() =>
                    setConfig({
                      ...config,
                      theme: 'custom',
                      customColors: normalizeThemeColors(
                        config.customColors || PRESET_THEMES.minimal.colors
                      )
                    })
                  }
                  style={{
                    position: 'relative',
                    cursor: 'pointer',
                    padding: '16px',
                    borderRadius: '16px',
                    border: `2px solid ${config.theme === 'custom' ? 'var(--accent-pink)' : 'var(--glass-border)'}`,
                    background: 'var(--glass-bg)',
                    color: 'var(--text-main)',
                    fontWeight: '700',
                    textAlign: 'center',
                    boxShadow:
                      config.theme === 'custom'
                        ? `0 8px 24px ${hexToRgbaString(
                            normalizeThemeColors(
                              config.customColors || PRESET_THEMES.minimal.colors
                            ).accent1,
                            0.22
                          )}`
                        : '0 4px 12px rgba(0,0,0,0.05)',
                    transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-4px)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
                >
                  <div
                    style={{
                      width: '100%',
                      height: '40px',
                      borderRadius: '8px',
                      background: customThemePreviewBg,
                      backgroundSize: 'cover',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <Palette size={20} color="white" />
                  </div>
                  <span style={{ fontSize: '13px' }}>{t('settings.themeCustomBadge')}</span>
                  {config.theme === 'custom' && (
                    <CheckCircle2
                      size={18}
                      color="var(--accent-pink)"
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        background: 'white',
                        borderRadius: '50%',
                        boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
                      }}
                    />
                  )}
                </div>
              </div>

              <div
                style={{
                  maxHeight: config.theme === 'custom' ? '1600px' : '0px',
                  opacity: config.theme === 'custom' ? 1 : 0,
                  overflow: 'hidden',
                  transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
              >
                {config.theme === 'custom' && config.customColors && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                      gap: '12px',
                      background: 'rgba(255,255,255,0.4)',
                      padding: '24px',
                      borderRadius: '16px',
                      border: '1px solid var(--glass-border)',
                      boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.02)'
                    }}
                  >
                    {customThemeColorFields.map((field) => (
                      <div
                        key={field.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: 'var(--glass-bg)',
                          padding: '12px 16px',
                          borderRadius: '12px',
                          border: '1px solid rgba(255,255,255,0.3)',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                        onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                      >
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px'
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: 'var(--text-main)'
                            }}
                          >
                            {field.label}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--text-soft)',
                              opacity: 0.8
                            }}
                          >
                            {field.desc}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px'
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              opacity: 0.5,
                              fontFamily: 'monospace',
                              background: 'rgba(0,0,0,0.05)',
                              padding: '2px 6px',
                              borderRadius: '4px'
                            }}
                          >
                            {config.customColors[field.key].toUpperCase()}
                          </span>
                          <div
                            style={{
                              position: 'relative',
                              width: '30px',
                              height: '30px',
                              borderRadius: '50%',
                              overflow: 'hidden',
                              border: '2px solid rgba(255,255,255,0.8)',
                              boxShadow: `0 0 10px ${config.customColors[field.key]}60`,
                              flexShrink: 0
                            }}
                          >
                            <input
                              type="color"
                              value={config.customColors[field.key]}
                              onChange={(e) => {
                                setConfig((prev) => ({
                                  ...prev,
                                  customColors: {
                                    ...prev.customColors,
                                    [field.key]: e.target.value
                                  }
                                }))
                              }}
                              style={{
                                position: 'absolute',
                                top: '-10px',
                                left: '-10px',
                                width: '50px',
                                height: '50px',
                                cursor: 'pointer',
                                border: 'none',
                                padding: 0
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    <div
                      style={{
                        gridColumn: '1 / -1',
                        marginTop: 4,
                        padding: 16,
                        borderRadius: 12,
                        background: 'rgba(255,255,255,0.35)',
                        border: '1px solid var(--glass-border)'
                      }}
                    >
                      <h4
                        style={{
                          margin: '0 0 12px',
                          fontSize: 14,
                          fontWeight: 800,
                          color: 'var(--text-main)'
                        }}
                      >
                        Background gradient
                      </h4>
                      <div
                        className="setting-row"
                        style={{ border: 'none', padding: 0, marginBottom: 16 }}
                      >
                        <div className="setting-info">
                          <h4>{t('settings.gradientMode')}</h4>
                          <p>{t('settings.gradientModeDesc')}</p>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() =>
                              setConfig((prev) => ({
                                ...prev,
                                customColors: normalizeThemeColors({
                                  ...prev.customColors,
                                  bgMode: 'solid'
                                })
                              }))
                            }
                            style={{
                              opacity:
                                normalizeThemeColors(config.customColors).bgMode === 'solid'
                                  ? 1
                                  : 0.55
                            }}
                          >
                            Solid
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() =>
                              setConfig((prev) => ({
                                ...prev,
                                customColors: normalizeThemeColors({
                                  ...prev.customColors,
                                  bgMode: 'linear'
                                })
                              }))
                            }
                            style={{
                              opacity:
                                normalizeThemeColors(config.customColors).bgMode === 'linear'
                                  ? 1
                                  : 0.55
                            }}
                          >
                            Linear
                          </button>
                        </div>
                      </div>
                      {normalizeThemeColors(config.customColors).bgMode === 'linear' && (
                        <>
                          <div
                            className="setting-row"
                            style={{
                              border: 'none',
                              padding: 0,
                              marginBottom: 12
                            }}
                          >
                            <div className="setting-info">
                              <h4>{t('settings.gradientEnd')}</h4>
                              <p>{t('settings.gradientEndDesc')}</p>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  fontFamily: 'monospace',
                                  opacity: 0.75
                                }}
                              >
                                {normalizeThemeColors(
                                  config.customColors
                                ).bgGradientEnd.toUpperCase()}
                              </span>
                              <input
                                type="color"
                                value={normalizeThemeColors(config.customColors).bgGradientEnd}
                                onChange={(e) =>
                                  setConfig((prev) => ({
                                    ...prev,
                                    customColors: normalizeThemeColors({
                                      ...prev.customColors,
                                      bgGradientEnd: e.target.value
                                    })
                                  }))
                                }
                              />
                            </div>
                          </div>
                          <div className="setting-row" style={{ border: 'none', padding: 0 }}>
                            <div className="setting-info">
                              <h4>{t('settings.gradientAngle')}</h4>
                              <p>{t('settings.gradientAngleDesc')}</p>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                width: 240
                              }}
                            >
                              <span style={{ fontSize: 11, opacity: 0.5 }}>0°</span>
                              <input
                                type="range"
                                min={0}
                                max={360}
                                value={normalizeThemeColors(config.customColors).bgGradientAngle}
                                onChange={(e) =>
                                  setConfig((prev) => ({
                                    ...prev,
                                    customColors: normalizeThemeColors({
                                      ...prev.customColors,
                                      bgGradientAngle: parseInt(e.target.value, 10)
                                    })
                                  }))
                                }
                                className="slider-nc"
                              />
                              <span style={{ fontSize: 11, opacity: 0.5 }}>360°</span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Wallpaper Decor Section */}
              <div
                className="setting-subsection"
                style={{
                  marginTop: 24,
                  padding: 24,
                  background: 'rgba(255,255,255,0.3)',
                  borderRadius: 16
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 20
                  }}
                >
                  <Image size={18} />
                  <h3 style={{ fontSize: 16, fontWeight: 800 }}>Custom Wallpaper Decor</h3>
                </div>

                <div
                  className="setting-row"
                  style={{ border: 'none', padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{t('settings.coverSizeTitle', 'Cover size')}</h4>
                    <p>{t('settings.coverSizeDesc', 'Adjust the main player album cover size.')}</p>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      minWidth: '240px',
                      alignItems: 'stretch'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '12px',
                        fontSize: '12px',
                        opacity: 0.78
                      }}
                    >
                      <span>180px</span>
                      <strong>{Math.round(config.playerCoverSize ?? 360)}px</strong>
                      <span>360px</span>
                    </div>
                    <input
                      type="range"
                      min={180}
                      max={360}
                      step={4}
                      value={config.playerCoverSize ?? 360}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          playerCoverSize: parseInt(e.target.value, 10)
                        }))
                      }
                    />
                  </div>
                </div>

                <div
                  className="setting-row"
                  style={{ border: 'none', padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{t('settings.bgImage')}</h4>
                    <p>Select a local image to use as your application backdrop.</p>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {config.customBgPath && (
                      <button
                        className="btn"
                        onClick={() => setConfig((prev) => ({ ...prev, customBgPath: null }))}
                        style={{
                          width: 'auto',
                          height: '36px',
                          padding: '0 14px',
                          fontSize: 12,
                          borderRadius: 18
                        }}
                      >
                        Clear
                      </button>
                    )}
                    <button
                      className="btn"
                      onClick={async () => {
                        const path = await window.api.openImageHandler(configRef.current.uiLocale)
                        if (path)
                          setConfig((prev) => ({
                            ...prev,
                            customBgPath: path
                          }))
                      }}
                      style={{
                        width: 'auto',
                        height: '36px',
                        padding: '0 16px',
                        fontSize: 12,
                        fontWeight: 800,
                        borderRadius: 18,
                        background: 'var(--text-main)',
                        color: 'white'
                      }}
                    >
                      {config.customBgPath ? 'Change Image' : 'Select Image'}
                    </button>
                  </div>
                </div>

                {config.customBgPath && (
                  <div className="setting-row" style={{ border: 'none', padding: 0 }}>
                    <div className="setting-info">
                      <h4>{t('settings.wallpaperOpacity')}</h4>
                      <p>Adjust the visibility of your custom background image.</p>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        width: 200
                      }}
                    >
                      <span style={{ fontSize: 11, opacity: 0.5 }}>0%</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={config.customBgOpacity !== undefined ? config.customBgOpacity : 1.0}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            customBgOpacity: parseFloat(e.target.value)
                          }))
                        }
                        className="slider-nc"
                      />
                      <span style={{ fontSize: 11, opacity: 0.5 }}>100%</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Glass Intensity Section */}
              <div
                className="setting-subsection"
                style={{
                  marginTop: 16,
                  padding: 24,
                  background: 'rgba(255,255,255,0.3)',
                  borderRadius: 16
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 20
                  }}
                >
                  <Zap size={18} />
                  <h3 style={{ fontSize: 16, fontWeight: 800 }}>
                    {t('settings.glassDetailsTitle')}
                  </h3>
                </div>

                <div
                  className="setting-row"
                  style={{ border: 'none', padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{t('settings.panelTransparency')}</h4>
                    <p>{t('settings.panelTransparencyDesc')}</p>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      width: 200
                    }}
                  >
                    <span style={{ fontSize: 11, opacity: 0.5 }}>{t('settings.clear')}</span>
                    <input
                      type="range"
                      min={0}
                      max={0.95}
                      step={0.05}
                      value={config.uiBgOpacity !== undefined ? config.uiBgOpacity : 0.6}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          uiBgOpacity: parseFloat(e.target.value)
                        }))
                      }
                      className="slider-nc"
                    />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>{t('settings.solid')}</span>
                  </div>
                </div>

                <div className="setting-row" style={{ border: 'none', padding: 0 }}>
                  <div className="setting-info">
                    <h4>{t('settings.blurStrength')}</h4>
                    <p>{t('settings.blurStrengthDesc')}</p>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      width: 200
                    }}
                  >
                    <span style={{ fontSize: 11, opacity: 0.5 }}>{t('settings.blurNone')}</span>
                    <input
                      type="range"
                      min={0}
                      max={80}
                      step={1}
                      value={config.uiBlur !== undefined ? config.uiBlur : 20}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          uiBlur: parseInt(e.target.value)
                        }))
                      }
                      className="slider-nc"
                    />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>{t('settings.blurHeavy')}</span>
                  </div>
                </div>
              </div>

              <div
                className="setting-subsection"
                style={{
                  marginTop: 16,
                  padding: 24,
                  background: 'rgba(255,255,255,0.3)',
                  borderRadius: 16
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 20
                  }}
                >
                  <Sliders size={18} />
                  <h3 style={{ fontSize: 16, fontWeight: 800 }}>
                    {t('settings.typographySection')}
                  </h3>
                </div>

                <div
                  className="setting-row"
                  style={{ border: 'none', padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{t('settings.uiFont')}</h4>
                    <p>{t('settings.uiFontDesc')}</p>
                    <p
                      style={{
                        fontSize: 12,
                        opacity: 0.65,
                        marginTop: 6
                      }}
                    >
                      {t('settings.fontCustomHint')}
                    </p>
                  </div>
                  <div className="settings-font-custom-meta no-drag">
                    <div className="settings-chip-row">
                      {['outfit', 'inter', 'system'].map((key) => (
                        <button
                          key={key}
                          type="button"
                          className={`list-filter-chip ${(config.uiFontFamily || 'outfit') === key ? 'active' : ''}`}
                          onClick={() =>
                            setConfig((prev) => ({
                              ...prev,
                              uiFontFamily: key,
                              uiCustomFontPath: null
                            }))
                          }
                        >
                          {key === 'outfit'
                            ? t('settings.fontOutfit')
                            : key === 'inter'
                              ? t('settings.fontInter')
                              : t('settings.fontSystem')}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`list-filter-chip ${config.uiFontFamily === 'custom' ? 'active' : ''}`}
                        onClick={() => {
                          if (config.uiFontFamily === 'custom' && config.uiCustomFontPath) {
                            return
                          }
                          setConfig((prev) => ({
                            ...prev,
                            uiFontFamily: 'custom'
                          }))
                          void pickUiCustomFont()
                        }}
                      >
                        {t('settings.fontCustom')}
                      </button>
                    </div>
                    {config.uiFontFamily === 'custom' && config.uiCustomFontPath && (
                      <span className="settings-font-file-name" title={config.uiCustomFontPath}>
                        {t('settings.fontCustomActive', {
                          name:
                            config.uiCustomFontPath.split(/[/\\]/).pop() || config.uiCustomFontPath
                        })}
                      </span>
                    )}
                    {(config.uiFontFamily === 'custom' || config.uiCustomFontPath) && (
                      <div className="settings-chip-row" style={{ marginTop: 4 }}>
                        <button
                          type="button"
                          className="list-filter-chip"
                          onClick={() => void pickUiCustomFont()}
                        >
                          {t('settings.fontAddFile')}
                        </button>
                        {config.uiCustomFontPath ? (
                          <button
                            type="button"
                            className="list-filter-chip"
                            onClick={() =>
                              setConfig((prev) => ({
                                ...prev,
                                uiFontFamily: 'outfit',
                                uiCustomFontPath: null
                              }))
                            }
                          >
                            {t('settings.fontClearCustom')}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className="setting-row"
                  style={{ border: 'none', padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{t('settings.baseFontSize')}</h4>
                    <p>{t('settings.baseFontSizeDesc')}</p>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      width: 220
                    }}
                  >
                    <span style={{ fontSize: 11, opacity: 0.5 }}>12</span>
                    <input
                      type="range"
                      min={12}
                      max={20}
                      step={1}
                      value={config.uiBaseFontSize ?? 15}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          uiBaseFontSize: parseInt(e.target.value, 10)
                        }))
                      }
                      className="slider-nc"
                    />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>20</span>
                  </div>
                </div>

                <div
                  className="setting-row"
                  style={{ border: 'none', padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{t('settings.radiusScale')}</h4>
                    <p>{t('settings.radiusScaleDesc')}</p>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      width: 220
                    }}
                  >
                    <span style={{ fontSize: 11, opacity: 0.5 }}>{t('settings.radiusTight')}</span>
                    <input
                      type="range"
                      min={0.85}
                      max={1.15}
                      step={0.05}
                      value={config.uiRadiusScale ?? 1}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          uiRadiusScale: parseFloat(e.target.value)
                        }))
                      }
                      className="slider-nc"
                    />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>{t('settings.radiusSoft')}</span>
                  </div>
                </div>

                <div
                  className="setting-row"
                  style={{ border: 'none', padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{t('settings.shadowStrength')}</h4>
                    <p>{t('settings.shadowStrengthDesc')}</p>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      width: 220
                    }}
                  >
                    <span style={{ fontSize: 11, opacity: 0.5 }}>{t('settings.shadowFlat')}</span>
                    <input
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.05}
                      value={config.uiShadowIntensity ?? 1}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          uiShadowIntensity: parseFloat(e.target.value)
                        }))
                      }
                      className="slider-nc"
                    />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>{t('settings.shadowDeep')}</span>
                  </div>
                </div>

                <div
                  className="setting-row"
                  style={{ border: 'none', padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{t('settings.saturation')}</h4>
                    <p>{t('settings.saturationDesc')}</p>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      width: 220
                    }}
                  >
                    <span style={{ fontSize: 11, opacity: 0.5 }}>0.8</span>
                    <input
                      type="range"
                      min={0.8}
                      max={1.2}
                      step={0.02}
                      value={config.uiSaturation ?? 1}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          uiSaturation: parseFloat(e.target.value)
                        }))
                      }
                      className="slider-nc"
                    />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>1.2</span>
                  </div>
                </div>

                <div className="setting-row" style={{ border: 'none', padding: 0 }}>
                  <div className="setting-info">
                    <h4>{t('settings.accentGlow')}</h4>
                    <p>Large radial highlights using accent colors (disable for a flatter look).</p>
                  </div>
                  <button
                    type="button"
                    className={`toggle-btn ${config.uiAccentBackgroundGlow !== false ? 'active' : ''}`}
                    onClick={() =>
                      setConfig((prev) => ({
                        ...prev,
                        uiAccentBackgroundGlow: !(prev.uiAccentBackgroundGlow !== false)
                      }))
                    }
                  >
                    {config.uiAccentBackgroundGlow !== false ? (
                      <ToggleRight size={32} />
                    ) : (
                      <ToggleLeft size={32} />
                    )}
                  </button>
                </div>

                <div className="setting-row" style={{ border: 'none', padding: '16px 0 0 0' }}>
                  <div className="setting-info">
                    <h4>动态封面取色 (自适应主题)</h4>
                    <p>提取当前播放歌曲的专辑封面主色调并作为主题。</p>
                  </div>
                  <button
                    type="button"
                    className={`toggle-btn ${config.themeDynamicCoverColor ? 'active' : ''}`}
                    onClick={() =>
                      setConfig((prev) => ({
                        ...prev,
                        themeDynamicCoverColor: !prev.themeDynamicCoverColor
                      }))
                    }
                  >
                    {config.themeDynamicCoverColor ? (
                      <ToggleRight size={32} />
                    ) : (
                      <ToggleLeft size={32} />
                    )}
                  </button>
                </div>

                <div className="setting-row" style={{ border: 'none', padding: '16px 0 0 0' }}>
                  <div className="setting-info">
                    <h4>直接以封面为背景</h4>
                    <p>将当前正在播放的封面图作为背景显示。</p>
                  </div>
                  <button
                    type="button"
                    className={`toggle-btn ${config.themeCoverAsBackground ? 'active' : ''}`}
                    onClick={() =>
                      setConfig((prev) => ({
                        ...prev,
                        themeCoverAsBackground: !prev.themeCoverAsBackground
                      }))
                    }
                  >
                    {config.themeCoverAsBackground ? (
                      <ToggleRight size={32} />
                    ) : (
                      <ToggleLeft size={32} />
                    )}
                  </button>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <Download size={20} />
                <h2>{t('settings.mediaDownloader')}</h2>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t('settings.downloadDirTitle')}</h3>
                  <p>{t('settings.downloadDirDesc')}</p>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--text-soft)',
                      maxWidth: 180,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {config.downloadFolder || t('settings.notSet')}
                  </span>
                  <UiButton
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      const folders = await window.api.openDirectoryHandler()
                      if (folders && folders.length > 0) {
                        setConfig((prev) => ({
                          ...prev,
                          downloadFolder: folders[0]
                        }))
                      }
                    }}
                  >
                    {t('settings.setFolder')}
                  </UiButton>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t('settings.autoSaveLibraryTitle')}</h3>
                  <p>{t('settings.autoSaveLibraryDesc')}</p>
                </div>
                <button
                  className={`toggle-btn ${config.autoSaveLibrary !== false ? 'active' : ''}`}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      autoSaveLibrary: !(prev.autoSaveLibrary !== false)
                    }))
                  }
                >
                  {config.autoSaveLibrary !== false ? (
                    <ToggleRight size={32} />
                  ) : (
                    <ToggleLeft size={32} />
                  )}
                </button>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t('settings.plImportTitle')}</h3>
                  <p>{t('settings.plImportDesc')}</p>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--text-soft)',
                      maxWidth: 180,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                    title={config.playlistImportFolder || config.downloadFolder || ''}
                  >
                    {config.playlistImportFolder
                      ? config.playlistImportFolder
                      : config.downloadFolder
                        ? t('settings.sameAsDownload')
                        : t('settings.notSet')}
                  </span>
                  <UiButton
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      const folders = await window.api.openDirectoryHandler()
                      if (folders && folders.length > 0) {
                        setConfig((prev) => ({
                          ...prev,
                          playlistImportFolder: folders[0]
                        }))
                      }
                    }}
                  >
                    {t('settings.chooseFolder')}
                  </UiButton>
                  {config.playlistImportFolder ? (
                    <UiButton
                      variant="ghost"
                      size="sm"
                      style={{ opacity: 0.85 }}
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          playlistImportFolder: null
                        }))
                      }
                    >
                      {t('settings.useDownloadFolder')}
                    </UiButton>
                  ) : null}
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t('settings.libraryCleanupTitle', 'Library cleanup')}</h3>
                  <p>
                    {missingLibraryPaths.length > 0
                      ? t(
                          'settings.libraryCleanupFound',
                          `${missingLibraryPaths.length} invalid path(s) found in your library references.`
                        )
                      : t(
                          'settings.libraryCleanupDesc',
                          'Scan the current library, playlists, likes, and playback history for missing files.'
                        )}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <UiButton
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void scanMissingLibraryPaths()
                    }}
                    disabled={libraryCleanupBusy}
                  >
                    {libraryCleanupBusy
                      ? t('settings.libraryCleanupScanning', 'Scanning...')
                      : t('settings.libraryCleanupScan', 'Scan')}
                  </UiButton>
                  <UiButton
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void cleanupMissingLibraryPaths()
                    }}
                    disabled={libraryCleanupBusy || missingLibraryPaths.length === 0}
                    style={{
                      opacity: libraryCleanupBusy || missingLibraryPaths.length === 0 ? 0.55 : 1
                    }}
                  >
                    {t('settings.libraryCleanupRemove', 'Remove invalid entries')}
                  </UiButton>
                </div>
              </div>
              {missingLibraryPaths.length > 0 ? (
                <div
                  style={{
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-secondary)',
                    display: 'grid',
                    gap: 6
                  }}
                >
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {t('settings.libraryCleanupPreview', 'Preview of invalid paths')}
                  </div>
                  {missingLibraryPaths.slice(0, 5).map((path) => (
                    <div
                      key={path}
                      style={{
                        fontSize: 12,
                        color: 'var(--text-soft)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                      title={path}
                    >
                      {path}
                    </div>
                  ))}
                  {missingLibraryPaths.length > 5 ? (
                    <div style={{ fontSize: 12, opacity: 0.55 }}>
                      {t(
                        'settings.libraryCleanupMore',
                        `and ${missingLibraryPaths.length - 5} more...`
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="settings-section">
              <div className="section-title">
                <Info size={20} />
                <h2>{t('settings.about')}</h2>
              </div>
              <p style={{ opacity: 0.6, fontSize: '14px', lineHeight: 1.6 }}>
                {t('settings.aboutBody')}
              </p>
              <div
                className="settings-version-text"
                style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
              >
                {t('settings.versionText', { version: appVersion || '1.1.2' })}
                <button
                  className="control-btn"
                  disabled={isUpdating}
                  onClick={() => {
                    setIsUpdating(true)
                    setUpdateStatus({ event: 'checking' })
                    window.api?.checkForUpdates?.()
                  }}
                  style={{
                    padding: '4px 12px',
                    fontSize: '12px',
                    borderRadius: '4px',
                    background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border)',
                    cursor: isUpdating ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isUpdating
                    ? t('settings.checkingForUpdates', 'Checking...')
                    : t('settings.checkUpdates', 'Check for Updates')}
                </button>
              </div>
              {updateStatus && updateStatus.event !== 'checking' && (
                <div style={{ marginTop: '6px' }}>
                  {updateStatus.event === 'download-progress' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <p style={{ fontSize: '12px', opacity: 0.8, margin: 0 }}>
                        {t('settings.downloading', 'Downloading update...')}{' '}
                        {updateStatus.percent ?? 0}%
                      </p>
                      <div
                        style={{
                          width: '260px',
                          height: '4px',
                          borderRadius: '2px',
                          background: 'var(--color-border)',
                          overflow: 'hidden'
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${updateStatus.percent ?? 0}%`,
                            background: 'var(--color-accent, #3b82f6)',
                            borderRadius: '2px',
                            transition: 'width 0.3s ease'
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {updateStatus.event !== 'download-progress' && (
                    <p style={{ fontSize: '12px', opacity: 0.8, margin: 0 }}>
                      {updateStatus.event === 'update-available'
                        ? t('settings.updateAvailable', 'Update available, downloading...')
                        : updateStatus.event === 'update-not-available'
                          ? t('settings.updateNotAvailable', 'You are on the latest version.')
                          : updateStatus.event === 'update-downloaded'
                            ? t(
                                'settings.updateDownloaded',
                                `v${updateStatus.version} downloaded, will install on exit.`
                              )
                            : updateStatus.event === 'error'
                              ? t('settings.updateError', 'Error checking for updates.')
                              : ''}
                    </p>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 12 }}>
                <button
                  className="control-btn"
                  onClick={() => {
                    const nextOpen = !releaseNotesOpen
                    setReleaseNotesOpen(nextOpen)
                    if (nextOpen) {
                      void loadReleaseNotes()
                    }
                  }}
                  style={{
                    padding: '4px 12px',
                    fontSize: '12px',
                    borderRadius: '4px',
                    background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border)',
                    cursor: 'pointer'
                  }}
                >
                  {t('settings.viewChangelog', 'View changelog')}
                </button>
                <button
                  className="control-btn"
                  disabled={releaseNotesLoading}
                  onClick={() => {
                    setReleaseNotesOpen(true)
                    void loadReleaseNotes(true)
                  }}
                  style={{
                    padding: '4px 12px',
                    fontSize: '12px',
                    borderRadius: '4px',
                    background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border)',
                    cursor: releaseNotesLoading ? 'not-allowed' : 'pointer'
                  }}
                >
                  {t('settings.refreshChangelog', 'Refresh changelog')}
                </button>
                <button
                  className="control-btn"
                  onClick={() => openExternalLink(GITHUB_RELEASES_PAGE_URL)}
                  style={{
                    padding: '4px 12px',
                    fontSize: '12px',
                    borderRadius: '4px',
                    background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border)',
                    cursor: 'pointer'
                  }}
                >
                  {t('settings.openReleasesPage', 'Open releases page')}
                </button>
              </div>
              {releaseNotesOpen ? (
                <div
                  style={{
                    marginTop: 12,
                    padding: 14,
                    borderRadius: 12,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-secondary)'
                  }}
                >
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {preferredReleaseVersion
                        ? t('settings.releaseNotesForVersion', {
                            version: `v${preferredReleaseVersion}`
                          })
                        : t('settings.releaseNotesLatest', 'Latest release notes')}
                    </div>
                    <div style={{ opacity: 0.7, fontSize: '12px' }}>
                      {t(
                        'settings.releaseNotesHint',
                        'Recent fixes and changes are pulled from GitHub Releases.'
                      )}
                    </div>
                  </div>
                  {releaseNotesLoading ? (
                    <p style={{ margin: 0, opacity: 0.8 }}>
                      {t('settings.releaseNotesLoading', 'Loading changelog...')}
                    </p>
                  ) : releaseNotesError ? (
                    <p style={{ margin: 0, opacity: 0.8 }}>
                      {t(
                        'settings.releaseNotesUnavailable',
                        'Release notes are temporarily unavailable.'
                      )}{' '}
                      ({releaseNotesError})
                    </p>
                  ) : visibleReleaseNotes.length === 0 ? (
                    <p style={{ margin: 0, opacity: 0.8 }}>
                      {t(
                        'settings.releaseNotesUnavailable',
                        'Release notes are temporarily unavailable.'
                      )}
                    </p>
                  ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {visibleReleaseNotes.map((release) => {
                        const isPreferred =
                          preferredReleaseVersion &&
                          normalizeReleaseVersion(release.version) === preferredReleaseVersion
                        return (
                          <div
                            key={`${release.version}-${release.url}`}
                            style={{
                              padding: 12,
                              borderRadius: 10,
                              border: `1px solid ${isPreferred ? 'var(--color-accent, #3b82f6)' : 'var(--color-border)'}`,
                              background: 'var(--color-bg-primary)'
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                justifyContent: 'space-between',
                                gap: 12
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: 600 }}>
                                  {release.title || `v${release.version || '?'}`}
                                </div>
                                <div style={{ opacity: 0.7, fontSize: '12px', marginTop: 2 }}>
                                  {release.publishedLabel || `v${release.version || '?'}`}
                                </div>
                              </div>
                              <button
                                className="control-btn"
                                onClick={() => openExternalLink(release.url)}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: '12px',
                                  borderRadius: '4px',
                                  background: 'var(--color-bg-secondary)',
                                  border: '1px solid var(--color-border)',
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {t('settings.openFullRelease', 'Open release')}
                              </button>
                            </div>
                            {Array.isArray(release.previewLines) &&
                            release.previewLines.length > 0 ? (
                              <ul style={{ margin: '10px 0 0 18px', padding: 0, lineHeight: 1.5 }}>
                                {release.previewLines.slice(0, 4).map((line, index) => (
                                  <li key={`${release.version}-preview-${index}`}>{line}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : null}
              <p className="settings-version-text">{t('settings.poweredBy')}</p>
              <div className="setting-row" style={{ marginTop: 8 }}>
                <div className="setting-info">
                  <h3>{t('settings.devModeTitle')}</h3>
                  <p>{t('settings.devModeDesc')}</p>
                </div>
                <button
                  type="button"
                  className={`toggle-btn ${config.devModeEnabled ? 'active' : ''}`}
                  onClick={() =>
                    setConfig((prev) => {
                      const nextDevModeEnabled = !prev.devModeEnabled
                      return {
                        ...prev,
                        devModeEnabled: nextDevModeEnabled,
                        devOpenDevToolsOnStartup: nextDevModeEnabled
                          ? prev.devOpenDevToolsOnStartup
                          : false
                      }
                    })
                  }
                  aria-pressed={!!config.devModeEnabled}
                >
                  {config.devModeEnabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                </button>
              </div>
              {config.devModeEnabled ? (
                <>
                  <div className="setting-row">
                    <div className="setting-info">
                      <h3>{t('settings.devStartupTitle')}</h3>
                      <p>{t('settings.devStartupDesc')}</p>
                    </div>
                    <button
                      type="button"
                      className={`toggle-btn ${config.devOpenDevToolsOnStartup ? 'active' : ''}`}
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          devOpenDevToolsOnStartup: !prev.devOpenDevToolsOnStartup
                        }))
                      }
                      aria-pressed={!!config.devOpenDevToolsOnStartup}
                    >
                      {config.devOpenDevToolsOnStartup ? (
                        <ToggleRight size={32} />
                      ) : (
                        <ToggleLeft size={32} />
                      )}
                    </button>
                  </div>
                  <div className="setting-row">
                    <div className="setting-info">
                      <h3>{t('settings.devConsoleTitle')}</h3>
                      <p>{t('settings.devConsoleDesc')}</p>
                    </div>
                    <UiButton
                      variant="secondary"
                      onClick={async () => {
                        try {
                          if (!window.api?.dev?.openDevTools) {
                            alert(t('settings.devUnavailable'))
                            return
                          }
                          const res = await window.api.dev.openDevTools()
                          if (!res?.ok) {
                            alert(
                              t('settings.devOpenFailed', {
                                message: res?.error || 'unknown'
                              })
                            )
                          }
                        } catch (e) {
                          alert(e?.message || String(e))
                        }
                      }}
                    >
                      {t('settings.devOpenConsole')}
                    </UiButton>
                  </div>
                  <div className="setting-row">
                    <div className="setting-info">
                      <h3>{t('settings.devReloadTitle')}</h3>
                      <p>{t('settings.devReloadDesc')}</p>
                    </div>
                    <UiButton
                      variant="secondary"
                      onClick={async () => {
                        try {
                          if (!window.api?.dev?.reloadWindow) {
                            alert(t('settings.devUnavailable'))
                            return
                          }
                          const res = await window.api.dev.reloadWindow()
                          if (!res?.ok) {
                            alert(
                              t('settings.devReloadFailed', {
                                message: res?.error || 'unknown'
                              })
                            )
                          }
                        } catch (e) {
                          alert(e?.message || String(e))
                        }
                      }}
                    >
                      {t('settings.devReloadButton')}
                    </UiButton>
                  </div>
                  <div className="setting-row">
                    <div className="setting-info">
                      <h3>{t('settings.devCrashDirTitle')}</h3>
                      <p>{t('settings.devCrashDirDesc')}</p>
                    </div>
                    <UiButton variant="secondary" onClick={() => window.api?.openCrashDir?.()}>
                      {t('settings.devOpenFolder')}
                    </UiButton>
                  </div>
                  <div className="setting-row">
                    <div className="setting-info">
                      <h3>{t('settings.devUserDataTitle')}</h3>
                      <p>{t('settings.devUserDataDesc')}</p>
                    </div>
                    <UiButton
                      variant="secondary"
                      onClick={async () => {
                        try {
                          if (!window.api?.dev?.openUserData) {
                            alert(t('settings.devUnavailable'))
                            return
                          }
                          const res = await window.api.dev.openUserData()
                          if (!res?.ok) {
                            alert(
                              t('settings.devUserDataFailed', {
                                message: res?.error || 'unknown'
                              })
                            )
                          }
                        } catch (e) {
                          alert(e?.message || String(e))
                        }
                      }}
                    >
                      {t('settings.devOpenFolder')}
                    </UiButton>
                  </div>
                </>
              ) : null}
            </section>

            <PluginSlot name="settingsPanel" />

            <section className="settings-section">
              <div className="section-title" style={{ color: '#ff4d4f' }}>
                <Trash2 size={20} aria-hidden />
                <h2>{t('settings.dangerZone')}</h2>
              </div>
              <div className="setting-row" style={{ border: 'none', padding: '16px 0' }}>
                <div className="setting-info">
                  <h3 style={{ color: '#ff4d4f' }}>{t('settings.resetThemeTitle')}</h3>
                  <p>{t('settings.resetThemeDesc')}</p>
                </div>
                <UiButton variant="danger" onClick={handleResetThemeConfig}>
                  {t('settings.resetThemeButton')}
                </UiButton>
              </div>
              <div className="setting-row" style={{ border: 'none', padding: '16px 0' }}>
                <div className="setting-info">
                  <h3 style={{ color: '#ff4d4f' }}>{t('settings.resetAllTitle')}</h3>
                  <p>{t('settings.resetAllDesc')}</p>
                </div>
                <UiButton variant="danger" onClick={handleResetAllConfig}>
                  {t('settings.resetAllButton')}
                </UiButton>
              </div>
            </section>
          </div>
        </div>
      )}

      <LyricsCandidatePicker
        open={lyricsCandidateOpen}
        loading={lyricsCandidateLoading}
        items={lyricsCandidateItems}
        onClose={() => setLyricsCandidateOpen(false)}
        onPick={handleLyricsCandidatePick}
        onSearch={searchLyricsCandidates}
      />
      <LyricsSettingsDrawer
        open={lyricsDrawerOpen}
        onClose={() => setLyricsDrawerOpen(false)}
        config={config}
        setConfig={setConfig}
        lyricsMatchStatus={lyricsMatchStatus}
        lyricTimelineValid={lyricTimelineValid}
        lyricsSourceUi={lyricsSourceUi}
        onRefreshLyrics={retryFetchLyrics}
        onOpenManualSearch={openLyricsCandidatePicker}
        onFetchLyricsFromLink={fetchLyricsFromSourceLink}
        onApplyLyricsText={applyLyricsFromText}
        onNativeLyricsFilePick={pickLyricsFileNative}
      />
      <>
        <div
          className={`lyrics-drawer-backdrop ${historyMenuOpen ? 'lyrics-drawer-backdrop--open' : ''}`}
          onClick={() => setHistoryMenuOpen(false)}
          aria-hidden={!historyMenuOpen}
        />
        <aside
          className={`lyrics-drawer-panel playback-history-drawer-panel ${historyMenuOpen ? 'lyrics-drawer-panel--open' : ''}`}
          role="dialog"
          aria-label={t('player.playbackHistory', 'Playback history')}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="lyrics-drawer-header">
            <h2 className="lyrics-drawer-title">
              <History size={18} />
              {t('player.playbackHistory', 'Playback history')}
            </h2>
            <button
              type="button"
              className="lyrics-drawer-close"
              onClick={() => setHistoryMenuOpen(false)}
              aria-label={t('aria.close')}
            >
              <X size={20} />
            </button>
          </div>
          <div className="lyrics-drawer-body playback-history-drawer-body">
            <section className="lyrics-drawer-section playback-history-drawer-hero">
              <div className="playback-history-drawer-hero-main">
                <span className="playback-history-drawer-kicker">
                  {t('player.playbackHistory', 'Playback history')}
                </span>
                <strong className="playback-history-drawer-count">
                  {playbackHistoryEntries.length > 0
                    ? t('player.historyCountLabel', {
                        count: playbackHistoryEntries.length,
                        defaultValue: `${playbackHistoryEntries.length} tracks in this session`
                      })
                    : t('empty.historyEmpty', 'No playback history yet.')}
                </strong>
                <p className="playback-history-drawer-copy">
                  {playbackHistoryEntries.length > 0
                    ? t(
                        'player.historyDrawerHint',
                        'Use this column to jump back through what you listened to.'
                      )
                    : playbackHistory.length > 0
                      ? t(
                          'player.historyMissingHint',
                          'Saved history exists, but those tracks are no longer available in the current playlist.'
                        )
                      : t(
                          'player.historyDrawerEmptyHint',
                          'Once you switch songs, your recent path will appear here.'
                        )}
                </p>
              </div>
              <div className="playback-history-drawer-actions">
                <button
                  type="button"
                  className="playback-history-drawer-action playback-history-drawer-action--primary"
                  onClick={handleHistoryMenuBack}
                  disabled={playbackHistory.length === 0}
                >
                  <SkipBack size={15} />
                  <span>{t('player.backHistory', 'Back through history')}</span>
                </button>
                <button
                  type="button"
                  className="playback-history-drawer-action playback-history-drawer-action--secondary"
                  onClick={handleHistoryMenuClear}
                  disabled={playbackHistory.length === 0}
                >
                  <Trash2 size={15} />
                  <span>{t('player.clearHistory', 'Clear')}</span>
                </button>
              </div>
            </section>

            <section className="lyrics-drawer-section">
              <div className="audio-drawer-section-header">
                <History size={16} />
                <span className="audio-drawer-section-label">
                  {t('player.recentTracks', 'Recent tracks')}
                </span>
              </div>
              {playbackHistoryEntries.length === 0 ? (
                <div className="playback-history-drawer-empty">
                  {playbackHistory.length > 0
                    ? t(
                        'player.historyMissingHint',
                        'Saved history exists, but those tracks are no longer available in the current playlist.'
                      )
                    : t('empty.historyEmpty', 'No playback history yet.')}
                </div>
              ) : (
                <div className="playback-history-drawer-list">
                  {playbackHistoryEntries.map((entry, entryIndex) => {
                    const track = entry.track
                    const displayArtist =
                      track && track.info.artist !== 'Unknown Artist'
                        ? track.info.artist
                        : track
                          ? albumArtistByName[track.info.album] || track.info.artist
                          : entry.artist || t('track.unknownArtist', 'Unknown Artist')
                    const displayAlbum =
                      track?.info?.album && track.info.album !== 'Unknown Album'
                        ? track.info.album
                        : entry.album
                          ? entry.album
                          : t('track.unknownAlbum', 'Unknown Album')
                    const displayTitle =
                      track?.info?.title || entry.title || fileNameFromPath(entry.path)
                    const playCount =
                      track && Number(trackStats[track.path]?.playCount) > 0
                        ? trackStats[track.path].playCount
                        : 0
                    return (
                      <button
                        key={`${entry.path}-history-drawer-${entry.historyIndex}`}
                        type="button"
                        className="playback-history-drawer-item"
                        onClick={() => handleHistoryMenuJump(entry.historyIndex)}
                        title={`${displayTitle} - ${displayArtist}`}
                      >
                        <div className="playback-history-drawer-item-top">
                          <span className="playback-history-drawer-item-order">
                            {entryIndex === 0
                              ? t('player.historyMostRecent', 'Most recent')
                              : t('player.historyOrderLabel', {
                                  index: entryIndex + 1,
                                  defaultValue: `#${entryIndex + 1}`
                                })}
                          </span>
                          <span className="playback-history-drawer-item-album">{displayAlbum}</span>
                        </div>
                        <span className="playback-history-drawer-item-title">{displayTitle}</span>
                        <span className="playback-history-drawer-item-subtitle">
                          {displayArtist}
                          {playCount > 0 && ` - 听过 ${playCount} 次`}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        </aside>
      </>
      <MediaDownloaderDrawer
        open={downloaderDrawerOpen}
        onClose={() => setDownloaderDrawerOpen(false)}
        config={config}
        setConfig={setConfig}
        userPlaylists={userPlaylists}
        setUserPlaylists={setUserPlaylists}
        setPlaylist={setPlaylist}
        setSelectedUserPlaylistId={setSelectedUserPlaylistId}
        onSuccess={(payload) => {
          const filePath = typeof payload === 'string' ? payload : payload?.path
          if (!filePath) return
          const sourceUrl =
            typeof payload === 'object' &&
            payload &&
            typeof payload.sourceUrl === 'string' &&
            payload.sourceUrl.trim()
              ? payload.sourceUrl.trim()
              : undefined
          const mvOriginUrl =
            typeof payload === 'object' &&
            payload &&
            typeof payload.mvOriginUrl === 'string' &&
            payload.mvOriginUrl.trim()
              ? payload.mvOriginUrl.trim()
              : undefined
          const fileName = filePath.split(/[/\\]/).pop()
          const newTrack = {
            name: fileName,
            path: filePath,
            type: 'local',
            ...(payload?.hasLyrics ? { hasLyrics: true } : {}),
            ...(sourceUrl ? { sourceUrl } : {}),
            ...(mvOriginUrl ? { mvOriginUrl } : {})
          }
          setPlaylist((prev) => {
            const exists = prev.find((p) => p.path === filePath)
            return exists ? prev : [...prev, newTrack]
          })
        }}
      />
      <ListenTogetherDrawer
        open={listenTogetherDrawerOpen}
        onClose={() => setListenTogetherDrawerOpen(false)}
        t={t}
        currentTrack={currentTrack}
        nextTrack={nextTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={displayProgressDuration}
        syncContent={listenTogetherSyncContent}
        onRemotePlayState={handleListenTogetherRemoteState}
        onHostUploadStart={handleHostUploadStart}
        onHostPlayAfterBuffer={handleHostPlayAfterBuffer}
        onHostUploadEnd={handleHostUploadEnd}
      />
      <AudioSettingsDrawer
        open={audioSettingsDrawerOpen}
        onClose={() => setAudioSettingsDrawerOpen(false)}
        audioDevices={audioDevices}
        config={config}
        setConfig={setConfig}
      />
      <MetadataEditorDrawer
        open={metadataEditorOpen}
        onClose={() => {
          setMetadataEditorOpen(false)
          setMetadataEditorTrack(null)
        }}
        track={metadataEditorTrack}
        initialMetadata={
          metadataEditorTrack
            ? {
                ...(trackMetaMap[metadataEditorTrack.path] || {}),
                title:
                  trackMetaMap[metadataEditorTrack.path]?.title ||
                  parseTrackInfo(metadataEditorTrack, trackMetaMap[metadataEditorTrack.path])?.title ||
                  stripExtension(metadataEditorTrack.name || ''),
                artist:
                  trackMetaMap[metadataEditorTrack.path]?.artist ||
                  parseTrackInfo(metadataEditorTrack, trackMetaMap[metadataEditorTrack.path])?.artist ||
                  '',
                album:
                  trackMetaMap[metadataEditorTrack.path]?.album ||
                  parseTrackInfo(metadataEditorTrack, trackMetaMap[metadataEditorTrack.path])?.album ||
                  '',
                cover:
                  trackMetaMap[metadataEditorTrack.path]?.cover ||
                  (currentTrack?.path === metadataEditorTrack.path ? coverUrl : null) ||
                  null
              }
            : null
        }
        onSave={handleSaveTrackMetadata}
      />
      <CastReceiveDrawer open={castDrawerOpen} onClose={() => setCastDrawerOpen(false)} />
      <MvSettingsDrawer
        open={mvDrawerOpen}
        onClose={() => setMvDrawerOpen(false)}
        config={config}
        setConfig={setConfig}
        signInStatus={signInStatus}
        onYoutubeSignIn={handleOpenYoutubeSignIn}
        onBilibiliSignIn={handleOpenBilibiliSignIn}
        mvId={mvId}
        setMvId={setMvId}
        mvPlaybackQuality={mvPlaybackQuality}
        biliDirectStream={biliDirectStream}
        onPersistMvOverride={(mv) => {
          const p = playlist[currentIndex]?.path
          if (p && mv?.id && mv?.source) setMvOverrideForPath(p, mv)
        }}
        onRestartPlayback={() => {
          setCurrentTime(0)
          syncYTVideo(0)
          if (useNativeEngineRef.current && window.api?.playAudio) {
            const tp = playlist[currentIndex]?.path
            if (tp) window.api.playAudio(tp, 0, playbackRateRef.current).catch(console.error)
          } else if (audioRef.current) {
            audioRef.current.currentTime = 0
          }
        }}
      />
      <PluginManagerDrawer open={pluginDrawerOpen} onClose={() => setPluginDrawerOpen(false)} />
      <PluginSlot name="drawers" />
      <div className="song-share-capture-root" aria-hidden>
        <div ref={songCardCaptureRef} className="song-share-card">
          {shareCardSnapshot?.cover ? (
            <div
              className="song-share-card-bg-image"
              style={{ backgroundImage: `url(${shareCardSnapshot.cover})` }}
            />
          ) : null}
          <div className="song-share-card-bg-overlay" />
          <div className="song-share-card-glow song-share-card-glow--a" />
          <div className="song-share-card-glow song-share-card-glow--b" />
          <div className="song-share-card-cover">
            {shareCardSnapshot?.cover ? (
              <img
                src={shareCardSnapshot.cover}
                alt={shareCardSnapshot.title || t('lyrics.coverAlt')}
                className="song-share-card-cover-image"
              />
            ) : (
              <div className="song-share-card-cover-fallback">
                <Music size={86} />
              </div>
            )}
          </div>
          <div className="song-share-card-meta">
            <p className="song-share-card-badge">ECHO</p>
            <h2 className="song-share-card-title">
              {shareCardSnapshot?.title || displayMainTitle || t('player.selectTrack')}
            </h2>
            <p className="song-share-card-artist">
              {shareCardSnapshot?.artist || displayMainArtist || t('common.unknownArtist')}
            </p>
            <p className="song-share-card-album">{shareCardSnapshot?.album || displayMainAlbum}</p>
            <div className="song-share-card-divider" />
            <div className="song-share-card-footer">
              <span className="song-share-card-chip">Hi-Fi Player</span>
              <span className="song-share-card-chip">Now Playing</span>
            </div>
          </div>
        </div>
      </div>
      {youtubeMvLoginHint && mvId?.source === 'youtube' && config.enableMV && (
        <div className="yt-mv-login-hint" role="status">
          <span className="yt-mv-login-hint-text">{t('youtubeHint.body')}</span>
          <div className="yt-mv-login-hint-actions">
            <button
              type="button"
              className="yt-mv-login-hint-btn"
              onClick={() => {
                setView('settings')
                setYoutubeMvLoginHint(false)
              }}
            >
              {t('youtubeHint.openSettings')}
            </button>
            <button
              type="button"
              className="yt-mv-login-hint-btn primary"
              onClick={() => {
                handleOpenYoutubeSignIn()
                setYoutubeMvLoginHint(false)
              }}
            >
              {t('youtubeHint.signInNow')}
            </button>
            <button
              type="button"
              className="yt-mv-login-hint-dismiss"
              aria-label={t('aria.dismiss')}
              onClick={() => setYoutubeMvLoginHint(false)}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
      {trackContextMenu &&
        createPortal(
          <div
            ref={trackContextMenuRef}
            className={`track-ctx-menu-portal${ctxMenuVisualOpen ? ' track-ctx-menu-portal--open' : ''}`}
            role="menu"
            aria-label={t('aria.trackContextMenu')}
            style={{
              position: 'fixed',
              ...(() => {
                const mw = 220
                const mh = 400
                let left = trackContextMenu.clientX
                let top = trackContextMenu.clientY
                const iw = typeof window !== 'undefined' ? window.innerWidth : 800
                const ih = typeof window !== 'undefined' ? window.innerHeight : 600
                if (left + mw > iw - 8) left = iw - mw - 8
                if (top + mh > ih - 8) top = ih - mh - 8
                return { left: Math.max(8, left), top: Math.max(8, top) }
              })(),
              zIndex: 20052
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {(() => {
              const tr = trackContextMenu.track
              const path = tr.path
              const rowLiked = likedSet.has(path)
              const inUpNext = upNextPathSet.has(path)
              const localPath = isLocalAudioFilePath(path)
              const displayArtistCtx =
                tr.info.artist === 'Unknown Artist'
                  ? albumArtistByName[tr.info.album] || tr.info.artist
                  : tr.info.artist
              const trackLine = `${tr.info.title} — ${displayArtistCtx}`
              const copyToClipboard = async (text) => {
                try {
                  if (window.api?.writeClipboardText) {
                    const r = await window.api.writeClipboardText(text)
                    if (r && r.ok === false && r.error)
                      alert(t('contextMenu.actionFailed', { detail: r.error }))
                  } else if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text)
                  } else {
                    alert(t('contextMenu.actionFailed', { detail: 'clipboard_unavailable' }))
                  }
                } catch (err) {
                  alert(t('contextMenu.actionFailed', { detail: err?.message || String(err) }))
                }
              }
              return (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={() => {
                      toggleLike(path)
                      closeTrackContextMenuAnimated()
                    }}
                  >
                    <Heart size={14} aria-hidden /> {rowLiked ? t('like.unlike') : t('like.like')}
                  </button>
                  {(listMode === 'songs' ||
                    (listMode === 'playlists' &&
                      (selectedUserPlaylistId || selectedSmartCollectionId))) && (
                    <button
                      type="button"
                      role="menuitem"
                      className="track-ctx-item"
                      onClick={() => {
                        openAddToPlaylistAtPoint(
                          trackContextMenu.clientX,
                          trackContextMenu.clientY,
                          tr
                        )
                      }}
                    >
                      <ListPlus size={14} aria-hidden /> {t('contextMenu.addToPlaylist')}
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={() => {
                      const result = enqueueUpNextTrack(tr)
                      if (!result.ok && result.reason === 'duplicate') return
                      closeTrackContextMenuAnimated()
                    }}
                    disabled={inUpNext}
                  >
                    <SkipForward size={14} aria-hidden /> {t('contextMenu.playNext')}
                  </button>
                  {inUpNext && (
                    <button
                      type="button"
                      role="menuitem"
                      className="track-ctx-item track-ctx-item--danger"
                      onClick={() => {
                        removeFromUpNextQueue(path)
                        closeTrackContextMenuAnimated()
                      }}
                    >
                      <Minus size={14} aria-hidden /> {t('contextMenu.removeFromUpNext')}
                    </button>
                  )}
                  {listMode === 'songs' && (
                    <button
                      type="button"
                      role="menuitem"
                      className="track-ctx-item track-ctx-item--danger"
                      onClick={() => {
                        removeTrackFromMainPlaylist(path)
                        closeTrackContextMenuAnimated()
                      }}
                    >
                      <Trash2 size={14} aria-hidden /> {t('contextMenu.removeFromQueue')}
                    </button>
                  )}
                  {listMode === 'playlists' && selectedUserPlaylistId && (
                    <button
                      type="button"
                      role="menuitem"
                      className="track-ctx-item track-ctx-item--danger"
                      onClick={() => {
                        removePathFromUserPlaylist(selectedUserPlaylistId, path)
                        closeTrackContextMenuAnimated()
                      }}
                    >
                      <Minus size={14} aria-hidden /> {t('contextMenu.removeFromPlaylist')}
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={() => {
                      openMetadataEditorForTrack(tr)
                      closeTrackContextMenuAnimated()
                    }}
                    disabled={!localPath}
                  >
                    <Pencil size={14} aria-hidden /> {t('contextMenu.editMetadata', 'Edit tags')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={async () => {
                      await copyToClipboard(trackLine)
                      closeTrackContextMenuAnimated()
                    }}
                  >
                    <Copy size={14} aria-hidden /> {t('contextMenu.copyTrackLine')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={async () => {
                      await handleCopyTrackCardImage(tr)
                      closeTrackContextMenuAnimated()
                    }}
                    disabled={isCardActionBusy}
                  >
                    <Copy size={14} aria-hidden /> {t('contextMenu.copyTrackImage')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={async () => {
                      await handleSaveTrackCardImage(tr)
                      closeTrackContextMenuAnimated()
                    }}
                    disabled={isCardActionBusy}
                  >
                    <Image size={14} aria-hidden /> {t('contextMenu.saveTrackImage')}
                  </button>
                  {localPath && (
                    <button
                      type="button"
                      role="menuitem"
                      className="track-ctx-item"
                      onClick={async () => {
                        await copyToClipboard(path)
                        closeTrackContextMenuAnimated()
                      }}
                    >
                      <Copy size={14} aria-hidden /> {t('contextMenu.copyPath')}
                    </button>
                  )}
                  {localPath && window.api?.openPath && (
                    <button
                      type="button"
                      role="menuitem"
                      className="track-ctx-item"
                      onClick={async () => {
                        try {
                          const r = await window.api.openPath(path)
                          if (r && r.ok === false && r.error)
                            alert(t('contextMenu.actionFailed', { detail: r.error }))
                        } catch (err) {
                          alert(
                            t('contextMenu.actionFailed', { detail: err?.message || String(err) })
                          )
                        }
                        closeTrackContextMenuAnimated()
                      }}
                    >
                      <AppWindow size={14} aria-hidden /> {t('contextMenu.openWithDefaultApp')}
                    </button>
                  )}
                  {localPath && window.api?.showItemInFolder && (
                    <button
                      type="button"
                      role="menuitem"
                      className="track-ctx-item"
                      onClick={async () => {
                        try {
                          const r = await window.api.showItemInFolder(path)
                          if (r && r.ok === false && r.error)
                            alert(t('contextMenu.actionFailed', { detail: r.error }))
                        } catch (err) {
                          alert(
                            t('contextMenu.actionFailed', { detail: err?.message || String(err) })
                          )
                        }
                        closeTrackContextMenuAnimated()
                      }}
                    >
                      <FolderOpen size={14} aria-hidden /> {t('contextMenu.showInFolder')}
                    </button>
                  )}
                </>
              )
            })()}
          </div>,
          document.body
        )}
      {coverContextMenu &&
        createPortal(
          <div
            ref={coverContextMenuRef}
            className={`track-ctx-menu-portal${coverCtxVisualOpen ? ' track-ctx-menu-portal--open' : ''}`}
            role="menu"
            aria-label={t('aria.coverContextMenu', 'Cover actions')}
            style={{
              position: 'fixed',
              ...(() => {
                const mw = 220
                const mh = 140
                let left = coverContextMenu.clientX
                let top = coverContextMenu.clientY
                const iw = typeof window !== 'undefined' ? window.innerWidth : 800
                const ih = typeof window !== 'undefined' ? window.innerHeight : 600
                if (left + mw > iw - 8) left = iw - mw - 8
                if (top + mh > ih - 8) top = ih - mh - 8
                return { left: Math.max(8, left), top: Math.max(8, top) }
              })(),
              zIndex: 20052
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {(() => {
              const tr = coverContextMenu.track
              return (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={async () => {
                      await handleCopyTrackCardImage(tr)
                      closeCoverContextMenuAnimated()
                    }}
                    disabled={isCardActionBusy || !tr}
                  >
                    <Copy size={14} aria-hidden /> {t('contextMenu.copyTrackImage')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={async () => {
                      await handleSaveTrackCardImage(tr)
                      closeCoverContextMenuAnimated()
                    }}
                    disabled={isCardActionBusy || !tr}
                  >
                    <Image size={14} aria-hidden /> {t('contextMenu.saveTrackImage')}
                  </button>
                </>
              )
            })()}
          </div>,
          document.body
        )}
      {groupContextMenu &&
        createPortal(
          <div
            ref={groupContextMenuRef}
            className={`track-ctx-menu-portal${groupCtxVisualOpen ? ' track-ctx-menu-portal--open' : ''}`}
            role="menu"
            aria-label={t('aria.groupContextMenu', 'Album or folder actions')}
            style={{
              position: 'fixed',
              ...(() => {
                const mw = 220
                const mh = 220
                let left = groupContextMenu.clientX
                let top = groupContextMenu.clientY
                const iw = typeof window !== 'undefined' ? window.innerWidth : 800
                const ih = typeof window !== 'undefined' ? window.innerHeight : 600
                if (left + mw > iw - 8) left = iw - mw - 8
                if (top + mh > ih - 8) top = ih - mh - 8
                return { left: Math.max(8, left), top: Math.max(8, top) }
              })(),
              zIndex: 20052
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {(() => {
              const type = groupContextMenu.type
              const group = groupContextMenu.group
              const name = group?.name || ''
              const copyName = async () => {
                try {
                  if (window.api?.writeClipboardText) {
                    const r = await window.api.writeClipboardText(name)
                    if (r && r.ok === false && r.error) {
                      alert(t('contextMenu.actionFailed', { detail: r.error }))
                    }
                  } else if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(name)
                  } else {
                    alert(t('contextMenu.actionFailed', { detail: 'clipboard_unavailable' }))
                  }
                } catch (err) {
                  alert(t('contextMenu.actionFailed', { detail: err?.message || String(err) }))
                }
              }
              return (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={() => {
                      if (type === 'album') {
                        handlePickAlbumFromSidebar(group)
                      } else {
                        handlePickFolderFromSidebar(group)
                      }
                      closeGroupContextMenuAnimated()
                    }}
                  >
                    <FolderOpen size={14} aria-hidden />{' '}
                    {type === 'album'
                      ? t('contextMenu.openAlbum', 'Open album')
                      : t('contextMenu.openFolder', 'Open folder')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={() => playGroupNow(type, group)}
                  >
                    <Play size={14} aria-hidden /> {t('contextMenu.playGroupNow', 'Play from here')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={() => queueGroupNext(group)}
                  >
                    <SkipForward size={14} aria-hidden />{' '}
                    {t('contextMenu.playGroupNext', 'Queue all next')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={async () => {
                      await copyName()
                      closeGroupContextMenuAnimated()
                    }}
                  >
                    <Copy size={14} aria-hidden /> {t('contextMenu.copyGroupName', 'Copy name')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={() => revealGroupInExplorer(type, group)}
                  >
                    <FolderOpen size={14} aria-hidden />{' '}
                    {t('contextMenu.revealInExplorer', 'Show in Explorer')}
                  </button>
                </>
              )
            })()}
          </div>,
          document.body
        )}
      {addToPlaylistMenu &&
        createPortal(
          <>
            <div
              className={`add-to-pl-backdrop${addPlVisualOpen ? ' add-to-pl-backdrop--open' : ''}`}
              aria-hidden
              onMouseDown={() => closeAddToPlaylistAnimated()}
            />
            <div
              className={`add-to-pl-menu-portal${addPlVisualOpen ? ' add-to-pl-menu-portal--open' : ''}`}
              role="dialog"
              aria-label={t('aria.addToPlaylistDialog')}
              style={{
                position: 'fixed',
                top: addToPlaylistMenu.top,
                left: addToPlaylistMenu.left,
                width: addToPlaylistMenu.width,
                zIndex: 20050
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="add-to-pl-menu-header">{t('addToPl.header')}</div>
              <div className="add-to-pl-menu-body">
                {userPlaylists.length === 0 ? (
                  <p className="add-to-pl-hint">{t('addToPl.noPlaylistsHint')}</p>
                ) : (
                  userPlaylists.map((pl) => (
                    <button
                      key={pl.id}
                      type="button"
                      className="add-to-pl-item"
                      onClick={() => addPathToUserPlaylist(pl.id, addToPlaylistMenu.path)}
                    >
                      {pl.name}
                    </button>
                  ))
                )}
                <div className="add-to-pl-new-block">
                  <span className="add-to-pl-new-label">{t('addToPl.createNewLabel')}</span>
                  <div className="add-to-pl-new-row">
                    <input
                      type="text"
                      className="add-to-pl-new-input"
                      placeholder={t('addToPl.namePlaceholder')}
                      value={quickNewPlaylistName}
                      onChange={(e) => setQuickNewPlaylistName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') createPlaylistAndAddTrackFromPopover()
                      }}
                    />
                    <button
                      type="button"
                      className="add-to-pl-new-confirm"
                      onClick={createPlaylistAndAddTrackFromPopover}
                    >
                      {t('addToPl.add')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  )
}
