import { Cloud } from 'lucide-react';
import type { RemoteSource } from '../../../shared/types/remoteSources';
import { useI18n } from '../../i18n/I18nProvider';

type RemoteSourceFilterProps = {
  sources: RemoteSource[];
  value: string | null;
  onChange: (sourceId: string | null) => void;
};

export const RemoteSourceFilter = ({ sources, value, onChange }: RemoteSourceFilterProps): JSX.Element | null => {
  const { t } = useI18n();

  if (sources.length === 0) {
    return null;
  }

  return (
    <label className="remote-source-filter">
      <Cloud size={15} aria-hidden="true" />
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">{t('library.source.allRemote')}</option>
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.displayName}
          </option>
        ))}
      </select>
    </label>
  );
};
