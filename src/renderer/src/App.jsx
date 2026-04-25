/*
 * App.jsx is a legacy integration surface. Keep new feature logic in focused
 * components, utils, config, main/preload modules, or styles first.
 * Read docs/APP_JSX_CHANGE_MAP.md before editing this file.
 */
import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
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
  FileOutput,
  Disc,
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
  Globe,
  Link,
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
  History,
  GripVertical,
  Tag,
  Gauge,
  RotateCcw
} from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import LyricsSettingsDrawer from './components/LyricsSettingsDrawer'
import MediaDownloaderDrawer from './components/MediaDownloaderDrawer'
import MvSettingsDrawer from './components/MvSettingsDrawer'
import AudioSettingsDrawer from './components/AudioSettingsDrawer'
import CastReceiveDrawer from './components/CastReceiveDrawer'
import ListenTogetherDrawer from './components/ListenTogetherDrawer'
import LyricsCandidatePicker from './components/LyricsCandidatePicker'
import MetadataEditorDrawer from './components/MetadataEditorDrawer'
import ImportedFolderRail from './components/ImportedFolderRail'
import { UiButton } from './components/ui'
import AudioQualityBadges from './components/AudioQualityBadges'
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
import { readTrackMetaCache, writeTrackMetaCache } from './utils/trackMetaCache'

/** `<audio src>` 闂傚倸鍊搁崐鎼佸磹閹间讲鈧箓顢楅崟顐わ紱闂佸憡娲﹂崐瀣洪鍕幯冾熆鐠虹尨鍔熼柣銈呮搐閳规垿顢欐慨鎰捕闂佺顑嗛幐鎼佸煘閹达附鏅柛鏇炵仛椤ユ挾绱撴担鍝勑ｇ紒瀣灴閸┿儲寰勬繛鐐€婚棅顐㈡搐濞撮妲愰敃鍌涒拻闁稿本鐟х粣鏃€绻涙担鍐叉濞咃綁姊绘担鍛婂暈濞撴碍顨婂畷浼村箻鐎靛壊娴勯梺闈涚箞閸婃牠鍩涢幒鎳ㄥ綊鏁愰崼顐ｇ秷闂侀潧娲ㄩ崰鏍蓟濞戙垺鍋愰柧蹇ｅ亞椤︻厾绱撴笟鍥ф灈闁绘锕︾划顓㈡偄閻撳海鍔﹀銈嗗笒鐎氼喖鐣垫笟鈧弻娑㈠箛閳轰礁顥嬮梺鍝勫暙閻楀棗顔忓┑鍥ヤ簻闁哄啫鍊哥敮璺侯熆?file: URL闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔兼倻濡儵鎷婚梺娲诲幗閻熲晠寮婚垾鎰佸悑閹肩补鈧磭顔戦梻浣侯焾鐎涒晠銆冩繝鍥ц摕闁绘梻鈷堥弫宥夋煕閳╁喚娈欓悗姘卞缁绘盯宕奸顫枈濠殿喖锕ュ钘夌暦閵婏妇绡€闁告劦鐓堝Σ閬嶆⒒娴ｈ鍋犻柛鏂跨Т椤灝顫滈埀顒勫春閵忕媭鍚嬪璺侯儐濞呫垽姊虹紒妯忣亞澹曢銏犲偍?`#`闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲稿鍫罕闂備礁鎼崐褰掝敄濞嗗浚鐒?`闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲稿鍫罕闂備礁鎼崯顐﹀磹缂佹鈻旂€广儱顦伴悡娆徫涢悧鍫㈢畺闂佸鍏榦de 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弬鍨挃闁活厽鐟╅弻鐔封枎闄囬褍煤椤撱垹绠栫憸鏂跨暦婵傚憡鍋勯柛婵勫劚婵炲洤鈹戦悩鍨毄濠殿喗鎸抽弫鍐Χ婢跺浜遍梺绯曞墲閻熝囨儗?`file://` 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰▕閻掕姤绻涢崱妯诲碍閻熸瑱绠撻幃妤呮晲鎼粹剝鐏嶉梺鎼炲€曢懟顖濈亙闂佹寧绻傞幊搴ㄥ汲濞嗗浚娴栭柛娑樼摠閳锋垹鐥鐐村櫤鐟滄妸鍛＜闁绘ê鍟块悘瀵糕偓?*/
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
const SIDEBAR_META_PREFETCH_BEHIND_ROWS = 16
const SIDEBAR_META_PREFETCH_AHEAD_ROWS = 72
const ALBUM_META_PREFETCH_BEHIND_ROWS = 2
const ALBUM_META_PREFETCH_AHEAD_ROWS = 8
const SIDEBAR_ROW_HEIGHT = 64
const SIDEBAR_DETAIL_ROW_HEIGHT = 60
const ALBUM_GRID_DEFAULT_ROW_HEIGHT = 68
const ALBUM_GRID_DEFAULT_GAP = 10
const RENDERER_PERSIST_DEBOUNCE_MS = 600
const MV_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const BILI_STREAM_CACHE_TTL_MS = 8 * 60 * 1000
const PLAYBACK_SESSION_LOCAL_KEY = 'nc_playback_session'
const USER_SMART_COLLECTIONS_LOCAL_KEY = 'nc_user_smart_collections'
const DISPLAY_METADATA_OVERRIDES_LOCAL_KEY = 'nc_display_metadata_overrides'
const MAX_MV_SEARCH_CACHE_ENTRIES = 24
const MAX_BILI_STREAM_CACHE_ENTRIES = 12
const MAX_LRCLIB_CACHE_ENTRIES = 40
const MAX_TRACK_META_COVER_ENTRIES = 1800
const LIBRARY_META_CACHE_HYDRATE_BATCH_SIZE = 400
const METADATA_PREFETCH_LIMIT = 96
const ALBUM_METADATA_PREFETCH_LIMIT = 1200
const METADATA_PARSE_BATCH_SIZE = 18
const ALBUM_METADATA_PARSE_BATCH_SIZE = 48
const METADATA_PARSE_WORKERS = 4
const ALBUM_CLOUD_COVER_PREFETCH_LIMIT = 16
const ALBUM_CLOUD_COVER_WORKERS = 2
const MAX_SHARE_CARD_COVER_CHARS = 600000
const CLOUD_COVER_RESOLUTION = '600x600bb'
const SIDEBAR_LOGO_IMAGE_PATH = 'D:\\ECHO - 副本 (3) - 副本\\1.png'

function normalizeCoverLookupText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function normalizeNeteaseCoverUrl(url) {
  const cleanUrl = String(url || '').trim()
  if (!cleanUrl) return null
  return `${cleanUrl.replace(/\?.*$/, '')}?param=600y600`
}

function normalizeItunesCoverUrl(url) {
  const cleanUrl = String(url || '').trim()
  if (!cleanUrl) return null
  return cleanUrl.replace(/100x100bb(\.[a-z0-9]+)$/i, `${CLOUD_COVER_RESOLUTION}$1`)
}

function scoreCoverCandidate(candidate, title, artist, album) {
  const wantedTitle = normalizeCoverLookupText(title)
  const wantedArtist = normalizeCoverLookupText(artist)
  const wantedAlbum = normalizeCoverLookupText(album)
  const candidateTitle = normalizeCoverLookupText(candidate?.name)
  const candidateArtist = normalizeCoverLookupText(candidate?.artists || candidate?.artist)
  const candidateAlbum = normalizeCoverLookupText(candidate?.album)

  if (!wantedTitle || !candidateTitle) return 0
  if (
    candidateTitle !== wantedTitle &&
    !candidateTitle.includes(wantedTitle) &&
    !wantedTitle.includes(candidateTitle)
  ) {
    return 0
  }

  let score = candidateTitle === wantedTitle ? 8 : 5
  if (wantedArtist && candidateArtist) {
    if (candidateArtist === wantedArtist) score += 4
    else if (candidateArtist.includes(wantedArtist) || wantedArtist.includes(candidateArtist)) score += 2
  }
  if (wantedAlbum && candidateAlbum) {
    if (candidateAlbum === wantedAlbum) score += 3
    else if (candidateAlbum.includes(wantedAlbum) || wantedAlbum.includes(candidateAlbum)) score += 1
  }
  return score
}

function pickBestCoverCandidate(items, title, artist, album) {
  return (items || [])
    .filter((item) => item?.cover || item?.picUrl)
    .map((item) => ({ item, score: scoreCoverCandidate(item, title, artist, album) }))
    .filter((entry) => entry.score >= 5)
    .sort((a, b) => b.score - a.score)[0]?.item
}

function pickBestAlbumCoverCandidate(items, album, artist) {
  const wantedAlbum = normalizeCoverLookupText(album)
  const wantedArtist = normalizeCoverLookupText(artist)
  if (!wantedAlbum) return null

  return (items || [])
    .filter((item) => item?.picUrl || item?.cover || item?.artworkUrl100)
    .map((item) => {
      const candidateAlbum = normalizeCoverLookupText(item?.name || item?.album || item?.collectionName)
      const candidateArtist = normalizeCoverLookupText(item?.artist || item?.artists || item?.artistName)
      if (
        !candidateAlbum ||
        (candidateAlbum !== wantedAlbum &&
          !candidateAlbum.includes(wantedAlbum) &&
          !wantedAlbum.includes(candidateAlbum))
      ) {
        return { item, score: 0 }
      }

      let score = candidateAlbum === wantedAlbum ? 8 : 5
      if (wantedArtist && candidateArtist) {
        if (candidateArtist === wantedArtist) score += 4
        else if (candidateArtist.includes(wantedArtist) || wantedArtist.includes(candidateArtist)) {
          score += 2
        }
      }
      return { item, score }
    })
    .filter((entry) => entry.score >= 5)
    .sort((a, b) => b.score - a.score)[0]?.item
}

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

function normalizeUpNextQueue(value) {
  if (!Array.isArray(value)) return undefined
  const seen = new Set()
  const next = []
  for (const entry of value) {
    const path =
      typeof entry === 'string' ? entry : entry && typeof entry.path === 'string' ? entry.path : ''
    if (!path || seen.has(path)) continue
    seen.add(path)
    next.push({ path })
  }
  return next
}

function queueDragTransformToString(transform) {
  if (!transform) return undefined
  const x = Number.isFinite(transform.x) ? transform.x : 0
  const y = Number.isFinite(transform.y) ? transform.y : 0
  const scaleX = Number.isFinite(transform.scaleX) ? transform.scaleX : 1
  const scaleY = Number.isFinite(transform.scaleY) ? transform.scaleY : 1
  return `translate3d(${x}px, ${y}px, 0) scaleX(${scaleX}) scaleY(${scaleY})`
}

function getPathBasename(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || ''
}

function getPathDirname(filePath) {
  const normalized = String(filePath || '')
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return idx >= 0 ? normalized.slice(0, idx) : ''
}

function isAbsolutePlaylistPath(value) {
  const path = String(value || '').trim()
  return (
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.startsWith('\\\\') ||
    path.startsWith('/') ||
    /^https?:\/\//i.test(path)
  )
}

function resolvePlaylistEntryPath(entry, playlistFilePath) {
  const raw = String(entry || '').trim()
  if (!raw) return ''
  if (/^file:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      const decoded = decodeURIComponent(url.pathname || '')
      if (url.host) return `\\\\${url.host}${decoded.replace(/\//g, '\\')}`
      return decoded.replace(/^\/([a-zA-Z]:)/, '$1').replace(/\//g, '\\')
    } catch {
      return raw
    }
  }
  if (isAbsolutePlaylistPath(raw)) return raw
  const baseDir = getPathDirname(playlistFilePath)
  if (!baseDir) return raw
  const separator = baseDir.includes('\\') ? '\\' : '/'
  return `${baseDir.replace(/[\\/]+$/, '')}${separator}${raw.replace(/^[\\/]+/, '')}`
}

function parseM3UPlaylist(content, filePath) {
  const paths = []
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    paths.push(resolvePlaylistEntryPath(line, filePath))
  }
  return [...new Set(paths.filter(Boolean))]
}

const UpNextQueueSortableItem = memo(function UpNextQueueSortableItem({
  item,
  index,
  albumArtistByName,
  onRemove,
  removeButtonTitle
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.path
  })
  const displayArtist =
    item.track.info.artist === 'Unknown Artist'
      ? albumArtistByName[item.track.info.album] || item.track.info.artist
      : item.track.info.artist

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: queueDragTransformToString(transform),
        transition
      }}
      className={`queue-preview-item${isDragging ? ' queue-preview-item--dragging' : ''}`}
    >
      <button
        type="button"
        className="queue-preview-handle"
        aria-label="Reorder queue item"
        title="Reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <span className="queue-preview-index">{index + 1}.</span>
      <span className="queue-preview-text" title={`${item.track.info.title} - ${displayArtist}`}>
        {item.track.info.title} - {displayArtist}
      </span>
      <button
        type="button"
        className="queue-preview-remove"
        onClick={() => onRemove(item.path)}
        title={removeButtonTitle}
      >
        <Minus size={14} />
      </button>
    </div>
  )
})

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

function trimTrackMetaCoverEntries(metaMap, keepPaths = new Set(), maxEntries = MAX_TRACK_META_COVER_ENTRIES) {
  if (!metaMap || typeof metaMap !== 'object') return metaMap
  const coverEntries = Object.entries(metaMap).filter(([, entry]) => {
    return typeof entry?.cover === 'string' && entry.cover
  })
  if (coverEntries.length <= maxEntries) return metaMap

  const protectedPaths = keepPaths instanceof Set ? keepPaths : new Set()
  const removableEntries = coverEntries.filter(([path]) => !protectedPaths.has(path))
  const removeCount = Math.min(removableEntries.length, coverEntries.length - maxEntries)
  if (removeCount <= 0) return metaMap

  const next = { ...metaMap }
  for (const [path, entry] of removableEntries.slice(0, removeCount)) {
    next[path] = {
      ...entry,
      cover: null,
      coverChecked: true,
      coverMemoryTrimmed: true
    }
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

function resolveContextMenuPoint(eventLike, fallbackElement = null) {
  const event = eventLike || null
  const currentTarget = event?.currentTarget || fallbackElement || null
  const rect =
    currentTarget && typeof currentTarget.getBoundingClientRect === 'function'
      ? currentTarget.getBoundingClientRect()
      : null
  const clientX = Number.isFinite(event?.clientX)
    ? event.clientX
    : rect
      ? rect.left + Math.min(rect.width / 2, 24)
      : 24
  const clientY = Number.isFinite(event?.clientY)
    ? event.clientY
    : rect
      ? rect.top + Math.min(rect.height / 2, 24)
      : 24
  return { clientX, clientY }
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
  if (merged.closeButtonBehavior !== 'quit' && merged.closeButtonBehavior !== 'tray') {
    merged.closeButtonBehavior = DEFAULT_CONFIG.closeButtonBehavior
  }
  if (!['time', 'track'].includes(merged.sleepTimerMode)) {
    merged.sleepTimerMode = DEFAULT_CONFIG.sleepTimerMode
  }
  if (typeof merged.crossfadeEnabled !== 'boolean') {
    merged.crossfadeEnabled = DEFAULT_CONFIG.crossfadeEnabled
  }
  if (
    !Number.isFinite(merged.crossfadeDuration) ||
    merged.crossfadeDuration < 1 ||
    merged.crossfadeDuration > 12
  ) {
    merged.crossfadeDuration = DEFAULT_CONFIG.crossfadeDuration
  }
  if (![5, 10, 15, 30, 45, 60, 90].includes(merged.sleepTimerMinutes)) {
    merged.sleepTimerMinutes = DEFAULT_CONFIG.sleepTimerMinutes
  }
  if (typeof merged.sleepTimerEnabled !== 'boolean') {
    merged.sleepTimerEnabled = DEFAULT_CONFIG.sleepTimerEnabled
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

const SLEEP_TIMER_MINUTE_OPTIONS = [5, 10, 15, 30, 45, 60, 90]
/* const SETTINGS_SECTION_KEYWORDS = {
  language: ['language', 'locale', '闂傚倸鍊搁崐宄懊归崶褏鏆﹂柛顭戝亝閸欏繘鏌℃径瀣鐟滅増甯掔壕濂告煟閹邦垰鐨洪柣鎾村灴濮婃椽鏌呴悙鑼跺濠⒀勬尦閺?, 'en', 'zh', 'ja', '闂傚倸鍊搁崐宄懊归崶褏鏆﹂柣銏㈩焾缁愭骞栧ǎ顒€濡介柛搴＄У缁绘繈妫冨☉鍗炲壈缂佺偓鍎抽…鐑藉蓟閻旂厧绀堢憸蹇曟暜濞戙垺鐓?],
  engine: [
    'visualizer',
    'spectrum',
    'waveform',
    'eq',
    'equalizer',
    'buffer',
    'crossfade',
    'sleep',
    'timer',
    'asio',
    'exclusive',
    'audio',
    '闂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛顐ｆ穿缂嶆牠鎮楅敐搴℃灈缂佲偓閸愵喗鐓冮柛婵嗗閺嗗﹪鏌℃担鍝バф慨濠勭帛缁楃喖鍩€椤掆偓椤洩顦查摶鐐碘偓鍏夊亾闁告洦鍋嗛敍?,
    '闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵稿妽闁哄懏绻堥弻鏇熷緞濞戞﹩娲紓浣哄У閸庢娊鍩為幋锔藉亹闁告瑥顦崑宥夋⒑?,
    '婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧潡鏌熺€电孝缂佽翰鍊栫换娑橆啅椤旇崵鐩庨梺缁樺笒閻忔岸濡甸崟顖氱闁糕剝銇炴竟鏇㈡⒒娴ｅ憡鎲搁柛鐘查叄閹ê鈹戠€ｅ灚鏅梺鎸庣箓椤︿即骞嗛悙娣簻闁规壋鏅涢埀顒侇殜椤㈡瑩寮撮姀鈾€鎷洪梺鍦焾濞撮绮婚幘缁樼厱濠电姴瀚弳顒傗偓瑙勬礃閸ㄥ潡鐛Ο鍏煎珰闁肩⒈鍓﹀Σ浼存⒒娴ｅ憡鍟為柣鐔村劦钘濋柛妤冨€?,
    '闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇楀亾妞ゎ亜鍟村畷绋课旈埀顒傚婵犳碍鐓欓柟瑙勫姇閻撴劖銇勯锝嗙闁哄矉绻濆畷鍫曞煛娴ｇ顥愰梻?,
    '闂傚倸鍊搁崐宄懊归崶顒夋晪鐟滃秹锝炲┑瀣櫇闁稿矉濡囩粙蹇旂節閵忥絾纭鹃柤娲诲灦瀵悂宕奸埗鈺佷壕妤犵偛鐏濋崝姘舵煙瀹勯偊鍎忛柕?,
    '闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲搁弮鍫濈畺鐟滄柨鐣烽悢纰辨晬婵ɑ鍞荤槐顕€姊绘担渚敯闁规椿浜炵划濠氬箣閻樺樊妫滅紓鍌欑劍椤洨寮ч埀顒勬⒒閸屾氨澧涘〒姘殜瀹曟洝绠涘☉妯垮煘濡炪倖鐗滈崑鐐哄煕閹寸姭鍋撶憴鍕婵炶绠撳畷鐢稿焵椤掑嫭鈷戦悹鍥皺缁犺尙绱掔拠鎻掓殶缂侇喖顑呴鍏煎緞鐎ｎ亖鍋撻悜鑺ョ厽闁瑰鍎愰悞浠嬫煕濮楀棔閭慨濠冩そ瀹曟粓骞撻幒宥咁棜缂傚倷鐒﹁ぐ鍐焽閳ュ磭鏆﹀┑鍌氬閺佸倿鏌涢銈呮灁闁?,
    '闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲搁弮鍫濈畺鐟滃秹鈥﹂妸鈺侀唶婵犻潧妫涢埀顒夊幖椤啴濡堕崱妤冪懆闁诲孩鍑归崜娑欑珶閺囩姵宕夐柕濠忕畱閺嬫垿姊虹紒姗嗘當闁绘妫涚划顓㈠箳濡も偓閻愬﹪鏌℃径瀣闁哄啫鐗婇崑鎰版⒒閸喓鈼ョ紒顔肩埣濮婅櫣鎷犻懠顒傤唹缂備浇顕ч悧鍡涙偩瀹勬壋鏀介悗锝庝簻閼板灝鈹戦悙鏉戠仸闁荤啙鍥у偍妞ゅ繐鐗婇埛鎴︽煕閹炬潙绲诲ù婊勵殕娣囧﹪鎮欓弶鎴狀儌缂備緡鍠栭悧濠勭箔閻旂厧鐒垫い鎺嗗亾闁伙絿鍏樻慨鈧柕鍫濇噽椤斿懘姊洪崗闂磋埅闁稿孩濞婂畷?
  ],
  integrations: ['discord', 'rpc', 'presence', '闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧湱绱掔€ｎ収鍤︽繛鎴烆焸閺冨牆鐒垫い鎺戝暟娴滆鲸绻濋悽闈涗粶婵☆偅鐟╅獮鎰板箹娴ｇ鐎?, '闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜滃ù鏍煏婵炵偓娅嗛柛濠傛健閺屻劑寮村Δ鈧禍鎯ь渻閵堝骸骞栨繛灞傚€濋崺銏℃償閵娿儳顔掗悗瑙勬礀濞层劑寮?, '闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣椤愪粙鏌ㄩ悢鍝勑㈢痪鎯ь煼閺岀喖骞戦幇顓犮€愮紓浣界堪閸婃洝鐏冮梺鎸庣箓閹冲酣寮冲▎鎴犵＜?],
  eq: ['eq', 'equalizer', 'parametric', 'preamp', 'band', '闂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛顐ｆ穿缂嶆牠鎮楅敐搴℃灈缂佲偓閸愵喗鐓冮柛婵嗗閺嗗﹪鏌℃担鍝バф慨濠勭帛缁楃喖鍩€椤掆偓椤洩顦查摶鐐碘偓鍏夊亾闁告洦鍋嗛敍娑㈡⒑閻熸澘鈷旂紒顕呭灦閸?, '闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偛顦甸弫鎾绘偐閸愯弓鐢婚梻渚€娼чˇ顐﹀疾濞戞艾顥氱憸鐗堝笚閻撴洜鎲告惔銊ｂ偓鍐川鐎涙ǚ鎷?, '闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲搁弮鍫濈畺鐟滄柨鐣烽悢纰辨晬婵ɑ鍞荤槐顕€姊绘担渚敯闁规椿浜炵划濠氬箣閻樺樊妫滅紓鍌欑劍椤洨寮ч埀顒勬⒒閸屾氨澧涘〒姘殜瀹曟洝绠涘☉妯垮煘濡炪倖鐗滈崑鐐哄煕閹寸姭鍋撶憴鍕婵炶绠撳畷鐢稿焵椤掑嫭鈷戦悹鍥皺缁犺尙绱掔拠鎻掓殶缂侇喖顑呴鍏煎緞鐎ｎ亖鍋撻悜鑺ョ厽闁瑰鍎愰悞浠嬫煕濮楀棔閭慨濠冩そ瀹曟粓骞撻幒宥咁棜缂傚倷鐒﹁ぐ鍐焽閳ュ磭鏆﹀┑鍌氬閺佸倿鏌涢銈呮灁闁?],
  aesthetics: [
    'theme',
    'color',
    'background',
    'blur',
    'font',
    'radius',
    'opacity',
    'gradient',
    '濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈閸ㄥ倿鏌涢锝嗙缂佺姳鍗抽弻鐔兼⒒绾惧鍞归梺閫炲苯澧剧紒鐘虫崌楠炲啫顭ㄩ崟顒€寮块梺纭呭焽閸斿本绂?,
    '濠电姷鏁告慨鐑姐€傞挊澹╋綁宕ㄩ弶鎴狅紱闂佺硶鍓濊摫婵炲懐濮垫穱濠囧Χ閸涱厽娈梺鎼炲妽缁诲牓鎮￠锕€鐐婇柕濠忚吂閹峰姊?,
    '闂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛顐ｆ礀閸屻劎鎲搁弬璺ㄦ殾妞ゆ牜鍋涢柨銈嗕繆閵堝倸浜鹃柣搴㈣壘椤︿即濡甸崟顖氱闁糕剝銇炴竟鏇㈡⒒?,
    '闂傚倸鍊搁崐宄懊归崶顒夋晪鐟滃繘鍩€椤掍胶鈻撻柡鍛箘閸掓帒鈻庨幘宕囶唺濠德板€愰崑鎾愁浖閸涘瓨鈷戠紓浣姑慨澶愭煛娴ｅ憡鎲哥紒?,
    '婵犵數濮烽弫鍛婃叏閻戝鈧倿鎸婃竟鈺嬬秮瀹曘劑寮堕幋婵堚偓顓㈡⒑娴兼瑧鍒伴柡鍫墴閿濈偤寮撮姀锛勫幐闂佹悶鍎弲娑欑墡-,
    '闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲搁弮鍥棨婵＄偑鍊栭悧妤咁敋閸楃偐妲堟繛鍡樺姇閸斿懘姊洪棃娑辩劸闁稿孩濞婅棟鐟滃秹鍩為幋鐐茬疇闂佺锕ュú鐔肩嵁婵犲啯鍎熼柍鈺佸暞濞?,
    '闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲搁弮鍥棨闂備礁鎼ˇ浼存晬閺囩喆鍋婇悹鎭掑妿閺夌鈹戦悙鏉戠仸妞ゎ厼娲弫宥呪槈閵忊檧鎷洪梺闈╁瘜閸樺ジ銆傞崗鑲╃瘈闁靛繆鍩楅鍫濇瀬妞ゆ洍鍋撴慨濠勭帛閹峰懘鎼归悷鎵偧闂備礁鎲″褰掓晪闁捐崵鍋ら弻娑㈠即閵娿儳浠╃紓浣插亾?
  ],
  media: [
    'download',
    'library',
    'playlist',
    'folder',
    'import',
    'cleanup',
    '濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈閸ㄥ倿鏌涢锝嗙缂佺姳鍗抽弻鐔兼⒒鐎垫瓕绐楅梺杞扮鐎氫即寮诲☉銏╂晝闁挎繂娲╃粚?,
    '濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣銏犲閺佸﹪鏌″搴″箹闁搞劌鍊垮鍫曞醇濮橆厽鐝曢梺鍝勬缁矂鍩為幋锔藉亹闁圭粯甯╂导鈧紓鍌欒閸嬫挸鈹戦悩鍙夊闁稿﹦鏁婚弻銊モ攽閸℃侗鈧霉濠婂嫮绠為柡?,
    '婵犵數濮烽弫鍛婃叏閻㈠壊鏁婇柡宥庡幖缁愭淇婇妶鍛殲鐎规洘鐓￠弻娑樼暆閳ь剟宕戦悙鍝勫惞闁归偊鍘规禍婊堟煛瀹ュ啫濡介柣銊﹀灴閺?,
    '闂傚倸鍊搁崐宄懊归崶顒夋晪鐟滃秹婀侀梺缁樺灱濡嫰寮告笟鈧弻鐔兼⒒鐎靛壊妲梺绋胯閸斿酣骞夐幖浣告閻犳亽鍔嶅▓?,
    '婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧鏌ｉ幇顒佹儓缂佺姳鍗抽弻鐔兼⒒鐎靛壊妲紓浣哄Х婵炩偓闁哄瞼鍠栭幃褔宕奸悢鍝勫殥缂?,
    '闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲搁弮鍥棨婵＄偑鍊栭崝褏绮婚幋鐘差棜濠电姵纰嶉悡娆撴煕閹炬鎳庣粭锟犳⒑缂佹ɑ灏紒缁橈耿瀵鈽夐姀鈺傛櫇濡炪倖鍔戦崹褰掑煕婢跺瞼纾藉ù锝嗗絻娴滈箖鏌ｆ惔顖滅У闁哥姵顨婇幃锟犲即閵忋垹褰勯梺鎼炲劘閸斿秶浜搁銏＄厓鐟滄粓宕滃鎵佸亾缁楁稑瀚埞宥呪攽閻樺弶澶勯柛濠呭吹缁辨帒鈽夊鍡楀壉闂佸搫鎷戠徊浠嬪煘閹达附鍋愰悹鍥囧啩绱ｉ梻浣告憸閸ｃ儵宕戞繝鍥ㄥ仒妞ゆ梻鏅弧鈧梺鎼炲劘閸斿骞?,
    '闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲搁弮鍥棨婵＄偑鍊栭崝褏绮婚幋婢稑顫滈埀顒勫蓟濞戞鏆嗛柍褜鍓熷畷鎴濃槈濮橆剦妫滄繝鐢靛У绾板秹鎮￠弴銏＄厓闁宠桨绀侀弳鐔兼煃閽樺妯€鐎规洦鍓熼、娑㈡倷缁瀚奸梻浣告啞缁诲倻鈧凹鍠涢埅褰掓⒒娴ｄ警鐒鹃梺甯稻缁傚秶鎹勯搹瑙勬濠电娀娼ч鍡涘疾濠靛鐓曢悘鐐插⒔閵嗘帡鏌?,
    '闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲搁弮鍥棨濠电偞娼欓崥瀣焽濞嗘劦鏀板┑鐘垫暩婵挳鏁冮妶澶嬪亱闁糕剝鐟ラˉ姘舵煕瑜庨〃鍡涙偂濞嗘挻鈷掗柛灞惧嚬閸ょ喐銇勯敂鑲╃暤鐎规洖鐖奸獮姗€顢欑憴锝嗗闂傚倸鍊搁悧濠勭矙閹惧瓨娅犻柡鍥ュ灪閻撴洟鏌ｉ弴姘鳖槮濞存粍澹嗛埀顒冾潐濞叉鎹㈤崱娴板洩銇愰幒鎾跺幐闁诲繒鍋熼崑鎾剁矆鐎ｎ兘鍋撶憴鍕闁告鍥х厴闁硅揪绠戦柋鍥煏韫囧﹤澧叉い鏂挎濮?
  ],
  about: [
    'about',
    'version',
    'update',
    'release',
    'changelog',
    'developer',
    'devtools',
    '闂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛顐ｆ磵閳ь剨绠撳畷濂稿閳ュ啿绨ラ梻浣告贡婢ф顭垮鈧畷鎺楀Ω閳哄倻鍘搁悗骞垮劚妤犲憡绂嶉姘ｆ斀?,
    '闂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛鎾茬閸ㄦ繃銇勯弽顐杭闁逞屽墮閸熸潙鐣烽妸褉鍋撳☉娅亝绂嶆潏銊х瘈闁汇垽娼у瓭闂佺顑呴敃顏堝箠?,
    '闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈠煕濮橆厽銇濆┑陇鍩栧鍕偓锝庝簷濡叉劙姊绘笟鈧褑澧濋梺鍝勬噺閻╊垶骞?,
    '闂傚倸鍊峰ù鍥敋瑜忛埀顒佺▓閺呯娀銆佸▎鎾冲唨妞ゆ挾鍋熼悰銉╂⒑閸︻厼鍔嬫い銊ユ噽婢规洘绻濆顓犲幍闂佸憡鎸嗛崨顓狀偧-,
    '闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲搁弮鍥棨濠电偞娼欓崥瀣焽濞嗘垹鐭嗗鑸靛姈閻撴瑩寮堕崼婵嗏挃闁伙綀浜槐鎺楀焵椤掑嫬纾兼繛鎴烆殘缁犳岸姊洪棃娑氬闁瑰啿绻樺畷瀹犮亹閹烘垹鍊為梺鍦檸閸犳鍩涢幋鐘垫／妞ゆ挾鍋為崳鐟懊瑰鍐Ш闁哄本绋撻埀顒婄秵閸嬪棗煤鐎电硶鍋撶憴鍕缂佽鐗婃穱濠囨嚋闂堟稓绐為柣搴秵閸撴瑧鏁?,
    '闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲搁弮鍫濈畺鐟滃秹鈥﹂妸鈺佺闁告挆鍐ㄐㄩ梻鍌欒兌椤宕熼崹顐ゆ殽缂備胶鍋撳畷妯衡枖閺囥垹鐒垫い鎺嗗亾缂佺姴绉瑰畷鏇㈡焼瀹撱儱娲、娑橆潩椤撶喐顔囧┑鐘垫暩婵兘銆傞鐐潟闁哄洢鍨圭壕濠氭煟閺冨倸甯堕柛灞诲妿閹叉悂寮捄銊︽濠电姴锕ら悧鍡欑不椤曗偓閺屻倝骞侀幒鎴濆Б闂佸憡锕╂禍婵堟崲濠靛顫呴柨婵嗘閵嗘劙姊哄ú璇插箹闁绘鎸搁悾鐑藉即閵忊€充汗缂傚倷鐒﹂…鍥储?,
    '闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵＄偑鍊戦崹娲偋閻樿尙鏆﹂柟顖炲亰濡茬兘姊?
  ],
  danger: ['reset', 'danger', 'clear', '闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弴姘舵濞存粌缍婇弻娑㈠箛閸忓摜鏁栭梺娲诲幗閹瑰洭寮诲☉銏╂晝闁挎繂妫涢ˇ銊╂⒑?, '闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偛顦甸弫鎾绘偐椤旂懓浜鹃柛鎰ㄦ櫇缁♀偓闂佸憡鍔︽禍璺好洪幖浣圭厽闁绘宕电槐浼存煏閸″繐浜鹃梻?, '闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲搁弮鍥棨闂備礁鍚嬫禍浠嬪磿閹跺鈧懘宕ｆ径澶岀畾闂侀潧鐗嗛幊蹇涘闯閸︻厾妫柟顖嗗瞼鍚嬮梺鍝勮閸旀垵顕ｉ幘顔藉€锋繛鏉戭儏娴滃墽绱掔€ｎ偄顕滈柡鍡樼矒濮婂宕掑▎鎴М闂佺顕滅换婵嗙暦濠靛妲剧紓渚囧枛椤兘鐛€ｎ喗鏅濋柍褜鍓涚划?]
}

*/
const SETTINGS_SECTION_KEYWORDS = {
  language: ['language', 'locale', '\u8bed\u8a00', 'en', 'zh', 'ja', '\u8a00\u8a9e'],
  engine: [
    'visualizer',
    'spectrum',
    'waveform',
    'eq',
    'equalizer',
    'buffer',
    'crossfade',
    'sleep',
    'timer',
    'asio',
    'exclusive',
    'audio',
    '\u5747\u8861',
    '\u97f3\u9891',
    '\u6de1\u5165\u6de1\u51fa',
    '\u7761\u7720',
    '\u5b9a\u65f6',
    '\u30a4\u30b3\u30e9\u30a4\u30b6\u30fc',
    '\u30af\u30ed\u30b9\u30d5\u30a7\u30fc\u30c9'
  ],
  integrations: ['discord', 'rpc', 'presence', '\u96c6\u6210', '\u6574\u5408', '\u9023\u643a'],
  eq: [
    'eq',
    'equalizer',
    'parametric',
    'preamp',
    'band',
    '\u5747\u8861\u5668',
    '\u53c2\u91cf',
    '\u30a4\u30b3\u30e9\u30a4\u30b6\u30fc'
  ],
  aesthetics: [
    'theme',
    'color',
    'background',
    'blur',
    'font',
    'radius',
    'opacity',
    'gradient',
    '\u4e3b\u9898',
    '\u989c\u8272',
    '\u80cc\u666f',
    '\u5b57\u4f53',
    '\u6a21\u7cca',
    '\u30c6\u30fc\u30de',
    '\u30d5\u30a9\u30f3\u30c8'
  ],
  media: [
    'download',
    'library',
    'playlist',
    'folder',
    'import',
    'cleanup',
    '\u4e0b\u8f7d',
    '\u5a92\u4f53\u5e93',
    '\u6b4c\u5355',
    '\u5bfc\u5165',
    '\u6e05\u7406',
    '\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9',
    '\u30e9\u30a4\u30d6\u30e9\u30ea',
    '\u30d7\u30ec\u30a4\u30ea\u30b9\u30c8'
  ],
  about: [
    'about',
    'version',
    'update',
    'release',
    'changelog',
    'developer',
    'devtools',
    '\u5173\u4e8e',
    '\u7248\u672c',
    '\u66f4\u65b0',
    '\u5f00\u53d1',
    '\u30d0\u30fc\u30b8\u30e7\u30f3',
    '\u30a2\u30c3\u30d7\u30c7\u30fc\u30c8',
    '\u958b\u767a'
  ],
  danger: ['reset', 'danger', 'clear', '\u91cd\u7f6e', '\u5371\u9669', '\u30ea\u30bb\u30c3\u30c8'],
  lastfm: [
    'last.fm',
    'lastfm',
    'scrobble',
    'scrobbling',
    '\u6b4c\u66f2\u8bb0\u5f55',
    '\u542c\u6b4c\u5386\u53f2',
    '\u6b4c\u66f2\u5206\u4eab',
    '\u30b9\u30af\u30ed\u30d6\u30eb'
  ]
}

function formatSleepTimerRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function matchesSettingsSection(query, keywords) {
  const normalized = String(query || '')
    .trim()
    .toLowerCase()
  if (!normalized) return true
  return (keywords || []).some((keyword) => {
    const text = String(keyword || '').toLowerCase()
    return text.includes(normalized) || normalized.includes(text)
  })
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

function normalizeImportedFolderPath(folderPath) {
  return String(folderPath || '').replace(/[\\/]+$/, '').trim()
}

function buildImportedFolderTrackSeed(track) {
  if (!track?.path) return null
  return {
    name: track.name || fileNameFromPath(track.path),
    path: track.path,
    folder: getPathDirname(track.path),
    birthtimeMs: track.birthtimeMs || 0,
    mtimeMs: track.mtimeMs || 0,
    sizeBytes: track.sizeBytes || track.info?.sizeBytes || 0
  }
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
              noLink
            />
          </span>
          <span className="album-subtitle-sep">-</span>
          <span className="album-subtitle-count">{album.tracks.length} tracks</span>
        </div>
      </div>
    </button>
  )
})

/** Last.fm 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊椤掍礁鍓銈嗗姧缁犳垿鐛姀銈嗙厓閺夌偞澹嗛崝宥嗐亜閺傚灝顏紒杈ㄦ崌瀹曟帒顫濋钘変壕闁告縿鍎抽惌鎾绘倵闂堟稒鎲搁柣顓熸崌閺屾盯顢曢敐鍡欘槬缂備胶濮甸悧鏇㈡箒闂佺绻愰崥瀣礊閹达箑绠氶柣鏂垮悑閳锋垿姊婚崼鐔剁繁婵℃彃鐖奸弻娑欐償閵忕姭鏋欓柦妯荤箓闇夐柣鎾虫捣閹界娀鏌嶉柨瀣伌闁哄瞼鍠撶划娆撳箰鎼淬垹闂梻浣哥枃濡嫰藝閻㈢钃熼柨婵嗘啒閺冣偓閹峰懐绮欏▎鐐稈濠碉紕鍋戦崐鎴﹀垂濞差亝鍋￠柍杞扮贰閸ゆ洟鏌熺紒銏犳灍闁稿鍔欓弻锝夊閵忊晜娈扮紓浣稿船閻°劍绌辨繝鍥ㄥ€锋い蹇撳閸嬫捇寮介‖鈥虫惈椤撳吋寰勬繝鍕剁幢闂備胶鎳撴晶鐣屽垝椤栫偞鍋傞煫鍥ㄧ⊕閻撴洟鏌嶉埡浣告灓婵炲牄鍨烘穱濠囶敍濡も偓娴滈箖姊虹拠鍙夊攭妞ゎ偄顦叅婵せ鍋撻柡浣稿暣婵偓闁绘ê鐏氬▓楣冩⒑闂堟单鍫ュ疾閳哄懎鏋侀柛銉墯閻撶喐鎱ㄥΔ鈧Λ妤呭几濞戞◤褰掓偐濞嗗繑澶勯柍?*/
function LastFmLoginForm({ onLogin }) {
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('Please enter username and password')
      return
    }
    if (!window.api?.lastfm?.login) {
      setError('Last.fm login API is unavailable. Restart the app and try again.')
      return
    }
    setLoading(true)
    try {
      const timeoutResult = new Promise((resolve) => {
        window.setTimeout(() => {
          resolve({ ok: false, error: 'Connection timed out. Please try again later.' })
        }, 10000)
      })
      const result = await Promise.race([
        window.api.lastfm.login(username.trim(), password),
        timeoutResult
      ])
      if (result?.ok) {
        onLogin?.(result.sessionKey, result.username)
      } else {
        setError(result?.error || 'Login failed. Check username and password.')
      }
    } catch (err) {
      setError('Network error. Please try again later.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="lastfm-login-form" onSubmit={handleSubmit}>
      <div className="setting-row lastfm-login-heading">
        <div className="setting-info" style={{ maxWidth: 'none' }}>
          <h3>Connect Last.fm</h3>
          <p>Log in to record listening history with Scrobble.</p>
        </div>
      </div>
      <div className="lastfm-login-grid">
        <input
          className="settings-text-input"
          type="text"
          placeholder="Last.fm username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          disabled={loading}
        />
        <input
          className="settings-text-input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={loading}
        />
        <button className="lastfm-submit-btn" type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Log in'}
        </button>
      </div>
      {error ? <p className="lastfm-error">{error}</p> : null}
    </form>
  )
}
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
  const [upNextQueue, setUpNextQueue] = useState(() => {
    return pickInitialPersistedValue({
      snapshotValue: getInitialAppStateValue('upNextQueue'),
      localValue: readStoredJson('nc_up_next_queue'),
      normalize: (value) => normalizeUpNextQueue(value),
      fallback: []
    })
  })
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
  const [sleepTimerActive, setSleepTimerActive] = useState(false)
  const [sleepTimerEndMs, setSleepTimerEndMs] = useState(null)
  const [sleepTimerNowMs, setSleepTimerNowMs] = useState(Date.now())
  const [coverUrl, setCoverUrl] = useState(null)
  const [coverUrlTrackPath, setCoverUrlTrackPath] = useState('')
  const [failedDisplayCoverUrl, setFailedDisplayCoverUrl] = useState(null)
  const crossfadeStateRef = useRef({
    active: false,
    sourcePath: '',
    pendingFadeIn: false
  })

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
  const [speedPopoverOpen, setSpeedPopoverOpen] = useState(false)
  const [activeDeckPopover, setActiveDeckPopover] = useState(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [lyricsRenderTime, setLyricsRenderTime] = useState(0)
  const currentTrackPath = playlist[currentIndex]?.path || ''
  const [isSeeking, setIsSeeking] = useState(false)
  const isSeekingRef = useRef(false)
  useEffect(() => {
    isSeekingRef.current = isSeeking
  }, [isSeeking])

  useEffect(() => {
    if (!speedPopoverOpen) return
    const close = (e) => {
      if (!e.target.closest('.speed-popover')) setSpeedPopoverOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [speedPopoverOpen])

  useEffect(() => {
    if (!activeDeckPopover) return
    const close = (e) => {
      if (!e.target.closest('.deck-popover') && !e.target.closest('.deck-tool-trigger')) {
        setActiveDeckPopover(null)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [activeDeckPopover])

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
  const trackLoadSeqRef = useRef(0)
  const albumCoverProbePathsRef = useRef(new Set())
  const syncedDisplayCoverCacheKeyRef = useRef('')
  const cloudCoverFetchSeqRef = useRef(0)
  const coverFailureFetchKeyRef = useRef('')
  const albumCloudCoverAttemptedRef = useRef(new Set())
  const albumCloudCoverPendingRef = useRef(new Set())
  const trackSwitchCountRef = useRef(0)

  // MV State
  const [mvId, setMvId] = useState(null)
  const [isSearchingMV, setIsSearchingMV] = useState(false)
  const [youtubeMvLoginHint, setYoutubeMvLoginHint] = useState(false)
  const [signInStatus, setSignInStatus] = useState({
    youtube: false,
    bilibili: false
  })
  const [biliDirectStream, setBiliDirectStream] = useState(null)
  const mvSearchCacheRef = useRef(new Map())
  const mvSearchPendingRef = useRef(new Map())
  const autoMvSearchByTrackRef = useRef(new Map())
  const biliStreamCacheRef = useRef(new Map())
  const biliStreamPendingRef = useRef(new Map())
  const lastResolvedMvTrackPathRef = useRef('')
  const lastMvIdentityRef = useRef('')

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

  useEffect(() => {
    if (!currentTrackPath) return
    if (lastResolvedMvTrackPathRef.current === currentTrackPath) return
    lastResolvedMvTrackPathRef.current = currentTrackPath
    setYoutubeMvLoginHint(false)
    setMvId(null)
    setBiliDirectStream(null)
    setMvPlaybackQuality(null)
  }, [currentTrackPath])

  // Lyrics States
  const [showLyrics, setShowLyrics] = useState(false)
  const [lyrics, setLyrics] = useState([])
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1)
  const [lyricsDrawerOpen, setLyricsDrawerOpen] = useState(false)
  const [lyricsCandidateOpen, setLyricsCandidateOpen] = useState(false)
  const [lyricsCandidateLoading, setLyricsCandidateLoading] = useState(false)
  const [lyricsCandidateItems, setLyricsCandidateItems] = useState([])
  const [temporarilyHiddenLyricsTrackPath, setTemporarilyHiddenLyricsTrackPath] = useState('')
  const [lyricsQuickBarDismissed, setLyricsQuickBarDismissed] = useState(false)
  const [lyricsQuickBarActivityAt, setLyricsQuickBarActivityAt] = useState(() => Date.now())
  const isCurrentTrackLyricsTemporarilyHidden =
    !!currentTrackPath && temporarilyHiddenLyricsTrackPath === currentTrackPath
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
  /** 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈閸ㄥ倿鏌涢锝嗙缂佺姳鍗抽幃褰掑炊瑜嶅Λ姗€鏌ㄥ┑鍡╂Ц缂佺姵濞婇弻锟犲礃閿濆懍澹曢柣搴ゎ潐濞叉牕顕ｉ懜鐢碘攳濠电姴娴傞弫宥嗙節闂堟稒顥欐慨瑙勵殜濮婂搫煤鐠囨彃绠洪梺鑽ゅ暱閺呯娀鐛崘銊庢棃宕ㄩ鑺ョ彸闂佸湱鍘ч悺銊ф崲閸曨垰绀勭憸鐗堝笚閳锋垹绱掔€ｎ偒鍎ラ柣鎺楃畺閺屾稒绻濋崘顏勨拰闂侀潧妫楅崯瀛樹繆閻戣棄鐓涢柛灞惧焹閸嬫捇鎮滈懞銉у幍缂傚倷鐒﹂敋濞ｅ浂鍨堕弻锟犲幢閹邦剛浠奸梺瀹狀潐閸ㄥ潡骞冨▎鎾村殤妞ゆ巻鍋撴い銈傚亾闂傚倷鐒﹂幃鍫曞礉鐏炵瓔鐒介柨鐔哄У閸嬫ɑ銇勯弮鍥撻柛搴ｅ枛閺屾洘绻涢崹顔煎閻庤鎸稿Λ婵嗩潖閾忓湱纾兼俊顖滃劦閹疯绻涚€涙鐭嗙紒顔界懃閻ｇ兘骞嬮悙鐢电槇闂佹悶鍎崝澶愬箯閾忓湱纾介柛灞剧懅閸斿秹鏌ㄩ弴妤佹珚闁诡喚鍋為妶锝夊礃閳哄啫骞堥梻浣稿暱閹碱偊宕愮紒妯绘珷闁汇垹鎲￠悡鏇㈡煃鐟欏嫬鍔ゅù婊呭亾娣囧﹪鎮欓鍕ㄥ亾閺嶎厼鍨傞柣鎾崇岸閺嬫牠鏌￠崶鈺佇ュ瑙勫▕閻擃偊宕堕妸锔绢槶缂佺偓鍎抽妶绋款嚕閸洖閱囨繛鎴灻‖瀣⒑閻熸澘鏆辨繛灞傚姂閸┾偓?dlnaMeta闂傚倸鍊搁崐鎼佸磹妞嬪孩顐芥慨姗嗗墻閻掔晫鎲稿鍫罕闂備礁鎼崐褰掓晬閺嚶颁汗闁圭儤鍨归崐鐐烘⒑閸愬弶鎯堥柛濠傛啞閹梹绻濋崒妤佹杸闂佸疇妫勫Λ妤呮倶閿濆洨纾兼い鏇炴噹閻忥妇鈧娲樺ú鐔煎箖閵忋倕绀傞柤娴嬫櫅瀵娊姊绘担鍛婃儓闁哥噥鍋勭叅闁靛牆妫涢々鏌ユ煕閿旇骞樼痪鎯с偢閺屽秷顧侀柛鎾跺枎閻ｇ兘宕￠悙鈺傤潔濠电偛妫欓崹闈涱嚕閾忣偆绡€闁汇垽娼ф禒锕傛煕閵娿儳鍩ｉ柍銉畵瀹曞爼顢楁担绯曞亾閸洘鈷戞い鎺嗗亾缂佸鏁婚幃鈥斥槈濡繐缍婇弫鎰緞鐎ｎ偊鏁梻渚€鈧偛鑻晶顖炴煟濡や胶鐭岄柛鎺撳笧閳ь剨缍嗘禍鍫曞触鐎ｎ喗鐓曢柍鈺佸幘椤忓牆绀夐柛娑卞幐閺€浠嬫煟濡偐甯涙繛鎳峰嫪绻嗘い鎰剁悼閳藉宕￠柆宥嗙叆婵犻潧妫欓ˉ娆戠磼鐠囧弶顥㈤柡宀嬬秮楠炲洭宕楅崫銉ф晨闂備線鈧偛鑻晶顖滅磼鐠囨彃鈧潡鍨鹃敃鍌氱倞妞ゅ繐绉甸埢宀勬⒒娴ｇ瓔鍤冮柛銊ゅ嵆閹囧幢濞戣鲸鏅ｆ繝闈涘€婚…鍫ユ倷婵犲洦鐓冮柛婵嗗閺嗙喖鏌?DLNA 婵犵數濮烽弫鍛婃叏閻㈠壊鏁婇柡宥庡幖缁愭淇婇妶鍛殲鐎规洘鐓￠弻娑樼暆閳ь剟宕戝☉姘ｅ亾濮橆剦妲归柕鍥у楠炴帡宕卞鎯ь棜闂備胶绮幐鍫曞磹濠靛钃熸繛鎴炃氬Σ鍫熸叏濡も偓閻楀棙鎱ㄥ☉銏♀拺鐎规洖娲﹂崵鈧紓浣割槸缂嶅﹤顕ｇ拠宸悑濠㈣泛锕﹂崢鍛婄箾鏉堝墽鍒伴柟娴嬧偓鏂ユ灁闁靛ě鍛紳?*/
  const [lastCastStatus, setLastCastStatus] = useState(null)
  const [mvPlaybackQuality, setMvPlaybackQuality] = useState(null)
  const [lyricsMatchStatus, setLyricsMatchStatus] = useState('idle')
  const [lyricsSourceStatus, setLyricsSourceStatus] = useState({
    kind: 'idle',
    detail: '',
    origin: ''
  })
  /** 濠?lyrics 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弬鍨挃闁活厽鐟╅弻鐔封枎闄囬褍煤椤撱垹绠栭柣锝呯灱閻瑩鏌熺粙鎸庡攭缂佽翰鍨藉濠氬磼濞嗘垼绐楅梺鍛婃尰閻熝呭垝閺冨牊鍋ㄧ紒瀣硶閺屟冾渻閵堝棗绗傞柣鎺炵畵瀹曪綀绠涢弮鈧崣蹇斾繆閵堝倸浜惧┑鈽嗗亝椤ㄥ棛绮嬪鍜佺叆闁割偆鍠撻崢浠嬫⒑閹稿孩鈷掗柡鍜佸亰閹矂骞掑Δ浣哄幍濡炪倖姊圭€笛呮兜妤ｅ啯鐓冮柦妯侯樈濡叉悂鎽堕敐澶嬬厾婵炴潙顑嗗▍鍐磼鏉堫煈鐒界紒杈ㄦ崌瀹曟帒顫濋钘変壕闁告縿鍎抽惌鎾绘倵闂堟稒鍟炵€规洘鐓￠弻鐔告綇閸撗呮殸婵℃鎳庨埞鎴︽倷閸欏妫￠梺鐟扮毞閺呯姴顕ｉ锕€骞㈡繛鎴炵懅閸橀亶姊洪崫鍕偍闁告柨鐭傞悰顕€寮介鐔蜂壕闁汇垽娼ч。濂告煙閻熺増鎼愭い顐㈢箰鐓ゆい蹇撳椤斿洭鏌熼懝鐗堝涧缂佹彃鎼嵄闁割偅绺鹃弨浠嬫煟濮楀棗浜滃ù婊勫劤椤啴濡堕崘銊т紕濡?闂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛顐ｆ礀閸屻劎鎲搁弮鍫澪ラ柛鎰ㄦ櫆閸庣喖鏌曡箛瀣労婵炶尙顭堥埞鎴︽偐鐠囇冧紣闂佺粯顨呴敃顏勭暦閹达箑惟闁挎棁妗ㄧ花濠氭⒑鐟欏嫭绶插褍閰ｉ幃鐐綇閳哄啰锛?Kuroshiro 闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇炲€归崕鎴犳喐閻楀牆绗掗柛銊ュ€搁埞鎴︽偐鐎圭姴顥濈紓浣瑰姈椤ㄥ﹪寮婚悢鍏煎亱闁割偆鍠撻崙锟犳⒑閹肩偛濡奸柛濠傜秺楠炲牓濡搁妷搴ｅ枛瀹曞綊顢欓幆褍缂氶梻?*/
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
  const [navPlaylistsExpanded, setNavPlaylistsExpanded] = useState(false)
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
  const upNextQueueStoreHydratedRef = useRef(false)
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
  /** { originalIdx, path, top, left, width } | null -婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧鏌ｉ幇顒佹儓缂佺姵姘ㄩ埀顒€鍘滈崑鎾绘煕閺囥劌浜為柣娑栧劦濮婃椽宕崟顓涙瀱闂佸憡眉缁瑥鐣烽弴銏犵婵犮垺绻傜紞濠囧箖閳╁啯鍎熼柨婵嗘閸犳牠姊?fixed + portal闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔告綇妤ｅ啯顎嶉梺绋垮椤ㄥ﹪寮诲☉姘勃闁告挆鈧Σ鍫濐渻閵堝棙绀嬪ù婊冪埣瀵顓兼径濠佺炊闂佸憡娲﹂崜娆忊枍閿濆洨纾藉ù锝嗗絻娴滈箖姊虹粙鎸庢拱濠㈣娲熷畷鎴﹀箻閼姐倕绁﹂梺鍓茬厛閸犳牗鎱ㄦ惔銊︹拺缂備焦锕╁▓鏇犵磼椤旇偐鐒搁柍銉畵瀹曞爼鍩￠崒姘憋紡闂備浇顕栭崢钘夘啅婵犳艾纾婚柟鎹愵嚙缁犳娊鏌熼幖顓炲箺闁稿秶鏁诲娲焻閻愯尪瀚板褍顕埀顒冾潐濞叉牕鐣烽鍕厺閹兼番鍔岀粻锝嗙節闂堟侗鍎戠€规洘娲熷濠氬磼濮橆兘鍋撴搴ｇ焼濞撴埃鍋撴鐐寸墵椤㈡洟濡堕崶鈺冨帬闂佽閰ｅ褔骞夐垾宕囨殾闁告瑥顦换鍡涙煏閸繃鍣洪柛搴㈡緲椤潡鎳滈棃娑橆潓濡ょ姷鍋戦崹铏规崲濞戙垹绠ｉ柣鎴濇閸斿嘲顪?*/
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
  /** 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犳澘鈹戦悩宕囶暡闁稿骸绉电换婵囩節閸屾粌顣虹紓浣插亾閻庯綆鍋佹禍婊堟煙閹规劖纭惧ù鐘欏洦鐓曢柡鍌濇硶缁夌儤鎱ㄦ繝鍕笡闁瑰嘲鎳樺畷銊︾節閸愩劌澹嶅┑鐘垫暩閸嬬偟绮婇幘顔肩柧婵犻潧娲ㄩ々鑼磼鐎ｎ亞姘ㄩ柡瀣捣閳ь剛鏁告晶妤冩崲閸曨垰纾块柕鍫濇礌閸嬫捇妫冨☉鏍т划閻庢鍠栭悥濂哥嵁鐎ｎ喗鍋愰梻鍫熺☉缁犳垿姊婚崒姘偓宄懊归崶顒婄稏濠㈣埖鍔曠壕鍧楁煕韫囨挸鎮戦柛娆忕箻閺屾洟宕煎┑鎰﹀┑顔炬嚀瀵墎鎹㈠☉銏犵婵炲棗绻掓禒楣冩⒑缂佹ɑ灏靛┑鐐╁亾闂佸搫鐬奸崰鎾跺垝濞嗘挸绠伴幖娣灩闂傤垶姊绘担瑙勩仧闁告ê銈搁弫鍐晝閸屾氨鍔?{ clientX, clientY, track } */
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
  const trackStartedAtRef = useRef(null)
  const scrobbledRef = useRef(false)
  const lastLastFmTrackPathRef = useRef('')
  const historyNavigationRef = useRef(false)
  const lastHistoryTrackedPathRef = useRef('')
  const lastStatsTrackedPathRef = useRef('')
  const startupExclusiveResetRef = useRef(false)
  const releaseNotesFetchedRef = useRef(false)
  const libraryMetaCacheHydrationKeyRef = useRef('')
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [quickNewPlaylistName, setQuickNewPlaylistName] = useState('')
  const [selectedAlbum, setSelectedAlbum] = useState('all')
  const [selectedFolder, setSelectedFolder] = useState('all')
  const [selectedArtist, setSelectedArtist] = useState('all')
  const [songSortMode, setSongSortMode] = useState('default') // 'default' | 'dateAsc' | 'dateDesc'
  const [songSortOpen, setSongSortOpen] = useState(false)
  const songSortRef = useRef(null)
  const [albumSortMode, setAlbumSortMode] = useState('default')
  const [albumSortOpen, setAlbumSortOpen] = useState(false)
  const albumSortRef = useRef(null)
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
  const startupImportedFolderRescanDoneRef = useRef(false)
  const [libraryStateReady, setLibraryStateReady] = useState(false)
  const [playbackSessionRestoreReady, setPlaybackSessionRestoreReady] = useState(false)
  const [libraryCleanupBusy, setLibraryCleanupBusy] = useState(false)
  const [missingLibraryPaths, setMissingLibraryPaths] = useState([])
  const [trackMetaMap, setTrackMetaMap] = useState({})
  const [albumCoverMap, setAlbumCoverMap] = useState({})
  const trackMetaMapRef = useRef(trackMetaMap)
  const [technicalInfo, setTechnicalInfo] = useState({
    sampleRate: null,
    originalBpm: null,
    channels: null,
    bitrate: null,
    bitDepth: null,
    isMqa: false,
    codec: null
  })
  const [bpmDetectionState, setBpmDetectionState] = useState('idle')
  const [isConverting, setIsConverting] = useState(false)
  const [conversionMsg, setConversionMsg] = useState('')
  const [audioDevices, setAudioDevices] = useState([])
  const [queueDragOver, setQueueDragOver] = useState(false)

  // Hi-Fi & Navigation States
  const [view, setView] = useState('player') // 'player', 'lyrics', 'settings'
  const [settingsQuery, setSettingsQuery] = useState('')
  const [activeSettingsSection, setActiveSettingsSection] = useState('language')
  const [config, setConfig] = useState(() => {
    const saved = getInitialAppStateValue('config')
    if (saved && typeof saved === 'object') return normalizeConfigState(saved)
    return normalizeConfigState(readStoredJson('nc_config'))
  })
  const settingsSearchInputRef = useRef(null)
  const settingsContentRef = useRef(null)

  const configRef = useRef(config)
  useEffect(() => {
    configRef.current = config
  }, [config])

  const settingsSectionVisibility = useMemo(() => {
    return {
      language: matchesSettingsSection(settingsQuery, SETTINGS_SECTION_KEYWORDS.language),
      engine: matchesSettingsSection(settingsQuery, SETTINGS_SECTION_KEYWORDS.engine),
      integrations: matchesSettingsSection(settingsQuery, SETTINGS_SECTION_KEYWORDS.integrations),
      eq: matchesSettingsSection(settingsQuery, SETTINGS_SECTION_KEYWORDS.eq),
      aesthetics: matchesSettingsSection(settingsQuery, SETTINGS_SECTION_KEYWORDS.aesthetics),
      media: matchesSettingsSection(settingsQuery, SETTINGS_SECTION_KEYWORDS.media),
      about: matchesSettingsSection(settingsQuery, SETTINGS_SECTION_KEYWORDS.about),
      danger: matchesSettingsSection(settingsQuery, SETTINGS_SECTION_KEYWORDS.danger),
      lastfm: matchesSettingsSection(settingsQuery, SETTINGS_SECTION_KEYWORDS.lastfm)
    }
  }, [settingsQuery])
  const settingsHasResults = Object.values(settingsSectionVisibility).some(Boolean)
  const settingsNavItems = useMemo(
    () => [
      {
        key: 'language',
        icon: Globe,
        label: t('settings.nav.language'),
        id: 'settings-sec-language'
      },
      { key: 'engine', icon: Zap, label: t('settings.nav.engine'), id: 'settings-sec-engine' },
      {
        key: 'integrations',
        icon: Link,
        label: t('settings.nav.integrations'),
        id: 'settings-sec-integrations'
      },
      {
        key: 'lastfm',
        icon: Radio,
        label: 'Last.fm',
        id: 'settings-sec-lastfm'
      },
      { key: 'eq', icon: Sliders, label: t('settings.nav.eq'), id: 'settings-sec-eq' },
      {
        key: 'aesthetics',
        icon: Palette,
        label: t('settings.nav.aesthetics'),
        id: 'settings-sec-aesthetics'
      },
      {
        key: 'downloader',
        icon: Download,
        label: t('settings.nav.downloader'),
        id: 'settings-sec-downloader'
      },
      { key: 'about', icon: Info, label: t('settings.nav.about'), id: 'settings-sec-about' },
      { key: 'danger', icon: Trash2, label: t('settings.nav.danger'), id: 'settings-sec-danger' }
    ],
    [t]
  )

  const handleSettingsNavClick = useCallback((sectionKey, sectionId) => {
    setActiveSettingsSection(sectionKey)
    setSettingsQuery('')
    const scrollToSection = () => {
      document
        .getElementById(sectionId)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    if (settingsQuery.trim()) {
      setTimeout(scrollToSection, 0)
      return
    }
    scrollToSection()
  }, [settingsQuery])

  useEffect(() => {
    if (view !== 'settings') return
    setSettingsQuery('')
    setActiveSettingsSection('language')
    const focusTimer = setTimeout(() => {
      settingsSearchInputRef.current?.focus()
    }, 0)
    return () => clearTimeout(focusTimer)
  }, [view])

  useEffect(() => {
    if (view !== 'settings' || settingsQuery.trim()) return
    const root = settingsContentRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const sectionElements = settingsNavItems
      .map((item) => document.getElementById(item.id))
      .filter(Boolean)
    if (sectionElements.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visibleEntries.length === 0) return
        const sectionKey = visibleEntries[0].target.getAttribute('data-settings-section')
        if (sectionKey) setActiveSettingsSection(sectionKey)
      },
      {
        root,
        threshold: 0.3
      }
    )
    sectionElements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [settingsNavItems, settingsQuery, view])

  useEffect(() => {
    if (config.sleepTimerEnabled !== true) return
    setConfig((prev) => ({ ...prev, sleepTimerEnabled: false }))
  }, [])

  const stopPlaybackForSleepTimer = useCallback(() => {
    setIsPlaying(false)
    if (window.api?.pauseAudio) {
      void window.api.pauseAudio().catch(() => {})
    }
  }, [])

  const cancelSleepTimer = useCallback(() => {
    setSleepTimerActive(false)
    setSleepTimerEndMs(null)
    setConfig((prev) =>
      prev.sleepTimerEnabled === false ? prev : { ...prev, sleepTimerEnabled: false }
    )
  }, [])

  const startSleepTimer = useCallback(() => {
    setSleepTimerActive(true)
    setConfig((prev) =>
      prev.sleepTimerEnabled === true ? prev : { ...prev, sleepTimerEnabled: true }
    )
    if (config.sleepTimerMode === 'time') {
      setSleepTimerEndMs(Date.now() + Number(config.sleepTimerMinutes || 30) * 60 * 1000)
    } else {
      setSleepTimerEndMs(null)
    }
  }, [config.sleepTimerMinutes, config.sleepTimerMode])

  const sleepTimerRemainingMs =
    sleepTimerActive && config.sleepTimerMode === 'time' && sleepTimerEndMs
      ? Math.max(0, sleepTimerEndMs - sleepTimerNowMs)
      : 0

  const resetCrossfadeState = useCallback(() => {
    crossfadeStateRef.current = {
      active: false,
      sourcePath: '',
      pendingFadeIn: false
    }
  }, [])

  const cancelCrossfade = useCallback(() => {
    resetCrossfadeState()
    if (window.api?.audioCancelFade) {
      void window.api.audioCancelFade().catch(() => {})
    }
  }, [resetCrossfadeState])

  useEffect(() => {
    if (!sleepTimerActive || config.sleepTimerMode !== 'time' || !sleepTimerEndMs) return undefined

    setSleepTimerNowMs(Date.now())
    const timer = setInterval(() => {
      const now = Date.now()
      setSleepTimerNowMs(now)
      if (now >= sleepTimerEndMs) {
        stopPlaybackForSleepTimer()
        cancelSleepTimer()
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [
    cancelSleepTimer,
    config.sleepTimerMode,
    sleepTimerActive,
    sleepTimerEndMs,
    stopPlaybackForSleepTimer
  ])

  useEffect(() => {
    if (!sleepTimerActive) return
    if (config.sleepTimerMode === 'time') {
      setSleepTimerEndMs(Date.now() + Number(config.sleepTimerMinutes || 30) * 60 * 1000)
      return
    }
    setSleepTimerEndMs(null)
  }, [config.sleepTimerMinutes, config.sleepTimerMode, sleepTimerActive])

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
    if (!libraryStateReady || !window.api?.setAutoUpdateEnabled) return
    void window.api.setAutoUpdateEnabled(config.autoUpdateEnabled !== false).catch(() => {})
  }, [libraryStateReady, config.autoUpdateEnabled])

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

  const persistStateImmediately = useCallback((persistKey, localKey, value, writeToAppState = true) => {
    const queue = persistQueueRef.current
    const pending = queue.get(persistKey)
    if (pending?.timer) clearTimeout(pending.timer)
    queue.delete(persistKey)

    if (localKey) {
      try {
        localStorage.setItem(localKey, JSON.stringify(value))
      } catch {
        /* ignore storage quota / serialization failures */
      }
    }

    if (writeToAppState && window.api?.appStateSet) {
      void window.api.appStateSet(persistKey, value)
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
    schedulePersistedState(
      'upNextQueue',
      'nc_up_next_queue',
      upNextQueue.map((item) => ({ path: item.path })),
      upNextQueueStoreHydratedRef.current
    )
  }, [upNextQueue, schedulePersistedState])

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
    if (!libraryStateReady || playlist.length === 0) return undefined
    const paths = [...new Set(playlist.map((track) => track?.path).filter(Boolean))]
    if (paths.length === 0) return undefined

    const hydrationKey = paths.join('\n')
    if (libraryMetaCacheHydrationKeyRef.current === hydrationKey) return undefined
    libraryMetaCacheHydrationKeyRef.current = hydrationKey

    let cancelled = false

    const mergeCachedEntries = (cachedEntries) => {
      const entries = Object.entries(cachedEntries || {})
      if (entries.length === 0) return

      setTrackMetaMap((prev) => {
        let changed = false
        const next = { ...prev }

        for (const [path, cachedEntry] of entries) {
          if (!cachedEntry) continue
          const current = next[path] || {}
          const merged = { ...cachedEntry, ...current }
          if (current.cover == null && cachedEntry.cover) {
            merged.cover = cachedEntry.cover
            merged.coverChecked = true
            delete merged.coverMemoryTrimmed
          }
          if (current.title == null && cachedEntry.title) merged.title = cachedEntry.title
          if (current.artist == null && cachedEntry.artist) merged.artist = cachedEntry.artist
          if (current.album == null && cachedEntry.album) merged.album = cachedEntry.album
          if (current.albumArtist == null && cachedEntry.albumArtist) {
            merged.albumArtist = cachedEntry.albumArtist
          }
          if (JSON.stringify(current) !== JSON.stringify(merged)) {
            next[path] = merged
            changed = true
          }
        }

        return changed ? trimTrackMetaCoverEntries(next, new Set(paths)) : prev
      })
    }

    const hydrateLibraryMetaCache = async () => {
      for (let index = 0; index < paths.length && !cancelled; index += LIBRARY_META_CACHE_HYDRATE_BATCH_SIZE) {
        const chunk = paths.slice(index, index + LIBRARY_META_CACHE_HYDRATE_BATCH_SIZE)
        const cached = await readTrackMetaCache(chunk)
        if (cancelled) return
        mergeCachedEntries(cached)
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
    }

    hydrateLibraryMetaCache()

    return () => {
      cancelled = true
    }
  }, [libraryStateReady, playlist])

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
    upNextQueueStoreHydratedRef.current = true
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
    if (config.audioExclusiveResetOnStartup === false) return
    setIsAudioExclusive(false)
    if (window.api?.setAudioExclusive) {
      void window.api.setAudioExclusive(false)
    }
    setConfig((prev) => (prev.audioExclusive === false ? prev : { ...prev, audioExclusive: false }))
  }, [libraryStateReady, config.audioExclusiveResetOnStartup])

  useEffect(() => {
    if (!libraryStateReady) return
    if (config.lastfmEnabled && config.lastfmSessionKey && window.api?.lastfm) {
      void window.api.lastfm.setSession(config.lastfmSessionKey, config.lastfmUsername || '')
    }
  }, [
    libraryStateReady,
    config.lastfmEnabled,
    config.lastfmSessionKey,
    config.lastfmUsername
  ])

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

  // 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偛顦甸弫鎾绘偐閸愬弶鐤勫┑掳鍊х徊浠嬪疮椤愩倐鍋撳顒夋Ч闁靛洤瀚伴獮鎺楀箣濠垫劒绱濋梻?gapless 闂傚倸鍊搁崐宄懊归崶褏鏆﹂柛顭戝亝閸欏繒鈧娲栧ú銊╂儗閸℃褰掓晲閸偅缍堝┑鐐叉噽婵挳婀侀梺缁樏Ο濠囧磿閹扮増鐓曢悗锝呭悁闁垶鏌＄仦鍓ф创闁糕晛瀚板畷姗€顢旀担璇℃綌缂傚倸鍊风拋鏌ュ磻閹剧粯鐓曢柍鈺佸暔娴滄绻涢幋鐐垫嚂缂佹唻绲介湁闁挎繂瀚鐔镐繆瀹割喖娅嶆慨濠勫劋鐎电厧鈻庨幘鎼偓宥囩磽娓氬洤鏋熼柟鍛婃倐椤㈡岸鏁愭径濠囧敹闂佸搫娲ㄩ崑鐔煎储閹间焦鈷戠紒瀣濠€浼存煕閵堝懘鍙勯柛鈹惧亾濡炪倖甯婄粈浣该归鈧弻锛勪沪閻ｅ睗褔鏌熺粵鍦瘈濠碘€崇埣瀹曘劑顢樺┑鍫濈婵犵绱曢崑鎴﹀磹閺嶎灐娲煛閸愵亞顦繛杈剧到婢瑰﹪宕甸弴銏＄厵缂備降鍨归弸鐔兼煕鐎ｎ亜顏柡灞剧☉閳藉顫滈崼婵呯矗-
  useEffect(() => {
    if (!window.api?.setAudioGapless) return
    void window.api.setAudioGapless(!!config.gaplessEnabled)
    // gapless 濠?crossfade 濠电姷鏁告慨鐑藉极閹间礁纾绘繛鎴欏灪閸嬨倝鏌曟繛褍鍟悘濠囨倵楠炲灝鍔氭繛璇х畵瀵啿顭ㄩ崟顏嗙畾闂侀潧鐗嗛幊蹇涘闯瑜版帗鐓曢柟瀵稿Т瀛濋梺瀹狀潐閸ㄥ灝鐣烽幒鎴僵妞ゆ挾鍋炲▓姗€姊绘担鍛婃儓闁瑰嘲顑夊畷婊冾潩鐠鸿櫣鐤勯梺闈涱焾閸庡搫顭囬妸鈺傜厱闁斥晛鍠氬▓鏃€銇勯顐簽缂?gapless 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈡晝閳ь剟鎮块濮愪簻闁哄稁鍋勬禒婊呯棯閹呬虎闁宠鍨垮畷鎺戭煥鎼达絽濮奸梻浣告啞娣囨椽锝炴径灞惧床婵犻潧娲ㄧ弧鈧梺绋挎湰缁矂銆傞搹鍦＝濞达絾褰冩禍鐐節閵忥絽鐓愰柛鏃€鐗犻幃陇绠涢幘顖涙杸闂佺粯鍔樼亸娆愮閵忋倖鐓曢柡鍐ｅ亾婵ǜ鍔戦獮?crossfade
    if (config.gaplessEnabled && config.crossfadeEnabled) {
      setConfig((prev) => ({ ...prev, crossfadeEnabled: false }))
    }
  }, [config.gaplessEnabled, config.crossfadeEnabled])

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
    if (!config.lastfmEnabled || !config.lastfmSessionKey || scrobbledRef.current) return
    const track = playlist[currentIndex]
    if (!track || !window.api?.lastfm?.scrobble) return
    const info = track.info || {}
    const dur = Number(info.duration) || 0
    if (currentTime >= 30 && (dur <= 0 || currentTime >= dur * 0.5)) {
      scrobbledRef.current = true
      void window.api.lastfm.scrobble(
        info.artist || '',
        info.title || '',
        info.album || '',
        trackStartedAtRef.current || Date.now(),
        dur
      )
    }
  }, [
    currentTime,
    currentIndex,
    config.lastfmEnabled,
    config.lastfmSessionKey,
    playlist
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
    if (!libraryStateReady) return undefined
    if (!window.api?.watchLibraryFolders || !window.api?.stopWatchingLibraryFolders)
      return undefined
    if (!importedFolders.length) {
      void window.api.stopWatchingLibraryFolders().catch(() => {})
      return undefined
    }

    let disposed = false
    const existingTracks = playlistRef.current
      .filter((track) => isTrackInsideImportedFolders(track?.path, importedFolders))
      .map(buildImportedFolderTrackSeed)
      .filter(Boolean)

    window.api.watchLibraryFolders({ folders: importedFolders, existingTracks }).catch((error) => {
      if (!disposed) {
        console.error('Library watch start failed:', error)
      }
    })

    return () => {
      disposed = true
      void window.api.stopWatchingLibraryFolders().catch(() => {})
    }
  }, [libraryStateReady, importedFolders])

  // Auto-rescan imported folders on startup to discover new files
  useEffect(() => {
    if (!libraryStateReady || !importedFolders.length || !window.api?.rescanFolders) return
    if (startupImportedFolderRescanDoneRef.current) return
    startupImportedFolderRescanDoneRef.current = true
    let cancelled = false
    const foldersForStartupRescan = importedFolders.slice()
    const doRescan = async () => {
      try {
        let scannedTracks = []
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const rescanResult = await window.api.rescanFolders({
            folders: foldersForStartupRescan
          })
          if (cancelled || !Array.isArray(rescanResult)) return
          scannedTracks = rescanResult
          const hasImportedTracks = playlistRef.current.some((track) =>
            isTrackInsideImportedFolders(track?.path, foldersForStartupRescan)
          )
          if (scannedTracks.length || hasImportedTracks || attempt === 2) break
          await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
        }

        const previousImportedTracks = playlistRef.current.filter((track) =>
          isTrackInsideImportedFolders(track?.path, foldersForStartupRescan)
        )
        const delta = diffImportedFolderSnapshot(
          previousImportedTracks,
          scannedTracks.map(normalizeWatchedTrack).filter(Boolean)
        )

        const safeStartupDelta = {
          renamed: [],
          removedPaths: [],
          added: delta.added
        }

        if (safeStartupDelta.added.length) {
          applyLibraryFolderDelta(safeStartupDelta)
          if (window.api?.watchLibraryFolders) {
            const seededTracks = playlistRef.current
              .filter((track) => isTrackInsideImportedFolders(track?.path, foldersForStartupRescan))
              .map(buildImportedFolderTrackSeed)
              .filter(Boolean)
            void window.api.watchLibraryFolders({
              folders: foldersForStartupRescan,
              existingTracks: seededTracks
            })
          }
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

  // Update volume -HTML audio / gain node (no IPC)
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
      // Browser cannot decode DSD; audio.duration is bogus -duration comes from main (ffprobe).
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
      const isNewLastFmTrack = lastLastFmTrackPathRef.current !== track.path
      if (isNewLastFmTrack) {
        lastLastFmTrackPathRef.current = track.path
        trackStartedAtRef.current = Date.now()
        scrobbledRef.current = false
      }
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

      if (
        isNewLastFmTrack &&
        config.lastfmEnabled &&
        config.lastfmSessionKey &&
        window.api?.lastfm
      ) {
        const info = track.info || {}
        void window.api.lastfm.nowPlaying(
          info.artist || '',
          info.title || '',
          info.album || '',
          Number(info.duration) || 0
        )
      }
    } else {
      lastLastFmTrackPathRef.current = ''
    }
  }, [currentIndex, isPlaying, playlist, config.lastfmEnabled, config.lastfmSessionKey])

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
  const albumGridRef = useRef(null)
  const albumOverviewScrollTopRef = useRef(0)
  const pendingAlbumOverviewRestoreRef = useRef(false)
  const pendingAlbumDetailScrollResetRef = useRef(false)
  const previousSongSortModeRef = useRef(songSortMode)
  const previousAlbumSortModeRef = useRef(albumSortMode)
  const previousFolderSortModeRef = useRef(folderSortMode)
  const previousTrackPathRef = useRef('')

  useEffect(() => {
    lyricsRef.current = lyrics
  }, [lyrics])

  useEffect(() => {
    setTemporarilyHiddenLyricsTrackPath('')
    setLyricsQuickBarDismissed(false)
    setLyricsQuickBarActivityAt(Date.now())
  }, [currentTrackPath])

  useEffect(() => {
    if (!showLyrics || view !== 'player') return
    if (!currentTrackPath) return
    if (isCurrentTrackLyricsTemporarilyHidden || lyricsQuickBarDismissed) return
    const remainingMs = Math.max(0, 5000 - (Date.now() - lyricsQuickBarActivityAt))
    const timer = window.setTimeout(() => {
      setLyricsQuickBarDismissed(true)
    }, remainingMs)
    return () => clearTimeout(timer)
  }, [currentTrackPath, isCurrentTrackLyricsTemporarilyHidden, lyricsQuickBarActivityAt, lyricsQuickBarDismissed, showLyrics, view])

  useEffect(() => {
    if (showLyrics && !config.lyricsHidden && activeLyricIndex !== -1 && scrollAreaRef.current) {
      const scrollArea = scrollAreaRef.current
      const activeElement = scrollAreaRef.current.querySelector('.lyric-line.active')
      if (activeElement) {
        const areaRect = scrollArea.getBoundingClientRect()
        const activeRect = activeElement.getBoundingClientRect()
        const targetTop =
          scrollArea.scrollTop +
          (activeRect.top - areaRect.top) -
          scrollArea.clientHeight / 2 +
          activeRect.height / 2
        scrollArea.scrollTo({
          top: Math.max(0, targetTop),
          behavior: 'smooth'
        })
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
    let s = String(rawTitle)
    s = s.replace(/\[[^\]]*\]/g, ' ')
    s = s.replace(/\([^)]*\)/g, ' ')
    s = s.replace(/\b(cover|remix|live|ver\.?|version|feat\.?|ft\.?)\b/gi, '')
    s = s.replace(/[~`"'.,!?;:|/\\]+/g, ' ')
    s = s.replace(/\s+/g, ' ').trim()
    return s
  }

  const extractBookTitleQuotes = (rawTitle = '') => {
    const out = []
    const re = /[<\[]([^>\]]+)[>\]]/g
    let m
    while ((m = re.exec(rawTitle)) !== null) {
      const inner = (m[1] || '').trim()
      if (inner && inner.length <= 120) out.push(inner)
    }
    return out
  }

  const extractCornerQuotes = (rawTitle = '') => {
    const out = []
    const re = /["']([^"']+)["']/g
    let m
    while ((m = re.exec(rawTitle)) !== null) {
      const inner = (m[1] || '').trim()
      if (inner && inner.length <= 120) out.push(inner)
    }
    return out
  }

  const cleanArtistForLyrics = (raw = '') => {
    let s = (raw || '').trim()
    if (!s) return ''
    s = s.replace(/\s*\/\s*cover\s*/gi, ' ')
    s = s.replace(/\/\s*cover/gi, '')
    s = s.replace(/cover\s*\//gi, '')
    s = s.replace(/cover/gi, '')
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

    const VERSION_MARKER_RE = /\b(remix|rmx|live|acoustic|instrumental|inst|cover|edit)\b/i
    if (VERSION_MARKER_RE.test(rt)) {
      let withVersion = rt
      withVersion = withVersion.replace(/\[[^\]]*\]/g, ' ')
      withVersion = withVersion.replace(/[~`"'.,!?;:|/\\]+/g, ' ')
      withVersion = withVersion.replace(/\bfeat\.?\b|\bft\.?\b/gi, '')
      withVersion = withVersion.replace(/\s+/g, ' ').trim().toLowerCase()
      if (withVersion && !seen.has(withVersion)) {
        seen.add(withVersion)
        list.push(withVersion)
      }
    }

    return list
  }

  const extractParenArtistHints = (rawTitle = '') => {
    if (!rawTitle) return []
    const seen = new Set()
    const out = []
    const re = /\(([^)]+)\)/g
    let m
    while ((m = re.exec(rawTitle)) !== null) {
      const inner = (m[1] || '').trim()
      if (!inner || inner.length > 80) continue
      if (/TV|size|instrumental|inst\.?|karaoke|off\s*vocal|ver\.|cover|MV|mv/i.test(inner)) {
        continue
      }
      const key = inner.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(inner)
    }
    return out
  }
  const readRuntimeCache = useCallback((ref, key, ttlMs) => {
    const hit = ref.current.get(key)
    if (!hit) return null
    if (Date.now() - hit.at > ttlMs) {
      ref.current.delete(key)
      return null
    }
    ref.current.delete(key)
    ref.current.set(key, hit)
    return hit.value
  }, [])

  const writeRuntimeCache = useCallback((ref, key, value, maxEntries = 32) => {
    ref.current.set(key, { value, at: Date.now() })
    trimMapCache(ref, maxEntries)
    return value
  }, [])

  const trimRuntimeCaches = useCallback(() => {
    trimMapCache(mvSearchCacheRef, MAX_MV_SEARCH_CACHE_ENTRIES)
    trimMapCache(biliStreamCacheRef, MAX_BILI_STREAM_CACHE_ENTRIES)
    trimMapCache(lrcLibCache, MAX_LRCLIB_CACHE_ENTRIES)
  }, [])

  const disposeTrackRuntimeState = useCallback(
    (previousTrackPath = '') => {
      cloudCoverFetchSeqRef.current += 1
      setShareCardSnapshot(null)
      setDynamicCoverTheme(null)
      setLyricsCandidateItems([])
      setLyricsCandidateLoading(false)
      setBiliDirectStream(null)
      trimRuntimeCaches()
      if (configRef.current?.devModeEnabled && previousTrackPath) {
        const coverEntries = Object.values(trackMetaMapRef.current || {}).filter((entry) => !!entry?.cover)
          .length
        console.info('[memory]', {
          trackSwitches: trackSwitchCountRef.current,
          previousTrackPath,
          mvSearchCache: mvSearchCacheRef.current.size,
          biliStreamCache: biliStreamCacheRef.current.size,
          lrcLibCache: lrcLibCache.current.size,
          trackMetaCoverEntries: coverEntries
        })
      }
    },
    [currentTrackPath, trimRuntimeCaches]
  )

  useEffect(() => {
    const previousTrackPath = previousTrackPathRef.current
    if (previousTrackPath && previousTrackPath !== currentTrackPath) {
      trackSwitchCountRef.current += 1
      disposeTrackRuntimeState(previousTrackPath)
    }
    previousTrackPathRef.current = currentTrackPath
  }, [currentTrackPath, disposeTrackRuntimeState])

  useEffect(() => {
    if (!config.devModeEnabled) return undefined
    const dumpMemoryStats = () => {
      const stats = {
        trackSwitches: trackSwitchCountRef.current,
        mvSearchCache: mvSearchCacheRef.current.size,
        biliStreamCache: biliStreamCacheRef.current.size,
        lrcLibCache: lrcLibCache.current.size,
        trackMetaEntries: Object.keys(trackMetaMapRef.current || {}).length,
        trackMetaCoverEntries: Object.values(trackMetaMapRef.current || {}).filter((entry) => !!entry?.cover).length,
        currentTrackPath: playlistRef.current[currentIndexRef.current]?.path || ''
      }
      console.info('[memory:dump]', stats)
      return stats
    }

    window.__echoDumpMemoryStats = dumpMemoryStats
    return () => {
      delete window.__echoDumpMemoryStats
    }
  }, [config.devModeEnabled])

  const searchMvWithCache = useCallback(
    async (query, source = 'bilibili') => {
      if (!window.api?.searchMVHandler) return null
      const normalizedQuery = String(query || '').trim()
      const normalizedSource = String(source || 'bilibili').trim().toLowerCase() || 'bilibili'
      if (!normalizedQuery) return null
      const cacheKey = `${normalizedSource}::${normalizedQuery.toLowerCase()}`
      const cached = readRuntimeCache(mvSearchCacheRef, cacheKey, MV_SEARCH_CACHE_TTL_MS)
      if (cached !== null) return cached
      const pending = mvSearchPendingRef.current.get(cacheKey)
      if (pending) return pending
      const task = window.api
        .searchMVHandler(normalizedQuery, normalizedSource)
        .then((result) =>
          writeRuntimeCache(mvSearchCacheRef, cacheKey, result || null, MAX_MV_SEARCH_CACHE_ENTRIES)
        )
        .finally(() => {
          mvSearchPendingRef.current.delete(cacheKey)
        })
      mvSearchPendingRef.current.set(cacheKey, task)
      return task
    },
    [readRuntimeCache, writeRuntimeCache]
  )

  const resolveBiliDirectStreamCached = useCallback(
    async (bvid, qn) => {
      if (!window.api?.resolveBilibiliStream) return null
      const normalizedBvid = String(bvid || '').trim()
      if (!normalizedBvid) return null
      const cacheKey = `${normalizedBvid}::${qn}`
      const cached = readRuntimeCache(biliStreamCacheRef, cacheKey, BILI_STREAM_CACHE_TTL_MS)
      if (cached) return cached
      const pending = biliStreamPendingRef.current.get(cacheKey)
      if (pending) return pending
      const task = window.api
        .resolveBilibiliStream(normalizedBvid, qn)
        .then((result) =>
          result?.ok
            ? writeRuntimeCache(
                biliStreamCacheRef,
                cacheKey,
                result,
                MAX_BILI_STREAM_CACHE_ENTRIES
              )
            : result
        )
        .finally(() => {
          biliStreamPendingRef.current.delete(cacheKey)
        })
      biliStreamPendingRef.current.set(cacheKey, task)
      return task
    },
    [readRuntimeCache, writeRuntimeCache]
  )

  const searchBilibiliMv = useCallback(async (title = '', artist = '') => {
    if (!window.api?.searchMVHandler) return null

    const safeTitle = cleanTitleForSearch(title || '')
    const safeArtist = (artist || '').trim()
    const queries = [
      safeArtist ? `${safeTitle} ${safeArtist} MV` : `${safeTitle} MV`,
      safeArtist ? `${safeTitle} ${safeArtist} official MV` : `${safeTitle} official MV`,
      `${safeTitle} ${safeArtist}`.trim(),
      safeTitle
    ].filter((q) => q && q.trim())

    for (const q of queries) {
      try {
        const result = await searchMvWithCache(q.trim(), 'bilibili')
        if (result) {
          const id = typeof result === 'string' ? result : result.id
          if (id) return id
        }
      } catch (_) {
        // try next query
      }
    }

    return null
  }, [searchMvWithCache])

  const retryFetchLyrics = async () => {
    const track = playlist[currentIndex]
    if (!track) return
    clearLyricsOverrideForPath(track.path)
    const metaTitle = metadata.title || (track ? stripExtension(track.name) : '')
    const metaArtist = metadata.artist || track?.info?.artist || ''
    try {
      // 濠电姷鏁告慨鐑藉极閹间礁纾块柟瀵稿Т缁躲倝鏌﹀Ο渚＆婵炲樊浜濋弲婊堟煟閹伴潧澧幖鏉戯躬濮婃椽宕ㄦ繝鍐槱闂佹悶鍔嶅妯绘櫏闂佸搫琚崕鏌ユ偂閸愵亝鍠愭繝濠傜墕缁€鍫ユ煟閺冨倸甯堕柦鍐枑缁绘盯骞嬮悜鍡欏姱闂佺粯鏌ㄩ崥瀣磻閸岀偛绠规繛锝庡墮閻忣噣鏌嶈閸撴繈顢氳閳ユ棃宕橀鍢壯囧箹缁厜鍋撻懠顒€鍤梻鍌欑閹测€愁潖瑜版帗鍋￠柕澶嗘櫓閺佸鏌ㄥ┑鍡橆棤妞も晝鍏橀幃妤呮晲鎼存繄鏁栭梺绋匡功閸嬫盯鈥旈崘顔嘉ч柛鈩冾殘閻熴劌顪冮妶蹇涙婵犮垺顭堥。楣冩煟韫囨洖浠滃褏鏅划濠氬礈瑜忓Λ顖炴煙椤栧棗鑻崜鐗堢箾鐎涙鐭岄柟铏崌閸╃偤骞嬮敂缁樻櫓闂佸吋浜介崕閬嶅船婢舵劖鍊甸悷娆忓缁岃法绱撳鍕槮闁伙絿鍏樺畷锟犳倷閳哄偆娼旀繝鐢靛仜濡瑩宕濋弽顓熷仧妞ゆ劧闄勯悡鐔煎箹缁厜鍋撻崘鑼剁窡闂備胶顭堥鍡涘箲閸ヮ剙钃熸繛鎴欏灩缁犳稒銇勯幘璺轰粶濠殿喓鍨藉?fetchLyrics 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偛顦甸弫鎾绘偐閼碱剦妲烽梻浣告惈濞层垽宕归崷顓犱笉闁绘娅曢崣蹇斾繆閻愰鍤欏ù婊堢畺閹鎲撮崟顒傤槰濠电偠灏欓崰鏍偘椤旂⒈娼ㄩ柍褜鍓熼妴浣糕枎閹炬潙鐧勬繝銏ｆ硾椤戝洭寮堕悷鎵虫斀闁挎稑瀚禍濂告煕婵犲啯绀堥柟骞垮灲楠炲洭顢欓悷棰佸濠殿喗顭囬崢褔寮搁妶鍥╃＜妞ゆ梻鈷堥悡鍏碱殽閻愭潙绗掗摶鏍归敐鍛儓妤犵偛鐗撳缁樻媴閸濄儳楔闂佺顑呴敃顏勭暦濠婂啠鏋庨柟鎹愭珪鏉堝牓姊绘笟鍥у缂佸鏁婚幃锟犳偄閸忚偐鍙嗗┑鐘绘涧濡瑩骞栭幇顑炵懓顭ㄩ崟顐㈠Б闁兼寧鍔欓弻娑㈠Ψ閹存繄啸闁告凹鍋婇幃妤冩喆閸曨剛顦ㄩ柣銏╁灡鐢繝宕洪姀鈩冨劅闁靛鍎抽娲⒑缂佹〞鎴︽晝閳哄懎鍌ㄥ┑鍌滎焾閻撴﹢鏌熸潏楣冩闁稿﹦鍏橀幃妤€鈽夊▍顓т簽閸犲﹤顓兼径瀣ф嫼缂佺虎鍘奸幊蹇涙偟椤忓牊鐓曢柡鍐ｅ亾闁荤啿鏅犻幃?
      // 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈閸ㄥ倿鏌涢锝嗙闁藉啰鍠栭弻鏇熺箾閻愵剚鐝﹂梺杞扮鐎氫即寮诲☉妯锋闁告鍋為悘宥呪攽?cleaned || metaTitle 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰▕閻掕姤绻涢崱妯诲碍閻熸瑱绠撻幃妤呮晲鎼粹€愁潻闂佸搫顑呴悧蹇涘焵椤掆偓缁犲秹宕曢崡鐐嶆盯寮崒娑樺簥?remix/live 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗ù锝夋交閼板潡寮堕崼姘珔闁搞劍绻冮妵鍕冀椤愵澀绮剁紓浣插亾濠㈣埖鍔栭悡娑㈡煕閵夈垺娅呴柡瀣灦缁绘盯宕ㄩ姘ｆ瀰闂佸搫鐭夌徊鍊熺亽濠电偛妫欓崕鍐测枔椤撶姷纾藉ù锝嗗絻娴滈箖姊虹化鏇炲⒉缂佸甯￠幃锟犳偄闂€鎰畾濡炪倖鐗楃喊宥夊箚閸儲鐓涢柛鈩冪煯閸氼偆绱掓潏銊ユ诞鐎殿噮鍣ｉ崺鈧い鎺戝缁犱即鏌熼幆鐗堫棄闁藉啰鍠栭弻鏇熺箾閸喖濮夊┑鈩冨絻閻楀﹥绌辨繝鍥舵晬婵ê褰夐搹搴☆渻閵堝懏绂嬮柛妯恒偢閳ユ棃宕橀鍢壯囨煕閳╁喚鐒芥い锔惧缁绘稓鈧稒顭囬惌濠囨煟閺嵮佸仮闁绘侗鍠楃换婵嬪磼濡や緡娼旀繝娈垮枟閿曨偆寰婇懞銉ь洸濡わ絽鍟悡鐔兼煏韫囧﹥顫婇柛鐔风箻閺岋綁骞掗弬澶稿闂侀潧娲ょ€氫即寮幇鏉垮窛妞ゆ劦婢€閸掓帡姊绘担鍛婃儓闁活厼顦遍幑銏犫攽閸℃瑦娈炬繝闈涘€告竟濠囧极閸愵喗鐓忛煫鍥ㄦ礀琚ラ梺瑙勭仛閸婃繂顫忕紒妯诲濡炲绨肩憰鍡涙⒒閸屾艾顏╅悗姘緲閻ｇ柉銇愰幒鎴濈€銈嗘⒒閸嬫挸鈻撻幆褉鏀芥い鏃€鏋婚懓鎸庛亜閵堝懎鈧灝顕ｉ锕€绀冮柍鐟般仒缁ㄨ顪冮妶鍡楀Е闁稿瀚板畷銏ゅ箹娴ｅ湱鍘告繝銏ｅ煐閿氱€殿噮鍠楅幈?
      await fetchLyrics(track.path, metaTitle, metaArtist, {
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

  const lrcLibCache = useRef(new Map())
  const lrcLibPendingRef = useRef(new Map())

  const requestLrcLib = async (url) => {
    if (lrcLibCache.current.has(url)) return lrcLibCache.current.get(url)
    if (lrcLibPendingRef.current.has(url)) return lrcLibPendingRef.current.get(url)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 6000)
    const task = fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null
        const data = await response.json()
        lrcLibCache.current.set(url, data)
        if (lrcLibCache.current.size > MAX_LRCLIB_CACHE_ENTRIES) {
          const firstKey = lrcLibCache.current.keys().next().value
          lrcLibCache.current.delete(firstKey)
        }
        return data
      })
      .catch(() => null)
      .finally(() => {
        clearTimeout(timeoutId)
        lrcLibPendingRef.current.delete(url)
      })

    lrcLibPendingRef.current.set(url, task)
    return task
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
      const sourcePreference = configRef.current.lyricsSource || 'lrclib'
      const externalSources =
        sourcePreference === 'qq'
          ? ['qq', 'kugou', 'kuwo']
          : sourcePreference === 'kugou' || sourcePreference === 'kuwo'
            ? [sourcePreference]
            : ['qq', 'kugou', 'kuwo']

      // LRCLIB闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔兼倻濮楀棙鐣烽梺绋垮椤ㄥ棝濡甸崟顖氱睄闁割偆鍠愬▓浼存⒑缁嬫鍎愰柟鐟版搐铻為柛鎰╁妷濡插牊鎱ㄥΟ鍝勮埞濠殿噣浜堕弻锝嗘償閵忊晛鏅遍梺鍝ュУ閻楃娀鍨鹃敃鍌涚叆閻庯絺鏅濈粻姘舵⒑缂佹ê鐏辩悮娆撴煃瑜滈崜銊х不閹捐崵宓侀悗锝庝簴閺€浠嬫煕閵夈垺娅嗘繛?+ 濠电姷鏁告慨鐑藉极閹间礁纾绘繛鎴欏焺閺佸銇勯幘璺烘瀾闁告瑥绻橀弻鐔虹磼閵忕姵鐏堢紓浣哄Х婵炩偓闁绘搩鍋婂畷鍫曞Ω瑜夋慨鍥⒑缁嬫鍎忔い锔炬暬瀵濡搁妷銏℃杸闂佺硶鍓濋敃顐ゆ閵娧呯＝濞达絿鎳撻弫鍓х磼閼碱剙浜剧紒宀冮哺缁绘繈宕堕懜鍨珫婵犵數鍋涘Λ娆戞暜閳哄懎绀夐柛娑卞幐閺€浠嬫⒔閸モ晙鐒婃繛鍡樻尭閺嬩礁鈹戦悩瀹犲闁藉啰鍠栭弻銊モ攽閸♀晜顎嗙紓鍌氱У閻楁濡甸崟顖氱闁糕剝銇炴竟鏇炩攽閻樻鏆柍褜鍓濈亸娆撴儗濞嗘挻鐓涚€光偓鐎ｎ剛袦濡ょ姷鍋為悷鈺佺暦閻旂⒈鏁囬柣娆忔噽閸氬綊姊婚崒娆戭槮缂傚秴锕棢闁规儳顕粻楣冩煃瑜滈崜娆撳煘閹达富鏁婇柣鐔碱暒婢规洟姊婚崒娆掑厡缂侇噮鍨堕弫瀣⒑閸濄儱鏋庢繛纭风節瀹曟椽鍩€椤掍降浜滈柟鐑樺灥椤徰囨煙閺屻儳鐣洪柡灞糕偓宕囨殕閻庯綆鍓涢惁鍫ユ倵鐟欏嫭绀冮柨鏇樺灲閵嗕礁顫滈埀顒勫箖閵忋倕绠掗柟鍝勬娴滈箖鏌熼幍顔碱暭闁稿鍓濈换婵囩節閸屾凹浠剧紓浣藉煐閻擄繝寮诲☉娆戠瘈闁稿本绮堥搹搴ㄦ⒑娴兼瑧鍒伴柛銏＄叀閸┿垺鎯旈妸銉ь啋闂佸搫顦伴崹宕囧垝閿熺姵鈷戦悹鍥ㄧ叀閸欏嫭绻涙担鍐叉搐缁犵儤绻濇繝鍌滃悋闁搞儺鍓﹂弫瀣煃瑜滈崜娆擄綖韫囨拋娲敂閸曨偆鐛╁┑鐘垫暩婵挳骞婃惔銊嬪鈹戠€ｎ偀鎷虹紓鍌欑劍閿曗晛鈻撻弮鈧穱濠囶敃閿濆洨鐤勫Δ鐘靛仜閿曨亪骞冮姀銈呯闁绘挸绨肩花濠氭⒒娴ｈ櫣甯涢柟绋挎啞椤ㄣ儵骞栨担鍝ワ紱閻庡箍鍎卞Λ娑氬姬閳ь剟姊哄Ч鍥х伈婵炰匠鍕ⅰ闂傚倷娴囨竟鍫ワ綖婢舵劕纾块柟鎯版閻?
      const lrclibPromise = Promise.all([
        requestLrcLib(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`),
        // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴濐潟閳ь剙鍊圭粋鎺斺偓锝庝簽閸旓箑顪冮妶鍡楀潑闁稿鎹囬弻娑㈡偄闁垮浠撮梺绯曟杹閸嬫挸顪冮妶鍡楀潑闁稿鎸剧槐鎾愁吋閸滃啳鍚Δ鐘靛仜閸燁偉鐏掗柣鐘叉穿鐏忔瑧绮ｉ悙鐑樼厽閹兼惌鍨崇粔鐢告煕韫囨棑鑰跨€殿喗鎮傚浠嬵敃閵堝浄绱抽梻浣侯焾閺堫剟鎮疯瀹曟繂顓奸崱鎰盎濡炪倖鎸鹃崑鐐哄窗濡皷鍋撶憴鍕┛缂傚秳绶氬畷娲焵椤掍降浜滈柟鐑樺灥椤忣亪鏌ｉ幘璺烘灈闁哄矉绲借灒闁告繂瀚鍥⒑缁嬭儻顫﹂柛鏃€鍨垮璇测槈閵忕姈鈺呮煏婢诡垰鎲涢妸鈺傗拺閻犲洠鈧櫕鐏嗙紓渚囧枟閻熲晠濡存笟鈧鎾閳╁啯鐝抽梻浣规偠閸庢挳宕洪弽顓熺叆闁靛牆顦伴埛鎺懨归敐鍫燁仩闁靛棗锕弻娑㈠箻鐎靛摜鐤勯梺纭呮珪缁诲啴濡堕敐澶婄妞ゆ牗鍑瑰Σ鍛娿亜椤愶絿鐭掗柛鈹惧亾濡炪倖甯掔€氼剟鎷戦悢鍏肩叆闁绘柨鎼瓭闂備礁宕ú锕傚Φ閸曨垰绠涢柍杞拌兌娴煎嫭绻涚€电袥闁哄懏鐩垾鏃堝礃椤斿槈褔鏌涢埄鍐剧劷闁告瑥妫涚槐鎾存媴閸撳弶笑缂傚倸绉撮敃銈夘敋閿濆鏁冮柕蹇婃櫅閹垿姊洪崨濠佺繁闁搞劌宕埢鎾诲即閵忊檧鎷洪梺鍛婄☉閿曘儳绮堥埀顒勬⒑鐠囪尙绠查柤褰掔畺閳ワ箓宕稿Δ鈧粻濠氭倵闂堟稒鎲搁柣锕€鐗撳娲濞戙垻宕紓浣藉紦缁瑩骞冮敓鐘茬疀闁绘鐗忛崢钘夆攽鎺抽崐鎾绘嚄閸洘鍎楅柟鐑樻煛閸嬫挸鈻撻崹顔界彯闂佺顑呴敃銉︾┍婵犲洤閱囬柡鍥╁仧閸婄偤姊洪崘鍙夋儓闁稿锕﹀Σ鎰板焺閸愌呯畾闂佺粯鍔︽禍婊堝焵椤掍胶澧甸柟顔ㄥ吘鏃堝礃椤忓棛鍘梻浣筋潐瀹曟﹢顢氳瀹曞綊宕掗悙瀵稿幗闂佽鍎抽崯鍧楊敊閸屾稓绠鹃柟瀛樼懃閻忣亪鏌涚€ｎ亶鍎旈柡灞剧洴閸╋繝宕熼鍌氭锭闂備焦鎮堕崝灞筋焽閿熺姵鍋樻い鏇楀亾鐎规洘锕㈤、娆撴嚍閵夈儱濮冨┑锛勫亼閸婃牠宕濋幋锕€纾归柟鐗堟緲閸戠娀鏌″搴″箺闁抽攱鍨垮娲敃閵堝懍绮堕梺鍏兼た閸ㄩ亶寮查崼鏇ㄦ晪闁逞屽墴瀵顓奸崶銊ョ彴闂佸搫琚崕鍗烆嚕娴煎瓨鈷戠紒顖涙礃閺夋椽鏌涙惔銊︽锭闁伙絿鍏樻俊鎼佸煛婵犲啯娅栨繝鐢靛Т閿曘倗鈧稈鏅為埅鎼佹⒒閸屾艾鈧悂宕愰幖浣哥９闁归棿绀佺壕褰掓煙闂傚顦﹂柣銈庡枟閵囧嫰骞囬埡浣哄姶闂佹悶鍊栧ú鐔煎蓟濞戙埄鏁冮柨婵嗘椤︹晠姊烘潪鎵槮婵☆偅鐟ч幑銏犫槈閵忕姷顓哄┑鐐叉缁绘帗绂掓ィ鍐┾拺闁硅偐鍋涢埀顒佹礋閹矂宕掗悙鑼舵憰闂佹寧绻傞ˇ顖滅不閿濆鐓熼柟閭﹀墯椤ョ偤鏌涢妸銉﹀仴鐎殿喖顭烽弫鍐磼濮樺崬骞愰梻浣告啞娓氭宕伴弽顓炵劦妞ゆ帒鍊归弳鈺呮煟閵夘喕閭い銏★耿閹瑩寮堕幋鐑嗕画缂傚倷鑳堕搹搴ㄥ矗閸愵亞涓嶉柡宥庡幖閽冪喖鏌ｉ弮鍌楁嫛闁轰礁锕弻銈夊箒閹烘垵濮㈠銈忛檮濠㈡鐏冮梺缁橈耿濞佳勭濠婂懐纾肩紓浣癸公閼版寧顨ラ悙鎻掓殻闁糕晛瀚板畷姗€鍩℃担绋课ら梻鍌欑劍閺嬪ジ寮插☉銏犵柈妞ゆ牜鍎愰弫鍌炴煟閺傚灝鎮戦柣鎾跺枛楠炴牗娼忛崜褏蓱闂佹悶鍊愰崑鎾斥攽閻橆喖鐏柟铏崌閺佸啴顢旈崟顓熸婵炴潙鍚嬪娆撳礃閳ь剙顪冮妶鍡楀Ё缂傚秴妫楅…鍥偄閸忓皷鎷洪柣鐔哥懃鐎氼剟宕濋妶澶嬬厽闊洦鎸炬晶锔锯偓瑙勬礃閸ㄥ潡鐛Ο灏栧亾濞戞顏堫敁閹剧粯鈷戦柛娑橈工婵箓鏌ｉ幘宕囧閾荤偤鏌涢鐘插姕闁抽攱鍨块弻鐔兼嚃閳轰椒绮х紓浣介哺閿曘垽寮诲☉銏犵疀妞ゆ巻鍋撻柍閿嬫閺屾稑鈻庨幘鍓佹毇濠碘槅鍋勯幊姗€銆侀弴銏狀潊闁炽儲鍓氬Σ杈ㄧ節濞堝灝鏋涢柨鏇樺€楃槐鐐寸節閸屾粍娈鹃梺鐟扮摠缁洪箖寮ㄦ禒瀣€甸柨婵嗛娴滅偤鏌?
        coverArtistClean && titleVariants[0] && q !== titleVariants[0]
          ? requestLrcLib(`https://lrclib.net/api/search?q=${encodeURIComponent(titleVariants[0])}`)
          : Promise.resolve(null)
      ]).then(([data1, data2]) => {
        // 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偛顦甸弫鎾绘偐閸愬弶鐤勫┑掳鍊х徊浠嬪疮椤栫偛纾婚悗锝庡枟閻撴洟鏌嶉埡浣告殶闁愁垱娲熼弻娑㈠Χ閸℃顫掗梺鍝勭焿缂嶄礁顕ｉ鍕閹兼番鍨归弸鎴︽⒒娴ｅ摜锛嶇紒顕呭灠铻為柛鎰靛枛閽冪喖鏌￠崶銉ョ仼闂佸崬娲︾换婵嬫濞戞瑧銈紓浣戒含閸嬨倕顫忛搹鍦煓閻犳亽鍔嶉崳鎶芥⒑閸涘﹣绶遍柛銊﹀▕閺佸秴鈹戦崶鈺冾啎闁哄鐗嗘晶鐣岀矓椤掍降浜滄い鎰╁焺濡插搫霉濠婂啯鍟為悗浣冨亹閳ь剚绋掗…鍥储娴犲顥婃い鎰╁灪婢跺嫰鏌熺亸鏍ㄦ珔閾伙綁鏌嶈閸撶喎顫忛悜妯诲闁规鍣Σ顔剧磽娴ｅ壊妲奸柛鈺傜墱缁骞掑Δ浣规珖闂佺鏈銊╂偩妤ｅ啯鍋℃繝濠傚暟缁犱即鎽?id 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偛顦甸弫鎾绘偐閾忣偅鐝ㄦ繝纰夌磿閸嬫垿宕愰妶澶婂偍濡わ絽鍟粈鍌涗繆椤栨繃顏犻柡?
        const seen = new Set()
        const merged = []
        for (const item of [...(Array.isArray(data1) ? data1 : []), ...(Array.isArray(data2) ? data2 : [])]) {
          const id = item?.id ?? item?.trackName
          if (id && seen.has(id)) continue
          if (id) seen.add(id)
          merged.push(item)
        }
        const ranked = rankLrcLibCandidates(merged, audioDur, rankOpts)
        return ranked.slice(0, 30).map((r, i) => {
          const tn = r.item?.trackName || r.item?.track_name || ''
          const an = r.item?.artistName || r.item?.artist_name || ''
          return {
            key: `lrclib-${i}-${tn}`,
            source: 'lrclib',
            title: tn || '-',
            subtitle: an || '-',
            badge: `LRCLIB -${r.score.toFixed(0)}`,
            raw: r.chosenLyrics
          }
        })
      }).catch(() => [])

      // 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮闁汇値鍠楅妵鍕冀椤愵澀绮堕梺鎼炲妼閸婂潡骞冪憴鍕闁规鍠氬崗闂備焦瀵х换鍌炲箟濮椻偓瀵噣鍩€椤掑嫬绠柛娑卞枤閻熻銇勯弽銊ф创闁轰焦绮撳濠氬磼濞嗘劗銈板銈庡亜椤︾敻鐛崱妤冩殕闁告洦鍋勯悗顓㈡倵鐟欏嫭绀€婵炲眰鍔戦幃宕囩磼濡湱绠氶梺闈涚墕閹冲繘宕冲ú顏呯厽闁规儳顕幊鍥煛鐏炲墽顬肩紒鐘崇☉椤繈顢栭幐搴ｆ綎闂傚倷鐒﹀鍧楀储婵傚憡鍎楅柛宀€鍋涢拑鐔哥箾閹寸偟鐓繛宀婁邯閹綊宕堕妸銉хシ濡炪値鍋勫ú顓㈠箖濡ゅ啯鍠嗛柛鏇ㄥ墰閿涙﹢姊虹粙鍨劉闁绘搫绻濋悰顕€宕卞☉妯肩潉闂佸壊鍋嗛崰鎰枍濠婂牊鈷戠紒顖涙礀婢ф煡鎷戞潏銊ｄ簻闁规儳纾粔鐑樻叏婵犲嫮甯涢柟宄版嚇瀹曘劍绻濋崘銊ュ闂傚倷鑳剁划顖炪€冮崱娆忓灊闁规儳纾弳锔界節婵犲倸鏆婇柡瀣叄閻擃偊宕堕妷銉ュГ闂侀€炲苯澧繛纭风節楠炲啫螖閸涱噮妫冨┑鐐村灦閻熴儵寮抽崼銉︾厽閹兼番鍨婚。鑼偓鍏夊亾闁归棿绀侀拑鐔哥箾閹存瑥鐏╅柛妤佸▕閺屾洘绻涢崹顔煎缂備降鍔岄…宄邦潖閾忚瀚氶柡灞诲労閳ь剚顨嗛妵鍕敇閻愬弶些濡炪値鍋勭换鎰弲濡炪倕绻愮€氼噣顢欏畝鍕拺闁革富鍘奸崝瀣煛鐎ｉ潧澧撮柡浣瑰姈瀵板嫮鈧綆鍓欓獮鎰版⒑鐠囪尙绠抽柛瀣仱瀵憡绻濆鍗炲絾濡炪倖甯婄欢鈥斥枔娴犲鐓熼柟閭﹀幗缂嶆垶绻涢幖顓炴灍妞ゃ劊鍎甸幃娆撳级閹寸偠鐧佹俊銈囧Х閸嬫盯顢栨径鎰畺闁宠桨璁查弸鏃堟煙缁嬪灝顒㈡い鏃€鍔欏濠氬磼濮橆兘鍋撻悜鑺ュ€块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔告綇妤ｅ啯顎嶉梺绋垮椤ㄥ懘婀侀梺鎸庣箓濞层倝宕濈€ｎ兘鍋撶憴鍕闁绘搫绻濆璇测槈閵忕姷鐤€闂佹眹鍨藉褏鏁妷鈺傗拺缂備焦蓱鐏忣亪鏌涙惔锝嗘毈鐎殿喖顭峰鎾閻樿鏁规繝鐢靛█濞佳兠归崒姣兼盯鍨鹃幇浣瑰瘜闂侀潧鐗嗘鍛婄濠靛鐓熸俊銈呭暙閳诲牏鈧鍠栭…鐑藉极閹剧粯鍋愰柤纰卞墻濡茶淇婇悙顏勨偓鏍礉閹达箑鍨傞柤濮愬€楅惌娆撶叓閸ャ劍绀堢痪鎹愭闇夐柨婵嗙墱閸ゅ啯绻涢崼鐔糕拹闁靛洤瀚伴弫鍌炴倷椤掍焦鐦撴俊銈囧Х閸嬫稑螞濠靛棛鏆﹂柣鏃傗拡閺佸洭鏌ｅΟ鍏兼毄闁告﹩鍨跺缁樻媴缁嬫妫岄梺缁樻尭閻楁挸鐣锋导鏉戝唨妞ゆ劑鍊楅ˇ顖氣攽椤斿浠滈柛瀣尰閹便劍绻濋崒娑欏創闁轰礁鐗撻弻娑㈠Ψ閹存繂鏋ら柣搴㈠▕濮婅櫣鎷犻幓鎺濆妷闂佸憡鍨电紞濠傜暦閺夋娼╅悹楦挎椤︻偊姊洪崷顓炲妺妞ゃ劌鎳忛崕顐︽⒒娴ｅ摜鏋冩俊妞煎妿缁牊绗熼埀顒€鐣?
      const neteasePromise = window.api?.neteaseSearch
        ? window.api.neteaseSearch(q).then((songs) => {
            if (!songs?.length) return []
            const normTitle = (titleVariants[0] || '').toLowerCase().replace(/\s+/g, '')
            const normArtist = (coverArtistClean || coverArtistRaw || '').toLowerCase().replace(/\s+/g, '')
            const rawKw = (metaTitle || '').toLowerCase()

            // 闂傚倸鍊搁崐宄懊归崶顒夋晪鐟滃繘鎳為柆宥嗗殐闁宠桨鑳剁粵蹇旂節閻㈤潧校闁绘棏鍓涚槐鐐哄冀瑜滈悢鍡涙煠閹间焦娑у┑顔肩墦閺屾稒鎯旈埥鍛板惈闂佸搫琚崝鎴﹀箖閵忋倕浼犻柛鏇熷灟閸ㄨ崵妲愰幒妤佸亼婵炲棗绻戞径鍕煟閹惧崬鍔滅紒缁樼洴楠炲鎮樺ú璁抽偗妞ゃ垺妫冮、鏇㈡晲閸モ晩鍟庡┑鐘灱濞夋盯鎮ч崱娑欏€堕柡灞诲劜閻撴稓鈧厜鍋撻悗锝庡墰閿涚喖姊洪柅鐐茶嫰婢у墽绱撳鍛棦鐎规洘鍨垮畷鍗炩槈濞嗗繐澹掗梺璇插嚱缂嶅棙绂嶉崼鏇熷亜闁糕剝鐟﹂崰鎰節闂堟稓澧㈠☉鎾崇Ч閺岀喖骞嗚閿涘秹鏌￠崱顓㈡闁逛究鍔岃灒闁圭娴烽妴鎰旈悩闈涗杭闁搞劍妞芥俊鐢稿礋椤栨氨顔掗柣鐘烘濞插懘濡烽敂杞扮盎闂佹寧妫侀褍鈻嶅澶嬬厸閻忕偟顭堟晶鑼偓鍨緲鐎氭澘鐣烽崡鐐嶇喖鎳￠妶鍛埌婵犵數濮烽弫鎼佸磻閻樻椿鏁嬫繝濠傛噽娑撳秹鏌熼幑鎰惞鐎规挷绶氶獮鏍庨鈧俊濂稿炊鐎涙绡€闁靛骏绲剧涵楣冩煠濞茶鐏ｇ紒顔硷躬閺佸啴宕掑☉鎺撳闂備礁鎲￠幐鏄忋亹閸愨晝顩叉繝闈涙川缁犻箖鏌涘▎蹇ｆШ濠⒀屼邯閺屽秶鎷犻懠顑冣攽椤旂懓浜鹃梻渚€娼ч悧鍡椢涘☉銏犲偍?
            const scored = songs.map((s) => {
              const sName = (s.name || '').toLowerCase().replace(/\s+/g, '')
              const sArtist = (s.artists || '').toLowerCase().replace(/\s+/g, '')
              const sAll = sName + ' ' + sArtist + ' ' + (s.album || '').toLowerCase()
              const durSec = typeof s.duration === 'number' ? s.duration / 1000 : 0

              let score = 0

              // 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈠Χ閸モ晝鍘犻梻浣告惈椤︿即宕靛顑炴椽顢斿鍡樻珝婵＄偑鍊ら崑鎺楀礂濮椻偓瀹曟垿骞樼拠鑼紲濠电偞鍨堕崙鐟懊归崟顖涚厽閹兼惌鍨崇粔闈浢瑰鍛槐閽樻繈姊洪鈧粔鐢稿磻閳╁啰绡€濠电姴鍊归崳瑙勩亜閿濆懌鍋㈤柟顔荤矙椤㈡稑鈽夊Ο纰卞剬-
              if (sName === normTitle) score += 50
              else if (sName.includes(normTitle) && normTitle.length >= 2) score += 25
              else if (normTitle.includes(sName) && sName.length >= 2) score += 15
              else score -= 20  // 闂傚倸鍊搁崐宄懊归崶顒夋晪鐟滃秹婀侀梺缁樺灱濡嫮绮婚悩缁樼厵闁告挆鍛闂佹悶鍊栭崝鏍Φ閸曨垰鍐€妞ゆ劦婢€缁爼姊哄ú璇插箺妞ゃ劌锕幃锟狀敃閿曗偓閻愬﹪鏌曟繝蹇氬悅闁瑰嘲顭峰鍝勭暦閸モ晛绗″┑顔硷工椤兘宕洪埀顒併亜閹哄棗浜剧紓浣哄Т缁夌懓鐣烽弴銏＄劶鐎广儱鎳愰悿鍥椤愩垺澶勭紒瀣灩婢规洟宕稿Δ浣哄幍闂佸憡鎸嗛崨顓狀偧闂備胶绮幐鑽ょ矙閹捐鐒垫い鎺嗗亾缂佺姴绉瑰畷鏇㈡焼瀹ュ懐鐤囬棅顐㈡处缁嬫垹绮ｅΔ浣风箚妞ゆ牗绋撳﹢钘壝瑰鍕煉闁哄被鍔岄埞鎴﹀幢濡警妲辨繝鐢靛仜閹冲繐煤閻旂厧钃熼柣鏂垮濡插綊骞栫划鐟邦嚒闁靛緵棰佺盎闂佺懓澧介幊鎾凰夊鍥╃＜闁绘ê纾ú瀵糕偓娈垮枟閹告娊骞冮鍫濈劦妞ゆ巻鍋撻崡閬嶆煟閹达絽袚闁抽攱甯掗湁闁挎繂鎳忛崯鐐烘偣閹般劌澧查柕鍥у閺佹劖鎯旈埄鍐壕闁诲骸鐏氬姗€鏁冮妷褏鐭夐柟鐑樻煛閸嬫捇鏁愭惔婵堢泿-

              // 闂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛顐ｆ礀閸屻劎鎲稿澶嬫櫇闁靛繈鍊栭悞鑲┾偓骞垮劚閹虫劙鏁嶉悢鍏尖拺闂傚牊绋撴晶鏇㈡煙闁垮鐏撮柟铏尵閹瑰嫰濡搁姀鐘卞闁荤喐鐟ョ€氼厾绮堥埀顒€鈹戦悙璺虹毢濠电偐鍋撻悗瑙勬礃閸ㄥ潡鐛鈧幊婊堟濞戞ê绠查梻鍌欑閹测剝绗熷Δ鍛獥婵娉涜繚闂佽澹嗘晶妤呮偂閻旇偐鍙撻柛銉ｅ妽鐏忔壆绱掗崒姘煎剶闁哄本鐩弫鎰疀閺囩姌婊堟倵?
              if (normArtist && sArtist.includes(normArtist)) score += 40
              else if (normArtist && normArtist.includes(sArtist) && sArtist.length >= 2) score += 20

              // 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈡晝閳ь剟鎮块濮愪簻闁规澘鐖煎顕€鏌涚€ｎ亶妲搁柍瑙勫灴瀹曟帒顭ㄦ惔锝呭Ъ婵犳鍠涢～澶愭偂閳ユ剚娼栨繛宸憾閺佸棝鏌嶈閸撴稓鍒掗弮鍌楀亾闂堟稒鎲稿☉鎾崇Ч閺岀喖骞嗛弶鍟冩捇鏌ｉ幘宕囩妞ゎ叀娉曢幑鍕惞閻熼偊鏆┑鐘茬棄閵堝棛銆婄紓?
              if (durSec > 0 && audioDur > 0) {
                const diff = Math.abs(durSec - audioDur)
                if (diff <= 5) score += 20
                else if (diff <= 15) score += 10
                else if (diff > 60) score -= 10
              }

              // 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊椤掑鏅梺鍝勭▉閸樺ジ宕归崒娑栦簻闊洦鎸炬晶鏇㈡煟閵堝洤浜剧紒缁樼箞濡啫鈽夊顑藉彙缂傚倷璁查崑鎾斥攽閻樺弶澶勯柣鎾寸懇閺岋綁骞嬮悜鍥︾返濠电偛鐗婂ú鐔煎蓟濞戞埃鍋撻敐鍐ㄥ濠殿喖鍊块弻锛勪沪閻愵剛顦ㄧ紓浣虹帛缁诲棛绮诲☉銏犲嵆闁绘娅曢蹇涙⒒閸屾瑨鍏岀紒顕呭灦楠炴劗鎷犵憗浣规そ瀵粙顢橀悙闈涘绩濠电姰鍨奸崺鏍礉閺囩姷涓嶉柤濮愬€愰崑鎾舵喆閸曨剛顦ュ┑鐐差檧缁犳帡藝瀹曞洨纾肩紓浣诡焽濞插瓨顨ラ悙杈捐€跨€规洘锚椤斿繘顢欓懞銉晥闂傚倸鍊烽懗鍫曘€佹繝鍕剨婵炲棙鍔栧▍鐘充繆閵堝懏鍣圭紒鐙€鍨堕弻娑樷槈濡吋鎲奸梺绋匡功缁垱绌辨繝鍥舵晬婵﹩鍓氶崐顖氣攽閻愯尙澧涢柟顔煎€搁～蹇曠磼濡顎撻梺鎯х箳閹虫挾绮垾鎰佹富闁靛牆鍟俊濂告煙閾忣偓鑰挎鐐插暢椤﹀磭绱掔紒妯肩疄鐎规洘甯￠弫鍐╂媴閹绘帊澹曢梺鍓茬厛閸熸棁銇愰幒鎴狀槯闂佺绻楅崑鎰矙閸ヮ剚鈷戞繛鑼额嚙楠炴銇勯妸銉︻棡缂佸矁椴哥换婵嬪炊閼稿灚娅栨繝娈垮枟閿曗晠宕ｉ埀顒傜棯椤撴稑浜剧紓?
              const badVariants = [
                { terms: ['instrumental', 'inst', 'off vocal', 'karaoke'], penalty: -60 },
                { terms: ['dj', 'remix'], penalty: -30 },
                { terms: ['live'], penalty: -15 },
              ]
              for (const { terms, penalty } of badVariants) {
                const userWants = terms.some((t) => rawKw.includes(t))
                if (!userWants && terms.some((t) => sAll.includes(t))) score += penalty
              }

              return { s, score }
            })
            .filter(({ score }) => score > -30)  // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曚綅閸ヮ剦鏁冮柨鏇楀亾闁汇倗鍋撶换娑㈠箣閻愨晜锛堝┑鐐叉▕娴滄繈寮插┑瀣厱閻忕偟鍋撻惃鎴炪亜閺傛寧鍤囨慨濠冩そ濡啫鈽夊顒夋毇婵＄偑鍊х€靛矂宕圭捄铏规殾闁挎繂妫涚弧鈧梺鎼炲劀閸滀礁鏅ｅ┑鐘垫暩閸庢垹绱為崱娑樼婵炲棙鎸婚崐鑸点亜韫囨挾澧涢柣鎾冲暟缁辨挻鎷呴懖鈩冨灴閹繝濡烽埡鍌滃帗闂佽姤锚椤﹁棄螣閳ь剙螖閻橀潧浠﹂柨姘舵煟閿濆洤鍘寸€规洖鐖煎畷閬嶅箛椤戣棄浜鹃柡宥庡亝瀹曞弶绻涢幋娆忕仼缂佺嫏鍥ㄧ厵闁圭⒈鍘奸獮妤呮煃鐠囪尙澧﹂柟?
            .sort((a, b) => b.score - a.score)

            return scored.slice(0, 20).map(({ s, score }) => ({
              key: `ne-${s.id}`,
              source: 'netease',
              title: s.name || '-',
              subtitle: s.artists || '-',
              badge:
                typeof s.duration === 'number' && s.duration > 0
                  ? `NetEase -${(s.duration / 1000).toFixed(0)}s -${score}`
                  : `NetEase -${score}`,
              songId: s.id
            }))
          }).catch(() => [])
        : Promise.resolve([])

      const externalPromise = window.api?.searchExternalLyrics
        ? window.api
            .searchExternalLyrics({
              keywords: q,
              durationSec: audioDur,
              sources: externalSources
            })
            .then((res) => {
              const items = Array.isArray(res?.items) ? res.items : []
              const ranked = rankLrcLibCandidates(items, audioDur, rankOpts)
              return ranked.slice(0, 24).map((r, i) => {
                const item = r.item || {}
                const source = item.source || 'external'
                const sourceName =
                  source === 'qq' ? 'QQ' : source === 'kugou' ? 'Kugou' : source === 'kuwo' ? 'Kuwo' : source
                return {
                  key: `${source}-${i}-${item.providerId || item.trackName || i}`,
                  source,
                  title: item.trackName || '-',
                  subtitle: item.artistName || '-',
                  badge: `${sourceName} -${r.score.toFixed(0)}`,
                  raw: r.chosenLyrics || item.syncedLyrics || item.plainLyrics || ''
                }
              })
            })
            .catch(() => [])
        : Promise.resolve([])

      // 闂傚倸鍊搁崐宄懊归崶褏鏆﹂柛顭戝亝閸欏繘鏌熺紒銏犳珮闁轰礁瀚伴弻娑㈠即閵娿儱绠婚梺娲诲幖濡濡撮幒鎴僵闁挎繂鎳嶆竟鏇㈡煟鎼淬値娼愭繛鎻掔箻瀹曠銇愰幒鎴犲弨婵犮垼鍩栭崝鏇綖閸涘瓨鐓熸慨妞诲亾婵炰匠鍥х劦妞ゆ帒鍊告禒杈ㄦ叏婵犲懏顏犵紒杈ㄥ笒铻ｉ柛婵嗗濞兼捇姊绘担鍓插悢闁哄鐏濋～鍥р攽椤旂》榫氭俊顐㈠椤㈡﹢宕楅悡搴ｇ獮闁诲函缍嗛崜娆撶嵁閸儲鈷掑┑鐘查娴滄粍绻涚拠褏鐣垫鐐村姍閹瑩顢楁担鍦娇婵犵數鍋為崹鍫曟偡閵堝洦宕查柛鈩兦滄禍婊堟煛瀹ュ啫濡奸柛銈庡墯娣囧﹪鎳犻懜娈夸哗缂備浇椴哥敮锟犮€佸▎鎾村殐闁宠桨璁查崣娲⒒娴ｇ瓔鍤冮柛锝庡櫍瀹曟澘顫濈捄铏瑰姦濡炪倖甯掔€氼厼鈽夎閺岀喖鎳為妷褏鐓夐柦妯荤箖閵囧嫰寮村Δ鈧禍鎯р攽椤旂》鏀绘俊鐐舵閻ｇ兘濡搁敂鍓х槇闂佸憡娲﹂崜娆忊枔韫囨洜纾介柛灞捐壘閳ь剚鎮傚畷鎰版偡闁附鍍甸梺闈浤涢崘銊т喊闂備礁鍟块幖顐﹀疮閻樿纾婚柟鐐灱濡插牊绻涢崱姗嗙劷闁告梻鍏樺鍝勭暦閸モ晛绗″┑顔硷工缂嶅﹥淇婇悽绋跨妞ゆ柨澧介弶鎼佹⒑閸︻厼浜鹃柛鎾寸缁傛帡宕滆绾捐棄霉閿濆棗绲诲ù婊堢畺濮婃椽鏌呴悙鑼跺濠⒀冪摠閹便劍绻濋崘鈹夸虎閻庤娲﹂崑濠傜暦閻旂厧鍨傛い鎰Р閸婃繂顫忛搹鍦煓闁秆勵殔瀵増绻涚€涙鐭婇柣鏍с偢閹即顢氶埀顒€鐣峰鈧俊鍛婃償閵忊檧鎷归梺鐟板槻閹虫﹢寮婚崨顓涙婵炲棗绻戦弫顏堟⒒閸屾艾鈧嘲霉閸ャ劍鍙忛柕鍫濐槹閺咁亝淇婇悙顏勨偓褏鈧潧鐭傚畷褰掑醇閺囩喐娅?
      const lrItems = await lrclibPromise
      setLyricsCandidateItems(lrItems)

      const neItems = await neteasePromise
      setLyricsCandidateItems([...lrItems, ...neItems])

      const externalItems = await externalPromise
      setLyricsCandidateItems([...lrItems, ...neItems, ...externalItems])
    } finally {
      setLyricsCandidateLoading(false)
    }
  }

  const openLyricsCandidatePicker = () => {
    setLyricsQuickBarDismissed(false)
    setLyricsQuickBarActivityAt(Date.now())
    searchLyricsCandidates()
  }

  const handleLyricsCandidatePick = async (row) => {
    const track = playlist[currentIndex]
    if (!track) return
    try {
      if (['lrclib', 'qq', 'kugou', 'kuwo'].includes(row.source) && row.raw) {
        const parsed = parseAnyLyrics(row.raw)
        if (parsed.length > 0) {
          setLyrics(parsed)
          setLyricsMatchStatus('matched')
          setActiveLyricIndex(-1)
          setLyricsSourceStatus({ kind: 'manual', detail: '', origin: row.source })
          setLyricsOverrideForPath(track.path, row.raw, {
            source: 'manual',
            origin: row.source
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

    // MV 闂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛顐ｆ礀缁犵娀鏌熼幑鎰靛殭閻熸瑱绠撻幃妤呮晲鎼粹€愁潻闂佹悶鍔嶇换鍫ョ嵁閺嶎灔搴敆閳ь剚淇婇懖鈺冩／闁诡垎浣镐划闂佸搫鏈ú妯兼崲濠靛﹦鐤€闁瑰灝鍟崰姗€姊绘担鍝ワ紞缂侇噮鍨拌灋闁告劦鍠氬畵渚€鏌″搴ｄ粓閹兼惌鐓堥弫鍡涙煃瑜滈崜鐔煎箖濮椻偓椤㈡岸鍩€椤掑嫬钃熼柣鏂垮悑鐎电姴顭跨捄鐚存敾婵炲牆顭峰铏规嫚閳ヨ櫕鐏堢紓鍌氱Т閿曘倝鎮鹃悜钘夌畾闂侇叏闄勯瀷闂備礁鎼粙鍕崲濠靛棭娼栭柧蹇氼潐鐎氭岸鏌嶉妷銊︾彧闁诲繐鐗忕槐鎺楀礈瑜戝鎼佹煕濡厧甯剁€规挸瀚板娲捶椤撶儐鏆┑鐘灪閿曘垽鏁愰悙鍝勫窛閻庢稒顭囬崢钘夆攽閳藉棗鐏ｉ柛搴涘€濋獮鍡涘醇閵夛妇鍘藉┑鐘茬仛閸旀洟鎮橀敃鍌涚厸鐎光偓鐎ｎ剛袦闂佽鍠楅悷褔鍩€椤掑倹鏆╃痪顓℃硾鍗遍柛顐犲劜閳锋垶绻涢懠棰濆殭妤犵偞鐗楅妵鍕晝閳ь剙鐣烽鈧畵鍕⒑瑜版帒浜伴柛蹇旓耿瀵劍绂掔€ｎ偆鍘遍梺闈涱槶閸ㄦ椽寮惰ぐ鎺撶厸閻庯綆鍋嗘晶鐢告煙椤旂瓔娈滈柣娑卞櫍瀹曞綊顢欓悡搴經闂傚倷鑳堕幊鎾诲疮閸ф鐓€闁挎繂鎷嬮崵鏇㈡煙缂佹ê鍧婇柡瀣叄閺岀喖宕滆钘熼梺鐟板槻椤嘲顫忓ú顏勫窛濠电姴鍊歌闂備礁鎲￠悷銉╂煀閿濆懐鏆﹂梻鍫熺▓閺嬪酣鏌熼幍铏珒缂併劏顕ч—鍐Χ鎼粹€茶埅闂佸摜濮靛畝绋跨暦濮樿埖鍋嬮柛顐ｇ◥缁ㄨ顪冮妶鍡楀濠殿喗鎸抽幃姗€鍩￠崨顔惧幗闂佹寧绻傚Λ娑氱不閻愮鍋撶憴鍕闁挎洏鍨介妴渚€寮崼婵嗙獩闂佸憡渚楅崰妤€鐣风仦鐐弿濠电姴鍟妵婵堚偓瑙勬磸閸斿秶鎹㈠┑瀣闁挎繂妫楅鐑樼節閻㈤潧校妞ゆ梹鐗犲畷鏉课旈崨顓狅紵闂佽鍎兼慨銈囩不?
    if (
      window.api.searchMVHandler &&
      (configRef.current.enableMV ||
        configRef.current.mvAsBackground ||
        configRef.current.mvAsBackgroundMain)
    ) {
      setIsSearchingMV(true)
      // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾剧粯绻涢幋鏃€鍤嶉柛銉墻閺佸洭鏌曡箛鏇炐ユい锔诲櫍閹鐛崹顔煎濡炪倧瀵岄崹宕囧垝閸儱閱囨繝銏＄箓缂嶅﹪骞冮埄鍐╁劅闁挎繂妫欓崰鏍⒒娴ｅ憡鎯堥柟宄邦儔瀹曟粌顫濈捄铏圭杽闂侀潧顭堥崕鍝勵焽閵娾晜鐓曢柍鈺佸暔娴狅妇绱掗妸銈囩煓婵?await闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔告綇妤ｅ啯顎嶉梺绋垮椤ㄥ懘濡撮幒鎴僵闁挎繂鎳嶆竟鏇熶繆閻愵亜鈧垿宕瑰ú顏呭仭闁冲搫鎳庨弰銉╂煃?MV 闂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛顐ｆ礀缁犵娀鏌熼幑鎰靛殭閻熸瑱绠撻幃妤呮晲鎼粹€愁潻闂佹悶鍔嶇换鍫ョ嵁閺嶎灔搴敆閳ь剚淇婇懖鈺冩／闁诡垎浣镐划闂佸搫鏈ú妯兼崲濞戙垺鍊锋い鎺嶈兌瑜板懘姊绘担鍛婅础闁硅櫕鎹囬幃銉︾附缁嬭儻鎽曢梺鍝勬川閸犳挾绮绘ィ鍐╃厱妞ゎ厽鍨甸弸娑樷攽椤旇姤绀嬫慨濠呮缁瑩宕犻垾鍐差潬闂備浇妗ㄧ粈渚€鈥﹀畡閭﹀殨閻犲洦绁村Σ鍫熶繆椤栫偞鏁遍柣搴☆煼濮婇缚銇愰幒鎴滃枈闂佸憡鎼粻鎾诲春閳ь剚銇勯幒宥堝厡闁活厼鐬肩槐鎺撴綇閵娿儲璇炲Δ鐘靛仜濞差參銆佸Δ浣瑰闁告稑锕︽禍鐑芥⒒閸屾瑦绁版俊妞煎妿缁牊鎷呴搹鍦厠闂佺厧鎽滈弫鎼併€呴悜鑺ョ叆闁哄洨鍋涢埀顒€鎽滅划鍫ュ醇閵忊€虫瀾闁瑰吋鐣崝宀€绮婚悢鍝ョ闁糕剝蓱鐏忎即鏌ｉ幘璺烘灈闁哄矉绲借灒闁告繂瀚鍥⒑閻熸澘鎮戦柛鏃€顨堝Σ鎰板箳閹惧磭绐為柣蹇曞仧閸嬫挸袙閸惊鏃堟偐闂堟稐绮堕梺鍝ュ櫏閸嬪﹪骞冩ィ鍐╁€婚柦妯侯槺閸婄偛顪冮妶搴″箺闁搞劌澧庣槐鐐参旈崨顔规嫽婵炴挻鍩冮崑鎾寸箾娴ｅ啿鎳忓畷鏌ユ煙閻戞ɑ灏伴柛娆忕箻閺岋綁濮€閵忊晝鍔哥紒鐐劤缂嶅﹤顫忓ú顏嶆晢闁逞屽墰缁棃鎮介崨濠備簵濠电偞鍨崹娲偂閺囥垺鐓欏ù鐓庣摠濞懷勵殽閻愭惌娈橀柣銉邯椤㈡﹢鎮欏ù瀣瘱缂傚倷娴囨ご鍝ユ暜濡も偓椤洩绠涘☉妯溾晠鏌曟竟顖氬€归、姗€姊?
      ;(async () => {
        try {
          let foundId = null
          let mvSource = configRef.current.mvSource || 'bilibili'
          const isPackagedFileProtocol =
            typeof window !== 'undefined' && window.location?.protocol === 'file:'

          let mvFromInfoJson = false
          const infoJson = await window.api.readInfoJsonHandler(filePath).catch(() => null)
          if (isStaleRequest()) return
          if (infoJson) {
            if (infoJson.extractor && infoJson.extractor.toLowerCase().includes('youtube')) {
              foundId = infoJson.id
              mvSource = 'youtube'
              mvFromInfoJson = true
            } else if (infoJson.extractor && infoJson.extractor.toLowerCase().includes('bilibili')) {
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
            const searchCacheKey = `${filePath}::${mvSource}::${mvQuery.toLowerCase()}`
            let searchResult = autoMvSearchByTrackRef.current.get(searchCacheKey)
            if (searchResult === undefined) {
              searchResult = await searchMvWithCache(mvQuery, mvSource)
              autoMvSearchByTrackRef.current.set(searchCacheKey, searchResult || null)
            }
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
            setMvId((prev) =>
              prev?.id === foundId && prev?.source === mvSource ? prev : { id: foundId, source: mvSource }
            )
            setMvOverrideForPath(filePath, { id: foundId, source: mvSource })
          } else if (!isStaleRequest()) {
            setMvId(null)
            setBiliDirectStream(null)
            setMvPlaybackQuality(null)
          }
        } catch (e) {
          console.error('MV search error', e)
        } finally {
          setIsSearchingMV(false)
        }
      })()
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

    // 1.5 Try embedded metadata lyrics before touching disk or network.
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

    // 2. Try local LRC briefly, then let online search continue.
    try {
      const expectSidecarLyrics = hints?.hasLyrics === true
      const localReadAttempts = expectSidecarLyrics ? 2 : 1
      const localRetryDelayMs = expectSidecarLyrics ? 80 : 0

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

    const lyricsSource = configRef.current.lyricsSource || 'lrclib'
    const useOnlineLyrics =
      lyricsSource !== 'local' && ['lrclib', 'netease', 'qq', 'kugou', 'kuwo'].includes(lyricsSource)

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
            rawTitle: title,
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
          /** 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈閸ㄥ倿鏌涢锝嗙缂佺姳鍗抽弻娑樷攽閸曨偄濮㈤梺娲诲幗閹搁箖鍩€椤掑喚娼愭繛鍙夌墪鐓ら柨鏇炲亰缂?duration闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔兼倻濡櫣鍔稿┑鐐茬毞閺呯娀寮婚弴鐔虹闁绘劦鍓氶悵鏇㈡⒑缁嬪尅鍔熼柛蹇旓耿瀵鏁撻悩鑼€為梺闈涱槶閸庤櫕绂掓總鍛娾拺闁兼祴鏅╅悞鍓х磽瀹ュ拑韬€殿喛顕ч埥澶娢熼柨瀣偓濠氭⒑鐟欏嫬顥嬮柡浣规倐瀹曟繈鎮滈懞銉㈡嫼?LRCLIB 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弴姘舵濞存粌缍婇弻娑㈠箛闂堟稒鐏嶉梺鎼炲€栭崝鏍Φ閸曨垰鍐€闁靛ě鍛帒闂備礁鎼Λ娆戝垝瀹ュ桅闁告洦鍨扮粻娑㈡煕椤愶絾绀冩い搴＄Ч濮婅櫣绮欏▎鎯у壈濡炪倖鍨甸ˇ闈涱嚕鐠囨祴妲堥柕蹇婃櫆閺呮繈姊洪棃娑氬闁瑰啿绻橀幃妤呭箚瑜滃〒濠氭煏閸ヨ泛鐏熺紒鈧担璇ユ椽鏁冮崒姘卞幈闂佸湱鍎ら〃鍡涙偂閸愵亝鍠愭繝濠傜墕缁€鍫熸叏濮楀棗澧婚柛銈嗩殜閺屾盯寮撮妸銉т哗婵炵鍋愭繛鈧柡灞炬礃缁旂喖顢涘顒変患闂佸搫顑嗛幐鑽ゆ崲濠靛鍋ㄩ梻鍫熺◥濞岊亪姊洪幖鐐插闁绘牕銈搁悰顕€骞囬弶璺啋濡炪倖妫侀崑鎰版晬濞戙垺鈷戦柣鐔告緲閳锋梻绱掗鍛仸闁诡噯绻濋幃鈺冨枈濡桨澹曢梺鑽ゅ枑濠㈡﹢顢旈鍕电唵闁荤喓澧楅ˉ銏☆殽閻愭惌娈滈柟顔规櫊瀹曟宕ㄩ婊呮毎?get 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰▕閻掕姤绻涢崱妯诲碍閻熸瑱绠撻幃妤呮晲鎼存繃鍠氬┑鐐茬毞閺呯娀寮婚弴鐔虹闁割煈鍠栨竟鍕攽閻愬弶鈻曞ù婊勭矒閺屻劑濡堕崱鏇犵畾闂侀潧鐗嗛崐鍛婄閸撗呯＝濞达絽鎼牎婵犵數鍋涢敃顏勵嚕婵犳艾鍗抽柣鏃囨瑜版儳顪冮妶鍡欏妞ゃ劌鎳忕粋宥嗐偅閸愨斁鎷?*/
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

        const waitForFirstLyricsHit = (attempts) =>
          new Promise((resolve) => {
            let pending = attempts.length
            if (pending === 0) {
              resolve(false)
              return
            }
            attempts.forEach((attempt) => {
              attempt
                .then((hit) => {
                  if (hit) {
                    resolve(true)
                    return
                  }
                  pending -= 1
                  if (pending === 0) resolve(false)
                })
                .catch(() => {
                  pending -= 1
                  if (pending === 0) resolve(false)
                })
            })
          })

        const runLrcLibAttempts = async () => {
          for (const cleanedTitle of titleVariants) {
            const parenHints = [
              ...new Set([...globalParenHints, ...extractParenArtistHints(cleanedTitle)])
            ]

            // 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弴鐐测偓鍫曞焵椤掆偓閸熷磭绮诲☉妯锋婵☆垳鈷堝Σ顖涚節閻㈤潧浠﹂柛銊ㄦ硾椤繈濡搁埡浣侯攨濠殿喗顭堥崺鏍偂濞戞﹩鐔嗛悹杞拌閸庡繘鏌ｈ箛鎾缎ч柡宀嬬磿閳ь剨缍嗛崑鍡樻櫠椤掑嫭鐓忛柛銉戝喚浼冨銈冨灪濞茬喖銆侀弴銏狀潊闁挎稑瀚竟鏇犵磽閸屾艾鈧兘鎮為敃鍌氱闁哄稁鍘归埀顒€鍊诲濠傘€?+ search 婵犵數濮撮惀澶愬级鎼存挸浜炬俊銈勭劍閸欏繘鏌ｉ幋锝嗩棄缁炬儳顭烽弻锝夊箛椤掍焦鍎撶紒鐐劤閻忔繈鍩為幋锕€纾兼繛鎴炵懃娴犫晠姊洪柅鐐茶嫰閸樺摜绱掗懜闈涘摵闁绘侗鍠氶埀顒婄秵閸犳寮插┑瀣厓鐟滄粓宕滈悢鐓庣畾閻忕偠濞囬弮鍫濆窛妞ゆ梹鍎抽獮宥夋⒑鐠囨彃顒㈢紒瀣浮閳ワ箓宕堕埡鍐х瑝闂佽鍎抽悺銊╁矗韫囨稒鐓ユ繝闈涙婵吋淇婇妤€浜鹃梻鍌欑閹碱偆鎮锕€绀夌€光偓閸曨偆鍙€婵犮垼娉涜癌闁绘柨鍚嬮崵鍐煃鏉炴壆顦︾悮銊╂⒒閸屾艾鈧兘鎮為敃鍌涘剳鐟滅増甯掔粈澶屸偓骞垮劚濞诧箑鐣烽弻銉︾厱妞ゆ劧绲跨粻姗€鏌￠崱顓㈡濞ｅ洤锕俊鍫曞川椤斿吋顏犻梻鍌欑瀹曨剙煤閿旂偓宕叉繝闈涱儐椤ュ牊绻涢幋鐐垫噭闁诡喗鐟ラ埞鎴︽倷閼碱剙顣堕梺绋挎唉鐏忔瑩骞戦姀鐘闁靛繒濮烽娲⒑缂佹ê濮囬柣掳鍔戝畷鏇熸償閵婏腹鎷洪梺鍛婄☉閿曪箓骞夐崸妤佺厱閻庯綆鍋呭畷灞炬叏婵犲倹鎯堥弫鍫ユ煕閵夋垵鍠氶悗瀵哥磽閸屾瑦绁版い鏇嗗洦鍋嬮柟鎹愬吹瀹?
            // get 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈠Χ閸屾矮澹曞┑顔矫畷顒勫储鐎电硶鍋撶憴鍕闁硅櫕鎹囬幃楣冩倻閽樺鍊炲銈呯箰鐎氬懘鏁撻悩宕囧幗闂佺粯锚閸樻牠鎳滈鍫熺厱闁哄倽娉曟晥閻庤娲橀〃鍛粹€﹂妸鈺佺闁宠　鍋撶紒銊ヮ煼濮婃椽宕崟顐ｆ闂佺锕ら幗婊堝极椤曗偓瀹曞ジ寮撮悢鍝勫箺闂備礁鎼粙渚€宕㈠ú顏勭疅闁绘劦鍓氶崣蹇撯攽閻樻彃鏆為柕鍥ㄧ箘閳ь剚顔栭崰鏍ㄦ櫠鎼淬劌绠查柛鏇ㄥ灠鎯熼梺闈涢獜缁辨洟鍩€椤掆偓閹芥粎妲愰幘璇茬＜婵炲棙鍔楅妶鐗堜繆閻愬瓨缍戦柟鑺ョ矒閸┾偓妞ゆ帊娴囨竟姗€鏌嶉妷顔藉巶rch 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈠Χ閸屾矮澹曞┑顔矫畷顒勫储鐎电硶鍋撶憴鍕妞ゎ偄顦…鍥疀濞戣鲸鏅濋梺闈涚箚閸撴繈顢欐径宀€纾介柛灞捐壘閳ь剚鎮傚畷鎰槹鎼淬埄鍋ㄩ梺璺ㄥ枔婵挳宕归崒姣綊鎮℃惔锝嗘喖闂佸搫鎳忕换鍫ュ蓟閺囥垹閱囨繝闈涙川閻撴垿姊虹紒妯虹瑨闁挎洏鍎垫俊鐢稿礋椤栨艾宓嗗┑掳鍊愰崑鎾趁瑰鍫㈢暫婵﹥妞藉畷顐﹀礋椤旂⒈浼冮梻浣瑰濞插繘宕愬┑瀣ㄢ偓浣割潨閳ь剟骞婂┑瀣妞ゆ梻鍋撳鎴︽⒒娴ｅ憡鎯堟繛灞傚妽閸掑﹪顢橀悙宥忕到閻ｏ繝骞嶉搹顐ｆ澑闂備胶绮崝鏍ь焽濞嗘挻鍊堕柨鏇炲€归悡娆戠磼鐎ｎ厽纭堕柛鈺嬬悼閳ь剝顫夊ú姗€宕濋弴銏犵叀濠㈣埖鍔曢～鍛存煟濮椻偓濞佳勬叏閿旀垝绻嗛柣鎰典簻閳ь剚鐗曢蹇旂節濮橆剛锛涢梺鐟板⒔缁垶鎮″▎鎾寸厱闁归偊鍘鹃崣鈧梺鍛婄懃鐎氼參銆冮妷鈺傚€烽柟缁樺笚濞堣螖閻橀潧浠︽い顓炴喘楠炲繘鎮╃紒妯烘濡炪倖甯掗崐鍦礊娓氣偓濮婂宕掑▎鎰偘濡炪倖娲橀悧鐘茬暦鐟欏嫭缍囬柕濞у懎楠勯梻浣虹《閸撴繄绮欓幒妤€纾绘慨妞诲亾闁哄瞼鍠栭獮鍡氼槾闁圭晫濞€閺屾稑鈻庤箛鏇狀啋闂佸搫琚崝宀勫煘閹达箑骞㈡慨妤€妫欓敍渚€姊绘担铏瑰笡闁圭⒈鍋嗙槐鐐寸瑹閳ь剟鐛崘顔藉€婚柦妯侯槸瀹撳棝姊虹紒妯哄闁诡垰鑻灋闁靛牆顦伴埛鎴︽偣閸ワ絺鍋撻搹顐や憾濠电姰鍨婚幊鎾澄涘▎鎴犵焿闁圭儤顨嗛弲婵嬫煕鐏炲墽鈽夋繛鍫㈠枛濮婃椽妫冨☉杈ㄐら梺绋挎唉鐏忔瑧鍒掗鐔稿劅闁抽敮鍋撻柡鈧禒瀣厽闁归偊鍘界紞鎴︽煟韫囥儳鐣甸柡宀€鍠栧畷銊︾節閸愩劌鏀柣搴ゎ潐濞叉﹢宕归崸妤冨祦婵☆垵鍋愮壕鍏间繆椤栨粌甯舵?
            const firstArtist =
              parenHints[0] ||
              (coverArtistRaw !== 'Unknown Artist' ? coverArtistRaw : '') ||
              coverArtistClean ||
              ''
            const firstSearchQ = firstArtist
              ? `${cleanedTitle} ${firstArtist}`.trim()
              : cleanedTitle

            const firstWaveHit = await waitForFirstLyricsHit([
              tryGet(cleanedTitle, firstArtist),
              trySearch(firstSearchQ)
            ])
            if (firstWaveHit) return true
            if (isStaleRequest()) return false

            // 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弴鐐测偓鍫曞焵椤掆偓閸熷磭绮诲☉妯锋婵☆垳鈷堝Σ顖涚節閻㈤潧浠﹂柛銊ㄥ煐缁岄亶鎮滃Ο璇插伎闂佽鍎兼慨銈夋偂閸愵喖绾ч柣鎰綑椤庢粍銇勯弬娆炬█闁哄矉绱曢埀顒婄秵閸嬪棙鏅堕鍕厪闁搞儜鍐句純濡炪們鍨哄ú鐔笺€侀弴銏狀潊闁挎稑瀚竟鏇犵磽閸屾艾鈧兘鎮為敃鍌氱闁哄稁鍘归埀顒€鍟换婵嬪炊瑜戦幗鏇炩攽閻愭潙鐏︾紒顔奸叄閹潡鍩€椤掑嫭鈷戦柛婵嗗閺嗗﹪鏌涚€ｎ偅宕岄柡宀嬬磿閳ь剨缍嗘禍婊堫敂椤愩倗纾?get 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偛顦甸弫鎾绘偐閸愯弓鐢婚梻浣瑰濮婂宕戦幘鍓佷笉闁圭儤姊荤壕浠嬫煕鐏炴崘澹橀柍褜鍓欓幗婊呭垝閺冨牆绠绘い鏇炴噺閺呯偤姊虹化鏇炲⒉闁荤啙鍥ㄥ剹婵炲棗娴氶悢鍡涙煠閹间焦娑у┑顔肩墦閺屾盯濡堕崱妤冧淮闁捐崵鍋ら弻锝呂旈埀顒勬偋韫囨洜涓嶉柡宥庡幗閻撴盯鏌涚仦缁㈡當濞存粓绠栧濠氬磼濮橆兘鍋撻悜鑺ュ€块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔告綇妤ｅ啯顎嶉梺绋款儏椤戝寮诲☉銏犵労闁告劦浜栧Σ鍫㈢磽娴ｆ彃浜鹃梺鍛婃处閸ㄩ亶鎮￠妷鈺傜厽闁哄倹瀵ч幆鍫⑩偓娑欑箞閺岋絾鎯旈姀锝咁棟濡炪倧瀵岄崹鍫曞灳閿旂偓宕夐柕濠忕畱绾绢垶姊洪幆褏绠版繝鈧潏銊ヮ嚤闁搞儯鍔庣弧鈧梺闈涢獜缁插墽娑垫ィ鍐╁€垫慨姗嗗亜瀹撳棙顨ラ悙鎻掓殭閾绘牠鏌嶈閸撶喖宕洪妷锕€绶炲┑鐐靛亾閻庤鈹戦悙鍙夘棞缂佺粯鍔橀妵鎰板幢濞嗘垹锛濋梺绋挎湰閻燂妇绮婇弶娆炬富闁哄鍨堕幉鎼佹煙楠炲灝鐏茬€规洖銈告俊鐑藉Ψ閵婏附鍟洪梻鍌欑閹测剝绗熷Δ鍛煑閹肩补妲呴悞浠嬫煃閸濆嫬鈧埖绂嶅鍫熺厵闁绘垶锚閻忋儵鏌嶈閸撴岸骞冮崒鐐茬畺闁跨喓濮寸粻锝夋煥閺冨洦顥夐柍褜鍓涢弫濠氬蓟濞戔懇鈧箓骞嬪┑鍛嚬缂傚倷娴囬崺鏍偂閿熺姴钃熼柨婵嗘啒閺冨牆鐒垫い鎺嗗亾閾荤偞绻濋棃娑卞剳鐎规挷绶氶弻鐔煎箲閹伴潧娈梺缁樻尰閻╊垶寮诲☉妯锋闁告鍋為悘宥呪攽?
            for (const hint of parenHints.slice(1)) {
              if (await tryGet(cleanedTitle, hint)) return true
            }
            if (coverArtistRaw && coverArtistRaw !== 'Unknown Artist' && coverArtistRaw !== firstArtist) {
              if (await tryGet(cleanedTitle, coverArtistRaw)) return true
            }
            if (coverArtistClean && coverArtistClean !== coverArtistRaw && coverArtistClean !== firstArtist) {
              if (await tryGet(cleanedTitle, coverArtistClean)) return true
            }
            if (await tryGet(cleanedTitle, '')) return true

            // 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弴鐐测偓鍫曞焵椤掆偓閸熷磭绮诲☉妯锋婵☆垳鈷堝Σ顖涚節閻㈤潧浠﹂柛銊ㄦ硾椤繈濡歌娑撳秹鏌￠崒娑崇穿鐟滅増甯楅弲鏌ユ煕閵夈垺鏉洪柍褜鍓欓敃顏堝蓟閿涘嫧鍋撻敐搴′簽濠⒀屽墴閺屾洟宕惰椤忣厽銇勯姀鈩冪妞ゃ垺娲熸慨鈧柨娑樺婢规洜绱撻崒姘偓鐑芥倿閿曞倸绀夐柡宥庡幑閳ь剙鍟换婵嬪炊瑜戦幗鏇㈡⒑鐠恒劌鏋斿┑顔芥尦閹瑦绻濋崶銊у帾婵犵數濮寸换鎰般€呴鍌滅＜閻庯綆浜濋幖鎰亜?search 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偛顦甸弫鎾绘偐閸愯弓鐢婚梻浣瑰濮婂宕戦幘鍓佷笉闁圭儤姊荤壕?
            for (const hint of parenHints.slice(1)) {
              if (await trySearch(`${cleanedTitle} ${hint}`.trim())) return true
            }
            if (coverArtistRaw && coverArtistRaw !== 'Unknown Artist') {
              if (await trySearch(`${cleanedTitle} ${coverArtistRaw}`.trim())) return true
            }
            if (coverArtistClean && coverArtistClean !== firstSearchQ) {
              if (await trySearch(`${cleanedTitle} ${coverArtistClean}`.trim())) return true
            }
            if ((cleanedTitle || '').length <= 4 && albumName) {
              if (coverArtistClean) {
                if (await trySearch(`${cleanedTitle} ${coverArtistClean} ${albumName}`.trim())) return true
              }
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
              rawKeywords: title,
              durationSec: audioDur
            })
            if (isStaleRequest()) return true
            if (res?.ok && res.lrc) {
              if (typeof res.confidence === 'number' && res.confidence < 30) {
                console.log(`[Lyrics NetEase] rejected low confidence (${res.confidence}) for "${k}"`)
                continue
              }
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

        const tryExternalVariants = async (sources = ['qq', 'kugou', 'kuwo']) => {
          if (!window.api?.searchExternalLyrics) return false
          const triedKw = new Set()
          const queries = []
          for (const tv of titleVariants) {
            if (coverArtistClean) queries.push(`${tv} ${coverArtistClean}`)
            for (const hint of globalParenHints) queries.push(`${tv} ${hint}`.trim())
            if (
              coverArtistRaw &&
              coverArtistRaw !== 'Unknown Artist' &&
              coverArtistRaw !== coverArtistClean
            ) {
              queries.push(`${tv} ${coverArtistRaw}`.trim())
            }
            queries.push(tv)
          }
          for (const kw of queries) {
            const k = (kw || '').trim()
            if (!k || triedKw.has(k)) continue
            triedKw.add(k)
            const res = await window.api.searchExternalLyrics({
              keywords: k,
              durationSec: audioDur,
              sources
            })
            if (isStaleRequest()) return true
            const items = Array.isArray(res?.items) ? res.items : []
            const ranked = rankLrcLibCandidates(items, audioDur, {
              titleCandidates: titleVariants,
              rawTitle: title,
              artistCandidates: [...globalParenHints, coverArtistClean, coverArtistRaw].filter(
                Boolean
              )
            })
            const hit = ranked.find((r) => r?.chosenLyrics && r.score >= 25) || ranked[0]
            const raw = hit?.chosenLyrics || hit?.item?.syncedLyrics || hit?.item?.plainLyrics || ''
            if (!raw) continue
            const parsed = parseAnyLyrics(raw)
            if (parsed.length >= 3) {
              const source = hit?.item?.source || sources[0] || 'external'
              if (
                applyLyricsResult(parsed, 'matched', {
                  kind: source,
                  detail: '',
                  origin: ''
                })
              )
                return true
              setLyricsOverrideForPath(filePath, raw, {
                source,
                origin: ''
              })
              return true
            }
          }
          return false
        }

        if (lyricsSource === 'netease') {
          // User chose NetEase -try it first since it's better for CJK metadata,
          // then fall back to LRCLIB for Western songs NetEase may not have.
          if (await tryNeteaseVariants()) return
          if (await runLrcLibAttempts()) return
          if (await tryExternalVariants()) return
        } else if (lyricsSource === 'qq') {
          if (await tryExternalVariants(['qq', 'kugou', 'kuwo'])) return
          if (await runLrcLibAttempts()) return
          if (await tryNeteaseVariants()) return
        } else if (lyricsSource === 'kugou' || lyricsSource === 'kuwo') {
          if (await tryExternalVariants([lyricsSource])) return
          if (await runLrcLibAttempts()) return
          if (await tryNeteaseVariants()) return
        } else {
          // Default (lrclib) -LRCLIB first, NetEase as fallback.
          if (await runLrcLibAttempts()) return
          if (await tryNeteaseVariants()) return
          if (await tryExternalVariants()) return
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

  const loadTrackData = async (filePath, trackHints = {}) => {
    const requestSeq = trackLoadSeqRef.current + 1
    trackLoadSeqRef.current = requestSeq
    cloudCoverFetchSeqRef.current += 1
    coverFailureFetchKeyRef.current = ''
    setCoverUrlTrackPath(filePath)
    setCoverUrl(null)
    setFailedDisplayCoverUrl(null)
    setShareCardSnapshot(null)
    setMetadata({
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      trackNo: null,
      discNo: null
    })
    // 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗ù锝夋交閼板潡寮堕崼姘珔闁搞劍绻冮妵鍕冀椤愵澀绮剁紓浣插亾濠㈣埖鍔栭悡娑㈡煕閵夈垺娅呴柡瀣灦缁绘盯宕ㄩ姘ｆ瀰闂佸搫鐭夌徊鍊熺亽濠电偛妫欓崕鍐测枔椤撶姷纾藉ù锝呮惈椤庡矂鏌涢悩宕囧⒌闁糕晝鍋ら獮瀣晜閽樺姹楅梻浣告贡缁垳鏁Δ鈧埢鎾诲醇閺囩啿鎷虹紒缁㈠幖閹冲繘藟婢舵劖鐓曢柣鏂挎啞鐏忥附顨ラ悙鎻掓殺闁靛洦鍔欓獮鎺楀箣閻樻祴鍋撻悙鐑樺仭婵犲﹤鍟扮粻娲煕婵犲啯缍戦柍瑙勫灴閹晠骞囨担鍛婃珱闂備礁鎽滄慨鐢搞€冩繝鍥╁祦闁告劦鍠栫壕濂告煟閹扮増娑х紒渚婄畵濮婃椽鏌呴悙鑼跺濠⒀屽櫍濡焦寰勯幇顓犲弳濠电娀娼уΛ娆戠矈閳哄懏鐓熼柟鐑橆殘閻ｆ椽鏌″畝瀣ɑ闁诡垱姊归獮濠囨煕鐎ｃ劌鐏查柡?loading闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔告綇妤ｅ啯顎嶉梺绋垮椤ㄥ﹪寮诲☉姘勃闁告挆鈧Σ鍫濐渻閵堝棙绀嬪ù婊冪埣瀵顓兼径濠佺炊闂佸憡娲﹂崜娆忊枍閿濆洨纾藉ù锝嗗絻娴?metadata 闂傚倸鍊搁崐宄懊归崶褏鏆﹂柛顭戝亝閸欏繘鏌℃径瀣婵炲樊浜滈悡娑㈡煕濠娾偓閻掞箓寮查鍫熷仭婵犲﹤瀚悘鏉戔攽閿涘嫭鏆鐐叉喘瀵墎鎹勯妸銉㈠亾閻愬樊娓婚柕鍫濇閸у﹪鏌涚€ｎ偅宕岄柟顔筋殔椤繈顢楁径瀣ф瀰闂備礁鎼惌澶岀礊娴ｅ壊鍤曟い鎺戝閸ㄥ倹銇勯弮鍥棄闁逞屽墻閸ㄨ泛顫忓ú顏勭閹艰揪绲婚埀顒佸浮閺屾盯鎮╁畷鍥р拰閻庢鍠栭…鐑藉极閹剧粯鍋愰柤纰卞墻濡茶淇婇悙顏勨偓鏍礉韫囨稑绠犻柛銉墮缁犱即鏌涢幇闈涙灍闁抽攱鍨垮濠氬醇閻旇　濮囨繝銏ｆ硾鐎氼噣鎯€椤忓牆绾ч悹鎭掑壉閵堝洨纾兼い鏃傛櫕閹冲嫮鈧灚婢樼€氼噣鍩€椤掑﹦绉甸柛鎾寸洴閹線宕奸悢铏诡啎闁哄鐗嗘晶鐣屸偓闈涖偢閹綊鍩€椤掑嫭鏅滈柦妯侯樈閸ゃ倝姊洪幖鐐插姌闁告柨顑囬幑銏ゅ幢濡晲绨婚梺閫涘嵆濞佳勬櫠閹殿喚纾奸悗锝庝憾閻撳ジ鏌″畝瀣埌閾绘牕銆掑顒佸闁汇倓绶氬铏规嫚閳ヨ櫕鐏嶅┑锛勫仩濡嫰顢氶敐澶婄妞ゆ梻鈷堝濠囨⒑閻愯棄鍔氶柛鐔稿缁旂喖宕熼娑掓嫽婵炶揪绲介幉锟犲疮閻愬绠鹃悹鍥囧懐鏆ら悗瑙勬礃缁矂鍩ユ径鎰潊闁绘ê鐤囩欢銏＄節閻㈤潧浠滄俊顐ｇ懇楠炴劖绻濆顓炰簵闂佺粯鏌ㄩ崥瀣偂閵夛妇绡€闂傚牊绋掗ˉ鐐淬亜閵壯冣枅闁哄瞼鍠栧畷姗€宕ｆ径濠冾仩闂備礁鐤囬～澶愬垂閸фぜ鈧礁鈻庨幘鏉戞疅闂侀潧顦崕顕€宕戦幘璇茬疀妞ゆ挆鍕靛晬闂備胶绮崝蹇涘疾濞戞瑧顩?
    setLyrics([])
    setActiveLyricIndex(-1)
    setLyricsMatchStatus('loading')
    setLyricsSourceStatus({ kind: 'loading', detail: '', origin: '' })
    setTechnicalInfo({
      sampleRate: null,
      originalBpm: null,
      channels: null,
      bitrate: null,
      bitDepth: null,
      isMqa: false,
      codec: null
    })
    setBpmDetectionState('idle')

    const detectMeasuredBpm = async (baseMeta = {}) => {
      if (baseMeta?.bpmMeasured && Number(baseMeta.bpm) > 0) {
        setBpmDetectionState('done')
        return
      }
      if (!window.api?.detectBpmHandler) {
        setBpmDetectionState('unavailable')
        return
      }

      try {
        setBpmDetectionState('detecting')
        const result = await window.api.detectBpmHandler(filePath)
        if (trackLoadSeqRef.current !== requestSeq) return
        const bpm = Number(result?.bpm)
        if (!result?.success || !Number.isFinite(bpm) || bpm <= 0) {
          setBpmDetectionState('failed')
          writeTrackMetaCache({
            [filePath]: {
              ...baseMeta,
              bpm: null,
              bpmChecked: true,
              bpmMeasured: false
            }
          })
          return
        }

        const measuredBpm = Math.round(bpm)
        const measuredEntry = {
          ...baseMeta,
          bpm: measuredBpm,
          bpmChecked: true,
          bpmMeasured: true
        }

        setTechnicalInfo((prev) => ({
          ...prev,
          originalBpm: measuredBpm
        }))
        setBpmDetectionState('done')
        setTrackMetaMap((prev) => ({
          ...prev,
          [filePath]: {
            ...(prev[filePath] || {}),
            ...measuredEntry
          }
        }))
        writeTrackMetaCache({ [filePath]: measuredEntry })
      } catch {
        setBpmDetectionState('failed')
        /* BPM detection is best-effort. */
      }
    }

    try {
      const cachedMeta = (await readTrackMetaCache([filePath]))[filePath]
      if (trackLoadSeqRef.current !== requestSeq) return

      if (cachedMeta?.coverChecked && cachedMeta?.bpmChecked && cachedMeta?.mqaChecked) {
        const fallbackFromTitle = parseArtistTitleFromName(cachedMeta.title || '')
        const resolvedTitle = fallbackFromTitle?.title || cachedMeta.title || stripExtension(filePath.split(/[\\/]/).pop() || '')
        const resolvedArtist =
          (cachedMeta.artist && cachedMeta.artist !== 'Unknown Artist' ? cachedMeta.artist : null) ||
          cachedMeta.albumArtist ||
          fallbackFromTitle?.artist ||
          'Unknown Artist'

        setMetadata({
          title: resolvedTitle,
          artist: resolvedArtist,
          album: cachedMeta.album || '',
          albumArtist: cachedMeta.albumArtist || '',
          trackNo: cachedMeta.trackNo ?? null,
          discNo: cachedMeta.discNo ?? null
        })
        setTechnicalInfo((prev) => ({
          ...prev,
          sampleRate: cachedMeta.sampleRateHz || null,
          bitrate: cachedMeta.bitrateKbps ? cachedMeta.bitrateKbps * 1000 : null,
          channels: cachedMeta.channels || null,
          bitDepth: cachedMeta.bitDepth || null,
          isMqa: cachedMeta.isMqa === true,
          codec: cachedMeta.codec || null,
          originalBpm: cachedMeta.bpmMeasured ? cachedMeta.bpm || null : null
        }))
        if (typeof cachedMeta.duration === 'number' && cachedMeta.duration > 0) {
          setDuration(cachedMeta.duration)
        }
        if (cachedMeta.cover) {
          setCoverUrl(cachedMeta.cover)
        } else {
          fetchCloudCover(resolvedTitle, resolvedArtist, requestSeq, { album: cachedMeta.album || '' })
        }
        fetchLyrics(filePath, resolvedTitle, resolvedArtist, {
          album: cachedMeta.album || '',
          embeddedLyrics: cachedMeta.lyrics || '',
          hasLyrics: trackHints.hasLyrics === true,
          mvOriginUrl: trackHints.mvOriginUrl
        })
        detectMeasuredBpm(cachedMeta)
      } else {
        // 1. Get Extended Metadata from Main Process (Music-Metadata)
        const data = await window.api.getExtendedMetadataHandler(filePath)
        if (trackLoadSeqRef.current !== requestSeq) return

        if (data.success) {
        const { technical, common } = data
        const fallbackFromTitle = parseArtistTitleFromName(common.title || cachedMeta?.title || '')
        const resolvedTitle = fallbackFromTitle?.title || common.title || cachedMeta?.title
        const resolvedArtist =
          (common.artist && common.artist !== 'Unknown Artist' ? common.artist : null) ||
          common.albumArtist ||
          (cachedMeta?.artist && cachedMeta.artist !== 'Unknown Artist' ? cachedMeta.artist : null) ||
          cachedMeta?.albumArtist ||
          fallbackFromTitle?.artist ||
          'Unknown Artist'
        const resolvedAlbum = common.album || cachedMeta?.album || ''
        const resolvedAlbumArtist = common.albumArtist || cachedMeta?.albumArtist || ''
        const resolvedCover = common.cover || cachedMeta?.cover || null
        const resolvedLyrics = common.lyrics || cachedMeta?.lyrics || null

        setMetadata({
          title: resolvedTitle,
          artist: resolvedArtist,
          album: resolvedAlbum,
          albumArtist: resolvedAlbumArtist,
          trackNo: common.trackNo ?? null,
          discNo: common.discNo ?? null
        })
        setTechnicalInfo((prev) => ({
          ...prev,
          sampleRate: technical.sampleRate,
          bitrate: technical.bitrate,
          channels: technical.channels,
          bitDepth: technical.bitDepth,
          isMqa: technical.isMqa === true,
          codec: technical.codec,
          originalBpm: null
        }))

        // DSD / native HiFi: <audio> duration is unreliable (browser does not decode DSD correctly).
        if (
          typeof technical.duration === 'number' &&
          technical.duration > 0 &&
          (useNativeEngineRef.current || /\.(dsf|dff)$/i.test(filePath))
        ) {
          setDuration(technical.duration)
        }

        if (resolvedCover) {
          setCoverUrl(resolvedCover)
        } else {
          fetchCloudCover(resolvedTitle, resolvedArtist, requestSeq, { album: resolvedAlbum })
        }

        fetchLyrics(filePath, resolvedTitle, resolvedArtist, {
          album: resolvedAlbum,
          embeddedLyrics: resolvedLyrics || '',
          hasLyrics: trackHints.hasLyrics === true,
          mvOriginUrl: trackHints.mvOriginUrl
        })
        const parsedMetaEntry = {
          title: resolvedTitle || null,
          artist: resolvedArtist || null,
          album: resolvedAlbum || null,
          albumArtist: resolvedAlbumArtist || null,
          trackNo: common.trackNo ?? null,
          discNo: common.discNo ?? null,
          cover: resolvedCover,
          duration: technical.duration || null,
          coverChecked: true,
          bpmChecked: true,
          bpmMeasured: false,
          mqaChecked: true,
          codec: technical.codec || null,
          bitrateKbps: technical.bitrate ? Math.round(technical.bitrate / 1000) : null,
          sampleRateHz: technical.sampleRate || null,
          bitDepth: technical.bitDepth || null,
          channels: technical.channels || null,
          isMqa: technical.isMqa === true,
          bpm: null,
          lyrics: resolvedLyrics
        }
        writeTrackMetaCache({ [filePath]: parsedMetaEntry })
        detectMeasuredBpm(parsedMetaEntry)
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
        fetchCloudCover(resolvedTitle, resolvedArtist, requestSeq)
        fetchLyrics(filePath, resolvedTitle, resolvedArtist, {
          hasLyrics: trackHints.hasLyrics === true,
          mvOriginUrl: trackHints.mvOriginUrl
        })
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
      if (!draft?.path || !window.api?.writeTags) return

      const activeTrack = playlistRef.current[currentIndexRef.current] || null
      const isEditingActiveTrack = activeTrack?.path === draft.path
      const wasPlayingBeforeSave = isEditingActiveTrack ? !!isPlaying : false
      const savedPlaybackTime = isEditingActiveTrack
        ? Math.max(
            0,
            Number(
              useNativeEngineRef.current
                ? currentTimeRef.current
                : audioRef.current?.currentTime ?? currentTimeRef.current
            ) || 0
          )
        : 0

      if (isEditingActiveTrack) {
        try {
          if (useNativeEngineRef.current && window.api?.stopAudio) {
            await window.api.stopAudio()
          }
        } catch {
          /* best effort release */
        }

        try {
          if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current.removeAttribute('src')
            audioRef.current.src = ''
            audioRef.current.load()
          }
        } catch {
          /* best effort release */
        }

        await wait(120)
      }

      const response = await window.api.writeTags(
        draft.path,
        {
          title: draft.title,
          artist: draft.artist,
          albumArtist: draft.albumArtist,
          album: draft.album,
          trackNumber: draft.trackNo,
          year: draft.year,
          genre: draft.genre
        },
        draft.coverPath || null
      )
      if (!response?.ok) {
        throw new Error(response?.error || t('metadataEditor.saveFailed', 'Failed to save tags'))
      }

      const title = String(draft.title || '').trim()
      const artist = String(draft.artist || '').trim()
      const album = String(draft.album || '').trim()
      const albumArtist = String(draft.albumArtist || '').trim()
      const genre = String(draft.genre || '').trim()
      const trackNo = Number.parseInt(String(draft.trackNo || ''), 10)
      const year = Number.parseInt(String(draft.year || ''), 10)
      const nextMetaEntry = {
        title: title || null,
        artist: artist || null,
        album: album || null,
        albumArtist: albumArtist || null,
        trackNo: Number.isFinite(trackNo) && trackNo > 0 ? trackNo : null,
        year: Number.isFinite(year) && year > 0 ? year : null,
        genre: genre || null,
        cover: draft.cover || null,
        coverChecked: true
      }

      setTrackMetaMap((prev) => ({
        ...prev,
        [draft.path]: nextMetaEntry
      }))
      writeTrackMetaCache({ [draft.path]: nextMetaEntry })

      setPlaylist((prev) =>
        prev.map((item) =>
          item?.path === draft.path
            ? {
                ...item,
                info: {
                  ...(item.info || {}),
                  ...(title ? { title } : {}),
                  ...(artist ? { artist } : {}),
                  ...(album ? { album } : {})
                }
              }
            : item
        )
      )

      if (activeTrack?.path === draft.path) {
        setMetadata({
          title,
          artist,
          album,
          albumArtist,
          trackNo: Number.isFinite(trackNo) && trackNo > 0 ? trackNo : null,
          discNo: null
        })
        if (draft.cover) {
          setCoverUrlTrackPath(draft.path)
          setCoverUrl(draft.cover)
        }

        try {
          if (audioRef.current) {
            audioRef.current.src = localPathToAudioSrc(draft.path)
            audioRef.current.load()
            applyStartTimeToAudio(audioRef.current, savedPlaybackTime)
          }

          if (useNativeEngineRef.current && window.api?.playAudio) {
            if (wasPlayingBeforeSave) {
              audioRef.current?.play?.().catch(() => {})
              await window.api.playAudio(draft.path, savedPlaybackTime, playbackRateRef.current)
            } else {
              await window.api.pauseAudio?.().catch(() => {})
            }
          } else if (audioRef.current && wasPlayingBeforeSave) {
            await audioRef.current.play().catch(() => {})
          }
        } catch (restoreError) {
          console.error('Failed to restore playback after tag save:', restoreError)
        }

        setCurrentTime(savedPlaybackTime)
        setIsPlaying(wasPlayingBeforeSave)
        await loadTrackData(draft.path, {
          mvOriginUrl: activeTrack?.mvOriginUrl,
          hasLyrics: activeTrack?.hasLyrics === true
        })
      }
    },
    [isPlaying, loadTrackData]
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

  const fetchCloudCover = async (
    title,
    artist,
    requestSeq = trackLoadSeqRef.current,
    options = {}
  ) => {
    const cleanTitle = String(title || '').trim()
    const cleanArtist = String(artist || '').trim()
    const rawAlbum = String(options.album || '').trim()
    const cleanAlbum = /^unknown album$/i.test(rawAlbum) ? '' : rawAlbum
    const excludedUrl = String(options.excludeUrl || '').trim()
    if (!cleanTitle && !cleanAlbum) return
    const coverSeq = ++cloudCoverFetchSeqRef.current

    const applyResolvedCover = (url) => {
      const resolvedUrl = String(url || '').trim()
      if (!resolvedUrl || resolvedUrl === excludedUrl) return false
      if (trackLoadSeqRef.current !== requestSeq || cloudCoverFetchSeqRef.current !== coverSeq) {
        return true
      }
      setFailedDisplayCoverUrl(null)
      setCoverUrl(resolvedUrl)
      return true
    }

    if (window.api?.neteaseSearch && cleanTitle) {
      try {
        const songs = await window.api.neteaseSearch(`${cleanTitle} ${cleanArtist}`.trim())
        if (trackLoadSeqRef.current !== requestSeq || cloudCoverFetchSeqRef.current !== coverSeq) return
        const bestSong = pickBestCoverCandidate(songs, cleanTitle, cleanArtist, cleanAlbum)
        if (applyResolvedCover(normalizeNeteaseCoverUrl(bestSong?.cover))) return
      } catch (e) {
        console.warn('Netease cover fetch error:', e)
      }
    }

    if (window.api?.neteaseSearchAlbum && cleanAlbum) {
      try {
        const albums = await window.api.neteaseSearchAlbum({
          albumName: cleanAlbum,
          artist: cleanArtist
        })
        if (trackLoadSeqRef.current !== requestSeq || cloudCoverFetchSeqRef.current !== coverSeq) return
        const bestAlbum = pickBestAlbumCoverCandidate(albums, cleanAlbum, cleanArtist)
        if (applyResolvedCover(normalizeNeteaseCoverUrl(bestAlbum?.picUrl))) return
      } catch (e) {
        console.warn('Netease album cover fetch error:', e)
      }
    }

    if (!cleanTitle) return
    try {
      const query = encodeURIComponent(`${cleanTitle} ${cleanArtist}`.trim())
      const response = await fetch(
        `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`
      )
      if (trackLoadSeqRef.current !== requestSeq || cloudCoverFetchSeqRef.current !== coverSeq) return
      const data = await response.json()
      if (data && data.results && data.results.length > 0) {
        const artwork = data.results[0].artworkUrl100
        applyResolvedCover(normalizeItunesCoverUrl(artwork))
      }
    } catch (e) {
      console.error('Cloud cover fetch error:', e)
    }
  }

  const fetchCloudAlbumCover = async (album, artist) => {
    const cleanAlbum = String(album || '').trim()
    const cleanArtist = String(artist || '').trim()
    if (!cleanAlbum || /^unknown album$/i.test(cleanAlbum)) return null

    if (window.api?.neteaseSearchAlbum) {
      try {
        const albums = await window.api.neteaseSearchAlbum({
          albumName: cleanAlbum,
          artist: cleanArtist
        })
        const bestAlbum = pickBestAlbumCoverCandidate(albums, cleanAlbum, cleanArtist)
        const cover = normalizeNeteaseCoverUrl(bestAlbum?.picUrl || bestAlbum?.cover)
        if (cover) return cover
      } catch (e) {
        console.warn('Netease album cover prefetch error:', e)
      }
    }

    try {
      const query = encodeURIComponent(`${cleanAlbum} ${cleanArtist}`.trim())
      const response = await fetch(
        `https://itunes.apple.com/search?term=${query}&entity=album&limit=5`
      )
      const data = await response.json()
      const bestAlbum = pickBestAlbumCoverCandidate(data?.results || [], cleanAlbum, cleanArtist)
      return normalizeItunesCoverUrl(bestAlbum?.artworkUrl100) || null
    } catch (e) {
      console.warn('iTunes album cover prefetch error:', e)
      return null
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
      setPlaylist((prev) => {
        const next = [...prev, ...processed]
        playlistRef.current = next
        persistStateImmediately(
          'playlist',
          'nc_playlist',
          next,
          configRef.current.autoSaveLibrary !== false && playlistStoreHydratedRef.current
        )
        return next
      })
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
        const normalized = normalizeImportedFolderPath(folderPath)
        if (prev.some((f) => f.toLowerCase() === normalized.toLowerCase())) return prev
        const next = [...prev, normalized]
        persistStateImmediately(
          'importedFolders',
          'nc_imported_folders',
          next,
          importedFoldersHydratedRef.current
        )
        return next
      })
    }
  }

  const handleImportFile = async () => {
    const files = await window.api.openFileHandler(configRef.current.uiLocale)
    if (files && files.length > 0) {
      await processFiles(files)
    }
  }

  const importM3UPlaylistFromText = useCallback(
    async (content, filePath) => {
      const paths = parseM3UPlaylist(content, filePath)
      if (paths.length === 0) {
        alert(t('playlists.noPlaylistsInFile'))
        return false
      }

      const audioFiles = await window.api.getAudioFilesFromPaths(paths)
      if (audioFiles && audioFiles.length > 0) {
        await processFiles(audioFiles)
      }

      const name = getPathBasename(filePath).replace(/\.(m3u8?|txt)$/i, '') || 'M3U Playlist'
      const importedPlaylist = {
        id: crypto.randomUUID(),
        name,
        paths
      }
      setUserPlaylists((prev) => [...prev, importedPlaylist])
      setSelectedSmartCollectionId(null)
      setSelectedUserPlaylistId(importedPlaylist.id)
      setListMode('playlists')
      return true
    },
    [processFiles, t]
  )

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

  const handleDroppedM3UFiles = useCallback(
    async (m3uPaths) => {
      if (!Array.isArray(m3uPaths) || m3uPaths.length === 0) return false
      let imported = false
      for (const m3uPath of m3uPaths) {
        const content = await window.api.readTextFileHandler(m3uPath)
        if (!content) continue
        imported = (await importM3UPlaylistFromText(content, m3uPath)) || imported
      }
      return imported
    },
    [importM3UPlaylistFromText]
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
      const m3uPaths = droppedPaths.filter((filePath) => /\.m3u8?$/i.test(filePath))
      const otherPaths = droppedPaths.filter(
        (filePath) => !filePath.toLowerCase().endsWith('.json') && !/\.m3u8?$/i.test(filePath)
      )

      if (jsonPaths.length > 0) {
        await handleDroppedJsonFiles(jsonPaths)
      }

      if (m3uPaths.length > 0) {
        await handleDroppedM3UFiles(m3uPaths)
      }

      const audioFiles = await window.api.getAudioFilesFromPaths(otherPaths)
      if (audioFiles && audioFiles.length > 0) {
        await processFiles(audioFiles)
      }
    }
  }

  const handleClearPlaylist = () => {
    cancelCrossfade()
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
    setCoverUrlTrackPath('')
    setCoverUrl(null)
    setFailedDisplayCoverUrl(null)
    coverFailureFetchKeyRef.current = ''
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

  const handleNext = useCallback((options = {}) => {
    if (!options.preserveFade) {
      cancelCrossfade()
    }
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
      const { currentSeqIndex, paths } = getPlaybackSequenceSnapshot()
      if (playMode === 'shuffle') {
        let nextIdx = Math.floor(Math.random() * playlist.length)
        if (nextIdx === currentIndex && playlist.length > 1) {
          nextIdx = (nextIdx + 1) % playlist.length
        }
        setCurrentIndex(nextIdx)
      } else if (paths.length > 0) {
        const baseIndex = currentSeqIndex >= 0 ? currentSeqIndex : 0
        const nextPath = paths[(baseIndex + 1) % paths.length]
        const nextIdx = playlistRef.current.findIndex((track) => track.path === nextPath)
        if (nextIdx !== -1) setCurrentIndex(nextIdx)
      } else {
        setCurrentIndex((prev) => (prev + 1) % playlist.length)
      }
      setIsPlaying(true)
    }
  }, [cancelCrossfade, playlist, queuePlaybackEnabled, playMode, currentIndex, getPlaybackSequenceSnapshot])

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

  // Native bridge: track ended -advance using the same rules as HTML audio
  useEffect(() => {
    if (window.api?.onAudioTrackEnded) {
      return window.api.onAudioTrackEnded(() => {
        if (sleepTimerActive && config.sleepTimerMode === 'track') {
          stopPlaybackForSleepTimer()
          cancelSleepTimer()
          return
        }
        handleTrackEndedAdvance()
      })
    }
  }, [
    cancelSleepTimer,
    config.sleepTimerMode,
    handleTrackEndedAdvance,
    sleepTimerActive,
    stopPlaybackForSleepTimer
  ])

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

  // Gapless: 闂傚倸鍊峰ù鍥х暦閻㈢绐楅柟閭﹀枛閸ㄦ繈骞栧ǎ顒€鐏繛鍛У娣囧﹪濡堕崨顔兼缂備胶濮靛姗€鈥旈崘顏佸亾閿濆簼绨奸柟鐧哥悼缁辨帡鎮╅搹顐闂佸搫鏈粙鎴﹀煡婢舵劕纭€闁绘劕顕禍楣冩⒒娴ｅ摜锛嶇紒顕呭灠铻為柛鎰靛枛閽冪喓鈧箍鍎遍悧婊冾瀶閵娾晜鈷戦柛娑橈攻鐏忔壆鈧厜鍋撻柟闂寸閺嬩胶鈧箍鍎遍ˇ顖滅矆閸愨斂浜滈柡鍐ㄥ€哥敮鍫曟煕閻愵亜濮傞柟顔煎槻椤劑宕橀顖樺€楃槐鎺撴綇閳轰椒娌紓浣诡殘閸犳牠宕洪埀顒併亜閹烘垵顏╅柦鍐枑缁绘盯骞嬪▎蹇曚患闂佸憡鍔忛崑鎾绘⒒娓氣偓濞佳嗗櫣闂佸憡鍔楅崑鎾愁渻閹烘垟鏀介柣妯活問閺嗘粎绱掓潏銊︾鐎规洘鍨甸埥澶愬閻樼绱柣鐔哥矌婢ф鏁Δ鍛柧妞ゆ帒瀚悡娆撴煟濡も偓閻楀﹦娆㈤懠顒傜＜闁逞屽墰閳ь剨缍嗛崑浣圭濠婂牊鐓欓柟瑙勫姈绾墽鈧稒绻傞—鍐Χ韫囨艾鎮呴梺鍝勬噽婵挳锝炶箛鎾佹椽顢旈崟顐ょ崺濠电姷鏁告慨鎾磹閹间緤缍栭柟瀛樼箥濞撳鏌曢崼婵囶棡缂佲偓閸愵亞纾兼い鏂裤偢椤庢宕￠柆宥嗙厵闂侇叏绠戦崢鎾煛鐎ｎ亪鍙勯柡宀€鍠栭弻鍥晝閳ь剙鈻嶅Ο鑽ょ?HiFi 闂傚倸鍊峰ù鍥敋瑜忛埀顒佺▓閺呯娀銆佸▎鎾冲唨妞ゆ挾鍋熼悰銉モ攽鎺抽崐鎰板磻閹剧粯鍋傞柕鍫濇閸欏繑淇婇悙棰濆殭濞存粍鍎宠灃?+ gapless 闂傚倸鍊峰ù鍥敋瑜忛埀顒佺▓閺呯娀銆佸▎鎾冲唨妞ゆ挾鍋熼悰銉╂⒑閸︻厼鍔嬫い銊ユ噽婢规洘绻濆顓犲幍闂佸憡鎸嗛崨顓狀偧闂備胶绮幐璇裁哄鈧獮鍫ュΩ閵夊海鍠栭幃鈩冩償閳ヨ尙甯涢梻鍌欐祰椤曆呮崲閸℃稑绀堟繝闈涙川閳瑰秴鈹戦悩鍙夊闁稿﹦鍏橀弻鐔虹磼濡搫娼戦梺绋款儐閹瑰洤鐣风粙璇炬棃鍩€椤掑嫬鍑?
  useEffect(() => {
    if (!config.gaplessEnabled || !useNativeEngineRef.current) return
    const nextPath = nextTrack?.path
    if (nextPath && window.api?.audioPrebufferNext) {
      void window.api.audioPrebufferNext(nextPath)
    } else if (window.api?.audioCancelPrebuffer) {
      void window.api.audioCancelPrebuffer()
    }
  }, [nextTrack?.path, config.gaplessEnabled])

  // Gapless: 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈閸ㄥ倿鏌涢锝嗙缂佺姳鍗抽幃褰掑炊瑜嶅Λ姗€鏌ㄥ┑鍡╂Ц缂佺姵濞婇弻锟犲礃閿濆懍澹曢柣搴ゎ潐濞叉牕顕ｉ懜鐢碘攳濠电姴娴傞弫宥嗙節闂堟稒顥欐慨瑙勵殜濮婂搫煤鐠囨彃绠洪梺鑽ゅ暱閺呯娀鐛崘銊庢棃宕ㄩ鑺ョ彸闂佺鍋愮悰銉╁焵椤掑啫鐨洪柛鎴濈秺濮婄粯鎷呴懞銉с€婇梺鍝ュТ濡繂鐣烽弴鐐垫殾闁搞儺鐓堝鐔兼⒑鐟欏嫬绀冩い鏇嗗懎顥氶柛蹇氬亹缁犻箖鏌熺€电浠﹂柣銊﹀灴閺岋綁鏁愰崶銊︽瘓濠殿喖锕ュ浠嬬嵁閺嶎厽鍊烽柟缁樺俯閻庡磭绱撻崒娆掑厡缂侇噮鍨跺畷褰掓偨缁洍鍋撻敃鍌氱倞妞ゆ帒顦伴弲婊堟⒑閸撴彃浜濋柟顖氾躬閸╋繝宕ㄩ鎯у妇濠电姰鍨奸崺鏍矙閹剧粯鍋╅梺顒€绉甸悡鍐喐濠婂牆绀堟繛鎴欏灩閺嬩礁鈹戦悩瀹犲闁藉啰鍠栭弻銊╂偄閸濆嫅銏ゆ煟閹邦剨鍔熼柟鍙夌摃缁犳稑鈽夊Ο纰卞晥闂備胶绮…鍥╁垝椤栫偞鍋傛繛鎴欏灪閸婂爼鏌ｉ幇顒傛憼闁诲浚鍠氶埀顒冾潐閹爼宕曢悽绋胯摕闁哄洢鍨归獮銏′繆椤栨粌鍔嬮悹鍥╁仱閹鎲撮崟顒傗敍缂備礁寮堕崕鎶筋敋閵夆晛绀嬫い鎾寸箖閸曞啴姊洪懞銉冾亪藝閹惰棄绀夋慨妞诲亾婵﹦绮幏鍛驳鐎ｎ亝顔勭紓鍌欒兌缁垳鏁垾宕囨殾闁瑰瓨绺惧Σ鍫ユ煏韫囨洖啸闁挎稒绋掔换婵嬫偨闂堟刀銏ゆ倵濮樼厧寮柨婵堝仱瀵挳鎮㈤搹璇″晭闂備胶纭堕崜婵嬫晪婵犳鍠栭ˇ鐢稿蓟瀹ュ洨纾兼俊顖滃劦閹峰姊洪柅鐐茶嫰婢ь喚绱掗悩鑼х€规洘娲熼弻鍡楃暤閵夈儲鍠樻い銏＄☉椤繈鏁愰崱娆屽亾濞差亝鈷戦梻鍫熺〒缁犵偤鏌涙繝鍐⒌闁诡噯绻濆鎾偄缁嬪灝浼庢繝纰樻閸ㄦ娊宕㈣閺侇噣宕奸弴鐔哄幗闂婎偄娲㈤崕鎶芥偩閻㈠憡鐓涚€光偓鐎ｎ剛袦濡ょ姷鍋為敃銏ゅ箖閻戣棄绠ユい鏃傚帶缂傛岸姊婚崒娆戝妽閻庣瑳鍛煓闁圭儤顨呯粈澶嬬箾閸℃ɑ灏电€规挷绶氶幃妤呮晲鎼粹剝鐝梺杞扮缁夌數鎹㈠┑鍥╃瘈闁稿本绋戦娑樷攽?
  useEffect(() => {
    if (!window.api?.onGaplessTrackChanged) return undefined
    return window.api.onGaplessTrackChanged((nextPath) => {
      const nextIdx = playlistRef.current.findIndex((t) => t.path === nextPath)
      if (nextIdx !== -1) {
        historyNavigationRef.current = false
        setCurrentIndex(nextIdx)
        // isPlaying 濠电姷鏁告慨鐑藉极閹间礁纾块柟瀵稿Т缁躲倝鏌﹀Ο渚＆婵炲樊浜濋弲婊堟煟閹伴潧澧幖鏉戯躬濮婃椽宕ㄦ繝鍌毿曟繛瀛樼矋閻楃姴鐣?true闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔衡偓鐢殿焾娴犙囨⒒閸曨偄顏柡宀嬬節瀹曟﹢濡搁妷銏犱壕闁煎鍊楁稉宥夋煛閸屾侗鍎ラ柣鏂挎閹綊鎼归悷鏉垮濠电姭鍋撳ù鐓庣摠閻撴洟鏌ｅΟ鍝勭骇妞ゃ儯鍨介弻锛勪沪鐠囨彃顫囬悗娈垮枟濞兼瑨鐏冮梺閫炲苯澧紒鍌氱У閵堬綁宕橀埡浣风敾?playAudio闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔告綇妤ｅ啯顎嶉梺绋款儏椤戝寮婚悢鐓庣鐟滃繒鏁☉銏＄厱閻庯綆浜滈埀顒€娼″濠氬Χ婢跺﹣绱堕梺闈涱樈閸犳鈻撻幍顔剧＝濞达絿鎳撻弫鍓х磽瀹ュ嫮绐旂€殿喖顭烽幃銏㈡偘閳ュ厖澹曞┑鐐村灦閻燁垶鎮為悾宀€纾奸柣妯挎珪瀹曞矂鏌＄仦鍓ф创濠碘€崇埣瀹曞崬螖娴ｇ晫妾ㄩ梻鍌欑閹碱偊寮甸鍕剮妞ゆ牜鍋涢弸渚€鏌涘畝鈧崑娑欏閻樼粯鐓曢柡鍥ュ妼娴滀粙鏌ｆ惔銊ゆ喚婵﹨娅ｉ幏鐘诲蓟閵夈儱鍙婃繝鐢靛仒閸栫娀宕惰閻濇ê顪冮妶鍡楀潑闁稿鎸婚妵鍕敇閻愭潙绐涢梺褰掝棑婵挳婀侀柣搴秵閸嬫帒顭囬弮鈧换婵嗏枔閸喗鐏嶉梺鎸庢处閸嬪棗顕ユ繝鍐﹀亝闁告劏鏅涙禍妤呮⒑缂佹﹩鐒界紒顕呭灦閹€斥槈濮楀棛鍞甸柣鐘烘閸庛倝藟閻愬绠鹃柛娑卞幗閸犳﹢鏌＄仦鍓с€掗柍褜鍓ㄧ紞鍡涘礈濞嗘挸鍑犳繛鎴欏灪閻撴瑦銇勯弬璺ㄤ虎鐞氭氨绱撴担铏瑰笡缂佽鍊块敐鐐测攽鐎ｅ灚鏅㈤梺绋胯閸婃洟寮查鍕ㄦ斀闁挎稑瀚禍濂告煕婵犲啰澧垫鐐村姈閵堬綁宕橀妸褏宕堕梻浣告贡婢ф顭垮Ο鑲╂／鐟滃繘骞夐幖浣瑰亱闁割偅绻勯悷鏌ユ⒑?
      }
    })
  }, [])

  const handlePrev = useCallback((options = {}) => {
    if (!options.preserveFade) {
      cancelCrossfade()
    }

    // 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偛顦甸弫鎾绘偐閾忣偅鐝ㄦ繝鐢靛Х椤ｈ棄危閸涙潙纾婚柛娑欑暘閳ь剙鍟鍕箛椤戔晪绠撻弻鐔兼焽閿曗偓閺嬬喓鈧娲栭ˇ顖炴箒闂佹寧绻傚Λ娆戠矆閸儲鐓曢柣妯虹－婢х數鈧娲栫紞濠囩嵁閸℃凹妲鹃梺鍝勬４缁犳捇寮诲☉銏犖ㄩ柕蹇婂墲閻濓箓姊虹悰鈥充壕闂侀潧艌閺呮粓鍩涢幒鎳ㄥ綊鏁愰崶銊ユ畬濡炪倖娲樼划搴ｆ閹烘柡鍋撻敐搴′簻缂佹姘ㄧ槐鎺斾沪閽樺鍩為柣鎾卞€栭妵鍕疀閹炬潙娅ｉ梺閫炲苯澧い顓犲厴瀵濡搁埡浣稿祮闂佺粯鍔栫粊鎾磻閹捐浼犻柕澹懐鍔堕梻浣虹《閸撴繈濡甸崒姘ｆ婵炲棙鐟ч惌妤佺箾鏉堝墽绉俊顐㈠瀹曘垽鏁撻悩鏂ユ嫼闂佺厧顫曢崐鏇㈠几閹达附鐓曢柡鍐ｅ亾婵炶尙鍠栧畷娲Ψ閿曗偓缁剁偤鏌熼柇锕€澧版い鏃€甯掗—鍐Χ閸℃瑥顫ч梺娲诲弾閸犳绮╅悢鐓庡嵆闁绘劏鏅滈弬鈧梻浣哥枃濡嫬螞濡や胶顩查柛鎾楀懐锛滈梺鍝勮閸庢娊鎮惧ú顏呯厵妞ゆ柣鍔屽ú銈夊础閹惰姤鐓忛煫鍥ㄦ礀鍟搁梺浼欑悼閸嬫挾鎹㈠┑瀣潊闁挎繂鎳愰崢顐︽⒑閸涘﹥鈷愰柣妤冨Т閻ｇ兘寮撮悜鍡楁倯婵犮垼娉涢鍥储闁秵鈷戦柛婵嗗閸屻劑鏌涢弬鎸庢拱闁哄懓鍩栫€佃偐鈧稒顭囬崢鐢告⒑閼恒儍顏埶囬鐐叉辈闁挎繂顦伴悡娑㈡倶閻愰鍤欏┑鈥炽偢閺屽秹鎸婃径妯恍﹂柧浼欑秮閺屾盯鈥﹂幋婵囩彯婵炲鍘ч崯鎾蓟閿濆棙鍎熼柍鈺佸暢绾偓婵＄偑鍊ら崢濂告偋閹捐鐏抽柨鏇楀亾闁伙綇绻濋獮宥夘敊閼恒儺鍟庨梻鍌欑劍鐎笛呮崲閸岀倛鍥焼瀹ュ懐鐓戦梺鍦亾閻ｎ亝绂嶅鍫熺厵闁割煈鍠栭顐ょ棯閻愵剙顕滈柕鍥у閺佸倿鎸婃径妯活棆缂傚倷娴囨ご鎼佸箰婵犳艾绠柛娑欐綑娴肩娀鏌曟竟顖氬€荤粈鍐⒒閸屾瑨鍏屾い顓炵墢閼哄崬煤椤忓嫮锛欓梺鍝勬礌閹冲洭鍩€椤掍焦顥堢€规洘锕㈤、娆撴嚃閳哄搴婇梻鍌欒兌缁垶宕濆Δ鍐╁仒闁靛鏅涚粻浼存煕閹伴潧鏋熼柛濠傜仛椤ㄣ儵鎮欓懠顑胯檸闂佸憡姊圭喊宥囨崲濞戞﹩鍟呮い鏃傚帶缁秹姊虹拠鈥虫灆闁告濞婇悰顔碱潨閳ь剙顕ｉ鍕ㄩ柨鏃傜帛缂嶅矂姊婚崒娆愮グ妞ゎ偄顦悾宄拔熺悰鈩冪€洪梺鍝勬储閸ㄥ湱绮诲鑸电厱妞ゆ劗濮撮崝婊堟煟閹惧瓨绀冮柕鍥у椤㈡﹢鎮㈡搴濆寲缂傚倷闄嶉崝瀣垝濞嗘挸钃熼柣鏃傗拡閺佸﹪鎮归崶銊ョ祷缂佷緡鍠楃换婵堝枈濡搫鈷夐梺璇″枛閸婅绌辨繝鍥ч唶闁哄洨鍋熼崐鐐烘⒑閸愬弶鎯堥柛濠冩倐瀵娊鎮㈤崫銉х槇闂佹眹鍨藉褎绂掗敃鍌涚厱闁靛鍎抽崺锝嗩殽閻愭潙濮嶆鐐达耿椤㈡瑩鎳栭埡瀣耿闂傚倷绀佸﹢閬嶅磻閹捐埖顐?
    if (config.prevButtonMode === 'history') {
      const jumped = goBackInPlaybackHistory()
      if (jumped) return
    }

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
  }, [cancelCrossfade, config.prevButtonMode, goBackInPlaybackHistory, playMode, getPlaybackSequenceSnapshot])

  useEffect(() => {
    if (!window.api?.onPlayerCmd) return undefined
    return window.api.onPlayerCmd((cmd) => {
      if (cmd === 'next') {
        handleNext()
        return
      }
      if (cmd === 'prev') {
        handlePrev()
      }
    })
  }, [handleNext, handlePrev])

  useEffect(() => {
    if (config.crossfadeEnabled || !crossfadeStateRef.current.active) return
    cancelCrossfade()
  }, [cancelCrossfade, config.crossfadeEnabled])

  useEffect(() => {
    if (!useNativeEngineRef.current || !window.api?.audioStartFadeOut || !window.api?.audioStartFadeIn)
      return
    if (!config.crossfadeEnabled || !isPlaying || playlist.length < 2) return
    const currentTrackPath = playlist[currentIndex]?.path || ''
    if (!currentTrackPath || crossfadeStateRef.current.active) return
    if (!(duration > 0) || !(currentTime >= 0)) return

    const remainingSec = duration - currentTime
    if (remainingSec > config.crossfadeDuration || remainingSec < 0) return

    crossfadeStateRef.current = {
      active: true,
      sourcePath: currentTrackPath,
      pendingFadeIn: true
    }

    const fadeMs = Math.max(1000, Number(config.crossfadeDuration || 3) * 1000)
    void window.api.audioStartFadeOut(fadeMs).catch(() => {})
    // Do NOT call handleNext() here -let the track end naturally.
    // The audio stream is single-instance; calling play() for the next track
    // immediately kills the current stream and the fade-out never plays through.
    // Instead, track-ended fires when the audio finishes (now at ~0 volume),
    // handleTrackEndedAdvance() runs normally, and the second useEffect below
    // picks up pendingFadeIn and calls audioStartFadeIn on the new track.
  }, [
    config.crossfadeDuration,
    config.crossfadeEnabled,
    currentIndex,
    currentTime,
    duration,
    isPlaying,
    playlist
  ])

  useEffect(() => {
    if (!useNativeEngineRef.current || !window.api?.audioStartFadeIn) return
    const state = crossfadeStateRef.current
    if (!state.pendingFadeIn) return

    const currentTrackPath = playlist[currentIndex]?.path || ''
    if (!currentTrackPath || currentTrackPath === state.sourcePath) return

    state.pendingFadeIn = false
    state.active = false

    const fadeMs = Math.max(1000, Number(config.crossfadeDuration || 3) * 1000)
    void window.api.audioStartFadeIn(fadeMs).catch(() => {})
  }, [config.crossfadeDuration, currentIndex, playlist])

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

  /** 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈缁犳澘鈹戦悩宕囶暡闁稿骸绉电换婵囩節閸屾粌顣虹紓浣插亾閻庯綆鍋佹禍婊堟煙閹规劖纭惧ù鐘欏洦鐓?MV闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔兼倻濮楀棙鐣烽梺鎼炲€曢惌鍌炲蓟濞戙垹绠绘俊銈傚亾闁硅櫕鍔欓幃鐐淬偅閸愨斁鎷哄┑顔炬嚀濞层倝鎮橀濮愪簻妞ゆ挾鍋熸晶銏㈢磼?iframe -1920-080 闂傚倸鍊搁崐鐑芥倿閿曞倹鍎戠憸鐗堝笒閺勩儵鏌涢弴銊ョ仩闁搞劌鍊搁湁闁稿繐鍚嬬紞鎴︽煟閵堝骸鏋熼柕鍥у楠炲洭宕奸弴鐕佲偓宥夋⒑缁嬪灝顒㈤柛銊ョ埣婵＄敻宕熼姘鳖唺闂佺懓鐡ㄧ换宥嗙閼测晝纾藉ù锝嗗絻娴滈箖姊洪崨濠傚Е濞存粍鐗犲畷鎴﹀箻閼姐倕绁﹂梺鍓茬厛閸犳牗鎱ㄦ惔鈾€鏀介柍钘夋娴滄繈鏌ｉ悢鏉戝姦闁糕斂鍨介獮姗€鎳滈棃娑氬酱闂佽崵鍠嶅鎺旂矆娴ｈ櫣绀婂┑鐘叉搐閺嬩線鏌熼悧鍫熺凡妤犵偑鍨烘穱濠囶敍濠婂啫濡哄┑鐐茬墱閸嬪棛妲愰幘璇茬＜婵﹩鍏橀崑鎾诲箹娴ｅ摜锛欓梺褰掓？缁叉悂宕堕渚囨濠电偞鍨靛畷顒€鈻撻妸鈺傗拺闂傚牊鍗曢崼銉ョ柧婵炴垶姘ㄦ稉宥呪攽閻樺磭顣查柣鎾存礃缁绘盯骞嬪┑鍡氬煘闂佽楠忕徊楣冨Φ閸曨垱鏅滈悹鍥у级閻濇繂鈹戦纭锋敾婵＄偠妫勯悾鐑藉Ω閿斿墽鐦堥梺绋挎湰缁牆菐椤斿墽纾介柛灞剧懆閸忓瞼绱掗鍛仸闁靛棗鍟村畷鍗炩枎閹寸姷鍔归柣搴＄畭閸庨亶藝椤栨碍绾繝鐢靛О閸ㄧ厧鈻斿☉銏℃櫇闁挎棁妫勯閬嶆倵閿濆簼绨撮柡鈧禒瀣厽婵☆垱顑欓崵瀣偓瑙勬偠閸庣敻寮诲☉銏″亜闁告稑锕﹂崙锟犳偠濮橆厾鎳囬柡灞剧洴椤㈡洟鎮╅懠顑跨磿缂?濠电姷鏁告慨鐑藉极閹间礁纾婚柣妯款嚙缁犲灚銇勮箛鎾搭棞缂佽翰鍊濋弻锝夋晲閸涱収妲甸梺绋款儐閹告悂鍩ユ径鎰闁规儳顕ぐ鍥╃磽閸屾瑧璐伴柛鐘冲浮瀵彃鈹戠€ｎ亞顔嗛梺缁樏Ο濠囧疮閸涱喓浜滈柡鍐ㄥ€瑰▍鏇熴亜閳哄﹤浜版慨濠勭帛閹峰懘鎮烽柇锕€娈濈紓鍌欐祰椤曆囧磹閸喚鏆﹂柟鎵閸嬨劎绱掔€ｎ厽纭堕柨?*/
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
    const nextKey = mvId?.id && mvId?.source ? `${mvId.source}:${mvId.id}` : ''
    if (lastMvIdentityRef.current !== nextKey) {
      lastMvIdentityRef.current = nextKey
      setBiliDirectStream(null)
    }
    setYoutubeMvLoginHint(false)
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
    const cacheKey = `${mvId.id}::${qn}`
    const cached = readRuntimeCache(biliStreamCacheRef, cacheKey, BILI_STREAM_CACHE_TTL_MS)
    if (cached?.ok) {
      setBiliDirectStream(cached)
      setMvPlaybackQuality(cached.qualityDesc)
      return
    }
    let cancelled = false
    resolveBiliDirectStreamCached(mvId.id, qn)
      .then((r) => {
        if (cancelled) return
        if (r?.ok) {
          setBiliDirectStream((prev) =>
            prev?.videoUrl === r.videoUrl && prev?.audioUrl === r.audioUrl ? prev : r
          )
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
  }, [
    config.mvQuality,
    mvId?.id,
    mvId?.source,
    readRuntimeCache,
    resolveBiliDirectStreamCached,
    signInStatus.bilibili
  ])

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

  const postMvIframeCommand = useCallback(
    (func, args = []) => {
      if (!mvId) return
      if (mvId.source === 'youtube') {
        postToAllMvIframes(
          JSON.stringify({
            event: 'command',
            func,
            args
          })
        )
        return
      }
      if (mvId.source === 'bilibili' && !biliDirectStream?.videoUrl) {
        postToAllMvIframes(
          JSON.stringify({
            method: func,
            data: args.length <= 1 ? args[0] : args
          })
        )
      }
    },
    [biliDirectStream?.videoUrl, mvId, postToAllMvIframes]
  )

  useEffect(() => {
    if (!mvId) return
    if (mvId.source === 'youtube') {
      postMvIframeCommand(isPlaying ? 'playVideo' : 'pauseVideo')
      postMvIframeCommand('setPlaybackRate', [playbackRate])
      postMvIframeCommand(config.mvMuted ? 'mute' : 'unMute')
      return
    }
    if (mvId.source === 'bilibili' && !biliDirectStream?.videoUrl) {
      postMvIframeCommand(isPlaying ? 'play' : 'pause')
      postMvIframeCommand('volume', [config.mvMuted || isAudioExclusive ? 0 : 1])
    }
  }, [
    biliDirectStream?.videoUrl,
    config.mvMuted,
    isAudioExclusive,
    isPlaying,
    mvId,
    playbackRate,
    postMvIframeCommand
  ])

  const pushYTQuality = useCallback(() => {
    const qMap = { high: 'hd1080', medium: 'hd720', low: 'small' }
    const q = qMap[config.mvQuality || 'high'] || 'hd1080'
    postMvIframeCommand('setPlaybackQuality', [q])
  }, [config.mvQuality, postMvIframeCommand])

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
      postMvIframeCommand('seek', [Math.floor(t)])
      if (isPlaying) postMvIframeCommand('play')
      return
    }

    postMvIframeCommand('seekTo', [t, true])
    if (isPlaying) postMvIframeCommand('playVideo')
  }

  const syncYTVideoRef = useRef(syncYTVideo)
  syncYTVideoRef.current = syncYTVideo

  const getMvSyncTime = useCallback(() => {
    if (useNativeEngineRef.current) {
      return Math.max(0, Number(currentTimeRef.current) || 0)
    }
    return Math.max(0, Number(audioRef.current?.currentTime) || 0)
  }, [])

  /** YouTube / Bilibili 闂傚倸鍊峰ù鍥敋瑜嶉～婵嬫晝閸岋妇绋忔繝銏ｅ煐閸旀洜绮绘导瀛樼厵闂傚倸顕崝宥夋煕閵堝棗濮堥柕鍥у瀵粙顢曢～顓犳崟-iframe闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔兼倻濮楀棙鐣烽梺鎼炲€曢懟顖濈亙闂佹寧绻傞幊搴ㄥ汲閻愮儤鐓曢悗锛卞嫭鐝旈柧缁樼墵閺屻劌鈹戦崱妯烘闂佸搫妫欓悷鈺呭箖濡も偓椤繈顢楁径瀣ф瀰闂備礁鎼惌澶岀礊娴ｅ壊鍤曟い鏇楀亾鐎规洘甯℃俊鍫曞炊瑜嶆瓏闂傚倸鍊峰鎺旀椤斿墽涓嶉柟杈捐吂閳ь剨绠撻幃婊堟寠婢跺孩鎲伴梻浣芥硶閸犳挻鎱ㄩ幘顔界厑闁搞儯鍔婃禍婊堟煙閹佃櫕娅呴柣蹇婃櫆閵囧嫰顢曢悢鍛婄彅闂佸疇顫夐崹鍧楀箖閳哄拋鏁冩い顐幖椤ユ岸姊婚崒娆戭槮婵犫偓闁秵鎯為幖娣妼缁愭淇婇妶鍛劙濠㈣泛顑囩弧鈧梺鎼炲劘閸斿酣宕㈤悽鍛娾拺闁告稑锕ョ亸顐︽煠閸愯尙鍩ｆ鐐搭殜瀹曟帡鎮欑€电骞愰梻浣虹《閸撴繈宕濋弴銏犵闁挎洖鍊归悡娑氣偓鍏夊亾閻庯綆鍓涢惁鍫ユ倵鐟欏嫭绀冮柨鏇樺灪娣囧﹤顫㈠畝濠冃╅梻浣虹帛閹搁箖宕版惔銊ョ厴闁硅揪绠戦悡锟犳煕閳╁啨浠︾紒銊ャ偢閺岋絾鎯旈敐鍥ㄥ殑闂佸憡鍔曟晶浠嬪礉瀹勯偊娓婚柕鍫濇噽缁犱即鏌ｅΔ浣虹煉鐎殿噮鍋勯濂稿幢濞嗘埈鍟庨梻浣烘嚀椤曨參宕戦悩宕囩彾婵せ鍋撻柡灞界Ч椤㈡棃宕ㄩ鎯у殥闂備礁鐤囬～澶愬垂閸фぜ鈧礁鈻庨幘鏉戜患閻庡厜鍋撻柍褜鍓熼、娆撳炊閳哄啰锛濋梺绋挎湰濮樸劌鐡繝鐢靛仜閻即宕濈仦钘夌カ闂備礁缍婇崑濠囧礂濮椻偓瀵劍绂掔€ｎ偄鈧敻鏌ㄥ┑鍡欏嚬缂併劏濮ら妵鍕晜鐟欏嫭鐝氬┑鈽嗗亜閹虫﹢銆侀弴銏狀潊闁炽儲鍓氬Σ閬嶆⒒娴ｈ銇熼柛娆忛叄瀹曚即寮介銊х◤濠电娀娼ч鍡涘疾濠靛鐓曢悘鐐插⒔閳绘捇鏌熷畡閭︾吋婵﹥妞介弻鍛存倷閼艰泛顏繝鈷€鍐憼妞ゃ劊鍎甸幃娆撳级閹存繍娼旈梻浣筋嚃閸ㄥ崬螞閸愨晜鍙忛柍褜鍓熼弻锝呂熼崫鍕獓濠电偛鎳忛幐鎼佸煘閹达附鍋愰柛顭戝亝濮ｅ嫭绻濆▓鍨珝婵炰匠鍛疾闂備礁鎼粙渚€宕㈤懖鈺侇棜鐟滅増甯楅崑锝吤归敐鍛喐闁挎稑绉归弻?*/
  useEffect(() => {
    if (!isPlaying || !mvId) return
    if (mvId.source !== 'youtube') return
    const id = window.setInterval(() => {
      if (isSeekingRef.current) return
      syncYTVideoRef.current(getMvSyncTime())
    }, 3000)
    return () => clearInterval(id)
  }, [getMvSyncTime, isPlaying, mvId?.id, mvId?.source])

  /** Bilibili 闂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛顐ｆ礀绾惧潡鏌ｉ姀銏╃劸闁汇倗鍋撶换婵嬫濞戞碍鍣ユ繝銏ｅ煐閸旀洜绮诲☉娆嶄簻闁哄啫娲﹂ˉ澶愬箹?HTML5 video闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔兼倻濮楀棙鐣烽梺鎼炲€曢惌鍌炲蓟閿濆绠涢梻鍫熺☉椤偄顪冮妶鍌涙珗閻忓繑鐟уΣ鎰板箳閺傚搫浜鹃柨婵嗛娴滀粙鏌涙惔娑樺姦闁哄本鐩幃銏ゆ煥鐎ｎ亝顏￠梻渚€娼уú銈団偓姘緲椤曪綁顢氶埀顒€鐣烽崼鏇炍╃憸瀣焵椤掆偓閿曨亪骞冨Δ鈧埥澶娾枎閹寸姷鏉介梻浣告惈婢跺洭宕滃┑鍡╁殫闁告洦鍨伴獮銏′繆椤栨繂鍚圭憸鏉挎噺缁绘繈鎮介棃娑楃捕濠碘槅鍨伴敃顏勭暦閵忋倖鍋傞幖杈剧磿閵堫偊姊婚崒娆戝妽闁诡喖鐖煎畷鏇灻洪鍕槶濠电偛妫欓崹鐢杆夊杈ㄥ枑闁绘鐗嗙粭姘舵煟閹捐泛鏋涢柡宀€鍠栭幃娆擃敆閳ь剟鍩㈤弴鐔翠簻閹兼番鍩勫▓婊堟煛瀹€瀣瘈鐎规洏鍔戦、娆撴倷椤掆偓濞呮岸姊绘担绛嬪殐闁哥姵顨婇妴鍐╃節閸嬭姤鐩畷姗€濡搁姀鈽嗘綌婵犳鍠楄摫闁伙妇鍏樻俊姝岊槾缁惧彞绮欓弻娑氫沪閻愵剛娈ら悗娑欑箞濮婅櫣绱掑鍡樼暦闂佸湱鎳撳ú銈夘敋閿濆鏁冮柕蹇婃櫅閹垿姊洪崨濠佺繁闁搞劌宕埢鎾诲即閵忊檧鎷洪梺鍛婄☉閿曘儲寰勯崟顐€鐟邦煥閸涱厺鎴峰┑鈥冲级閸旀洟锝炲┑瀣殝缁剧増蓱鐎氳偐绱撻崒娆戭槮妞ゆ垵鐗嗛埢鏃堝即閻樺吀绗夐梺瑙勵問閸犳氨澹曢悡搴唵閻犺櫣鍎ゅ﹢浼存煛閸♀晛澧撮柡宀€鍠栭、娑樷枎閹寸姷宕查梻浣芥〃缁€浣虹矓閻熸壆鏆﹂柣鏃傗拡閺佸棗霉閿濆牜鍤冮柛?seek */
  useEffect(() => {
    if (!isPlaying || !mvId || mvId.source !== 'bilibili' || !biliDirectStream?.videoUrl) return
    let raf = 0
    const hardSeekThresholdSec = 1.0
    const rateNudgeThresholdSec = 0.18
    const tick = () => {
      if (!isSeekingRef.current) {
        const v = biliVideoRef.current || biliBackgroundVideoRef.current
        if (v) {
          const audioTime = getMvSyncTime()
          const target = Math.max(0, audioTime + (configRef.current.mvOffsetMs ?? 0) / 1000)
          const drift = target - (v.currentTime || 0)
          const absDrift = Math.abs(drift)
          if (absDrift > hardSeekThresholdSec) {
            v.currentTime = target
            if (biliAudioRef.current) biliAudioRef.current.currentTime = target
            v.playbackRate = playbackRateRef.current
            if (biliAudioRef.current) biliAudioRef.current.playbackRate = playbackRateRef.current
          } else if (absDrift > rateNudgeThresholdSec) {
            const nudgedRate = Math.max(
              0.5,
              Math.min(2, playbackRateRef.current + (drift > 0 ? 0.04 : -0.04))
            )
            v.playbackRate = nudgedRate
            if (biliAudioRef.current) biliAudioRef.current.playbackRate = nudgedRate
          } else if (v.playbackRate !== playbackRateRef.current) {
            v.playbackRate = playbackRateRef.current
            if (biliAudioRef.current) biliAudioRef.current.playbackRate = playbackRateRef.current
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [biliDirectStream?.videoUrl, getMvSyncTime, isPlaying, mvId?.id, mvId?.source])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 濠电姷鏁告慨鐑藉极閹间礁纾绘繛鎴欏焺閺佸銇勯幘璺烘瀾闁告瑥绻橀弻鐔虹磼閵忕姵鐏堢紓浣哄Х婵炩偓妤犵偞鐗滈崚鎺旀喆閸曞灚缍堥梻浣藉亹婢ф鈧瑳鍥﹂柛鏇ㄥ枤閻も偓闂佽宕樺▔娑⒙烽埀顒勬⒒娴ｄ警鐒炬い鎴濆暣瀹曟繈骞嬮敃鈧拑鐔兼煛閸モ晛鏋旂紒鈾€鍋撻梻濠庡亜濞诧箑煤濠婂牆姹查柣妯肩帛閳锋垹绱撴担鑲℃垹浜搁悧鍫㈢闁肩⒈鍓欓弸娑欘殽閻愭彃鏆ｇ€规洜鍏橀、妯衡槈濡懓顥氶梻浣瑰缁诲倻鑺遍懖鈺勫С濠电姵纰嶉悡娑㈡煕閳╁啰鎳冨ù鐘讳憾閺?MV 闂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛顐ｆ磵閳ь剨绠撳畷濂稿Ψ椤旇姤娅堥梻浣告啞娓氭宕归崡鐐垫殾闁哄被鍎查悡娆撴煕濠靛棗顏懖鏍⒑閸濆嫬顏╅柛濠傜仢椤繒绱掑Ο璇差€撻梺鍛婄☉閿曘儵宕曢幘缁樷拺闁告縿鍎卞▍蹇涙煕鐎ｎ亷韬鐐插暣婵＄兘鏁傛ィ鍐╊€嶇紓鍌欑椤戝懎顭囬垾婢勬盯鎮滈懞銉㈡嫼閻熸粎澧楃敮妤呮晬閻旇櫣纾奸柍褜鍓氶幏鍛存嚃濠靛洨鈽夋い顐ｇ矒閸┾偓妞ゆ帒瀚拑鐔兼煃閳轰礁鏆欑紒鍓佸仱閹鏁愭径瀣敪闂佸憡鏌ㄩ惌鍌氼潖濞差亜绠归柣鎰ゴ閸嬫挸螖娴ｇ懓寮块梺鍦檸閸ｎ垳绱為弽銊ょ箚闁靛牆鎳庨弳鐔虹棯閹冩倯濞ｅ洤锕、娑橆潩椤撶喎鍓垫俊鐐€ら崑鍕煀閿濆拋娼栭柣鎴炆戞慨婊堟煙濞堝灝鏋ら柣娑栧灮缁辨挻鎷呴崫鍕戯綁鏌ｅΔ浣圭闁?
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
  const currentTrackMeta = currentTrack?.path ? trackMetaMap[currentTrack.path] || null : null
  const currentBpmRaw = Number(
    technicalInfo.originalBpm || (currentTrackMeta?.bpmMeasured ? currentTrackMeta?.bpm : 0)
  )
  const currentBottomBarBpm =
    Number.isFinite(currentBpmRaw) && currentBpmRaw > 0 ? Math.round(currentBpmRaw) : null
  const currentBottomBarAdjustedBpm =
    currentBottomBarBpm && playbackRate !== 1
      ? Math.round(currentBottomBarBpm * playbackRate)
      : null
  const showBottomBarBpmDetecting = Boolean(currentTrack?.path) && !currentBottomBarBpm && bpmDetectionState === 'detecting'
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
    const metadataMatchesCurrentTrack = coverUrlTrackPath === currentTrack?.path
    if (metadataMatchesCurrentTrack && metadata.artist && metadata.artist !== 'Unknown Artist') {
      return metadata.artist
    }
    if (currentTrackInfo?.artist && currentTrackInfo.artist !== 'Unknown Artist')
      return currentTrackInfo.artist
    return currentTrack ? t('player.nightcoreMode') : t('player.ellipsis')
  }, [coverUrlTrackPath, currentDisplayOverride, currentTrackInfo, currentTrack, metadata.artist, t])

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
    if (coverUrlTrackPath === currentTrack?.path && metadata.title) return metadata.title
    if (currentTrack) return currentTrack.name.replace(/\.[^/.]+$/, '')
    return t('player.selectTrack')
  }, [coverUrlTrackPath, lastCastStatus, currentDisplayOverride, metadata.title, currentTrack, t])

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
    if (coverUrlTrackPath === currentTrack?.path && metadata.album) return metadata.album
    return currentTrack?.info?.album || 'Unknown Album'
  }, [coverUrlTrackPath, lastCastStatus, currentDisplayOverride, metadata.album, currentTrack])

  const displayMainCoverUrl = useMemo(() => {
    const s = lastCastStatus
    if (s?.dlnaEnabled && s?.currentUri) {
      const u = (s.dlnaMeta?.albumArtUrl || '').trim()
      return u || null
    }
    if (currentDisplayOverride?.cover) return currentDisplayOverride.cover
    if (!currentTrack?.path) return null
    const knownTrackCover = currentTrackInfo?.cover || effectiveTrackMetaMap[currentTrack.path]?.cover || null
    if (coverUrlTrackPath === currentTrack.path && coverUrl) return coverUrl
    return knownTrackCover
  }, [
    lastCastStatus,
    currentDisplayOverride,
    currentTrack?.path,
    currentTrackInfo?.cover,
    effectiveTrackMetaMap,
    coverUrlTrackPath,
    coverUrl
  ])

  const displaySafeCoverUrl = useMemo(() => {
    if (!displayMainCoverUrl) return null
    return displayMainCoverUrl === failedDisplayCoverUrl ? null : displayMainCoverUrl
  }, [displayMainCoverUrl, failedDisplayCoverUrl])

  const customWallpaperUrl = useMemo(() => {
    if (!config.customBgPath) return ''
    return window.api?.pathToFileURL?.(config.customBgPath) || `file:///${String(config.customBgPath).replace(/\\/g, '/')}`
  }, [config.customBgPath])

  useEffect(() => {
    if (!currentTrack?.path || !displaySafeCoverUrl) return
    if (
      !lastCastStatus?.dlnaEnabled &&
      !currentDisplayOverride?.cover &&
      coverUrlTrackPath !== currentTrack.path
    ) {
      return
    }

    const albumName =
      metadata.album || currentTrackInfo?.album || currentTrack?.info?.album || 'Singles'
    const syncKey = `${currentTrack.path}::${displaySafeCoverUrl}::${albumName}`
    if (syncedDisplayCoverCacheKeyRef.current === syncKey) return
    syncedDisplayCoverCacheKeyRef.current = syncKey

    const title =
      metadata.title ||
      currentTrackInfo?.title ||
      currentTrack.name?.replace(/\.[^/.]+$/, '') ||
      null
    const artist =
      (metadata.artist && metadata.artist !== 'Unknown Artist' ? metadata.artist : null) ||
      currentTrackInfo?.artist ||
      null
    const albumArtist = metadata.albumArtist || currentTrackInfo?.albumArtist || null
    const coverEntry = {
      title,
      artist,
      album: albumName,
      albumArtist,
      trackNo: metadata.trackNo ?? currentTrackInfo?.trackNo ?? null,
      discNo: metadata.discNo ?? currentTrackInfo?.discNo ?? null,
      cover: displaySafeCoverUrl,
      duration: duration || currentTrackInfo?.duration || null,
      coverChecked: true,
      codec: technicalInfo.codec || trackMetaMap[currentTrack.path]?.codec || null,
      bitrateKbps: technicalInfo.bitrate
        ? Math.round(technicalInfo.bitrate / 1000)
        : trackMetaMap[currentTrack.path]?.bitrateKbps || null,
      sampleRateHz: technicalInfo.sampleRate || trackMetaMap[currentTrack.path]?.sampleRateHz || null,
      bitDepth: technicalInfo.bitDepth || trackMetaMap[currentTrack.path]?.bitDepth || null,
      channels: technicalInfo.channels || trackMetaMap[currentTrack.path]?.channels || null,
      isMqa: technicalInfo.isMqa === true || trackMetaMap[currentTrack.path]?.isMqa === true,
      bpm: technicalInfo.originalBpm || trackMetaMap[currentTrack.path]?.bpm || null,
      lyrics: trackMetaMap[currentTrack.path]?.lyrics || null
    }

    setTrackMetaMap((prev) => {
      const existing = prev[currentTrack.path] || {}
      if (existing.cover === displaySafeCoverUrl && existing.coverChecked === true) return prev
      return {
        ...prev,
        [currentTrack.path]: {
          ...existing,
          ...coverEntry
        }
      }
    })

    if (albumName) {
      setAlbumCoverMap((prev) => {
        if (prev[albumName]) return prev
        return { ...prev, [albumName]: displaySafeCoverUrl }
      })
    }

    writeTrackMetaCache({ [currentTrack.path]: coverEntry })
  }, [
    currentTrack,
    currentTrackInfo,
    coverUrlTrackPath,
    currentDisplayOverride?.cover,
    displaySafeCoverUrl,
    duration,
    lastCastStatus,
    metadata.album,
    metadata.albumArtist,
    metadata.artist,
    metadata.discNo,
    metadata.title,
    metadata.trackNo,
    technicalInfo.bitrate,
    technicalInfo.channels,
    technicalInfo.codec,
    technicalInfo.originalBpm,
    technicalInfo.sampleRate,
    trackMetaMap
  ])

  const handleDisplayCoverError = () => {
    if (!displayMainCoverUrl) return
    setFailedDisplayCoverUrl(displayMainCoverUrl)
    const failureKey = [displayMainCoverUrl, displayMainTitle, displayMainArtist, displayMainAlbum].join('::')
    if (coverFailureFetchKeyRef.current === failureKey) return
    coverFailureFetchKeyRef.current = failureKey
    fetchCloudCover(displayMainTitle, displayMainArtist, trackLoadSeqRef.current, {
      album: displayMainAlbum,
      excludeUrl: displayMainCoverUrl
    })
  }

  useEffect(() => {
    if (!config.themeDynamicCoverColor || !displaySafeCoverUrl) {
      setDynamicCoverTheme(null)
      return
    }
    let cancelled = false
    extractAverageHexFromSrc(displaySafeCoverUrl)
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
  }, [config.themeDynamicCoverColor, displaySafeCoverUrl])

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
        (currentTrack?.path === track.path ? displaySafeCoverUrl : null) ||
        null
      return {
        title,
        artist,
        album,
        cover:
          typeof cover === 'string' && cover.length > MAX_SHARE_CARD_COVER_CHARS ? displaySafeCoverUrl || null : cover
      }
    },
    [trackMetaMap, currentTrack, displaySafeCoverUrl, t]
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
        setShareCardSnapshot(null)
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
        setShareCardSnapshot(null)
        setIsCardActionBusy(false)
      }
    },
    [isCardActionBusy, buildShareCardSnapshot, waitForShareCardPaint, t]
  )

  const handleDeleteTrackFile = useCallback(
    async (track) => {
      const filePath = track?.path || ''
      if (!filePath || !isLocalAudioFilePath(filePath)) {
        alert(t('contextMenu.actionFailed', { detail: 'path_unavailable' }))
        return
      }
      if (!window.api?.deleteAudioFileHandler) {
        alert(t('contextMenu.actionFailed', { detail: 'delete_unavailable' }))
        return
      }

      const info = parseTrackInfo(track, trackMetaMapRef.current?.[filePath] || null)
      const title = info?.title || stripExtension(track?.name || fileNameFromPath(filePath))
      const ok = window.confirm(
        t('contextMenu.confirmDeleteTrack', {
          title,
          path: filePath,
          defaultValue: `Delete "${title}" from its folder?\n\n${filePath}`
        })
      )
      if (!ok) return

      const deletingCurrentTrack = playlistRef.current[currentIndexRef.current]?.path === filePath
      if (deletingCurrentTrack) {
        try {
          if (window.api?.stopAudio) await window.api.stopAudio()
        } catch {
          /* best effort release before deleting */
        }
        try {
          if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current.removeAttribute('src')
            audioRef.current.src = ''
            audioRef.current.load()
          }
        } catch {
          /* best effort release before deleting */
        }
      }

      const result = await window.api.deleteAudioFileHandler(filePath)
      if (!result?.ok) {
        alert(t('contextMenu.actionFailed', { detail: result?.error || 'delete_failed' }))
        return
      }

      applyLibraryFolderDelta({
        renamed: [],
        removedPaths: [result.path || filePath],
        added: []
      })
    },
    [applyLibraryFolderDelta, t]
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

    // parsePlainLyrics 濠电姷鏁告慨鐑藉极閹间礁纾绘繛鎴欏灪閸嬨倝鏌曟繛褍鎳庨弳妤呮⒑缁嬭法鐏遍柛瀣☉椤斿繐鈹戦崶銉ょ盎闂佸搫鍟ú銈堫暱婵＄偑鍊曠换鎺楀窗閺嵮屾綎缂備焦蓱婵挳鏌涢敂璇插箺闁煎灝娲娲川婵犲啰鍙嗛梺娲诲墮閵堟悂宕洪埀顒併亜閹哄秷鍏屾繛鍫滃嵆閺屾盯濡烽幋婵囧櫣濠殿噯闄勬穱濠囨倷椤忓嫧鍋撻弽顐ｆ殰濠电姴娲﹂崵鍕煕椤愶絾绀冮柛搴㈩殜閹鏁愭惔鈩冪亶闂佺粯鎸鹃崰鏍蓟閵娾晛绫嶉柛銉戝倹鐫忕紓浣哄亾閸庡啿顭囬敓鐘茶摕闁绘梻鈷堥弫濠囨煢濡警妯堟俊顐㈡缁绘稓鈧數顭堥鎾剁磼閻樿櫕宕屾鐐诧躬閹瑩宕崟搴涘妿閹插摜鈧綆鍠栫壕鑽ゆ喐閺傛娼?3.5 缂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕闁芥ɑ绻堥弻鈩冨緞鐎ｉ潧鍔岄梺鍝ュ枎閹冲酣鍩為幋锔藉亹閻庡湱濮撮ˉ婵嬫⒑缂佹ê绗掗柣蹇斿哺婵＄敻宕熼姘鳖唺閻庡箍鍎遍悧鍡涘储閿涘嫮纾藉ù锝呮惈鏍￠梺鎼炲妼濞尖€愁嚕鐠囨祴妲堟慨妤€妫欓崓闈涱渻閵堝棗绗掓い锔垮嵆閸┿垽宕奸妷锕€鈧灚绻涢崼婵堜虎婵炲懏锕㈤弻娑㈡晲韫囨洖鍩岄梺浼欑秮閺€杈╃紦閻ｅ瞼鐭欓柛顭戝枛缁侇噣姊绘担铏瑰笡婵炲弶鐗犲畷鎰節濮橆剝袝閻熸粎澧楃敮妤呭煕閹达附鐓曟繝闈涙椤忓瓨淇婇崣澶嬨仢闁哄本绋撻埀顒婄秵閸撴瑩鍩㈤崼鐕佹闁绘劕鐡ㄥ畷灞俱亜閵忊剝顥堢€规洖宕～婊堝幢濡偐鈼ユ繝鐢靛Х閺佸憡绻涢埀顒佺箾娴ｅ啿鍘惧ú顏勎╅柍杞拌兌閸樻椽姊洪崫鍕殭闁稿﹦鏁诲畷鎴﹀箻閼姐倕绁﹂梺鍓茬厛閸犳牗鎱ㄦ惔鈽嗘富闁靛牆绻愰惁婊堟煕鐎ｎ亷宸ラ柣锝囧厴楠炲鏁冮埀顒傜不婵犳碍鍋ｉ柛銉簻閻ㄦ椽鏌ㄥ☉娆戠煀闁宠鍨块、娆撳棘閵堝嫮杩旈梻浣告啞閿氶柕鍫熸倐瀹曟椽鍩€椤掍降浜滈柟瀵稿仜閸斻倝鏌嶈閸撴氨鎹㈤崒鐑囩稏闊洦鎷嬪ú顏嶆晜鐎广儱妫欏▍鍥⒒娴ｇ懓顕滅紒璇插€块獮濠冩償椤帞绋忛悗鍏夊亾闁告洦鍏橀幏娲⒑缂佹ê鐏嶉柡鍛洴閿濈偤骞掑Δ浣哄幈闂佸搫娲ㄩ崑鐔哥濞戙垺鐓熼柨婵嗙墱閸ゆ瑩鏌嶇憴鍕伌闁糕斂鍎靛畷鍗炍旈崘褍瀵查梻鍌欒兌椤㈠﹤鈻嶉弴銏犵闁搞儺鍓欑粻?
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
      idle: t('lyricsDrawer.sourceStateIdle', '-'),
      loading: t('lyricsDrawer.sourceStateLoading', 'Loading'),
      none: t('lyricsDrawer.sourceStateNone', 'No lyrics'),
      local: t('lyricsDrawer.sourceStateLocal', 'Local file'),
      embedded: t('lyricsDrawer.sourceStateEmbedded', 'Embedded tags'),
      lrclib: t('lyricsDrawer.sourceStateLrclib', 'LRCLIB'),
      netease: t('lyricsDrawer.sourceStateNetease', 'NetEase'),
      qq: t('lyricsDrawer.sourceStateQq', 'QQ Music'),
      kugou: t('lyricsDrawer.sourceStateKugou', 'Kugou'),
      kuwo: t('lyricsDrawer.sourceStateKuwo', 'Kuwo'),
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
      text = `${labelMap.cache} -${detail}${origin && origin !== detail ? ` -${origin}` : ''}`
    } else if (
      (lyricsSourceStatus?.kind === 'manual' || lyricsSourceStatus?.kind === 'link') &&
      origin
    ) {
      text = `${text} -${origin}`
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

  useEffect(() => {
    const foundCovers = {}
    for (const track of parsedPlaylist) {
      const albumName = track?.info?.album || 'Singles'
      const cover = track?.info?.cover
      if (albumName && cover && !foundCovers[albumName]) {
        foundCovers[albumName] = cover
      }
    }
    if (Object.keys(foundCovers).length === 0) return

    setAlbumCoverMap((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [albumName, cover] of Object.entries(foundCovers)) {
        if (!next[albumName] && cover) {
          next[albumName] = cover
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [parsedPlaylist])

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

    const buckets = Array.from(groups.entries()).map(([name, tracks]) => ({
      name,
      tracks,
      artist:
        tracks.find((t) => t.info.artist && t.info.artist !== 'Unknown Artist')?.info.artist ||
        'Unknown Artist',
      cover:
        albumCoverMap[name] ||
        trackMetaMap[tracks.find((t) => trackMetaMap[t.path]?.cover)?.path]?.cover ||
        tracks.find((t) => t.info.cover)?.info.cover ||
        null
    }))

    const getAlbumAddedAt = (album) =>
      Math.min(...album.tracks.map((track) => track.birthtimeMs || Infinity))

    if (albumSortMode === 'dateAsc') {
      buckets.sort((a, b) => getAlbumAddedAt(a) - getAlbumAddedAt(b))
    } else if (albumSortMode === 'dateDesc') {
      buckets.sort((a, b) => getAlbumAddedAt(b) - getAlbumAddedAt(a))
    } else if (albumSortMode === 'nameDesc') {
      buckets.sort((a, b) => b.name.localeCompare(a.name))
    } else if (albumSortMode === 'artistAsc') {
      buckets.sort((a, b) => a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name))
    } else if (albumSortMode === 'artistDesc') {
      buckets.sort((a, b) => b.artist.localeCompare(a.artist) || a.name.localeCompare(b.name))
    } else if (albumSortMode === 'tracksAsc') {
      buckets.sort((a, b) => a.tracks.length - b.tracks.length || a.name.localeCompare(b.name))
    } else if (albumSortMode === 'tracksDesc') {
      buckets.sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name))
    } else {
      buckets.sort((a, b) => a.name.localeCompare(b.name))
    }

    buckets.sort((a, b) => {
      if (!!a.cover === !!b.cover) return 0
      return a.cover ? -1 : 1
    })

    return buckets
  }, [queryFilteredPlaylist, albumSortMode, albumCoverMap, trackMetaMap])

  const albumGroups = listMode === 'album' ? albumBuckets : []

  /* Folder grouping -extract parent folder from track path */
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

  const artistBuckets = useMemo(() => {
    const unknownArtist = t('artists.unknown', 'Unknown Artist')
    const groups = queryFilteredPlaylist.reduce((acc, track) => {
      const key = track.info.artist || unknownArtist
      if (!acc.has(key)) acc.set(key, { name: key, tracks: [] })
      acc.get(key).tracks.push(track)
      return acc
    }, new Map())

    return Array.from(groups.values()).sort(
      (a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name)
    )
  }, [queryFilteredPlaylist, t])

  const artistNamesSet = useMemo(() => {
    const s = new Set()
    for (const b of artistBuckets) s.add(b.name)
    return s
  }, [artistBuckets])

  const artistGroups = listMode === 'artists' ? artistBuckets : []

  const importedFolderItems = useMemo(() => {
    const seen = new Set()
    return importedFolders
      .map(normalizeImportedFolderPath)
      .filter(Boolean)
      .filter((folderPath) => {
        const key = folderPath.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map((folderPath) => ({
        path: folderPath,
        name: getPathBasename(folderPath) || folderPath,
        trackCount: playlist.filter((track) => isTrackInsideImportedFolders(track?.path, [folderPath]))
          .length
      }))
  }, [importedFolders, playlist])

  const filteredPlaylist = useMemo(() => {
    let result = queryFilteredPlaylist
    if (listMode === 'folders' && selectedFolder !== 'all') {
      result = queryFilteredPlaylist.filter((track) => {
        const parts = (track.path || '').replace(/\\/g, '/').split('/')
        const fp = parts.length > 1 ? parts.slice(0, -1).join('/') : '/'
        return fp === selectedFolder || isTrackInsideImportedFolders(track.path, [selectedFolder])
      })
    } else if (listMode === 'artists' && selectedArtist !== 'all') {
      result = queryFilteredPlaylist
        .filter((track) => (track.info.artist || t('artists.unknown', 'Unknown Artist')) === selectedArtist)
        .sort(compareTrackOrder)
    } else if (selectedAlbum !== 'all') {
      result = queryFilteredPlaylist
        .filter((track) => track.info.album === selectedAlbum)
        .sort(compareTrackOrder)
    }

    if (
      listMode === 'songs' ||
      (listMode === 'folders' && selectedFolder !== 'all') ||
      (listMode === 'artists' && selectedArtist !== 'all') ||
      (listMode === 'album' && selectedAlbum !== 'all')
    ) {
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
  }, [queryFilteredPlaylist, selectedAlbum, selectedFolder, selectedArtist, listMode, songSortMode, t])

  useEffect(() => {
    if (selectedAlbum === 'all') return
    if (listMode === 'album') return
    if (!albumNamesSet.has(selectedAlbum)) setSelectedAlbum('all')
  }, [albumNamesSet, listMode, selectedAlbum])

  useEffect(() => {
    if (selectedFolder === 'all') return
    if (importedFolderItems.some((folder) => folder.path === selectedFolder)) return
    if (!folderNamesSet.has(selectedFolder)) setSelectedFolder('all')
  }, [folderNamesSet, importedFolderItems, selectedFolder])

  useEffect(() => {
    if (selectedArtist === 'all') return
    if (listMode === 'artists') return
    if (!artistNamesSet.has(selectedArtist)) setSelectedArtist('all')
  }, [artistNamesSet, listMode, selectedArtist])

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
    // 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈閸ㄥ倿鏌涢锝嗙缂佺姵婢橀埞鎴︽偐鐎圭姴顥濈紓浣哄У瑜板啴婀侀梺鎸庣箓濞层倝宕濈€ｎ偁浜滈柟閭﹀灠琚氶梺闈涙搐鐎氫即鐛崶顒€鐓涘ù锝嗗絻娴滈箖鏌″搴″箹缂佹劖顨婇弻娑㈠焺閸愵亖濮囬梺缁樻尰濞茬喖寮诲澶婄厸濞达絽鎲￠悘鎾斥攽閻愯尙澧涙繛鍙夌矌濡叉劙骞掑Δ鈧壕鍏兼叏濡搫鑸归柍顏嗘暬濮婃椽宕崟顕呮蕉闂佸憡鏌ㄩ惌鍌炲春閵夛箑绶炲┑鐐靛亾閻庡姊洪悷閭﹀殶濠殿喚顥愰妵鎰償閿濆洨锛濋梺绋挎湰閻熝囧礉瀹ュ棎浜滈柕濞垮劜閸ゅ洨鈧娲橀崝娆忕暦閻戠瓔鏁囬柣妯兼暩閸橆垰鈹戦悩顔肩伇婵炲绋掑鍕炊椤掆偓绾惧鏌熼崜褏甯涢柡鍛叀楠炴牜鍒掗悷鏉库拤闂佺粯绻嶉崰鏍煘閹达附鍊烽柤纰卞墯閹茬厧鈹戦悙璺虹毢闁哥姵鐗曢锝囨嫚濞村顫嶉梺闈涚箚閸撴繂鈻嶉崱娑欌拺闁告稑锕︾粻鎾绘倵濮樼厧澧撮柍銉︾墵瀹曞崬鈻庨幋鐙呯闯濠电偠鎻紞鈧い鏇熺墪閳绘捇寮撮姀锛勫幍濠殿喗绻傞惌鍫ュ吹濞嗘劑浜滄い鎾跺仦缁岃法绱掗悩宕団槈闁宠棄顦灒缁炬澘宕幃鍫濃攽閻樺灚鏆╁┑鐐╁亾濠电偘鍖犻崗鐐☉閳诲酣骞橀搹顐ョ发闂備線娼чˇ顐﹀疾濠婂牊鍋傞柣鏃傚帶缁犲綊鎮楀☉娆樼劷缂佺姵顭囩槐鎺撴媴缁嬫寧些濡炪値鍘煎锟犲箖閻戣棄绠ユい鏂跨毞閸欐椽鏌?
    if (listMode === 'album' && selectedAlbum && selectedAlbum !== 'all') {
      const albumBucket = albumBuckets.find((a) => a.name === selectedAlbum)
      if (albumBucket?.tracks?.length > 0) {
        const sortedPaths = [...albumBucket.tracks]
          .sort(compareTrackOrder)
          .map((t) => t.path)
        return createPlaybackContext('albumGroup', selectedAlbum, sortedPaths)
      }
    }
    return createPlaybackContext('library', 'library', [])
  }, [
    listMode,
    selectedUserPlaylistId,
    selectedUserPlaylist,
    selectedSmartCollectionId,
    selectedSmartCollection,
    smartCollectionTracks,
    selectedAlbum,
    albumBuckets
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

  const queueSortSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  )

  const handleQueueSortEnd = useCallback((event) => {
    const { active, over } = event
    if (!active?.id || !over?.id || active.id === over.id) return
    setUpNextQueue((prev) => {
      const oldIndex = prev.findIndex((item) => item?.path === active.id)
      const newIndex = prev.findIndex((item) => item?.path === over.id)
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
  }, [])

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
        listMode !== 'album' &&
        listMode !== 'folders' &&
        listMode !== 'artists' &&
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
  const [albumGridScrollTop, setAlbumGridScrollTop] = useState(0)
  const [albumGridViewportHeight, setAlbumGridViewportHeight] = useState(0)
  const [albumGridColumnCount, setAlbumGridColumnCount] = useState(1)
  const [albumGridRowHeight, setAlbumGridRowHeight] = useState(ALBUM_GRID_DEFAULT_ROW_HEIGHT)
  const [albumGridRowGap, setAlbumGridRowGap] = useState(ALBUM_GRID_DEFAULT_GAP)
  const [albumGridOffsetTop, setAlbumGridOffsetTop] = useState(0)

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

  const metadataPrefetchSidebarTracks = useMemo(() => {
    if (tracksForSidebarListFiltered.length === 0) return []
    const startIndex = Math.max(
      0,
      visibleSidebarRange.startIndex - SIDEBAR_META_PREFETCH_BEHIND_ROWS
    )
    const endIndex = Math.min(
      tracksForSidebarListFiltered.length,
      visibleSidebarRange.endIndex + SIDEBAR_META_PREFETCH_AHEAD_ROWS
    )
    return tracksForSidebarListFiltered.slice(startIndex, endIndex)
  }, [tracksForSidebarListFiltered, visibleSidebarRange])

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

  const setAlbumGridElement = useCallback((node) => {
    if (!node) {
      if (albumGridRef.current && !albumGridRef.current.isConnected) {
        albumGridRef.current = null
      }
      return
    }
    if (node.closest('.playlist')) {
      albumGridRef.current = node
      return
    }
    if (!albumGridRef.current || !albumGridRef.current.isConnected) {
      albumGridRef.current = node
    }
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

  useEffect(() => {
    if (listMode !== 'album' || selectedAlbum !== 'all') {
      setAlbumGridScrollTop(0)
      setAlbumGridViewportHeight(0)
      return undefined
    }

    const playlistElement = sidebarPlaylistRef.current
    const gridElement = albumGridRef.current
    if (!playlistElement || !gridElement) return undefined

    const syncMetrics = () => {
      const playlistRect = playlistElement.getBoundingClientRect()
      const gridRect = gridElement.getBoundingClientRect()
      const computed = window.getComputedStyle(gridElement)
      const rowGap =
        Number.parseFloat(computed.rowGap || computed.gap || `${ALBUM_GRID_DEFAULT_GAP}`) ||
        ALBUM_GRID_DEFAULT_GAP
      const firstCard = gridElement.querySelector('.album-card')
      const firstCardRect = firstCard?.getBoundingClientRect?.()
      const nextWidth = Math.round(gridElement.clientWidth || gridRect.width || 0)
      const nextRowHeight =
        Math.round(firstCardRect?.height || 0) || ALBUM_GRID_DEFAULT_ROW_HEIGHT
      const nextOffsetTop = Math.max(
        0, Math.round(gridRect.top - playlistRect.top + (playlistElement.scrollTop || 0))
      )

      let nextColumnCount = 1
      if (firstCardRect?.width) {
        nextColumnCount = Math.max(
          1,
          Math.floor((nextWidth + rowGap) / (firstCardRect.width + rowGap))
        )
      }

      setAlbumGridRowGap((prev) => (prev === rowGap ? prev : rowGap))
      setAlbumGridRowHeight((prev) => (prev === nextRowHeight ? prev : nextRowHeight))
      setAlbumGridOffsetTop((prev) => (prev === nextOffsetTop ? prev : nextOffsetTop))
      setAlbumGridColumnCount((prev) => (prev === nextColumnCount ? prev : nextColumnCount))
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
    ro.observe(gridElement)
    const firstCard = gridElement.querySelector('.album-card')
    if (firstCard) ro.observe(firstCard)
    return () => ro.disconnect()
  }, [listMode, selectedAlbum, albumGroupsFiltered.length])

  useEffect(() => {
    if (
      listMode !== 'album' ||
      selectedAlbum !== 'all' ||
      !pendingAlbumOverviewRestoreRef.current
    ) {
      return
    }

    const playlistElement = sidebarPlaylistRef.current
    if (!playlistElement) return

    const restoreScroll = () => {
      playlistElement.scrollTop = albumOverviewScrollTopRef.current || 0
      setSidebarScrollTop(playlistElement.scrollTop || 0)
      pendingAlbumOverviewRestoreRef.current = false
    }

    const rafId = window.requestAnimationFrame(restoreScroll)
    return () => window.cancelAnimationFrame(rafId)
  }, [listMode, selectedAlbum, albumGroupsFiltered.length])

  useEffect(() => {
    if (listMode !== 'album' || selectedAlbum !== 'all') {
      setAlbumGridScrollTop(0)
      setAlbumGridViewportHeight(0)
      return
    }

    const totalRows = Math.ceil(albumGroupsFiltered.length / Math.max(1, albumGridColumnCount))
    const totalHeight =
      totalRows > 0 ? totalRows * albumGridRowHeight + (totalRows - 1) * albumGridRowGap : 0
    const nextScrollTop = Math.max(0, sidebarScrollTop - albumGridOffsetTop)
    const visibleBottom = Math.max(0, sidebarScrollTop + sidebarViewportHeight - albumGridOffsetTop)
    const nextViewportHeight = Math.max(0, Math.min(totalHeight, visibleBottom) - nextScrollTop)

    setAlbumGridScrollTop((prev) => (prev === nextScrollTop ? prev : nextScrollTop))
    setAlbumGridViewportHeight((prev) => (prev === nextViewportHeight ? prev : nextViewportHeight))
  }, [
    listMode,
    selectedAlbum,
    albumGroupsFiltered.length,
    albumGridColumnCount,
    albumGridOffsetTop,
    albumGridRowGap,
    albumGridRowHeight,
    sidebarScrollTop,
    sidebarViewportHeight
  ])

  const visibleAlbumRange = useMemo(() => {
    const total = albumGroupsFiltered.length
    const columnCount = Math.max(1, albumGridColumnCount)
    const totalRows = Math.ceil(total / columnCount)
    const rowStride = Math.max(1, albumGridRowHeight + albumGridRowGap)

    if (total <= 0 || totalRows <= 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        topSpacer: 0,
        bottomSpacer: 0
      }
    }

    const effectiveViewportHeight = Math.max(albumGridViewportHeight, rowStride * 4)
    const startRow = Math.max(0, Math.floor(albumGridScrollTop / rowStride) - SIDEBAR_LIST_OVERSCAN)
    const endRow = Math.min(
      totalRows,
      Math.ceil((albumGridScrollTop + effectiveViewportHeight) / rowStride) +
        SIDEBAR_LIST_OVERSCAN
    )

    return {
      startIndex: startRow * columnCount,
      endIndex: Math.min(total, endRow * columnCount),
      topSpacer: startRow * rowStride,
      bottomSpacer: Math.max(0, (totalRows - endRow) * rowStride)
    }
  }, [
    albumGroupsFiltered.length,
    albumGridColumnCount,
    albumGridRowGap,
    albumGridRowHeight,
    albumGridScrollTop,
    albumGridViewportHeight
  ])

  const visibleAlbumGroups = useMemo(
    () => albumGroupsFiltered.slice(visibleAlbumRange.startIndex, visibleAlbumRange.endIndex),
    [albumGroupsFiltered, visibleAlbumRange]
  )

  const metadataPrefetchAlbumGroups = useMemo(() => {
    if (albumGroupsFiltered.length === 0) return []
    if (listMode === 'album' && selectedAlbum === 'all') return albumGroupsFiltered
    const columnCount = Math.max(1, albumGridColumnCount)
    const startIndex = Math.max(
      0,
      visibleAlbumRange.startIndex - columnCount * ALBUM_META_PREFETCH_BEHIND_ROWS
    )
    const endIndex = Math.min(
      albumGroupsFiltered.length,
      visibleAlbumRange.endIndex + columnCount * ALBUM_META_PREFETCH_AHEAD_ROWS
    )
    return albumGroupsFiltered.slice(startIndex, endIndex)
  }, [albumGroupsFiltered, albumGridColumnCount, listMode, selectedAlbum, visibleAlbumRange])

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

  const showTrackList = useMemo(() => {
    if (listMode === 'songs') return true
    if (listMode === 'album' && selectedAlbum !== 'all') return true
    if (listMode === 'folders' && selectedFolder !== 'all') return true
    if (listMode === 'artists' && selectedArtist !== 'all') return true
    if (listMode === 'playlists' && (selectedUserPlaylistId || selectedSmartCollectionId)) return true
    return false
  }, [
    listMode,
    selectedAlbum,
    selectedFolder,
    selectedArtist,
    selectedUserPlaylistId,
    selectedSmartCollectionId
  ])

  const metadataPrefetchTracks = useMemo(() => {
    const byPath = new Map()
    const pushTrack = (track) => {
      if (!track?.path || byPath.has(track.path)) return
      byPath.set(track.path, track)
    }

    pushTrack(currentTrack)

    if (showTrackList) {
      for (const track of metadataPrefetchSidebarTracks) pushTrack(track)
    }

    if (listMode === 'album' && selectedAlbum === 'all') {
      const albumsNeedingCover = metadataPrefetchAlbumGroups.filter((album) => {
        if (album.cover) return false
        return album.tracks.some((track) => !trackMetaMap[track.path]?.cover)
      })
      const longestAlbumTrackCount = Math.max(
        0,
        ...albumsNeedingCover.map((album) => album.tracks.length)
      )

      for (
        let trackOffset = 0;
        trackOffset < longestAlbumTrackCount && byPath.size < ALBUM_METADATA_PREFETCH_LIMIT;
        trackOffset += 1
      ) {
        for (const album of albumsNeedingCover) {
          const track = album.tracks[trackOffset]
          if (!track?.path) continue
          const entry = trackMetaMap[track.path]
          if (entry?.cover) continue
          if (entry?.coverChecked === true && albumCoverProbePathsRef.current.has(track.path)) {
            continue
          }
          pushTrack(track)
          if (byPath.size >= ALBUM_METADATA_PREFETCH_LIMIT) break
        }
      }
    }

    const limit =
      listMode === 'album' && selectedAlbum === 'all'
        ? ALBUM_METADATA_PREFETCH_LIMIT
        : METADATA_PREFETCH_LIMIT
    return Array.from(byPath.values()).slice(0, limit)
  }, [
    currentTrack,
    listMode,
    metadataPrefetchAlbumGroups,
    metadataPrefetchSidebarTracks,
    selectedAlbum,
    showTrackList,
    trackMetaMap
  ])

  const metadataCoverKeepPathKey = useMemo(() => {
    const paths = []
    const pushTrack = (track) => {
      if (track?.path) paths.push(track.path)
    }

    pushTrack(currentTrack)

    if (showTrackList) {
      for (const track of metadataPrefetchSidebarTracks) pushTrack(track)
    }

    if (listMode === 'album' && selectedAlbum === 'all') {
      for (const album of visibleAlbumGroups) {
        pushTrack(album.tracks.find((track) => trackMetaMap[track.path]?.cover) || album.tracks[0])
      }
    }

    return [...new Set(paths)].join('\n')
  }, [
    currentTrack,
    listMode,
    metadataPrefetchSidebarTracks,
    selectedAlbum,
    showTrackList,
    trackMetaMap,
    visibleAlbumGroups
  ])

  const metadataCoverKeepPathSet = useMemo(() => {
    if (!metadataCoverKeepPathKey) return new Set()
    return new Set(metadataCoverKeepPathKey.split('\n').filter(Boolean))
  }, [metadataCoverKeepPathKey])

  useEffect(() => {
    setTrackMetaMap((prev) => {
      const next = trimTrackMetaCoverEntries(prev, metadataCoverKeepPathSet)
      return next === prev ? prev : next
    })
  }, [metadataCoverKeepPathSet])

  useEffect(() => {
    const pending = metadataPrefetchTracks.filter((track) => {
      const entry = trackMetaMap[track.path]
      if (entry?.coverMemoryTrimmed && metadataCoverKeepPathSet.has(track.path)) return true
      const shouldProbeMissingCover =
        entry?.coverChecked === true &&
        !entry?.cover &&
        entry?.coverMemoryTrimmed !== true &&
        !albumCoverProbePathsRef.current.has(track.path)
      const shouldProbeAlbumCover =
        listMode === 'album' &&
        selectedAlbum === 'all' &&
        !entry?.cover &&
        !albumCoverProbePathsRef.current.has(track.path)
      if (shouldProbeMissingCover) return true
      if (shouldProbeAlbumCover) return true
      if (!entry) return true
      return entry.cover == null && entry.coverChecked !== true
    })
    if (!pending.length) return undefined

    let cancelled = false

    const buildEmptyMetaEntry = () => ({
      title: null,
      artist: null,
      album: null,
      albumArtist: null,
      trackNo: null,
      discNo: null,
      cover: null,
      duration: null,
      coverChecked: true,
      bpmChecked: true,
      bpmMeasured: true,
      mqaChecked: true,
      codec: null,
      bitrateKbps: null,
      sampleRateHz: null,
      bitDepth: null,
      channels: null,
      isMqa: false,
      bpm: null
    })

    const loadMetadata = async () => {
      const loaded = {}
      const cached = await readTrackMetaCache(pending.map((track) => track.path))
      for (const [path, entry] of Object.entries(cached)) {
        loaded[path] = entry
      }
      const cachedAlbumCovers = {}
      for (const track of pending) {
        const cachedEntry = cached[track.path]
        if (!cachedEntry?.cover) continue
        const albumName = cachedEntry.album || track?.info?.album || 'Singles'
        if (albumName && !cachedAlbumCovers[albumName]) {
          cachedAlbumCovers[albumName] = cachedEntry.cover
        }
      }
      if (!cancelled && Object.keys(cachedAlbumCovers).length > 0) {
        setAlbumCoverMap((prev) => {
          let changed = false
          const next = { ...prev }
          for (const [albumName, cover] of Object.entries(cachedAlbumCovers)) {
            if (!next[albumName] && cover) {
              next[albumName] = cover
              changed = true
            }
          }
          return changed ? next : prev
        })
      }
      if (!cancelled && Object.keys(cached).length > 0) {
        setTrackMetaMap((prev) => {
          const merged = { ...prev, ...cached }
          return trimTrackMetaCoverEntries(merged, metadataCoverKeepPathSet)
        })
      }

      const uncachedPending = pending.filter((track) => {
        const cachedMeta = cached[track.path]
        if (!cachedMeta) return true
        if (!cachedMeta.bpmChecked) return true
        if (!cachedMeta.mqaChecked) return true
        return !cachedMeta.cover && !albumCoverProbePathsRef.current.has(track.path)
      })
      if (cancelled) return
      const parseBatchSize =
        listMode === 'album' && selectedAlbum === 'all'
          ? ALBUM_METADATA_PARSE_BATCH_SIZE
          : METADATA_PARSE_BATCH_SIZE
      const parseQueue = uncachedPending.slice(0, parseBatchSize)
      let nextIndex = 0

      const parseNextTrack = async () => {
        while (!cancelled) {
          const track = parseQueue[nextIndex]
          nextIndex += 1
          if (!track) return
          try {
            const data = await window.api.getExtendedMetadataHandler(track.path)
            if (data?.success) {
              const common = data.common || {}
              const technical = data.technical || {}
              const cachedMeta = cached[track.path] || {}
              loaded[track.path] = {
                title: common.title || cachedMeta.title || null,
                artist: common.artist || cachedMeta.artist || null,
                album: common.album || cachedMeta.album || null,
                albumArtist: common.albumArtist || cachedMeta.albumArtist || null,
                trackNo: common.trackNo ?? null,
                discNo: common.discNo ?? null,
                cover: common.cover || cachedMeta.cover || null,
                duration: technical.duration || cachedMeta.duration || null,
                coverChecked: true,
                bpmChecked: true,
                bpmMeasured: cachedMeta.bpmMeasured === true,
                mqaChecked: true,
                codec: technical.codec || cachedMeta.codec || null,
                bitrateKbps: technical.bitrate ? Math.round(technical.bitrate / 1000) : cachedMeta.bitrateKbps || null,
                sampleRateHz: technical.sampleRate || cachedMeta.sampleRateHz || null,
                bitDepth: technical.bitDepth || cachedMeta.bitDepth || null,
                channels: technical.channels || cachedMeta.channels || null,
                isMqa: technical.isMqa === true || cachedMeta.isMqa === true,
                bpm: cachedMeta.bpmMeasured ? cachedMeta.bpm || null : null
              }
            } else {
              loaded[track.path] = buildEmptyMetaEntry()
            }
          } catch (error) {
            loaded[track.path] = buildEmptyMetaEntry()
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(METADATA_PARSE_WORKERS, parseQueue.length) }, () =>
          parseNextTrack()
        )
      )

      for (const track of parseQueue) {
        if (track?.path) albumCoverProbePathsRef.current.add(track.path)
      }

      if (!cancelled && Object.keys(loaded).length > 0) {
        const parsedAlbumCovers = {}
        for (const track of parseQueue) {
          const loadedEntry = loaded[track.path]
          if (!loadedEntry?.cover) continue
          const albumName = loadedEntry.album || track?.info?.album || 'Singles'
          if (albumName && !parsedAlbumCovers[albumName]) {
            parsedAlbumCovers[albumName] = loadedEntry.cover
          }
        }
        if (Object.keys(parsedAlbumCovers).length > 0) {
          setAlbumCoverMap((prev) => {
            let changed = false
            const next = { ...prev }
            for (const [albumName, cover] of Object.entries(parsedAlbumCovers)) {
              if (!next[albumName] && cover) {
                next[albumName] = cover
                changed = true
              }
            }
            return changed ? next : prev
          })
        }

        setTrackMetaMap((prev) => {
          const merged = { ...prev, ...loaded }
          return trimTrackMetaCoverEntries(merged, metadataCoverKeepPathSet)
        })
      }

      const freshLoaded = {}
      for (const track of parseQueue) {
        if (loaded[track.path]) freshLoaded[track.path] = loaded[track.path]
      }
      if (Object.keys(freshLoaded).length > 0) {
        writeTrackMetaCache(freshLoaded)
      }
    }

    loadMetadata()

    return () => {
      cancelled = true
    }
  }, [
    listMode,
    metadataCoverKeepPathSet,
    metadataPrefetchTracks,
    selectedAlbum,
    trackMetaMap
  ])

  useEffect(() => {
    if (listMode !== 'album' || selectedAlbum !== 'all') return undefined
    if (!metadataPrefetchAlbumGroups.length) return undefined

    const candidates = []
    for (const album of metadataPrefetchAlbumGroups) {
      const albumName = String(album?.name || '').trim()
      if (!albumName || album?.cover || albumCoverMap[albumName]) continue

      const representativeTrack =
        album.tracks.find((track) => trackMetaMap[track.path]?.coverChecked === true) ||
        album.tracks.find((track) => albumCoverProbePathsRef.current.has(track.path)) ||
        null
      if (!representativeTrack?.path) continue

      const artist =
        album.artist ||
        albumArtistByName[albumName] ||
        representativeTrack.info?.artist ||
        trackMetaMap[representativeTrack.path]?.artist ||
        ''
      const key = `${normalizeCoverLookupText(albumName)}::${normalizeCoverLookupText(artist)}`
      if (!key || albumCloudCoverAttemptedRef.current.has(key)) continue
      if (albumCloudCoverPendingRef.current.has(key)) continue

      candidates.push({ albumName, artist, key, track: representativeTrack })
      if (candidates.length >= ALBUM_CLOUD_COVER_PREFETCH_LIMIT) break
    }

    if (!candidates.length) return undefined
    let cancelled = false
    let nextIndex = 0

    const applyCloudAlbumCover = (candidate, cover) => {
      if (!cover) return
      setAlbumCoverMap((prev) => {
        if (prev[candidate.albumName]) return prev
        return { ...prev, [candidate.albumName]: cover }
      })

      const currentEntry = trackMetaMapRef.current?.[candidate.track.path] || {}
      const info = parseTrackInfo(candidate.track, currentEntry)
      const cacheEntry = {
        ...currentEntry,
        title: currentEntry.title || info.title || null,
        artist: currentEntry.artist || info.artist || candidate.artist || null,
        album: currentEntry.album || candidate.albumName,
        albumArtist: currentEntry.albumArtist || null,
        trackNo: currentEntry.trackNo ?? info.trackNo ?? null,
        discNo: currentEntry.discNo ?? info.discNo ?? null,
        duration: currentEntry.duration || info.duration || null,
        cover,
        coverChecked: true
      }

      setTrackMetaMap((prev) => {
        const existing = prev[candidate.track.path] || {}
        if (existing.cover) return prev
        return {
          ...prev,
          [candidate.track.path]: {
            ...existing,
            ...cacheEntry
          }
        }
      })
      writeTrackMetaCache({ [candidate.track.path]: cacheEntry })
    }

    const runNext = async () => {
      while (!cancelled) {
        const candidate = candidates[nextIndex]
        nextIndex += 1
        if (!candidate) return

        albumCloudCoverAttemptedRef.current.add(candidate.key)
        albumCloudCoverPendingRef.current.add(candidate.key)
        try {
          const cover = await fetchCloudAlbumCover(candidate.albumName, candidate.artist)
          applyCloudAlbumCover(candidate, cover)
        } finally {
          albumCloudCoverPendingRef.current.delete(candidate.key)
        }
      }
    }

    Promise.all(
      Array.from({ length: Math.min(ALBUM_CLOUD_COVER_WORKERS, candidates.length) }, () =>
        runNext()
      )
    ).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [
    albumArtistByName,
    albumCoverMap,
    listMode,
    metadataPrefetchAlbumGroups,
    selectedAlbum,
    trackMetaMap
  ])

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
        if (mode !== 'artists') {
          setSelectedArtist('all')
        }
        if (mode === 'artists') {
          setSelectedAlbum('all')
          setSelectedFolder('all')
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
      albumOverviewScrollTopRef.current = sidebarPlaylistRef.current?.scrollTop || 0
      pendingAlbumOverviewRestoreRef.current = false
      pendingAlbumDetailScrollResetRef.current = true
      forceCloseTrackContextMenu()
      forceCloseCoverContextMenu()
      forceCloseGroupContextMenu()
      forceCloseAddToPlaylistMenu()
      setSelectedUserPlaylistId(null)
      setSelectedSmartCollectionId(null)
      setPlaylistLibraryMoreOpen(false)
      setSelectedArtist('all')
      setSelectedAlbum(album.name)
      setListMode('album')
    },
    [
      forceCloseTrackContextMenu,
      forceCloseCoverContextMenu,
      forceCloseGroupContextMenu,
      forceCloseAddToPlaylistMenu
    ]
  )

  const handleBackToAlbumOverview = useCallback(() => {
    pendingAlbumOverviewRestoreRef.current = true
    setSelectedAlbum('all')
  }, [])

  useLayoutEffect(() => {
    if (
      !pendingAlbumDetailScrollResetRef.current ||
      listMode !== 'album' ||
      selectedAlbum === 'all'
    ) {
      return
    }

    const playlistElement = sidebarPlaylistRef.current
    if (playlistElement) {
      playlistElement.scrollTop = 0
    }
    setSidebarScrollTop(0)
    pendingAlbumDetailScrollResetRef.current = false
  }, [listMode, selectedAlbum])

  const handlePickFolderFromSidebar = useCallback((folder) => {
    setSelectedFolder(folder.folderPath)
    setSelectedAlbum('all')
    setSelectedArtist('all')
    setSelectedSmartCollectionId(null)
    setListMode('folders')
  }, [])

  const handlePickArtistFromSidebar = useCallback((artist) => {
    if (!artist?.name) return
    setSelectedArtist(artist.name)
    setSelectedAlbum('all')
    setSelectedFolder('all')
    setSelectedUserPlaylistId(null)
    setSelectedSmartCollectionId(null)
    setPlaylistLibraryMoreOpen(false)
    setListMode('artists')
  }, [])

  const handleBackToArtistOverview = useCallback(() => {
    setSelectedArtist('all')
  }, [])

  const handleOpenImportedFolder = useCallback((folder) => {
    if (!folder?.path) return
    setSelectedFolder(folder.path)
    setSelectedAlbum('all')
    setSelectedArtist('all')
    setSelectedUserPlaylistId(null)
    setSelectedSmartCollectionId(null)
    setPlaylistLibraryMoreOpen(false)
    setListMode('folders')
  }, [])

  const handleRemoveImportedFolder = useCallback(
    (folder) => {
      const folderPath = normalizeImportedFolderPath(folder?.path)
      if (!folderPath) return
      const folderName = getPathBasename(folderPath) || folderPath
      const ok = window.confirm(
        t('folders.confirmRemoveImportedFolder', {
          name: folderName,
          defaultValue: `Remove imported folder "${folderName}" from ECHO?`
        })
      )
      if (!ok) return

      const removedPaths = playlistRef.current
        .filter((track) => isTrackInsideImportedFolders(track?.path, [folderPath]))
        .map((track) => track.path)

      setImportedFolders((prev) =>
        prev.filter(
          (item) => normalizeImportedFolderPath(item).toLowerCase() !== folderPath.toLowerCase()
        )
      )
      if (selectedFolder === folderPath) setSelectedFolder('all')
      if (removedPaths.length > 0) {
        applyLibraryFolderDelta({ renamed: [], removedPaths, added: [] })
      }
    },
    [applyLibraryFolderDelta, selectedFolder, t]
  )

  const openSmartCollection = useCallback((collectionId) => {
    setSelectedUserPlaylistId(null)
    setSelectedSmartCollectionId(collectionId)
    setSelectedArtist('all')
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
      e?.preventDefault?.()
      e?.stopPropagation?.()
      const { clientX, clientY } = resolveContextMenuPoint(e)
      setFolderSortOpen(false)
      forceCloseAddToPlaylistMenu()
      forceCloseTrackContextMenu()
      forceCloseCoverContextMenu()
      setGroupContextMenu({
        clientX,
        clientY,
        type,
        group
      })
    },
    [forceCloseAddToPlaylistMenu, forceCloseTrackContextMenu, forceCloseCoverContextMenu]
  )

  const openCoverContextMenu = useCallback(
    (e) => {
      if (!currentTrack) return
      e?.preventDefault?.()
      e?.stopPropagation?.()
      const { clientX, clientY } = resolveContextMenuPoint(e)
      forceCloseCoverContextMenu()
      forceCloseAddToPlaylistMenu()
      forceCloseTrackContextMenu()
      forceCloseGroupContextMenu()
      setCoverContextMenu({
        clientX,
        clientY,
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

  const writeTextToClipboard = useCallback(
    async (text) => {
      try {
        if (window.api?.writeClipboardText) {
          const r = await window.api.writeClipboardText(text)
          if (r && r.ok === false && r.error) {
            alert(t('contextMenu.actionFailed', { detail: r.error }))
          }
        } else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text)
        } else {
          alert(t('contextMenu.actionFailed', { detail: 'clipboard_unavailable' }))
        }
      } catch (err) {
        alert(t('contextMenu.actionFailed', { detail: err?.message || String(err) }))
      }
    },
    [t]
  )

  const revealTrackInFolder = useCallback(
    async (track) => {
      const path = track?.path
      if (!path || !window.api?.showItemInFolder) {
        alert(t('contextMenu.actionFailed', { detail: 'path_unavailable' }))
        return
      }
      try {
        const r = await window.api.showItemInFolder(path)
        if (r && r.ok === false && r.error) {
          alert(t('contextMenu.actionFailed', { detail: r.error }))
        }
      } catch (err) {
        alert(t('contextMenu.actionFailed', { detail: err?.message || String(err) }))
      }
    },
    [t]
  )

  const openTrackWithDefaultApp = useCallback(
    async (track) => {
      const path = track?.path
      if (!path || !window.api?.openPath) {
        alert(t('contextMenu.actionFailed', { detail: 'path_unavailable' }))
        return
      }
      try {
        const r = await window.api.openPath(path)
        if (r && r.ok === false && r.error) {
          alert(t('contextMenu.actionFailed', { detail: r.error }))
        }
      } catch (err) {
        alert(t('contextMenu.actionFailed', { detail: err?.message || String(err) }))
      }
    },
    [t]
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

  const buildM3UTrackFromPath = useCallback(
    (trackPath) => {
      if (!trackPath || typeof trackPath !== 'string') return null
      const existingTrack = libraryTrackByPath[trackPath]
      const fallbackName = trackPath.split(/[/\\]/).pop() || trackPath
      const baseTrack = existingTrack || { path: trackPath, name: fallbackName }
      return {
        ...baseTrack,
        path: trackPath,
        info: parseTrackInfo(baseTrack, trackMetaMap[trackPath])
      }
    },
    [libraryTrackByPath, trackMetaMap]
  )

  const exportUserPlaylistM3U = useCallback(
    async (playlistId) => {
      const pl = userPlaylists.find((p) => p.id === playlistId)
      if (!pl) return
      const tracks = (pl.paths || []).map(buildM3UTrackFromPath).filter((track) => track?.path)
      const result = await window.api?.exportPlaylistM3U?.({
        tracks,
        suggestedName: pl.name || 'playlist'
      })
      if (result?.ok === false && !result.canceled && result.error) {
        alert(t('playlists.exportFailed', { message: result.error }))
      }
    },
    [buildM3UTrackFromPath, t, userPlaylists]
  )

  const exportUserPlaylistText = useCallback(
    async (playlistToExport) => {
      const pl =
        typeof playlistToExport === 'string'
          ? userPlaylists.find((item) => item.id === playlistToExport)
          : playlistToExport
      if (!pl) return
      const tracks = (pl.paths || []).map(buildM3UTrackFromPath).filter((track) => track?.path)
      if (!window.api?.exportPlaylistText) {
        alert(t('playlists.exportFailed', { message: 'exportPlaylistText IPC is unavailable' }))
        return
      }
      try {
        const result = await window.api.exportPlaylistText({
          tracks,
          suggestedName: pl.name || 'playlist'
        })
        if (result?.ok === false && !result.canceled && result.error) {
          alert(t('playlists.exportFailed', { message: result.error }))
        }
      } catch (error) {
        alert(t('playlists.exportFailed', { message: error?.message || String(error) }))
      }
    },
    [buildM3UTrackFromPath, t, userPlaylists]
  )

  const exportMainPlaylistM3U = useCallback(async () => {
    const tracks = playlist.map((track) => buildM3UTrackFromPath(track?.path)).filter((track) => track?.path)
    const result = await window.api?.exportPlaylistM3U?.({
      tracks,
      suggestedName: 'echo-playlist'
    })
    if (result?.ok === false && !result.canceled && result.error) {
      alert(t('playlists.exportFailed', { message: result.error }))
    }
  }, [buildM3UTrackFromPath, playlist, t])

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
    const r = window.api?.openPlaylistFileHandler
      ? await window.api.openPlaylistFileHandler()
      : await window.api.openThemeJsonHandler(configRef.current.uiLocale)
    if (r?.error) {
      alert(r.error)
      return
    }
    if (!r?.content) return
    try {
      if (/\.m3u8?$/i.test(r.path || '')) {
        await importM3UPlaylistFromText(r.content, r.path)
        return
      }
      const data = JSON.parse(r.content)
      const imported = normalizeImportedPlaylists(data)
      if (!imported.length) {
        alert(t('playlists.noPlaylistsInFile'))
        return
      }
      setUserPlaylists((prev) => [...prev, ...imported])
      setSelectedSmartCollectionId(null)
      setSelectedUserPlaylistId(imported[imported.length - 1]?.id || null)
    } catch (e) {
      alert(e.message || String(e))
    }
  }, [importM3UPlaylistFromText, t])

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

  // Discord Rich Presence闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔告綇妤ｅ啯顎嶉梺绋款儏椤戝寮诲☉銏犵労闁告劗鍋撻悾濂告⒑閸濆嫭锛旂紒鐘虫崌瀵鏁愭径濠冾棟闂佸湱顭堢€涒晠宕伴幇鐗堚拺鐎规洖娲ㄧ敮娑欎繆椤愩垹鏆ｇ€殿喛顕ч濂稿醇椤愶綆鈧洭姊绘担鍛婂暈闁规悂绠栧畷鐗堟償閵婏箑浠奸梺缁樺灱濡嫬鏁柣鐔哥矊閼活垶鍩㈡禒瀣垫晜闁糕剝鐟ч敍婵囩箾鏉堝墽绉繛浣冲洦鍊堕柍杞拌閺€浠嬫煃閵夈儱鏆遍柤绋跨秺閺屽秶鎲撮崟顐や紝闂佽鍠掗弲娑㈠煝鎼淬倗鐤€闁瑰灝鍟╅幃锝呪攽閻樻剚鍟忛柛鐕佸亰瀹曘劑顢涘鎰簥闂備礁鎼ˇ顖炴偋閸愵喖鐤炬繝濠傜墛閸嬬喓鐥幆褑鐦絙le + show 闂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛顐ｆ穿缂嶆牠鎮楅敐搴℃灈缂佲偓閸愵喗鐓冮柛婵嗗閳ь剙缍婂畷鎰槹鎼达絿锛濋梺绋挎湰閻燂妇绮婇弶娆炬富閻庢稒蓱閸婃劗鈧娲栫紞濠傜暦缁嬭鏃堝礃閵娧佸亰闂佽楠哥粻宥夊磿闁秴绠悗锝庡枛鐟欙箓鎮楅敐搴℃灍闁绘挻娲熼弻锟犲炊閵夈儱顬堝Δ鐘靛仦閿曘垽寮婚悢濂夊晠妞ゆ柨顭烽崑妤€鈹戦纭烽練婵炲拑绲介埥澶愭偨缁嬪灝绐涘銈嗙墬濮樸劍鏅堕鐐粹拻濞达絼璀﹂悞鐐叏濮楀牏鐣遍柣锝囧厴濡啫霉?
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

  /** Full-bleed MV or custom wallpaper behind lyrics -need high-contrast chrome + lyric text */
  const brightLyricsBackdrop = useMemo(
    () => Boolean(showLyrics) && Boolean(config.mvAsBackground && mvId),
    [showLyrics, config.mvAsBackground, mvId]
  )
  const lyricsOnlyInstrumental =
    lyrics.length > 0 &&
    lyrics
      .filter((line) => line.text.trim())
      .every((line) => /instrumental|inst\.?|karaoke|off\s*vocal|enjoy/i.test(line.text))
  const isLyricsListHidden =
    config.lyricsHidden || isCurrentTrackLyricsTemporarilyHidden || lyricsOnlyInstrumental

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

  // Visualizer Animation -subsampled bars + cached gradient (see MiniWaveform pattern)
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

            // 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈡晝閳ь剛鈧艾顦伴妵鍕箳閹存繍浠肩紓浣插亾濠㈣埖鍔栭悡娆撴煟閹寸倖鎴λ夐崱妞绘斀妞ゆ梹瀵ч悵顏嗙磼缂佹鈽夋い鏂跨箻椤㈡瑩鎳￠妶鍥ㄦ櫒缂傚倸鍊烽懗鑸垫叏娴兼潙纾块柣銏㈩焾閽冪喖鏌ｉ弮鍌氬付缂佺姵姘ㄩ幉绋款吋婢跺﹥杈堥梻渚囧墮缁夌敻鎮￠悢鍏肩叆闁哄洦顨呮禍楣冩⒑缂佹澧柕鍫㈩焾椤曪絾绻濆顓熸珳闂佸憡绮堥懗鍫曞矗閸℃稒鐓欓柤鍦瑜把呯磼鏉堛劍绀冪紒鍌涘浮閸┾剝绗熼崶銊ョ槣闂備線娼ч悧鍡欐崲閹烘梻鐭堥柣鎴ｅГ閻撴洟鏌￠崒婵囩《閼叉牜绱?onError 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈閸ㄥ倿鏌涢锝嗙缂佺姳鍗抽弻娑樷攽閸曨偄濮㈤梺娲诲幗閹搁箖鍩€椤掑喚娼愭繛鍙夌墪鐓ら柕濞炬櫅绾偓濠殿喗顭堥崺鏍磹閻㈠憡鐓熼柕蹇嬪灪閺嗏晠鏌曢崱妤嬭含闁哄本绋撻埀顒婄秵閸嬪懐浜搁悽鍛婄厵闁告瑥顦扮亸锔锯偓瑙勬礈閸犳牠銆佸鈧幃鈺呭箵閹烘梻校缂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊閵婏絼绮撻梺鍛婄☉閿曪箓鎮甸崼鏇熺厱闁斥晛鍟伴埥澶岀磼閻樺磭澧柕鍥у瀵潙螖閳ь剚绂嶉幆褜娓婚柕鍫濆暙閻忣亝绻涢懠顒€鏋戝ǎ鍥э攻閹峰懘宕橀悙顑亝绻濆▓鍨灈闁挎洏鍊濋垾锕傛倻閽樺妲梺閫炲苯澧柕鍥у楠炴帡骞嬪┑鍥╀壕婵犵數鍋涢崥瀣礉濞嗘挸钃熼柨婵嗩樈閺佸洨鎲稿澶婂嚑闁靛牆娲ㄧ壕鍏笺亜閺囩偞鍣圭€殿噮鍠氶埀顒冾潐濞叉鏁敓鐘茬畺婵炲棙鎸婚崵鎴炪亜閹烘埈妲搁柡浣哥埣濮婂宕掑▎鎴犵崲濠电偘鍖犻崶浣告处缁傛帞鈧綆浜滈悗顓㈡⒑閻熸澘顣抽柡鍜佸亜閻ｅ灚绗熼埀顒勫蓟閺囷紕鐤€閻庯綆浜栭崑鎾诲冀椤撶喎浜楅梺鍝勬储閸ㄦ椽鎮″☉銏＄厱闁规壋鏅涙俊濂告煃瑜滈崜娑⑩€﹂崼銉﹀剭妞ゆ帒鍊荤壕浠嬫煕鐏炲墽鎳呴柛鏂跨Ч閺岋紕浠︾拠鎻掝潎濡炪們鍨哄畝鎼併€佸鈧幃銏＄瑹椤栨稓銈梻鍌欑劍鐎笛兠洪弽顓炵９闁告縿鍎遍ˉ姘舵煕韫囨艾浜圭紒鈾€鍋撻梻鍌氬€搁悧濠勭矙閹捐鑸归柣銏犳啞閻撳繘鐓崶褜鍎忛柍褜鍓氶悧鐘诲箖閳ユ枼妲堥柕蹇ョ磿閸橀亶姊洪柅娑樺祮婵炰匠鍥╁祦婵°倕鍟板Λ顖涖亜閹惧崬鐏柣锝嗘そ閺岋紕浠﹂崜褉妲堥柧浼欑稻缁绘盯宕卞▎蹇庡缂傚倸绉撮悧鎾愁潖閾忚瀚氶柍銉ョ－娴狀厼鈹戦埥鍡椾簻闁哥噥鍋婇、姘舵晲婢跺﹦顔掑銈嗘礀閹冲繘寮插鍫熲拺缂侇垱娲栨晶鏌ユ煟閻曚礁鐏犻崡閬嶆⒑椤掆偓缁夌敻鍩涢幒鎳ㄥ綊鏁愰崨顔兼殘闁荤姵鍔х槐鏇犳閹烘鏁嬮柛娑卞幘娴犳悂鎮楃憴鍕缂佽鍊介悘鍐⒑閸涘﹣绶遍柛妯荤懇閺佸倿鎳為妷銉ヤ紟婵犵妲呴崹浼存倶濠靛鍋傞柟鎵閻撴洟骞栨潏鍓х？闁绘帗鎮傞弻鐔碱敊閼测晝楔閻庤娲栭悥濂搞€侀弮鍫濈妞ゆ挾鍣ラ崵鍕磽?+ 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偛顦甸弫鎾绘偐閸愯弓鐢绘俊鐐€栭悧婊堝磻濞戙垹鍨傞柛宀€鍋為悡鏇熴亜閹板墎绋荤紒鈧埀顒勬⒑?B 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弴妤€浜惧銈庡亜缁绘濡甸幇鏉跨闁规儳鍘栭悽濠氭⒒娴ｅ摜鏋冩俊妞煎妿濞嗐垽鏁撻悩鍐测偓鐢告偣鏉炴媽顒熸繛鎾愁煼閹鏁愭惔婵堝嚬闂佸湱娅㈢徊鐐┍婵犲浂鏁冩い鎰╁灮娴狀垶姊虹涵鍛毢妞ゎ厼鐗撻崺鐐哄箣閿曗偓闁卞洭鏌ｉ弴姘卞妽缂傚秵顨嗙换婵嗏枔閸喗鐏嶅銈庡幖閻楀棝鍩㈤弬搴撴婵犲﹤鎳愰?
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
        setCoverUrlTrackPath(playlistRef.current[currentIndexRef.current]?.path || '')
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
    <div className="app-root">
      <div
        className="app-container"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
      <div className="app-theme-backdrop" style={themeBackdropStyle} aria-hidden />
      {!showLyrics && customWallpaperUrl && !config.themeCoverAsBackground && (
        <div
          className="app-wallpaper-backdrop app-wallpaper-backdrop--custom"
          style={{
            opacity: config.customBgOpacity,
            backgroundImage: `url("${customWallpaperUrl}")`
          }}
        />
      )}
      {!showLyrics && config.themeCoverAsBackground && displaySafeCoverUrl && (
        <div
          className="app-wallpaper-backdrop app-wallpaper-backdrop--cover"
          style={{
            backgroundImage: `url("${displaySafeCoverUrl.replace(/\\/g, '/')}")`,
            opacity: config.customBgOpacity !== undefined ? config.customBgOpacity : 1.0
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
            mixBlendMode: config.themeCoverAsBackground ? 'color' : 'normal',
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
            onClick={async () => {
              if (config.closeButtonBehavior === 'tray' && window.api?.hideToTrayHandler) {
                await window.api.hideToTrayHandler()
                return
              }
              window.api.closeAppHandler()
            }}
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

      {!showLyrics && view !== 'settings' && (
        <nav className="nav-rail no-drag" aria-label="Library navigation">
          <div className="nav-rail-logo nav-rail-logo--image">
            <img src={localPathToAudioSrc(SIDEBAR_LOGO_IMAGE_PATH)} alt="ECHO" draggable={false} />
          </div>
          <div className="nav-rail-section">
            <button
              type="button"
              className={`nav-rail-item ${listMode === 'songs' ? 'active' : ''}`}
              onClick={() => handleListMode('songs')}
            >
              <Music size={16} /> {t('listMode.songs')}
            </button>
            <button
              type="button"
              className={`nav-rail-item ${listMode === 'album' ? 'active' : ''}`}
              onClick={() => handleListMode('album')}
            >
              <Disc size={16} /> {t('listMode.albums')}
            </button>
            <button
              type="button"
              className={`nav-rail-item ${listMode === 'artists' ? 'active' : ''}`}
              onClick={() => handleListMode('artists')}
            >
              <Users size={16} /> {t('listMode.artists', 'Artists')}
            </button>
            <button
              type="button"
              className={`nav-rail-item ${listMode === 'folders' ? 'active' : ''}`}
              onClick={() => handleListMode('folders')}
            >
              <FolderOpen size={16} /> {t('listMode.folders')}
            </button>
            <div className={`nav-rail-collapse ${navPlaylistsExpanded ? 'is-open' : ''}`}>
              <button
                type="button"
                className={`nav-rail-item nav-rail-item--with-caret ${listMode === 'playlists' ? 'active' : ''}`}
                onClick={() => {
                  handleListMode('playlists')
                  setNavPlaylistsExpanded((value) => !value)
                }}
                aria-expanded={navPlaylistsExpanded}
              >
                <ListMusic size={16} />
                <span>{t('listMode.playlists')}</span>
                <ChevronDown size={14} className="nav-rail-caret" aria-hidden />
              </button>
              {navPlaylistsExpanded && (
                <div className="nav-rail-sublist" aria-label={t('listMode.playlists')}>
                  <button
                    type="button"
                    className={`nav-rail-subitem ${listMode === 'playlists' && !selectedUserPlaylistId && !selectedSmartCollectionId ? 'active' : ''}`}
                    onClick={() => handleListMode('playlists')}
                  >
                    {t('playlists.allPlaylists', 'All playlists')}
                  </button>
                  {userPlaylists.length === 0 ? (
                    <span className="nav-rail-subempty">
                      {t('playlists.noPlaylistsShort', 'No playlists')}
                    </span>
                  ) : (
                    userPlaylists.map((playlistItem) => (
                      <button
                        key={playlistItem.id}
                        type="button"
                        className={`nav-rail-subitem ${selectedUserPlaylistId === playlistItem.id ? 'active' : ''}`}
                        title={playlistItem.name}
                        onClick={() => {
                          setSelectedSmartCollectionId(null)
                          setSelectedUserPlaylistId(playlistItem.id)
                          setSelectedArtist('all')
                          setListMode('playlists')
                        }}
                      >
                        {playlistItem.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <ImportedFolderRail
            folders={importedFolderItems}
            activeFolder={selectedFolder}
            title={t('folders.importedRootsTitle', 'Imported folders')}
            emptyLabel={t('folders.noImportedRoots', 'No imported folders')}
            openLabel={t('folders.openImportedFolder', 'Open imported folder')}
            removeLabel={t('folders.removeImportedFolder', 'Remove imported folder')}
            onOpen={handleOpenImportedFolder}
            onRemove={handleRemoveImportedFolder}
          />
          <div className="nav-rail-bottom">
            <button
              className={`nav-rail-icon-btn ${showLikedOnly ? 'active' : ''}`}
              onClick={() => setShowLikedOnly((v) => !v)}
              title={t('like.filterOnlyTitle')}
              aria-pressed={showLikedOnly}
            >
              <Heart size={15} fill={showLikedOnly ? 'currentColor' : 'none'} strokeWidth={1.5} /> {t('like.filterOnlyTitle')}
            </button>
            <button className="nav-rail-icon-btn" onClick={handleImport} title={t('import.folder')}>
              <FolderHeart size={15} /> {t('import.folder')}
            </button>
            <button
              className="nav-rail-icon-btn"
              onClick={handleImportFile}
              title={t('import.files')}
            >
              <FileAudio size={15} /> {t('import.files')}
            </button>
            <button className="nav-rail-icon-btn" onClick={() => setView('settings')}>
              <Settings size={15} /> {t('nav.settings', 'Settings')}
            </button>
          </div>
        </nav>
      )}

      <div
        className={`sidebar browser-panel glass-panel sidebar-panel-root no-drag ${showLyrics || view === 'settings' ? 'hidden' : ''}`}
      >
        <div className="browser-topbar-actions">
          <span className="browser-topbar-title">
            <span>
              {listMode === 'songs' && t('listMode.songs')}
              {listMode === 'album' && selectedAlbum === 'all' && t('listMode.albums')}
              {listMode === 'album' && selectedAlbum !== 'all' && selectedAlbum}
              {listMode === 'artists' && selectedArtist === 'all' && t('listMode.artists', 'Artists')}
              {listMode === 'artists' && selectedArtist !== 'all' && selectedArtist}
              {listMode === 'folders' && selectedFolder === 'all' && t('listMode.folders')}
              {listMode === 'folders' && selectedFolder !== 'all' &&
                (selectedFolder.split(/[\\/]/).pop() || t('listMode.folders'))}
              {listMode === 'playlists' && t('listMode.playlists')}
            </span>
            <span className="browser-topbar-count">
              {'\u00b7 '}
              {t('songs.count', {
                count: tracksForSidebarListFiltered.length,
                defaultValue: '{{count}} \u9996'
              })}
            </span>
          </span>
          <div className="browser-toolbar-group" aria-label={t('aria.libraryActions', 'Library actions')}>
            <button
              className="browser-toolbar-btn"
              onClick={handleImport}
              title={t('import.folder')}
              aria-label={t('import.folder')}
            >
              <FolderHeart size={17} />
            </button>
            <button
              className="browser-toolbar-btn"
              onClick={handleImportFile}
              title={t('import.files')}
              aria-label={t('import.files')}
            >
              <FileAudio size={17} />
            </button>
            <button
              className="browser-toolbar-btn"
              onClick={exportMainPlaylistM3U}
              title={t('playlists.exportM3U')}
              aria-label={t('aria.exportPlaylist')}
            >
              <Download size={17} />
            </button>
            <button
              className="browser-toolbar-btn browser-toolbar-btn--danger"
              onClick={() => {
                if (
                  window.confirm(
                    t('import.clearPlaylistConfirm', {
                      defaultValue:
                        '\u786e\u5b9a\u8981\u6e05\u7a7a\u5f53\u524d\u64ad\u653e\u5217\u8868\u5417\uff1f'
                    })
                  )
                ) {
                  handleClearPlaylist()
                }
              }}
              title={t('import.clearPlaylist')}
              aria-label={t('import.clearPlaylist')}
            >
              <Trash2 size={17} />
            </button>
          </div>
        </div>
        <div className="search-container no-drag" style={{ flexShrink: 0 }}>
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder={t('search.placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery.trim() && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearchQuery('')}
              aria-label={t('common.clear', { defaultValue: 'Clear' })}
              title={t('common.clear', { defaultValue: 'Clear' })}
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          )}
          {listMode === 'songs' && (
            <div className="folder-sort-wrap search-sort-wrap" ref={songSortRef}>
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
          )}
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
              className={`list-filter-chip ${listMode === 'artists' ? 'active' : ''}`}
              onClick={() => handleListMode('artists')}
            >
              {t('listMode.artists', 'Artists')}
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
          </div>
          {/* Queue panel -闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈠煑閼恒儳鈽夐摶鏍煕濞戝崬骞橀柨娑欑懇濮婃椽鎳￠妶鍛亪闂佺顑呴敃銈夊Υ閹烘挾绡€婵﹩鍘鹃崢閬嶆倵閸忓浜鹃梺閫炲苯澧寸€规洘鍨块幃娆撳传閸曨厼骞堥梻浣告惈濞层垽宕瑰ú顏呭亗婵炲棙鎸婚埛鎴炪亜閹惧崬濡块柣锝変憾閺岋綀绠涙繝鍌氣拤闂侀潧娲ょ€氱増淇婇悜鑺ユ櫇闁逞屽墴閹﹢骞橀鐣屽幐闁诲繒鍋犻褎淇婃總鍛婄厓闁芥ê顦藉Σ鍛娿亜椤愶絿鐭掔€规洖宕灃濞达絽婀辫ぐ鍞榚ue state/logic 濠电姷鏁告慨鐑藉极閹间礁纾块柟瀵稿Т缁躲倝鏌﹀Ο渚＆婵炲樊浜濋弲婊堟煟閹伴潧澧幖鏉戯躬濮婃椽宕ㄦ繝鍐槱闂佹悶鍔嶅妯绘櫏闂佸搫琚崕鏌ユ偂閸愵亝鍠愭繝濠傜墕缁€鍫ユ煟閺冨倸甯堕柦鍐枛閺屾洘绻涢崹顔煎濠碘剝褰冮悧濠冪┍婵犲浂鏁嶆繝濠傛噹缁楋繝姊洪崷顓熺効濡炴潙鎽滈幑銏犫槈濮橈絽浜鹃柣銏☆問閻掔偓銇勬惔锛勭劯闁哄本鐩幃鈺呭箛娴ｅ湱鏆ユ俊鐐€栧ú蹇涘磿闂堟稓鏆﹂柣鏃傗拡閺佸啯銇勯幇鈺佺仾闁稿鍨跺缁樻媴閾忓箍鈧﹪鏌涢幘瀵哥疄闁轰礁鍟撮崺鈩冩媴閸曞墎绉い銏＄洴閹瑧鍒掔憴鍕伖闂傚倷绀侀幉锛勭矙閹达附鏅濋柨鏇炲€哥粻鐘绘煕閺囥劌鐏￠柣鎾跺枑娣囧﹪濡堕崟顓＄獥濠电偛鐗婇…鍥╂閹烘鏁婇柤鎭掑劤閸欏棝姊烘导娆戠Ф缂佺粯绻堥悰顔碱吋婢跺鍎銈嗗姂閸婃挾鑺遍悜鑺モ拻闁稿本鐟х粣鏃€绻涙担鍐叉椤ゅ倿姊绘担鍛婃儓闁瑰啿绻掔划娆撳箣閿曗偓閻?*/}

          {selectedAlbum !== 'all' && listMode === 'songs' && (
            <div className="album-filter-pill no-drag">
              <span>{t('albumFilter.label', { name: selectedAlbum })}</span>
              <button onClick={handleBackToAlbumOverview}>{t('albumFilter.clear')}</button>
            </div>
          )}

          {selectedFolder !== 'all' && listMode === 'folders' && (
            <div className="album-filter-pill no-drag">
              <span>{t('folderFilter.label', { name: getPathBasename(selectedFolder) })}</span>
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

          {((listMode === 'folders' && selectedFolder !== 'all') ||
            (listMode === 'artists' && selectedArtist !== 'all') ||
            (listMode === 'album' && selectedAlbum !== 'all')) && (
            <div className="folder-browser-header library-list-header no-drag">
                <div className="library-list-heading">
                {listMode === 'album' && selectedAlbum !== 'all' && (
                  <button
                    type="button"
                    className="user-playlist-detail-back"
                    onClick={handleBackToAlbumOverview}
                    aria-label={t('nav.back')}
                    title={t('nav.back')}
                    style={{ marginRight: 4 }}
                  >
                    <ChevronLeft size={20} strokeWidth={1.5} />
                  </button>
                )}
                {listMode === 'artists' && selectedArtist !== 'all' && (
                  <button
                    type="button"
                    className="user-playlist-detail-back"
                    onClick={handleBackToArtistOverview}
                    aria-label={t('nav.back')}
                    title={t('nav.back')}
                    style={{ marginRight: 4 }}
                  >
                    <ChevronLeft size={20} strokeWidth={1.5} />
                  </button>
                )}
                <div className="library-list-heading-text">
                  <span className="folder-browser-title library-list-title">
                    {listMode === 'folders' && selectedFolder !== 'all'
                      ? getPathBasename(selectedFolder) || t('folders.heading')
                      : listMode === 'artists'
                        ? selectedArtist
                        : listMode === 'album'
                          ? selectedAlbum
                          : t('songs.heading', 'Songs')}
                  </span>
                  <span className="folder-browser-count library-list-count">
                    {t('playlists.detailTrackCount', {
                      count: tracksForSidebarListFiltered.length
                    })}
                  </span>
                </div>
                </div>
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
            className={`playlist${listMode === 'album' ? ' playlist-album-mode' : ''}${listMode === 'folders' ? ' playlist-album-mode' : ''}${listMode === 'artists' ? ' playlist-album-mode' : ''}${listMode === 'playlists' && (selectedUserPlaylistId || selectedSmartCollectionId) ? ' playlist--pl-detail' : ''}`}
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
                            aria-label={t('aria.exportPlaylist')}
                            title={t('playlists.exportM3U')}
                            onClick={(e) => {
                              e.stopPropagation()
                              exportUserPlaylistM3U(pl.id)
                            }}
                          >
                            <Download size={15} strokeWidth={1.5} />
                          </button>
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

            {playlist.length > 0 && listMode === 'album' && selectedAlbum === 'all' && (
              <div className="album-browser no-drag">
                <div className="album-browser-header">
                  <div style={{ flex: 1 }}>
                    <h3>{t('playlists.albumsHeading')}</h3>
                    <span>{t('playlists.groups', { count: albumGroupsFiltered.length })}</span>
                  </div>
                  <div className="folder-sort-wrap" ref={albumSortRef}>
                    <button
                      type="button"
                      className="folder-sort-trigger"
                      onClick={() => setAlbumSortOpen((v) => !v)}
                      aria-expanded={albumSortOpen}
                    >
                      {albumSortMode === 'dateAsc'
                        ? t('folders.sortDateAsc')
                        : albumSortMode === 'dateDesc'
                          ? t('folders.sortDateDesc')
                          : albumSortMode === 'nameDesc'
                            ? t('songs.sortNameDesc', 'Name (Z-A)')
                            : albumSortMode === 'artistAsc'
                              ? t('songs.sortArtistAsc', 'Artist (A-Z)')
                              : albumSortMode === 'artistDesc'
                                ? t('songs.sortArtistDesc', 'Artist (Z-A)')
                                : albumSortMode === 'tracksAsc'
                                  ? t('playlists.sortTracksAsc', 'Track count (Low)')
                                  : albumSortMode === 'tracksDesc'
                                    ? t('playlists.sortTracksDesc', 'Track count (High)')
                                    : t('songs.sortNameAsc', 'Name (A-Z)')}
                      <ChevronDown size={12} style={{ marginLeft: 2, opacity: 0.6 }} />
                    </button>
                    {albumSortOpen && (
                      <div className="folder-sort-menu" role="menu">
                        {[
                        { key: 'default', label: t('songs.sortNameAsc', 'Name (A-Z)') },
                        { key: 'nameDesc', label: t('songs.sortNameDesc', 'Name (Z-A)') },
                        { key: 'artistAsc', label: t('songs.sortArtistAsc', 'Artist (A-Z)') },
                        { key: 'artistDesc', label: t('songs.sortArtistDesc', 'Artist (Z-A)') },
                        { key: 'tracksAsc', label: t('playlists.sortTracksAsc', 'Track count (Low)') },
                        {
                          key: 'tracksDesc',
                          label: t('playlists.sortTracksDesc', 'Track count (High)')
                        },
                        { key: 'dateAsc', label: t('folders.sortDateAsc') },
                        { key: 'dateDesc', label: t('folders.sortDateDesc') }
                        ].map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            role="menuitem"
                            className={`folder-sort-menu-item${albumSortMode === opt.key ? ' active' : ''}`}
                            onClick={() => {
                              setAlbumSortMode(opt.key)
                              setAlbumSortOpen(false)
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div
                  ref={setAlbumGridElement}
                  className="album-grid album-grid-deferred"
                  style={{
                    paddingTop: visibleAlbumRange.topSpacer,
                    paddingBottom: visibleAlbumRange.bottomSpacer
                  }}
                >
                  {visibleAlbumGroups.map((album) => (
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

            {playlist.length > 0 && listMode === 'artists' && selectedArtist === 'all' && (
              <div className="folder-browser artist-browser no-drag">
                <div className="folder-browser-header">
                  <span className="folder-browser-title">{t('artists.heading', 'Artists')}</span>
                  <span className="folder-browser-count">({artistGroups.length})</span>
                </div>
                <div className="folder-list">
                  {artistGroups.map((artist) => (
                    <button
                      key={artist.name}
                      type="button"
                      className={`folder-list-item${selectedArtist === artist.name ? ' active' : ''}`}
                      onClick={() => handlePickArtistFromSidebar(artist)}
                      title={artist.name}
                    >
                      <Users size={15} className="folder-list-icon" />
                      <span className="folder-list-name">{artist.name}</span>
                      <span className="folder-list-count">{artist.tracks.length}</span>
                    </button>
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
                  <button
                    type="button"
                    className="user-playlist-detail-btn"
                    onClick={() => exportUserPlaylistM3U(selectedUserPlaylist.id)}
                  >
                    <Download size={14} aria-hidden />
                    {t('playlists.exportM3U')}
                  </button>
                  <button
                    type="button"
                    className="user-playlist-detail-btn"
                    onClick={() => exportUserPlaylistText(selectedUserPlaylist)}
                  >
                    <Download size={14} aria-hidden />
                    {t('playlists.exportText')}
                  </button>
                </div>
              </div>
            )}

            {showTrackList && (
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
                  <div
                    key={listMode === 'album' && selectedAlbum !== 'all' ? selectedAlbum : 'sidebar-list'}
                    className={`playlist-virtual-list${listMode === 'album' && selectedAlbum !== 'all' ? ' playlist-virtual-list--album-enter' : ''}`}
                  >
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
                      const trackExt = String(track.name || track.path || '')
                        .split('.')
                        .pop()
                        ?.toUpperCase()
                      const formatLabel =
                        trackExt &&
                        trackExt.length <= 5 &&
                        trackExt !== String(track.name || track.path || '').toUpperCase()
                          ? trackExt
                          : ''
                      const durationLabel =
                        track.info.duration && track.info.duration > 0
                          ? formatTime(track.info.duration)
                          : ''
                      const trackMeta = effectiveTrackMetaMap[track.path] || {}

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
                            e?.preventDefault?.()
                            const { clientX, clientY } = resolveContextMenuPoint(e)
                            forceCloseCoverContextMenu()
                            forceCloseGroupContextMenu()
                            forceCloseAddToPlaylistMenu()
                            setTrackContextMenu({ clientX, clientY, track })
                          }}
                        >
                          <div
                            className={`track-art${track.originalIdx === currentIndex ? ' track-art--playing' : ''}`}
                            aria-hidden
                          >
                            {track.info.cover ? (
                              <img src={track.info.cover} alt="" draggable={false} />
                            ) : (
                              <Music size={17} />
                            )}
                          </div>
                          <div className="track-text-group">
                            <div className="track-name" title={track.info.title}>
                              {track.originalIdx === currentIndex && (
                                <span className="track-playing-dot" aria-hidden />
                              )}
                              {track.info.title}
                            </div>
                            <div
                              className="track-subtitle"
                              title={`${displayArtist} - ${track.info.album}`}
                            >
                              <ArtistLink
                                artist={displayArtist}
                                className="artist-link-subtle"
                                stopPropagation
                                noLink
                              />{' '}
                              - {track.info.album}
                          </div>
                            <div className="track-meta-pills" aria-hidden>
                              <AudioQualityBadges
                                quality={{
                                  codec: trackMeta.codec || formatLabel || null,
                                  bitrateKbps: trackMeta.bitrateKbps || null,
                                  sampleRateHz: trackMeta.sampleRateHz || null,
                                  bitDepth: trackMeta.bitDepth || null,
                                  channels: trackMeta.channels || null,
                                  isMqa: trackMeta.isMqa === true,
                                  bpm: trackMeta.bpm || null
                                }}
                                compact
                              />
                            </div>
                          </div>
                          <div className="track-row-meta" aria-hidden>
                            {durationLabel && <span>{durationLabel}</span>}
                          </div>
                          {(listMode === 'songs' ||
                            listMode === 'folders' ||
                            listMode === 'artists' ||
                            listMode === 'album' ||
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
                              {(listMode === 'songs' ||
                                listMode === 'folders' ||
                                listMode === 'artists' ||
                                listMode === 'album') && (
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
        className={`main-player glass-panel ${showLyrics ? 'lyrics-mode' : 'no-drag'} ${showLyrics && config.mvAsBackground && mvId ? 'immersive-mode' : ''} ${showLyrics && !brightLyricsBackdrop ? 'main-player--lyrics-fallback-bg' : ''} ${brightLyricsBackdrop ? 'main-player--bright-lyrics-bg' : ''} ${view === 'settings' ? 'hidden' : ''} ${config.lyricsBlurEffect ? 'lyrics-blur-on' : ''}`}
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
                    {displaySafeCoverUrl ? (
                      <img src={displaySafeCoverUrl} alt="" onError={handleDisplayCoverError} />
                    ) : (
                      <Music />
                    )}
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
              className={`lyrics-and-mv-wrapper${isLyricsListHidden ? ' lyrics-and-mv-wrapper--lyrics-hidden' : ''}${!(mvId && config.enableMV && !config.mvAsBackground) ? ' lyrics-and-mv-wrapper--lyrics-solo' : ''}`}
            >
              <div className="lyrics-main-column">
                <div
                  className={`lyrics-quick-actions${lyricsQuickBarDismissed ? ' lyrics-quick-actions--hidden' : ''}`}
                >
                  <div className="lyrics-quick-actions__inner">
                    <span className="lyrics-quick-actions__prompt">{t('lyrics.quickFixPrompt')}</span>
                    <button
                      type="button"
                      className="lyrics-quick-actions__button"
                      onClick={() => openLyricsCandidatePicker()}
                    >
                      {t('lyrics.quickPickManual')}
                    </button>
                    <button
                      type="button"
                      className="lyrics-quick-actions__button"
                      disabled={config.lyricsHidden}
                      title={config.lyricsHidden ? t('lyrics.desktopLyricsHint') : undefined}
                      onClick={() => {
                        if (config.lyricsHidden) return
                        if (isCurrentTrackLyricsTemporarilyHidden) {
                          setTemporarilyHiddenLyricsTrackPath('')
                          setLyricsQuickBarDismissed(false)
                          setLyricsQuickBarActivityAt(Date.now())
                          return
                        }
                        setLyricsQuickBarDismissed(true)
                        setTemporarilyHiddenLyricsTrackPath(currentTrackPath)
                      }}
                    >
                      {isCurrentTrackLyricsTemporarilyHidden
                        ? t('lyrics.quickShowForTrack')
                        : t('lyrics.quickHideForTrack')}
                    </button>
                  </div>
                </div>

                {!isLyricsListHidden && (
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
              </div>

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
              {displaySafeCoverUrl ? (
                <img
                  src={displaySafeCoverUrl}
                  draggable={false}
                  className={`cover-image ${transportIsPlaying ? 'playing' : ''}`}
                  alt={t('lyrics.coverAlt')}
                  onError={handleDisplayCoverError}
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
                  className={`btn btn--transport play-mode-toggle ${playMode === 'shuffle' ? 'is-active' : ''}`}
                  style={{ width: 40, height: 40 }}
                  onClick={() => setPlayMode(playMode === 'shuffle' ? 'loop' : 'shuffle')}
                  aria-pressed={playMode === 'shuffle'}
                >
                  <Shuffle size={18} color="currentColor" />
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
            <div
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: 520,
                marginTop: 12
              }}
            >
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-soft)',
                  pointerEvents: 'none'
                }}
              />
              <input
                ref={settingsSearchInputRef}
                type="text"
                value={settingsQuery}
                onChange={(e) => setSettingsQuery(e.target.value)}
                placeholder={t('settings.searchPlaceholder')}
                style={{
                  width: '100%',
                  padding: '10px 40px 10px 36px',
                  borderRadius: 12,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-secondary)',
                  color: 'inherit',
                  outline: 'none'
                }}
              />
              {settingsQuery ? (
                <button
                  type="button"
                  onClick={() => setSettingsQuery('')}
                  aria-label={t('aria.close')}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    border: 'none',
                    borderRadius: 999,
                    background: 'transparent',
                    color: 'var(--text-soft)',
                    cursor: 'pointer'
                  }}
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="settings-body">
            <nav className="settings-nav" aria-label={t('settings.pageTitle')}>
              {settingsNavItems.map((item) => {
                const Icon = item.icon
                const isActive = activeSettingsSection === item.key
                const isDanger = item.key === 'danger'
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`settings-nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleSettingsNavClick(item.key, item.id)}
                    style={{
                      color: isDanger ? '#ff4d4f' : undefined,
                      borderLeftColor: isActive
                        ? isDanger
                          ? '#ff4d4f'
                          : 'var(--accent-pink)'
                        : 'transparent'
                    }}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </nav>

            <div className="settings-content" ref={settingsContentRef}>
              {!settingsHasResults ? (
                <div
                  style={{
                    textAlign: 'center',
                    opacity: 0.5,
                    fontSize: 14,
                    padding: '24px 0'
                  }}
                >
                  {t('settings.searchNoResults')}
                </div>
              ) : null}
            <div
              id="settings-sec-language"
              data-settings-section="language"
              style={{ display: settingsSectionVisibility.language ? '' : 'none' }}
            >
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
            </div>

            <div
              id="settings-sec-engine"
              data-settings-section="engine"
              style={{ display: settingsSectionVisibility.engine ? '' : 'none' }}
            >
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

              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t('settings.gaplessTitle')}</h3>
                  <p>{t('settings.gaplessDesc')}</p>
                </div>
                <button
                  className={`toggle-btn ${config.gaplessEnabled ? 'active' : ''}`}
                  onClick={() =>
                    setConfig((prev) => ({ ...prev, gaplessEnabled: !prev.gaplessEnabled }))
                  }
                >
                  {config.gaplessEnabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                </button>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t('settings.prevButtonModeTitle')}</h3>
                  <p>{t('settings.prevButtonModeDesc')}</p>
                </div>
                <div className="settings-chip-row">
                  {['playlist', 'history'].map((mode) => (
                    <button
                      key={mode}
                      className={`list-filter-chip ${config.prevButtonMode === mode ? 'active' : ''}`}
                      onClick={() => setConfig((prev) => ({ ...prev, prevButtonMode: mode }))}
                    >
                      {t(`settings.prevButtonMode${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t('settings.crossfadeTitle')}</h3>
                  <p>{t('settings.crossfadeDesc')}</p>
                </div>
                <button
                  className={`toggle-btn ${config.crossfadeEnabled ? 'active' : ''}`}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      crossfadeEnabled: !prev.crossfadeEnabled
                    }))
                  }
                >
                  {config.crossfadeEnabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                </button>
              </div>

              {config.crossfadeEnabled ? (
                <div className="setting-row" style={{ borderTop: 'none', paddingTop: 8 }}>
                  <div className="setting-info">
                    <h3>{t('settings.crossfadeDurationTitle')}</h3>
                    <p>{t('settings.crossfadeDurationDesc')}</p>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      minWidth: 260,
                      justifyContent: 'flex-end'
                    }}
                  >
                    <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>
                      {t('settings.crossfadeSeconds', { count: config.crossfadeDuration })}
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={12}
                      step={1}
                      value={config.crossfadeDuration}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          crossfadeDuration: Math.max(
                            1,
                            Math.min(12, Number.parseInt(e.target.value, 10) || 1)
                          )
                        }))
                      }
                      style={{ width: 160 }}
                    />
                  </div>
                </div>
              ) : null}

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
            </div>

            <div
              id="settings-sec-integrations"
              data-settings-section="integrations"
              style={{ display: settingsSectionVisibility.integrations ? '' : 'none' }}
            >
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
              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t('settings.sleepTimerTitle')}</h3>
                  <p>{t('settings.sleepTimerDesc')}</p>
                  {sleepTimerActive ? (
                    <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-soft)' }}>
                      {config.sleepTimerMode === 'time'
                        ? t('settings.sleepTimerRemaining', {
                            time: formatSleepTimerRemaining(sleepTimerRemainingMs)
                          })
                        : t('settings.sleepTimerArmedTrack')}
                    </p>
                  ) : null}
                </div>
                <div
                  className="settings-chip-row no-drag"
                  style={{
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 8
                  }}
                >
                  {['time', 'track'].map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`list-filter-chip ${config.sleepTimerMode === mode ? 'active' : ''}`}
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          sleepTimerMode: mode
                        }))
                      }
                    >
                      {mode === 'time'
                        ? t('settings.sleepTimerModeTime')
                        : t('settings.sleepTimerModeTrack')}
                    </button>
                  ))}
                  {config.sleepTimerMode === 'time'
                    ? SLEEP_TIMER_MINUTE_OPTIONS.map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          className={`list-filter-chip ${config.sleepTimerMinutes === minutes ? 'active' : ''}`}
                          onClick={() =>
                            setConfig((prev) => ({
                              ...prev,
                              sleepTimerMinutes: minutes
                            }))
                          }
                        >
                          {t('settings.sleepTimerMinutes', { count: minutes })}
                        </button>
                      ))
                    : null}
                  <UiButton
                    variant={sleepTimerActive ? 'ghost' : 'secondary'}
                    size="sm"
                    onClick={() => {
                      if (sleepTimerActive) {
                        cancelSleepTimer()
                        return
                      }
                      startSleepTimer()
                    }}
                  >
                    {sleepTimerActive
                      ? t('settings.sleepTimerCancel')
                      : t('settings.sleepTimerStart')}
                  </UiButton>
                </div>
              </div>
            </section>
            </div>

            <div
              id="settings-sec-eq"
              data-settings-section="eq"
              style={{ display: settingsSectionVisibility.eq ? '' : 'none' }}
            >
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
            </div>

            <div
              id="settings-sec-aesthetics"
              data-settings-section="aesthetics"
              style={{ display: settingsSectionVisibility.aesthetics ? '' : 'none' }}
            >
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
                        {t('settings.customizeTheme')}
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
                              <span style={{ fontSize: 11, opacity: 0.5 }}>0</span>
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
                              <span style={{ fontSize: 11, opacity: 0.5 }}>360</span>
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
                  <h3 style={{ fontSize: 16, fontWeight: 800 }}>
                    {t('settings.customWallpaperDecor')}
                  </h3>
                </div>

                <div
                  className="setting-row"
                  style={{ border: 'none', padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{t('settings.coverSizeTitle', 'Cover size')}</h4>
                    <p>{t('settings.coverSizeDesc', 'Adjust the main player cover size.')}</p>
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
                    <p>{t('settings.bgImageDesc')}</p>
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
                        {t('settings.clear')}
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
                      {config.customBgPath
                        ? t('settings.changeImage')
                        : t('settings.selectImage')}
                    </button>
                  </div>
                </div>

                {config.customBgPath && (
                  <div className="setting-row" style={{ border: 'none', padding: 0 }}>
                    <div className="setting-info">
                      <h4>{t('settings.wallpaperOpacity')}</h4>
                      <p>{t('settings.wallpaperOpacityDesc')}</p>
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
                    <h4>{t('settings.themeDynamicCoverColor', 'Dynamic cover colors')}</h4>
                    <p>{t('settings.themeDynamicCoverColorDesc', 'Use the current track cover as the theme color source.')}</p>
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
                    <h4>{t('settings.themeCoverAsBackground', 'Cover background')}</h4>
                    <p>{t('settings.themeCoverAsBackgroundDesc', 'Use the current playing cover as the background image.')}</p>
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
            </div>

            <div
              id="settings-sec-downloader"
              data-settings-section="downloader"
              style={{ display: settingsSectionVisibility.media ? '' : 'none' }}
            >
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
                  <h3>{t('settings.closeButtonBehaviorTitle')}</h3>
                  <p>{t('settings.closeButtonBehaviorDesc')}</p>
                </div>
                <div className="settings-chip-row no-drag">
                  {['tray', 'quit'].map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`list-filter-chip ${config.closeButtonBehavior === mode ? 'active' : ''}`}
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          closeButtonBehavior: mode
                        }))
                      }
                    >
                      {mode === 'tray'
                        ? t('settings.closeButtonBehaviorTray')
                        : t('settings.closeButtonBehaviorQuit')}
                    </button>
                  ))}
                </div>
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
                          'Remove missing files and stale folder references from the library.'
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
                      : t('settings.libraryCleanupScan', 'Scan library')}
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
                    {t('settings.libraryCleanupRemove', 'Remove missing')}
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
            </div>

            <div
              id="settings-sec-lastfm"
              data-settings-section="lastfm"
              style={{ display: settingsSectionVisibility.lastfm ? '' : 'none' }}
            >
            <section className="settings-section">
              <div className="section-title">
                <Radio size={20} />
                <h2>Last.fm</h2>
              </div>

              {config.lastfmSessionKey ? (
                <>
                  <div className="setting-row">
                    <div className="setting-info">
                      <h3>{t('settings.lastfmConnected', 'Connected')}</h3>
                      <p>@{config.lastfmUsername || 'unknown'}</p>
                    </div>
                    <button
                      className="toggle-btn active"
                      onClick={() => {
                        void window.api?.lastfm?.logout?.()
                        setConfig((prev) => ({
                          ...prev,
                          lastfmEnabled: false,
                          lastfmSessionKey: null,
                          lastfmUsername: null
                        }))
                      }}
                    >
                      {t('settings.lastfmLogout', 'Disconnect')}
                    </button>
                  </div>
                  <div className="setting-row">
                    <div className="setting-info">
                      <h3>{t('settings.lastfmScrobbleTitle', 'Scrobble')}</h3>
                      <p>{t('settings.lastfmScrobbleDesc', 'Send played tracks to Last.fm.')}</p>
                    </div>
                    <button
                      className={`toggle-btn ${config.lastfmEnabled ? 'active' : ''}`}
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          lastfmEnabled: !prev.lastfmEnabled
                        }))
                      }
                    >
                      {config.lastfmEnabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                    </button>
                  </div>
                </>
              ) : (
                <LastFmLoginForm
                  onLogin={(sessionKey, username) => {
                    setConfig((prev) => ({
                      ...prev,
                      lastfmEnabled: true,
                      lastfmSessionKey: sessionKey,
                      lastfmUsername: username
                    }))
                    void window.api?.lastfm?.setSession?.(sessionKey, username)
                  }}
                />
              )}
            </section>
            </div>

            <div
              id="settings-sec-about"
              data-settings-section="about"
              style={{ display: settingsSectionVisibility.about ? '' : 'none' }}
            >
            <section className="settings-section">
              <div className="section-title">
                <Info size={20} />
                <h2>{t('settings.about')}</h2>
              </div>
              <p style={{ opacity: 0.6, fontSize: '14px', lineHeight: 1.6 }}>
                {t('settings.aboutBody')}
              </p>
              <div className="setting-row" style={{ marginTop: 12 }}>
                <div className="setting-info">
                  <h3>{t('settings.autoUpdateTitle', '自动更新')}</h3>
                  <p>{t('settings.autoUpdateDesc', '启动 ECHO 时自动检查并下载可用更新。')}</p>
                </div>
                <button
                  type="button"
                  className={`toggle-btn ${config.autoUpdateEnabled !== false ? 'active' : ''}`}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      autoUpdateEnabled: !(prev.autoUpdateEnabled !== false)
                    }))
                  }
                  aria-pressed={config.autoUpdateEnabled !== false}
                >
                  {config.autoUpdateEnabled !== false ? (
                    <ToggleRight size={32} />
                  ) : (
                    <ToggleLeft size={32} />
                  )}
                </button>
              </div>
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
            </div>

            <div
              id="settings-sec-danger"
              data-settings-section="danger"
              style={{ display: settingsSectionVisibility.danger ? '' : 'none' }}
            >
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
                          {playCount > 0 && ' - Played ' + playCount + ' times'}
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
        albumContext={
          selectedAlbum !== 'all'
            ? {
                name: selectedAlbum,
                artist: albumBuckets.find((a) => a.name === selectedAlbum)?.artist || '',
                existingTracks: albumBuckets.find((a) => a.name === selectedAlbum)?.tracks || []
              }
            : null
        }
        downloadFolder={config?.downloadPath || config?.downloadFolder || ''}
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
        currentTrackTitle={displayMainTitle}
        currentTrackArtist={displayMainArtist}
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
              style={{ backgroundImage: 'url(' + shareCardSnapshot.cover + ')' }}
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
            className={'track-ctx-menu-portal' + (ctxMenuVisualOpen ? ' track-ctx-menu-portal--open' : '')}
            role="menu"
            aria-label={t('aria.trackContextMenu')}
            style={{
              position: 'fixed',
              ...(() => {
                const mw = 220
                const mh = 480
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
              const track = trackContextMenu.track
              const info = parseTrackInfo(track, trackMetaMap[track?.path] || null)
              const inUpNext = upNextPathSet.has(track?.path)
              const trackLine = [info?.title || stripExtension(track?.name || ''), info?.artist]
                .filter(Boolean)
                .join(' - ')
              const removeLabel =
                listMode === 'playlists' && selectedUserPlaylistId
                  ? t('contextMenu.removeFromPlaylist')
                  : t('contextMenu.removeFromQueue')
              const handleRemove = () => {
                if (listMode === 'playlists' && selectedUserPlaylistId) {
                  removePathFromUserPlaylist(selectedUserPlaylistId, track.path)
                } else {
                  removeTrackFromMainPlaylist(track.path)
                }
                closeTrackContextMenuAnimated()
              }
              return (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={() => {
                      openAddToPlaylistAtPoint(
                        trackContextMenu.clientX,
                        trackContextMenu.clientY,
                        track
                      )
                    }}
                  >
                    <Plus size={14} aria-hidden /> {t('contextMenu.addToPlaylist')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={() => {
                      if (inUpNext) {
                        removeFromUpNextQueue(track.path)
                      } else {
                        enqueueUpNextTrack(track)
                      }
                      closeTrackContextMenuAnimated()
                    }}
                  >
                    <SkipForward size={14} aria-hidden />{' '}
                    {inUpNext ? t('contextMenu.removeFromUpNext') : t('contextMenu.playNext')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={handleRemove}
                  >
                    <Minus size={14} aria-hidden /> {removeLabel}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={() => {
                      if (!isLocalAudioFilePath(track?.path)) {
                        closeTrackContextMenuAnimated()
                        return
                      }
                      openMetadataEditorForTrack(track)
                      closeTrackContextMenuAnimated()
                    }}
                    disabled={!isLocalAudioFilePath(track?.path)}
                  >
                    <Tag size={14} aria-hidden /> {t('contextMenu.editMetadata', 'Edit metadata')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={async () => {
                      await revealTrackInFolder(track)
                      closeTrackContextMenuAnimated()
                    }}
                  >
                    <FolderOpen size={14} aria-hidden /> {t('contextMenu.showInFolder')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={async () => {
                      await writeTextToClipboard(track.path || '')
                      closeTrackContextMenuAnimated()
                    }}
                  >
                    <Copy size={14} aria-hidden /> {t('contextMenu.copyPath')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={async () => {
                      await openTrackWithDefaultApp(track)
                      closeTrackContextMenuAnimated()
                    }}
                  >
                    <AppWindow size={14} aria-hidden /> {t('contextMenu.openWithDefaultApp')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={async () => {
                      await writeTextToClipboard(trackLine)
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
                      await handleCopyTrackCardImage(track)
                      closeTrackContextMenuAnimated()
                    }}
                  >
                    <Image size={14} aria-hidden /> {t('contextMenu.copyTrackImage')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item"
                    onClick={async () => {
                      await handleSaveTrackCardImage(track)
                      closeTrackContextMenuAnimated()
                    }}
                  >
                    <Download size={14} aria-hidden /> {t('contextMenu.saveTrackImage')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-ctx-item track-ctx-item--danger"
                    onClick={async () => {
                      closeTrackContextMenuAnimated()
                      await handleDeleteTrackFile(track)
                    }}
                    disabled={!isLocalAudioFilePath(track?.path)}
                  >
                    <Trash2 size={14} aria-hidden /> {t('contextMenu.deleteTrack', 'Delete track')}
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
            className={'track-ctx-menu-portal' + (groupCtxVisualOpen ? ' track-ctx-menu-portal--open' : '')}
            role="menu"
            aria-label={t('aria.groupContextMenu')}
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
              className={'add-to-pl-backdrop' + (addPlVisualOpen ? ' add-to-pl-backdrop--open' : '')}
              aria-hidden
              onMouseDown={() => closeAddToPlaylistAnimated()}
            />
            <div
              className={'add-to-pl-menu-portal' + (addPlVisualOpen ? ' add-to-pl-menu-portal--open' : '')}
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

      {view !== 'settings' && !(showLyrics && hideImmersiveMvChrome) && (
        <div className={'bottom-player-bar no-drag' + (showLyrics ? ' bottom-player-bar--lyrics' : '')}>
          <div className="bottom-bar-left">
            {displaySafeCoverUrl ? (
              <img
                className="bottom-bar-cover"
                src={displaySafeCoverUrl}
                alt=""
                onClick={() => setShowLyrics(true)}
                onError={handleDisplayCoverError}
                draggable={false}
              />
            ) : (
              <div
                className="bottom-bar-cover-fallback"
                onClick={() => setShowLyrics(true)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setShowLyrics(true)
                }}
              >
                <Music size={20} />
              </div>
            )}
            <div className="bottom-bar-meta">
              <div className="bottom-bar-title" onClick={() => setShowLyrics(true)}>
                {displayMainTitle || t('player.selectTrack')}
              </div>
              <div className="bottom-bar-artist">{displayMainArtist || ''}</div>
              <div className="bottom-bar-tech-pills">
                {dlnaUiOn && <span className="mini-pill">DLNA</span>}
                {(currentBottomBarBpm || showBottomBarBpmDetecting) && (
                  <span className="echo-bpm-pill echo-bpm-pill--bottom">
                    {currentBottomBarBpm ? (
                      <>
                        BPM {currentBottomBarBpm}
                        {currentBottomBarAdjustedBpm ? ' -> ' + currentBottomBarAdjustedBpm : ''}
                      </>
                    ) : (
                      'BPM...'
                    )}
                  </span>
                )}
                <AudioQualityBadges
                  variant="player"
                  quality={{
                    codec: technicalInfo.codec || null,
                    bitrateKbps: technicalInfo.bitrate
                      ? Math.round(technicalInfo.bitrate / 1000)
                      : null,
                    sampleRateHz: technicalInfo.sampleRate || null,
                    bitDepth: technicalInfo.bitDepth || currentTrackMeta?.bitDepth || null,
                    channels: technicalInfo.channels || null,
                    isMqa: technicalInfo.isMqa === true || currentTrackMeta?.isMqa === true
                  }}
                />
              </div>
            </div>
          </div>

          <div className="bottom-bar-center">
            <div className="bottom-bar-transport">
              <button
                className={`btn btn--transport play-mode-toggle ${playMode === 'shuffle' ? 'is-active' : ''}`}
                style={{ width: 36, height: 36 }}
                onClick={() => setPlayMode(playMode === 'shuffle' ? 'loop' : 'shuffle')}
                aria-pressed={playMode === 'shuffle'}
              >
                <Shuffle size={16} color="currentColor" />
              </button>
              <button className="btn btn--transport" onClick={handlePrev}>
                <SkipBack size={20} color="var(--text-soft)" />
              </button>
              <button className="btn play-btn" onClick={togglePlay}>
                {transportIsPlaying ? (
                  <Pause size={26} />
                ) : (
                  <Play size={26} style={{ marginLeft: 3 }} />
                )}
              </button>
              <button className="btn btn--transport" onClick={handleNext}>
                <SkipForward size={20} color="var(--text-soft)" />
              </button>
              <button
                className="btn btn--transport"
                style={{ width: 36, height: 36 }}
                onClick={() => setPlayMode(playMode === 'single' ? 'loop' : 'single')}
              >
                {playMode === 'single' ? (
                  <Repeat1 size={16} color="var(--accent-pink)" />
                ) : (
                  <Repeat
                    size={16}
                    color={playMode === 'loop' ? 'var(--accent-pink)' : 'var(--text-soft)'}
                  />
                )}
              </button>
            </div>

            <div className="bottom-bar-progress">
              <span className="bottom-bar-time">{formatTime(displayProgressTime)}</span>
              <input
                type="range"
                className={'player-progress ' + (isProgressDragging ? 'is-dragging' : '')}
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
                      ? Math.min(100, Math.max(0, (displayProgressTime / displayProgressDuration) * 100)) + '%'
                      : '0%'
                }}
              />
              <span className="bottom-bar-time">
                {dlnaUiOn && (!displayProgressDuration || displayProgressDuration <= 0)
                  ? '--:--'
                  : formatTime(displayProgressDuration)}
              </span>
            </div>
          </div>

          <div className="bottom-bar-right">
            {!showLyrics && config.showMiniWaveform && (
              <MiniWaveform analyser={analyserNode.current} isPlaying={isPlaying} />
            )}

            {/* 婵犵數濮烽弫鍛婃叏閻㈠壊鏁婇柡宥庡幖缁愭淇婇妶鍛殲鐎规洘鐓￠弻娑樼暆閳ь剟宕戦悙鍝勭？婵°倐鍋撻柕鍡樺笒椤繈鏁愰崨顒€顥氶梻鍌欐祰椤曟牠宕归婊呯焼濞撴埃鍋撻柛鈺冨仱楠炲鎮╅顫闂佹寧绻傜花鑲╄姳閼恒儯浜滈柡鍌涘婢跺嫮绱掔紒妯肩疄濠殿喒鍋撻梺鎸庣箓閹虫劙宕㈤锔解拺闁告稑锕ラ埛鎰版煟濡や胶鐭嬬紒?*/}
            <button
              className={'btn btn--transport lyrics-toggle ' + (showLyrics ? 'active' : '')}
              style={{ width: 34, height: 34 }}
              onClick={() => setShowLyrics(!showLyrics)}
              title={t('lyrics.toggle')}
            >
              <Mic2 size={16} color={showLyrics ? 'var(--accent-pink)' : 'var(--text-soft)'} />
            </button>

            {/* 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵稿妽闁哄懏绻堥弻鏇熷緞濞戞﹩娲紓浣哄У閸庢娊鍩為幋锔藉亹闁告瑥顦伴幃娆撴⒒?+ 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣椤愪粙鏌ㄩ悢鍝勑㈢痪鎯ь煼閺屾盯鍩勯崘顏佹缂備焦鍔栭〃濠囩嵁閺嶃劍缍囬柛鎾楀啰鐓楅梻浣侯焾椤戝棝骞愭ィ鍐ㄧ疅闁圭虎鍠栫粈瀣亜閹邦喖鏋戦柣蹇撴閺岋絾鎯旈妶搴㈢秷濠电偞褰冪换妯虹暦閺囥垺顥堟繛鎴炵濞堥箖姊虹紒妯诲碍缂併劌鐖煎銊╂寠婢跺棙鏂€闂佺粯蓱瑜板啴鍩€椤掍焦顫楅柕鍥ㄥ姍瀹曪絾寰勫畝鈧惁鍫ユ⒑濮瑰洤鐏叉繛浣冲嫮顩烽柨鏇炲€归悡娆愩亜閺嶃劍鐨戦柣鎺戞憸閳ь剝顫夊ú鎴﹀础閸愬樊鍤曞ù鐘差儛閺佸洭鏌ｉ弬鍨Щ濠㈢懓顑夊缁樻媴缁涘缍堝銈嗘⒐閻楃姴鐣烽弶璇炬棃宕ㄩ鐘靛炊闂備胶纭堕崜婵堢矙閹烘鍋傞柕澶嗘櫆閻撴盯鏌涢妷顔惧帥婵炲牊鏌ㄩ湁婵犲﹤鐗忛悾娲煙椤旂厧妲绘い顓滃姂瀹曠喖顢楅崒姘闂傚倷鑳堕…鍫ユ晝閵堝拋鐒介柨鐔哄У閸嬫ɑ銇勯弴妤€浜惧Δ鐘靛仜濞差參銆佸鈧幃娆撴偨閻㈤潧绁﹂梻鍌氬€风粈浣虹礊婵犲洤纾诲┑鐘叉搐閸屻劌鈹戦崒婊庣劸闁?*/}
            {showLyrics ? (
              <div className="bottom-bar-lyrics-deck">
                <label className="bottom-bar-lyrics-slider">
                  <span>{playbackRate.toFixed(2)}x</span>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    value={playbackRate}
                    onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                    style={{
                      ['--slider-pct']: Math.min(100, Math.max(0, ((playbackRate - 0.5) / 1.5) * 100)) + '%'
                    }}
                  />
                </label>
                <label className="bottom-bar-lyrics-slider">
                  <span>{Math.round(volume * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    style={{
                      ['--slider-pct']: Math.min(100, Math.max(0, volume * 100)) + '%'
                    }}
                  />
                </label>
              </div>
            ) : (
              <div className="bottom-bar-toolset">
                <button
                  className={'btn btn--transport deck-tool-trigger ' + (activeDeckPopover === 'volume' ? 'active' : '')}
                  onClick={() =>
                    setActiveDeckPopover((value) => (value === 'volume' ? null : 'volume'))
                  }
                  title={t('player.vol')}
                >
                  {volume <= 0.001 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <button
                  className={'btn btn--transport deck-tool-trigger ' + (activeDeckPopover === 'speed' ? 'active' : '')}
                  onClick={() =>
                    setActiveDeckPopover((value) => (value === 'speed' ? null : 'speed'))
                  }
                  title={t('player.speed')}
                >
                  <Gauge size={16} />
                </button>
                <button
                  className="btn btn--transport deck-tool-trigger deck-tool-export"
                  onClick={() => {
                    handleExport()
                    setActiveDeckPopover(null)
                  }}
                  disabled={isExporting || !currentTrack}
                  title={t('player.exportButton')}
                >
                  <FileOutput size={16} />
                </button>
              </div>
            )}

            {/* 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧鏌ｉ幇顒佹儓缂佺姵姘ㄩ埀顒€鍘滈崑鎾绘煕閺囥劌浜為柣娑栧劦濮婃椽宕崟顓涙瀱闂佸憡眉缁瑥鐣烽弴銏犵婵犮垺绻傜紞濠囧箖閳╁啯鍎熼柨婵嗘閸犳牗淇婇悙顏勨偓鎴﹀磿闁秵鍋嬮柟鎹愵嚙閽冪喖鏌￠崶椋庣？闁汇倐鍋撳┑鐘垫暩婵挳宕愰幖浣哥厱濠㈣泛鐬肩壕?闂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛顐ｆ礀绾惧鏌曟繛鐐珔缁炬儳娼￠弻锛勪沪鐠囨彃濮庨梺钘夊暟閸犳牠寮婚妸鈺傚亜闁告繂瀚呴姀銈嗙厽?-createPortal 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗ù锝夋交閼板潡姊洪鈧粔顕€鍩€椤掑﹦鐣电€规洖銈告俊鐑藉Ψ瑜濈槐顕€姊绘担鍝ョШ婵☆偉娉曠划鍫熺瑹閳ь剙顕?body闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏃堟暜閸嬫挾绮☉妯诲櫧闁活厽鐟╅弻鐔告綇妤ｅ啯顎嶉梺绋垮濡啴寮婚妶鍚ゅ湱鈧綆鍋呴悵鏃堟⒑閹肩偛濡界紒璇插暣婵＄敻宕熼姘辩杸闂佸疇妗ㄩ懗鍫曞礉閹绢喗鈷戦柟鑲╁仜閳ь剚鐗曠叅闁绘梻鍘ч拑?backdrop-filter 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偛顦甸弫鎾绘偐閸愯弓缃曢梻浣告惈濞层垽宕归崷顓犱笉闁绘顕х粻瑙勭箾閿濆骸澧┑陇鍋愮槐鎺楁偐閸愭彃鎽甸梺鍝勬湰閻╊垶銆侀弴銏″亹闁圭粯甯掗～鎾绘⒒閸屾瑦绁伴柨鐔村劦瀹曟劙寮介妸褉鏀虫繝鐢靛Т濞层倕娲块梻浣告啞娓氭宕伴弽褉鏋嶉柕鍫濐槹閳锋垿鏌熺粙鎸庢崳闁愁垱娲熼弻锝呂旀担鍦槷-*/}
            {!showLyrics && activeDeckPopover && createPortal(
              <div
                className={'deck-popover deck-popover--bottom-tools deck-popover--' + activeDeckPopover}
              >
                {activeDeckPopover === 'volume' ? (
                  <div className="deck-popover-row deck-popover-volume-row">
                    <div className="deck-popover-label">
                      <span>{t('player.vol')}</span>
                      <span>{Math.round(volume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      className="deck-popover-slider"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(e) => setVolume(parseFloat(e.target.value))}
                    />
                  </div>
                ) : (
                  <div className="deck-popover-row deck-popover-speed-row">
                    <div className="deck-popover-label">
                      <span>{t('player.speed')}</span>
                      <span>{playbackRate.toFixed(2)}x</span>
                    </div>
                    <div className="deck-popover-control-row">
                      <input
                        type="range"
                        className="deck-popover-slider"
                        min={0.5}
                        max={2.0}
                        step={0.05}
                        value={playbackRate}
                        onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                      />
                      <button
                        className="deck-popover-btn deck-popover-speed-reset"
                        onClick={() => setPlaybackRate(1.0)}
                        title={t('player.resetSpeed') || 'Reset speed'}
                      >
                        <RotateCcw size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>,
              document.body
            )}

            <PluginSlot
              name="playerTransportExtras"
              context={playerTransportPluginContext}
              className="no-drag transport-plugin-slot"
              style={{ display: 'flex', alignItems: 'center' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function trimMapCache(ref, maxEntries) {
  if (!ref?.current || !(ref.current instanceof Map) || ref.current.size <= maxEntries) return
  while (ref.current.size > maxEntries) {
    const firstKey = ref.current.keys().next().value
    if (firstKey === undefined) break
    ref.current.delete(firstKey)
  }
}
