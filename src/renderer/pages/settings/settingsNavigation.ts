import {
  Accessibility,
  Captions,
  Clapperboard,
  Code2,
  Download,
  FlaskConical,
  Gauge,
  Globe2,
  Info,
  Keyboard,
  Link2,
  MessageSquare,
  Palette,
  SlidersHorizontal,
  Trash2,
  User,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppSettings } from '../../../shared/types/appSettings';
import type { Locale, TranslationKey } from '../../i18n/locales';
import type { SettingsNavKey } from './settingsTypes';

export type SettingsNavItem = {
  key: SettingsNavKey;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
};

export type SettingsNavGroup = {
  id: 'basics' | 'audio' | 'content' | 'extensions' | 'advanced';
  label: Record<Locale, string>;
  itemKeys: SettingsNavKey[];
};

export const settingsNavItems: SettingsNavItem[] = [
  { key: 'general', labelKey: 'settings.nav.general.label', descriptionKey: 'settings.nav.general.description', icon: MessageSquare },
  { key: 'experimental', labelKey: 'settings.nav.experimental.label', descriptionKey: 'settings.nav.experimental.description', icon: FlaskConical },
  { key: 'advancedCustom', labelKey: 'settings.nav.advancedCustom.label', descriptionKey: 'settings.nav.advancedCustom.description', icon: Gauge },
  { key: 'playback', labelKey: 'settings.nav.playback.label', descriptionKey: 'settings.nav.playback.description', icon: Zap },
  { key: 'appearance', labelKey: 'settings.nav.appearance.label', descriptionKey: 'settings.nav.appearance.description', icon: Palette },
  { key: 'accessibility', labelKey: 'settings.nav.accessibility.label', descriptionKey: 'settings.nav.accessibility.description', icon: Accessibility },
  { key: 'library', labelKey: 'settings.nav.library.label', descriptionKey: 'settings.nav.library.description', icon: Download },
  { key: 'lyrics', labelKey: 'route.lyricsSettings.label', descriptionKey: 'route.lyricsSettings.description', icon: Captions },
  { key: 'mv', labelKey: 'route.mvSettings.label', descriptionKey: 'route.mvSettings.description', icon: Clapperboard },
  { key: 'shortcuts', labelKey: 'settings.nav.shortcuts.label', descriptionKey: 'settings.nav.shortcuts.description', icon: Keyboard },
  { key: 'integrations', labelKey: 'settings.nav.integrations.label', descriptionKey: 'settings.nav.integrations.description', icon: Link2 },
  { key: 'accounts', labelKey: 'settings.nav.accounts.label', descriptionKey: 'settings.nav.accounts.description', icon: User },
  { key: 'remote', labelKey: 'settings.nav.remote.label', descriptionKey: 'settings.nav.remote.description', icon: Globe2 },
  { key: 'plugins', labelKey: 'settings.nav.plugins.label', descriptionKey: 'settings.nav.plugins.description', icon: Code2 },
  { key: 'eq', labelKey: 'settings.nav.eq.label', descriptionKey: 'settings.nav.eq.description', icon: SlidersHorizontal },
  { key: 'about', labelKey: 'settings.nav.about.label', descriptionKey: 'settings.nav.about.description', icon: Info },
  { key: 'danger', labelKey: 'settings.nav.danger.label', descriptionKey: 'settings.nav.danger.description', icon: Trash2 },
];

export const settingsNavGroups: SettingsNavGroup[] = [
  {
    id: 'basics',
    label: { 'zh-CN': '基础', 'zh-TW': '基礎', 'ja-JP': '基本', 'en-US': 'Basics', 'ko-KR': '기본' },
    itemKeys: ['general', 'appearance', 'accessibility'],
  },
  {
    id: 'audio',
    label: { 'zh-CN': '音频与播放', 'zh-TW': '音訊與播放', 'ja-JP': 'オーディオと再生', 'en-US': 'Audio And Playback', 'ko-KR': '오디오 및 재생' },
    itemKeys: ['playback', 'eq'],
  },
  {
    id: 'content',
    label: { 'zh-CN': '内容与媒体', 'zh-TW': '內容與媒體', 'ja-JP': 'コンテンツとメディア', 'en-US': 'Content And Media', 'ko-KR': '콘텐츠 및 미디어' },
    itemKeys: ['library', 'lyrics', 'mv'],
  },
  {
    id: 'extensions',
    label: { 'zh-CN': '连接与扩展', 'zh-TW': '連接與擴充', 'ja-JP': '接続と拡張', 'en-US': 'Connections And Extensions', 'ko-KR': '연결 및 확장' },
    itemKeys: ['integrations', 'accounts', 'remote', 'plugins'],
  },
  {
    id: 'advanced',
    label: { 'zh-CN': '高级', 'zh-TW': '進階', 'ja-JP': '詳細', 'en-US': 'Advanced', 'ko-KR': '고급' },
    itemKeys: ['shortcuts', 'experimental', 'advancedCustom', 'about', 'danger'],
  },
];

export const shouldShowSettingsNavItem = (key: SettingsNavKey, settings: Partial<AppSettings> | null | undefined): boolean => {
  if (key === 'plugins' || key === 'remote' || key === 'eq') {
    return settings?.settingsOptionalSectionsVisible === true;
  }

  return true;
};

export const pendingSettingsSectionStorageKey = 'echo-next.settings.pending-section';
export const pendingRouteStorageKey = 'echo-next.pending-route';
export const settingsBackNavigationEvent = 'app:navigate:settings-back';
export const settingsSectionNavigationEvent = 'app:navigate:settings-section';
export const pluginsDocumentationUrl = 'https://github.com/moekotori/echo/blob/main/docs/ECHO_NEXT_PLUGINS.md';
export const settingsNavKeys = new Set<SettingsNavKey>(settingsNavItems.map((item) => item.key));

export const getSettingsNavIndex = (key: SettingsNavKey): number => settingsNavItems.findIndex((item) => item.key === key);

export const isSettingsEscapeBackEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
};

export const readInitialSettingsSection = (): SettingsNavKey => {
  if (typeof window === 'undefined') {
    return 'general';
  }

  try {
    const pendingSection = window.sessionStorage.getItem(pendingSettingsSectionStorageKey) ?? window.localStorage.getItem(pendingSettingsSectionStorageKey);
    if (pendingSection && settingsNavKeys.has(pendingSection as SettingsNavKey)) {
      window.sessionStorage.removeItem(pendingSettingsSectionStorageKey);
      window.localStorage.removeItem(pendingSettingsSectionStorageKey);
      return pendingSection as SettingsNavKey;
    }
  } catch {
    // Fall through to the default section when browser storage is unavailable.
  }

  return 'general';
};

