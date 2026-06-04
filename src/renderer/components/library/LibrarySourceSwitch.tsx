import { Cloud, HardDrive } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import type { LibrarySourceMode } from '../../utils/librarySourceMode';

type LibrarySourceSwitchProps = {
  value: LibrarySourceMode;
  onChange: (value: LibrarySourceMode) => void;
};

export const LibrarySourceSwitch = ({ value, onChange }: LibrarySourceSwitchProps): JSX.Element => {
  const { t } = useI18n();

  return (
    <div className="library-source-switch" role="group" aria-label={t('library.source.aria')}>
      <button type="button" aria-pressed={value === 'local'} onClick={() => onChange('local')}>
        <HardDrive size={15} aria-hidden="true" />
        <span>{t('library.source.local')}</span>
      </button>
      <button type="button" aria-pressed={value === 'remote'} onClick={() => onChange('remote')}>
        <Cloud size={15} aria-hidden="true" />
        <span>{t('library.source.remote')}</span>
      </button>
    </div>
  );
};
