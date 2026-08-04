import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, CloudDownload, Disc3, FileAudio, FileText, ImagePlus, ListChecks, RefreshCw, Save, Search, Tag, X } from 'lucide-react';
import type { EditableTrackTags, LibraryTrack, NetworkTagCandidate, TrackCoverSelection } from '../../../shared/types/library';
import type { LyricsEmbedToTrackResult, LyricsProviderId, LyricsSearchCandidate, TrackLyrics } from '../../../shared/types/lyrics';
import type { PluginLogEntry, PluginMetadataLookupResult, PluginMetadataProvider } from '../../../shared/types/plugins';

type TrackTagEditorDrawerProps = {
  track: LibraryTrack | null;
  isOpen: boolean;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (track: LibraryTrack, tags: EditableTrackTags, coverPath: string | null, coverUrl: string | null, coverMimeType: string | null) => void;
  onTrackUpdated?: (track: LibraryTrack) => void;
};

type TagFormState = {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo: string;
  discNo: string;
  year: string;
  genre: string;
};

type NumericField = 'trackNo' | 'discNo' | 'year';
type EditorTab = 'tags' | 'network' | 'lyrics' | 'file';
type LyricsProviderFilter = 'all' | LyricsProviderId;

type PendingNetworkCover = {
  url: string;
  mimeType: string | null;
  previewUrl: string;
};

type NetworkFieldSelection = Record<keyof TagFormState | 'cover', boolean>;

type FieldDefinition = {
  key: keyof TagFormState;
  label: string;
  group: 'basic' | 'album' | 'order';
  inputMode?: 'numeric';
};

const fieldDefinitions: FieldDefinition[] = [
  { key: 'title', label: '标题', group: 'basic' },
  { key: 'artist', label: '艺术家', group: 'basic' },
  { key: 'album', label: '专辑', group: 'album' },
  { key: 'albumArtist', label: '专辑艺术家', group: 'album' },
  { key: 'genre', label: '流派', group: 'album' },
  { key: 'trackNo', label: '音轨号', group: 'order', inputMode: 'numeric' },
  { key: 'discNo', label: '碟号', group: 'order', inputMode: 'numeric' },
  { key: 'year', label: '年份', group: 'order', inputMode: 'numeric' },
];

const networkFieldLabels: Array<{ key: keyof TagFormState | 'cover'; label: string }> = [
  { key: 'title', label: '标题' },
  { key: 'artist', label: '艺术家' },
  { key: 'album', label: '专辑' },
  { key: 'albumArtist', label: '专辑艺术家' },
  { key: 'trackNo', label: '音轨号' },
  { key: 'discNo', label: '碟号' },
  { key: 'year', label: '年份' },
  { key: 'genre', label: '流派' },
  { key: 'cover', label: '封面' },
];

const editorTabs: Array<{ key: EditorTab; label: string; icon: typeof Tag }> = [
  { key: 'tags', label: '标签', icon: Tag },
  { key: 'network', label: '网络候选', icon: CloudDownload },
  { key: 'lyrics', label: '歌词', icon: FileText },
  { key: 'file', label: '文件', icon: FileAudio },
];

const lyricSearchProviders: LyricsProviderId[] = ['local', 'lrclib', 'amll-ttml', 'netease', 'qqmusic', 'kugou', 'kuwo'];

const lyricProviderLabels: Record<LyricsProviderId, string> = {
  local: '本地',
  lrclib: 'LRCLIB',
  'amll-ttml': 'AMLL TTML',
  netease: '网易云',
  qqmusic: 'QQ 音乐',
  kugou: '酷狗',
  kuwo: '酷我',
  musixmatch: 'Musixmatch',
  genius: 'Genius',
  manual: '手动',
};

const lyricRiskLabels: Record<NonNullable<LyricsSearchCandidate['risk']>, string> = {
  low: '低风险',
  medium: '需确认',
  high: '高风险',
};

type LyricsCandidateDisplayKind = 'instrumental' | 'synced' | 'plain' | 'lyrics';

const lyricsCandidateDisplayKind = (candidate: LyricsSearchCandidate): LyricsCandidateDisplayKind => {
  if (candidate.instrumental) return 'instrumental';
  if (candidate.hasSynced) return 'synced';
  if (candidate.hasPlain) return 'plain';
  return 'lyrics';
};

const lyricCandidateDisplayLabels: Record<LyricsCandidateDisplayKind, string> = {
  instrumental: '纯音乐',
  synced: '同步歌词',
  plain: '纯文本',
  lyrics: '无文本',
};

const emptyNetworkSelection = (): NetworkFieldSelection => ({
  title: false,
  artist: false,
  album: false,
  albumArtist: false,
  trackNo: false,
  discNo: false,
  year: false,
  genre: false,
  cover: false,
});

const allNetworkFieldsSelected = (selection: NetworkFieldSelection): boolean => networkFieldLabels.every((field) => selection[field.key]);
const someNetworkFieldsSelected = (selection: NetworkFieldSelection): boolean => networkFieldLabels.some((field) => selection[field.key]);

const previewCoverUrl = (coverId: string | null | undefined, coverThumb: string | null | undefined): string | null => {
  if (coverId) {
    return `echo-cover://large/${encodeURIComponent(coverId)}`;
  }

  if (coverThumb?.startsWith('echo-cover://thumb/')) {
    return coverThumb.replace('echo-cover://thumb/', 'echo-cover://album/');
  }

  return coverThumb ?? null;
};

const stateFromTrack = (track: LibraryTrack | null): TagFormState => ({
  title: track?.title ?? '',
  artist: track?.artist ?? '',
  album: track?.album ?? '',
  albumArtist: track?.albumArtist ?? '',
  trackNo: track?.trackNo ? String(track.trackNo) : '',
  discNo: track?.discNo ? String(track.discNo) : '',
  year: track?.year ? String(track.year) : '',
  genre: track?.genre ?? '',
});

const numberOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
};

const hasFormValue = (value: string): boolean => value.trim().length > 0;
const hasCandidateText = (value: string | null | undefined): boolean => (value ?? '').trim().length > 0;
const candidateNumberText = (value: number | null | undefined): string => (typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
const fieldValue = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') {
    return '空';
  }
  return String(value);
};

const validatePositiveInteger = (value: string, label: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) {
    return `${label}必须是正整数或留空`;
  }
  return null;
};

const getValidationErrors = (form: TagFormState): Partial<Record<NumericField, string>> => ({
  trackNo: validatePositiveInteger(form.trackNo, '音轨号') ?? undefined,
  discNo: validatePositiveInteger(form.discNo, '碟号') ?? undefined,
  year: validatePositiveInteger(form.year, '年份') ?? undefined,
});

const hasValidationErrors = (errors: Partial<Record<NumericField, string>>): boolean => Object.values(errors).some(Boolean);

const formatDuration = (seconds: number | null | undefined): string => {
  if (!seconds || !Number.isFinite(seconds)) {
    return '未知时长';
  }

  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
};

const formatAudioSummary = (track: LibraryTrack): string =>
  [
    track.codec?.toUpperCase(),
    track.sampleRate ? `${Math.round(track.sampleRate / 100) / 10}kHz` : null,
    track.bitDepth ? `${track.bitDepth}bit` : null,
    track.bpm ? `${Math.round(track.bpm)} BPM` : null,
  ]
    .filter(Boolean)
    .join(' / ') || '本地音频';

const pluginMetadataCandidatesToNetworkCandidates = (
  result: PluginMetadataLookupResult,
  track: LibraryTrack,
): NetworkTagCandidate[] =>
  result.candidates.map((candidate, index) => ({
    id: `plugin:${candidate.pluginId}:${candidate.providerId}:${index}`,
    provider: 'mock',
    confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0.7,
    title: candidate.title ?? track.title ?? '',
    artist: candidate.artist ?? track.artist ?? '',
    album: candidate.album ?? track.album ?? '',
    albumArtist: candidate.albumArtist ?? track.albumArtist ?? '',
    trackNo: candidate.trackNo ?? null,
    discNo: candidate.discNo ?? null,
    year: candidate.year ?? null,
    genre: candidate.genre ?? null,
    duration: track.duration ?? null,
    coverUrl: null,
    coverPreviewUrl: null,
    coverMimeType: null,
    raw: {
      ...candidate,
      pluginSourceLabel: candidate.source || `${candidate.pluginId}/${candidate.providerId}`,
    },
  }));

const networkCandidateProviderLabel = (candidate: NetworkTagCandidate): string => {
  const raw = candidate.raw;
  if (raw && typeof raw === 'object' && 'pluginSourceLabel' in raw) {
    const label = (raw as { pluginSourceLabel?: unknown }).pluginSourceLabel;
    if (typeof label === 'string' && label.trim()) {
      return label;
    }
  }

  return candidate.provider;
};

const pluginMetadataProviderKey = (provider: Pick<PluginMetadataProvider, 'pluginId' | 'id'>): string => `${provider.pluginId}::${provider.id}`;

const isMetadataPluginLog = (log: PluginLogEntry): boolean =>
  log.level !== 'info' && (log.message.includes('metadata') || log.message.includes('元数据') || log.message.includes('provider'));

const candidateFieldValue = (candidate: NetworkTagCandidate, key: keyof TagFormState): string => {
  switch (key) {
    case 'trackNo':
      return candidateNumberText(candidate.trackNo);
    case 'discNo':
      return candidateNumberText(candidate.discNo);
    case 'year':
      return candidateNumberText(candidate.year);
    case 'genre':
      return candidate.genre ?? '';
    default:
      return candidate[key];
  }
};

const missingOnlyNetworkFieldSelection = (
  form: TagFormState,
  track: Pick<LibraryTrack, 'coverThumb'>,
  candidate: NetworkTagCandidate,
): NetworkFieldSelection => ({
  title: hasCandidateText(candidate.title) && !hasFormValue(form.title),
  artist: hasCandidateText(candidate.artist) && !hasFormValue(form.artist),
  album: hasCandidateText(candidate.album) && !hasFormValue(form.album),
  albumArtist: hasCandidateText(candidate.albumArtist) && !hasFormValue(form.albumArtist),
  trackNo: candidate.trackNo !== null && !hasFormValue(form.trackNo),
  discNo: candidate.discNo !== null && !hasFormValue(form.discNo),
  year: candidate.year !== null && !hasFormValue(form.year),
  genre: hasCandidateText(candidate.genre) && !hasFormValue(form.genre),
  cover: Boolean(candidate.coverUrl) && !track.coverThumb,
});

const dedupeLyricsCandidates = (candidateLists: LyricsSearchCandidate[][]): LyricsSearchCandidate[] => {
  const byId = new Map<string, LyricsSearchCandidate>();
  for (const candidate of candidateLists.flat()) {
    const existing = byId.get(candidate.id);
    if (!existing || candidate.score > existing.score) {
      byId.set(candidate.id, candidate);
    }
  }

  return [...byId.values()].sort((left, right) => right.score - left.score);
};

const formatLyricsScore = (score: number): string => `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;

const lyricsKindLabel = (lyrics: TrackLyrics | null): string => {
  if (!lyrics) {
    return '未应用';
  }
  if (lyrics.kind === 'synced') {
    return '逐字/逐行同步';
  }
  if (lyrics.kind === 'plain') {
    return '纯文本';
  }
  if (lyrics.kind === 'instrumental') {
    return '纯音乐';
  }
  return '空歌词';
};

const canEmbedLyricsIntoTrack = (track: LibraryTrack): boolean =>
  track.mediaType !== 'remote' && track.mediaType !== 'streaming' && track.isTemporary !== true && Boolean(track.path);

export const defaultNetworkFieldSelection = (
  form: TagFormState,
  track: Pick<LibraryTrack, 'coverThumb'>,
  candidate: NetworkTagCandidate,
): NetworkFieldSelection => {
  const highConfidence = candidate.confidence >= 0.93;
  return {
    title: hasCandidateText(candidate.title) && (!hasFormValue(form.title) || highConfidence),
    artist: hasCandidateText(candidate.artist) && (!hasFormValue(form.artist) || highConfidence),
    album: hasCandidateText(candidate.album) && (!hasFormValue(form.album) || highConfidence),
    albumArtist: hasCandidateText(candidate.albumArtist) && (!hasFormValue(form.albumArtist) || highConfidence),
    trackNo: candidate.trackNo !== null && (!hasFormValue(form.trackNo) || highConfidence),
    discNo: candidate.discNo !== null && (!hasFormValue(form.discNo) || highConfidence),
    year: candidate.year !== null && (!hasFormValue(form.year) || highConfidence),
    genre: hasCandidateText(candidate.genre) && (!hasFormValue(form.genre) || highConfidence),
    cover: Boolean(candidate.coverUrl) && (!track.coverThumb || highConfidence),
  };
};

export const applyNetworkCandidateToForm = (
  form: TagFormState,
  candidate: NetworkTagCandidate,
  fields: NetworkFieldSelection,
): TagFormState => ({
  ...form,
  title: fields.title && hasCandidateText(candidate.title) ? candidate.title : form.title,
  artist: fields.artist && hasCandidateText(candidate.artist) ? candidate.artist : form.artist,
  album: fields.album && hasCandidateText(candidate.album) ? candidate.album : form.album,
  albumArtist: fields.albumArtist && hasCandidateText(candidate.albumArtist) ? candidate.albumArtist : form.albumArtist,
  trackNo: fields.trackNo ? candidateNumberText(candidate.trackNo) : form.trackNo,
  discNo: fields.discNo ? candidateNumberText(candidate.discNo) : form.discNo,
  year: fields.year ? candidateNumberText(candidate.year) : form.year,
  genre: fields.genre && candidate.genre ? candidate.genre : form.genre,
});

export const TrackTagEditorDrawer = ({ track, isOpen, isSaving, error, onClose, onSave, onTrackUpdated }: TrackTagEditorDrawerProps): JSX.Element | null => {
  const [form, setForm] = useState<TagFormState>(() => stateFromTrack(track));
  const [activeTab, setActiveTab] = useState<EditorTab>('tags');
  const [selectedCover, setSelectedCover] = useState<TrackCoverSelection | null>(null);
  const [pendingNetworkCover, setPendingNetworkCover] = useState<PendingNetworkCover | null>(null);
  const [loadedCoverThumb, setLoadedCoverThumb] = useState<string | null>(null);
  const [isLoadingEmbedded, setIsLoadingEmbedded] = useState(false);
  const [isSearchingNetwork, setIsSearchingNetwork] = useState(false);
  const [isSearchingPluginMetadata, setIsSearchingPluginMetadata] = useState(false);
  const [pluginMetadataProviders, setPluginMetadataProviders] = useState<PluginMetadataProvider[]>([]);
  const [selectedPluginMetadataProviderKey, setSelectedPluginMetadataProviderKey] = useState('all');
  const [pluginMetadataLogs, setPluginMetadataLogs] = useState<PluginLogEntry[]>([]);
  const [networkCandidates, setNetworkCandidates] = useState<NetworkTagCandidate[]>([]);
  const [selectedNetworkCandidate, setSelectedNetworkCandidate] = useState<NetworkTagCandidate | null>(null);
  const [networkFieldSelection, setNetworkFieldSelection] = useState<NetworkFieldSelection>(() => emptyNetworkSelection());
  const [networkMessage, setNetworkMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [lyricsQuery, setLyricsQuery] = useState('');
  const [lyricsProviderFilter, setLyricsProviderFilter] = useState<LyricsProviderFilter>('all');
  const [lyricsCandidates, setLyricsCandidates] = useState<LyricsSearchCandidate[]>([]);
  const [currentLyrics, setCurrentLyrics] = useState<TrackLyrics | null>(null);
  const [lyricsMessage, setLyricsMessage] = useState<string | null>(null);
  const [isSearchingLyrics, setIsSearchingLyrics] = useState(false);
  const [applyingLyricsCandidateId, setApplyingLyricsCandidateId] = useState<string | null>(null);
  const [embeddingLyricsCandidateId, setEmbeddingLyricsCandidateId] = useState<string | null>(null);
  const lyricsSearchRequestIdRef = useRef(0);

  const fileName = useMemo(() => track?.path.split(/[\\/]/).pop() ?? '', [track?.path]);
  const previewCover =
    selectedCover?.dataUrl ??
    pendingNetworkCover?.previewUrl ??
    (loadedCoverThumb ? previewCoverUrl(null, loadedCoverThumb) : previewCoverUrl(track?.coverId, track?.coverThumb));
  const initialForm = useMemo(() => stateFromTrack(track), [track]);
  const validationErrors = useMemo(() => getValidationErrors(form), [form]);
  const isBusy = isSaving || isLoadingEmbedded || isSearchingNetwork || isSearchingPluginMetadata;
  const isLyricsBusy = isSearchingLyrics || Boolean(applyingLyricsCandidateId) || Boolean(embeddingLyricsCandidateId);
  const isDirty = useMemo(
    () =>
      Boolean(
        track &&
          (JSON.stringify(form) !== JSON.stringify(initialForm) ||
            selectedCover ||
            pendingNetworkCover ||
            loadedCoverThumb !== null),
      ),
    [form, initialForm, loadedCoverThumb, pendingNetworkCover, selectedCover, track],
  );
  const changedFields = useMemo(
    () => fieldDefinitions.filter((field) => form[field.key] !== initialForm[field.key]),
    [form, initialForm],
  );
  const visibleLyricsCandidates = useMemo(
    () =>
      lyricsProviderFilter === 'all'
        ? lyricsCandidates
        : lyricsCandidates.filter((candidate) => candidate.provider === lyricsProviderFilter),
    [lyricsCandidates, lyricsProviderFilter],
  );
  const canEmbedLyrics = track ? canEmbedLyricsIntoTrack(track) : false;

  useEffect(() => {
    if (track) {
      setActiveTab('tags');
      setForm(stateFromTrack(track));
      setSelectedCover(null);
      setPendingNetworkCover(null);
      setLoadedCoverThumb(null);
      setNetworkCandidates([]);
      setPluginMetadataProviders([]);
      setSelectedPluginMetadataProviderKey('all');
      setPluginMetadataLogs([]);
      setSelectedNetworkCandidate(null);
      setNetworkFieldSelection(emptyNetworkSelection());
      setNetworkMessage(null);
      setLocalError(null);
      setShowDiscardConfirm(false);
      setLyricsQuery('');
      setLyricsProviderFilter('all');
      setLyricsCandidates([]);
      setCurrentLyrics(null);
      setLyricsMessage(null);
      setIsSearchingLyrics(false);
      setApplyingLyricsCandidateId(null);
      setEmbeddingLyricsCandidateId(null);
      lyricsSearchRequestIdRef.current += 1;

      const lyricsApi = window.echo?.lyrics;
      if (lyricsApi?.getForTrack) {
        void lyricsApi.getForTrack(track.id).then(setCurrentLyrics).catch(() => undefined);
      }
    }
  }, [track]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'network') {
      return;
    }

    const plugins = window.echo?.plugins;
    if (!plugins?.list) {
      setPluginMetadataProviders([]);
      return;
    }

    let cancelled = false;
    void plugins.list().then((result) => {
      if (cancelled) {
        return;
      }
      const providers = result.plugins
        .filter((plugin) => plugin.enabled && plugin.status !== 'disabled')
        .flatMap((plugin) => plugin.metadataProviders ?? []);
      setPluginMetadataProviders(providers);
      if (selectedPluginMetadataProviderKey !== 'all' && !providers.some((provider) => pluginMetadataProviderKey(provider) === selectedPluginMetadataProviderKey)) {
        setSelectedPluginMetadataProviderKey('all');
      }
    }).catch(() => {
      if (!cancelled) {
        setPluginMetadataProviders([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, isOpen, selectedPluginMetadataProviderKey]);

  const requestClose = (): void => {
    if (isSaving) {
      return;
    }
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        requestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  if (!track) {
    return null;
  }

  const updateField = (field: keyof TagFormState, value: string): void => {
    setForm((current) => ({ ...current, [field]: value }));
    setShowDiscardConfirm(false);
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setLocalError(null);
    if (hasValidationErrors(validationErrors)) {
      setLocalError('请先修正标红字段，再保存标签。');
      return;
    }
    onSave(
      track,
      {
        title: form.title,
        artist: form.artist,
        album: form.album,
        albumArtist: form.albumArtist,
        trackNo: numberOrNull(form.trackNo),
        discNo: numberOrNull(form.discNo),
        year: numberOrNull(form.year),
        genre: form.genre.trim() || null,
      },
      selectedCover?.path ?? null,
      selectedCover ? null : (pendingNetworkCover?.url ?? null),
      selectedCover ? null : (pendingNetworkCover?.mimeType ?? null),
    );
  };

  const handleChooseCover = async (): Promise<void> => {
    const library = window.echo?.library;

    if (!library?.chooseTrackCover) {
      setLocalError('当前运行环境不支持选择封面。');
      return;
    }

    try {
      setLocalError(null);
      const selection = await library.chooseTrackCover();
      if (selection) {
        setSelectedCover(selection);
        setPendingNetworkCover(null);
        setLoadedCoverThumb(null);
        setShowDiscardConfirm(false);
      }
    } catch (chooseError) {
      setLocalError(chooseError instanceof Error ? chooseError.message : String(chooseError));
    }
  };

  const handleLoadEmbedded = async (): Promise<void> => {
    const library = window.echo?.library;

    if (!library?.loadEmbeddedTrackTags) {
      setLocalError('当前运行环境不支持读取内嵌标签。');
      return;
    }

    setIsLoadingEmbedded(true);
    setLocalError(null);

    try {
      const result = await library.loadEmbeddedTrackTags(track.id);
      onTrackUpdated?.(result.track);
      setForm({
        title: result.tags.title,
        artist: result.tags.artist,
        album: result.tags.album,
        albumArtist: result.tags.albumArtist,
        trackNo: result.tags.trackNo ? String(result.tags.trackNo) : '',
        discNo: result.tags.discNo ? String(result.tags.discNo) : '',
        year: result.tags.year ? String(result.tags.year) : '',
        genre: result.tags.genre ?? '',
      });
      setSelectedCover(null);
      setPendingNetworkCover(null);
      setLoadedCoverThumb(result.coverThumb);
      setNetworkMessage('已从源文件内嵌标签重新加载，并同步更新媒体库。');
      setShowDiscardConfirm(false);
    } catch (loadError) {
      setLocalError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoadingEmbedded(false);
    }
  };

  const handleCoverContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();

    const library = window.echo?.library;
    if (!previewCover || selectedCover || pendingNetworkCover || !library?.copyTrackOriginalCover) {
      setLocalError(
        selectedCover || pendingNetworkCover
          ? '新选择的封面需要先保存后，才能复制文件里的封面原图。'
          : '这首歌没有可复制的封面原图。',
      );
      return;
    }

    void (async () => {
      try {
        setLocalError(null);
        const copied = await library.copyTrackOriginalCover(track.id);
        if (!copied) {
          setLocalError('这首歌没有可复制的封面原图。');
          return;
        }

        setNetworkMessage('已复制封面原图。');
      } catch (copyError) {
        setLocalError(copyError instanceof Error ? copyError.message : '复制封面失败。');
      }
    })();
  };

  const handleSearchNetwork = async (): Promise<void> => {
    const library = window.echo?.library;

    if (!library?.searchNetworkTagCandidates) {
      setLocalError('当前运行环境不支持网络标签搜索。');
      return;
    }

    setActiveTab('network');
    setIsSearchingNetwork(true);
    setLocalError(null);
    setNetworkMessage('正在搜索网络标签...');
    setSelectedNetworkCandidate(null);
    setNetworkFieldSelection(emptyNetworkSelection());

    try {
      const candidates = await library.searchNetworkTagCandidates(track.id);
      setNetworkCandidates(candidates);
      setNetworkMessage(candidates.length ? null : '没有找到合适的网络标签。');
    } catch (searchError) {
      setNetworkCandidates([]);
      const message = searchError instanceof Error ? searchError.message : '网络来源暂时不可用，请稍后再试。';
      setNetworkMessage(
        message.includes('网络来源暂时不可用') || message.includes('Network metadata provider')
          ? '暂时没有拿到标签候选。请检查网络元数据来源或稍后重试；如果要搜歌词，请切到“歌词”页签。'
          : message,
      );
    } finally {
      setIsSearchingNetwork(false);
    }
  };

  const loadPluginMetadataLogs = async (pluginIds: string[]): Promise<void> => {
    const plugins = window.echo?.plugins;
    if (!plugins?.getLogs) {
      setPluginMetadataLogs([]);
      return;
    }

    try {
      const uniquePluginIds = [...new Set(pluginIds.filter(Boolean))];
      const logLists = uniquePluginIds.length
        ? await Promise.all(uniquePluginIds.map((pluginId) => plugins.getLogs(pluginId)))
        : [await plugins.getLogs()];
      setPluginMetadataLogs(logLists.flat().filter(isMetadataPluginLog).slice(-3).reverse());
    } catch {
      setPluginMetadataLogs([]);
    }
  };

  const handleSearchPluginMetadata = async (): Promise<void> => {
    const plugins = window.echo?.plugins;
    if (!plugins?.queryMetadata) {
      setLocalError('当前运行环境不支持插件元数据候选。');
      return;
    }
    const selectedProvider = pluginMetadataProviders.find((provider) => pluginMetadataProviderKey(provider) === selectedPluginMetadataProviderKey);

    setActiveTab('network');
    setIsSearchingPluginMetadata(true);
    setLocalError(null);
    setNetworkMessage('正在查询插件候选...');
    setPluginMetadataLogs([]);
    setSelectedNetworkCandidate(null);
    setNetworkFieldSelection(emptyNetworkSelection());

    try {
      const result = await plugins.queryMetadata({
        track: {
          id: track.id,
          title: form.title || track.title,
          artist: form.artist || track.artist,
          album: form.album || track.album,
          albumArtist: form.albumArtist || track.albumArtist,
          duration: track.duration ?? undefined,
        },
        ...(selectedProvider
          ? { provider: { pluginId: selectedProvider.pluginId, providerId: selectedProvider.id } }
          : {}),
      });
      const candidates = pluginMetadataCandidatesToNetworkCandidates(result, track);
      setNetworkCandidates(candidates);
      if (!candidates.length && result.providers.length) {
        await loadPluginMetadataLogs(result.providers.map((provider) => provider.pluginId));
      }
      setNetworkMessage(
        candidates.length
          ? null
          : result.providers.length
            ? '插件没有返回合适的元数据候选。'
            : '没有可用的插件元数据 provider。',
      );
    } catch (searchError) {
      setNetworkCandidates([]);
      await loadPluginMetadataLogs(selectedProvider ? [selectedProvider.pluginId] : pluginMetadataProviders.map((provider) => provider.pluginId));
      setNetworkMessage(searchError instanceof Error ? searchError.message : '插件元数据候选暂时不可用。');
    } finally {
      setIsSearchingPluginMetadata(false);
    }
  };

  const handleSelectNetworkCandidate = (candidate: NetworkTagCandidate): void => {
    setSelectedNetworkCandidate(candidate);
    setNetworkFieldSelection(defaultNetworkFieldSelection(form, track, candidate));
  };

  const handleToggleNetworkField = (field: keyof NetworkFieldSelection): void => {
    setNetworkFieldSelection((current) => ({ ...current, [field]: !current[field] }));
  };

  const handleToggleAllNetworkFields = (): void => {
    setNetworkFieldSelection((current) => {
      const nextChecked = !allNetworkFieldsSelected(current);
      return networkFieldLabels.reduce(
        (next, field) => ({
          ...next,
          [field.key]: nextChecked,
        }),
        emptyNetworkSelection(),
      );
    });
  };

  const handleUseMissingOnlyNetworkFields = (): void => {
    if (!selectedNetworkCandidate) {
      return;
    }

    setNetworkFieldSelection(missingOnlyNetworkFieldSelection(form, track, selectedNetworkCandidate));
  };

  const handleUseConfidentNetworkFields = (): void => {
    if (!selectedNetworkCandidate) {
      return;
    }

    setNetworkFieldSelection(defaultNetworkFieldSelection(form, track, selectedNetworkCandidate));
  };

  const handleApplyNetworkCandidate = (): void => {
    if (!selectedNetworkCandidate) {
      return;
    }

    setForm((current) => applyNetworkCandidateToForm(current, selectedNetworkCandidate, networkFieldSelection));

    if (networkFieldSelection.cover && selectedNetworkCandidate.coverUrl) {
      setPendingNetworkCover({
        url: selectedNetworkCandidate.coverUrl,
        mimeType: selectedNetworkCandidate.coverMimeType ?? null,
        previewUrl: selectedNetworkCandidate.coverPreviewUrl ?? selectedNetworkCandidate.coverUrl,
      });
      setSelectedCover(null);
      setLoadedCoverThumb(null);
    }

    setNetworkMessage('已应用到表单，点击保存后才会写入文件和媒体库。');
    setShowDiscardConfirm(false);
  };

  const handleSearchLyrics = async (): Promise<void> => {
    const lyricsApi = window.echo?.lyrics;
    if (!lyricsApi?.searchCandidates) {
      setLocalError('当前运行环境不支持歌词搜索。');
      return;
    }

    const requestId = lyricsSearchRequestIdRef.current + 1;
    lyricsSearchRequestIdRef.current = requestId;
    const searchText = lyricsQuery.trim() || [form.title || track.title, form.artist || track.artist].filter(Boolean).join(' ');
    const providers = lyricsProviderFilter === 'all' ? lyricSearchProviders : [lyricsProviderFilter];

    setActiveTab('lyrics');
    setIsSearchingLyrics(true);
    setLocalError(null);
    setLyricsMessage('正在搜索歌词候选...');

    try {
      const results = await Promise.allSettled(
        providers.map((providerId) => lyricsApi.searchCandidates(track.id, searchText, providerId)),
      );
      if (lyricsSearchRequestIdRef.current !== requestId) {
        return;
      }

      const candidateLists = results
        .filter((result): result is PromiseFulfilledResult<LyricsSearchCandidate[]> => result.status === 'fulfilled')
        .map((result) => result.value);
      const nextCandidates = dedupeLyricsCandidates(candidateLists).slice(0, 12);
      setLyricsCandidates(nextCandidates);
      setLyricsMessage(nextCandidates.length ? null : '没有找到合适的歌词候选。');
    } catch (searchError) {
      if (lyricsSearchRequestIdRef.current === requestId) {
        setLyricsCandidates([]);
        setLyricsMessage(null);
        setLocalError(searchError instanceof Error ? searchError.message : '歌词搜索暂时不可用，请稍后再试。');
      }
    } finally {
      if (lyricsSearchRequestIdRef.current === requestId) {
        setIsSearchingLyrics(false);
      }
    }
  };

  const handleApplyLyricsCandidate = async (candidate: LyricsSearchCandidate): Promise<void> => {
    const lyricsApi = window.echo?.lyrics;
    if (!lyricsApi?.applyCandidate) {
      setLocalError('当前运行环境不支持应用歌词。');
      return;
    }

    setApplyingLyricsCandidateId(candidate.id);
    setLocalError(null);
    setLyricsMessage(null);

    try {
      const lyrics = await lyricsApi.applyCandidate(track.id, candidate.id);
      setCurrentLyrics(lyrics);
      setLyricsMessage('已应用到歌词库，不会写入源音频文件。');
      window.dispatchEvent(new CustomEvent('lyrics:candidate-applied', { detail: { trackId: track.id, lyrics } }));
    } catch (applyError) {
      setLocalError(applyError instanceof Error ? applyError.message : '应用歌词失败。');
    } finally {
      setApplyingLyricsCandidateId(null);
    }
  };

  const refreshCurrentLyrics = async (): Promise<void> => {
    const lyricsApi = window.echo?.lyrics;
    if (lyricsApi?.getForTrack) {
      const lyrics = await lyricsApi.getForTrack(track.id);
      setCurrentLyrics(lyrics);
    }
  };

  const handleEmbedLyrics = async (candidate?: LyricsSearchCandidate): Promise<void> => {
    const lyricsApi = window.echo?.lyrics;
    if (!lyricsApi?.embedToTrack) {
      setLocalError('当前运行环境不支持嵌入歌词到文件。');
      return;
    }

    if (!canEmbedLyrics) {
      setLocalError('远程、流媒体或临时曲目不能写入源文件，只能应用到歌词库。');
      return;
    }

    const pendingId = candidate?.id ?? 'current';
    setEmbeddingLyricsCandidateId(pendingId);
    setLocalError(null);
    setLyricsMessage(null);

    try {
      const result: LyricsEmbedToTrackResult = await lyricsApi.embedToTrack(
        track.id,
        candidate ? { candidateId: candidate.id, preferSynced: true } : { preferSynced: true },
      );
      await refreshCurrentLyrics();
      setLyricsMessage(result.message);
      if (candidate) {
        window.dispatchEvent(new CustomEvent('lyrics:candidate-applied', { detail: { trackId: track.id } }));
      }
    } catch (embedError) {
      setLocalError(embedError instanceof Error ? embedError.message : '嵌入歌词失败。');
    } finally {
      setEmbeddingLyricsCandidateId(null);
    }
  };

  const renderField = (definition: FieldDefinition): JSX.Element => {
    const numericError = definition.key === 'trackNo' || definition.key === 'discNo' || definition.key === 'year' ? validationErrors[definition.key] : null;
    return (
      <label key={definition.key} className="tag-editor-field" data-invalid={Boolean(numericError)}>
        <span>{definition.label}</span>
        <input
          disabled={isBusy}
          inputMode={definition.inputMode}
          value={form[definition.key]}
          aria-invalid={Boolean(numericError)}
          aria-label={definition.label}
          onChange={(event) => updateField(definition.key, event.target.value)}
        />
        {numericError ? <em>{numericError}</em> : null}
      </label>
    );
  };

  const fieldSourceEntries = Object.entries(track.fieldSources ?? {}).filter(([, source]) => source);
  const coverChangeLabel = selectedCover
    ? '已选择本地封面'
    : pendingNetworkCover
      ? '已选择网络封面'
      : loadedCoverThumb
        ? '已载入内嵌封面'
        : null;

  const editor = (
    <div className="tag-editor-root" data-open={isOpen}>
      <button className="tag-editor-scrim" type="button" aria-label="关闭编辑标签" onClick={requestClose} />
      <form className="tag-editor-drawer" onSubmit={handleSubmit}>
        <div className="tag-editor-scroll">
          <header className="tag-editor-header">
            <div>
              <Tag size={23} />
              <div>
                <h2>编辑标签</h2>
                <p>{isDirty ? '未保存更改' : '单曲编辑工作台'}</p>
              </div>
            </div>
            <button className="tag-editor-close" type="button" aria-label="关闭编辑标签" onClick={requestClose}>
              <X size={22} />
            </button>
          </header>

          <div className="tag-editor-workbench">
            <aside className="tag-editor-rail">
              <section className="tag-editor-cover-card" aria-label="当前文件">
                <div
                  className="tag-editor-cover"
                  data-empty={!previewCover}
                  onContextMenu={handleCoverContextMenu}
                  title={previewCover ? '右键复制封面原图' : undefined}
                >
                  {previewCover ? <img alt="" src={previewCover} /> : <Disc3 size={42} />}
                </div>
                <div className="tag-editor-file">
                  <span className="tag-editor-kicker">当前文件</span>
                  <strong>{fileName}</strong>
                  <span title={track.path}>{track.path}</span>
                  <small>
                    {selectedCover
                      ? `本地封面：${selectedCover.path}`
                      : pendingNetworkCover
                        ? '网络封面将在保存时下载并写入。'
                        : loadedCoverThumb
                          ? '已从内嵌标签重新载入封面。'
                          : '留空会保留当前内嵌封面。'}
                  </small>
                </div>
                <div className="tag-editor-tool-row">
                  <button type="button" onClick={() => void handleChooseCover()} disabled={isBusy}>
                    <ImagePlus size={17} />
                    选择封面
                  </button>
                  <button type="button" onClick={() => void handleLoadEmbedded()} disabled={isBusy}>
                    <RefreshCw size={17} />
                    {isLoadingEmbedded ? '读取中' : '从内嵌标签加载'}
                  </button>
                  <button type="button" onClick={() => void handleSearchNetwork()} disabled={isBusy}>
                    <CloudDownload size={17} />
                    {isSearchingNetwork ? '搜索中' : '搜标签'}
                  </button>
                  <button type="button" onClick={() => void handleSearchLyrics()} disabled={isLyricsBusy}>
                    <FileText size={17} />
                    {isSearchingLyrics ? '搜索中' : '搜歌词'}
                  </button>
                </div>
              </section>

              <section className="tag-editor-status-card">
                <div className="tag-editor-status-card__title">
                  <FileAudio size={16} />
                  <span>音频信息</span>
                </div>
                <strong>{formatAudioSummary(track)}</strong>
                <p>{formatDuration(track.duration)}</p>
              </section>

              <section className="tag-editor-status-card">
                <div className="tag-editor-status-card__title">
                  <ListChecks size={16} />
                  <span>变更摘要</span>
                </div>
                {changedFields.length || coverChangeLabel ? (
                  <ul className="tag-editor-change-list">
                    {changedFields.map((field) => (
                      <li key={field.key}>
                        <span>{field.label}</span>
                        <strong>{fieldValue(form[field.key])}</strong>
                      </li>
                    ))}
                    {coverChangeLabel ? (
                      <li>
                        <span>封面</span>
                        <strong>{coverChangeLabel}</strong>
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <p>暂时没有改动。</p>
                )}
              </section>
            </aside>

            <main className="tag-editor-main">
              <div className="tag-editor-tabs" role="tablist" aria-label="编辑标签分段">
                {editorTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab.key}
                      data-active={activeTab === tab.key}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      <Icon size={16} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {activeTab === 'tags' ? (
                <div className="tag-editor-tab-panel" role="tabpanel">
                  <section className="tag-editor-section">
                    <div className="tag-editor-section-heading">
                      <h3>基础信息</h3>
                      <span>标题、艺术家和主要展示信息</span>
                    </div>
                    <div className="tag-editor-grid tag-editor-grid--basic">{fieldDefinitions.filter((field) => field.group === 'basic').map(renderField)}</div>
                  </section>

                  <section className="tag-editor-section">
                    <div className="tag-editor-section-heading">
                      <h3>唱片信息</h3>
                      <span>用于专辑墙和艺术家归类</span>
                    </div>
                    <div className="tag-editor-grid">{fieldDefinitions.filter((field) => field.group === 'album').map(renderField)}</div>
                  </section>

                  <section className="tag-editor-section">
                    <div className="tag-editor-section-heading">
                      <h3>排序信息</h3>
                      <span>可留空</span>
                    </div>
                    <div className="tag-editor-grid tag-editor-grid--compact">{fieldDefinitions.filter((field) => field.group === 'order').map(renderField)}</div>
                  </section>
                </div>
              ) : null}

              {activeTab === 'network' ? (
                <section className="tag-editor-section tag-editor-network-panel tag-editor-tab-panel" aria-label="网络候选对比" role="tabpanel">
                  <div className="tag-editor-section-heading">
                    <h3>网络候选</h3>
                    <div className="tag-editor-heading-actions">
                      <button type="button" onClick={() => void handleSearchNetwork()} disabled={isBusy}>
                        <CloudDownload size={16} />
                        {isSearchingNetwork ? '搜索中' : '搜索候选'}
                      </button>
                      <button type="button" onClick={() => void handleSearchPluginMetadata()} disabled={isBusy}>
                        <ListChecks size={16} />
                        {isSearchingPluginMetadata ? '查询中' : '插件候选'}
                      </button>
                    </div>
                  </div>

                  {networkMessage ? <p className="tag-editor-network-message">{networkMessage}</p> : null}

                  {pluginMetadataLogs.length ? (
                    <div className="tag-editor-plugin-log-hints" aria-label="插件元数据最近错误">
                      <span>最近插件日志</span>
                      {pluginMetadataLogs.map((log) => (
                        <p key={log.id}>
                          <strong>{log.pluginId}</strong>
                          <em>{log.message}</em>
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {pluginMetadataProviders.length ? (
                    <div className="tag-editor-filter-row" aria-label="插件元数据来源筛选">
                      <button
                        type="button"
                        data-active={selectedPluginMetadataProviderKey === 'all'}
                        onClick={() => setSelectedPluginMetadataProviderKey('all')}
                      >
                        全部插件
                      </button>
                      {pluginMetadataProviders.map((provider) => {
                        const providerKey = pluginMetadataProviderKey(provider);
                        return (
                          <button
                            key={providerKey}
                            type="button"
                            data-active={selectedPluginMetadataProviderKey === providerKey}
                            onClick={() => setSelectedPluginMetadataProviderKey(providerKey)}
                          >
                            {provider.title || provider.id}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {networkCandidates.length ? (
                    <div className="tag-editor-network-content">
                      <div className="tag-editor-network-list">
                        {networkCandidates.map((candidate) => (
                          <button
                            key={candidate.id}
                            className="tag-editor-network-candidate"
                            type="button"
                            data-selected={selectedNetworkCandidate?.id === candidate.id}
                            onClick={() => handleSelectNetworkCandidate(candidate)}
                          >
                            <span className="tag-editor-network-cover" data-empty={!candidate.coverPreviewUrl}>
                              {candidate.coverPreviewUrl ? <img alt="" src={candidate.coverPreviewUrl} /> : <Tag size={24} />}
                            </span>
                            <span className="tag-editor-network-copy">
                              <strong>{candidate.title || '未知标题'}</strong>
                              <em>{candidate.artist || '未知艺术家'}</em>
                              <small>{[candidate.album, candidate.albumArtist, candidate.year, formatDuration(candidate.duration)].filter(Boolean).join(' · ')}</small>
                            </span>
                            <span className="tag-editor-network-score">
                              <b>{networkCandidateProviderLabel(candidate)}</b>
                              <em>{Math.round(candidate.confidence * 100)}%</em>
                            </span>
                          </button>
                        ))}
                      </div>

                      {selectedNetworkCandidate ? (
                        <div className="tag-editor-network-fields">
                          <div className="tag-editor-network-fields-header">
                            <span>选择要应用到表单的字段</span>
                            <div className="tag-editor-network-fields-actions">
                              <button
                                type="button"
                                onClick={handleApplyNetworkCandidate}
                                disabled={isSaving || !someNetworkFieldsSelected(networkFieldSelection)}
                              >
                                <Check size={16} />
                                应用选中字段
                              </button>
                              <label>
                                <input
                                  ref={(node) => {
                                    if (node) {
                                      node.indeterminate = someNetworkFieldsSelected(networkFieldSelection) && !allNetworkFieldsSelected(networkFieldSelection);
                                    }
                                  }}
                                  type="checkbox"
                                  checked={allNetworkFieldsSelected(networkFieldSelection)}
                                  onChange={handleToggleAllNetworkFields}
                                />
                                <span>全选</span>
                              </label>
                            </div>
                          </div>

                          <div className="tag-editor-network-presets" aria-label="网络候选应用策略">
                            <button type="button" onClick={handleUseMissingOnlyNetworkFields}>
                              只补空字段
                            </button>
                            <button type="button" onClick={handleUseConfidentNetworkFields}>
                              覆盖高置信字段
                            </button>
                          </div>

                          <div className="tag-editor-compare-table">
                            <div className="tag-editor-compare-head">
                              <span>字段</span>
                              <span>当前</span>
                              <span>候选</span>
                            </div>
                            {networkFieldLabels.map((field) => {
                              const candidateValue = field.key === 'cover' ? (selectedNetworkCandidate.coverUrl ? '网络封面' : '') : candidateFieldValue(selectedNetworkCandidate, field.key);
                              const currentValue = field.key === 'cover' ? (previewCover ? '已有封面' : '') : form[field.key];
                              const canApply = field.key === 'cover' ? Boolean(selectedNetworkCandidate.coverUrl) : hasFormValue(candidateValue);
                              return (
                                <label key={field.key} className="tag-editor-compare-row" data-disabled={!canApply}>
                                  <span>
                                    <input
                                      type="checkbox"
                                      disabled={!canApply}
                                      checked={networkFieldSelection[field.key] && canApply}
                                      onChange={() => handleToggleNetworkField(field.key)}
                                    />
                                    {field.label}
                                  </span>
                                  <em>{fieldValue(currentValue)}</em>
                                  <strong>{fieldValue(candidateValue)}</strong>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {activeTab === 'lyrics' ? (
                <section className="tag-editor-section tag-editor-lyrics-panel tag-editor-tab-panel" aria-label="歌词搜索与嵌入" role="tabpanel">
                  <div className="tag-editor-section-heading">
                    <h3>歌词</h3>
                    <button type="button" onClick={() => void handleSearchLyrics()} disabled={isLyricsBusy}>
                      <Search size={16} />
                      {isSearchingLyrics ? '搜索中' : '搜索歌词'}
                    </button>
                  </div>

                  <div className="tag-editor-lyrics-status">
                    <div>
                      <span>当前歌词库</span>
                      <strong>{lyricsKindLabel(currentLyrics)}</strong>
                    </div>
                    <button type="button" onClick={() => void handleEmbedLyrics()} disabled={!canEmbedLyrics || isLyricsBusy || !currentLyrics || currentLyrics.kind === 'instrumental' || currentLyrics.kind === 'empty'}>
                      <FileText size={16} />
                      嵌入当前歌词
                    </button>
                  </div>

                  <div className="tag-editor-lyrics-search">
                    <label>
                      <span>搜索词</span>
                      <input
                        aria-label="歌词搜索关键词"
                        value={lyricsQuery}
                        placeholder={`${form.title || track.title} ${form.artist || track.artist}`}
                        onChange={(event) => setLyricsQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleSearchLyrics();
                          }
                        }}
                      />
                    </label>
                    <div className="tag-editor-filter-row" aria-label="歌词来源筛选">
                      <button type="button" data-active={lyricsProviderFilter === 'all'} onClick={() => setLyricsProviderFilter('all')}>
                        全部
                      </button>
                      {lyricSearchProviders.map((providerId) => (
                        <button
                          key={providerId}
                          type="button"
                          data-active={lyricsProviderFilter === providerId}
                          onClick={() => setLyricsProviderFilter(providerId)}
                        >
                          {lyricProviderLabels[providerId]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {!canEmbedLyrics ? <p className="tag-editor-network-message">此曲目只能应用到歌词库，不能写入源文件。</p> : null}
                  {lyricsMessage ? <p className="tag-editor-network-message">{lyricsMessage}</p> : null}

                  {visibleLyricsCandidates.length ? (
                    <div className="tag-editor-lyrics-candidates">
                      {visibleLyricsCandidates.map((candidate) => {
                        const candidateKind = lyricsCandidateDisplayKind(candidate);
                        const canEmbedCandidate = canEmbedLyrics && !candidate.instrumental && (candidate.hasSynced || candidate.hasPlain);
                        return (
                          <article
                            key={candidate.id}
                            className={`tag-editor-lyrics-candidate tag-editor-lyrics-candidate--${candidateKind}`}
                            data-lyrics-kind={candidateKind}
                          >
                            <div className="tag-editor-lyrics-candidate__main">
                              <span className="tag-editor-kicker">{candidate.sourceLabel || lyricProviderLabels[candidate.provider]}</span>
                              <strong>{candidate.title || '未知标题'}</strong>
                              <em>{candidate.artist || '未知艺术家'}</em>
                              <small>{[candidate.album, formatDuration(candidate.durationSeconds)].filter(Boolean).join(' · ')}</small>
                            </div>
                            <div className="tag-editor-lyrics-badges">
                              <span>{formatLyricsScore(candidate.score)}</span>
                              <span>{candidate.risk ? lyricRiskLabels[candidate.risk] : '普通匹配'}</span>
                              <span>{lyricCandidateDisplayLabels[candidateKind]}</span>
                            </div>
                            <div className="tag-editor-lyrics-actions">
                              <button type="button" onClick={() => void handleApplyLyricsCandidate(candidate)} disabled={isLyricsBusy}>
                                <Check size={16} />
                                {applyingLyricsCandidateId === candidate.id ? '应用中' : '应用到歌词库'}
                              </button>
                              <button type="button" onClick={() => void handleEmbedLyrics(candidate)} disabled={!canEmbedCandidate || isLyricsBusy}>
                                <FileText size={16} />
                                {embeddingLyricsCandidateId === candidate.id ? '排队中' : '应用并嵌入文件'}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {activeTab === 'file' ? (
                <section className="tag-editor-section tag-editor-file-panel tag-editor-tab-panel" aria-label="文件信息" role="tabpanel">
                  <div className="tag-editor-section-heading">
                    <h3>文件</h3>
                    <span>本地写入会走后台队列</span>
                  </div>
                  <div className="tag-editor-file-grid">
                    <div>
                      <span>路径</span>
                      <strong title={track.path}>{track.path}</strong>
                    </div>
                    <div>
                      <span>写入状态</span>
                      <strong>{canEmbedLyrics ? '支持写入源文件' : '仅缓存到媒体库'}</strong>
                    </div>
                    <div>
                      <span>音频</span>
                      <strong>{formatAudioSummary(track)}</strong>
                    </div>
                    <div>
                      <span>字段来源</span>
                      <strong>{fieldSourceEntries.length ? `${fieldSourceEntries.length} 项已记录` : '暂无来源记录'}</strong>
                    </div>
                  </div>
                  {fieldSourceEntries.length ? (
                    <div className="tag-editor-source-list">
                      {fieldSourceEntries.map(([field, source]) => (
                        <span key={field}>
                          <b>{field}</b>
                          {source}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </main>
          </div>

        {networkMessage && activeTab !== 'network' ? <p className="tag-editor-network-message">{networkMessage}</p> : null}
        {error || localError ? <p className="tag-editor-error">{error ?? localError}</p> : null}

        {showDiscardConfirm ? (
          <div className="tag-editor-discard" role="alert">
            <span>有未保存更改，确认关闭并丢弃吗？</span>
            <button type="button" onClick={() => setShowDiscardConfirm(false)}>
              继续编辑
            </button>
            <button type="button" onClick={onClose}>
              丢弃更改
            </button>
          </div>
        ) : null}

        <footer className="tag-editor-actions">
          <span>保存会写入源音频文件；播放中会排队延后。</span>
          <button className="tag-editor-cancel" type="button" onClick={requestClose} disabled={isSaving}>
            取消
          </button>
          <button className="tag-editor-save" type="submit" disabled={isSaving || hasValidationErrors(validationErrors)}>
            <Save size={18} />
            {isSaving ? '保存中' : '保存标签'}
          </button>
        </footer>
        </div>
      </form>
    </div>
  );

  return createPortal(editor, document.body);
};
