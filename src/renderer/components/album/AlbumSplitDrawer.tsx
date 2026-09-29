import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FolderOpen, Loader2, Scissors, TriangleAlert, X } from 'lucide-react';
import type { LibraryAlbum } from '../../../shared/types/library';
import type {
  AlbumSplitFileNamePattern,
  AlbumSplitFormat,
  AlbumSplitJobStatus,
  AlbumSplitOutputStatus,
  AlbumSplitPlan,
  AlbumSplitSkipReason,
} from '../../../shared/types/albumSplit';
import { albumSplitFileNamePatterns, albumSplitFormats } from '../../../shared/types/albumSplit';
import { useI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { localCoverDisplayUrl } from '../../utils/coverDisplayUrl';
import '../../styles/album-split-drawer.css';

type AlbumSplitDrawerProps = {
  album: LibraryAlbum | null;
  isOpen: boolean;
  onClose: () => void;
  onCompleted?: (status: AlbumSplitJobStatus) => void;
};

const formatLabelKeys: Record<AlbumSplitFormat, TranslationKey> = {
  flac: 'albumSplit.format.flac',
  mp3: 'albumSplit.format.mp3',
  wav: 'albumSplit.format.wav',
  ogg: 'albumSplit.format.ogg',
};

const patternLabelKeys: Record<AlbumSplitFileNamePattern, TranslationKey> = {
  'track-title': 'albumSplit.pattern.track-title',
  'track-artist-title': 'albumSplit.pattern.track-artist-title',
  'artist-title': 'albumSplit.pattern.artist-title',
  title: 'albumSplit.pattern.title',
};

const outputStatusKeys: Record<AlbumSplitOutputStatus, TranslationKey> = {
  pending: 'albumSplit.output.pending',
  running: 'albumSplit.output.running',
  done: 'albumSplit.output.done',
  skipped: 'albumSplit.output.skipped',
  failed: 'albumSplit.output.failed',
};

const skipReasonKeys: Record<AlbumSplitSkipReason, TranslationKey> = {
  'not-cue': 'albumSplit.skipped.not-cue',
  'missing-source': 'albumSplit.skipped.missing-source',
  remote: 'albumSplit.skipped.remote',
};

const coverCapableFormats = new Set<AlbumSplitFormat>(['flac', 'mp3']);
const pollIntervalMs = 500;

const isJobActive = (job: AlbumSplitJobStatus | null): boolean =>
  Boolean(job && (job.status === 'queued' || job.status === 'backing-up' || job.status === 'running' || job.status === 'importing'));

const fileNameOf = (path: string): string => path.split(/[\\/]/u).pop() ?? path;

const formatBytes = (bytes: number | null): string | null => {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
};

const formatClock = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const AlbumSplitDrawer = ({ album, isOpen, onClose, onCompleted }: AlbumSplitDrawerProps): JSX.Element | null => {
  const { t } = useI18n();
  const [plan, setPlan] = useState<AlbumSplitPlan | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [format, setFormat] = useState<AlbumSplitFormat>('flac');
  const [pattern, setPattern] = useState<AlbumSplitFileNamePattern>('track-title');
  const [outputDir, setOutputDir] = useState('');
  const [embedCover, setEmbedCover] = useState(true);
  const [importAfter, setImportAfter] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [job, setJob] = useState<AlbumSplitJobStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const planRequestRef = useRef(0);
  const jobRef = useRef<AlbumSplitJobStatus | null>(null);
  const completedJobRef = useRef<string | null>(null);
  jobRef.current = job;

  const albumId = album?.id ?? null;
  const effectiveOutputDir = outputDir.trim() || plan?.suggestedOutputDir || '';
  const jobActive = isJobActive(job);
  const jobFinished = Boolean(job && !jobActive);
  const canEmbedCover = Boolean(plan?.hasCover) && coverCapableFormats.has(format);
  const canStart = Boolean(
    plan
    && plan.ffmpegAvailable
    && plan.tracks.length > 0
    && effectiveOutputDir
    && backupConfirmed,
  ) && !jobActive && !isStarting;

  const loadPlan = useCallback(async (albumId: string, nextFormat: AlbumSplitFormat, nextPattern: AlbumSplitFileNamePattern): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.planAlbumSplit) {
      setLocalError(t('albumSplit.error.bridge'));
      setPlan(null);
      return;
    }
    const requestId = planRequestRef.current + 1;
    planRequestRef.current = requestId;
    setIsPlanning(true);
    try {
      const nextPlan = await library.planAlbumSplit(albumId, { format: nextFormat, fileNamePattern: nextPattern });
      if (planRequestRef.current !== requestId) {
        return;
      }
      setPlan(nextPlan);
      setLocalError(null);
    } catch (error) {
      if (planRequestRef.current === requestId) {
        setPlan(null);
        setLocalError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (planRequestRef.current === requestId) {
        setIsPlanning(false);
      }
    }
  }, [t]);

  useEffect(() => {
    setJob(null);
    setOutputDir('');
    setBackupConfirmed(false);
    setLocalError(null);
    completedJobRef.current = null;
    jobRef.current = null;
  }, [album?.id]);

  useEffect(() => {
    if (!isOpen || !albumId || jobRef.current) {
      return;
    }
    void loadPlan(albumId, format, pattern);
  }, [albumId, format, isOpen, loadPlan, pattern]);

  const activeJobId = job && jobActive ? job.id : null;
  useEffect(() => {
    const library = window.echo?.library;
    if (!activeJobId || !library?.getAlbumSplitStatus) {
      return undefined;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      void library.getAlbumSplitStatus(activeJobId).then((next) => {
        if (!cancelled && next) {
          setJob(next);
        }
      }).catch(() => undefined);
    }, pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJobId]);

  useEffect(() => {
    if (job && !jobActive && job.completed > 0 && completedJobRef.current !== job.id) {
      completedJobRef.current = job.id;
      onCompleted?.(job);
    }
  }, [job, jobActive, onCompleted]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!album || !isOpen) {
    return null;
  }

  const handleChooseFolder = async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.chooseFolder) {
      setLocalError(t('albumSplit.error.chooseFolder'));
      return;
    }
    try {
      const chosen = await library.chooseFolder();
      if (chosen) {
        setOutputDir(chosen);
        setLocalError(null);
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t('albumSplit.error.chooseFolder'));
    }
  };

  const handleStart = async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.startAlbumSplit || !plan || !backupConfirmed) {
      setLocalError(backupConfirmed ? t('albumSplit.error.bridge') : t('albumSplit.footer.needBackup'));
      return;
    }
    setIsStarting(true);
    setLocalError(null);
    try {
      const started = await library.startAlbumSplit({
        albumId: album.id,
        outputDir: effectiveOutputDir,
        format,
        fileNamePattern: pattern,
        embedCover: embedCover && canEmbedCover,
        importAfter,
        overwrite,
        backupConfirmed: true,
      });
      setJob(started);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsStarting(false);
    }
  };

  const handleCancel = async (): Promise<void> => {
    const library = window.echo?.library;
    if (!job || !library?.cancelAlbumSplit) {
      return;
    }
    try {
      const next = await library.cancelAlbumSplit(job.id);
      if (next) {
        setJob(next);
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleOpenOutputFolder = async (): Promise<void> => {
    const library = window.echo?.library;
    const target = job?.outputDir || effectiveOutputDir;
    if (!library?.openPathInFolder || !target) {
      return;
    }
    try {
      await library.openPathInFolder(target);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleReset = (): void => {
    setJob(null);
    jobRef.current = null;
    setBackupConfirmed(false);
    setLocalError(null);
    completedJobRef.current = null;
    void loadPlan(album.id, format, pattern);
  };

  const skippedCount = job ? job.outputs.filter((output) => output.status === 'skipped').length : 0;
  const progressValue = job ? job.completed + job.failed + skippedCount : 0;
  const progressRatio = job && job.total > 0 ? Math.min(1, progressValue / job.total) : 0;
  const backupDirName = fileNameOf(plan?.suggestedBackupDir || job?.backupDir || '');
  const footerStatus = jobActive
    ? t('albumSplit.footer.busy')
    : jobFinished && job
      ? [
          t('albumSplit.status.done', { count: job.completed }),
          job.failed ? t('albumSplit.status.failed', { count: job.failed }) : null,
          skippedCount ? t('albumSplit.status.skipped', { count: skippedCount }) : null,
          job.importedCount !== null ? t('albumSplit.status.imported', { count: job.importedCount }) : null,
        ].filter(Boolean).join(' · ')
      : !backupConfirmed
        ? t('albumSplit.footer.needBackup')
        : plan && plan.tracks.length
          ? t('albumSplit.footer.ready', { tracks: plan.tracks.length, dir: fileNameOf(effectiveOutputDir) || effectiveOutputDir })
          : '';
  const coverUrl = localCoverDisplayUrl(album.coverId);

  return createPortal(
    <div className="album-split-root">
      <button className="album-split-scrim" type="button" aria-label={t('albumSplit.close')} onClick={onClose} />
      <form
        className="album-split-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="album-split-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (canStart) {
            void handleStart();
          }
        }}
      >
        <div className="album-split-scroll">
          <header className="album-split-header">
            <div>
              <p className="album-split-kicker">
                <Scissors size={15} />
                <span>{t('albumSplit.subtitle')}</span>
              </p>
              <h2 id="album-split-title">{t('albumSplit.title')}</h2>
            </div>
            <button className="album-split-close" type="button" aria-label={t('albumSplit.close')} onClick={onClose}>
              <X size={18} />
            </button>
          </header>

          <div className="album-split-identity">
            <strong title={album.title}>{album.title}</strong>
            <span title={album.albumArtist}>{album.albumArtist}</span>
            {coverUrl ? <img alt="" height={72} src={coverUrl} width={72} /> : null}
            {plan ? (
              <ul className="album-split-chips">
                <li>{t('albumSplit.hero.tracks', { count: plan.tracks.length })}</li>
                <li>{t('albumSplit.hero.sources', { count: plan.sourceFiles.length })}</li>
                <li className="album-split-badge" data-tone={plan.ffmpegAvailable ? 'ok' : 'error'}>
                  {plan.ffmpegAvailable ? t('albumSplit.hero.ffmpegReady') : t('albumSplit.hero.ffmpegMissing')}
                </li>
              </ul>
            ) : null}
          </div>

          {isPlanning && !plan ? <p className="album-split-loading"><Loader2 size={15} />{t('albumSplit.loading')}</p> : null}
          {plan && plan.tracks.length === 0 ? <p>{t('albumSplit.notSplittable')}</p> : null}

          {plan && plan.tracks.length > 0 && !job ? (
            <>
              <section className="album-split-backup" aria-label={t('albumSplit.backup.title')}>
                <div className="album-split-backup-head">
                  <TriangleAlert size={16} />
                  <strong>{t('albumSplit.backup.title')}</strong>
                </div>
                <p>{t('albumSplit.backup.body')}</p>
                <small>{t('albumSplit.backup.location', { dir: plan.suggestedBackupDir })}</small>
                <small>{t('albumSplit.backup.files', { count: plan.backupFiles.length })}{plan.backupFiles[0]?.sizeBytes ? ` · ${formatBytes(plan.backupFiles.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0))}` : ''}</small>
                <label className="album-split-toggle">
                  <input
                    type="checkbox"
                    checked={backupConfirmed}
                    onChange={(event) => setBackupConfirmed(event.target.checked)}
                  />
                  <span>{t('albumSplit.backup.confirm')}</span>
                </label>
              </section>

              <section className="album-split-section" aria-label={t('albumSplit.section.output')}>
                <header className="album-split-section-head">
                  <div>
                    <h3>{t('albumSplit.section.output')}</h3>
                    <p>{t('albumSplit.section.outputHint')}</p>
                  </div>
                </header>
                <div className="album-split-field">
                  <span id="album-split-format-label">{t('albumSplit.field.format')}</span>
                  <div className="album-split-segmented" role="radiogroup" aria-labelledby="album-split-format-label">
                    {albumSplitFormats.map((candidate) => (
                      <button key={candidate} type="button" role="radio" aria-checked={format === candidate} data-active={format === candidate} onClick={() => setFormat(candidate)}>
                        {t(formatLabelKeys[candidate])}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="album-split-field">
                  <span>{t('albumSplit.field.outputDir')}</span>
                  <div className="album-split-path">
                    <code title={effectiveOutputDir}>{effectiveOutputDir || '—'}</code>
                    <button type="button" className="album-split-ghost" onClick={() => void handleChooseFolder()}>
                      <FolderOpen size={14} />
                      {t('albumSplit.chooseFolder')}
                    </button>
                  </div>
                  {outputDir && plan.suggestedOutputDir ? (
                    <button type="button" className="album-split-ghost" onClick={() => setOutputDir('')}>{t('albumSplit.useSuggested')}</button>
                  ) : null}
                  <small>{t('albumSplit.field.outputDirHint')}</small>
                </div>
                <div className="album-split-field">
                  <label htmlFor="album-split-pattern">{t('albumSplit.field.pattern')}</label>
                  <div className="album-split-pattern">
                    <select id="album-split-pattern" value={pattern} onChange={(event) => setPattern(event.target.value as AlbumSplitFileNamePattern)}>
                      {albumSplitFileNamePatterns.map((candidate) => (
                        <option key={candidate} value={candidate}>{t(patternLabelKeys[candidate])}</option>
                      ))}
                    </select>
                    {plan.tracks[0] ? <code className="album-split-preview">{plan.tracks[0].fileName}</code> : null}
                  </div>
                </div>
                <div className="album-split-toggles">
                  <label className="album-split-toggle" data-disabled={!canEmbedCover}>
                    <input type="checkbox" checked={embedCover && canEmbedCover} disabled={!canEmbedCover} onChange={(event) => setEmbedCover(event.target.checked)} />
                    <span>
                      <b>{t('albumSplit.option.embedCover')}</b>
                      <small>{!plan.hasCover ? t('albumSplit.option.embedCoverMissing') : !coverCapableFormats.has(format) ? t('albumSplit.option.embedCoverHint') : ''}</small>
                    </span>
                  </label>
                  <label className="album-split-toggle">
                    <input type="checkbox" checked={importAfter} onChange={(event) => setImportAfter(event.target.checked)} />
                    <span>
                      <b>{t('albumSplit.option.importAfter')}</b>
                      <small>{t('albumSplit.option.importAfterHint')}</small>
                    </span>
                  </label>
                  <label className="album-split-toggle">
                    <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
                    <span>
                      <b>{t('albumSplit.option.overwrite')}</b>
                      <small>{t('albumSplit.option.overwriteHint')}</small>
                    </span>
                  </label>
                </div>
              </section>

              <section className="album-split-section" aria-label={t('albumSplit.section.tracks')}>
                <header className="album-split-section-head">
                  <div>
                    <h3>{t('albumSplit.section.tracks')}</h3>
                    <p>{t('albumSplit.section.tracksHint')}</p>
                  </div>
                </header>
                <ol className="album-split-tracks">
                  {plan.tracks.map((track) => (
                    <li className="album-split-track" key={track.trackId}>
                      <span>{track.trackNumber}</span>
                      <span className="album-split-track-copy">
                        <strong>{track.title}</strong>
                        <small>{track.fileName}</small>
                      </span>
                      <small>
                        {formatClock(track.startSeconds)} → {track.durationSeconds !== null ? formatClock(track.startSeconds + track.durationSeconds) : t('albumSplit.track.toEnd')}
                      </small>
                    </li>
                  ))}
                </ol>
                <div className="album-split-sources">
                  {plan.sourceFiles.map((source) => (
                    <span key={source.path} title={source.path}>{t('albumSplit.source')} · {fileNameOf(source.path)}{formatBytes(source.sizeBytes) ? ` · ${formatBytes(source.sizeBytes)}` : ''}</span>
                  ))}
                </div>
                {plan.skippedTracks.length ? (
                  <details>
                    <summary>{t('albumSplit.skipped.title')} · {plan.skippedTracks.length}</summary>
                    <ul>
                      {plan.skippedTracks.map((track) => (
                        <li key={track.trackId}>{track.title} · {t(skipReasonKeys[track.reason])}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>
            </>
          ) : null}

          {job ? (
            <section className="album-split-section" aria-label={t('albumSplit.progress.title')}>
              <header className="album-split-section-head">
                <div>
                  <h3>{jobActive ? t('albumSplit.progress.title') : footerStatus}</h3>
                  <p>
                    {job.status === 'backing-up'
                      ? t('albumSplit.backup.copying', { name: job.currentTitle ?? backupDirName })
                      : job.status === 'importing'
                        ? t('albumSplit.progress.importing')
                        : job.currentTitle
                          ? t('albumSplit.progress.current', { title: job.currentTitle })
                          : job.status === 'cancelled'
                            ? t('albumSplit.status.cancelled')
                            : job.outputDir}
                  </p>
                  {job.status === 'backing-up' ? <small>{t('albumSplit.backup.cancelHint')}</small> : null}
                </div>
                <span>{job.status === 'backing-up'
                  ? t('albumSplit.progress.count', { completed: job.backupCompleted, total: job.backupTotal })
                  : t('albumSplit.progress.count', { completed: progressValue, total: job.total })}</span>
              </header>
              <div className="album-split-bar" role="progressbar" aria-valuemin={0} aria-valuemax={job.total} aria-valuenow={progressValue}>
                <span style={{ width: `${Math.round((job.status === 'backing-up' && job.backupTotal > 0 ? job.backupCompleted / job.backupTotal : progressRatio) * 100)}%` }} />
              </div>
              <ol className="album-split-tracks">
                {job.outputs.map((output) => (
                  <li className="album-split-track" key={output.trackId} data-status={output.status}>
                    <span>{output.trackNumber}</span>
                    <span className="album-split-track-copy">
                      <strong>{output.title}</strong>
                      <small>{output.error ?? output.fileName}</small>
                    </span>
                    <span className="album-split-track-status">{output.status === 'done' ? <Check size={12} /> : null}{t(outputStatusKeys[output.status])}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {localError || job?.error ? (
            <p className="album-split-error" role="alert">
              <TriangleAlert size={15} />
              <span>{localError ?? job?.error}</span>
            </p>
          ) : null}
        </div>
        <footer className="album-split-actions">
          <span className="album-split-footer-status">{footerStatus}</span>
          {jobFinished ? (
            <>
              <button type="button" className="album-split-ghost" onClick={handleReset}>{t('albumSplit.action.again')}</button>
              <button type="button" className="album-split-ghost" onClick={() => void handleOpenOutputFolder()}>{t('albumSplit.action.openFolder')}</button>
              <button type="button" className="album-split-primary" onClick={onClose}>{t('albumSplit.action.close')}</button>
            </>
          ) : jobActive ? (
            <>
              <button type="button" className="album-split-ghost" onClick={onClose}>{t('albumSplit.action.close')}</button>
              <button type="button" className="album-split-ghost" onClick={() => void handleCancel()}>{t('albumSplit.action.cancel')}</button>
            </>
          ) : (
            <>
              <button type="button" className="album-split-ghost" onClick={onClose}>{t('albumSplit.action.close')}</button>
              <button type="submit" className="album-split-primary" disabled={!canStart}>
                {isStarting ? t('albumSplit.action.starting') : t('albumSplit.action.start')}
              </button>
            </>
          )}
        </footer>
      </form>
    </div>,
    document.body,
  );
};
