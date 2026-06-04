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
import { getPluginService } from '../plugins/PluginService';

const requireText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
};

const exampleKinds = new Set<PluginCreateExampleKind>(['playback-panel', 'command-tool', 'library-script', 'source-provider', 'theme-preset']);

export const registerPluginIpc = (): void => {
  const service = getPluginService();
  service.scheduleAutoStart();

  ipcMain.handle(IpcChannels.PluginsList, () => service.list());
  ipcMain.handle(IpcChannels.PluginsCreateExample, (_event, kind: unknown) => {
    if (typeof kind !== 'string' || !exampleKinds.has(kind as PluginCreateExampleKind)) {
      throw new Error('unknown_plugin_example_kind');
    }
    return service.createExample(kind as PluginCreateExampleKind);
  });
  ipcMain.handle(IpcChannels.PluginsEnable, (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin enable request must be an object');
    }
    return service.enable(request as PluginEnableRequest);
  });
  ipcMain.handle(IpcChannels.PluginsDisable, (_event, pluginId: unknown) => service.disable(requireText(pluginId, 'pluginId')));
  ipcMain.handle(IpcChannels.PluginsReload, (_event, pluginId: unknown) => service.reload(requireText(pluginId, 'pluginId')));
  ipcMain.handle(IpcChannels.PluginsOpenDirectory, (_event, pluginId: unknown) =>
    service.openDirectory(typeof pluginId === 'string' && pluginId.trim() ? pluginId.trim() : undefined),
  );
  ipcMain.handle(IpcChannels.PluginsExportPackage, (_event, pluginId: unknown) => service.exportPluginPackage(requireText(pluginId, 'pluginId')));
  ipcMain.handle(IpcChannels.PluginsImportPackage, () => service.importPluginPackage());
  ipcMain.handle(IpcChannels.PluginsRunCommand, (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin command request must be an object');
    }
    return service.runCommand(request as PluginRunCommandRequest);
  });
  ipcMain.handle(IpcChannels.PluginsQueryMetadata, (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin metadata request must be an object');
    }
    return service.queryMetadata(request as PluginMetadataLookupRequest);
  });
  ipcMain.handle(IpcChannels.PluginsQuerySources, (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin source search request must be an object');
    }
    return service.querySources(request as PluginSourceSearchRequest);
  });
  ipcMain.handle(IpcChannels.PluginsResolveSourcePlayback, (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin source playback request must be an object');
    }
    return service.resolveSourcePlayback(request as PluginSourcePlaybackRequest);
  });
  ipcMain.handle(IpcChannels.PluginsQueryLyrics, (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin lyrics request must be an object');
    }
    return service.queryLyrics(request as PluginLyricsLookupRequest);
  });
  ipcMain.handle(IpcChannels.PluginsQueryCovers, (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('plugin cover request must be an object');
    }
    return service.queryCovers(request as PluginCoverLookupRequest);
  });
  ipcMain.handle(IpcChannels.PluginsGetSettings, (_event, pluginId: unknown) => service.getPluginSettings(requireText(pluginId, 'pluginId')));
  ipcMain.handle(IpcChannels.PluginsSetSettings, (_event, pluginId: unknown, patch: unknown) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('plugin settings patch must be an object');
    }
    return service.updatePluginSettings(requireText(pluginId, 'pluginId'), patch as PluginSettingsPatch);
  });
  ipcMain.handle(IpcChannels.PluginsGetLogs, (_event, pluginId: unknown) =>
    service.getLogs(typeof pluginId === 'string' && pluginId.trim() ? pluginId.trim() : undefined),
  );
};
