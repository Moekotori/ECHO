import { spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'

/**
 * VstBridge: 负责将 VST 黑盒程序无缝插入到现有的音频管道中
 * 管道走向: FFmpeg (解码后的 PCM) -> VstBridge.stdin -> VstBridge.stdout -> echo-audio-host.stdin
 */
export class VstBridge {
  constructor() {
    this.vstProcess = null
    this.enabled = false
    this.currentPluginPath = null

    // 预期的自定义 C++ 原生程序的路径 (我们会把它编译到 build/ 文件夹里)
    const isDev = !app.isPackaged
    const resourcesPath = isDev
      ? join(app.getAppPath(), 'electron-app', 'build')
      : process.resourcesPath

    this.vstHostExe = join(
      resourcesPath,
      process.platform === 'win32' ? 'vst-worker.exe' : 'vst-worker'
    )
  }

  /**
   * 启动 VST 处理流
   * @param {import('stream').Readable} sourceStream - 来自 FFmpeg 的 PCM 音频流
   * @param {import('stream').Writable} destStream   - 指向 echo-audio-host 的输入流
   * @param {number} sampleRate - 采样率，默认 44100
   */
  pipe(sourceStream, destStream, sampleRate = 44100) {
    if (!this.enabled || !this.currentPluginPath || !existsSync(this.vstHostExe)) {
      console.log('[VstBridge] VST 未启用或找不到宿主程序，音频直通...')
      // 直通：不管它，直接把声音交给喇叭
      sourceStream.pipe(destStream)
      return
    }

    console.log(`[VstBridge] 正在挂载 VST 插件: ${this.currentPluginPath}`)

    // 启动现成的 VST 黑盒程序
    // (这里的参数取决于你最终下载的那个开源黑盒的文档)
    this.vstProcess = spawn(
      this.vstHostExe,
      [
        '--plugin',
        this.currentPluginPath,
        '--sample-rate',
        sampleRate.toString(),
        '--channels',
        '2',
        '--raw-pcm' // 告诉黑盒我们用裸的 PCM 数据流
      ],
      {
        // 关键：把标准输出和输入暴露出来，错误输出打印到主进程
        stdio: ['pipe', 'pipe', 'inherit']
      }
    )

    // 1. 把 FFmpeg 解码的声音“喂”给 VST 黑盒
    sourceStream.pipe(this.vstProcess.stdin)

    // 2. 把 VST 黑盒吐出来的声音“喂”给喇叭 (echo-audio-host)
    this.vstProcess.stdout.pipe(destStream)

    this.vstProcess.on('exit', (code) => {
      console.log(`[VstBridge] VST 黑盒已退出，状态码: ${code}`)
      this.vstProcess = null
    })

    this.vstProcess.on('error', (err) => {
      console.error('[VstBridge] 启动 VST 黑盒失败:', err)
    })
  }

  /**
   * 让用户选择或加载一个 VST 插件
   * @param {string} pluginPath - .vst3 文件的物理路径
   */
  loadPlugin(pluginPath) {
    this.currentPluginPath = pluginPath
    this.enabled = true
  }

  /**
   * 关闭 VST (通常需要重新创建播放流)
   */
  disable() {
    this.enabled = false
    this.currentPluginPath = null
    if (this.vstProcess) {
      this.vstProcess.kill()
      this.vstProcess = null
    }
  }

  /**
   * 唤出插件的原生界面（如果黑盒支持的话）
   */
  showPluginUI() {
    if (this.vstProcess) {
      // 通过进程间通信（比如发个信号）让黑盒弹窗
      // 这里可以是一个简单的 stdin 指令，如 this.vstProcess.stdin.write('SHOW_GUI\n')
    }
  }
}
