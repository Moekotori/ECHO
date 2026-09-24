import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Blocks, BookOpen, Cable, CheckCircle2, FolderOpen, Gamepad2, Gauge, Gift, HardDrive, Headphones, Languages, Loader2, LogIn, Palette, RadioTower, ScanLine, Sparkles, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AudioOutputMode } from '../../../shared/types/audio';
import type { AppSettings, AppThemeMode, AppThemePreset, ScanPerformanceMode } from '../../../shared/types/appSettings';
import { detectRendererPlatform, isAdvancedNativeOutputPlatform, isExclusiveNativeOutputPlatform, isNativeSharedOutputPlatform } from '../../../shared/utils/audioPlatformCapabilities';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import { localeOptions } from '../../i18n/locales';
import type { Locale, TranslationKey } from '../../i18n/locales';
import { updateThemePreferences } from '../../preferences/themePreferences';
import { rememberLibraryScanStatus } from '../../stores/libraryScanSession';
import '../../styles/first-run-immersive.css';
import '../../styles/first-run-mascot.css';

const mascotArtworkUrl = new URL('../../assets/echo-mascot-lemon-rabbit-q.png', import.meta.url).href;

type FirstRunWizardProps = {
  initialSettings: AppSettings | null;
  onClose: () => void;
  onCompleted: (settings: AppSettings | null) => void;
  presentationState?: 'open' | 'closing';
};

type FirstRunStepId = 'language' | 'library' | 'cache' | 'scan' | 'audio' | 'performance' | 'appearance' | 'osu' | 'accounts' | 'pro' | 'summary';

type FirstRunStep = {
  id: FirstRunStepId;
  labelKey: TranslationKey;
  eyebrowKey?: TranslationKey;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
};

type FirstRunPhase = {
  id: 'basics' | 'library' | 'playback' | 'personalize' | 'pro' | 'summary';
  labelKey: TranslationKey;
  subtitleKeys?: TranslationKey[];
  stepIds: FirstRunStepId[];
  icon: LucideIcon;
};

const echoDocumentationUrl = 'https://echonext.moe/zh/docs/';
const echoSponsorUrl = 'https://afdian.com/a/echonext';

type FirstRunOption<T extends string> = {
  mode: T;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  hintKey: TranslationKey;
};

type FirstRunFeatureToggleId = 'lowLoadPlayback' | 'albumWallVirtualization';

type FirstRunFeatureToggle = {
  id: FirstRunFeatureToggleId;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  hintKey: TranslationKey;
};

const scanModes: Array<FirstRunOption<ScanPerformanceMode>> = [
  { mode: 'balanced', labelKey: 'firstRun.scan.balanced.label', descriptionKey: 'firstRun.scan.balanced.description', hintKey: 'firstRun.scan.balanced.hint' },
  { mode: 'low', labelKey: 'firstRun.scan.low.label', descriptionKey: 'firstRun.scan.low.description', hintKey: 'firstRun.scan.low.hint' },
  { mode: 'performance', labelKey: 'firstRun.scan.performance.label', descriptionKey: 'firstRun.scan.performance.description', hintKey: 'firstRun.scan.performance.hint' },
];

const outputModes: Array<FirstRunOption<AudioOutputMode>> = [
  { mode: 'shared', labelKey: 'firstRun.audio.shared.label', descriptionKey: 'firstRun.audio.shared.description', hintKey: 'firstRun.audio.shared.hint' },
  { mode: 'system', labelKey: 'firstRun.audio.system.label', descriptionKey: 'firstRun.audio.system.description', hintKey: 'firstRun.audio.system.hint' },
  { mode: 'exclusive', labelKey: 'firstRun.audio.exclusive.label', descriptionKey: 'firstRun.audio.exclusive.description', hintKey: 'firstRun.audio.exclusive.hint' },
];

const themeModes: Array<FirstRunOption<AppThemeMode>> = [
  { mode: 'light', labelKey: 'settings.appearance.theme.light', descriptionKey: 'firstRun.theme.light.description', hintKey: 'firstRun.theme.light.hint' },
  { mode: 'dark', labelKey: 'settings.appearance.theme.dark', descriptionKey: 'firstRun.theme.dark.description', hintKey: 'firstRun.theme.dark.hint' },
  { mode: 'system', labelKey: 'settings.appearance.theme.followSystem', descriptionKey: 'firstRun.theme.system.description', hintKey: 'firstRun.theme.system.hint' },
  { mode: 'ambient', labelKey: 'settings.appearance.theme.ambient', descriptionKey: 'firstRun.theme.ambient.description', hintKey: 'firstRun.theme.ambient.hint' },
];

const themePresets: Array<{ preset: AppThemePreset; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { preset: 'classic', labelKey: 'settings.appearance.themePreset.classic', descriptionKey: 'settings.appearance.themePreset.classic.description' },
  { preset: 'sakuraMilk', labelKey: 'settings.appearance.themePreset.sakuraMilk', descriptionKey: 'settings.appearance.themePreset.sakuraMilk.description' },
  { preset: 'mintCandy', labelKey: 'settings.appearance.themePreset.mintCandy', descriptionKey: 'settings.appearance.themePreset.mintCandy.description' },
  { preset: 'echoTwilight', labelKey: 'settings.appearance.themePreset.echoTwilight', descriptionKey: 'settings.appearance.themePreset.echoTwilight.description' },
  { preset: 'graphiteAurora', labelKey: 'settings.appearance.themePreset.graphiteAurora', descriptionKey: 'settings.appearance.themePreset.graphiteAurora.description' },
  { preset: 'darkSideMoon', labelKey: 'settings.appearance.themePreset.darkSideMoon', descriptionKey: 'settings.appearance.themePreset.darkSideMoon.description' },
];

const proFeatureCards: Array<{
  id: 'dsp' | 'connect' | 'network' | 'customize';
  icon: LucideIcon;
  titleKey: TranslationKey;
  descriptionKeys: TranslationKey[];
  featured?: boolean;
}> = [
  {
    id: 'dsp',
    icon: Gauge,
    titleKey: 'firstRun.pro.feature.dsp.title',
    descriptionKeys: ['firstRun.pro.benefit.dsp'],
    featured: true,
  },
  {
    id: 'connect',
    icon: Cable,
    titleKey: 'firstRun.pro.feature.connect.title',
    descriptionKeys: ['firstRun.pro.benefit.connect'],
  },
  {
    id: 'network',
    icon: RadioTower,
    titleKey: 'firstRun.pro.feature.network.title',
    descriptionKeys: ['firstRun.pro.benefit.network', 'firstRun.pro.benefit.mobile'],
  },
  {
    id: 'customize',
    icon: Blocks,
    titleKey: 'firstRun.pro.feature.customize.title',
    descriptionKeys: ['firstRun.pro.benefit.themes', 'firstRun.pro.benefit.plugins'],
  },
];

const featureToggles: FirstRunFeatureToggle[] = [
  {
    id: 'lowLoadPlayback',
    labelKey: 'firstRun.feature.lowLoad.label',
    descriptionKey: 'firstRun.feature.lowLoad.description',
    hintKey: 'firstRun.feature.lowLoad.hint',
  },
  {
    id: 'albumWallVirtualization',
    labelKey: 'firstRun.feature.albumWall.label',
    descriptionKey: 'firstRun.feature.albumWall.description',
    hintKey: 'firstRun.feature.albumWall.hint',
  },
];

type OsuOnboardingCopy = {
  title: string;
  description: string;
  yesLabel: string;
  yesDescription: string;
  noLabel: string;
  noDescription: string;
  enabledStatus: string;
  disabledStatus: string;
};

const osuOnboardingCopy: Record<Locale, OsuOnboardingCopy> = {
  'zh-CN': {
    title: '你是 osu! 玩家吗？',
    description: '如果你玩 osu!，我们会开启专属页面，用来搜索 beatmap、浏览收藏并提取音频。',
    yesLabel: '是，我玩 osu!',
    yesDescription: '开启侧栏中的 osu! 页面和 beatmap 搜索入口。',
    noLabel: '暂时不是',
    noDescription: '保持关闭，不影响其他音乐功能，之后也能在设置中开启。',
    enabledStatus: 'osu! 页面将在完成引导后显示',
    disabledStatus: 'osu! 页面将保持隐藏',
  },
  'zh-TW': {
    title: '你是 osu! 玩家嗎？',
    description: '如果你玩 osu!，我們會開啟專屬頁面，用來搜尋 beatmap、瀏覽收藏並擷取音訊。',
    yesLabel: '是，我玩 osu!',
    yesDescription: '開啟側欄中的 osu! 頁面和 beatmap 搜尋入口。',
    noLabel: '暫時不是',
    noDescription: '保持關閉，不影響其他音樂功能，之後也能在設定中開啟。',
    enabledStatus: 'osu! 頁面將在完成引導後顯示',
    disabledStatus: 'osu! 頁面將保持隱藏',
  },
  'ja-JP': {
    title: 'osu! をプレイしますか？',
    description: 'osu! プレイヤー向けに、beatmap の検索、コレクションの閲覧、音声抽出ができる専用ページを有効にします。',
    yesLabel: 'はい、osu! をプレイします',
    yesDescription: 'サイドバーに osu! ページと beatmap 検索を表示します。',
    noLabel: '今は使いません',
    noDescription: '他の音楽機能には影響しません。設定からいつでも有効にできます。',
    enabledStatus: 'セットアップ完了後に osu! ページを表示します',
    disabledStatus: 'osu! ページは非表示のままです',
  },
  'en-US': {
    title: 'Do you play osu!?',
    description: 'Enable a dedicated page for beatmap search, collection browsing, and audio extraction.',
    yesLabel: 'Yes, I play osu!',
    yesDescription: 'Show the osu! page and beatmap search in the sidebar.',
    noLabel: 'Not right now',
    noDescription: 'Keep it hidden without affecting other music features. You can enable it later in Settings.',
    enabledStatus: 'The osu! page will appear after setup',
    disabledStatus: 'The osu! page will stay hidden',
  },
  'ko-KR': {
    title: 'osu!를 플레이하시나요?',
    description: 'beatmap 검색, 컬렉션 탐색, 오디오 추출을 위한 전용 osu! 페이지를 활성화합니다.',
    yesLabel: '네, osu!를 플레이해요',
    yesDescription: '사이드바에 osu! 페이지와 beatmap 검색을 표시합니다.',
    noLabel: '지금은 사용하지 않아요',
    noDescription: '다른 음악 기능에는 영향이 없으며 설정에서 나중에 켤 수 있습니다.',
    enabledStatus: '설정 완료 후 osu! 페이지가 표시됩니다',
    disabledStatus: 'osu! 페이지가 숨겨진 상태로 유지됩니다',
  },
};

const detectFirstRunPlatform = (): NodeJS.Platform | 'unknown' =>
  typeof window !== 'undefined' ? detectRendererPlatform(window.navigator) : 'unknown';

const getSupportedFirstRunOutputModes = (
  platform: NodeJS.Platform | 'unknown',
): Array<FirstRunOption<AudioOutputMode>> =>
  outputModes
    .filter((item) => {
      if (item.mode === 'system') {
        return true;
      }

      if (item.mode === 'shared') {
        return isNativeSharedOutputPlatform(platform);
      }

      return item.mode === 'exclusive'
        ? isExclusiveNativeOutputPlatform(platform)
        : isAdvancedNativeOutputPlatform(platform);
    })
    .map((item) =>
      platform === 'linux' && item.mode === 'shared'
        ? {
            ...item,
            labelKey: 'firstRun.audio.linuxShared.label',
            descriptionKey: 'firstRun.audio.linuxShared.description',
            hintKey: 'firstRun.audio.linuxShared.hint',
          }
        : item,
    );

const firstRunSteps: FirstRunStep[] = [
  {
    id: 'language',
    labelKey: 'firstRun.step.language.label',
    eyebrowKey: 'firstRun.step.language.eyebrow',
    titleKey: 'firstRun.step.language.title',
    descriptionKey: 'firstRun.step.language.description',
    icon: Languages,
  },
  {
    id: 'library',
    labelKey: 'firstRun.step.library.label',
    eyebrowKey: 'firstRun.step.library.eyebrow',
    titleKey: 'firstRun.step.library.title',
    descriptionKey: 'firstRun.step.library.description',
    icon: FolderOpen,
  },
  {
    id: 'cache',
    labelKey: 'firstRun.step.cache.label',
    eyebrowKey: 'firstRun.step.cache.eyebrow',
    titleKey: 'firstRun.step.cache.title',
    descriptionKey: 'firstRun.step.cache.description',
    icon: HardDrive,
  },
  {
    id: 'scan',
    labelKey: 'firstRun.step.scan.label',
    eyebrowKey: 'firstRun.step.scan.eyebrow',
    titleKey: 'firstRun.step.scan.title',
    descriptionKey: 'firstRun.step.scan.description',
    icon: ScanLine,
  },
  {
    id: 'audio',
    labelKey: 'firstRun.step.audio.label',
    eyebrowKey: 'firstRun.step.audio.eyebrow',
    titleKey: 'firstRun.step.audio.title',
    descriptionKey: 'firstRun.step.audio.description',
    icon: Headphones,
  },
  {
    id: 'performance',
    labelKey: 'firstRun.step.performance.label',
    titleKey: 'firstRun.step.performance.title',
    descriptionKey: 'firstRun.step.performance.description',
    icon: Gauge,
  },
  {
    id: 'appearance',
    labelKey: 'firstRun.step.appearance.label',
    eyebrowKey: 'firstRun.step.appearance.eyebrow',
    titleKey: 'firstRun.step.appearance.title',
    descriptionKey: 'firstRun.step.appearance.description',
    icon: Palette,
  },
  {
    id: 'osu',
    labelKey: 'firstRun.feature.osuDownloader.label',
    titleKey: 'firstRun.feature.osuDownloader.label',
    descriptionKey: 'firstRun.feature.osuDownloader.description',
    icon: Gamepad2,
  },
  {
    id: 'accounts',
    labelKey: 'firstRun.step.accounts.label',
    eyebrowKey: 'firstRun.step.accounts.eyebrow',
    titleKey: 'firstRun.step.accounts.title',
    descriptionKey: 'firstRun.step.accounts.description',
    icon: LogIn,
  },
  {
    id: 'pro',
    labelKey: 'firstRun.pro.title',
    titleKey: 'firstRun.pro.title',
    descriptionKey: 'firstRun.pro.description',
    icon: Gift,
  },
  {
    id: 'summary',
    labelKey: 'firstRun.step.summary.label',
    eyebrowKey: 'firstRun.step.summary.eyebrow',
    titleKey: 'firstRun.step.summary.title',
    descriptionKey: 'firstRun.step.summary.description',
    icon: CheckCircle2,
  },
];

const firstRunPhases: FirstRunPhase[] = [
  {
    id: 'basics',
    labelKey: 'firstRun.step.language.label',
    stepIds: ['language'],
    icon: Languages,
  },
  {
    id: 'library',
    labelKey: 'firstRun.step.library.label',
    subtitleKeys: ['firstRun.library.chooseFolder', 'firstRun.step.cache.label', 'firstRun.step.scan.label'],
    stepIds: ['library', 'cache', 'scan'],
    icon: FolderOpen,
  },
  {
    id: 'playback',
    labelKey: 'firstRun.step.audio.label',
    subtitleKeys: ['firstRun.step.audio.label', 'firstRun.step.performance.label'],
    stepIds: ['audio', 'performance'],
    icon: Headphones,
  },
  {
    id: 'personalize',
    labelKey: 'firstRun.step.appearance.label',
    subtitleKeys: ['firstRun.step.appearance.label', 'firstRun.feature.osuDownloader.label', 'firstRun.step.accounts.label'],
    stepIds: ['appearance', 'osu', 'accounts'],
    icon: Palette,
  },
  {
    id: 'pro',
    labelKey: 'firstRun.pro.title',
    subtitleKeys: ['firstRun.pro.kicker'],
    stepIds: ['pro'],
    icon: Gift,
  },
  {
    id: 'summary',
    labelKey: 'firstRun.step.summary.label',
    stepIds: ['summary'],
    icon: CheckCircle2,
  },
];

const firstRunStepNotes: Record<FirstRunStepId, TranslationKey[]> = {
  language: ['firstRun.detail.language.applyNow', 'firstRun.detail.language.changeLater'],
  library: ['firstRun.detail.library.safe', 'firstRun.detail.library.scan'],
  cache: ['firstRun.detail.cache.space', 'firstRun.detail.cache.changeLater'],
  scan: ['firstRun.detail.scan.balanced', 'firstRun.detail.scan.low'],
  audio: ['firstRun.detail.audio.shared', 'firstRun.detail.audio.advanced'],
  performance: ['firstRun.detail.performance.optional', 'firstRun.detail.performance.changeLater'],
  appearance: ['firstRun.detail.appearance.preview', 'firstRun.detail.appearance.system'],
  osu: ['firstRun.feature.osuDownloader.hint', 'firstRun.detail.performance.changeLater'],
  accounts: ['firstRun.detail.accounts.later', 'firstRun.detail.accounts.local'],
  pro: ['firstRun.pro.kicker'],
  summary: ['firstRun.detail.summary.save', 'firstRun.detail.summary.docs'],
};

export const FirstRunWizard = ({ initialSettings, onClose, onCompleted, presentationState = 'open' }: FirstRunWizardProps): JSX.Element => {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? translateFallback;
  const activeLocale = i18n?.locale ?? (initialSettings?.locale as Locale | undefined) ?? 'zh-CN';
  const setLocale = i18n?.setLocale;
  const [rendererPlatform] = useState<NodeJS.Platform | 'unknown'>(() => detectFirstRunPlatform());
  const firstRunOutputModes = useMemo(() => getSupportedFirstRunOutputModes(rendererPlatform), [rendererPlatform]);
  const [activeStepId, setActiveStepId] = useState<FirstRunStepId>('language');
  const [musicFolderPath, setMusicFolderPath] = useState<string | null>(null);
  const [cacheDirectory, setCacheDirectory] = useState<string | null | undefined>(undefined);
  const [scanMode, setScanMode] = useState<ScanPerformanceMode>(initialSettings?.scanPerformanceMode ?? 'balanced');
  const [appearanceTheme, setAppearanceTheme] = useState<AppThemeMode>(initialSettings?.appearanceTheme ?? 'light');
  const [appearanceThemePreset, setAppearanceThemePreset] = useState<AppThemePreset>(initialSettings?.appearanceThemePreset ?? 'classic');
  const [lowLoadPlaybackModeEnabled, setLowLoadPlaybackModeEnabled] = useState(initialSettings?.lowLoadPlaybackModeEnabled === true);
  const [albumWallVirtualizationEnabled, setAlbumWallVirtualizationEnabled] = useState(initialSettings?.albumWallVirtualizationEnabled === true);
  const [osuDownloaderFeatureEnabled, setOsuDownloaderFeatureEnabled] = useState(initialSettings?.osuDownloaderFeatureEnabled === true);
  const [outputMode, setOutputMode] = useState<AudioOutputMode>(() => {
    const supportedModes = getSupportedFirstRunOutputModes(rendererPlatform);
    const fallbackMode = supportedModes.some((item) => item.mode === 'shared') ? 'shared' : 'system';
    const rememberedMode = initialSettings?.rememberedAudioOutput?.outputMode ?? fallbackMode;
    return supportedModes.some((item) => item.mode === rememberedMode) ? rememberedMode : fallbackMode;
  });
  const [scanNow, setScanNow] = useState(true);
  const [busy, setBusy] = useState<'folder' | 'cache' | 'finish' | 'skip' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeStepIndex = Math.max(0, firstRunSteps.findIndex((step) => step.id === activeStepId));
  const activeStep = firstRunSteps[activeStepIndex] ?? firstRunSteps[0]!;
  const activeOsuCopy = osuOnboardingCopy[activeLocale] ?? osuOnboardingCopy['en-US'];
  const ActiveIcon = activeStep.icon;
  const isFinalStep = activeStep.id === 'summary';
  const stepNumberLabel = `${activeStepIndex + 1} / ${firstRunSteps.length}`;
  const activeStepNotes = firstRunStepNotes[activeStep.id];
  const activePhaseIndex = Math.max(0, firstRunPhases.findIndex((phase) => phase.stepIds.includes(activeStep.id)));
  const activePhase = firstRunPhases[activePhaseIndex] ?? firstRunPhases[0]!;
  const activeSubStepIndex = Math.max(0, activePhase.stepIds.indexOf(activeStep.id));
  const nextStep = firstRunSteps[Math.min(firstRunSteps.length - 1, activeStepIndex + 1)] ?? activeStep;
  const activeStepTitle = activeStep.id === 'osu'
    ? activeOsuCopy.title
    : activeStep.id === 'summary'
      ? t('firstRun.summary.readyTitle')
      : t(activeStep.titleKey);
  const activeStepDescription = activeStep.id === 'osu'
    ? activeOsuCopy.description
    : activeStep.id === 'summary'
      ? t('firstRun.summary.readyDescription')
      : t(activeStep.descriptionKey);

  const cacheDirectoryLabel = useMemo(() => {
    if (cacheDirectory === undefined) {
      return initialSettings?.coverCacheDir ?? t('firstRun.defaultLocation');
    }
    return cacheDirectory ?? t('firstRun.defaultLocation');
  }, [cacheDirectory, initialSettings?.coverCacheDir, t]);

  const scanModeLabel = t(scanModes.find((item) => item.mode === scanMode)?.labelKey ?? 'firstRun.scan.balanced.label');
  const outputModeLabel = t(firstRunOutputModes.find((item) => item.mode === outputMode)?.labelKey ?? 'firstRun.audio.system.label');
  const appearanceThemeLabel = t(themeModes.find((item) => item.mode === appearanceTheme)?.labelKey ?? 'settings.appearance.theme.light');
  const ambientThemeSelected = appearanceTheme === 'ambient';
  const effectiveAppearanceThemePreset = ambientThemeSelected ? 'classic' : appearanceThemePreset;
  const appearancePresetLabel = ambientThemeSelected
    ? t('settings.appearance.theme.ambient')
    : t(themePresets.find((item) => item.preset === appearanceThemePreset)?.labelKey ?? 'settings.appearance.themePreset.classic');
  const featureEnabledById: Record<FirstRunFeatureToggleId, boolean> = {
    lowLoadPlayback: lowLoadPlaybackModeEnabled,
    albumWallVirtualization: albumWallVirtualizationEnabled,
  };
  const enabledFeatureLabels = [
    ...featureToggles.filter((item) => featureEnabledById[item.id]).map((item) => t(item.labelKey)),
    ...(osuDownloaderFeatureEnabled ? [t('firstRun.feature.osuDownloader.label')] : []),
  ];
  const featureSummaryLabel = enabledFeatureLabels.length ? enabledFeatureLabels.join(', ') : t('firstRun.summary.featuresDefault');

  const setFeatureToggleEnabled = (id: FirstRunFeatureToggleId, enabled: boolean): void => {
    switch (id) {
      case 'lowLoadPlayback':
        setLowLoadPlaybackModeEnabled(enabled);
        return;
      case 'albumWallVirtualization':
        setAlbumWallVirtualizationEnabled(enabled);
        return;
      default:
        return;
    }
  };

  const chooseMusicFolder = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.chooseFolder) {
      setError(t('firstRun.error.desktopBridgeMusicFolder'));
      return;
    }

    try {
      setBusy('folder');
      setError(null);
      const chosen = await library.chooseFolder();
      if (chosen) {
        setMusicFolderPath(chosen);
      }
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : String(chooseError));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const chooseCacheDirectory = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    if (!app?.chooseCacheDirectory) {
      setError(t('firstRun.error.desktopBridgeCache'));
      return;
    }

    try {
      setBusy('cache');
      setError(null);
      const chosen = await app.chooseCacheDirectory();
      if (chosen) {
        setCacheDirectory(chosen);
      }
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : String(chooseError));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const skip = useCallback(async (): Promise<void> => {
    try {
      setBusy('skip');
      setError(null);
      const settings = await window.echo?.app?.setSettings?.({ onboardingCompleted: true });
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: settings ?? { onboardingCompleted: true } }));
      onCompleted(settings ?? null);
      onClose();
    } catch (skipError) {
      setError(skipError instanceof Error ? skipError.message : String(skipError));
    } finally {
      setBusy(null);
    }
  }, [onClose, onCompleted]);

  const finish = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    const library = window.echo?.library;

    if (!app?.setSettings) {
      setError(t('firstRun.error.desktopBridgeSave'));
      return;
    }

    try {
      setBusy('finish');
      setError(null);
      setMessage(null);

      if (cacheDirectory !== undefined && app.setCoverCacheDirectory) {
        await app.setCoverCacheDirectory({ directory: cacheDirectory, migrate: false });
      }

      const currentSettings = await app.getSettings().catch(() => initialSettings);
      const rememberedAudioOutput = {
        ...(currentSettings?.rememberedAudioOutput ?? initialSettings?.rememberedAudioOutput),
        enabled: true,
        outputMode,
      };
      const nextSettings = await app.setSettings({
        onboardingCompleted: true,
        appearanceTheme,
        appearanceThemeCustomId: null,
        appearanceThemePreset: effectiveAppearanceThemePreset,
        scanPerformanceMode: scanMode,
        lowLoadPlaybackModeEnabled,
        albumWallVirtualizationEnabled,
        osuDownloaderFeatureEnabled,
        rememberedAudioOutput,
      });
      updateThemePreferences(appearanceTheme, effectiveAppearanceThemePreset, nextSettings.appearanceThemePresetOverrides ?? {}, {
        animate: true,
        customThemeId: null,
        customThemes: nextSettings.appearanceCustomThemes ?? [],
      });

      await window.echo?.audio?.setOutput?.({ outputMode }).catch(() => undefined);

      if (musicFolderPath && library?.addFolder) {
        const folder = await library.addFolder(musicFolderPath);
        if (scanNow && library.scanFolder) {
          rememberLibraryScanStatus(await library.scanFolder(folder.id));
        }
        window.dispatchEvent(new Event('library:changed'));
      }

      window.dispatchEvent(new CustomEvent('settings:changed', { detail: nextSettings }));
      setMessage(t('firstRun.message.saved'));
      onCompleted(nextSettings);
      onClose();
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : String(finishError));
    } finally {
      setBusy(null);
    }
  }, [
    albumWallVirtualizationEnabled,
    appearanceTheme,
    cacheDirectory,
    effectiveAppearanceThemePreset,
    initialSettings,
    lowLoadPlaybackModeEnabled,
    musicFolderPath,
    onClose,
    onCompleted,
    osuDownloaderFeatureEnabled,
    outputMode,
    scanMode,
    scanNow,
    t,
  ]);

  const openExternalUrl = useCallback((url: string): void => {
    const openExternalUrl = window.echo?.app?.openExternalUrl;
    if (openExternalUrl) {
      void openExternalUrl(url).catch(() => {
        window.open(url, '_blank', 'noopener,noreferrer');
      });
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const openDocumentation = useCallback((): void => openExternalUrl(echoDocumentationUrl), [openExternalUrl]);
  const openSponsorChannel = useCallback((): void => openExternalUrl(echoSponsorUrl), [openExternalUrl]);

  const goToPreviousStep = (): void => {
    setActiveStepId(firstRunSteps[Math.max(0, activeStepIndex - 1)]!.id);
  };

  const goToNextStep = (): void => {
    setActiveStepId(firstRunSteps[Math.min(firstRunSteps.length - 1, activeStepIndex + 1)]!.id);
  };

  const renderStepBody = (): JSX.Element => {
    switch (activeStep.id) {
      case 'language':
        return (
          <div className="first-run-options first-run-options--cards first-run-options--compact first-run-language-options">
            {localeOptions.map((option) => (
              <button
                className={activeLocale === option.locale ? 'is-active' : undefined}
                key={option.locale}
                type="button"
                aria-pressed={activeLocale === option.locale}
                onClick={() => setLocale?.(option.locale)}
              >
                <strong>{option.label}</strong>
                <span>{t(`firstRun.language.${option.locale}.description` as TranslationKey)}</span>
                <em>{activeLocale === option.locale ? t('firstRun.language.current') : t('firstRun.language.choose')}</em>
              </button>
            ))}
          </div>
        );
      case 'library':
        return (
          <div className="first-run-control-panel">
            <p className="first-run-selection-label">{t('firstRun.currentSelection')}</p>
            <div className="first-run-path-preview">{musicFolderPath ?? t('firstRun.library.noneSelected')}</div>
            <div className="settings-chip-row settings-chip-row--left">
              <button className="settings-action-button" type="button" disabled={busy !== null} onClick={() => void chooseMusicFolder()}>
                {busy === 'folder' ? <Loader2 className="spinning-icon" size={15} /> : <FolderOpen size={15} />}
                {t('firstRun.library.chooseFolder')}
              </button>
              <label className="first-run-scan-toggle">
                <input type="checkbox" checked={scanNow} onChange={(event) => setScanNow(event.target.checked)} />
                <span className="first-run-scan-switch" aria-hidden="true" />
                <span>{t('firstRun.library.scanAfterFinish')}</span>
              </label>
            </div>
          </div>
        );
      case 'cache':
        return (
          <div className="first-run-control-panel">
            <p className="first-run-selection-label">{t('firstRun.currentSelection')}</p>
            <div className="first-run-path-preview">{cacheDirectoryLabel}</div>
            <div className="settings-chip-row settings-chip-row--left">
              <button className="settings-action-button" type="button" disabled={busy !== null} onClick={() => void chooseCacheDirectory()}>
                {busy === 'cache' ? <Loader2 className="spinning-icon" size={15} /> : <HardDrive size={15} />}
                {t('firstRun.cache.chooseLocation')}
              </button>
              <button className="settings-action-button" type="button" disabled={busy !== null} onClick={() => setCacheDirectory(null)}>
                {t('firstRun.cache.useDefault')}
              </button>
            </div>
          </div>
        );
      case 'scan':
        return (
          <div className="first-run-options first-run-options--cards">
            {scanModes.map((item) => (
              <button
                className={scanMode === item.mode ? 'is-active' : undefined}
                key={item.mode}
                type="button"
                aria-pressed={scanMode === item.mode}
                onClick={() => setScanMode(item.mode)}
              >
                <strong>{t(item.labelKey)}</strong>
                <span>{t(item.descriptionKey)}</span>
                <em>{t(item.hintKey)}</em>
              </button>
            ))}
          </div>
        );
      case 'audio':
        return (
          <div className="first-run-options first-run-options--cards first-run-options--compact">
            {firstRunOutputModes.map((item) => (
              <button
                className={outputMode === item.mode ? 'is-active' : undefined}
                key={item.mode}
                type="button"
                aria-pressed={outputMode === item.mode}
                onClick={() => setOutputMode(item.mode)}
              >
                <strong>{t(item.labelKey)}</strong>
                <span>{t(item.descriptionKey)}</span>
                <em>{t(item.hintKey)}</em>
              </button>
            ))}
          </div>
        );
      case 'performance':
        return (
          <div className="first-run-options first-run-options--cards first-run-options--compact">
            {featureToggles.map((item) => {
              const enabled = featureEnabledById[item.id];
              return (
                <button
                  className={enabled ? 'is-active' : undefined}
                  key={item.id}
                  type="button"
                  aria-pressed={enabled}
                  onClick={() => setFeatureToggleEnabled(item.id, !enabled)}
                >
                  <strong>{t(item.labelKey)}</strong>
                  <span>{t(item.descriptionKey)}</span>
                  <em>{enabled ? t('firstRun.feature.enabled') : t(item.hintKey)}</em>
                </button>
              );
            })}
          </div>
        );
      case 'appearance':
        return (
          <div className="first-run-appearance-panel">
            <section className="first-run-appearance-section">
              <header>
                <div>
                  <span>{t('firstRun.theme.modeTitle')}</span>
                  <strong>{appearanceThemeLabel}</strong>
                </div>
              </header>
              <div className="first-run-appearance-mode-grid">
                {themeModes.map((item) => (
                  <button
                    className={appearanceTheme === item.mode ? 'is-active' : undefined}
                    key={item.mode}
                    type="button"
                    aria-pressed={appearanceTheme === item.mode}
                    onClick={() => setAppearanceTheme(item.mode)}
                  >
                    <span>
                      <strong>{t(item.labelKey)}</strong>
                      <small>{t(item.hintKey)}</small>
                    </span>
                    {appearanceTheme === item.mode ? <CheckCircle2 size={17} aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            </section>
            <section className="first-run-appearance-section">
              <header>
                <div>
                  <span>{t('firstRun.theme.presetTitle')}</span>
                  <strong>{appearancePresetLabel}</strong>
                </div>
                {ambientThemeSelected ? <small>{t('settings.appearance.themePreset.ambientLocked')}</small> : null}
              </header>
              <div className="first-run-appearance-preset-grid">
                {themePresets.map((item) => (
                  <button
                    className={!ambientThemeSelected && appearanceThemePreset === item.preset ? 'is-active' : undefined}
                    disabled={ambientThemeSelected}
                    key={item.preset}
                    type="button"
                    aria-disabled={ambientThemeSelected}
                    aria-pressed={!ambientThemeSelected && appearanceThemePreset === item.preset}
                    title={ambientThemeSelected ? t('settings.appearance.themePreset.ambientLocked') : undefined}
                    onClick={() => setAppearanceThemePreset(item.preset)}
                  >
                    <span className="first-run-theme-swatch" data-preset={item.preset} aria-hidden="true" />
                    <span className="first-run-appearance-preset-copy">
                      <strong>{t(item.labelKey)}</strong>
                      <small>{t(item.descriptionKey)}</small>
                    </span>
                    {!ambientThemeSelected && appearanceThemePreset === item.preset ? <CheckCircle2 size={16} aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            </section>
          </div>
        );
      case 'osu':
        return (
          <div className="first-run-osu-question">
            <div className="first-run-osu-choices">
              <button
                className={`first-run-osu-choice first-run-osu-choice--yes ${osuDownloaderFeatureEnabled ? 'is-active' : ''}`.trim()}
                type="button"
                aria-pressed={osuDownloaderFeatureEnabled}
                onClick={() => setOsuDownloaderFeatureEnabled(true)}
              >
                <span className="first-run-osu-choice-icon"><Gamepad2 size={22} aria-hidden="true" /></span>
                <span>
                  <strong>{activeOsuCopy.yesLabel}</strong>
                  <small>{activeOsuCopy.yesDescription}</small>
                </span>
                {osuDownloaderFeatureEnabled ? <CheckCircle2 size={20} aria-hidden="true" /> : null}
              </button>
              <button
                className={`first-run-osu-choice first-run-osu-choice--no ${!osuDownloaderFeatureEnabled ? 'is-active' : ''}`.trim()}
                type="button"
                aria-pressed={!osuDownloaderFeatureEnabled}
                onClick={() => setOsuDownloaderFeatureEnabled(false)}
              >
                <span className="first-run-osu-choice-icon"><X size={22} aria-hidden="true" /></span>
                <span>
                  <strong>{activeOsuCopy.noLabel}</strong>
                  <small>{activeOsuCopy.noDescription}</small>
                </span>
                {!osuDownloaderFeatureEnabled ? <CheckCircle2 size={20} aria-hidden="true" /> : null}
              </button>
            </div>
            <div className={`first-run-osu-status ${osuDownloaderFeatureEnabled ? 'is-enabled' : ''}`} role="status">
              {osuDownloaderFeatureEnabled ? <Gamepad2 size={17} aria-hidden="true" /> : <X size={17} aria-hidden="true" />}
              <span>{osuDownloaderFeatureEnabled ? activeOsuCopy.enabledStatus : activeOsuCopy.disabledStatus}</span>
            </div>
          </div>
        );
      case 'accounts':
        return (
          <div className="first-run-account-guide">
            <ol>
              <li>
                <strong>{t('firstRun.accounts.open.title')}</strong>
                <span>{t('firstRun.accounts.open.description')}</span>
              </li>
              <li>
                <strong>{t('firstRun.accounts.login.title')}</strong>
                <span>{t('firstRun.accounts.login.description')}</span>
              </li>
              <li>
                <strong>{t('firstRun.accounts.cookie.title')}</strong>
                <span>{t('firstRun.accounts.cookie.description')}</span>
              </li>
              <li>
                <strong>{t('firstRun.accounts.spotify.title')}</strong>
                <span>{t('firstRun.accounts.spotify.description')}</span>
              </li>
            </ol>
            <p>{t('firstRun.accounts.note')}</p>
          </div>
        );
      case 'pro':
        return (
          <div className="first-run-pro-page">
            <div className="first-run-pro-story">
              <span>{t('firstRun.pro.kicker')}</span>
              <div className="first-run-pro-story-copy">
                <p>{t('firstRun.pro.freeNotice')}</p>
              </div>
              <p className="first-run-pro-contributor-note"><Sparkles size={14} aria-hidden="true" />{t('firstRun.pro.contributors')}</p>
              <button className="settings-action-button first-run-pro-purchase" type="button" onClick={openSponsorChannel}>
                <Gift size={16} />
                <span>
                  <strong>{t('firstRun.pro.action')}</strong>
                  <small>afdian.com/a/echonext</small>
                </span>
                <ArrowRight size={16} />
              </button>
            </div>
            <div className="first-run-pro-benefits">
              <header>
                <strong>{t('firstRun.pro.benefitsTitle')}</strong>
                <span>{t('firstRun.pro.kicker')}</span>
              </header>
              <div className="first-run-pro-feature-grid">
                {proFeatureCards.map((feature) => {
                  const FeatureIcon = feature.icon;
                  return (
                    <article className={feature.featured ? 'is-featured' : undefined} key={feature.id}>
                      <span className="first-run-pro-feature-icon"><FeatureIcon size={18} aria-hidden="true" /></span>
                      <div>
                        <strong>{t(feature.titleKey)}</strong>
                        {feature.descriptionKeys.map((key) => <p key={key}>{t(key)}</p>)}
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="first-run-pro-extras">
                <strong>{t('firstRun.pro.extrasTitle')}</strong>
                <ul>
                  <li><CheckCircle2 size={13} aria-hidden="true" />{t('firstRun.pro.benefit.donators')}</li>
                  <li><CheckCircle2 size={13} aria-hidden="true" />{t('firstRun.pro.benefit.storeKey')}</li>
                </ul>
              </div>
            </div>
          </div>
        );
      case 'summary':
        return (
          <div className="first-run-summary-review">
            <div className="first-run-summary-launch-grid">
              <section className="first-run-summary-after">
                <header>
                  <span>{stepNumberLabel}</span>
                  <strong>{t('firstRun.summary.afterTitle')}</strong>
                </header>
                <ol>
                  <li>
                    <span>1</span>
                    <strong>{t('firstRun.summary.after.save')}</strong>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>{t('firstRun.summary.after.scan')}</strong>
                      <small>{scanNow && musicFolderPath ? t('firstRun.summary.scanWithFolder', { mode: scanModeLabel }) : t('firstRun.summary.addLater')}</small>
                    </div>
                  </li>
                  <li className="is-final">
                    <span><ArrowRight size={15} aria-hidden="true" /></span>
                    <strong>{t('firstRun.summary.after.enter')}</strong>
                  </li>
                </ol>
              </section>
              <section className="first-run-summary-configuration">
                <header>
                  <strong>{t('firstRun.summary.configurationTitle')}</strong>
                  <CheckCircle2 size={17} aria-hidden="true" />
                </header>
                <dl>
                  <div>
                    <dt>{t('firstRun.summary.music')}</dt>
                    <dd>{musicFolderPath ?? t('firstRun.summary.addLater')}</dd>
                  </div>
                  <div>
                    <dt>{t('firstRun.summary.output')}</dt>
                    <dd>{outputModeLabel}</dd>
                  </div>
                  <div>
                    <dt>{t('firstRun.summary.theme')}</dt>
                    <dd>{t('firstRun.summary.themeValue', { mode: appearanceThemeLabel, preset: appearancePresetLabel })}</dd>
                  </div>
                  <div>
                    <dt>{t('firstRun.summary.features')}</dt>
                    <dd>{featureSummaryLabel}</dd>
                  </div>
                </dl>
              </section>
            </div>
            <div className="first-run-summary-support">
              <span><CheckCircle2 size={14} />{t('firstRun.summary.noFileMove')}</span>
              <button className="first-run-doc-card" type="button" title={t('firstRun.docs.description')} onClick={openDocumentation}>
                <BookOpen size={16} />
                <strong>{t('firstRun.docs.title')}</strong>
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        );
      default:
        return <div />;
    }
  };

  return (
    <div className="first-run-backdrop first-run-backdrop--immersive" data-state={presentationState} role="dialog" aria-modal="true" aria-labelledby="first-run-title" aria-describedby="first-run-description">
      <section className="first-run-immersive-shell">
        <aside className="first-run-immersive-journey">
          <div className="first-run-journey-brand" aria-label="ECHO Next">
            <strong>ECHO</strong>
            <span>Next</span>
          </div>
          <div className="first-run-journey-copy">
            <h2 id="first-run-title">{t('firstRun.title')}</h2>
            <p id="first-run-description">{t('firstRun.description')}</p>
          </div>
          <div className="first-run-mascot" aria-hidden="true">
            <img src={mascotArtworkUrl} alt="" />
          </div>
          <nav className="first-run-phase-nav" aria-label={t('firstRun.aria.steps')}>
            {firstRunPhases.map((phase, phaseIndex) => {
              const PhaseIcon = phase.icon;
              const isActive = phase.id === activePhase.id;
              const isDone = phaseIndex < activePhaseIndex;
              return (
                <button
                  className={`${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`.trim()}
                  key={phase.id}
                  type="button"
                  aria-current={isActive ? 'step' : undefined}
                  disabled={busy !== null}
                  onClick={() => setActiveStepId(phase.stepIds[0]!)}
                >
                  <span className="first-run-phase-marker">
                    {isDone ? <CheckCircle2 size={17} /> : <PhaseIcon size={16} />}
                  </span>
                  <span className="first-run-phase-copy">
                    <strong>{t(phase.labelKey)}</strong>
                    {phase.subtitleKeys?.length ? <small>{phase.subtitleKeys.map((key) => t(key)).join(' · ')}</small> : null}
                  </span>
                </button>
              );
            })}
          </nav>
          <button className="first-run-journey-docs" type="button" onClick={openDocumentation}>
            <BookOpen size={15} />
            <span>{t('firstRun.docs.action')}</span>
            <ArrowRight size={14} />
          </button>
        </aside>

        <main className="first-run-immersive-workspace">
          <header className="first-run-workspace-header">
            <div>
              <span>{t(activePhase.labelKey)}</span>
              <strong>{activePhaseIndex + 1} / {firstRunPhases.length}</strong>
            </div>
          </header>

          <div className="first-run-substep-slot">
            {activePhase.stepIds.length > 1 ? (
              <nav
                className="first-run-substep-nav"
                aria-label={t('firstRun.aria.steps')}
                style={{ gridTemplateColumns: `repeat(${activePhase.stepIds.length}, minmax(0, 1fr))` }}
              >
                {activePhase.stepIds.map((stepId, index) => {
                  const step = firstRunSteps.find((item) => item.id === stepId)!;
                  const isActive = stepId === activeStep.id;
                  const isDone = index < activeSubStepIndex;
                  return (
                    <button
                      className={`${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`.trim()}
                      key={stepId}
                      type="button"
                      aria-current={isActive ? 'step' : undefined}
                      disabled={busy !== null}
                      onClick={() => setActiveStepId(stepId)}
                    >
                      <span>{isDone ? <CheckCircle2 size={13} /> : index + 1}</span>
                      <strong>{t(step.labelKey)}</strong>
                    </button>
                  );
                })}
              </nav>
            ) : (
              <div className="first-run-substep-single" aria-hidden="true">
                <span>{t(activeStep.labelKey)}</span>
              </div>
            )}
          </div>

          <section className="first-run-immersive-stage" data-step={activeStep.id} key={activeStep.id}>
            <div className="first-run-immersive-stage-heading">
              <div className="first-run-immersive-stage-icon"><ActiveIcon size={22} /></div>
              <div>
                <span>{stepNumberLabel}</span>
                <h3>{activeStepTitle}</h3>
                <p>{activeStepDescription}</p>
              </div>
            </div>
            {activeStep.id !== 'summary' ? (
              <div className="first-run-step-notes" aria-label={t('firstRun.aria.stepNotes')}>
                {activeStepNotes.map((noteKey) => (
                  <span key={noteKey}>
                    <CheckCircle2 size={12} />
                    {t(noteKey)}
                  </span>
                ))}
              </div>
            ) : null}
            {renderStepBody()}
            {error ? <p className="settings-inline-error first-run-workspace-message">{error}</p> : null}
            {message ? <p className="settings-inline-note first-run-workspace-message">{message}</p> : null}
          </section>

          <footer className="first-run-immersive-actions">
            <button className="settings-action-button first-run-skip-button" type="button" disabled={busy !== null} onClick={() => void skip()}>
              {t('firstRun.action.skip')}
            </button>
            <span className="first-run-phase-progress">
              {activePhaseIndex + 1} / {firstRunPhases.length}
              {activePhase.stepIds.length > 1 ? ` · ${activeSubStepIndex + 1} / ${activePhase.stepIds.length}` : ''}
            </span>
            <div className="first-run-action-cluster">
              <button className="settings-action-button" type="button" disabled={busy !== null || activeStepIndex === 0} onClick={goToPreviousStep}>
                <ArrowLeft size={15} />
                {t('firstRun.action.previous')}
              </button>
              {isFinalStep ? (
                <button className="settings-action-button first-run-primary" type="button" disabled={busy !== null} onClick={() => void finish()}>
                  {busy === 'finish' ? <Loader2 className="spinning-icon" size={15} /> : <CheckCircle2 size={15} />}
                  {t('firstRun.action.finish')}
                </button>
              ) : (
                <button className="settings-action-button first-run-primary" type="button" disabled={busy !== null} onClick={goToNextStep}>
                  <span>{t('firstRun.action.next')}</span>
                  <small>{t(nextStep.labelKey)}</small>
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          </footer>
        </main>
      </section>
    </div>
  );
};
