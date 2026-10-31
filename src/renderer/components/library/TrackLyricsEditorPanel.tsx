import { useEffect, useRef, useState } from 'react';
import { FileText, Import, Pencil, Save } from 'lucide-react';
import type { TrackLyrics } from '../../../shared/types/lyrics';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import { customLyricsFileAccept, isCustomLyricsFile } from '../lyrics/customLyricsFile';
import { readCustomLyricsFile } from '../lyrics/readCustomLyricsFile';
import { formatLyricsTime, maxTrackLyricsEditorChars, trackLyricsToEditorText } from './trackLyricsEditorText';
import './track-lyrics-editor.css';

type Props = {
  trackId: string; lyrics: TrackLyrics | null; active: boolean; isOpen: boolean; disabled: boolean;
  onChanged: (lyrics: TrackLyrics) => void; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void;
};

/** Edits the lyrics cache through the existing API. Embedding remains an explicit drawer action. */
export const TrackLyricsEditorPanel = ({ trackId, lyrics, active, isOpen, disabled, onChanged, onDirtyChange, onBusyChange }: Props): JSX.Element | null => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [baseline, setBaseline] = useState('');
  const [fileName, setFileName] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const dirty = editing && draft !== baseline;

  useEffect(() => {
    requestRef.current += 1;
    setEditing(false); setDraft(''); setBaseline(''); setFileName(undefined); setBusy(false); setMessage(null); setError(null);
    return () => { requestRef.current += 1; };
  }, [trackId, isOpen]);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);

  const beginEditing = (): void => {
    const text = trackLyricsToEditorText(lyrics);
    setBaseline(text); setDraft(text); setFileName(undefined); setEditing(true); setError(null); setMessage(null);
  };

  const importFile = async (file: File | undefined): Promise<void> => {
    if (!file || busy || disabled) return;
    if (dirty && !window.confirm(t('communityLibrary.lyrics.discard'))) return;
    if (!isCustomLyricsFile(file.name)) { setError(t('communityLibrary.lyrics.invalid')); return; }
    const request = ++requestRef.current;
    setBusy(true); setError(null); setMessage(null);
    try {
      const text = await readCustomLyricsFile(file);
      if (request !== requestRef.current) return;
      if (!text.trim()) throw new Error(t('communityLibrary.lyrics.empty'));
      if (text.length > maxTrackLyricsEditorChars) throw new Error(t('communityLibrary.lyrics.tooLarge'));
      setBaseline(trackLyricsToEditorText(lyrics)); setDraft(text); setFileName(file.name); setEditing(true);
    } catch (reason) {
      if (request === requestRef.current) setError(reason instanceof Error ? reason.message : t('communityLibrary.lyrics.failed'));
    } finally { if (request === requestRef.current) setBusy(false); }
  };

  const save = async (): Promise<void> => {
    const api = window.echo?.lyrics?.applyCustomLrc;
    if (!api || busy || disabled || !dirty || !draft.trim()) return;
    const request = ++requestRef.current;
    setBusy(true); setError(null);
    try {
      const saved = await api(trackId, draft, fileName);
      if (request !== requestRef.current) return;
      onChanged(saved); setEditing(false); setMessage(t('communityLibrary.lyrics.saved'));
    } catch (reason) {
      if (request === requestRef.current) setError(reason instanceof Error ? reason.message : t('communityLibrary.lyrics.failed'));
    } finally { if (request === requestRef.current) setBusy(false); }
  };

  if (!active) return null;
  const canEdit = Boolean(window.echo?.lyrics?.applyCustomLrc);
  const preview = lyrics?.lines.map((line) => [
    `${lyrics.kind === 'synced' ? `${formatLyricsTime(line.timeMs)} ` : ''}${line.text}`,
    ...(line.translation ? [`  ${line.translation}`] : []),
    ...(line.romanization ? [`  ${line.romanization}`] : []),
  ].join('\n')).join('\n') || lyrics?.plainText || '';

  return <section className="track-lyrics-editor" aria-label={t('communityLibrary.lyrics.preview')} aria-busy={busy}>
    <header><strong><FileText size={15} />{t('communityLibrary.lyrics.preview')}</strong>
      <div>
        {!editing ? <button type="button" disabled={disabled || busy || !canEdit} onClick={beginEditing}><Pencil size={15} />{t('communityLibrary.lyrics.edit')}</button> : null}
        <input type="file" ref={inputRef} accept={customLyricsFileAccept} aria-label={t('communityLibrary.lyrics.import')} hidden
          onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void importFile(file); }} />
        <button type="button" disabled={disabled || busy || !canEdit} onClick={() => inputRef.current?.click()}><Import size={15} />{t('communityLibrary.lyrics.import')}</button>
      </div>
    </header>
    {editing ? <>
      <textarea aria-label={t('communityLibrary.lyrics.text')} value={draft} maxLength={maxTrackLyricsEditorChars} spellCheck={false}
        disabled={busy || disabled} onChange={(event) => setDraft(event.target.value)} />
      <div className="track-lyrics-editor-actions">
        <button type="button" disabled={!dirty || !draft.trim() || disabled || busy} onClick={() => void save()}><Save size={15} />{t(busy ? 'communityLibrary.lyrics.saving' : 'communityLibrary.lyrics.save')}</button>
        <button type="button" disabled={busy} onClick={() => { if (!dirty || window.confirm(t('communityLibrary.lyrics.discard'))) { setEditing(false); setError(null); } }}>{t('communityLibrary.lyrics.cancel')}</button>
      </div>
    </> : <pre className="track-lyrics-preview" tabIndex={0}>{preview || t('communityLibrary.lyrics.empty')}</pre>}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
};
