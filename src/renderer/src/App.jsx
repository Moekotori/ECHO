import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  memo,
  startTransition,
} from "react";
import { createPortal } from "react-dom";
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
  Minus,
  ListMusic,
  ListPlus,
  Plus,
  Upload,
  Pencil,
  MoreHorizontal,
  Film,
  Radio,
} from "lucide-react";
import LyricsSettingsDrawer from "./components/LyricsSettingsDrawer";
import MediaDownloaderDrawer from "./components/MediaDownloaderDrawer";
import MvSettingsDrawer from "./components/MvSettingsDrawer";
import CastReceiveDrawer from "./components/CastReceiveDrawer";
import { parseAnyLyrics } from "./utils/lyricsParse";
import {
  PRESET_THEMES,
  hexToRgbStr,
  generateRandomPalette,
} from "./utils/color";
import {
  FONT_STACKS,
  normalizeThemeColors,
  getAppThemeBackgroundStyle,
} from "./utils/themeColors";
import {
  pickThemeExportSlice,
  mergeThemeImport,
  parseThemeBundleJson,
} from "./utils/themeBundle";
import {
  parseTrackInfo,
  compareTrackOrder,
  stripExtension,
  parseArtistTitleFromName,
} from "./utils/trackUtils";
import { ArtistLink } from "./components/ArtistLink";
import { AlbumCoverLink } from "./components/AlbumCoverLink";
import { MiniWaveform } from "./components/MiniWaveform";
import { EqPlot } from "./components/EqPlot";
import { EQ_PRESETS } from "./constants/eq";
import { DEFAULT_CONFIG } from "./config/defaultConfig";
import {
  normalizeImportedPlaylists,
  buildPlaylistsExportPayload,
} from "./utils/userPlaylists";
import { t as translate, normalizeLocale } from "./i18n";

const AlbumSidebarCard = memo(function AlbumSidebarCard({
  album,
  isSelected,
  onPickAlbum,
  tr,
  locale,
}) {
  return (
    <button
      type="button"
      className={`album-card ${isSelected ? "active" : ""}`}
      onClick={() => onPickAlbum(album)}
      title={`${album.name} (${album.tracks.length} ${tr ? tr("tracks", "首") : "tracks"})`}
    >
      {album.cover ? (
        <img
          src={album.cover}
          alt={album.name}
          className="album-cover-image"
          loading="lazy"
          decoding="async"
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
              locale={locale}
            />
          </span>
          <span className="album-subtitle-sep">·</span>
          <span className="album-subtitle-count">
            {album.tracks.length} {tr ? tr("tracks", "首") : "tracks"}
          </span>
        </div>
      </div>
    </button>
  );
});

export default function App() {
  const [playlist, setPlaylist] = useState(() => {
    const saved = localStorage.getItem("nc_playlist");
    return saved ? JSON.parse(saved) : [];
  });
  const [playMode, setPlayMode] = useState(() => {
    return localStorage.getItem("nc_playmode") || "loop";
  });

  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [coverUrl, setCoverUrl] = useState(null);

  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [volume, setVolume] = useState(1.0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const isSeekingRef = useRef(false);
  useEffect(() => {
    isSeekingRef.current = isSeeking;
  }, [isSeeking]);
  const seekTimerRef = useRef(null);
  const [isPresetOpen, setIsPresetOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // MV State
  const [mvId, setMvId] = useState(null);
  const [isSearchingMV, setIsSearchingMV] = useState(false);
  const [youtubeMvLoginHint, setYoutubeMvLoginHint] = useState(false);
  const [signInStatus, setSignInStatus] = useState({
    youtube: false,
    bilibili: false,
  });
  const [biliDirectStream, setBiliDirectStream] = useState(null);

  useEffect(() => {
    const refresh = () => {
      window.api
        ?.checkSignInStatus?.()
        .then((s) => {
          if (s) setSignInStatus(s);
        })
        .catch(() => {});
    };
    refresh();
    const unsub = window.api?.onSignInStatusChanged?.(refresh);
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  // Lyrics States
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState([]);
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1);
  const [lyricsDrawerOpen, setLyricsDrawerOpen] = useState(false);
  const [downloaderDrawerOpen, setDownloaderDrawerOpen] = useState(false);
  const [mvDrawerOpen, setMvDrawerOpen] = useState(false);
  const [castDrawerOpen, setCastDrawerOpen] = useState(false);
  const [castRemoteActive, setCastRemoteActive] = useState(false);
  const [castDlnaListening, setCastDlnaListening] = useState(false);
  /** 主进程合并的投流状态（含 dlnaMeta、进度），用于主页展示 DLNA 歌曲信息 */
  const [lastCastStatus, setLastCastStatus] = useState(null);
  const [mvPlaybackQuality, setMvPlaybackQuality] = useState(null);
  const [lyricsMatchStatus, setLyricsMatchStatus] = useState("idle");
  /** 与 lyrics 等长：主行罗马音（LRC 自带或 Kuroshiro 生成） */
  const [romajiDisplayLines, setRomajiDisplayLines] = useState([]);
  const [metadata, setMetadata] = useState({ title: "", artist: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [listMode, setListMode] = useState("songs");
  const [userPlaylists, setUserPlaylists] = useState(() => {
    try {
      const s = localStorage.getItem("nc_user_playlists");
      if (!s) return [];
      const p = JSON.parse(s);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  });
  const [selectedUserPlaylistId, setSelectedUserPlaylistId] = useState(null);
  const [playlistLibraryMoreOpen, setPlaylistLibraryMoreOpen] = useState(false);
  const playlistLibraryMoreRef = useRef(null);
  /** { originalIdx, path, top, left, width } | null — 浮层用 fixed + portal，避免被侧边栏裁切 */
  const [addToPlaylistMenu, setAddToPlaylistMenu] = useState(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [quickNewPlaylistName, setQuickNewPlaylistName] = useState("");
  const [selectedAlbum, setSelectedAlbum] = useState("all");
  const [trackMetaMap, setTrackMetaMap] = useState({});
  const [technicalInfo, setTechnicalInfo] = useState({
    sampleRate: null,
    originalBpm: null,
    channels: null,
    bitrate: null,
    codec: null,
  });
  const [isConverting, setIsConverting] = useState(false);
  const [conversionMsg, setConversionMsg] = useState("");
  const [audioDevices, setAudioDevices] = useState([]);

  // Hi-Fi & Navigation States
  const [view, setView] = useState("player"); // 'player', 'lyrics', 'settings'
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem("nc_config");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          customColors: normalizeThemeColors({
            ...DEFAULT_CONFIG.customColors,
            ...(parsed.customColors || {}),
          }),
        };
      } catch (e) {
        return DEFAULT_CONFIG;
      }
    }
    return DEFAULT_CONFIG;
  });

  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const locale = useMemo(
    () => normalizeLocale(config.language),
    [config.language],
  );
  const t = useCallback((key, vars) => translate(locale, key, vars), [locale]);
  const tr = useCallback(
    (en, zhCN) => (locale === "zh-CN" ? zhCN : en),
    [locale],
  );
  const noLyricsFoundText = tr("No lyrics found", "未找到歌词");
  if (!t || t === "No lyrics found" || t === "未找到歌词") return;

  const themeBackdropStyle = useMemo(() => {
    const raw =
      config.theme === "custom" && config.customColors
        ? config.customColors
        : PRESET_THEMES[config.theme]?.colors || PRESET_THEMES.sakura.colors;
    return getAppThemeBackgroundStyle(
      raw,
      config.uiAccentBackgroundGlow !== false,
    );
  }, [config.theme, config.customColors, config.uiAccentBackgroundGlow]);

  const handleResetAllConfig = () => {
    if (confirm(t("app.resetConfirm"))) {
      setConfig(DEFAULT_CONFIG);
      localStorage.removeItem("nc_config");
    }
  };

  useEffect(() => {
    localStorage.setItem("nc_config", JSON.stringify(config));

    const root = document.documentElement;

    let rawTheme = PRESET_THEMES.sakura.colors;
    if (config.theme === "custom" && config.customColors) {
      rawTheme = config.customColors;
    } else if (PRESET_THEMES[config.theme]) {
      rawTheme = PRESET_THEMES[config.theme].colors;
    }
    const activeTheme = normalizeThemeColors(rawTheme);

    root.style.setProperty("--bg-color", activeTheme.bgColor);
    root.style.setProperty("--bg-gradient-end", activeTheme.bgGradientEnd);
    root.style.setProperty(
      "--bg-gradient-angle",
      `${activeTheme.bgGradientAngle}deg`,
    );
    root.style.setProperty("--accent-pink", activeTheme.accent1);
    root.style.setProperty("--accent-blue", activeTheme.accent2);
    root.style.setProperty("--accent-mint", activeTheme.accent3);
    root.style.setProperty("--text-main", activeTheme.textMain);
    root.style.setProperty("--text-soft", activeTheme.textSoft);

    const fontKey = config.uiFontFamily || "outfit";
    const customFontStack = (config.uiCustomFontFamily || "").trim();
    const resolvedFontStack =
      fontKey === "custom"
        ? customFontStack || FONT_STACKS.system
        : FONT_STACKS[fontKey] || FONT_STACKS.outfit;
    root.style.setProperty("--font-family-main", resolvedFontStack);

    const baseFs = config.uiBaseFontSize ?? 15;
    root.style.fontSize = `${baseFs}px`;

    const rs = config.uiRadiusScale ?? 1;
    root.style.setProperty("--border-radius-lg", `${24 * rs}px`);
    root.style.setProperty("--border-radius-md", `${16 * rs}px`);
    root.style.setProperty("--border-radius-sm", `${8 * rs}px`);

    const uiOpa = config.uiBgOpacity !== undefined ? config.uiBgOpacity : 0.6;
    const uiBlur = config.uiBlur !== undefined ? config.uiBlur : 20;
    const glassRgbStr = hexToRgbStr(activeTheme.glassColor || "#ffffff");

    root.style.setProperty("--glass-bg", `rgba(${glassRgbStr}, ${uiOpa})`);
    root.style.setProperty(
      "--glass-border",
      `rgba(${glassRgbStr}, ${Math.min(uiOpa + 0.2, 1)})`,
    );
    root.style.setProperty("--glass-blur", `${uiBlur}px`);

    const isDark =
      activeTheme.glassColor !== "#ffffff" &&
      parseInt(String(glassRgbStr).split(",")[0].trim(), 10) < 100;
    const shadowMul = config.uiShadowIntensity ?? 1;
    const baseA = isDark ? 0.4 : 0.2;
    root.style.setProperty(
      "--shadow-color",
      isDark
        ? `rgba(0, 0, 0, ${Math.min(0.62, baseA * shadowMul)})`
        : `rgba(200, 180, 190, ${Math.min(0.42, baseA * shadowMul)})`,
    );

    const sat = config.uiSaturation ?? 1;
    root.style.filter = sat !== 1 && sat > 0 ? `saturate(${sat})` : "";
  }, [config]);

  const audioRef = useRef(new Audio());
  const playbackRateRef = useRef(playbackRate);

  // Web Audio Refs
  const audioContext = useRef(null);
  const sourceNode = useRef(null);
  const analyserNode = useRef(null);
  const gainNode = useRef(null);
  const preampNode = useRef(null);
  const eqFilters = useRef([]);
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  // Initialize Web Audio
  const initAudioContext = useCallback(() => {
    if (audioContext.current) return;

    const Context = window.AudioContext || window.webkitAudioContext;
    const ctx = new Context();
    audioContext.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; // High resolution for pro RTA
    analyser.smoothingTimeConstant = 0.85; // Fluid motion
    analyserNode.current = analyser;

    const gain = ctx.createGain();
    gainNode.current = gain;

    const preamp = ctx.createGain();
    preamp.gain.value = Math.pow(10, (config.preamp || 0) / 20);
    preampNode.current = preamp;

    // Create Parametric EQ chain
    const filters = config.eqBands.map((band) => {
      const filter = ctx.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.freq;
      filter.Q.value = band.q;
      filter.gain.value = config.useEQ && band.enabled ? band.gain : 0;
      return filter;
    });
    eqFilters.current = filters;

    const source = ctx.createMediaElementSource(audioRef.current);
    sourceNode.current = source;

    // Connect chain: Source -> Preamp -> EQ... -> Analyser -> Gain -> Destination
    source.connect(preamp);
    let lastNode = preamp;
    filters.forEach((f) => {
      lastNode.connect(f);
      lastNode = f;
    });

    lastNode.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);
  }, [config.useEQ, config.eqBands, config.preamp]);

  useEffect(() => {
    // Update EQ Filters in real-time
    const now = audioContext.current?.currentTime || 0;
    if (preampNode.current) {
      preampNode.current.gain.setTargetAtTime(
        Math.pow(10, (config.preamp || 0) / 20),
        now,
        0.05,
      );
    }
    if (
      eqFilters.current.length > 0 &&
      eqFilters.current.length === config.eqBands.length
    ) {
      eqFilters.current.forEach((filter, i) => {
        const band = config.eqBands[i];
        if (filter.type !== band.type) filter.type = band.type;
        filter.frequency.setTargetAtTime(band.freq, now, 0.05);
        filter.Q.setTargetAtTime(band.q, now, 0.05);
        filter.gain.setTargetAtTime(
          config.useEQ && band.enabled ? band.gain : 0,
          now,
          0.05,
        );
      });
    }
  }, [config.eqBands, config.useEQ, config.preamp]);

  // Persist playlist and mode
  useEffect(() => {
    localStorage.setItem("nc_playlist", JSON.stringify(playlist));
  }, [playlist]);

  useEffect(() => {
    localStorage.setItem("nc_playmode", playMode);
  }, [playMode]);

  useEffect(() => {
    localStorage.setItem("nc_user_playlists", JSON.stringify(userPlaylists));
  }, [userPlaylists]);

  // Update playback speed whenever it changes
  useEffect(() => {
    playbackRateRef.current = playbackRate;
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Update volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Audio setup
  useEffect(() => {
    const audio = audioRef.current;
    audio.preservesPitch = false; // THE MAGIC: disabling pitch preservation!

    const setAudioData = () => {
      setDuration(audio.duration);
      audio.playbackRate = playbackRateRef.current; // Preserves NC speed naturally!
    };
    const updateTime = () => {
      if (isSeekingRef.current) return;
      const time = audio.currentTime;
      setCurrentTime(time);

      // Update active lyric index（含歌词时间轴微调 ms → s）
      if (lyricsRef.current.length > 0) {
        const offsetSec = (configRef.current.lyricsOffsetMs ?? 0) / 1000;
        let index = -1;
        for (let i = 0; i < lyricsRef.current.length; i++) {
          if (time + 1e-9 >= lyricsRef.current[i].time + offsetSec) {
            index = i;
          } else {
            break;
          }
        }
        setActiveLyricIndex(index);
      }
    };
    const onEnded = () => {
      if (playMode === "single") {
        const audio = audioRef.current;
        audio.currentTime = 0;
        audio.play().catch(console.error);
      } else {
        handleNext();
      }
    };

    audio.addEventListener("loadeddata", setAudioData);
    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("loadeddata", setAudioData);
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, [playlist, currentIndex, playMode]);
  // Play track logic
  useEffect(() => {
    if (currentIndex >= 0 && playlist[currentIndex]) {
      const track = playlist[currentIndex];
      // Use local file path
      audioRef.current.src = `file://${track.path}`;
      audioRef.current.load();
      if (isPlaying) {
        audioRef.current.play().catch(console.error);
      }

      // Load cover art & Metadata & Lyrics
      loadTrackData(track.path);
    }
  }, [currentIndex]);

  useEffect(() => {
    if (window.api?.getAudioDevices) {
      window.api.getAudioDevices().then(setAudioDevices);
    }
  }, []);

  useEffect(() => {
    if (!window.api?.cast?.onPauseLocal) return;
    return window.api.cast.onPauseLocal(() => {
      setIsPlaying(false);
      if (audioRef.current) audioRef.current.pause();
    });
  }, []);

  useEffect(() => {
    if (window.api?.cast?.getStatus) {
      window.api.cast.getStatus().then((s) => {
        setLastCastStatus(s);
        setCastDlnaListening(!!s.dlnaEnabled);
        const dlnaActive =
          s.dlnaEnabled &&
          (s.transportState === "PLAYING" ||
            s.transportState === "PAUSED_PLAYBACK");
        setCastRemoteActive(dlnaActive);
      });
    }
  }, []);

  useEffect(() => {
    if (!window.api?.cast?.onStatus) return;
    return window.api.cast.onStatus((s) => {
      setLastCastStatus(s);
      setCastDlnaListening(!!s.dlnaEnabled);
      const dlnaActive =
        s.dlnaEnabled &&
        (s.transportState === "PLAYING" ||
          s.transportState === "PAUSED_PLAYBACK");
      setCastRemoteActive(dlnaActive);
    });
  }, []);

  useEffect(() => {
    if (!castRemoteActive || !window.api?.setAudioVolume) return;
    window.api.setAudioVolume(volume);
  }, [volume, castRemoteActive]);

  // Hi-Fi Native Audio Status Listener
  useEffect(() => {
    if (config.nativeDeviceId !== null && window.api?.onAudioStatus) {
      window.api.onAudioStatus((status) => {
        if (isSeeking) return; // Skip updates during manual seek to prevent jitter

        if (status && status.filePath === playlist[currentIndex]?.path) {
          setIsPlaying(status.isPlaying);
          setCurrentTime(status.currentTime);

          // Update active lyric index（含歌词时间轴微调）
          if (lyricsRef.current.length > 0) {
            const offsetSec = (configRef.current.lyricsOffsetMs ?? 0) / 1000;
            const t = status.currentTime;
            let index = -1;
            for (let i = 0; i < lyricsRef.current.length; i++) {
              if (t + 1e-9 >= lyricsRef.current[i].time + offsetSec) {
                index = i;
              } else {
                break;
              }
            }
            setActiveLyricIndex(index);
          }
        }
      });
    }
  }, [currentIndex, playlist, isSeeking]);

  useEffect(() => {
    if (isPlaying) {
      initAudioContext();
      if (audioContext.current?.state === "suspended") {
        audioContext.current.resume();
      }
      audioRef.current.play().catch(console.error);
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, initAudioContext]);

  const lyricsRef = useRef([]);
  const scrollAreaRef = useRef(null);

  useEffect(() => {
    lyricsRef.current = lyrics;
  }, [lyrics]);

  useEffect(() => {
    if (showLyrics && activeLyricIndex !== -1 && scrollAreaRef.current) {
      const activeElement =
        scrollAreaRef.current.querySelector(".lyric-line.active");
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [activeLyricIndex, showLyrics]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || lyricsRef.current.length === 0) return;
    const time = audio.currentTime;
    const offsetSec = (config.lyricsOffsetMs ?? 0) / 1000;
    let index = -1;
    for (let i = 0; i < lyricsRef.current.length; i++) {
      if (time + 1e-9 >= lyricsRef.current[i].time + offsetSec) index = i;
      else break;
    }
    setActiveLyricIndex(index);
  }, [config.lyricsOffsetMs]);

  useEffect(() => {
    if (!config.lyricsShowRomaji) {
      setRomajiDisplayLines([]);
      return;
    }
    let cancelled = false;
    (async () => {
      if (!lyrics.length) {
        setRomajiDisplayLines([]);
        return;
      }
      const merged = new Array(lyrics.length).fill("");
      const batch = [];
      const batchLineIdx = [];
      lyrics.forEach((l, i) => {
        if (l.romaji) {
          merged[i] = (l.romaji || "").trim();
          return;
        }
        const t = (l.text || "").trim();
        if (!t || t === "No lyrics found") return;
        batch.push(t);
        batchLineIdx.push(i);
      });
      if (batch.length > 0 && window.api?.toRomajiBatch) {
        try {
          const converted = await window.api.toRomajiBatch(batch);
          batchLineIdx.forEach((lineIdx, j) => {
            merged[lineIdx] = ((converted && converted[j]) || "").trim();
          });
        } catch (e) {
          console.error("toRomajiBatch", e);
        }
      }
      if (!cancelled) setRomajiDisplayLines(merged);
    })();
    return () => {
      cancelled = true;
    };
  }, [lyrics, config.lyricsShowRomaji]);

  const cleanTitleForSearch = (rawTitle = "") => {
    if (!rawTitle) return "";
    let s = rawTitle;
    // Remove common noise words (cover, 翻唱, remix, live, ver., version, ft., feat.)
    s = s.replace(/\(.*?翻唱.*?\)|（.*?翻唱.*?）/gi, "");
    s = s.replace(/\bcover\b/gi, "");
    s = s.replace(/\b翻唱\b/gi, "");
    s = s.replace(/\bremix\b/gi, "");
    s = s.replace(/\blive\b/gi, "");
    s = s.replace(/\bver\.?\b/gi, "");
    s = s.replace(/\bversion\b/gi, "");
    s = s.replace(/\bfeat\.?\b/gi, "");
    s = s.replace(/\bft\.?\b/gi, "");
    // Remove bracketed translator/arranger notes
    s = s.replace(/\[.*?\]/g, "");
    s = s.replace(/\(.*?\)/g, "");
    // Collapse extra spaces and punctuation
    s = s.replace(/[~`"'·、，。]/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  };

  const searchBilibiliMv = useCallback(async (title = "", artist = "") => {
    if (!window.api?.searchMVHandler) return null;

    const safeTitle = cleanTitleForSearch(title || "");
    const safeArtist = (artist || "").trim();
    const queries = [
      safeArtist ? `${safeTitle} ${safeArtist} MV` : `${safeTitle} MV`,
      safeArtist ? `${safeTitle} ${safeArtist} 官方` : `${safeTitle} 官方MV`,
      `${safeTitle} ${safeArtist}`.trim(),
      safeTitle,
    ].filter((q) => q && q.trim());

    for (const q of queries) {
      try {
        const result = await window.api.searchMVHandler(q.trim(), "bilibili");
        if (result) {
          const id = typeof result === "string" ? result : result.id;
          if (id) return id;
        }
      } catch (_) {
        // try next query
      }
    }

    return null;
  }, []);

  const retryFetchLyrics = async () => {
    const track = playlist[currentIndex];
    if (!track) return;
    const metaTitle =
      metadata.title || (track ? stripExtension(track.name) : "");
    const metaArtist = metadata.artist || track?.info?.artist || "";
    const cleaned = cleanTitleForSearch(metaTitle);
    try {
      await fetchLyrics(track.path, cleaned || metaTitle, metaArtist, {
        album: track.info?.album || "",
        embeddedLyrics: track.info?.lyrics || null,
      });
    } catch (e) {
      console.error("Retry fetchLyrics error", e);
    }
  };

  const applyLyricsFromText = useCallback((raw) => {
    const parsed = parseAnyLyrics(raw);
    if (parsed.length > 0) {
      setLyrics(parsed);
      setLyricsMatchStatus("matched");
      setActiveLyricIndex(-1);
    }
  }, []);

  const pickLyricsFileNative = useCallback(async () => {
    if (!window.api?.openLyricsFileHandler || !window.api?.readBufferHandler)
      return;
    const path = await window.api.openLyricsFileHandler();
    if (!path) return;
    const buf = await window.api.readBufferHandler(path);
    if (!buf) return;
    let u8;
    if (buf instanceof Uint8Array) u8 = buf;
    else if (buf instanceof ArrayBuffer) u8 = new Uint8Array(buf);
    else if (Array.isArray(buf)) u8 = new Uint8Array(buf);
    else if (buf?.data && Array.isArray(buf.data))
      u8 = new Uint8Array(buf.data);
    else u8 = new Uint8Array(buf);
    const text = new TextDecoder("utf-8").decode(u8);
    applyLyricsFromText(text);
  }, [applyLyricsFromText]);

  const pickLyricsFromLrcLibResult = (payload, audioDuration) => {
    if (!payload) return "";

    const candidates = Array.isArray(payload) ? payload : [payload];
    const withSynced = candidates.filter((c) => c?.syncedLyrics?.trim());

    if (withSynced.length > 0 && audioDuration && audioDuration > 0) {
      const scored = withSynced
        .map((c) => ({
          item: c,
          diff: c.duration ? Math.abs(c.duration - audioDuration) : 9999,
        }))
        .sort((a, b) => a.diff - b.diff);
      const best = scored[0];
      if (best.diff < 9999) {
        console.log(
          `[Lyrics] Picked duration-matched result: diff=${best.diff.toFixed(1)}s (audio=${audioDuration.toFixed(1)}s, lyrics=${best.item.duration}s)`,
        );
      }
      return best.item.syncedLyrics.trim();
    }

    for (const item of withSynced) {
      return item.syncedLyrics.trim();
    }

    for (const item of candidates) {
      const plain = item?.plainLyrics?.trim() || item?.lyrics?.trim();
      if (plain) return plain;
    }

    return "";
  };

  const requestLrcLib = async (url) => {
    const response = await fetch(url);
    if (!response.ok) return null;
    return response.json();
  };

  const fetchLyrics = async (filePath, title, artist, hints = {}) => {
    setLyrics([]);
    setActiveLyricIndex(-1);
    setLyricsMatchStatus("loading");

    // MV Search
    if (
      window.api.searchMVHandler &&
      (configRef.current.enableMV || configRef.current.mvAsBackground)
    ) {
      setIsSearchingMV(true);
      setMvId(null);
      try {
        let foundId = null;
        let mvSource = configRef.current.mvSource || "youtube";
        const isPackagedFileProtocol =
          typeof window !== "undefined" &&
          window.location?.protocol === "file:";

        // Try reading yt-dlp local JSON for exact MV match
        const infoJson = await window.api
          .readInfoJsonHandler(filePath)
          .catch(() => null);
        if (infoJson) {
          if (
            infoJson.extractor &&
            infoJson.extractor.toLowerCase().includes("youtube")
          ) {
            foundId = infoJson.id;
            mvSource = "youtube";
          } else if (
            infoJson.extractor &&
            infoJson.extractor.toLowerCase().includes("bilibili")
          ) {
            // bvid or aid
            foundId = infoJson.id;
            mvSource = "bilibili";
          }
        }

        if (!foundId && title) {
          const cleanedTitle = cleanTitleForSearch(title);
          const mvQuery =
            mvSource === "bilibili"
              ? `${cleanedTitle} ${artist || ""} MV`.trim()
              : `${cleanedTitle} ${artist || ""} official mv`.trim();
          const searchResult = await window.api.searchMVHandler(
            mvQuery,
            mvSource,
          );
          if (searchResult) {
            if (typeof searchResult === "string") {
              foundId = searchResult;
            } else {
              foundId = searchResult.id;
              if (searchResult.source) mvSource = searchResult.source;
              console.log(
                `[MV] ${mvSource}: "${searchResult.title || "?"}" | id=${foundId}${searchResult.resolution ? ` | source_res=${searchResult.resolution}` : ""}`,
              );
            }
          }
        }

        // 打包后 file:// 场景下 YouTube 更容易触发 153，这里优先尝试预降级到 B 站。
        if (
          foundId &&
          mvSource === "youtube" &&
          isPackagedFileProtocol &&
          configRef.current.autoFallbackToBilibili
        ) {
          const bilibiliId = await searchBilibiliMv(title || "", artist || "");
          if (bilibiliId) {
            foundId = bilibiliId;
            mvSource = "bilibili";
            console.warn(
              "[MV Fallback] Pre-fallback in packaged mode: YouTube -> Bilibili",
            );
          }
        }

        if (foundId) {
          setMvId({ id: foundId, source: mvSource });
        }
      } catch (e) {
        console.error("MV search error", e);
      } finally {
        setIsSearchingMV(false);
      }
    }

    // 1. Try local LRC
    try {
      const localLrc = await window.api.readLyricsHandler(filePath);
      if (localLrc) {
        const parsed = parseAnyLyrics(localLrc);
        if (parsed.length > 0) {
          setLyrics(parsed);
          setLyricsMatchStatus("matched");
          return;
        }
      }
    } catch (e) {
      console.error("Local LRC error", e);
    }

    // 1.5 Try embedded metadata lyrics
    if (hints?.embeddedLyrics) {
      const embeddedParsed = parseAnyLyrics(hints.embeddedLyrics);
      if (embeddedParsed.length > 0) {
        setLyrics(embeddedParsed);
        setLyricsMatchStatus("matched");
        return;
      }
    }

    const lyricsSource = configRef.current.lyricsSource || "lrclib";
    const useOnlineLyrics =
      lyricsSource !== "local" &&
      ["lrclib", "netease", "qq"].includes(lyricsSource);

    const audioDur = audioRef.current?.duration || duration || 0;

    if (title && useOnlineLyrics) {
      try {
        const params = new URLSearchParams({
          track_name: title,
          artist_name: artist || "",
        });
        if (hints?.album) params.set("album_name", hints.album);
        if (audioDur > 0) params.set("duration", String(Math.round(audioDur)));

        const directData = await requestLrcLib(
          `https://lrclib.net/api/get?${params.toString()}`,
        );
        const directLyrics = pickLyricsFromLrcLibResult(directData, audioDur);
        const parsedDirect = parseAnyLyrics(directLyrics);
        if (parsedDirect.length > 0) {
          setLyrics(parsedDirect);
          setLyricsMatchStatus("matched");
          return;
        }

        const queryFull = encodeURIComponent(`${title} ${artist || ""}`.trim());
        const searchData = await requestLrcLib(
          `https://lrclib.net/api/search?q=${queryFull}`,
        );
        const searchedLyrics = pickLyricsFromLrcLibResult(searchData, audioDur);
        const parsedSearch = parseAnyLyrics(searchedLyrics);
        if (parsedSearch.length > 0) {
          setLyrics(parsedSearch);
          setLyricsMatchStatus("matched");
          return;
        }

        if (artist && artist !== "Unknown Artist") {
          const queryTitleOnly = encodeURIComponent(title.trim());
          const titleOnlyData = await requestLrcLib(
            `https://lrclib.net/api/search?q=${queryTitleOnly}`,
          );
          const titleOnlyLyrics = pickLyricsFromLrcLibResult(
            titleOnlyData,
            audioDur,
          );
          const parsedTitleOnly = parseAnyLyrics(titleOnlyLyrics);
          if (parsedTitleOnly.length > 0) {
            setLyrics(parsedTitleOnly);
            setLyricsMatchStatus("matched");
            return;
          }
        }
      } catch (e) {
        console.error("LRCLIB error", e);
      }
    }

    setLyrics([{ time: 0, text: "No lyrics found" }]);
    setLyrics([{ time: 0, text: noLyricsFoundText }]);
    setLyricsMatchStatus("none");
  };

  const detectBPM = (buffer) => {
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    // 1. Calculate an envelope (moving average of absolute values)
    // We'll use a larger step to speed up processing
    const step = 100;
    const envelope = [];
    for (let i = 0; i < data.length; i += step) {
      let sum = 0;
      for (let j = 0; j < step && i + j < data.length; j++) {
        sum += Math.abs(data[i + j]);
      }
      envelope.push(sum / step);
    }

    // 2. Normalization
    const max = Math.max(...envelope);
    if (max < 0.01) return null;
    const normalized = envelope.map((v) => v / max);

    // 3. Peak Detection (Onset Detection)
    // We look for points where the envelope is high and increasing
    const peaks = [];
    const threshold = 0.3;
    const minDistance = (sampleRate / step) * 0.3; // ~200 BPM max limit

    for (let i = 1; i < normalized.length - 1; i++) {
      if (
        normalized[i] > threshold &&
        normalized[i] > normalized[i - 1] &&
        normalized[i] > normalized[i + 1]
      ) {
        peaks.push(i);
        i += Math.floor(minDistance);
      }
    }

    if (peaks.length < 5) return null;

    // 4. Interval Histogram
    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      const interval = peaks[i] - peaks[i - 1];
      const bpm = Math.round(60 / ((interval * step) / sampleRate));
      if (bpm >= 60 && bpm <= 200) {
        intervals.push(bpm);
      }
    }

    if (intervals.length === 0) return null;

    // 5. Find the most frequent BPM range (the mode)
    const counts = {};
    let maxCount = 0;
    let bestBpm = null;

    intervals.forEach((bpm) => {
      // Group similar BPMs into buckets of 2
      const bucket = Math.round(bpm / 2) * 2;
      counts[bucket] = (counts[bucket] || 0) + 1;
      if (counts[bucket] > maxCount) {
        maxCount = counts[bucket];
        bestBpm = bucket;
      }
    });

    return bestBpm;
  };

  const loadTrackData = async (filePath) => {
    setCoverUrl(null);
    setMetadata({ title: "", artist: "" });
    setTechnicalInfo({
      sampleRate: null,
      originalBpm: null,
      bitrate: null,
      codec: null,
    });

    try {
      // 1. Get Extended Metadata from Main Process (Music-Metadata)
      const data = await window.api.getExtendedMetadataHandler(filePath);

      if (data.success) {
        const { technical, common } = data;
        const fallbackFromTitle = parseArtistTitleFromName(common.title || "");
        const resolvedTitle = fallbackFromTitle?.title || common.title;
        const resolvedArtist =
          (common.artist && common.artist !== "Unknown Artist"
            ? common.artist
            : null) ||
          common.albumArtist ||
          fallbackFromTitle?.artist ||
          "Unknown Artist";

        setMetadata({ title: resolvedTitle, artist: resolvedArtist });
        setTechnicalInfo((prev) => ({
          ...prev,
          sampleRate: technical.sampleRate,
          bitrate: technical.bitrate,
          channels: technical.channels,
          codec: technical.codec,
          originalBpm: null, // Will be updated by detection or tags below
        }));

        if (common.cover) {
          setCoverUrl(common.cover);
        } else {
          fetchCloudCover(resolvedTitle, resolvedArtist);
        }

        fetchLyrics(filePath, resolvedTitle, resolvedArtist, {
          album: common.album || "",
          embeddedLyrics: common.lyrics || "",
        });
      } else {
        // Fallback for failed extraction
        const title = filePath
          .split("\\")
          .pop()
          .split("/")
          .pop()
          .replace(/\.[^/.]+$/, "");
        const fallbackFromTitle = parseArtistTitleFromName(title || "");
        const resolvedTitle = fallbackFromTitle?.title || title;
        const resolvedArtist = fallbackFromTitle?.artist || "Unknown Artist";

        setMetadata({ title: resolvedTitle, artist: resolvedArtist });
        fetchCloudCover(resolvedTitle, resolvedArtist);
        fetchLyrics(filePath, resolvedTitle, resolvedArtist);
      }

      // 2. BPM Detection (Keep as is, but use less memory)
      const arrayBuffer = await window.api.readBufferHandler(filePath);
      if (arrayBuffer) {
        try {
          const audioCtx = new (
            window.AudioContext || window.webkitAudioContext
          )();
          const slice = arrayBuffer.slice(0, 1024 * 1024 * 10);
          const decodedBuffer = await audioCtx.decodeAudioData(
            slice.buffer || slice,
          );
          const detectedBpm = detectBPM(decodedBuffer);
          setTechnicalInfo((prev) => ({ ...prev, originalBpm: detectedBpm }));
        } catch (e) {
          console.error("BPM detection error:", e);
        }
      }
    } catch (e) {
      console.error("Track data extraction error:", e);
    }
  };

  const fetchCloudCover = async (title, artist) => {
    if (!title) return;
    try {
      const query = encodeURIComponent(`${title} ${artist || ""}`);
      const response = await fetch(
        `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`,
      );
      const data = await response.json();
      if (data && data.results && data.results.length > 0) {
        const artwork = data.results[0].artworkUrl100;
        // Get high-res version: 1000x1000
        const highRes = artwork.replace("100x100bb.jpg", "1000x1000bb.jpg");
        setCoverUrl(highRes);
      }
    } catch (e) {
      console.error("Cloud cover fetch error:", e);
    }
  };

  /** @returns {Promise<string[]>} Paths to reference (new or already in library), for user playlists etc. */
  const processFiles = async (files) => {
    setIsConverting(true);
    const processed = [];
    const existingPaths = new Set(playlist.map((p) => p.path));
    const pathsForPlaylist = [];

    for (const file of files) {
      if (existingPaths.has(file.path)) {
        pathsForPlaylist.push(file.path);
        continue;
      }

      if (file.path.toLowerCase().endsWith(".ncm")) {
        setConversionMsg(`Decrypting: ${file.name}...`);
        const result = await window.api.convertNcmHandler(file.path);
        if (result.success) {
          const item = { name: result.name, path: result.path };
          processed.push(item);
          existingPaths.add(result.path);
          pathsForPlaylist.push(result.path);
        } else {
          console.error("Failed to convert:", file.path, result.error);
        }
      } else {
        processed.push(file);
        existingPaths.add(file.path);
        pathsForPlaylist.push(file.path);
      }
    }

    if (processed.length > 0) {
      setPlaylist((prev) => [...prev, ...processed]);
      if (currentIndex === -1) setCurrentIndex(0);
    }
    setIsConverting(false);
    setConversionMsg("");
    return [...new Set(pathsForPlaylist)];
  };

  const handleImport = async () => {
    const folders = await window.api.openDirectoryHandler();
    if (folders && folders.length > 0) {
      const audioFiles = await window.api.readDirectoryHandler(folders[0]);
      if (audioFiles.length > 0) {
        await processFiles(audioFiles);
      }
    }
  };

  const handleImportFile = async () => {
    const files = await window.api.openFileHandler();
    if (files && files.length > 0) {
      await processFiles(files);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the window
    if (e.currentTarget === e.target || !e.relatedTarget) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const paths = Array.from(files).map((f) => f.path);
      const audioFiles = await window.api.getAudioFilesFromPaths(paths);
      if (audioFiles && audioFiles.length > 0) {
        await processFiles(audioFiles);
      }
    }
  };

  const handleClearPlaylist = () => {
    setPlaylist([]);
    setCurrentIndex(-1);
    setIsPlaying(false);
    setDuration(0);
    setCurrentTime(0);
    setCoverUrl(null);
    if (audioRef.current) audioRef.current.src = "";
  };

  const togglePlay = useCallback(async () => {
    const s = lastCastStatus;
    if (
      s?.dlnaEnabled &&
      s?.currentUri &&
      window.api?.pauseAudio &&
      window.api?.playAudio
    ) {
      if (s.transportState === "PLAYING") {
        await window.api.pauseAudio();
      } else {
        await window.api.playAudio(
          s.currentUri,
          typeof s.positionSec === "number" ? s.positionSec : 0,
          1.0,
        );
      }
      return;
    }
    if (currentIndex === -1 && playlist.length > 0) {
      setCurrentIndex(0);
    }
    setIsPlaying((prev) => !prev);
  }, [lastCastStatus, currentIndex, playlist.length]);

  // Handle Spacebar to pause/play
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if user is typing in an input
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag === "input" || activeTag === "textarea") return;

      if (e.code === "Space") {
        e.preventDefault(); // Prevent page from scrolling
        togglePlay();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay]);

  const handleNext = () => {
    if (playlist.length > 0) {
      if (playMode === "shuffle") {
        let nextIdx = Math.floor(Math.random() * playlist.length);
        if (nextIdx === currentIndex && playlist.length > 1) {
          nextIdx = (nextIdx + 1) % playlist.length;
        }
        setCurrentIndex(nextIdx);
      } else {
        setCurrentIndex((prev) => (prev + 1) % playlist.length);
      }
      setIsPlaying(true);
    }
  };

  const handlePrev = () => {
    if (playlist.length > 0) {
      if (playMode === "shuffle") {
        let prevIdx = Math.floor(Math.random() * playlist.length);
        if (prevIdx === currentIndex && playlist.length > 1) {
          prevIdx = (prevIdx - 1 + playlist.length) % playlist.length;
        }
        setCurrentIndex(prevIdx);
      } else {
        setCurrentIndex(
          (prev) => (prev - 1 + playlist.length) % playlist.length,
        );
      }
      setIsPlaying(true);
    }
  };

  const formatTime = (time) => {
    if (isNaN(time)) return "0:00";
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    return `${min}:${sec < 10 ? "0" : ""}${sec}`;
  };

  const ytIframeRef = useRef(null);
  const ytBackgroundIframeRef = useRef(null);
  const ytReadyRef = useRef(false);
  const ytFallbackTimerRef = useRef(null);
  const mvContainerRef = useRef(null);
  const biliVideoRef = useRef(null);
  const biliBackgroundVideoRef = useRef(null);
  const biliAudioRef = useRef(null);

  /** 侧栏 MV：嵌入 iframe 按 1920×1080 布局再整体缩放，减轻“小窗=低清档” */
  useEffect(() => {
    if (!mvId || !config.enableMV || config.mvAsBackground || !showLyrics) {
      return undefined;
    }
    const el = mvContainerRef.current;
    if (!el) return undefined;
    const BASE_W = 1920;
    const BASE_H = 1080;
    const apply = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      const scale = Math.min(w / BASE_W, h / BASE_H);
      el.style.setProperty("--mv-embed-scale", String(Math.max(scale, 0.0001)));
    };
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    mvId?.id,
    mvId?.source,
    config.enableMV,
    config.mvAsBackground,
    showLyrics,
  ]);

  useEffect(() => {
    setYoutubeMvLoginHint(false);
    setBiliDirectStream(null);
    if (mvId?.source === "bilibili") {
      setMvPlaybackQuality(null);
    } else {
      setMvPlaybackQuality(null);
    }
  }, [mvId?.id, mvId?.source]);

  useEffect(() => {
    if (!mvId || mvId.source !== "bilibili") return;
    const qMap = { ultra: 120, highfps: 116, high: 80, medium: 64, low: 16 };
    const qn = qMap[config.mvQuality || "high"] || 80;
    let cancelled = false;
    setBiliDirectStream(null);
    window.api
      ?.resolveBilibiliStream?.(mvId.id, qn)
      .then((r) => {
        if (cancelled) return;
        if (r?.ok) {
          setBiliDirectStream(r);
          setMvPlaybackQuality(r.qualityDesc);
          console.log(
            `[Bilibili] Direct stream: ${r.qualityDesc} (${r.format})`,
          );
        } else {
          console.warn("[Bilibili] Stream resolve failed:", r?.error);
          const q = config.mvQuality || "high";
          const biliMax = signInStatus.bilibili
            ? { high: "1080p", medium: "720p", low: "360p" }
            : { high: "480p", medium: "480p", low: "360p" };
          setMvPlaybackQuality(biliMax[q] || "480p");
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("[Bilibili] Stream resolve error:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [mvId?.id, mvId?.source, config.mvQuality, signInStatus.bilibili]);

  const refreshSignInStatus = useCallback(() => {
    window.api
      ?.checkSignInStatus?.()
      .then((s) => {
        if (s) setSignInStatus(s);
      })
      .catch(() => {});
  }, []);

  const handleOpenYoutubeSignIn = useCallback(async () => {
    try {
      const r = await window.api?.openYoutubeSignInWindow?.();
      if (r && !r.ok) {
        console.warn("[YouTube sign-in]", r.error || r);
      }
    } catch (e) {
      console.warn("[YouTube sign-in]", e?.message || e);
    }
  }, []);

  const handleOpenBilibiliSignIn = useCallback(async () => {
    try {
      const r = await window.api?.openBilibiliSignInWindow?.();
      if (r && !r.ok) {
        console.warn("[Bilibili sign-in]", r.error || r);
      }
    } catch (e) {
      console.warn("[Bilibili sign-in]", e?.message || e);
    }
  }, []);

  // Sync YouTube playback state and rate
  useEffect(() => {
    if (!mvId || mvId.source === "bilibili") return;
    const func = isPlaying ? "playVideo" : "pauseVideo";
    [ytIframeRef, ytBackgroundIframeRef].forEach((ref) => {
      if (ref.current && ref.current.contentWindow) {
        ref.current.contentWindow.postMessage(
          JSON.stringify({
            event: "command",
            func: func,
            args: [],
          }),
          "*",
        );
      }
    });
  }, [isPlaying, mvId]);

  useEffect(() => {
    if (!mvId || mvId.source === "bilibili") return;
    [ytIframeRef, ytBackgroundIframeRef].forEach((ref) => {
      if (ref.current && ref.current.contentWindow) {
        ref.current.contentWindow.postMessage(
          JSON.stringify({
            event: "command",
            func: "setPlaybackRate",
            args: [playbackRate],
          }),
          "*",
        );
      }
    });
  }, [playbackRate, mvId]);

  // Handle MV Muting via postMessage
  useEffect(() => {
    if (!mvId || mvId.source === "bilibili") return;
    const func = config.mvMuted ? "mute" : "unMute";
    [ytIframeRef, ytBackgroundIframeRef].forEach((ref) => {
      if (ref.current && ref.current.contentWindow) {
        ref.current.contentWindow.postMessage(
          JSON.stringify({
            event: "command",
            func: func,
            args: [],
          }),
          "*",
        );
      }
    });
  }, [config.mvMuted, mvId, view, showLyrics]);

  // Bilibili direct video: play/pause sync
  useEffect(() => {
    if (!mvId || mvId.source !== "bilibili" || !biliDirectStream) return;
    [biliVideoRef, biliBackgroundVideoRef].forEach((ref) => {
      if (!ref.current) return;
      if (isPlaying) {
        ref.current.play().catch(() => {});
      } else {
        ref.current.pause();
      }
    });
    if (biliAudioRef.current) {
      if (isPlaying) {
        biliAudioRef.current.play().catch(() => {});
      } else {
        biliAudioRef.current.pause();
      }
    }
  }, [isPlaying, mvId, biliDirectStream]);

  // Bilibili direct video: playback rate sync
  useEffect(() => {
    if (!mvId || mvId.source !== "bilibili" || !biliDirectStream) return;
    [biliVideoRef, biliBackgroundVideoRef].forEach((ref) => {
      if (ref.current) ref.current.playbackRate = playbackRate;
    });
    if (biliAudioRef.current) biliAudioRef.current.playbackRate = playbackRate;
  }, [playbackRate, mvId, biliDirectStream]);

  const postToAllMvIframes = useCallback((msg, target = "*") => {
    [ytIframeRef, ytBackgroundIframeRef].forEach((ref) => {
      if (ref.current?.contentWindow) {
        ref.current.contentWindow.postMessage(msg, target);
      }
    });
  }, []);

  const pushYTQuality = useCallback(() => {
    const qMap = { high: "hd1080", medium: "hd720", low: "small" };
    const q = qMap[config.mvQuality || "high"] || "hd1080";
    postToAllMvIframes(
      JSON.stringify({
        event: "command",
        func: "setPlaybackQuality",
        args: [q],
      }),
    );
  }, [config.mvQuality, postToAllMvIframes]);

  const biliSeekDebounceRef = useRef(null);

  const syncYTVideo = (time) => {
    const t = Number(time) || 0;

    if (mvId?.source === "bilibili") {
      if (biliDirectStream?.videoUrl) {
        [biliVideoRef, biliBackgroundVideoRef].forEach((ref) => {
          if (ref.current) ref.current.currentTime = t;
        });
        if (biliAudioRef.current) biliAudioRef.current.currentTime = t;
        return;
      }
      if (biliSeekDebounceRef.current)
        clearTimeout(biliSeekDebounceRef.current);
      biliSeekDebounceRef.current = setTimeout(() => {
        const secs = Math.floor(t);
        [ytIframeRef, ytBackgroundIframeRef].forEach((ref) => {
          if (!ref.current) return;
          const cur = ref.current.src || "";
          const base = cur.replace(/[&?]t=\d+/g, "");
          ref.current.src = base + `&t=${secs}`;
        });
      }, 300);
      return;
    }

    [ytIframeRef, ytBackgroundIframeRef].forEach((ref) => {
      if (ref.current && ref.current.contentWindow) {
        ref.current.contentWindow.postMessage(
          JSON.stringify({
            event: "command",
            func: "seekTo",
            args: [t, true],
          }),
          "*",
        );

        if (isPlaying) {
          ref.current.contentWindow.postMessage(
            JSON.stringify({
              event: "command",
              func: "playVideo",
              args: [],
            }),
            "*",
          );
        }
      }
    });
  };

  const handleSeek = (e) => {
    if (lastCastStatus?.dlnaEnabled && lastCastStatus?.currentUri) return;
    const val = e.target.value;
    audioRef.current.currentTime = val;
    setCurrentTime(val);
    syncYTVideo(val);
  };

  const handleExport = async () => {
    if (currentIndex === -1 || !playlist[currentIndex]) return;
    setIsExporting(true);
    try {
      const track = playlist[currentIndex];
      const arrayBuffer = await window.api.readBufferHandler(track.path);

      // Offline Audio Processing
      const audioCtx = new (
        window.OfflineAudioContext || window.webkitOfflineAudioContext
      )(2, 1, 44100);
      const audioData = await audioCtx.decodeAudioData(
        arrayBuffer.buffer || arrayBuffer,
      );

      const rate = playbackRate;
      const duration = audioData.duration / rate;
      const offlineCtx = new (
        window.OfflineAudioContext || window.webkitOfflineAudioContext
      )(
        audioData.numberOfChannels,
        audioCtx.sampleRate * duration,
        audioCtx.sampleRate,
      );

      const source = offlineCtx.createBufferSource();
      source.buffer = audioData;
      source.playbackRate.value = rate;

      source.connect(offlineCtx.destination);
      source.start(0);

      const renderedBuffer = await offlineCtx.startRendering();

      // Encode to WAV (simple implementation)
      const wavBuffer = audioBufferToWav(renderedBuffer);

      // Save it via IPC
      const result = await window.api.saveExportHandler(
        new Uint8Array(wavBuffer).buffer,
        `Nightcore_${track.name.replace(".mp3", ".wav")}`,
      );

      if (result.success) {
        alert(tr("Export successful!", "导出成功！"));
      }
    } catch (e) {
      console.error(e);
      alert(`${tr("Failed to export", "导出失败")}：${e.message}`);
    }
    setIsExporting(false);
  };

  // AudioBuffer to pure PCM WAV conversion helper
  const audioBufferToWav = (buffer) => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArray = new ArrayBuffer(length);
    const view = new DataView(bufferArray);
    const channels = [];
    let sample = 0;
    let offset = 0;
    let pos = 0;

    const setUint16 = (data) => {
      view.setUint16(pos, data, true);
      pos += 2;
    };
    const setUint32 = (data) => {
      view.setUint32(pos, data, true);
      pos += 4;
    };

    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8);
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit
    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    while (pos < length) {
      for (let i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }
    return bufferArray;
  };

  const currentTrack = currentIndex >= 0 ? playlist[currentIndex] : null;
  const currentTrackInfo = useMemo(
    () =>
      currentTrack
        ? parseTrackInfo(currentTrack, trackMetaMap[currentTrack.path])
        : null,
    [currentTrack, trackMetaMap],
  );

  const mvFallbackRunningRef = useRef(false);
  const mvFallbackAttemptKeyRef = useRef("");

  const triggerAutoMvFallback = useCallback(
    async (reason = "youtube-error") => {
      if (!window.api?.searchMVHandler) return;
      if (!configRef.current?.autoFallbackToBilibili) return;
      if (!mvId || mvId.source !== "youtube") return;

      const title =
        metadata.title ||
        currentTrackInfo?.title ||
        (currentTrack ? stripExtension(currentTrack.name) : "");
      const artist =
        metadata.artist && metadata.artist !== "Unknown Artist"
          ? metadata.artist
          : currentTrackInfo?.artist || "";

      const key = `${currentTrack?.path || title}::${mvId.id}`;
      if (
        mvFallbackRunningRef.current ||
        mvFallbackAttemptKeyRef.current === key
      ) {
        return;
      }

      mvFallbackRunningRef.current = true;
      mvFallbackAttemptKeyRef.current = key;

      try {
        const bilibiliId = await searchBilibiliMv(
          title || "music",
          artist || "",
        );
        if (bilibiliId) {
          console.warn(
            `[MV Fallback] YouTube failed (${reason}), switched to Bilibili: ${bilibiliId}`,
          );
          setMvId({ id: bilibiliId, source: "bilibili" });
        } else {
          console.warn(
            `[MV Fallback] YouTube failed (${reason}), no Bilibili result.`,
          );
        }
      } catch (e) {
        console.warn(
          `[MV Fallback] fallback search failed: ${e?.message || e}`,
        );
      } finally {
        mvFallbackRunningRef.current = false;
      }
    },
    [
      mvId,
      metadata.title,
      metadata.artist,
      currentTrack,
      currentTrackInfo,
      searchBilibiliMv,
    ],
  );

  useEffect(() => {
    return () => {
      if (ytFallbackTimerRef.current) {
        clearTimeout(ytFallbackTimerRef.current);
        ytFallbackTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleYouTubeMessage = (event) => {
      const origin = event?.origin || "";
      if (
        !/youtube\.com$|youtube-nocookie\.com$/i.test(
          origin.replace(/^https?:\/\//, ""),
        )
      ) {
        return;
      }

      let payload = event.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch (_) {
          return;
        }
      }

      if (!payload || typeof payload !== "object") return;
      if (payload.event === "onReady") {
        ytReadyRef.current = true;
        if (ytFallbackTimerRef.current) {
          clearTimeout(ytFallbackTimerRef.current);
          ytFallbackTimerRef.current = null;
        }
        pushYTQuality();
        return;
      }

      if (payload.event === "onPlaybackQualityChange") {
        console.log(`[MV Quality] YouTube playing at: ${payload.info}`);
        setMvPlaybackQuality(payload.info);
        return;
      }

      if (payload.event !== "onError") return;

      const code = Number(payload.info);
      if ([153, 150, 101].includes(code) && config.autoFallbackToBilibili) {
        triggerAutoMvFallback(`youtube-error-${code}`);
      }
    };

    window.addEventListener("message", handleYouTubeMessage);
    return () => window.removeEventListener("message", handleYouTubeMessage);
  }, [config.autoFallbackToBilibili, triggerAutoMvFallback, pushYTQuality]);

  useEffect(() => {
    if (!mvId || mvId.source !== "youtube" || !ytReadyRef.current) return;
    pushYTQuality();
  }, [config.mvQuality, mvId, pushYTQuality]);

  const resolvedDisplayArtist = useMemo(() => {
    if (metadata.artist && metadata.artist !== "Unknown Artist")
      return metadata.artist;
    if (
      currentTrackInfo?.artist &&
      currentTrackInfo.artist !== "Unknown Artist"
    )
      return currentTrackInfo.artist;
    return currentTrack ? tr("Nightcore Mode", "Nightcore 模式") : "...";
  }, [metadata.artist, currentTrackInfo, currentTrack]);

  const dlnaUiOn = useMemo(
    () => !!(lastCastStatus?.dlnaEnabled && lastCastStatus?.currentUri),
    [lastCastStatus],
  );

  const displayMainTitle = useMemo(() => {
    const s = lastCastStatus;
    if (s?.dlnaEnabled && s?.currentUri) {
      const t = (s.dlnaMeta?.title || "").trim();
      return t || tr("DLNA Casting", "DLNA 投送");
    }
    if (metadata.title) return metadata.title;
    if (currentTrack) return currentTrack.name.replace(/\.[^/.]+$/, "");
    return tr("Select a track", "请选择一首曲目");
  }, [lastCastStatus, metadata.title, currentTrack, tr]);

  const displayMainArtist = useMemo(() => {
    const s = lastCastStatus;
    if (s?.dlnaEnabled && s?.currentUri) {
      const a = (s.dlnaMeta?.artist || "").trim();
      return a || "网络媒体";
    }
    return resolvedDisplayArtist;
  }, [lastCastStatus, resolvedDisplayArtist]);

  const displayMainAlbum = useMemo(() => {
    const s = lastCastStatus;
    if (s?.dlnaEnabled && s?.currentUri) {
      return (
        (s.dlnaMeta?.album || "").trim() || tr("Unknown Album", "未知专辑")
      );
    }
    return (
      metadata.album ||
      currentTrack?.info?.album ||
      tr("Unknown Album", "未知专辑")
    );
  }, [lastCastStatus, metadata.album, currentTrack, tr]);

  const displayMainCoverUrl = useMemo(() => {
    const s = lastCastStatus;
    if (s?.dlnaEnabled && s?.currentUri) {
      const u = (s.dlnaMeta?.albumArtUrl || "").trim();
      return u || null;
    }
    return coverUrl;
  }, [lastCastStatus, coverUrl]);

  const transportIsPlaying = useMemo(() => {
    const s = lastCastStatus;
    if (s?.dlnaEnabled && s?.currentUri) {
      return s.transportState === "PLAYING";
    }
    return isPlaying;
  }, [lastCastStatus, isPlaying]);

  const displayProgressTime = useMemo(() => {
    const s = lastCastStatus;
    if (s?.dlnaEnabled && s?.currentUri) {
      return typeof s.positionSec === "number" ? s.positionSec : 0;
    }
    return currentTime;
  }, [lastCastStatus, currentTime]);

  const displayProgressDuration = useMemo(() => {
    const s = lastCastStatus;
    if (s?.dlnaEnabled && s?.currentUri && (s.trackDurationSec ?? 0) > 0) {
      return s.trackDurationSec;
    }
    return duration;
  }, [lastCastStatus, duration]);

  const parsedPlaylist = useMemo(
    () =>
      playlist.map((track, originalIdx) => ({
        ...track,
        originalIdx,
        info: parseTrackInfo(track, trackMetaMap[track.path]),
      })),
    [playlist, trackMetaMap],
  );

  useEffect(() => {
    if (!playlist.length) return;

    const pending = playlist
      .filter((track) => !trackMetaMap[track.path])
      .slice(0, 8);
    if (!pending.length) return;

    let cancelled = false;

    const loadMetadata = async () => {
      const loaded = {};

      await Promise.all(
        pending.map(async (track) => {
          try {
            const data = await window.api.getExtendedMetadataHandler(
              track.path,
            );
            if (data?.success) {
              const common = data.common || {};
              loaded[track.path] = {
                title: common.title || null,
                artist: common.artist || null,
                album: common.album || null,
                albumArtist: common.albumArtist || null,
                trackNo: common.trackNo ?? null,
                discNo: common.discNo ?? null,
                cover: common.cover || null,
              };
            } else {
              loaded[track.path] = {
                title: null,
                artist: null,
                album: null,
                albumArtist: null,
                trackNo: null,
                discNo: null,
                cover: null,
              };
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
            };
          }
        }),
      );

      if (!cancelled && Object.keys(loaded).length > 0) {
        setTrackMetaMap((prev) => ({ ...prev, ...loaded }));
      }
    };

    loadMetadata();

    return () => {
      cancelled = true;
    };
  }, [playlist, trackMetaMap]);

  const queryFilteredPlaylist = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return parsedPlaylist;

    return parsedPlaylist.filter(({ info }) => {
      return (
        info.fileName.toLowerCase().includes(q) ||
        info.title.toLowerCase().includes(q) ||
        info.artist.toLowerCase().includes(q) ||
        info.album.toLowerCase().includes(q)
      );
    });
  }, [parsedPlaylist, searchQuery]);

  const albumArtistByName = useMemo(() => {
    const m = {};
    for (const track of queryFilteredPlaylist) {
      const name = track.info.album || tr("Singles", "单曲");
      if (
        m[name] == null &&
        track.info.artist &&
        track.info.artist !== "Unknown Artist"
      ) {
        m[name] = track.info.artist;
      }
    }
    return m;
  }, [queryFilteredPlaylist, tr]);

  const albumNamesSet = useMemo(() => {
    const s = new Set();
    for (const t of queryFilteredPlaylist) {
      s.add(t.info.album || tr("Singles", "单曲"));
    }
    return s;
  }, [queryFilteredPlaylist, tr]);

  /* Keep album grouping off listMode so switching to Albums does not re-run reduce/sort on the main thread. */
  const albumBuckets = useMemo(() => {
    const groups = queryFilteredPlaylist.reduce((acc, track) => {
      const key = track.info.album || tr("Singles", "单曲");
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key).push(track);
      return acc;
    }, new Map());

    return Array.from(groups.entries())
      .map(([name, tracks]) => ({
        name,
        tracks,
        artist:
          tracks.find(
            (t) => t.info.artist && t.info.artist !== "Unknown Artist",
          )?.info.artist || "Unknown Artist",
        cover: tracks.find((t) => t.info.cover)?.info.cover || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [queryFilteredPlaylist, tr]);

  const albumGroups = listMode === "album" ? albumBuckets : [];

  const filteredPlaylist = useMemo(() => {
    if (selectedAlbum === "all") return queryFilteredPlaylist;
    return queryFilteredPlaylist
      .filter((track) => track.info.album === selectedAlbum)
      .sort(compareTrackOrder);
  }, [queryFilteredPlaylist, selectedAlbum]);

  useEffect(() => {
    if (selectedAlbum === "all") return;
    if (!albumNamesSet.has(selectedAlbum)) setSelectedAlbum("all");
  }, [albumNamesSet, selectedAlbum]);

  const selectedUserPlaylist = useMemo(
    () => userPlaylists.find((p) => p.id === selectedUserPlaylistId) || null,
    [userPlaylists, selectedUserPlaylistId],
  );

  const userPlaylistTracks = useMemo(() => {
    if (!selectedUserPlaylist) return [];
    const pathToTrack = new Map(parsedPlaylist.map((t) => [t.path, t]));
    return selectedUserPlaylist.paths
      .map((p) => pathToTrack.get(p))
      .filter(Boolean);
  }, [selectedUserPlaylist, parsedPlaylist]);

  const playlistDetailFiltered = useMemo(() => {
    if (!selectedUserPlaylistId || listMode !== "playlists") return [];
    const q = searchQuery.trim().toLowerCase();
    let list = userPlaylistTracks;
    if (!q) return list;
    return list.filter(({ info }) => {
      return (
        info.fileName.toLowerCase().includes(q) ||
        info.title.toLowerCase().includes(q) ||
        info.artist.toLowerCase().includes(q) ||
        info.album.toLowerCase().includes(q)
      );
    });
  }, [userPlaylistTracks, searchQuery, selectedUserPlaylistId, listMode]);

  const tracksForSidebarList = useMemo(() => {
    if (listMode === "playlists" && selectedUserPlaylistId) {
      return playlistDetailFiltered;
    }
    return filteredPlaylist;
  }, [
    listMode,
    selectedUserPlaylistId,
    playlistDetailFiltered,
    filteredPlaylist,
  ]);

  const handleListMode = useCallback((mode) => {
    startTransition(() => {
      setListMode(mode);
      if (mode !== "playlists") {
        setSelectedUserPlaylistId(null);
        setPlaylistLibraryMoreOpen(false);
      }
      setAddToPlaylistMenu(null);
    });
  }, []);

  const handlePickAlbumFromSidebar = useCallback(
    (album) => {
      setSelectedAlbum(album.name);
      handleListMode("songs");
      const sorted = [...album.tracks].sort(compareTrackOrder);
      const firstTrack = sorted[0];
      if (firstTrack) {
        setCurrentIndex(firstTrack.originalIdx);
        setIsPlaying(true);
      }
    },
    [handleListMode],
  );

  const addPathToUserPlaylist = useCallback((playlistId, path) => {
    if (!path) return;
    setUserPlaylists((prev) =>
      prev.map((p) =>
        p.id === playlistId
          ? {
              ...p,
              paths: p.paths.includes(path) ? p.paths : [...p.paths, path],
            }
          : p,
      ),
    );
    setAddToPlaylistMenu(null);
  }, []);

  const removePathFromUserPlaylist = useCallback((playlistId, path) => {
    setUserPlaylists((prev) =>
      prev.map((p) =>
        p.id === playlistId
          ? { ...p, paths: p.paths.filter((x) => x !== path) }
          : p,
      ),
    );
  }, []);

  const submitNewPlaylistFromToolbar = useCallback(() => {
    const name = newPlaylistName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    setUserPlaylists((prev) => [...prev, { id, name, paths: [] }]);
    setNewPlaylistName("");
    setSelectedUserPlaylistId(id);
  }, [newPlaylistName]);

  const openAddToPlaylistPopover = useCallback((e, track) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const w = 268;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const menuH = 300;
    let top = r.bottom + 8;
    if (top + menuH > window.innerHeight - 12) {
      top = Math.max(12, r.top - menuH - 8);
    }
    setAddToPlaylistMenu((cur) =>
      cur?.originalIdx === track.originalIdx
        ? null
        : {
            originalIdx: track.originalIdx,
            path: track.path,
            top,
            left,
            width: w,
          },
    );
  }, []);

  const createPlaylistAndAddTrackFromPopover = useCallback(() => {
    const name = quickNewPlaylistName.trim();
    if (!name || !addToPlaylistMenu?.path) return;
    const id = crypto.randomUUID();
    setUserPlaylists((prev) => [
      ...prev,
      { id, name, paths: [addToPlaylistMenu.path] },
    ]);
    setAddToPlaylistMenu(null);
    setQuickNewPlaylistName("");
  }, [quickNewPlaylistName, addToPlaylistMenu]);

  useEffect(() => {
    if (!addToPlaylistMenu) {
      setQuickNewPlaylistName("");
      return;
    }
    const onKey = (e) => {
      if (e.key === "Escape") setAddToPlaylistMenu(null);
    };
    const onResize = () => setAddToPlaylistMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    document.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onResize, true);
    };
  }, [addToPlaylistMenu]);

  useEffect(() => {
    if (!playlistLibraryMoreOpen) return;
    const onDocMouseDown = (e) => {
      if (
        playlistLibraryMoreRef.current &&
        !playlistLibraryMoreRef.current.contains(e.target)
      ) {
        setPlaylistLibraryMoreOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setPlaylistLibraryMoreOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [playlistLibraryMoreOpen]);

  const deleteUserPlaylist = useCallback((id) => {
    if (!confirm(tr("Delete this playlist?", "要删除这个歌单吗？"))) return;
    setUserPlaylists((prev) => prev.filter((p) => p.id !== id));
    setSelectedUserPlaylistId((cur) => (cur === id ? null : cur));
  }, []);

  const renameUserPlaylist = useCallback(
    (id) => {
      const pl = userPlaylists.find((p) => p.id === id);
      if (!pl) return;
      const name = window.prompt(tr("Rename playlist", "重命名歌单"), pl.name);
      if (!name || !String(name).trim()) return;
      setUserPlaylists((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, name: String(name).trim() } : p,
        ),
      );
    },
    [userPlaylists],
  );

  const exportUserPlaylists = useCallback(async () => {
    const json = JSON.stringify(
      buildPlaylistsExportPayload(userPlaylists),
      null,
      2,
    );
    const r = await window.api.saveThemeJsonHandler(
      json,
      "echoes-playlists.json",
    );
    if (r && r.success === false && r.error) alert(r.error);
  }, [userPlaylists]);

  const importUserPlaylists = useCallback(async () => {
    const r = await window.api.openThemeJsonHandler();
    if (r?.error) {
      alert(r.error);
      return;
    }
    if (!r?.content) return;
    try {
      const data = JSON.parse(r.content);
      const imported = normalizeImportedPlaylists(data);
      if (!imported.length) {
        alert(tr("No playlists found in file.", "文件中未发现歌单。"));
        return;
      }
      setUserPlaylists((prev) => [...prev, ...imported]);
    } catch (e) {
      alert(e.message || String(e));
    }
  }, []);

  const addAllLibraryVisibleToPlaylist = useCallback(() => {
    if (!selectedUserPlaylistId) return;
    const paths = queryFilteredPlaylist.map((t) => t.path);
    setUserPlaylists((prev) =>
      prev.map((p) =>
        p.id === selectedUserPlaylistId
          ? { ...p, paths: [...new Set([...p.paths, ...paths])] }
          : p,
      ),
    );
  }, [selectedUserPlaylistId, queryFilteredPlaylist]);

  const importAudioIntoSelectedUserPlaylist = async () => {
    if (!selectedUserPlaylistId) return;
    const files = await window.api.openFileHandler();
    if (!files || files.length === 0) return;
    const paths = await processFiles(files);
    if (paths.length === 0) return;
    setUserPlaylists((prev) =>
      prev.map((p) =>
        p.id === selectedUserPlaylistId
          ? { ...p, paths: [...new Set([...p.paths, ...paths])] }
          : p,
      ),
    );
  };

  // Discord Rich Presence Sync
  useEffect(() => {
    if (!window.api?.setDiscordActivity) return;

    if (!config.enableDiscordRPC) {
      window.api.clearDiscordActivity();
      return;
    }

    if (currentIndex >= 0 && playlist[currentIndex]) {
      const track = playlist[currentIndex];
      window.api.setDiscordActivity({
        title: track.name.replace(/\.[^/.]+$/, ""), // Remove extension
        artist: track?.info?.artist || metadata.artist || "Echoes Studio",
        isPlaying: isPlaying,
        playbackRate: playbackRate.toFixed(2),
        coverUrl: coverUrl, // Main process handles http/fallback
        startTimestamp: isPlaying
          ? Math.floor(Date.now() - (currentTime * 1000) / playbackRate)
          : null,
        endTimestamp: isPlaying
          ? Math.floor(
              Date.now() + ((duration - currentTime) * 1000) / playbackRate,
            )
          : null,
      });
    } else {
      window.api.clearDiscordActivity();
    }
  }, [
    currentIndex,
    isPlaying,
    playbackRate,
    config.enableDiscordRPC,
    coverUrl,
    duration,
  ]);

  // Sync Discord Toggle with Main Process
  useEffect(() => {
    if (window.api?.toggleDiscordRPC) {
      window.api.toggleDiscordRPC(config.enableDiscordRPC);
    }
  }, [config.enableDiscordRPC]);

  // Compute inline style for lyrics panel when immersive MV background is enabled
  const lyricsPanelStyle = React.useMemo(() => {
    if (!(config.mvAsBackground && mvId && showLyrics)) return {};

    const useShadow =
      config.lyricsShadow !== undefined ? config.lyricsShadow : true;
    const opa =
      config.lyricsShadowOpacity !== undefined
        ? config.lyricsShadowOpacity
        : 0.6;

    if (!useShadow) {
      return {
        background: "transparent",
        backdropFilter: "none",
        WebkitBackdropFilter: "none",
        border: "none",
        boxShadow: "none",
      };
    }

    // When shadow enabled, we used to show blur, but user wants it GONE for MV clarity.
    // We will only use a very faint dark gradient at the bottom/top if needed, or just transparent.
    return {
      background: "transparent",
      backdropFilter: "none",
      WebkitBackdropFilter: "none",
      border: "none",
      boxShadow: "none",
    };
  }, [
    config.mvAsBackground,
    config.lyricsShadow,
    config.lyricsShadowOpacity,
    config.uiBlur,
    mvId,
    showLyrics,
  ]);

  // Discord Rich Presence
  useEffect(() => {
    if (!window.api?.setDiscordActivity) return;

    if (!config.showDiscordRPC) {
      window.api.clearDiscordActivity();
      return;
    }

    if (currentTrack && metadata.title) {
      const now = Math.floor(Date.now() / 1000);
      const durationSec = Math.round((duration || 0) / playbackRate);
      const elapsed = Math.round((currentTime || 0) / playbackRate);

      const speedStr =
        playbackRate !== 1.0 ? ` | ${playbackRate.toFixed(2)}x` : "";

      let endTimestamp = null;
      if (isPlaying && durationSec > 0 && !isNaN(durationSec)) {
        endTimestamp = now - elapsed + durationSec;
      }

      window.api.setDiscordActivity({
        title: metadata.title,
        artist: `${metadata.artist || "Unknown Artist"}${speedStr}`,
        isPlaying,
        startTimestamp: isPlaying ? now - elapsed : null,
        endTimestamp: endTimestamp,
        coverUrl: coverUrl,
      });
    } else {
      window.api.clearDiscordActivity();
    }
  }, [
    metadata.title,
    metadata.artist,
    isPlaying,
    config.showDiscordRPC,
    playbackRate,
    currentTime,
    duration,
    currentTrack,
    coverUrl,
  ]);

  // Visualizer Animation
  useEffect(() => {
    if (!config.showVisualizer || !isPlaying || view === "settings") {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      return;
    }

    const render = () => {
      if (!canvasRef.current || !analyserNode.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      const bufferLength = analyserNode.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      analyserNode.current.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height;

        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, "rgba(247, 170, 181, 0.2)");
        gradient.addColorStop(0.5, "rgba(247, 170, 181, 0.6)");
        gradient.addColorStop(1, "rgba(247, 170, 181, 1)");

        ctx.fillStyle = gradient;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);

        x += barWidth;
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [config.showVisualizer, isPlaying, view]);

  const renderMvIframe = (mvObj, isBackground) => {
    if (!mvObj || !mvObj.id) return null;

    const ytHost = "https://www.youtube.com";
    const pageOrigin =
      typeof window !== "undefined"
        ? window.location?.origin || "https://www.youtube.com"
        : "https://www.youtube.com";
    const ytOrigin = encodeURIComponent(pageOrigin);

    const qualitySetting = config.mvQuality || "high";
    const biliQualityMap = { high: 80, medium: 64, low: 16 };
    const ytVqMap = { high: "hd1080", medium: "hd720", low: "small" };
    const biliQuality = biliQualityMap[qualitySetting] || 80;
    const ytVq = ytVqMap[qualitySetting] || "hd1080";

    if (mvObj.source === "bilibili") {
      if (biliDirectStream?.videoUrl) {
        const videoMuted = biliDirectStream.format === "dash" || config.mvMuted;
        return (
          <>
            <video
              ref={isBackground ? biliBackgroundVideoRef : biliVideoRef}
              src={biliDirectStream.videoUrl}
              autoPlay
              muted={videoMuted}
              loop
              playsInline
              style={
                isBackground
                  ? {
                      width: "100%",
                      height: "100%",
                      position: "absolute",
                      top: 0,
                      left: 0,
                      objectFit: "cover",
                    }
                  : {}
              }
              className={isBackground ? "" : "mv-iframe mv-direct-video"}
              onError={() => {
                console.warn(
                  "[Bilibili Video] Playback error, falling back to embed",
                );
                setBiliDirectStream(null);
              }}
            />
            {biliDirectStream.format === "dash" &&
              biliDirectStream.audioUrl &&
              !config.mvMuted && (
                <audio
                  ref={biliAudioRef}
                  src={biliDirectStream.audioUrl}
                  autoPlay
                  loop
                  onLoadedMetadata={() => {
                    const vEl =
                      biliVideoRef.current || biliBackgroundVideoRef.current;
                    if (vEl && biliAudioRef.current) {
                      biliAudioRef.current.currentTime = vEl.currentTime;
                    }
                  }}
                />
              )}
          </>
        );
      }
      return (
        <iframe
          ref={isBackground ? ytBackgroundIframeRef : ytIframeRef}
          src={`https://player.bilibili.com/player.html?bvid=${mvObj.id}&autoplay=1&muted=${config.mvMuted ? 1 : 0}&high_quality=${qualitySetting === "low" ? 0 : 1}&quality=${biliQuality}&danmaku=0`}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={
            isBackground
              ? {
                  width: "100%",
                  height: "100%",
                  position: "absolute",
                  top: 0,
                  left: 0,
                }
              : {}
          }
          className={isBackground ? "" : "mv-iframe"}
        />
      );
    }

    return (
      <iframe
        ref={isBackground ? ytBackgroundIframeRef : ytIframeRef}
        src={`${ytHost}/embed/${mvObj.id}?autoplay=1&mute=${config.mvMuted ? 1 : 0}&controls=0&disablekb=1&fs=0&loop=1&playlist=${mvObj.id}&modestbranding=1&enablejsapi=1&playsinline=1&rel=0&vq=${ytVq}&origin=${ytOrigin}&widgetid=${isBackground ? 2 : 1}`}
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        style={
          isBackground
            ? {
                width: "100%",
                height: "100%",
                position: "absolute",
                top: 0,
                left: 0,
              }
            : {}
        }
        className={isBackground ? "" : "mv-iframe"}
        onLoad={() => {
          ytReadyRef.current = false;

          const iframe = isBackground
            ? ytBackgroundIframeRef.current
            : ytIframeRef.current;
          if (iframe?.contentWindow && mvObj.source !== "bilibili") {
            iframe.contentWindow.postMessage(
              JSON.stringify({
                event: "listening",
                id: isBackground ? "yt-bg" : "yt-main",
                channel: "widget",
              }),
              "*",
            );

            // 某些打包环境下 onError 不一定会被稳定上报；加一层超时兜底（提示登录 + 可选 B 站降级）。
            if (mvObj.source === "youtube") {
              if (ytFallbackTimerRef.current) {
                clearTimeout(ytFallbackTimerRef.current);
              }
              ytFallbackTimerRef.current = setTimeout(() => {
                if (!ytReadyRef.current) {
                  setYoutubeMvLoginHint(true);
                  if (config.autoFallbackToBilibili) {
                    triggerAutoMvFallback("youtube-timeout-no-ready");
                  }
                }
              }, 5000);
            }
          }

          syncYTVideo(currentTime);
          if (!isPlaying) {
            if (iframe?.contentWindow && mvObj.source !== "bilibili") {
              iframe.contentWindow.postMessage(
                JSON.stringify({
                  event: "command",
                  func: "pauseVideo",
                  args: [],
                }),
                "*",
              );
            }
          }
        }}
      />
    );
  };

  return (
    <div
      className="app-container"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className="app-theme-backdrop"
        style={themeBackdropStyle}
        aria-hidden
      />
      <div className={`drop-overlay ${isDragging ? "active" : ""}`}>
        <div className="drop-overlay-content">
          <div className="drop-icon-wrapper">
            <Zap size={48} fill="white" />
          </div>
          <div className="drop-text">
            {tr("Drop to add music", "拖拽以添加音乐")}
          </div>
          <div className="drop-subtext">
            {tr("Audio files and folders supported", "支持音频文件和文件夹")}
          </div>
        </div>
      </div>
      {config.customBgPath && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundImage: `url("file:///${config.customBgPath.replace(/\\/g, "/")}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: config.customBgOpacity,
            zIndex: -2,
            pointerEvents: "none",
          }}
        />
      )}
      {mvId && config.mvAsBackground && showLyrics && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            zIndex: -1,
            opacity:
              config.mvBackgroundOpacity !== undefined
                ? config.mvBackgroundOpacity
                : 0.8,
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: "100%",
              height: "100%",
              transform: "translate(-50%, -50%) scale(1.2)",
              pointerEvents: "none",
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
      <div className="titlebar">
        <span>Echoes Studio</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
          <button
            className="no-drag"
            type="button"
            onClick={() => setLyricsDrawerOpen(true)}
            style={{
              background: "none",
              border: "none",
              color: lyricsDrawerOpen ? "var(--accent-pink)" : "inherit",
              cursor: "pointer",
              padding: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.3s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = "var(--accent-pink)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = lyricsDrawerOpen
                ? "var(--accent-pink)"
                : "inherit";
            }}
            title={t("app.titlebar.lyricsSettings")}
          >
            <ListMusic size={18} />
          </button>
          <button
            className="no-drag"
            onClick={() => setDownloaderDrawerOpen((o) => !o)}
            style={{
              background: "none",
              border: "none",
              color: downloaderDrawerOpen ? "var(--accent-pink)" : "inherit",
              cursor: "pointer",
              padding: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.3s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = "var(--accent-pink)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = downloaderDrawerOpen
                ? "var(--accent-pink)"
                : "inherit";
            }}
            title={t("app.titlebar.studioDownloader")}
          >
            <Download size={18} />
          </button>
          <button
            className="no-drag"
            type="button"
            onClick={() => setMvDrawerOpen((o) => !o)}
            style={{
              background: "none",
              border: "none",
              color: mvDrawerOpen ? "var(--accent-pink)" : "inherit",
              cursor: "pointer",
              padding: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.3s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = "var(--accent-pink)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = mvDrawerOpen
                ? "var(--accent-pink)"
                : "inherit";
            }}
            title={t("app.titlebar.mvSettings")}
          >
            <Film size={18} />
          </button>
          <button
            className="no-drag"
            type="button"
            onClick={() => setCastDrawerOpen((o) => !o)}
            style={{
              background: "none",
              border: "none",
              color:
                castDrawerOpen || castDlnaListening
                  ? "var(--accent-pink)"
                  : "inherit",
              cursor: "pointer",
              padding: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.3s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = "var(--accent-pink)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color =
                castDrawerOpen || castDlnaListening
                  ? "var(--accent-pink)"
                  : "inherit";
            }}
            title={t("app.titlebar.castReceiver")}
          >
            <Radio size={18} />
          </button>
          <button
            className="no-drag"
            onClick={() => setView(view === "settings" ? "player" : "settings")}
            style={{
              background: "none",
              border: "none",
              color: view === "settings" ? "var(--accent-pink)" : "inherit",
              cursor: "pointer",
              padding: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.3s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = "var(--accent-pink)";
              e.currentTarget.style.transform = "rotate(45deg)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color =
                view === "settings" ? "var(--accent-pink)" : "inherit";
              e.currentTarget.style.transform = "rotate(0deg)";
            }}
          >
            <Settings size={18} />
          </button>
          <button
            className="no-drag"
            onClick={() => window.api.minimizeAppHandler()}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = "var(--text-main)";
              e.currentTarget.style.background = "rgba(255,255,255,0.4)";
              e.currentTarget.style.borderRadius = "50%";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = "inherit";
              e.currentTarget.style.background = "none";
              e.currentTarget.style.borderRadius = "0";
            }}
          >
            <Minus size={18} />
          </button>
          <button
            className="no-drag"
            onClick={() => window.api.maximizeAppHandler()}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = "var(--text-main)";
              e.currentTarget.style.background = "rgba(255,255,255,0.4)";
              e.currentTarget.style.borderRadius = "50%";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = "inherit";
              e.currentTarget.style.background = "none";
              e.currentTarget.style.borderRadius = "0";
            }}
          >
            <Square size={14} />
          </button>
          <button
            className="no-drag"
            onClick={() => window.api.closeAppHandler()}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = "white";
              e.currentTarget.style.background = "var(--accent-pink)";
              e.currentTarget.style.borderRadius = "50%";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = "inherit";
              e.currentTarget.style.background = "none";
              e.currentTarget.style.borderRadius = "0";
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div
        className={`sidebar glass-panel sidebar-panel-root no-drag ${showLyrics || view === "settings" ? "hidden" : ""}`}
      >
        <div style={{ display: "flex", gap: "8px", zIndex: 10, flexShrink: 0 }}>
          <button
            className="import-btn"
            style={{ flex: 1, padding: "10px" }}
            onClick={handleImport}
            title={tr("Import Folder", "导入文件夹")}
          >
            <FolderHeart size={18} />
          </button>
          <button
            className="import-btn"
            style={{ flex: 1, padding: "10px" }}
            onClick={handleImportFile}
            title={tr("Import Files", "导入文件")}
          >
            <FileAudio size={18} />
          </button>
          <button
            className="import-btn"
            style={{
              padding: "10px",
              background: "rgba(255,255,255,0.4)",
              color: "var(--text-main)",
              boxShadow: "none",
            }}
            onClick={handleClearPlaylist}
            title={tr("Clear Playlist", "清空播放列表")}
          >
            <Trash2 size={18} />
          </button>
        </div>

        <div className="search-container no-drag" style={{ flexShrink: 0 }}>
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder={tr(
              "Search tracks / artist / album...",
              "搜索曲目 / 艺术家 / 专辑...",
            )}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div
          className={`sidebar-list-stack${listMode === "playlists" && selectedUserPlaylistId ? " sidebar-list-stack--pl-detail" : ""}`}
        >
          <div className="list-filter-bar no-drag">
            <button
              type="button"
              className={`list-filter-chip ${listMode === "songs" ? "active" : ""}`}
              onClick={() => handleListMode("songs")}
            >
              {tr("Songs", "歌曲")}
            </button>
            <button
              type="button"
              className={`list-filter-chip ${listMode === "album" ? "active" : ""}`}
              onClick={() => handleListMode("album")}
            >
              {tr("Albums", "专辑")}
            </button>
            <button
              type="button"
              className={`list-filter-chip ${listMode === "playlists" ? "active" : ""}`}
              onClick={() => handleListMode("playlists")}
            >
              {tr("Playlists", "歌单")}
            </button>
          </div>

          {selectedAlbum !== "all" && listMode === "songs" && (
            <div className="album-filter-pill no-drag">
              <span>
                {tr("Album", "专辑")}：{selectedAlbum}
              </span>
              <button onClick={() => setSelectedAlbum("all")}>
                {tr("Clear", "清除")}
              </button>
            </div>
          )}

          <div
            className={`playlist${listMode === "album" ? " playlist-album-mode" : ""}${listMode === "playlists" && selectedUserPlaylistId ? " playlist--pl-detail" : ""}`}
          >
            {playlist.length === 0 && listMode !== "playlists" && (
              <div
                style={{
                  textAlign: "center",
                  opacity: 0.5,
                  marginTop: "20px",
                  fontSize: 14,
                }}
              >
                {tr("No tracks yet.", "还没有曲目。")} <br />{" "}
                {tr("Import a folder to start!", "导入文件夹开始吧！")}
              </div>
            )}

            {listMode === "playlists" && !selectedUserPlaylistId && (
              <div className="user-playlist-library no-drag">
                <div className="user-playlist-library-chrome">
                  <div className="user-playlist-library-header">
                    <span className="user-playlist-library-heading">
                      {tr("Your playlists", "你的歌单")}
                    </span>
                    <span className="user-playlist-library-count">
                      {userPlaylists.length}
                    </span>
                    <div
                      className="user-playlist-more-wrap"
                      ref={playlistLibraryMoreRef}
                    >
                      <button
                        type="button"
                        className="user-playlist-more-trigger"
                        aria-expanded={playlistLibraryMoreOpen}
                        aria-haspopup="menu"
                        aria-label={tr(
                          "Playlist library options",
                          "歌单库选项",
                        )}
                        title={tr("More", "更多")}
                        onClick={() =>
                          setPlaylistLibraryMoreOpen((open) => !open)
                        }
                      >
                        <MoreHorizontal size={18} strokeWidth={2} />
                      </button>
                      {playlistLibraryMoreOpen && (
                        <div className="user-playlist-more-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            className="user-playlist-more-item"
                            onClick={() => {
                              setPlaylistLibraryMoreOpen(false);
                              importUserPlaylists();
                            }}
                          >
                            <Upload size={14} aria-hidden />
                            {tr("Import…", "导入…")}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="user-playlist-more-item"
                            onClick={() => {
                              setPlaylistLibraryMoreOpen(false);
                              exportUserPlaylists();
                            }}
                          >
                            <Download size={14} aria-hidden />
                            {tr("Export all…", "导出全部…")}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="new-playlist-inline">
                    <input
                      type="text"
                      className="new-playlist-input"
                      placeholder={tr("New playlist name…", "新歌单名称…")}
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitNewPlaylistFromToolbar();
                      }}
                    />
                    <button
                      type="button"
                      className="new-playlist-submit"
                      onClick={submitNewPlaylistFromToolbar}
                    >
                      <Plus size={16} />
                      {tr("Create", "创建")}
                    </button>
                  </div>
                </div>
                {userPlaylists.length === 0 ? (
                  <p className="user-playlist-empty">
                    {tr(
                      "No playlists yet. Create one or import a JSON file.",
                      "还没有歌单。创建一个，或导入 JSON 文件。",
                    )}
                  </p>
                ) : (
                  <div className="user-playlist-list">
                    {userPlaylists.map((pl) => (
                      <div key={pl.id} className="user-playlist-card">
                        <button
                          type="button"
                          className="user-playlist-card-main"
                          onClick={() => setSelectedUserPlaylistId(pl.id)}
                        >
                          <ListMusic
                            size={16}
                            className="user-playlist-card-icon"
                            aria-hidden
                          />
                          <span className="user-playlist-name">{pl.name}</span>
                          <span className="user-playlist-count">
                            {pl.paths.length} {tr("tracks", "首")}
                          </span>
                        </button>
                        <div className="user-playlist-card-actions">
                          <button
                            type="button"
                            className="user-playlist-card-icon-btn"
                            aria-label={tr("Rename playlist", "重命名歌单")}
                            title={tr("Rename", "重命名")}
                            onClick={(e) => {
                              e.stopPropagation();
                              renameUserPlaylist(pl.id);
                            }}
                          >
                            <Pencil size={15} strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            className="user-playlist-card-icon-btn"
                            aria-label={tr("Delete playlist", "删除歌单")}
                            title={tr("Delete", "删除")}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteUserPlaylist(pl.id);
                            }}
                          >
                            <Trash2 size={15} strokeWidth={2} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {playlist.length > 0 && listMode === "album" && (
              <div className="album-browser no-drag">
                <div className="album-browser-header">
                  <h3>{tr("Albums", "专辑")}</h3>
                  <span>
                    {albumGroups.length} {tr("groups", "组")}
                  </span>
                </div>
                <div className="album-grid album-grid-deferred">
                  {albumGroups.map((album) => (
                    <AlbumSidebarCard
                      key={album.name}
                      album={album}
                      tr={tr}
                      locale={locale}
                      isSelected={selectedAlbum === album.name}
                      onPickAlbum={handlePickAlbumFromSidebar}
                    />
                  ))}
                </div>
              </div>
            )}

            {listMode === "playlists" &&
              selectedUserPlaylistId &&
              selectedUserPlaylist && (
                <div className="user-playlist-detail no-drag">
                  <div className="user-playlist-detail-head">
                    <button
                      type="button"
                      className="user-playlist-detail-back"
                      onClick={() => setSelectedUserPlaylistId(null)}
                      aria-label={tr("Back to playlists", "返回歌单列表")}
                      title={tr("Back", "返回")}
                    >
                      <ChevronLeft size={20} strokeWidth={2.25} />
                    </button>
                    <div className="user-playlist-detail-text">
                      <span
                        className="user-playlist-detail-name"
                        title={selectedUserPlaylist.name}
                      >
                        {selectedUserPlaylist.name}
                      </span>
                      <span className="user-playlist-detail-meta">
                        {selectedUserPlaylist.paths.length}{" "}
                        {selectedUserPlaylist.paths.length === 1
                          ? tr("track", "首")
                          : tr("tracks", "首")}
                      </span>
                    </div>
                  </div>
                  <div className="user-playlist-detail-actions">
                    {playlist.length > 0 && (
                      <button
                        type="button"
                        className="user-playlist-detail-btn user-playlist-detail-btn--primary"
                        onClick={addAllLibraryVisibleToPlaylist}
                        title={tr(
                          "Add all tracks currently visible under Songs search",
                          "把“歌曲”搜索结果里当前可见曲目全部加入",
                        )}
                      >
                        <ListPlus size={14} aria-hidden />
                        {tr("Add from results", "从结果添加")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="user-playlist-detail-btn"
                      onClick={importAudioIntoSelectedUserPlaylist}
                      title={tr(
                        "Add audio files from disk to this playlist (library is updated if needed)",
                        "从磁盘把音频添加到该歌单（必要时会更新媒体库）",
                      )}
                    >
                      <Upload size={14} aria-hidden />
                      {tr("Import", "导入")}
                    </button>
                    <button
                      type="button"
                      className="user-playlist-detail-btn"
                      onClick={async () => {
                        const json = JSON.stringify(
                          buildPlaylistsExportPayload([selectedUserPlaylist]),
                          null,
                          2,
                        );
                        const r = await window.api.saveThemeJsonHandler(
                          json,
                          `${selectedUserPlaylist.name.replace(/[^\w.-]+/g, "_")}.json`,
                        );
                        if (r && r.success === false && r.error) alert(r.error);
                      }}
                    >
                      <Download size={14} aria-hidden />
                      {tr("Export", "导出")}
                    </button>
                  </div>
                </div>
              )}

            {(listMode === "songs" ||
              (listMode === "playlists" && selectedUserPlaylistId)) && (
              <>
                {tracksForSidebarList.length === 0 && (
                  <p className="sidebar-empty-hint">
                    {listMode === "playlists"
                      ? tr(
                          'This playlist is empty. Add tracks from the Songs tab (+) or use "Add library results".',
                          "这个歌单是空的。可以在“歌曲”页点击 + 添加，或使用“从结果添加”。",
                        )
                      : tr(
                          "No tracks match your search.",
                          "没有匹配你搜索的曲目。",
                        )}
                  </p>
                )}
                {tracksForSidebarList.map((track) => {
                  const displayArtist =
                    track.info.artist === "Unknown Artist"
                      ? albumArtistByName[track.info.album] || track.info.artist
                      : track.info.artist;

                  return (
                    <div
                      key={`${track.path}-${track.originalIdx}`}
                      className={`track-item${track.originalIdx === currentIndex ? " active" : ""}${listMode === "playlists" && selectedUserPlaylistId ? " track-item--in-pl" : ""}`}
                      onClick={() => {
                        setCurrentIndex(track.originalIdx);
                        setIsPlaying(true);
                      }}
                    >
                      <Music
                        size={16}
                        style={{ marginRight: 8, opacity: 0.5 }}
                      />
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
                            locale={locale}
                          />{" "}
                          · {track.info.album}
                        </div>
                      </div>
                      {listMode === "songs" && (
                        <div className="track-add-pl-wrap">
                          <button
                            type="button"
                            className={`track-add-pl-btn ${addToPlaylistMenu?.originalIdx === track.originalIdx ? "active" : ""}`}
                            onClick={(e) => openAddToPlaylistPopover(e, track)}
                            title={tr("Add to playlist", "添加到歌单")}
                          >
                            <ListPlus size={16} />
                          </button>
                        </div>
                      )}
                      {listMode === "playlists" && selectedUserPlaylistId && (
                        <button
                          type="button"
                          className="track-remove-pl-btn"
                          title={tr("Remove from playlist", "从歌单移除")}
                          onClick={(e) => {
                            e.stopPropagation();
                            removePathFromUserPlaylist(
                              selectedUserPlaylistId,
                              track.path,
                            );
                          }}
                        >
                          <Minus size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>

      <div
        className={`main-player glass-panel no-drag ${showLyrics ? "lyrics-mode" : ""} ${showLyrics && config.mvAsBackground && mvId ? "immersive-mode" : ""} ${view === "settings" ? "hidden" : ""}`}
      >
        {showLyrics ? (
          <div className="lyrics-view-container" style={lyricsPanelStyle}>
            <button className="back-btn" onClick={() => setShowLyrics(false)}>
              <ChevronLeft size={32} />
            </button>

            <div className="lyrics-header">
              <AlbumCoverLink
                artist={displayMainArtist}
                album={displayMainAlbum}
                title={displayMainTitle}
                className="mini-cover"
                locale={locale}
              >
                {displayMainCoverUrl ? (
                  <img src={displayMainCoverUrl} alt="" />
                ) : (
                  <Music />
                )}
              </AlbumCoverLink>
              <div className="lyrics-meta">
                <h2>{displayMainTitle}</h2>
                <p>
                  <ArtistLink
                    artist={displayMainArtist}
                    className="artist-link-lyrics"
                    locale={locale}
                  />
                </p>
                <div className="technical-info-mini">
                  {dlnaUiOn && (
                    <span
                      className="mini-pill"
                      style={{
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                        borderColor: "var(--accent-pink)",
                        color: "var(--accent-pink)",
                      }}
                    >
                      DLNA
                    </span>
                  )}
                  {technicalInfo.codec && (
                    <span className="mini-pill">
                      {technicalInfo.codec.toUpperCase()}
                    </span>
                  )}
                  {technicalInfo.bitrate && (
                    <span className="mini-pill">
                      {Math.round(technicalInfo.bitrate / 1000)} kbps
                    </span>
                  )}
                  {technicalInfo.sampleRate && (
                    <span className="mini-pill">
                      {technicalInfo.sampleRate} Hz
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="lyrics-and-mv-wrapper">
              <div className="lyrics-scroll-area" ref={scrollAreaRef}>
                {lyrics.length > 0 ? (
                  lyrics.map((line, idx) => (
                    <div
                      key={idx}
                      className={`lyric-line ${idx === activeLyricIndex ? "active" : ""} ${idx < activeLyricIndex ? "past" : ""}`}
                      style={{
                        fontSize: `${config.lyricsFontSize ?? 32}px`,
                      }}
                      onClick={() => {
                        const newTime = parseFloat(line.time);
                        if (isNaN(newTime)) return;

                        setIsSeeking(true);
                        setCurrentTime(newTime);
                        syncYTVideo(newTime);

                        // Clear existing timer
                        if (seekTimerRef.current)
                          clearTimeout(seekTimerRef.current);

                        if (audioRef.current) {
                          audioRef.current.currentTime = newTime;
                          // Resume status updates after short delay
                          seekTimerRef.current = setTimeout(
                            () => setIsSeeking(false),
                            500,
                          );
                        }
                      }}
                    >
                      <span className="lyric-line-main">{line.text}</span>
                      {config.lyricsShowRomaji &&
                      (romajiDisplayLines[idx] || line.romaji) ? (
                        <span className="lyric-line-romaji">
                          {line.romaji || romajiDisplayLines[idx]}
                        </span>
                      ) : null}
                      {config.lyricsShowTranslation && line.translation ? (
                        <span className="lyric-line-translation">
                          {line.translation}
                        </span>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="lyric-line active" style={{ opacity: 0.5 }}>
                    {isSearchingMV ? (
                      tr("Searching MV...", "正在搜索 MV...")
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <div>{tr("No lyrics found", "未找到歌词")}</div>
                        <div>
                          <button
                            className="retry-lyrics-btn"
                            onClick={() => retryFetchLyrics()}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 6,
                              border: "none",
                              background: "var(--accent-color)",
                              color: "white",
                              cursor: "pointer",
                            }}
                          >
                            {tr("Fetch lyrics again", "再次获取歌词")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {mvId && config.enableMV && !config.mvAsBackground && (
                <div ref={mvContainerRef} className="mv-container glass-panel">
                  <div className="mv-aspect-ratio-wrapper">
                    {mvId.source === "bilibili" &&
                    biliDirectStream?.videoUrl ? (
                      renderMvIframe(mvId, false)
                    ) : (
                      <div className="mv-hi-res-stage">
                        {renderMvIframe(mvId, false)}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="main-player-body">
            <AlbumCoverLink
              artist={displayMainArtist}
              album={displayMainAlbum}
              title={displayMainTitle}
              className="cover-wrapper"
              locale={locale}
            >
              {displayMainCoverUrl ? (
                <img
                  src={displayMainCoverUrl}
                  draggable={false}
                  className={`cover-image ${transportIsPlaying ? "playing" : ""}`}
                  alt={tr("Cover Art", "封面图")}
                />
              ) : (
                <div className="no-cover">
                  <Music size={64} style={{ opacity: 0.3 }} />
                </div>
              )}
            </AlbumCoverLink>

            <div className="track-info">
              <h1>{displayMainTitle}</h1>
              <p className="artist-text">
                <ArtistLink
                  artist={displayMainArtist}
                  className="artist-link-main"
                  locale={locale}
                />
              </p>

              <div className="tech-pills-container">
                {dlnaUiOn && (
                  <div
                    className="tech-pill"
                    style={{
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                      fontSize: 11,
                      borderColor: "var(--accent-pink)",
                      color: "var(--accent-pink)",
                      boxShadow: "0 0 12px rgba(236, 72, 153, 0.25)",
                    }}
                  >
                    DLNA
                  </div>
                )}
                {technicalInfo.codec && (
                  <div className="tech-pill codec-pill">
                    {technicalInfo.codec.toUpperCase()}
                  </div>
                )}
                {technicalInfo.bitrate && (
                  <div className="tech-pill">
                    {Math.round(technicalInfo.bitrate / 1000)}kbps
                  </div>
                )}
                {technicalInfo.sampleRate && (
                  <div
                    className={`tech-pill ${technicalInfo.sampleRate > 44100 || technicalInfo.bitrate > 500000 ? "lossless-glow" : ""}`}
                  >
                    {(technicalInfo.sampleRate > 44100 ||
                      technicalInfo.bitrate > 500000) && (
                      <Zap size={14} style={{ marginRight: 4 }} />
                    )}
                    {technicalInfo.sampleRate / 1000}KHZ
                  </div>
                )}
                {technicalInfo.channels && (
                  <div className="tech-pill">
                    {technicalInfo.channels > 1 ? "STEREO" : "MONO"}
                  </div>
                )}
                {technicalInfo.originalBpm && (
                  <div className="tech-pill bpm-pill">
                    <span className="bpm-orig">
                      {technicalInfo.originalBpm} BPM
                    </span>
                    <span className="bpm-arrow">→</span>
                    <span className="bpm-nc">
                      {Math.round(technicalInfo.originalBpm * playbackRate)}
                    </span>
                  </div>
                )}
              </div>

              {config.showMiniWaveform && (
                <MiniWaveform
                  analyser={analyserNode.current}
                  isPlaying={isPlaying}
                />
              )}
            </div>

            {config.showVisualizer && (
              <canvas
                ref={canvasRef}
                className="visualizer-canvas"
                width={400}
                height={100}
              />
            )}
          </div>
        )}

        <div className="controls-container">
          <div className="progress-area">
            <input
              type="range"
              min={0}
              max={displayProgressDuration || 0}
              value={displayProgressTime}
              onChange={handleSeek}
              onMouseDown={() => setIsSeeking(true)}
              onMouseUp={() => setIsSeeking(false)}
              onTouchStart={() => setIsSeeking(true)}
              onTouchEnd={() => setIsSeeking(false)}
              disabled={dlnaUiOn}
              style={{
                padding: 0,
                opacity: dlnaUiOn ? 0.65 : 1,
                cursor: dlnaUiOn ? "not-allowed" : undefined,
              }}
            />
            <div className="time-info">
              <span>{formatTime(displayProgressTime)}</span>
              <span>
                {dlnaUiOn &&
                (!displayProgressDuration || displayProgressDuration <= 0)
                  ? "--:--"
                  : formatTime(displayProgressDuration)}
              </span>
            </div>
          </div>

          <div className="buttons">
            <button
              className="btn"
              style={{ width: 40, height: 40 }}
              onClick={() =>
                setPlayMode(playMode === "shuffle" ? "loop" : "shuffle")
              }
            >
              <Shuffle
                size={18}
                color={
                  playMode === "shuffle" ? "var(--accent-pink)" : "inherit"
                }
              />
            </button>
            <button className="btn" onClick={handlePrev}>
              <SkipBack size={24} />
            </button>
            <button className="btn play-btn" onClick={togglePlay}>
              {transportIsPlaying ? (
                <Pause size={32} />
              ) : (
                <Play size={32} style={{ marginLeft: 4 }} />
              )}
            </button>
            <button className="btn" onClick={handleNext}>
              <SkipForward size={24} />
            </button>
            <button
              className="btn"
              style={{ width: 40, height: 40 }}
              onClick={() =>
                setPlayMode(playMode === "single" ? "loop" : "single")
              }
            >
              {playMode === "single" ? (
                <Repeat1 size={18} color="var(--accent-pink)" />
              ) : (
                <Repeat
                  size={18}
                  color={playMode === "loop" ? "var(--accent-pink)" : "inherit"}
                />
              )}
            </button>
            <button
              className={`btn lyrics-toggle ${showLyrics ? "active" : ""}`}
              onClick={() => setShowLyrics(!showLyrics)}
            >
              <Mic2 size={18} />
            </button>
          </div>

          <div className="nightcore-controls">
            <div className="nc-header">
              <span>{tr("Speed", "速度")}</span>
              <span className="nc-badge">{playbackRate.toFixed(2)}x</span>
            </div>
            <div
              className="slider-wrapper"
              style={{ marginBottom: view === "player" && !showLyrics ? 8 : 0 }}
            >
              <span style={{ fontSize: 12, opacity: 0.5, fontWeight: "bold" }}>
                1.0
              </span>
              <input
                type="range"
                min={1.0}
                max={2.0}
                step={0.05}
                value={playbackRate}
                onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
              />
              <span style={{ fontSize: 12, opacity: 0.5, fontWeight: "bold" }}>
                2.0
              </span>
            </div>

            <div
              className="nc-header"
              style={{ marginLeft: showLyrics ? 8 : 0 }}
            >
              <span>{tr("Vol", "音量")}</span>
              <span className="nc-badge">{Math.round(volume * 100)}%</span>
            </div>
            <div className="slider-wrapper">
              <Volume2 size={16} style={{ opacity: 0.5 }} />
              <input
                type="range"
                min={0.0}
                max={1.0}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
              />
            </div>

            <button
              className="export-btn"
              style={{ marginTop: 12 }}
              onClick={handleExport}
              disabled={isExporting || !currentTrack}
            >
              <Download size={16} />
              {isExporting
                ? tr("Rendering Audio...", "正在渲染音频...")
                : tr("Render & Export Audio (.wav)", "渲染并导出音频（.wav）")}
            </button>
          </div>
        </div>
      </div>
      {view === "settings" && (
        <div className="settings-page glass-panel no-drag">
          <div className="settings-header">
            <button className="back-view-btn" onClick={() => setView("player")}>
              <ChevronLeft size={32} />
            </button>
            <h1>{t("app.settings.header")}</h1>
          </div>

          <div className="settings-content">
            <section className="settings-section">
              <div className="section-title">
                <Settings size={20} />
                <h2>{t("app.settings.language")}</h2>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h3>{t("app.settings.language")}</h3>
                  <p>{t("app.settings.languageDesc")}</p>
                </div>
                <select
                  className="no-drag"
                  value={locale}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      language: normalizeLocale(e.target.value),
                    }))
                  }
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)",
                    color: "var(--text-main)",
                    fontWeight: 600,
                  }}
                >
                  <option value="en">{t("app.settings.language.en")}</option>
                  <option value="zh-CN">
                    {t("app.settings.language.zh-CN")}
                  </option>
                </select>
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <Zap size={20} />
                <h2>{tr("Engine Mastery", "引擎增强")}</h2>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h3>
                    {tr("Real-time Spectrum visualizer", "实时频谱可视化")}
                  </h3>
                  <p>
                    {tr(
                      "Display audio frequency analytics on the main player.",
                      "在主播放器显示音频频谱分析。",
                    )}
                  </p>
                </div>
                <button
                  className={`toggle-btn ${config.showVisualizer ? "active" : ""}`}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      showVisualizer: !prev.showVisualizer,
                    }))
                  }
                >
                  {config.showVisualizer ? (
                    <ToggleRight size={32} />
                  ) : (
                    <ToggleLeft size={32} />
                  )}
                </button>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <h3>{tr("Mini Waveform Bar", "迷你波形条")}</h3>
                  <p>
                    {tr(
                      "Display audio frequency analytics under technical info.",
                      "在技术信息下方显示音频频谱分析。",
                    )}
                  </p>
                </div>
                <button
                  className={`toggle-btn ${config.showMiniWaveform ? "active" : ""}`}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      showMiniWaveform: !prev.showMiniWaveform,
                    }))
                  }
                >
                  {config.showMiniWaveform ? (
                    <ToggleRight size={32} />
                  ) : (
                    <ToggleLeft size={32} />
                  )}
                </button>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <h3>
                    {tr("Master Equalizer (10-Band)", "主均衡器（10 段）")}
                  </h3>
                  <p>
                    {tr(
                      "Enable precise frequency control for high-fidelity output.",
                      "启用精细频段控制，获得更高保真输出。",
                    )}
                  </p>
                </div>
                <button
                  className={`toggle-btn ${config.useEQ ? "active" : ""}`}
                  onClick={() =>
                    setConfig((prev) => ({ ...prev, useEQ: !prev.useEQ }))
                  }
                >
                  {config.useEQ ? (
                    <ToggleRight size={32} />
                  ) : (
                    <ToggleLeft size={32} />
                  )}
                </button>
              </div>

              {config.mvAsBackground && (
                <>
                  <div
                    className="setting-row"
                    style={{
                      marginTop: "8px",
                      borderTop: "none",
                      paddingTop: 0,
                    }}
                  >
                    <div className="setting-info">
                      <h3>{tr("Lyrics Panel Shadow", "歌词面板阴影")}</h3>
                      <p>
                        {tr(
                          "When immersive background is on, control whether the lyrics panel keeps a frosted/shadow frame. You can disable it for full transparency.",
                          "开启沉浸背景时，可控制歌词面板是否保留磨砂/阴影边框。关闭后可实现完全透明。",
                        )}
                      </p>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: 12,
                        }}
                      >
                        <button
                          className={`toggle-btn ${config.lyricsShadow ? "active" : ""}`}
                          onClick={() =>
                            setConfig((prev) => ({
                              ...prev,
                              lyricsShadow: !prev.lyricsShadow,
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
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          width: "220px",
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
                              lyricsShadowOpacity: parseFloat(e.target.value),
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
                <h2>{t("app.settings.integrations")}</h2>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h3>{tr("Discord Rich Presence", "Discord 状态展示")}</h3>
                  <p>
                    {tr(
                      "Display your current track and playback speed on your Discord profile.",
                      "在 Discord 个人状态中显示当前曲目和播放速度。",
                    )}
                  </p>
                </div>
                <button
                  className={`toggle-btn ${config.enableDiscordRPC ? "active" : ""}`}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      enableDiscordRPC: !prev.enableDiscordRPC,
                    }))
                  }
                >
                  {config.enableDiscordRPC ? (
                    <ToggleRight size={32} />
                  ) : (
                    <ToggleLeft size={32} />
                  )}
                </button>
              </div>
            </section>

            <section
              className={`settings-section eq-section ${!config.useEQ ? "disabled" : ""}`}
            >
              <div
                className="section-title"
                style={{ justifyContent: "space-between", width: "100%" }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "12px" }}
                >
                  <Sliders size={20} />
                  <h2>{tr("Hi-Fi Precision EQ", "高保真精密 EQ")}</h2>
                </div>
                <div
                  style={{ display: "flex", gap: "10px", alignItems: "center" }}
                >
                  <button
                    className="eq-toolbar-btn"
                    onClick={() => {
                      const resetBands = config.eqBands.map((b) => ({
                        ...b,
                        gain: 0,
                      }));
                      setConfig((prev) => ({
                        ...prev,
                        eqBands: resetBands,
                        preamp: 0,
                      }));
                    }}
                  >
                    <Repeat size={14} /> {tr("Reset", "重置")}
                  </button>

                  {/* Custom Preamp Styled Dropdown */}
                  <div className="custom-dropdown-container">
                    <div
                      className="dropdown-trigger"
                      onClick={() => setIsPresetOpen(!isPresetOpen)}
                    >
                      <span>
                        {config.activePreset === "Custom"
                          ? tr("Custom", "自定义")
                          : config.activePreset || tr("Custom", "自定义")}
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
                              const preset = EQ_PRESETS[name];
                              if (preset) {
                                const newBands = config.eqBands?.map(
                                  (b, i) => ({ ...b, gain: preset.bands[i] }),
                                );
                                setConfig((prev) => ({
                                  ...prev,
                                  eqBands: newBands,
                                  preamp: preset.preamp,
                                  activePreset: name,
                                }));
                              } else {
                                setConfig((prev) => ({
                                  ...prev,
                                  activePreset: "Custom",
                                }));
                              }
                              setIsPresetOpen(false);
                            }}
                          >
                            {name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <EqPlot
                bands={config.eqBands}
                enabled={config.useEQ}
                preamp={config.preamp || 0}
                analyser={analyserNode.current}
                onPreampChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    preamp: val,
                    activePreset: "Custom",
                  }))
                }
                onBandChange={(idx, updates) => {
                  const newBands = [...config.eqBands];
                  newBands[idx] = { ...newBands[idx], ...updates };
                  setConfig((prev) => ({
                    ...prev,
                    eqBands: newBands,
                    activePreset: "Custom",
                  }));
                }}
                locale={locale}
              />
            </section>

            <section className="settings-section">
              <div
                className="section-title"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  width: "100%",
                  alignItems: "center",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "12px" }}
                >
                  <Palette size={20} />
                  <h2>{tr("Aesthetics & Themes", "外观与主题")}</h2>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px",
                    alignItems: "center",
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    type="button"
                    onClick={async () => {
                      const slice = pickThemeExportSlice(config);
                      const json = JSON.stringify(
                        {
                          type: "echoes-studio-theme",
                          v: 1,
                          payload: slice,
                        },
                        null,
                        2,
                      );
                      const r = await window.api.saveThemeJsonHandler(
                        json,
                        "echoes-studio-theme.json",
                      );
                      if (r && r.success === false && r.error) alert(r.error);
                    }}
                    className="btn"
                    style={{
                      width: "auto",
                      padding: "0 14px",
                      height: "36px",
                      gap: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      borderRadius: "18px",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <Download size={14} /> {tr("Export theme", "导出主题")}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const r = await window.api.openThemeJsonHandler();
                      if (r?.error) {
                        alert(r.error);
                        return;
                      }
                      if (r?.content) {
                        try {
                          const bundle = parseThemeBundleJson(r.content);
                          setConfig((prev) => mergeThemeImport(prev, bundle));
                        } catch (e) {
                          alert(e.message || String(e));
                        }
                      }
                    }}
                    className="btn"
                    style={{
                      width: "auto",
                      padding: "0 14px",
                      height: "36px",
                      gap: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      borderRadius: "18px",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <Upload size={14} /> {tr("Import theme", "导入主题")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const theme = normalizeThemeColors(
                        generateRandomPalette(),
                      );
                      setConfig((prev) => ({
                        ...prev,
                        theme: "custom",
                        customColors: theme,
                      }));
                    }}
                    className="btn"
                    style={{
                      width: "auto",
                      padding: "0 16px",
                      height: "36px",
                      gap: "8px",
                      fontSize: "13px",
                      fontWeight: 600,
                      background:
                        "linear-gradient(135deg, var(--accent-blue), var(--accent-pink))",
                      color: "white",
                      border: "none",
                      borderRadius: "18px",
                      display: "flex",
                      alignItems: "center",
                      boxShadow: "0 4px 15px rgba(247, 170, 181, 0.4)",
                    }}
                  >
                    <Wand2 size={16} /> {tr("Randomize", "随机生成")}
                  </button>
                </div>
              </div>

              <div
                className="themes-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                  gap: "16px",
                  marginBottom: "24px",
                }}
              >
                {Object.entries(PRESET_THEMES).map(([key, theme]) => {
                  const tc = normalizeThemeColors(theme.colors);
                  const previewBg =
                    tc.bgMode === "linear"
                      ? `linear-gradient(${tc.bgGradientAngle}deg, ${tc.bgColor}, ${tc.bgGradientEnd})`
                      : tc.bgColor;
                  return (
                    <div
                      key={key}
                      style={{
                        position: "relative",
                        padding: "12px",
                        borderRadius: "16px",
                        border: `2px solid ${config.theme === key ? "var(--accent-pink)" : "transparent"}`,
                        background: "var(--glass-bg)",
                        color: "var(--text-main)",
                        textAlign: "center",
                        boxShadow:
                          config.theme === key
                            ? "0 8px 24px rgba(247, 170, 181, 0.2)"
                            : "0 4px 12px rgba(0,0,0,0.05)",
                        transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "stretch",
                        gap: "8px",
                        overflow: "hidden",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.transform = "translateY(-4px)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.transform = "translateY(0)")
                      }
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setConfig({ ...config, theme: key })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setConfig({ ...config, theme: key });
                          }
                        }}
                        style={{
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "12px",
                        }}
                      >
                        <div
                          style={{
                            width: "100%",
                            height: "40px",
                            borderRadius: "8px",
                            background: previewBg,
                            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                          }}
                        />
                        <span
                          style={{
                            fontSize: "13px",
                            zIndex: 1,
                            fontWeight: 700,
                          }}
                        >
                          {theme.name}
                        </span>
                        {config.theme === key && (
                          <CheckCircle2
                            size={18}
                            color="var(--accent-pink)"
                            style={{
                              position: "absolute",
                              top: "8px",
                              right: "8px",
                              background: "white",
                              borderRadius: "50%",
                              boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
                            }}
                          />
                        )}
                      </div>
                      <button
                        type="button"
                        className="no-drag"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfig((prev) => ({
                            ...prev,
                            theme: "custom",
                            customColors: normalizeThemeColors({
                              ...PRESET_THEMES[key].colors,
                            }),
                          }));
                        }}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: "11px",
                          fontWeight: 700,
                          borderRadius: "10px",
                          border: "1px solid var(--glass-border)",
                          background: "rgba(255,255,255,0.25)",
                          color: "var(--text-main)",
                          cursor: "pointer",
                        }}
                      >
                        {tr("Customize…", "自定义…")}
                      </button>
                    </div>
                  );
                })}

                <div
                  onClick={() =>
                    setConfig({
                      ...config,
                      theme: "custom",
                      customColors: normalizeThemeColors(
                        config.customColors || PRESET_THEMES.sakura.colors,
                      ),
                    })
                  }
                  style={{
                    position: "relative",
                    cursor: "pointer",
                    padding: "16px",
                    borderRadius: "16px",
                    border: `2px solid ${config.theme === "custom" ? "var(--accent-pink)" : "var(--glass-border)"}`,
                    background: "var(--glass-bg)",
                    color: "var(--text-main)",
                    fontWeight: "700",
                    textAlign: "center",
                    boxShadow:
                      config.theme === "custom"
                        ? "0 8px 24px rgba(247, 170, 181, 0.2)"
                        : "0 4px 12px rgba(0,0,0,0.05)",
                    transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "12px",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.transform = "translateY(-4px)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.transform = "translateY(0)")
                  }
                >
                  <div
                    style={{
                      width: "100%",
                      height: "40px",
                      borderRadius: "8px",
                      background: `linear-gradient(135deg, #f7aab5, #a3d2e3, #bbf0d8)`,
                      backgroundSize: "cover",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Palette size={20} color="white" />
                  </div>
                  <span style={{ fontSize: "13px" }}>
                    {tr("Custom", "自定义")}
                  </span>
                  {config.theme === "custom" && (
                    <CheckCircle2
                      size={18}
                      color="var(--accent-pink)"
                      style={{
                        position: "absolute",
                        top: "8px",
                        right: "8px",
                        background: "white",
                        borderRadius: "50%",
                        boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
                      }}
                    />
                  )}
                </div>
              </div>

              <div
                style={{
                  maxHeight: config.theme === "custom" ? "1600px" : "0px",
                  opacity: config.theme === "custom" ? 1 : 0,
                  overflow: "hidden",
                  transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {config.theme === "custom" && config.customColors && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(230px, 1fr))",
                      gap: "12px",
                      background: "rgba(255,255,255,0.4)",
                      padding: "24px",
                      borderRadius: "16px",
                      border: "1px solid var(--glass-border)",
                      boxShadow: "inset 0 2px 10px rgba(0,0,0,0.02)",
                    }}
                  >
                    {[
                      {
                        label: tr("Background", "背景"),
                        key: "bgColor",
                        desc: tr("Main window backdrop", "主窗口背景"),
                      },
                      {
                        label: tr("Primary Accent", "主强调色"),
                        key: "accent1",
                        desc: tr("Main interactions", "主要交互"),
                      },
                      {
                        label: tr("Secondary Accent", "次强调色"),
                        key: "accent2",
                        desc: tr("Gradients & depth", "渐变与层次"),
                      },
                      {
                        label: tr("Tertiary Accent", "第三强调色"),
                        key: "accent3",
                        desc: tr("Highlights", "高光"),
                      },
                      {
                        label: tr("Main Text", "主文本"),
                        key: "textMain",
                        desc: tr("Headers & titles", "标题与主文"),
                      },
                      {
                        label: tr("Soft Text", "次级文本"),
                        key: "textSoft",
                        desc: tr("Secondary hints", "次要提示"),
                      },
                      {
                        label: tr("Glass Color", "玻璃色"),
                        key: "glassColor",
                        desc: tr("Panel frosted tint", "面板磨砂色调"),
                      },
                    ].map((field) => (
                      <div
                        key={field.key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          background: "var(--glass-bg)",
                          padding: "12px 16px",
                          borderRadius: "12px",
                          border: "1px solid rgba(255,255,255,0.3)",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
                          transition: "all 0.2s ease",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.transform = "scale(1.02)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.transform = "scale(1)")
                        }
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "2px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: "var(--text-main)",
                            }}
                          >
                            {field.label}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--text-soft)",
                              opacity: 0.8,
                            }}
                          >
                            {field.desc}
                          </span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              opacity: 0.5,
                              fontFamily: "monospace",
                              background: "rgba(0,0,0,0.05)",
                              padding: "2px 6px",
                              borderRadius: "4px",
                            }}
                          >
                            {config.customColors[field.key].toUpperCase()}
                          </span>
                          <div
                            style={{
                              position: "relative",
                              width: "30px",
                              height: "30px",
                              borderRadius: "50%",
                              overflow: "hidden",
                              border: "2px solid rgba(255,255,255,0.8)",
                              boxShadow: `0 0 10px ${config.customColors[field.key]}60`,
                              flexShrink: 0,
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
                                    [field.key]: e.target.value,
                                  },
                                }));
                              }}
                              style={{
                                position: "absolute",
                                top: "-10px",
                                left: "-10px",
                                width: "50px",
                                height: "50px",
                                cursor: "pointer",
                                border: "none",
                                padding: 0,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    <div
                      style={{
                        gridColumn: "1 / -1",
                        marginTop: 4,
                        padding: 16,
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.35)",
                        border: "1px solid var(--glass-border)",
                      }}
                    >
                      <h4
                        style={{
                          margin: "0 0 12px",
                          fontSize: 14,
                          fontWeight: 800,
                          color: "var(--text-main)",
                        }}
                      >
                        {tr("Background gradient", "背景渐变")}
                      </h4>
                      <div
                        className="setting-row"
                        style={{ border: "none", padding: 0, marginBottom: 16 }}
                      >
                        <div className="setting-info">
                          <h4>{tr("Mode", "模式")}</h4>
                          <p>
                            {tr(
                              "Solid or linear blend (under accent glow).",
                              "纯色或线性渐变（位于强调光效下层）。",
                            )}
                          </p>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() =>
                              setConfig((prev) => ({
                                ...prev,
                                customColors: normalizeThemeColors({
                                  ...prev.customColors,
                                  bgMode: "solid",
                                }),
                              }))
                            }
                            style={{
                              opacity:
                                normalizeThemeColors(config.customColors)
                                  .bgMode === "solid"
                                  ? 1
                                  : 0.55,
                            }}
                          >
                            {tr("Solid", "纯色")}
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() =>
                              setConfig((prev) => ({
                                ...prev,
                                customColors: normalizeThemeColors({
                                  ...prev.customColors,
                                  bgMode: "linear",
                                }),
                              }))
                            }
                            style={{
                              opacity:
                                normalizeThemeColors(config.customColors)
                                  .bgMode === "linear"
                                  ? 1
                                  : 0.55,
                            }}
                          >
                            {tr("Linear", "线性")}
                          </button>
                        </div>
                      </div>
                      {normalizeThemeColors(config.customColors).bgMode ===
                        "linear" && (
                        <>
                          <div
                            className="setting-row"
                            style={{
                              border: "none",
                              padding: 0,
                              marginBottom: 12,
                            }}
                          >
                            <div className="setting-info">
                              <h4>{tr("Gradient end", "渐变终点")}</h4>
                              <p>
                                {tr(
                                  "Second color stop for the window backdrop.",
                                  "窗口背景的第二个颜色节点。",
                                )}
                              </p>
                            </div>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  fontFamily: "monospace",
                                  opacity: 0.75,
                                }}
                              >
                                {normalizeThemeColors(
                                  config.customColors,
                                ).bgGradientEnd.toUpperCase()}
                              </span>
                              <input
                                type="color"
                                value={
                                  normalizeThemeColors(config.customColors)
                                    .bgGradientEnd
                                }
                                onChange={(e) =>
                                  setConfig((prev) => ({
                                    ...prev,
                                    customColors: normalizeThemeColors({
                                      ...prev.customColors,
                                      bgGradientEnd: e.target.value,
                                    }),
                                  }))
                                }
                              />
                            </div>
                          </div>
                          <div
                            className="setting-row"
                            style={{ border: "none", padding: 0 }}
                          >
                            <div className="setting-info">
                              <h4>{tr("Angle", "角度")}</h4>
                              <p>
                                {tr(
                                  "Gradient direction (degrees).",
                                  "渐变方向（角度）。",
                                )}
                              </p>
                            </div>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                width: 240,
                              }}
                            >
                              <span style={{ fontSize: 11, opacity: 0.5 }}>
                                0°
                              </span>
                              <input
                                type="range"
                                min={0}
                                max={360}
                                value={
                                  normalizeThemeColors(config.customColors)
                                    .bgGradientAngle
                                }
                                onChange={(e) =>
                                  setConfig((prev) => ({
                                    ...prev,
                                    customColors: normalizeThemeColors({
                                      ...prev.customColors,
                                      bgGradientAngle: parseInt(
                                        e.target.value,
                                        10,
                                      ),
                                    }),
                                  }))
                                }
                                className="slider-nc"
                              />
                              <span style={{ fontSize: 11, opacity: 0.5 }}>
                                360°
                              </span>
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
                  background: "rgba(255,255,255,0.3)",
                  borderRadius: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 20,
                  }}
                >
                  <Image size={18} />
                  <h3 style={{ fontSize: 16, fontWeight: 800 }}>
                    {tr("Custom Wallpaper Decor", "自定义壁纸")}
                  </h3>
                </div>

                <div
                  className="setting-row"
                  style={{ border: "none", padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{tr("Background Image", "背景图片")}</h4>
                    <p>
                      {tr(
                        "Select a local image to use as your application backdrop.",
                        "选择本地图片作为应用背景。",
                      )}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {config.customBgPath && (
                      <button
                        className="btn"
                        onClick={() =>
                          setConfig((prev) => ({ ...prev, customBgPath: null }))
                        }
                        style={{
                          width: "auto",
                          height: "36px",
                          padding: "0 14px",
                          fontSize: 12,
                          borderRadius: 18,
                        }}
                      >
                        {tr("Clear", "清除")}
                      </button>
                    )}
                    <button
                      className="btn"
                      onClick={async () => {
                        const path = await window.api.openImageHandler();
                        if (path)
                          setConfig((prev) => ({
                            ...prev,
                            customBgPath: path,
                          }));
                      }}
                      style={{
                        width: "auto",
                        height: "36px",
                        padding: "0 16px",
                        fontSize: 12,
                        fontWeight: 800,
                        borderRadius: 18,
                        background: "var(--text-main)",
                        color: "white",
                      }}
                    >
                      {config.customBgPath
                        ? tr("Change Image", "更换图片")
                        : tr("Select Image", "选择图片")}
                    </button>
                  </div>
                </div>

                {config.customBgPath && (
                  <div
                    className="setting-row"
                    style={{ border: "none", padding: 0 }}
                  >
                    <div className="setting-info">
                      <h4>{tr("Wallpaper Opacity", "壁纸透明度")}</h4>
                      <p>
                        {tr(
                          "Adjust the visibility of your custom background image.",
                          "调节自定义背景图的可见度。",
                        )}
                      </p>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        width: 200,
                      }}
                    >
                      <span style={{ fontSize: 11, opacity: 0.5 }}>0%</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={
                          config.customBgOpacity !== undefined
                            ? config.customBgOpacity
                            : 1.0
                        }
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            customBgOpacity: parseFloat(e.target.value),
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
                  background: "rgba(255,255,255,0.3)",
                  borderRadius: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 20,
                  }}
                >
                  <Zap size={18} />
                  <h3 style={{ fontSize: 16, fontWeight: 800 }}>
                    {tr("Immersive Glass Details", "沉浸玻璃细节")}
                  </h3>
                </div>

                <div
                  className="setting-row"
                  style={{ border: "none", padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{tr("Panel Transparency", "面板透明度")}</h4>
                    <p>
                      {tr(
                        "Make UI panels more transparent or solid.",
                        "让 UI 面板更透明或更实心。",
                      )}
                    </p>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: 200,
                    }}
                  >
                    <span style={{ fontSize: 11, opacity: 0.5 }}>
                      {tr("Clear", "透明")}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={0.95}
                      step={0.05}
                      value={
                        config.uiBgOpacity !== undefined
                          ? config.uiBgOpacity
                          : 0.6
                      }
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          uiBgOpacity: parseFloat(e.target.value),
                        }))
                      }
                      className="slider-nc"
                    />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>
                      {tr("Solid", "实心")}
                    </span>
                  </div>
                </div>

                <div
                  className="setting-row"
                  style={{ border: "none", padding: 0 }}
                >
                  <div className="setting-info">
                    <h4>{tr("Blur Strength", "模糊强度")}</h4>
                    <p>
                      {tr(
                        "Adjust the intensity of the frosted glass effect.",
                        "调节磨砂玻璃效果强度。",
                      )}
                    </p>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: 200,
                    }}
                  >
                    <span style={{ fontSize: 11, opacity: 0.5 }}>
                      {tr("None", "无")}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={80}
                      step={1}
                      value={config.uiBlur !== undefined ? config.uiBlur : 20}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          uiBlur: parseInt(e.target.value),
                        }))
                      }
                      className="slider-nc"
                    />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>
                      {tr("Heavy", "强")}
                    </span>
                  </div>
                </div>
              </div>

              <div
                className="setting-subsection"
                style={{
                  marginTop: 16,
                  padding: 24,
                  background: "rgba(255,255,255,0.3)",
                  borderRadius: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 20,
                  }}
                >
                  <Sliders size={18} />
                  <h3 style={{ fontSize: 16, fontWeight: 800 }}>
                    {tr("Typography & UI density", "字体与界面密度")}
                  </h3>
                </div>

                <div
                  className="setting-row"
                  style={{ border: "none", padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{tr("UI font", "界面字体")}</h4>
                    <p>
                      {tr(
                        "Independent of the color preset (Outfit / Inter / System / Custom).",
                        "与颜色预设独立（Outfit / Inter / 系统字体 / 自定义）。",
                      )}
                    </p>
                  </div>
                  <select
                    className="no-drag"
                    value={config.uiFontFamily || "outfit"}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        uiFontFamily: e.target.value,
                      }))
                    }
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid var(--glass-border)",
                      background: "var(--glass-bg)",
                      color: "var(--text-main)",
                      fontWeight: 600,
                    }}
                  >
                    <option value="outfit">Outfit</option>
                    <option value="inter">Inter</option>
                    <option value="system">{tr("System UI", "系统 UI")}</option>
                    <option value="custom">{tr("Custom", "自定义")}</option>
                  </select>
                </div>

                {config.uiFontFamily === "custom" && (
                  <div
                    className="setting-row"
                    style={{ border: "none", padding: 0, marginBottom: 20 }}
                  >
                    <div className="setting-info">
                      <h4>{tr("Custom font stack", "自定义字体栈")}</h4>
                      <p>
                        {tr(
                          'Enter CSS font-family value. Example: "Maple Mono", "Microsoft YaHei", sans-serif',
                          '输入 CSS 的 font-family 值。例如："Maple Mono", "Microsoft YaHei", sans-serif',
                        )}
                      </p>
                    </div>
                    <input
                      type="text"
                      className="no-drag"
                      value={config.uiCustomFontFamily || ""}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          uiCustomFontFamily: e.target.value,
                        }))
                      }
                      placeholder={tr(
                        'e.g. "Maple Mono", "Segoe UI", sans-serif',
                        '例如："Maple Mono", "Segoe UI", sans-serif',
                      )}
                      style={{
                        width: 300,
                        maxWidth: "100%",
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: "1px solid var(--glass-border)",
                        background: "var(--glass-bg)",
                        color: "var(--text-main)",
                        fontWeight: 500,
                      }}
                    />
                  </div>
                )}

                <div
                  className="setting-row"
                  style={{ border: "none", padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{tr("Base font size", "基础字号")}</h4>
                    <p>
                      {tr(
                        "Scales rem-based UI (12–20px).",
                        "缩放基于 rem 的界面（12–20px）。",
                      )}
                    </p>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: 220,
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
                          uiBaseFontSize: parseInt(e.target.value, 10),
                        }))
                      }
                      className="slider-nc"
                    />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>20</span>
                  </div>
                </div>

                <div
                  className="setting-row"
                  style={{ border: "none", padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{tr("Corner radius scale", "圆角缩放")}</h4>
                    <p>
                      {tr(
                        "Global roundness for panels and controls.",
                        "全局控制面板与控件的圆角程度。",
                      )}
                    </p>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: 220,
                    }}
                  >
                    <span style={{ fontSize: 11, opacity: 0.5 }}>
                      {tr("Tight", "硬朗")}
                    </span>
                    <input
                      type="range"
                      min={0.85}
                      max={1.15}
                      step={0.05}
                      value={config.uiRadiusScale ?? 1}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          uiRadiusScale: parseFloat(e.target.value),
                        }))
                      }
                      className="slider-nc"
                    />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>
                      {tr("Soft", "柔和")}
                    </span>
                  </div>
                </div>

                <div
                  className="setting-row"
                  style={{ border: "none", padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{tr("Panel shadow strength", "面板阴影强度")}</h4>
                    <p>
                      {tr(
                        "Depth of drop shadows on glass panels.",
                        "调节玻璃面板投影的深度。",
                      )}
                    </p>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: 220,
                    }}
                  >
                    <span style={{ fontSize: 11, opacity: 0.5 }}>
                      {tr("Flat", "平")}
                    </span>
                    <input
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.05}
                      value={config.uiShadowIntensity ?? 1}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          uiShadowIntensity: parseFloat(e.target.value),
                        }))
                      }
                      className="slider-nc"
                    />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>
                      {tr("Deep", "深")}
                    </span>
                  </div>
                </div>

                <div
                  className="setting-row"
                  style={{ border: "none", padding: 0, marginBottom: 20 }}
                >
                  <div className="setting-info">
                    <h4>{tr("Color saturation", "色彩饱和度")}</h4>
                    <p>
                      {tr(
                        "Overall chroma boost for the whole window.",
                        "调节整个窗口的整体色彩浓度。",
                      )}
                    </p>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: 220,
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
                          uiSaturation: parseFloat(e.target.value),
                        }))
                      }
                      className="slider-nc"
                    />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>1.2</span>
                  </div>
                </div>

                <div
                  className="setting-row"
                  style={{ border: "none", padding: 0 }}
                >
                  <div className="setting-info">
                    <h4>{tr("Accent background glow", "强调色背景光晕")}</h4>
                    <p>
                      {tr(
                        "Large radial highlights using accent colors (disable for a flatter look).",
                        "使用强调色的大范围径向高光（关闭后界面更扁平）。",
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`toggle-btn ${config.uiAccentBackgroundGlow !== false ? "active" : ""}`}
                    onClick={() =>
                      setConfig((prev) => ({
                        ...prev,
                        uiAccentBackgroundGlow: !(
                          prev.uiAccentBackgroundGlow !== false
                        ),
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
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <Download size={20} />
                <h2>{t("app.settings.mediaDownloader")}</h2>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h3>{tr("Default Download Directory", "默认下载目录")}</h3>
                  <p>
                    {tr(
                      "Highest quality media will be saved here.",
                      "最高质量的媒体会保存到这里。",
                    )}
                  </p>
                </div>
                <div
                  style={{ display: "flex", gap: "8px", alignItems: "center" }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-soft)",
                      maxWidth: 180,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {config.downloadFolder || tr("Not set", "未设置")}
                  </span>
                  <button
                    className="btn"
                    style={{
                      width: "auto",
                      height: "32px",
                      padding: "0 12px",
                      borderRadius: "8px",
                      fontSize: 12,
                      fontWeight: "bold",
                    }}
                    onClick={async () => {
                      const folders = await window.api.openDirectoryHandler();
                      if (folders && folders.length > 0) {
                        setConfig((prev) => ({
                          ...prev,
                          downloadFolder: folders[0],
                        }));
                      }
                    }}
                  >
                    {tr("Set Folder", "设置目录")}
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h3>{tr("Playlist import folder", "歌单导入目录")}</h3>
                  <p>
                    {tr(
                      "Files saved by the link importer go here. If unset, the default download folder above is used.",
                      "链接导入器保存的文件会放到这里。若未设置，则使用上方默认下载目录。",
                    )}
                  </p>
                </div>
                <div
                  style={{ display: "flex", gap: "8px", alignItems: "center" }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-soft)",
                      maxWidth: 180,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={
                      config.playlistImportFolder || config.downloadFolder || ""
                    }
                  >
                    {config.playlistImportFolder
                      ? config.playlistImportFolder
                      : config.downloadFolder
                        ? tr("(same as download folder)", "（同下载目录）")
                        : tr("Not set", "未设置")}
                  </span>
                  <button
                    className="btn"
                    style={{
                      width: "auto",
                      height: "32px",
                      padding: "0 12px",
                      borderRadius: "8px",
                      fontSize: 12,
                      fontWeight: "bold",
                    }}
                    onClick={async () => {
                      const folders = await window.api.openDirectoryHandler();
                      if (folders && folders.length > 0) {
                        setConfig((prev) => ({
                          ...prev,
                          playlistImportFolder: folders[0],
                        }));
                      }
                    }}
                  >
                    {tr("Choose folder", "选择目录")}
                  </button>
                  {config.playlistImportFolder ? (
                    <button
                      type="button"
                      className="btn"
                      style={{
                        width: "auto",
                        height: "32px",
                        padding: "0 10px",
                        borderRadius: "8px",
                        fontSize: 11,
                        fontWeight: "bold",
                        opacity: 0.85,
                      }}
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          playlistImportFolder: null,
                        }))
                      }
                    >
                      {tr("Use download folder", "使用下载目录")}
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <Info size={20} />
                <h2>{t("app.settings.about")}</h2>
              </div>
              <p style={{ opacity: 0.6, fontSize: "14px", lineHeight: 1.6 }}>
                {tr(
                  "Echoes Studio is a high-performance Nightcore audio engine. All signal processing is done in 32-bit floating point precision via the Web Audio API for uncompromised quality.",
                  "Echoes Studio 是高性能 Nightcore 音频引擎。所有信号处理都基于 Web Audio API 的 32 位浮点精度完成，以保证不妥协的音质。",
                )}
              </p>
            </section>

            <section
              className="settings-section"
              style={{
                borderTop: "1px solid rgba(255,0,0,0.1)",
                marginTop: "40px",
                paddingTop: "20px",
              }}
            >
              <div className="section-title" style={{ color: "#ff5e7e" }}>
                <Trash2 size={20} />
                <h2>{t("app.settings.dangerZone")}</h2>
              </div>
              <div className="setting-row" style={{ border: "none" }}>
                <div className="setting-info">
                  <h3>{t("app.settings.resetAllConfig")}</h3>
                  <p>{t("app.settings.resetAllConfigDesc")}</p>
                </div>
                <button
                  className="btn"
                  onClick={handleResetAllConfig}
                  style={{
                    width: "auto",
                    height: "40px",
                    padding: "0 24px",
                    borderRadius: "20px",
                    background: "rgba(255, 94, 126, 0.1)",
                    color: "#ff5e7e",
                    border: "1px solid rgba(255, 94, 126, 0.3)",
                    fontWeight: "800",
                    fontSize: "13px",
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = "#ff5e7e";
                    e.currentTarget.style.color = "white";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background =
                      "rgba(255, 94, 126, 0.1)";
                    e.currentTarget.style.color = "#ff5e7e";
                  }}
                >
                  {t("app.settings.resetAllConfigBtn")}
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      <LyricsSettingsDrawer
        open={lyricsDrawerOpen}
        onClose={() => setLyricsDrawerOpen(false)}
        config={config}
        setConfig={setConfig}
        t={t}
        lyricsMatchStatus={lyricsMatchStatus}
        onRefreshLyrics={retryFetchLyrics}
        onApplyLyricsText={applyLyricsFromText}
        onNativeLyricsFilePick={pickLyricsFileNative}
      />
      <MediaDownloaderDrawer
        open={downloaderDrawerOpen}
        onClose={() => setDownloaderDrawerOpen(false)}
        config={config}
        setConfig={setConfig}
        t={t}
        userPlaylists={userPlaylists}
        setUserPlaylists={setUserPlaylists}
        setPlaylist={setPlaylist}
        setSelectedUserPlaylistId={setSelectedUserPlaylistId}
        onSuccess={(filePath) => {
          const fileName = filePath.split(/[/\\]/).pop();
          const newTrack = {
            name: fileName,
            path: filePath,
            type: "local",
          };
          setPlaylist((prev) => {
            const exists = prev.find((p) => p.path === filePath);
            return exists ? prev : [...prev, newTrack];
          });
        }}
      />
      <CastReceiveDrawer
        open={castDrawerOpen}
        onClose={() => setCastDrawerOpen(false)}
        t={t}
        locale={locale}
      />
      <MvSettingsDrawer
        open={mvDrawerOpen}
        onClose={() => setMvDrawerOpen(false)}
        config={config}
        setConfig={setConfig}
        t={t}
        signInStatus={signInStatus}
        onYoutubeSignIn={handleOpenYoutubeSignIn}
        onBilibiliSignIn={handleOpenBilibiliSignIn}
        mvId={mvId}
        setMvId={setMvId}
        mvPlaybackQuality={mvPlaybackQuality}
        biliDirectStream={biliDirectStream}
        onRestartPlayback={() => {
          if (audioRef.current) {
            audioRef.current.currentTime = 0;
            setCurrentTime(0);
            syncYTVideo(0);
          }
        }}
      />
      {youtubeMvLoginHint && mvId?.source === "youtube" && config.enableMV && (
        <div className="yt-mv-login-hint" role="status">
          <span className="yt-mv-login-hint-text">{t("app.ytHint.text")}</span>
          <div className="yt-mv-login-hint-actions">
            <button
              type="button"
              className="yt-mv-login-hint-btn"
              onClick={() => {
                setView("settings");
                setYoutubeMvLoginHint(false);
              }}
            >
              {t("app.ytHint.openSettings")}
            </button>
            <button
              type="button"
              className="yt-mv-login-hint-btn primary"
              onClick={() => {
                handleOpenYoutubeSignIn();
                setYoutubeMvLoginHint(false);
              }}
            >
              {t("app.ytHint.signInNow")}
            </button>
            <button
              type="button"
              className="yt-mv-login-hint-dismiss"
              aria-label={t("app.common.dismiss")}
              onClick={() => setYoutubeMvLoginHint(false)}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
      {addToPlaylistMenu &&
        createPortal(
          <>
            <div
              className="add-to-pl-backdrop"
              aria-hidden
              onMouseDown={() => setAddToPlaylistMenu(null)}
            />
            <div
              className="add-to-pl-menu-portal"
              role="dialog"
              aria-label={tr("Add to playlist", "添加到歌单")}
              style={{
                position: "fixed",
                top: addToPlaylistMenu.top,
                left: addToPlaylistMenu.left,
                width: addToPlaylistMenu.width,
                zIndex: 20050,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="add-to-pl-menu-header">
                {tr("Add to playlist", "添加到歌单")}
              </div>
              <div className="add-to-pl-menu-body">
                {userPlaylists.length === 0 ? (
                  <p className="add-to-pl-hint">
                    {tr(
                      "No playlists yet — use the form below or the Playlists tab.",
                      "还没有歌单——可使用下方表单，或前往“歌单”标签页。",
                    )}
                  </p>
                ) : (
                  userPlaylists.map((pl) => (
                    <button
                      key={pl.id}
                      type="button"
                      className="add-to-pl-item"
                      onClick={() =>
                        addPathToUserPlaylist(pl.id, addToPlaylistMenu.path)
                      }
                    >
                      {pl.name}
                    </button>
                  ))
                )}
                <div className="add-to-pl-new-block">
                  <span className="add-to-pl-new-label">
                    {tr("Create new & add this track", "新建歌单并添加此曲")}
                  </span>
                  <div className="add-to-pl-new-row">
                    <input
                      type="text"
                      className="add-to-pl-new-input"
                      placeholder={tr("Playlist name…", "歌单名称…")}
                      value={quickNewPlaylistName}
                      onChange={(e) => setQuickNewPlaylistName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          createPlaylistAndAddTrackFromPopover();
                      }}
                    />
                    <button
                      type="button"
                      className="add-to-pl-new-confirm"
                      onClick={createPlaylistAndAddTrackFromPopover}
                    >
                      {tr("Add", "添加")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
