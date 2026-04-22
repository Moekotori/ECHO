import { app, crashReporter } from 'electron'
import fs from 'fs'
import { join } from 'path'
import os from 'os'

// 崩溃报告目录：优先放在项目根目录（开发时），打包后放在用户数据目录
function getCrashDir() {
  const isDev = !app.isPackaged
  return isDev
    ? join(process.cwd(), 'crash-reports')
    : join(app.getPath('userData'), 'crash-reports')
}

function ensureCrashDir() {
  const dir = getCrashDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function formatTimestamp() {
  const now = new Date()
  return now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
}

function getSystemInfo() {
  return {
    timestamp: new Date().toISOString(),
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    totalMemory: `${Math.round(os.totalmem() / 1024 / 1024)} MB`,
    freeMemory: `${Math.round(os.freemem() / 1024 / 1024)} MB`,
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    pid: process.pid,
    uptime: `${Math.round(process.uptime())}s`
  }
}

function writeCrashReport(type, error, extraContext = {}) {
  try {
    const dir = ensureCrashDir()
    const ts = formatTimestamp()
    const fileName = `crash_${type}_${ts}.log`
    const filePath = join(dir, fileName)

    const report = [
      '='.repeat(60),
      `ECHO CRASH REPORT`,
      '='.repeat(60),
      '',
      `TYPE       : ${type}`,
      `TIMESTAMP  : ${new Date().toISOString()}`,
      '',
      '--- SYSTEM INFO ---',
      ...Object.entries(getSystemInfo()).map(([k, v]) => `  ${k.padEnd(16)}: ${v}`),
      '',
      '--- ERROR ---',
      `  Message  : ${error?.message || String(error)}`,
      `  Name     : ${error?.name || 'Unknown'}`,
      '',
      '--- STACK TRACE ---',
      error?.stack || '  (no stack available)',
      ''
    ]

    if (Object.keys(extraContext).length > 0) {
      report.push('--- CONTEXT ---')
      for (const [k, v] of Object.entries(extraContext)) {
        report.push(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v, null, 2) : v}`)
      }
      report.push('')
    }

    report.push('='.repeat(60))

    fs.writeFileSync(filePath, report.join('\n'), 'utf-8')
    console.error(`[CrashReporter] Report saved: ${filePath}`)
    return filePath
  } catch (e) {
    console.error('[CrashReporter] Failed to write crash report:', e)
  }
}

/**
 * 初始化所有崩溃监听器
 */
export function initCrashReporter(getAudioEngineStatus = null) {
  // 1. Electron 内置 crashReporter（捕获原生 C++ 崩溃/堆溢出）
  try {
    crashReporter.start({
      productName: 'ECHO',
      companyName: 'ECHO',
      submitURL: '', // 不上传，仅本地保存
      uploadToServer: false,
      ignoreSystemCrashHandler: false
    })
    console.log('[CrashReporter] Native crash reporter initialized')
  } catch (e) {
    console.warn('[CrashReporter] Native crashReporter init failed:', e.message)
  }

  // 2. Node.js 未捕获异常 → 写入日志并尝试优雅退出
  process.on('uncaughtException', (error) => {
    const context = {}
    if (getAudioEngineStatus) {
      try {
        context.audioEngineStatus = getAudioEngineStatus()
      } catch (_) {}
    }
    writeCrashReport('UncaughtException', error, context)
    // 给文件系统时间写入
    setTimeout(() => process.exit(1), 500)
  })

  // 3. 未处理的 Promise rejection
  process.on('unhandledRejection', (reason, promise) => {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    writeCrashReport('UnhandledRejection', error, {
      promise: String(promise)
    })
    // Rejection 不强制退出，但记录日志
  })

  // 4. 渲染进程崩溃（如 WebGL/JS 崩溃）
  app.on('render-process-gone', (event, webContents, details) => {
    writeCrashReport('RendererCrash', new Error(`Renderer gone: ${details.reason}`), {
      exitCode: details.exitCode,
      reason: details.reason,
      url: webContents.getURL()
    })
  })

  // 5. GPU 进程崩溃
  app.on('gpu-process-crashed', (event, killed) => {
    writeCrashReport('GPUCrash', new Error(`GPU process crashed (killed: ${killed})`))
  })

  console.log(`[CrashReporter] All handlers registered. Reports → ${getCrashDir()}`)
}

/**
 * 手动记录一次错误（不崩溃，仅记录）
 */
export function logError(label, error, context = {}) {
  writeCrashReport(`ManualLog_${label}`, error, context)
}

export { getCrashDir }
