import type { Locale } from '../../../i18n/locales';

export const databaseProtectionSettingsCopy: Record<Locale, { disabledReason: string; openSettings: string }> = {
  'zh-CN': {
    disabledReason: '数据保护已关闭，自动和手动健康快照均已停用。请前往高级自定义，关闭“关闭数据保护”开关后再创建快照。',
    openSettings: '前往数据保护设置',
  },
  'zh-TW': {
    disabledReason: '資料保護已關閉，自動和手動健康快照均已停用。請前往進階自訂，關閉「關閉資料保護」開關後再建立快照。',
    openSettings: '前往資料保護設定',
  },
  'en-US': {
    disabledReason: 'Data protection is off, so automatic and manual healthy snapshots are disabled. In Advanced Customization, turn off “Disable data protection” before creating a snapshot.',
    openSettings: 'Open data protection settings',
  },
  'ja-JP': {
    disabledReason: 'データ保護が無効のため、自動・手動の正常なスナップショットは作成できません。高度なカスタマイズで「データ保護を無効にする」をオフにしてください。',
    openSettings: 'データ保護設定を開く',
  },
  'ko-KR': {
    disabledReason: '데이터 보호가 꺼져 있어 자동 및 수동 정상 스냅샷을 만들 수 없습니다. 고급 사용자 지정에서 데이터 보호 비활성화 스위치를 끈 후 스냅샷을 만드세요.',
    openSettings: '데이터 보호 설정 열기',
  },
};
