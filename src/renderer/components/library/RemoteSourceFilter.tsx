import { Cloud } from 'lucide-react';
import type { RemoteSource } from '../../../shared/types/remoteSources';
import { useI18n } from '../../i18n/I18nProvider';
import { StyledSelect } from '../ui/StyledSelect';

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

  const options = [
    { value: '', label: t('library.source.allRemote') },
    ...sources.map((source) => ({ value: source.id, label: source.displayName })),
  ];

  return (
    <StyledSelect
      className="remote-source-filter"
      value={value ?? ''}
      options={options}
      onChange={(sourceId) => onChange(sourceId || null)}
      ariaLabel={t('library.source.allRemote')}
      showFilterIcon={false}
      leadingIcon={<Cloud className="sort-button-icon" size={15} aria-hidden="true" />}
    />
  );
};
