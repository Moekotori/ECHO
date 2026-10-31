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

      <div className="import-folder-onboarding" aria-label={t('importFolder.onboarding.title')}>
        <span className="panel-kicker">{t('importFolder.onboarding.kicker')}</span>
        <h3>{t('importFolder.onboarding.title')}</h3>
        <ol>
          <li>
            <strong>{t('importFolder.onboarding.choose.title')}</strong>
            <span>{t('importFolder.onboarding.choose.body')}</span>
          </li>
          <li>
            <strong>{t('importFolder.onboarding.scan.title')}</strong>
            <span>{t('importFolder.onboarding.scan.body')}</span>
          </li>
          <li>
            <strong>{t('importFolder.onboarding.finish.title')}</strong>
            <span>{t('importFolder.onboarding.finish.body')}</span>
          </li>
        </ol>
      </div>

      <LibraryFoldersPanel autoFocus showOsuFolderImport />
    </div>
  );
};
