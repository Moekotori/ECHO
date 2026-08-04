import { AlertTriangle, Disc3, Loader2, Play, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AudioCdDrive, AudioCdStatus, AudioCdTrack } from '../../shared/types/audioCd';
import type { Locale } from '../i18n/locales';
import { useI18n } from '../i18n/I18nProvider';
import { getAudioCdBridge } from '../utils/echoBridge';

type AudioCdCopy = {
  title: string;
  subtitle: string;
  refresh: string;
  drive: string;
  tracks: string;
  cdInput: string;
  available: string;
  unavailable: string;
  loading: string;
  play: string;
  playing: string;
  direct: string;
  noDuration: string;
  errors: Record<string, string>;
};

const audioCdCopyByLocale: Record<Locale, AudioCdCopy> = {
  'zh-CN': {
    title: 'Audio CD',
    subtitle: '直接播放光盘音轨',
    refresh: '刷新',
    drive: '光驱',
    tracks: '音轨',
    cdInput: 'CD 输入',
    available: '可用',
    unavailable: '不可用',
    loading: '读取中',
    play: '播放',
    playing: '正在打开音轨...',
    direct: '直接播放',
    noDuration: '未知时长',
    errors: {
      audio_cd_bridge_unavailable: '桌面桥接不可用。',
      audio_cd_tracks_unavailable: '未能读取到可播放音轨。',
      ffmpeg_unavailable: 'FFmpeg 不可用。',
      libcdio_unavailable: '当前 FFmpeg 不支持 CD 输入。',
      no_cd_drive: '未检测到光驱。',
      no_cd_drive_selected: '请选择光驱。',
      no_disc_loaded: '未检测到已载入的 Audio CD。',
    },
  },
  'zh-TW': {
    title: 'Audio CD',
    subtitle: '直接播放光碟音軌',
    refresh: '重新整理',
    drive: '光碟機',
    tracks: '音軌',
    cdInput: 'CD 輸入',
    available: '可用',
    unavailable: '不可用',
    loading: '讀取中',
    play: '播放',
    playing: '正在開啟音軌...',
    direct: '直接播放',
    noDuration: '未知長度',
    errors: {
      audio_cd_bridge_unavailable: '桌面橋接不可用。',
      audio_cd_tracks_unavailable: '未能讀取可播放音軌。',
      ffmpeg_unavailable: 'FFmpeg 不可用。',
      libcdio_unavailable: '目前 FFmpeg 不支援 CD 輸入。',
      no_cd_drive: '未偵測到光碟機。',
      no_cd_drive_selected: '請選擇光碟機。',
      no_disc_loaded: '未偵測到已載入的 Audio CD。',
    },
  },
  'ja-JP': {
    title: 'Audio CD',
    subtitle: 'Audio CD のトラックを直接再生',
    refresh: '再読み込み',
    drive: 'ドライブ',
    tracks: 'トラック',
    cdInput: 'CD 入力',
    available: '利用可能',
    unavailable: '利用不可',
    loading: '読み込み中',
    play: '再生',
    playing: 'トラックを開いています...',
    direct: '直接再生',
    noDuration: '長さ不明',
    errors: {
      audio_cd_bridge_unavailable: 'デスクトップブリッジが利用できません。',
      audio_cd_tracks_unavailable: '再生可能なトラックを読み取れませんでした。',
      ffmpeg_unavailable: 'FFmpeg が利用できません。',
      libcdio_unavailable: '現在の FFmpeg は CD 入力に対応していません。',
      no_cd_drive: 'CD ドライブが見つかりません。',
      no_cd_drive_selected: 'CD ドライブを選択してください。',
      no_disc_loaded: '読み込み済みの Audio CD が見つかりません。',
    },
  },
  'en-US': {
    title: 'Audio CD',
    subtitle: 'Direct disc track playback',
    refresh: 'Refresh',
    drive: 'Drive',
    tracks: 'Tracks',
    cdInput: 'CD input',
    available: 'Available',
    unavailable: 'Unavailable',
    loading: 'Reading',
    play: 'Play',
    playing: 'Opening track...',
    direct: 'Direct',
    noDuration: 'Unknown length',
    errors: {
      audio_cd_bridge_unavailable: 'Desktop bridge unavailable.',
      audio_cd_tracks_unavailable: 'No playable tracks could be read.',
      ffmpeg_unavailable: 'FFmpeg is unavailable.',
      libcdio_unavailable: 'The current FFmpeg build does not support CD input.',
      no_cd_drive: 'No CD drive detected.',
      no_cd_drive_selected: 'Select a CD drive.',
      no_disc_loaded: 'No loaded Audio CD detected.',
    },
  },
};

const emptyStatus: AudioCdStatus = {
  ffmpegAvailable: false,
  libcdioAvailable: false,
  drives: [],
  selectedDriveId: null,
  tracks: [],
  error: null,
};

const formatDuration = (seconds: number | null | undefined, fallback: string): string => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return fallback;
  }

  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

const getDriveLabel = (drive: AudioCdDrive): string => {
  const parts = [drive.name, drive.device].filter(Boolean);
  return Array.from(new Set(parts)).join(' - ');
};

const resolveErrorText = (copy: AudioCdCopy, error: string | null): string | null => {
  if (!error) {
    return null;
  }

  return copy.errors[error] ?? error;
};

export const AudioCdPage = (): JSX.Element => {
  const { locale } = useI18n();
  const copy = audioCdCopyByLocale[locale] ?? audioCdCopyByLocale['zh-CN'];
  const [status, setStatus] = useState<AudioCdStatus>(emptyStatus);
  const [selectedDriveId, setSelectedDriveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [busyTrackId, setBusyTrackId] = useState<string | null>(null);
  const [transientError, setTransientError] = useState<string | null>(null);

  const drives = status.drives;
  const selectedDrive = useMemo(
    () => drives.find((drive) => drive.id === (selectedDriveId ?? status.selectedDriveId)) ?? drives[0] ?? null,
    [drives, selectedDriveId, status.selectedDriveId],
  );
  const selectedDriveValue = selectedDrive?.id ?? '';
  const errorText = resolveErrorText(copy, transientError ?? status.error);

  const refresh = useCallback(async (driveId?: string | null): Promise<void> => {
    const bridge = getAudioCdBridge();
    if (!bridge) {
      setStatus({ ...emptyStatus, error: 'audio_cd_bridge_unavailable' });
      return;
    }

    setIsLoading(true);
    setTransientError(null);
    try {
      const nextStatus = await bridge.getStatus(driveId ?? selectedDriveId);
      setStatus(nextStatus);
      setSelectedDriveId(nextStatus.selectedDriveId);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setIsLoading(false);
    }
  }, [selectedDriveId]);

  useEffect(() => {
    void refresh(null);
  }, [refresh]);

  const handleDriveChange = (nextDriveId: string): void => {
    setSelectedDriveId(nextDriveId || null);
    void refresh(nextDriveId || null);
  };

  const playTrack = async (track: AudioCdTrack): Promise<void> => {
    const bridge = getAudioCdBridge();
    if (!bridge || !selectedDrive) {
      setTransientError('audio_cd_bridge_unavailable');
      return;
    }

    setBusyTrackId(track.id);
    setTransientError(null);
    try {
      await bridge.playTrack({
        driveId: selectedDrive.id,
        device: selectedDrive.device,
        trackIndex: track.index,
      });
    } catch (error) {
      setTransientError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyTrackId(null);
    }
  };

  return (
    <div className="page-stack audio-cd-page">
      <section className="audio-cd-hero" aria-labelledby="audio-cd-title">
        <div className="audio-cd-heading">
          <span className="audio-cd-badge">
            <Disc3 size={16} aria-hidden="true" />
            {copy.direct}
          </span>
          <div>
            <h1 id="audio-cd-title">{copy.title}</h1>
            <p>{copy.subtitle}</p>
          </div>
        </div>
        <div className="audio-cd-toolbar">
          <label className="audio-cd-drive-select">
            <span>{copy.drive}</span>
            <select value={selectedDriveValue} onChange={(event) => handleDriveChange(event.currentTarget.value)} disabled={isLoading || drives.length === 0}>
              {drives.length === 0 ? <option value="">{copy.unavailable}</option> : null}
              {drives.map((drive) => (
                <option key={drive.id} value={drive.id}>
                  {getDriveLabel(drive)}
                </option>
              ))}
            </select>
          </label>
          <button className="settings-action-button" type="button" onClick={() => void refresh(selectedDriveId)} disabled={isLoading}>
            {isLoading ? <Loader2 className="spinning-icon" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
            {isLoading ? copy.loading : copy.refresh}
          </button>
        </div>
      </section>

      <section className="audio-cd-metrics" aria-label="Audio CD status">
        <span>
          <strong>{drives.length}</strong>
          {copy.drive}
        </span>
        <span>
          <strong>{status.tracks.length}</strong>
          {copy.tracks}
        </span>
        <span data-state={status.ffmpegAvailable && status.libcdioAvailable ? 'available' : 'unavailable'}>
          <strong>{status.ffmpegAvailable && status.libcdioAvailable ? copy.available : copy.unavailable}</strong>
          {copy.cdInput}
        </span>
      </section>

      {errorText ? (
        <div className="audio-cd-notice" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{errorText}</span>
        </div>
      ) : null}

      <section className="audio-cd-track-list" aria-label={copy.tracks}>
        {status.tracks.map((track) => {
          const busy = busyTrackId === track.id;
          return (
            <article className="audio-cd-track-row" key={track.id} data-playable={track.playable}>
              <div className="audio-cd-track-index">{String(track.index).padStart(2, '0')}</div>
              <div className="audio-cd-track-main">
                <strong>{track.title}</strong>
                <span>{formatDuration(track.durationSeconds, copy.noDuration)}</span>
              </div>
              <button
                className="audio-cd-play-button"
                type="button"
                onClick={() => void playTrack(track)}
                disabled={!track.playable || busyTrackId !== null}
                title={copy.play}
              >
                {busy ? <Loader2 className="spinning-icon" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                <span>{busy ? copy.playing : copy.play}</span>
              </button>
            </article>
          );
        })}
      </section>
    </div>
  );
};
