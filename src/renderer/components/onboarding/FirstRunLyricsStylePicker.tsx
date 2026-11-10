import { useId } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { LyricsPageStyle } from '../../../shared/types/appSettings';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import { LyricsStyleThumbnail } from '../lyrics/LyricsStyleThumbnail';
import { LyricsStylePreviewImage } from '../lyrics/LyricsStylePreviewImage';
import './first-run-lyrics-style.css';

const choices = [
  { mode: 'afterglowCover', labelKey: 'lyricsSettings.visual.pageStyleAfterglowCover' },
  { mode: 'default', labelKey: 'lyricsSettings.visual.pageStyleDefault' },
] as const;

/** Only static captures are mounted; choosing a card updates the wizard's draft. */
export function FirstRunLyricsStylePicker({ value, disabled, onChange }: {
  value: LyricsPageStyle;
  disabled: boolean;
  onChange: (style: LyricsPageStyle) => void;
}): JSX.Element {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const titleId = useId();
  const selected = choices.find(choice => choice.mode === value);
  return <section className="first-run-appearance-section first-run-lyrics-style" aria-labelledby={titleId}>
    <header><div>
      <span id={titleId}>{t('lyricsSettings.visual.pageStyle')}</span>
      {selected ? <strong>{t(selected.labelKey)}</strong> : null}
    </div></header>
    <div className="first-run-lyrics-style__layout" data-has-preview={Boolean(selected)}>
      <div className="first-run-lyrics-style__choices" role="group" aria-labelledby={titleId}>
        {choices.map(choice => <button key={choice.mode} type="button" disabled={disabled}
          aria-pressed={value === choice.mode} onClick={() => onChange(choice.mode)}>
          <LyricsStyleThumbnail mode={choice.mode} />
          <span>{t(choice.labelKey)}</span>
          {value === choice.mode ? <CheckCircle2 size={16} aria-hidden="true" /> : null}
        </button>)}
      </div>
      {selected ? <div className="first-run-lyrics-style__preview" role="img" aria-label={t(selected.labelKey)}>
        <LyricsStylePreviewImage mode={selected.mode} />
      </div> : null}
    </div>
  </section>;
}
