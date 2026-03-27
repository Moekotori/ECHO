import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, basename, dirname, extname } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import fs from 'fs'
import { execFile } from 'child_process'
import DiscordRPC from 'discord-rpc'

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false // allow reading local files easily
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Discord RPC Setup
const DISCORD_CLIENT_ID = '1487118099298779206'
let rpcClient = null
let rpcReady = false
let rpcRetryTimer = null

function initDiscordRPC() {
  // Clean up any old client first
  if (rpcClient) {
    try { rpcClient.destroy() } catch (_) {}
    rpcClient = null
    rpcReady = false
  }

  try {
    rpcClient = new DiscordRPC.Client({ transport: 'ipc' })

    rpcClient.on('ready', () => {
      rpcReady = true
      console.log('[Discord RPC] Connected!')
      // Push initial idle presence
      rpcClient.setActivity({
        details: 'Browsing library',
        state: 'Echoes Studio',
        largeImageKey: 'echoes_logo',
        largeImageText: 'Echoes Studio — Hi-Fi Audio Player',
        instance: false
      }).catch(() => {})
    })

    rpcClient.login({ clientId: DISCORD_CLIENT_ID }).catch((err) => {
      console.log('[Discord RPC] Login failed (Discord may not be running):', err.message)
      rpcReady = false
      // Retry after 15 seconds
      rpcRetryTimer = setTimeout(initDiscordRPC, 15000)
    })
  } catch (e) {
    console.log('[Discord RPC] Init error:', e.message)
    rpcRetryTimer = setTimeout(initDiscordRPC, 15000)
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC: Show open folder dialog
  ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections']
    })
    if (canceled) {
      return []
    } else {
      return filePaths
    }
  })

  // IPC: Show open files dialog
  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'ncm'] }]
    })
    if (canceled) {
      return []
    } else {
      return filePaths.map(f => ({
        name: basename(f),
        path: f
      }))
    }
  })

  // IPC: Read directory contents (recursively or just shallow, let's just do shallow audio files for now)
  ipcMain.handle('file:readDirectory', async (_, dirPath) => {
    try {
      const files = fs.readdirSync(dirPath)
      const audioFiles = files
        .filter(f => {
          const lower = f.toLowerCase()
          return lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.flac') || lower.endsWith('.ogg') || lower.endsWith('.m4a') || lower.endsWith('.aac') || lower.endsWith('.ncm')
        })
        .map(f => ({
          name: f,
          path: join(dirPath, f)
        }))
      return audioFiles
    } catch (e) {
      console.error(e)
      return []
    }
  })

  // IPC: Read file as buffer (for jsmediatags or general binary reading)
  ipcMain.handle('file:readBuffer', async (_, filePath) => {
      try {
        const buffer = fs.readFileSync(filePath)
        return buffer
      } catch(e) {
        return null
      }
  })

  // IPC: Read LRC lyrics file (same directory, same name as audio file)
  ipcMain.handle('file:readLyrics', async (_, audioFilePath) => {
    try {
      const { dirname, basename, join: pathJoin, extname } = await import('path')
      const dir = dirname(audioFilePath)
      const nameWithoutExt = basename(audioFilePath, extname(audioFilePath))
      const lrcPath = pathJoin(dir, `${nameWithoutExt}.lrc`)
      if (fs.existsSync(lrcPath)) {
        const content = fs.readFileSync(lrcPath, 'utf-8')
        return content
      }
      return null
    } catch (e) {
      console.error('readLyrics error:', e)
      return null
    }
  })

  // IPC: Save audio file
  ipcMain.handle('dialog:saveExport', async (_, arrayBuffer, defaultName) => {
      const { canceled, filePath } = await dialog.showSaveDialog({
          title: 'Export Nightcore Audio',
          defaultPath: defaultName || 'export.wav',
          filters: [
              { name: 'Audio File', extensions: ['wav'] }
          ]
      })
      if (!canceled && filePath) {
          fs.writeFileSync(filePath, Buffer.from(arrayBuffer))
          return { success: true, filePath }
      }
      return { success: false }
  })

  // IPC: Close App
  ipcMain.on('window:close', () => {
    app.quit()
  })

  // IPC: Maximize App
  ipcMain.on('window:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    }
  })

  // IPC: Convert NCM to FLAC/MP3
  ipcMain.handle('file:convertNcm', async (_, ncmPath) => {
    return new Promise((resolve) => {
      // exe path is in root
      const exeName = 'NCMconverter.exe'
      // Use process.cwd() in dev, process.resourcesPath in production
      const exePath = is.dev 
        ? join(process.cwd(), exeName)
        : join(process.resourcesPath, exeName)

      if (!fs.existsSync(exePath)) {
        console.error('Converter not found at:', exePath)
        return resolve({ success: false, error: 'Converter not found' })
      }

      execFile(exePath, [ncmPath], (error, stdout, stderr) => {
        if (error) {
          console.error('Conversion error:', error)
          return resolve({ success: false, error: error.message })
        }

        // Try to find the output file (flac or mp3)
        const dir = dirname(ncmPath)
        const nameWithoutExt = basename(ncmPath, extname(ncmPath))
        
        const possibleOutputs = [
          join(dir, `${nameWithoutExt}.flac`),
          join(dir, `${nameWithoutExt}.mp3`)
        ]

        for (const outPath of possibleOutputs) {
          if (fs.existsSync(outPath)) {
            return resolve({ 
              success: true, 
              path: outPath, 
              name: basename(outPath) 
            })
          }
        }

        resolve({ success: false, error: 'Conversion completed but output file not found' })
      })
    })
  })

  // IPC: Get Extended Audio Metadata (Sample rate, bitrate, format, cover)
  ipcMain.handle('file:getExtendedMetadata', async (_, filePath) => {
    try {
      // Use dynamic import for pure-ESM music-metadata in CJS main process
      const { parseFile, selectCover } = await import('music-metadata')
      const metadata = await parseFile(filePath)
      let cover = null
      
      const picture = selectCover(metadata.common.picture)
      if (picture) {
        // picture.format is already a MIME type like 'image/jpeg'
        const mime = picture.format.includes('/') ? picture.format : `image/${picture.format}`
        cover = `data:${mime};base64,${Buffer.from(picture.data).toString('base64')}`
      }

      return {
        success: true,
        technical: {
          sampleRate: metadata.format.sampleRate,
          bitrate: metadata.format.bitrate,
          channels: metadata.format.numberOfChannels,
          codec: metadata.format.container, // e.g., 'FLAC', 'MPEG'
          duration: metadata.format.duration,
          lossless: metadata.format.lossless || metadata.format.container?.toLowerCase() === 'flac' || metadata.format.container?.toLowerCase() === 'wav'
        },
        common: {
          title: metadata.common.title || basename(filePath, extname(filePath)),
          artist: metadata.common.artist || 'Unknown Artist',
          album: metadata.common.album,
          cover: cover
        }
      }
    } catch (e) {
      console.error('getExtendedMetadata error:', e)
      return { success: false, error: e.message }
    }
  })

  // IPC: Update Discord Rich Presence
  ipcMain.on('discord:setActivity', (_, activity) => {
    if (!rpcClient || !rpcReady) return
    try {
      // Use coverUrl if available and valid HTTP/HTTPS URL, else fallback to 'echoes_logo'
      let largeImageKey = 'echoes_logo'
      if (activity.coverUrl && activity.coverUrl.startsWith('http')) {
        largeImageKey = activity.coverUrl
      }

      const rpcPayload = {
        details: activity.title || 'Unknown Track',
        state: activity.artist || 'Echoes Studio',
        largeImageKey: largeImageKey,
        largeImageText: 'Echoes Studio',
        smallImageKey: activity.isPlaying ? 'playing' : 'paused',
        smallImageText: activity.isPlaying ? 'Playing' : 'Paused',
        instance: false,
      }

      if (activity.startTimestamp) rpcPayload.startTimestamp = activity.startTimestamp
      // ensure endTimestamp is strictly a valid number to prevent Discord RPC crashes
      if (activity.endTimestamp && !isNaN(activity.endTimestamp)) {
        rpcPayload.endTimestamp = activity.endTimestamp
      }

      rpcClient.setActivity(rpcPayload).catch(e => {
        console.log('Discord RPC setActivity internal error:', e.message)
      })
    } catch (e) {
      console.log('Discord RPC setActivity error:', e.message)
    }
  })

  // IPC: Clear Discord Presence
  ipcMain.on('discord:clearActivity', () => {
    if (!rpcClient || !rpcReady) return
    try { rpcClient.clearActivity() } catch (e) {}
  })

  createWindow()
  initDiscordRPC()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (rpcRetryTimer) clearTimeout(rpcRetryTimer)
  if (rpcClient) {
    try { rpcClient.destroy() } catch (_) {}
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
