import {
  pluginLibraryTrackFields,
  pluginPanelHostActions,
} from '../../../shared/types/plugins';
import type {
  PluginLibraryTrack,
  PluginLibraryTrackField,
  PluginLibraryTrackPage,
  PluginLibraryTracksQuery,
  PluginPanelBridgeAction,
  PluginPermission,
  PluginSettingsPatch,
  PluginSummary,
} from '../../../shared/types/plugins';

type PluginsBridge = NonNullable<Window['echo']>['plugins'];

type PluginPanelHostBridgeContext = {
  action: PluginPanelBridgeAction;
  payload: unknown;
  plugin: PluginSummary;
  pluginsApi: PluginsBridge;
};

const pluginPanelHostActionSet = new Set<PluginPanelBridgeAction>(pluginPanelHostActions);
const pluginLibraryTrackFieldSet = new Set<PluginLibraryTrackField>(pluginLibraryTrackFields);
const pluginPanelSettingsPatchMaxBytes = 64 * 1024;
const pluginPanelNoticeMaxLength = 300;

const actionPermissions: Partial<Record<PluginPanelBridgeAction, PluginPermission>> = {
  'host:playback:getStatus': 'playback:read',
  'host:playback:play': 'playback:control',
  'host:playback:pause': 'playback:control',
  'host:playback:stop': 'playback:control',
  'host:playback:seek': 'playback:control',
  'host:library:getSummary': 'library:read',
  'host:library:getTracks': 'library:read',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const normalizePositiveInteger = (value: unknown, fallback: number, maximum: number): number => {
  const normalized = Math.floor(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? Math.min(normalized, maximum) : fallback;
};

const normalizeLibraryTracksQuery = (payload: unknown): PluginLibraryTracksQuery => {
  const input = isRecord(payload) ? payload : {};
  const fields = Array.isArray(input.fields)
    ? input.fields.filter((field): field is PluginLibraryTrackField =>
        typeof field === 'string' && pluginLibraryTrackFieldSet.has(field as PluginLibraryTrackField))
    : undefined;

  return {
    page: normalizePositiveInteger(input.page, 1, 10_000),
    pageSize: normalizePositiveInteger(input.pageSize, 50, 200),
    ...(typeof input.search === 'string' && input.search.trim() ? { search: input.search.trim().slice(0, 180) } : {}),
    ...(typeof input.sourceProvider === 'string' && input.sourceProvider.trim()
      ? { sourceProvider: input.sourceProvider.trim() as PluginLibraryTracksQuery['sourceProvider'] }
      : {}),
    ...(fields?.length ? { fields } : {}),
  };
};

const selectTrackFields = (
  track: Record<string, unknown>,
  fields: readonly PluginLibraryTrackField[],
): PluginLibraryTrack => {
  const result: Partial<Record<PluginLibraryTrackField, unknown>> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(track, field)) {
      result[field] = track[field];
    }
  }
  return result as PluginLibraryTrack;
};

const normalizeSettingsPatch = (payload: unknown): PluginSettingsPatch => {
  const input = isRecord(payload) && isRecord(payload.patch) ? payload.patch : payload;
  if (!isRecord(input)) {
    throw new Error('plugin_panel_settings_patch_invalid');
  }

  const patch: PluginSettingsPatch = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = key.trim().slice(0, 120);
    if (
      !normalizedKey ||
      !(
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      )
    ) {
      throw new Error(`plugin_panel_settings_value_invalid:${key}`);
    }
    patch[normalizedKey] = typeof value === 'string' ? value.slice(0, 10_000) : value;
  }

  if (new TextEncoder().encode(JSON.stringify(patch)).byteLength > pluginPanelSettingsPatchMaxBytes) {
    throw new Error('plugin_panel_settings_patch_too_large');
  }
  return patch;
};

const requirePermission = (
  plugin: PluginSummary,
  action: PluginPanelBridgeAction,
): void => {
  const settingsPermission = action === 'host:settings:get'
    ? 'settings:read'
    : action === 'host:settings:set'
      ? 'settings:write'
      : undefined;
  const permission = actionPermissions[action] ?? (plugin.apiVersion === 1 ? settingsPermission : undefined);
  if (permission && !plugin.trustedPermissions.includes(permission)) {
    throw new Error(`plugin_permission_denied:${permission}`);
  }
};

export const isPluginPanelHostAction = (action: PluginPanelBridgeAction): boolean =>
  pluginPanelHostActionSet.has(action);

export const runPluginPanelHostAction = async ({
  action,
  payload,
  plugin,
  pluginsApi,
}: PluginPanelHostBridgeContext): Promise<unknown> => {
  requirePermission(plugin, action);

  const echo = window.echo;
  if (action === 'host:playback:getStatus') {
    if (!echo?.playback?.getStatus) throw new Error('plugin_panel_playback_unavailable');
    return echo.playback.getStatus();
  }
  if (action === 'host:playback:play') {
    if (!echo?.playback?.play) throw new Error('plugin_panel_playback_unavailable');
    return echo.playback.play();
  }
  if (action === 'host:playback:pause') {
    if (!echo?.playback?.pause) throw new Error('plugin_panel_playback_unavailable');
    return echo.playback.pause();
  }
  if (action === 'host:playback:stop') {
    if (!echo?.playback?.stop) throw new Error('plugin_panel_playback_unavailable');
    return echo.playback.stop();
  }
  if (action === 'host:playback:seek') {
    if (!echo?.playback?.seek) throw new Error('plugin_panel_playback_unavailable');
    const positionSeconds = isRecord(payload) ? payload.positionSeconds : payload;
    if (typeof positionSeconds !== 'number' || !Number.isFinite(positionSeconds)) {
      throw new Error('plugin_panel_seek_position_invalid');
    }
    return echo.playback.seek(Math.max(0, positionSeconds));
  }
  if (action === 'host:library:getSummary') {
    if (!echo?.library?.getSummary) throw new Error('plugin_panel_library_unavailable');
    return echo.library.getSummary();
  }
  if (action === 'host:library:getTracks') {
    if (!echo?.library?.getTracks) throw new Error('plugin_panel_library_unavailable');
    const query = normalizeLibraryTracksQuery(payload);
    const { fields, ...libraryQuery } = query;
    const selectedFields = fields?.length ? fields : pluginLibraryTrackFields;
    const page = await echo.library.getTracks(libraryQuery);
    return {
      ...page,
      items: page.items.map((track) => selectTrackFields(track as unknown as Record<string, unknown>, selectedFields)),
    } satisfies PluginLibraryTrackPage;
  }
  if (action === 'host:settings:get') {
    const result = await pluginsApi.getSettings(plugin.id);
    return result.values;
  }
  if (action === 'host:settings:set') {
    const result = await pluginsApi.setSettings(plugin.id, normalizeSettingsPatch(payload));
    window.dispatchEvent(new Event('plugins:changed'));
    return result.values;
  }
  if (action === 'host:ui:notify') {
    const message = isRecord(payload) ? payload.message : payload;
    if (typeof message !== 'string' || !message.trim()) {
      throw new Error('plugin_panel_notification_invalid');
    }
    window.dispatchEvent(new CustomEvent('app:show-chrome-notice', {
      detail: message.trim().slice(0, pluginPanelNoticeMaxLength),
    }));
    return { shown: true };
  }

  throw new Error(`plugin_panel_action_not_supported:${action}`);
};
