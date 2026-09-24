import type { AutoUpdateSource } from '../../../../shared/types/appSettings';
import type { DataBackupProgress } from '../../../../shared/types/settingsBackup';
import type { TranslationKey } from '../../../i18n/locales';

export const officialWebsiteUrl = 'https://echonext.moe';
export const userDocumentationUrl = 'https://echonext.moe/zh/docs/';
export const baiduPanShareUrl = 'https://pan.baidu.com/s/1ta0McyhY9knaD6FT5xW3Og?pwd=echo';
export const bilibiliSpaceUrl = 'https://space.bilibili.com/25265128';
export const afdianSponsorUrl = 'https://afdian.com/a/echonext';
export const bugFeedbackUrl = 'https://github.com/Moekotori/ECHO/issues';
export const authorEmailUrl = 'mailto:nyafairy233@gmail.com';

export const autoUpdateSourceOptions: Array<{
  source: AutoUpdateSource;
  label: string;
  description: string;
}> = [
  { source: 'official', label: 'GitHub', description: '官方直连' },
  { source: 'ghfast', label: 'ghfast.top', description: '实测可读 latest.yml' },
  { source: 'ghproxyVip', label: 'ghproxy.vip', description: '实测可读 API 和文件' },
  { source: 'ghproxyCxkpro', label: 'cxkpro', description: '实测可读 latest.yml' },
  { source: 'custom', label: 'Custom', description: '自定义 generic 源' },
];

export const dataBackupProgressPhaseLabels: Record<DataBackupProgress['phase'], TranslationKey> = {
  preparing: 'settings.general.dataBackup.progress.preparing',
  snapshot: 'settings.general.dataBackup.progress.snapshot',
  scanning: 'settings.general.dataBackup.progress.scanning',
  writing: 'settings.general.dataBackup.progress.writing',
  finalizing: 'settings.general.dataBackup.progress.finalizing',
  completed: 'settings.general.dataBackup.progress.completed',
  failed: 'settings.general.dataBackup.progress.failed',
};
