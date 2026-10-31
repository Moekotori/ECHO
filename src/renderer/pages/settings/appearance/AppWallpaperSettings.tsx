import { useState } from 'react';
import { Crop, FolderOpen, Trash2 } from 'lucide-react';
import type {
  AppSettings,
  AppWallpaperFitMode,
  AppWallpaperMediaType,
} from '../../../../shared/types/appSettings';
import type { TranslationKey } from '../../../i18n/locales';
import {
  ChipButton,
  NumberRangeField,
  SettingRow,
  StatusText,
  ToggleButton,
} from '../components/SettingsPrimitives';
import { WallpaperPositionEditor } from './WallpaperPositionEditor';
import { captureVideoFirstFrame } from '../../../utils/wallpaperVideoFrame';
import {
  appVideoWallpaperPauseModeLabels,
  appVideoWallpaperPauseModes,
  appWallpaperDisplayName,
  appWallpaperEffectPresets,
  appWallpaperFitModeLabels,
  appWallpaperFitModes,
  matchesAppWallpaperEffectPreset,
} from './wallpaperSettingsModel';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type AppWallpaperSettingsProps = {
  highlighted: boolean;
  onChoose: () => void;
  onClear: () => void;
  onPatch: (patch: Partial<AppSettings>) => void;
  onPortraitChoose: () => void;
  onPortraitClear: () => void;
  settings: AppSettings | null;
  t: Translate;
};

/**
 * The app wallpaper has two independent slots: the main picture and the
 * narrow-window (portrait viewport) override. Each carries its own layout mode
 * and framing, so both are rendered through the same slot building blocks.
 */
type WallpaperSlotId = 'app' | 'portrait';

const buildWallpaperUrl = (path: string | null | undefined, slot: WallpaperSlotId): string | null => {
  if (!path) {
    return null;
  }
  return `echo-wallpaper://${slot === 'portrait' ? 'app-portrait' : 'app'}/custom?path=${encodeURIComponent(path)}`;
};

type WallpaperPreviewProps = {
  className: string;
  mediaType: AppWallpaperMediaType | undefined;
  name: string | null;
  url: string | null;
};

const WallpaperPreview = ({ className, mediaType, name, url }: WallpaperPreviewProps): JSX.Element => (
  <div className={className} data-has-image={url ? 'true' : 'false'}>
    {url ? (
      mediaType === 'video' ? (
        <video
          aria-hidden="true"
          className="settings-wallpaper-preview-media"
          muted
          playsInline
          preload="metadata"
          src={url}
        />
      ) : (
        <img alt="" className="settings-wallpaper-preview-img" draggable={false} src={url} />
      )
    ) : (
      <span className="settings-wallpaper-preview-fallback">{name}</span>
    )}
  </div>
);

type WallpaperFitModeRowProps = {
  canEditPosition: boolean;
  fitMode: AppWallpaperFitMode;
  onEditPosition: () => void;
  onSelectMode: (mode: AppWallpaperFitMode) => void;
  t: Translate;
};

const WallpaperFitModeRow = ({
  canEditPosition,
  fitMode,
  onEditPosition,
  onSelectMode,
  t,
}: WallpaperFitModeRowProps): JSX.Element => (
  <div className="settings-wallpaper-effect-row">
    <span>{t('settings.appearance.wallpaper.mode.title')}</span>
    <div className="settings-chip-row settings-chip-row--left">
      {appWallpaperFitModes.map((mode) => (
        <ChipButton active={fitMode === mode} key={mode} onClick={() => onSelectMode(mode)}>
          {t(appWallpaperFitModeLabels[mode])}
        </ChipButton>
      ))}
      <button
        className="settings-action-button"
        disabled={!canEditPosition}
        title={canEditPosition ? undefined : t('settings.appearance.wallpaper.edit.locked')}
        type="button"
        onClick={onEditPosition}
      >
        <Crop size={14} />
        {t('settings.appearance.wallpaper.edit.open')}
      </button>
    </div>
  </div>
);

export const AppWallpaperSettings = ({
  highlighted,
  onChoose,
  onClear,
  onPatch,
  onPortraitChoose,
  onPortraitClear,
  settings,
  t,
}: AppWallpaperSettingsProps): JSX.Element => {
  const [editorState, setEditorState] = useState<{
    slot: WallpaperSlotId;
    image: { url: string; naturalWidth: number; naturalHeight: number };
  } | null>(null);

  const hasWallpaper = Boolean(settings?.appCustomWallpaperPath || settings?.appPortraitWallpaperPath);
  const isVideoWallpaper =
    settings?.appWallpaperMediaType === 'video' || settings?.appPortraitWallpaperMediaType === 'video';
  const fitMode = settings?.appWallpaperFitMode ?? 'fill';
  const portraitFitMode = settings?.appPortraitWallpaperFitMode ?? 'fill';
  // Mirrors the standalone background page: only the 'fit' layout honors the
  // committed framing, so every other mode keeps position editing locked.
  const canEditPosition = Boolean(settings?.appCustomWallpaperPath) && fitMode === 'fit';
  const canEditPortraitPosition = Boolean(settings?.appPortraitWallpaperPath) && portraitFitMode === 'fit';

  const previewUrl = buildWallpaperUrl(settings?.appCustomWallpaperPath, 'app');
  const previewName = settings?.appCustomWallpaperPath
    ? appWallpaperDisplayName(settings.appCustomWallpaperPath)
    : null;
  const portraitPreviewUrl = buildWallpaperUrl(settings?.appPortraitWallpaperPath, 'portrait');
  const portraitPreviewName = settings?.appPortraitWallpaperPath
    ? appWallpaperDisplayName(settings.appPortraitWallpaperPath)
    : null;

  // The editor canvas mirrors the viewport its wallpaper renders in: the main
  // picture is authored against a wide window, the narrow-window override
  // against a portrait one. Deriving both from the current window keeps the
  // preview truthful no matter which orientation the settings are open in.
  const windowAspectRatio = window.innerWidth / window.innerHeight;
  const landscapeAspectRatio = Math.max(windowAspectRatio, 1 / windowAspectRatio);
  const portraitAspectRatio = Math.min(windowAspectRatio, 1 / windowAspectRatio);

  const openEditor = async (slot: WallpaperSlotId): Promise<void> => {
    const url = slot === 'portrait' ? portraitPreviewUrl : previewUrl;
    const mediaType =
      slot === 'portrait' ? settings?.appPortraitWallpaperMediaType : settings?.appWallpaperMediaType;
    if (!url) {
      return;
    }
    if (mediaType === 'video') {
      try {
        const frame = await captureVideoFirstFrame(url);
        if (!frame) {
          return;
        }
        setEditorState({
          slot,
          image: { url: frame.dataUrl, naturalWidth: frame.width, naturalHeight: frame.height },
        });
      } catch {
        return;
      }
    } else {
      setEditorState({ slot, image: { url, naturalWidth: 0, naturalHeight: 0 } });
    }
  };

  const editorSlot = editorState?.slot ?? 'app';
  const editorSavedPosition =
    editorSlot === 'portrait'
      ? settings?.appPortraitWallpaperPosition ?? null
      : settings?.appWallpaperPosition ?? null;
  const editorIsVideo =
    editorSlot === 'portrait'
      ? settings?.appPortraitWallpaperMediaType === 'video'
      : settings?.appWallpaperMediaType === 'video';

  return (
    <>
      <SettingRow
        className="setting-row--full setting-row--compact-panel"
        id="settings-row-wallpaper"
        highlighted={highlighted}
        title={t('settings.appearance.wallpaper.title')}
        description={t('settings.appearance.wallpaper.description')}
      >
        {settings ? (
          <div className="settings-cache-panel settings-cache-panel--app-wallpaper">
            {hasWallpaper ? (
              <>
                {previewUrl ? (
                  <WallpaperPreview
                    className="settings-wallpaper-preview"
                    mediaType={settings.appWallpaperMediaType}
                    name={previewName}
                    url={previewUrl}
                  />
                ) : null}
                {previewName ? (
                  <p className="settings-wallpaper-path" title={settings.appCustomWallpaperPath ?? undefined}>
                    <span>{t('settings.appearance.wallpaper.current')}</span>
                    {previewName}
                  </p>
                ) : null}

                <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                  <button className="settings-action-button" type="button" onClick={onChoose}>
                    <FolderOpen size={15} />
                    {t('settings.appearance.wallpaper.replace')}
                  </button>
                  <button className="settings-danger-button" type="button" onClick={onClear}>
                    <Trash2 size={15} />
                    {t('settings.appearance.wallpaper.clear')}
                  </button>
                </div>

                <WallpaperFitModeRow
                  canEditPosition={canEditPosition}
                  fitMode={fitMode}
                  t={t}
                  onEditPosition={() => void openEditor('app')}
                  onSelectMode={(mode) => {
                    if (fitMode === mode) {
                      return;
                    }
                    // Switching the layout resets the framing so the new fit
                    // mode renders at its native geometry instead of the
                    // previous mode's framing.
                    onPatch({
                      appWallpaperFitMode: mode,
                      appWallpaperPosition: null,
                      appWallpaperScalePercent: 100,
                    });
                  }}
                />

                {settings.appearanceTheme === 'ambient' ? (
                  <StatusText tone="muted">{t('settings.appearance.wallpaper.ambientPaused')}</StatusText>
                ) : settings.lowSpecModeEnabled && isVideoWallpaper ? (
                  <StatusText tone="muted">{t('settings.appearance.wallpaper.lowSpecPaused')}</StatusText>
                ) : null}

                {isVideoWallpaper ? (
                  <div className="settings-wallpaper-effect-row">
                    <StatusText tone="good">{t('settings.appearance.wallpaper.videoStatus')}</StatusText>
                    <div className="settings-chip-row settings-chip-row--left">
                      {appVideoWallpaperPauseModes.map((mode) => (
                        <ChipButton
                          active={(settings.appVideoWallpaperPauseMode ?? 'smart') === mode}
                          key={mode}
                          onClick={() => onPatch({ appVideoWallpaperPauseMode: mode })}
                        >
                          {t(appVideoWallpaperPauseModeLabels[mode])}
                        </ChipButton>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="settings-wallpaper-portrait">
                  <div className="settings-wallpaper-portrait-header">
                    <strong>{t('settings.appearance.wallpaper.portraitOptional')}</strong>
                    <span>
                      {settings.appPortraitWallpaperPath
                        ? appWallpaperDisplayName(settings.appPortraitWallpaperPath)
                        : t('settings.appearance.wallpaper.portraitFallback')}
                    </span>
                  </div>
                  {settings.appPortraitWallpaperPath ? (
                    <>
                      <WallpaperPreview
                        className="settings-wallpaper-preview settings-wallpaper-preview--portrait"
                        mediaType={settings.appPortraitWallpaperMediaType}
                        name={portraitPreviewName}
                        url={portraitPreviewUrl}
                      />
                      <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                        <button className="settings-action-button" type="button" onClick={onPortraitChoose}>
                          <FolderOpen size={15} />
                          {t('settings.appearance.wallpaper.portraitReplace')}
                        </button>
                        <button className="settings-danger-button" type="button" onClick={onPortraitClear}>
                          <Trash2 size={15} />
                          {t('settings.appearance.wallpaper.portraitClear')}
                        </button>
                      </div>
                      <WallpaperFitModeRow
                        canEditPosition={canEditPortraitPosition}
                        fitMode={portraitFitMode}
                        t={t}
                        onEditPosition={() => void openEditor('portrait')}
                        onSelectMode={(mode) => {
                          if (portraitFitMode === mode) {
                            return;
                          }
                          // Only this slot's framing is cleared; the scale
                          // belongs to the shared effect presets.
                          onPatch({
                            appPortraitWallpaperFitMode: mode,
                            appPortraitWallpaperPosition: null,
                          });
                        }}
                      />
                    </>
                  ) : (
                    <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                      <button className="settings-action-button" type="button" onClick={onPortraitChoose}>
                        <FolderOpen size={15} />
                        {t('settings.appearance.wallpaper.portraitChoose')}
                      </button>
                    </div>
                  )}
                </div>

                <div className="settings-wallpaper-controls">
                  <div className="settings-wallpaper-control">
                    <span>{t('settings.appearance.wallpaper.blur')}</span>
                    <NumberRangeField
                      min={0}
                      max={40}
                      step={1}
                      suffix="px"
                      value={settings.appWallpaperBlurPx ?? 0}
                      onChange={(appWallpaperBlurPx) => onPatch({ appWallpaperBlurPx })}
                    />
                  </div>
                  <div className="settings-wallpaper-control">
                    <span>{t('settings.appearance.wallpaper.brightness')}</span>
                    <NumberRangeField
                      min={40}
                      max={140}
                      step={1}
                      suffix="%"
                      value={settings.appWallpaperBrightnessPercent ?? 100}
                      onChange={(appWallpaperBrightnessPercent) => onPatch({ appWallpaperBrightnessPercent })}
                    />
                  </div>
                  <div className="settings-wallpaper-control">
                    <span>{t('settings.appearance.wallpaper.opacity')}</span>
                    <NumberRangeField
                      min={0}
                      max={100}
                      step={1}
                      suffix="%"
                      value={settings.appWallpaperOpacityPercent ?? 100}
                      onChange={(appWallpaperOpacityPercent) => onPatch({ appWallpaperOpacityPercent })}
                    />
                  </div>
                  <div className="settings-wallpaper-control">
                    <span>{t('settings.appearance.wallpaper.uiOpacity')}</span>
                    <NumberRangeField
                      min={0}
                      max={100}
                      step={1}
                      suffix="%"
                      value={settings.appWallpaperUiOpacityPercent ?? 100}
                      onChange={(appWallpaperUiOpacityPercent) => onPatch({ appWallpaperUiOpacityPercent })}
                    />
                  </div>
                  {/* The presets drive the sliders above, so they sit between
                      the sliders and the toggles. */}
                  <div className="settings-wallpaper-effect-row settings-wallpaper-effect-row--full">
                    <span>{t('settings.appearance.wallpaper.effect.title')}</span>
                    <div className="settings-chip-row settings-chip-row--left">
                      {appWallpaperEffectPresets.map((preset) => (
                        <ChipButton
                          active={matchesAppWallpaperEffectPreset(settings, preset.patch)}
                          key={preset.id}
                          onClick={() => onPatch(preset.patch)}
                        >
                          {t(preset.labelKey)}
                        </ChipButton>
                      ))}
                    </div>
                  </div>
                  <div className="settings-wallpaper-control settings-wallpaper-control--toggle">
                    <span>{t('settings.appearance.wallpaper.visualProtection')}</span>
                    <ToggleButton
                      active={settings.appWallpaperVisualProtectionEnabled !== false}
                      onClick={() =>
                        onPatch({
                          appWallpaperVisualProtectionEnabled: !(settings.appWallpaperVisualProtectionEnabled !== false),
                        })
                      }
                    />
                  </div>
                  <div className="settings-wallpaper-control settings-wallpaper-control--toggle">
                    <span>{t('settings.appearance.wallpaper.unifiedOpacity')}</span>
                    <ToggleButton
                      active={settings.appWallpaperUnifiedOpacityEnabled ?? false}
                      onClick={() =>
                        onPatch({
                          appWallpaperUnifiedOpacityEnabled: !(settings.appWallpaperUnifiedOpacityEnabled ?? false),
                        })
                      }
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="settings-wallpaper-empty">
                <div>
                  <strong>{t('settings.appearance.wallpaper.emptyTitle')}</strong>
                  <span>{t('settings.appearance.wallpaper.emptyDescription')}</span>
                </div>
                <button className="settings-action-button" type="button" onClick={onChoose}>
                  <FolderOpen size={15} />
                  {t('settings.appearance.wallpaper.choose')}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </SettingRow>

      {editorState ? (
        <WallpaperPositionEditor
          cancelLabel={t('settings.appearance.wallpaper.editor.cancel')}
          commitLabel={t('settings.appearance.wallpaper.editor.commit')}
          hint={
            editorIsVideo
              ? t('settings.appearance.wallpaper.editor.hintVideo')
              : t('settings.appearance.wallpaper.editor.hint')
          }
          imageUrl={editorState.image.url}
          initialScalePercent={settings?.appWallpaperScalePercent ?? 100}
          naturalHeight={editorState.image.naturalHeight}
          naturalWidth={editorState.image.naturalWidth}
          previewAspectRatio={editorSlot === 'portrait' ? portraitAspectRatio : landscapeAspectRatio}
          resetLabel={t('settings.appearance.wallpaper.editor.reset')}
          saved={editorSavedPosition}
          scaleLabel={t('settings.appearance.wallpaper.scale')}
          title={
            editorSlot === 'portrait'
              ? t('settings.appearance.wallpaper.editor.portraitTitle')
              : t('settings.appearance.wallpaper.editor.title')
          }
          onCancel={() => setEditorState(null)}
          onCommit={(position, scalePercent) => {
            if (editorSlot === 'portrait') {
              onPatch({ appPortraitWallpaperPosition: position });
            } else {
              onPatch({ appWallpaperPosition: position, appWallpaperScalePercent: scalePercent });
            }
            setEditorState(null);
          }}
        />
      ) : null}
    </>
  );
};
