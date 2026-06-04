import { FolderPlus } from 'lucide-react';
import { LibraryFoldersPanel } from '../components/library/LibraryFoldersPanel';
import { useI18n } from '../i18n/I18nProvider';

export const ImportFolderPage = (): JSX.Element => {
  const { t } = useI18n();

  return (
    <div className="page-stack">
      <div className="empty-state import-folder-hero">
        <div className="empty-icon">
          <FolderPlus size={26} />
        </div>
        <div>
          <h2>{t('route.importFolder.label')}</h2>
          <p>{t('route.importFolder.description')}</p>
          <span>{t('importFolder.hero.note')}</span>
        </div>
      </div>

      <LibraryFoldersPanel autoFocus />
    </div>
  );
};
