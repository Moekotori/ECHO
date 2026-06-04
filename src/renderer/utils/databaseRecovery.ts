const sqliteCorruptionPattern =
  /DatabaseHealthError|database disk image is malformed|database disk image malformed|malformed database schema|SQLITE_CORRUPT|file is not a database/i;

const pendingSettingsSectionStorageKey = 'echo-next.settings.pending-section';

export const isLibraryDatabaseCorruptionError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return sqliteCorruptionPattern.test(message);
};

export const getLibraryDatabaseRecoveryMessage = (): string =>
  '曲库数据库可能已损坏。请进入 设置 > 危险操作 > 曲库数据库安全，优先恢复最近健康快照；没有健康快照时使用“归档坏库并重建空库”，再重新添加曲库文件夹并扫描。';

export const openLibraryDatabaseRecoverySettings = (): void => {
  window.sessionStorage.setItem(pendingSettingsSectionStorageKey, 'danger');
  window.dispatchEvent(new CustomEvent('settings:open-section', { detail: { section: 'danger' } }));
  window.dispatchEvent(new Event('app:navigate:settings'));
};
