import type { EchoApi } from '../apiTypes';

export function createPluginsApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
  webUtils: Electron.WebUtils,
): EchoApi['plugins'] {
  return {
    list: () => ipcRenderer.invoke(IpcChannels.PluginsList),
    listMarket: () => ipcRenderer.invoke(IpcChannels.PluginsListMarket),
    installMarket: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsInstallMarket, pluginId),
    createExample: (kind) => ipcRenderer.invoke(IpcChannels.PluginsCreateExample, kind),
    enable: (request) => ipcRenderer.invoke(IpcChannels.PluginsEnable, request),
    disable: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsDisable, pluginId),
    delete: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsDelete, pluginId),
    reload: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsReload, pluginId),
    openDirectory: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsOpenDirectory, pluginId),
    exportPackage: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsExportPackage, pluginId),
    importPackage: (source) => {
      if (source === undefined) {
        return ipcRenderer.invoke(IpcChannels.PluginsImportPackage);
      }
      if (typeof source === 'string') {
        return ipcRenderer.invoke(IpcChannels.PluginsImportPackage, source);
      }

      const sourcePath = webUtils?.getPathForFile(source) || '';
      if (!sourcePath) {
        throw new Error('plugin_package_path_unavailable');
      }
      return ipcRenderer.invoke(IpcChannels.PluginsImportPackage, sourcePath);
    },
    runCommand: (request) => ipcRenderer.invoke(IpcChannels.PluginsRunCommand, request),
    queryMetadata: (request) => ipcRenderer.invoke(IpcChannels.PluginsQueryMetadata, request),
    querySources: (request) => ipcRenderer.invoke(IpcChannels.PluginsQuerySources, request),
    resolveSourcePlayback: (request) => ipcRenderer.invoke(IpcChannels.PluginsResolveSourcePlayback, request),
    queryLyrics: (request) => ipcRenderer.invoke(IpcChannels.PluginsQueryLyrics, request),
    queryCovers: (request) => ipcRenderer.invoke(IpcChannels.PluginsQueryCovers, request),
    getSettings: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsGetSettings, pluginId),
    setSettings: (pluginId, patch) => ipcRenderer.invoke(IpcChannels.PluginsSetSettings, pluginId, patch),
    getLogs: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsGetLogs, pluginId),
  };
}
