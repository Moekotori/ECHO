import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, CloudDownload, Disc3, FolderOpen, ImagePlus, RefreshCw, Save, Tag, Trash2, X } from 'lucide-react';
import type { EditableAlbumTags, LibraryAlbum, NetworkTagCandidate, TrackCoverSelection } from '../../../shared/types/library';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';

type AlbumTagEditorDrawerProps = {
  album: LibraryAlbum | null;
  isOpen: boolean;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (album: LibraryAlbum, tags: EditableAlbumTags, coverPath: string | null, coverUrl: string | null, coverMimeType: string | null) => void;
  onOpenInFolder: (album: LibraryAlbum) => Promise<void>;
  onDeleteAlbum: (album: LibraryAlbum) => Promise<void>;
};

type AlbumTagFormState = {
  album: string;
  albumArtist: string;
  year: string;
  genre: string;
};

type PendingNetworkCover = {
  url: string;
  mimeType: string | null;
  previewUrl: string;
};

type NetworkFieldSelection = Record<keyof AlbumTagFormState | 'cover', boolean>;

type Translate = (key: TranslationKey, options?: Record<string, string | number>) => string;

const networkFieldLabels: Array<{ key: keyof AlbumTagFormState | 'cover'; labelKey: TranslationKey }> = [
  { key: 'album', labelKey: 'albumTagEditor.field.album' },
  { key: 'albumArtist', labelKey: 'albumTagEditor.field.albumArtist' },
  { key: 'year', labelKey: 'albumTagEditor.field.year' },
  { key: 'genre', labelKey: 'albumTagEditor.field.genre' },
  { key: 'cover', labelKey: 'albumTagEditor.field.cover' },
];

const emptyNetworkSelection = (): NetworkFieldSelection => ({
  album: false,
  albumArtist: false,
  year: false,
  genre: false,
  cover: false,
});

const stateFromAlbum = (album: LibraryAlbum | null): AlbumTagFormState => ({
  album: album?.title ?? '',
  albumArtist: album?.albumArtist ?? '',
  year: album?.year ? String(album.year) : '',
  genre: '',
});

const numberOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
};

const hasFormValue = (value: string): boolean => value.trim().length > 0;
const hasCandidateText = (value: string | null | undefined): boolean => (value ?? '').trim().length > 0;
const candidateNumberText = (value: number | null | undefined): string => (typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
const fieldValue = (value: string | number | null | undefined, t: Translate): string => {
  if (value === null || value === undefined || value === '') {
    return t('albumTagEditor.value.empty');
  }
  return String(value);
};

const canApplyNetworkField = (candidate: NetworkTagCandidate, key: keyof NetworkFieldSelection): boolean =>
  key === 'cover' ? Boolean(candidate.coverUrl) : hasCandidateText(candidateFieldValue(candidate, key));

const allNetworkFieldsSelected = (selection: NetworkFieldSelection, candidate: NetworkTagCandidate | null): boolean => {
  if (!candidate) {
    return false;
  }

  const applicableFields = networkFieldLabels.filter((field) => canApplyNetworkField(candidate, field.key));
  return applicableFields.length > 0 && applicableFields.every((field) => selection[field.key]);
};
const someNetworkFieldsSelected = (selection: NetworkFieldSelection, candidate: NetworkTagCandidate | null): boolean =>
  Boolean(candidate && networkFieldLabels.some((field) => canApplyNetworkField(candidate, field.key) && selection[field.key]));

const validatePositiveInteger = (value: string, label: string, t: Translate): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d+$/u.test(trimmed) || Number(trimmed) <= 0) {
    return t('albumTagEditor.error.positiveInteger', { label });
  }
  return null;
};

const formatDuration = (duration: number, t: Translate): string => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return t('albumTagEditor.duration.unknown');
  }

  const totalMinutes = Math.round(duration / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0
    ? t('albumTagEditor.duration.hoursMinutes', { hours, minutes })
    : t('albumTagEditor.duration.minutes', { minutes: totalMinutes });
};

const candidateFieldValue = (candidate: NetworkTagCandidate, key: keyof AlbumTagFormState): string => {
  switch (key) {
    case 'album':
      return candidate.album;
    case 'albumArtist':
      return candidate.albumArtist;
    case 'year':
      return candidateNumberText(candidate.year);
    case 'genre':
      return candidate.genre ?? '';
  }
};

const defaultNetworkFieldSelection = (candidate: NetworkTagCandidate): NetworkFieldSelection => {
  return {
    album: canApplyNetworkField(candidate, 'album'),
    albumArtist: canApplyNetworkField(candidate, 'albumArtist'),
    year: canApplyNetworkField(candidate, 'year'),
    genre: canApplyNetworkField(candidate, 'genre'),
    cover: canApplyNetworkField(candidate, 'cover'),
  };
};

const applyNetworkCandidateToForm = (
  form: AlbumTagFormState,
  candidate: NetworkTagCandidate,
  fields: NetworkFieldSelection,
): AlbumTagFormState => ({
  ...form,
  album: fields.album && hasCandidateText(candidate.album) ? candidate.album : form.album,
  albumArtist: fields.albumArtist && hasCandidateText(candidate.albumArtist) ? candidate.albumArtist : form.albumArtist,
  year: fields.year ? candidateNumberText(candidate.year) : form.year,
  genre: fields.genre && candidate.genre ? candidate.genre : form.genre,
});

export const AlbumTagEditorDrawer = ({ album, isOpen, isSaving, error, onClose, onSave, onOpenInFolder, onDeleteAlbum }: AlbumTagEditorDrawerProps): JSX.Element | null => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [form, setForm] = useState<AlbumTagFormState>(() => stateFromAlbum(album));
  const [selectedCover, setSelectedCover] = useState<TrackCoverSelection | null>(null);
  const [pendingNetworkCover, setPendingNetworkCover] = useState<PendingNetworkCover | null>(null);
  const [loadedCoverThumb, setLoadedCoverThumb] = useState<string | null>(null);
  const [representativeTrackId, setRepresentativeTrackId] = useState<string | null>(null);
  const [isLoadingEmbedded, setIsLoadingEmbedded] = useState(false);
  const [isSearchingNetwork, setIsSearchingNetwork] = useState(false);
  const [networkCandidates, setNetworkCandidates] = useState<NetworkTagCandidate[]>([]);
  const [selectedNetworkCandidate, setSelectedNetworkCandidate] = useState<NetworkTagCandidate | null>(null);
  const [networkFieldSelection, setNetworkFieldSelection] = useState<NetworkFieldSelection>(() => emptyNetworkSelection());
  const [networkMessage, setNetworkMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const initialForm = useMemo(() => stateFromAlbum(album), [album]);
  const previewCover = selectedCover?.dataUrl ?? pendingNetworkCover?.previewUrl ?? loadedCoverThumb ?? album?.coverThumb ?? null;
  const yearError = useMemo(() => validatePositiveInteger(form.year, t('albumTagEditor.field.year'), t), [form.year, t]);
  const isBusy = isSaving || isLoadingEmbedded || isSearchingNetwork;
  const isDirty = useMemo(
    () =>
      Boolean(
        album &&
          (JSON.stringify(form) !== JSON.stringify(initialForm) ||
            selectedCover ||
            pendingNetworkCover ||
            loadedCoverThumb !== null),
      ),
    [album, form, initialForm, loadedCoverThumb, pendingNetworkCover, selectedCover],
  );

  useEffect(() => {
    if (album) {
      setForm(stateFromAlbum(album));
      setSelectedCover(null);
      setPendingNetworkCover(null);
      setLoadedCoverThumb(null);
      setRepresentativeTrackId(null);
      setNetworkCandidates([]);
      setSelectedNetworkCandidate(null);
      setNetworkFieldSelection(emptyNetworkSelection());
      setNetworkMessage(null);
      setLocalError(null);
      setShowDiscardConfirm(false);
    }
  }, [album]);

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

  if (!album) {
    return null;
  }

  const getRepresentativeTrackId = async (): Promise<string> => {
    if (representativeTrackId) {
      return representativeTrackId;
    }

    const library = window.echo?.library;
    if (!library?.getAlbumTracks) {
      throw new Error(t('albumTagEditor.error.readTracksUnsupported'));
    }

    const result = await library.getAlbumTracks(album.id, { page: 1, pageSize: 1 });
    const trackId = result.items[0]?.id;
    if (!trackId) {
      throw new Error(t('albumTagEditor.error.noReadableTrack'));
    }

    setRepresentativeTrackId(trackId);
    return trackId;
  };

  const updateField = (field: keyof AlbumTagFormState, value: string): void => {
    setForm((current) => ({ ...current, [field]: value }));
    setShowDiscardConfirm(false);
  };

  const handleChooseCover = async (): Promise<void> => {
    const library = window.echo?.library;

    if (!library?.chooseTrackCover) {
      setLocalError(t('albumTagEditor.error.chooseCoverUnsupported'));
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
      setLocalError(t('albumTagEditor.error.embeddedUnsupported'));
      return;
    }

    setIsLoadingEmbedded(true);
    setLocalError(null);

    try {
      const trackId = await getRepresentativeTrackId();
      const result = await library.loadEmbeddedTrackTags(trackId);
      setForm({
        album: result.tags.album,
        albumArtist: result.tags.albumArtist,
        year: result.tags.year ? String(result.tags.year) : '',
        genre: result.tags.genre ?? '',
      });
      setSelectedCover(null);
      setPendingNetworkCover(null);
      setLoadedCoverThumb(result.coverThumb);
      setShowDiscardConfirm(false);
    } catch (loadError) {
      setLocalError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoadingEmbedded(false);
    }
  };

  const handleOpenInFolder = async (): Promise<void> => {
    try {
      setLocalError(null);
      await onOpenInFolder(album);
    } catch (openError) {
      setLocalError(openError instanceof Error ? openError.message : String(openError));
    }
  };

  const handleDeleteAlbum = async (): Promise<void> => {
    try {
      setLocalError(null);
      await onDeleteAlbum(album);
    } catch (deleteError) {
      setLocalError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const handleSearchNetwork = async (): Promise<void> => {
    const library = window.echo?.library;

    if (!library?.searchNetworkTagCandidates) {
      setLocalError(t('albumTagEditor.error.networkUnsupported'));
      return;
    }

    setIsSearchingNetwork(true);
    setLocalError(null);
    setNetworkMessage(t('albumTagEditor.message.searchingNetwork'));
    setSelectedNetworkCandidate(null);
    setNetworkFieldSelection(emptyNetworkSelection());

    try {
      const trackId = await getRepresentativeTrackId();
      const candidates = await library.searchNetworkTagCandidates(trackId);
      setNetworkCandidates(candidates);
      if (candidates[0]) {
        applyNetworkCandidate(candidates[0], defaultNetworkFieldSelection(candidates[0]));
      } else {
        setNetworkMessage(t('albumTagEditor.message.noNetworkTags'));
      }
    } catch (searchError) {
      setNetworkCandidates([]);
      setNetworkMessage(null);
      setLocalError(searchError instanceof Error ? searchError.message : t('albumTagEditor.error.networkTemporary'));
    } finally {
      setIsSearchingNetwork(false);
    }
  };

  const applyNetworkCandidate = (candidate: NetworkTagCandidate, selection: NetworkFieldSelection): void => {
    setSelectedNetworkCandidate(candidate);
    setNetworkFieldSelection(selection);
    setForm((current) => applyNetworkCandidateToForm(current, candidate, selection));

    if (selection.cover && candidate.coverUrl) {
      setPendingNetworkCover({
        url: candidate.coverUrl,
        mimeType: candidate.coverMimeType ?? null,
        previewUrl: candidate.coverPreviewUrl ?? candidate.coverUrl,
      });
      setSelectedCover(null);
      setLoadedCoverThumb(null);
    }

    setNetworkMessage(t('albumTagEditor.message.appliedNetwork'));
    setShowDiscardConfirm(false);
  };

  const handleSelectNetworkCandidate = (candidate: NetworkTagCandidate): void => {
    applyNetworkCandidate(candidate, defaultNetworkFieldSelection(candidate));
  };

  const handleToggleNetworkField = (field: keyof NetworkFieldSelection): void => {
    setNetworkFieldSelection((current) => ({ ...current, [field]: !current[field] }));
  };

  const handleToggleAllNetworkFields = (): void => {
    setNetworkFieldSelection((current) => {
      const nextChecked = !allNetworkFieldsSelected(current, selectedNetworkCandidate);
      return networkFieldLabels.reduce(
        (next, field) => ({
          ...next,
          [field.key]: selectedNetworkCandidate && canApplyNetworkField(selectedNetworkCandidate, field.key) ? nextChecked : false,
        }),
        emptyNetworkSelection(),
      );
    });
  };

  const handleApplyNetworkCandidate = (): void => {
    if (!selectedNetworkCandidate) {
      return;
    }

    applyNetworkCandidate(selectedNetworkCandidate, networkFieldSelection);
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setLocalError(null);
    if (yearError) {
      setLocalError(t('albumTagEditor.error.fixYearBeforeSave'));
      return;
    }

    onSave(
      album,
      {
        album: form.album,
        albumArtist: form.albumArtist,
        year: numberOrNull(form.year),
        genre: form.genre.trim() || null,
      },
      selectedCover?.path ?? null,
      selectedCover ? null : (pendingNetworkCover?.url ?? null),
      selectedCover ? null : (pendingNetworkCover?.mimeType ?? null),
    );
  };

  const editor = (
    <div className="tag-editor-root" data-open={isOpen}>
      <button className="tag-editor-scrim" type="button" aria-label={t('albumTagEditor.action.close')} onClick={requestClose} />
      <form className="tag-editor-drawer album-tag-editor-drawer" onSubmit={handleSubmit}>
        <div className="tag-editor-scroll">
          <header className="tag-editor-header">
          <div>
            <Tag size={23} />
            <div>
              <h2>{t('albumTagEditor.title')}</h2>
              <p>{isDirty ? t('albumTagEditor.subtitle.unsaved') : t('albumTagEditor.subtitle.albumBatch')}</p>
            </div>
          </div>
          <button className="tag-editor-close" type="button" aria-label={t('albumTagEditor.action.close')} onClick={requestClose}>
            <X size={22} />
          </button>
        </header>

        <section className="tag-editor-cover-card" aria-label={t('albumTagEditor.currentAlbumAria')}>
          <div className="tag-editor-cover" data-empty={!previewCover}>
            {previewCover ? <img alt="" src={previewCover} /> : <Disc3 size={42} />}
          </div>
          <div className="tag-editor-file">
            <span className="tag-editor-kicker">{t('albumTagEditor.currentAlbum')}</span>
            <strong>{album.title}</strong>
            <span>{album.albumArtist}</span>
            <small>
              {t('albumTagEditor.albumSummary', { count: album.trackCount, duration: formatDuration(album.duration, t) })}
              {selectedCover
                ? t('albumTagEditor.cover.localSuffix', { path: selectedCover.path })
                : pendingNetworkCover
                  ? t('albumTagEditor.cover.networkSuffix')
                  : loadedCoverThumb
                    ? t('albumTagEditor.cover.embeddedSuffix')
                    : ''}
            </small>
            <div className="tag-editor-tool-row">
              <button type="button" onClick={() => void handleChooseCover()} disabled={isBusy}>
                <ImagePlus size={17} />
                {t('albumTagEditor.action.chooseCover')}
              </button>
              <button type="button" onClick={() => void handleLoadEmbedded()} disabled={isBusy}>
                <RefreshCw size={17} />
                {isLoadingEmbedded ? t('albumTagEditor.action.loading') : t('albumTagEditor.action.loadEmbedded')}
              </button>
              <button type="button" onClick={() => void handleSearchNetwork()} disabled={isBusy}>
                <CloudDownload size={17} />
                {isSearchingNetwork ? t('albumTagEditor.action.searching') : t('albumTagEditor.action.loadNetwork')}
              </button>
              <button type="button" onClick={() => void handleOpenInFolder()} disabled={isBusy}>
                <FolderOpen size={17} />
                {t('albumTagEditor.action.openInExplorer')}
              </button>
              <button type="button" data-danger="true" onClick={() => void handleDeleteAlbum()} disabled={isBusy}>
                <Trash2 size={17} />
                {t('albumTagEditor.action.deleteAlbum')}
              </button>
            </div>
          </div>
        </section>

        <section className="tag-editor-section">
          <div className="tag-editor-section-heading">
            <h3>{t('albumTagEditor.section.albumInfo')}</h3>
            <span>{t('albumTagEditor.section.albumInfoDescription')}</span>
          </div>
          <div className="tag-editor-grid">
            <label className="tag-editor-field">
              <span>{t('albumTagEditor.field.album')}</span>
              <input disabled={isBusy} value={form.album} aria-label={t('albumTagEditor.field.album')} onChange={(event) => updateField('album', event.target.value)} />
            </label>
            <label className="tag-editor-field">
              <span>{t('albumTagEditor.field.albumArtist')}</span>
              <input
                disabled={isBusy}
                value={form.albumArtist}
                aria-label={t('albumTagEditor.field.albumArtist')}
                onChange={(event) => updateField('albumArtist', event.target.value)}
              />
            </label>
            <label className="tag-editor-field" data-invalid={Boolean(yearError)}>
              <span>{t('albumTagEditor.field.year')}</span>
              <input
                disabled={isBusy}
                inputMode="numeric"
                value={form.year}
                aria-invalid={Boolean(yearError)}
                aria-label={t('albumTagEditor.field.year')}
                onChange={(event) => updateField('year', event.target.value)}
              />
              {yearError ? <em>{yearError}</em> : null}
            </label>
            <label className="tag-editor-field">
              <span>{t('albumTagEditor.field.genre')}</span>
              <input disabled={isBusy} value={form.genre} aria-label={t('albumTagEditor.field.genre')} onChange={(event) => updateField('genre', event.target.value)} />
            </label>
          </div>
        </section>

        <section className="tag-editor-section tag-editor-network-panel" aria-label={t('albumTagEditor.network.aria')}>
          <div className="tag-editor-section-heading">
            <h3>{t('albumTagEditor.network.title')}</h3>
            <button type="button" onClick={() => void handleSearchNetwork()} disabled={isBusy}>
              <CloudDownload size={16} />
              {isSearchingNetwork ? t('albumTagEditor.action.searching') : t('albumTagEditor.action.searchCandidates')}
            </button>
          </div>

          {networkMessage ? <p className="tag-editor-network-message">{networkMessage}</p> : null}

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
                      <strong>{candidate.album || candidate.title || t('albumTagEditor.value.unknownAlbum')}</strong>
                      <em>{candidate.albumArtist || candidate.artist || t('albumTagEditor.value.unknownArtist')}</em>
                      <small>{[candidate.year, candidate.genre].filter(Boolean).join(' / ') || t('albumTagEditor.value.albumCandidate')}</small>
                    </span>
                    <span className="tag-editor-network-score">
                      <b>{candidate.provider}</b>
                      <em>{Math.round(candidate.confidence * 100)}%</em>
                    </span>
                  </button>
                ))}
              </div>

              {selectedNetworkCandidate ? (
                <div className="tag-editor-network-fields">
                  <div className="tag-editor-network-fields-header">
                    <span>{t('albumTagEditor.network.selectFields')}</span>
                    <label>
                      <input
                        ref={(node) => {
                          if (node) {
                            node.indeterminate = someNetworkFieldsSelected(networkFieldSelection, selectedNetworkCandidate) && !allNetworkFieldsSelected(networkFieldSelection, selectedNetworkCandidate);
                          }
                        }}
                        type="checkbox"
                        checked={allNetworkFieldsSelected(networkFieldSelection, selectedNetworkCandidate)}
                        onChange={handleToggleAllNetworkFields}
                      />
                      <span>{t('albumTagEditor.network.selectAll')}</span>
                    </label>
                  </div>

                  <div className="tag-editor-compare-table">
                    <div className="tag-editor-compare-head">
                      <span>{t('albumTagEditor.network.column.field')}</span>
                      <span>{t('albumTagEditor.network.column.current')}</span>
                      <span>{t('albumTagEditor.network.column.candidate')}</span>
                    </div>
                    {networkFieldLabels.map((field) => {
                      const candidateValue = field.key === 'cover' ? (selectedNetworkCandidate.coverUrl ? t('albumTagEditor.value.networkCover') : '') : candidateFieldValue(selectedNetworkCandidate, field.key);
                      const currentValue = field.key === 'cover' ? (previewCover ? t('albumTagEditor.value.existingCover') : '') : form[field.key];
                      const canApply = canApplyNetworkField(selectedNetworkCandidate, field.key);
                      return (
                        <label key={field.key} className="tag-editor-compare-row" data-disabled={!canApply}>
                          <span>
                            <input
                              type="checkbox"
                              disabled={!canApply}
                              checked={networkFieldSelection[field.key] && canApply}
                              onChange={() => handleToggleNetworkField(field.key)}
                            />
                            {t(field.labelKey)}
                          </span>
                          <em>{fieldValue(currentValue, t)}</em>
                          <strong>{fieldValue(candidateValue, t)}</strong>
                        </label>
                      );
                    })}
                  </div>

                  <button type="button" onClick={handleApplyNetworkCandidate} disabled={isSaving || !someNetworkFieldsSelected(networkFieldSelection, selectedNetworkCandidate)}>
                    <Check size={17} />
                    {t('albumTagEditor.action.applyToForm')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {error || localError ? <p className="tag-editor-error">{error ?? localError}</p> : null}

        {showDiscardConfirm ? (
          <div className="tag-editor-discard" role="alert">
            <span>{t('albumTagEditor.discard.prompt')}</span>
            <button type="button" onClick={() => setShowDiscardConfirm(false)}>
              {t('albumTagEditor.discard.continue')}
            </button>
            <button type="button" onClick={onClose}>
              {t('albumTagEditor.discard.discard')}
            </button>
          </div>
        ) : null}

          <footer className="tag-editor-actions">
          <span>{t('albumTagEditor.saveDescription')}</span>
          <button className="tag-editor-cancel" type="button" onClick={requestClose} disabled={isSaving}>
            {t('albumTagEditor.action.cancel')}
          </button>
          <button className="tag-editor-save" type="submit" disabled={isSaving || Boolean(yearError)}>
            <Save size={18} />
            {isSaving ? t('albumTagEditor.action.saving') : t('albumTagEditor.action.saveTags')}
          </button>
          </footer>
        </div>
      </form>
    </div>
  );

  return createPortal(editor, document.body);
};
