import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type {
  PluginCreateExampleKind,
  PluginEnableRequest,
  PluginCoverLookupRequest,
  PluginLyricsLookupRequest,
  PluginMetadataLookupRequest,
  PluginRunCommandRequest,
  PluginSettingsPatch,
  PluginSourcePlaybackRequest,
  PluginSourceSearchRequest,
} from '../../shared/types/plugins';
import { createPrivateFeatureError, getPrivatePluginOperations } from '../plugins/privateEntitlements';
import { requirePrivateFeatureThen } from './entitlementIpcGuards';

const requireText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
};

const exampleKinds = new Set<PluginCreateExampleKind>(['playback-panel', 'command-tool', 'library-script', 'source-provider', 'theme-preset']);

const requirePluginOperations = (): NonNullable<ReturnType<typeof getPrivatePluginOperations>> => {
  const operations = getPrivatePluginOperations();
  if (!operations) {
    throw createPrivateFeatureError('plugins');
  }
  return operations;
};

export const registerPluginIpc = (): void => {
  getPrivatePluginOperations()?.scheduleAutoStart?.();

  ipcMain.handle(IpcChannels.PluginsList, () => getPrivatePluginOperations()?.list() ?? { plugins: [], directory: '' });
  ipcMain.handle(IpcChannels.PluginsListMarket, requirePrivateFeatureThen('plugins', () => requirePluginOperations().listMarket()));
  ipcMain.handle(IpcChannels.PluginsInstallMarket, requirePrivateFeatureThen('plugins', async (_event, pluginId: unknown) =>
    requirePluginOperations().installMarket(requireText(pluginId, 'pluginId')),
  ));
  ipcMain.handle(IpcChannels.PluginsCreateExample, async (_event, kind: unknown) => {
    if (typeof kind !== 'string' || !exampleKinds.has(kind as PluginCreateExampleKind)) {
      throw new Error('unknown_plugin_example_kind');
    }
    return requirePluginOperations().createExample(kind as PluginCreateExampleKind);
  });
  ipcMain.handle(IpcChannels.PluginsEnable, async (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin enable request must be an object');
    }
    return requirePluginOperations().enable(request as PluginEnableRequest);
  });
  ipcMain.handle(IpcChannels.PluginsDisable, (_event, pluginId: unknown) => requirePluginOperations().disable(requireText(pluginId, 'pluginId')));
  ipcMain.handle(IpcChannels.PluginsDelete, (_event, pluginId: unknown) => requirePluginOperations().deletePlugin(requireText(pluginId, 'pluginId')));
  ipcMain.handle(IpcChannels.PluginsReload, async (_event, pluginId: unknown) => {
    const id = requireText(pluginId, 'pluginId');
    return requirePluginOperations().reload(id);
  });
  ipcMain.handle(IpcChannels.PluginsOpenDirectory, (_event, pluginId: unknown) =>
    requirePluginOperations().openDirectory(typeof pluginId === 'string' && pluginId.trim() ? pluginId.trim() : undefined),
  );
  ipcMain.handle(IpcChannels.PluginsExportPackage, requirePrivateFeatureThen('plugins', async (_event, pluginId: unknown) => {
    const id = requireText(pluginId, 'pluginId');
    return requirePluginOperations().exportPackage(id);
  }));
  ipcMain.handle(IpcChannels.PluginsImportPackage, async (_event, sourcePath: unknown) => {
    return requirePluginOperations().importPackage(typeof sourcePath === 'string' && sourcePath.trim() ? sourcePath.trim() : undefined);
  });
  ipcMain.handle(IpcChannels.PluginsRunCommand, async (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin command request must be an object');
    }
    return requirePluginOperations().runCommand(request as PluginRunCommandRequest);
  });
  ipcMain.handle(IpcChannels.PluginsQueryMetadata, async (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin metadata request must be an object');
    }
    return requirePluginOperations().queryMetadata(request as PluginMetadataLookupRequest);
  });
  ipcMain.handle(IpcChannels.PluginsQuerySources, async (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin source search request must be an object');
    }
    return requirePluginOperations().querySources(request as PluginSourceSearchRequest);
  });
  ipcMain.handle(IpcChannels.PluginsResolveSourcePlayback, async (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin source playback request must be an object');
    }
    return requirePluginOperations().resolveSourcePlayback(request as PluginSourcePlaybackRequest);
  });
  ipcMain.handle(IpcChannels.PluginsQueryLyrics, async (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin lyrics request must be an object');
    }
    return requirePluginOperations().queryLyrics(request as PluginLyricsLookupRequest);
  });
  ipcMain.handle(IpcChannels.PluginsQueryCovers, async (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin cover request must be an object');
    }
    return requirePluginOperations().queryCovers(request as PluginCoverLookupRequest);
  });
  ipcMain.handle(IpcChannels.PluginsGetSettings, async (_event, pluginId: unknown) => {
    const id = requireText(pluginId, 'pluginId');
    return requirePluginOperations().getSettings(id);
  });
  ipcMain.handle(IpcChannels.PluginsSetSettings, async (_event, pluginId: unknown, patch: unknown) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('plugin settings patch must be an object');
    }
    return requirePluginOperations().setSettings(requireText(pluginId, 'pluginId'), patch as PluginSettingsPatch);
  });
  ipcMain.handle(IpcChannels.PluginsGetLogs, (_event, pluginId: unknown) =>
    getPrivatePluginOperations()?.getLogs(typeof pluginId === 'string' && pluginId.trim() ? pluginId.trim() : undefined) ?? [],
  );
};
