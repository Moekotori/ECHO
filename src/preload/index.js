import { contextBridge, ipcRenderer } from 'electron'

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled in the BrowserWindow')
}

// Expose IPC methods to the renderer via window.api
contextBridge.exposeInMainWorld('api', {
  openDirectoryHandler: () => ipcRenderer.invoke('dialog:openDirectory'),
  readDirectoryHandler: (path) => ipcRenderer.invoke('file:readDirectory', path),
  readBufferHandler: (path) => ipcRenderer.invoke('file:readBuffer', path),
  saveExportHandler: (arrayBuffer, defaultName) => ipcRenderer.invoke('dialog:saveExport', arrayBuffer, defaultName),
  openFileHandler: () => ipcRenderer.invoke('dialog:openFile'),
  readLyricsHandler: (audioPath) => ipcRenderer.invoke('file:readLyrics', audioPath),
  convertNcmHandler: (filePath) => ipcRenderer.invoke('file:convertNcm', filePath),
  closeAppHandler: () => ipcRenderer.send('window:close'),
  maximizeAppHandler: () => ipcRenderer.send('window:maximize'),
  getExtendedMetadataHandler: (path) => ipcRenderer.invoke('file:getExtendedMetadata', path),
  setDiscordActivity: (activity) => ipcRenderer.send('discord:setActivity', activity),
  clearDiscordActivity: () => ipcRenderer.send('discord:clearActivity')
})
