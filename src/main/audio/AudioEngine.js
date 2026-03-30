import { getDevices, AudioIO, SampleFormatFloat32 } from "naudiodon";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { Transform } from "stream";

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

/** DLNA/SOAP 里 URL 常带 &amp;，必须还原否则 FFmpeg 请求错误地址 */
function normalizeStreamUri(uri) {
  if (!uri || typeof uri !== "string") return uri;
  let s = uri.trim();
  if (!/^https?:\/\//i.test(s)) return s;
  return s.replace(/&amp;/gi, "&");
}

const NETEASE_UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 NeteaseMusic/9.0.0";
const NETEASE_HEADERS =
  "Referer: https://music.163.com/\r\nOrigin: https://music.163.com\r\n";

function isNeteaseStreamUrl(uri) {
  return /music\.163\.com|126\.net|netease|interface\.music\.163/i.test(uri);
}

/**
 * 核心音频处理器：负责缓冲区对齐、音量控制和进度计算
 */
class AudioProcessor extends Transform {
  constructor(options) {
    super(options);
    this.engine = options.engine;
    this.targetSampleRate = options.targetSampleRate;
    this.channels = options.channels;
    this.playbackRate = options.playbackRate;
    this.startTime = options.startTime;
    this.bytesWritten = 0;
  }

  _transform(chunk, encoding, callback) {
    if (!this.engine.isPlaying) return callback();

    // ====== [ROOT CAUSE FIX] Buffer 内存池污染修复 ======
    // 问题: Buffer.alloc 从 Node.js 共享内存池分配
    //       alignedBuffer.buffer 是整个池的 ArrayBuffer（可能是 8KB 甚至更大）
    //       new Float32Array(alignedBuffer.buffer) 会对整个池做 Float32 操作
    //       → 污染其他 Buffer 的数据 → naudiodon C++ fillBuffer 读到错误内存 → 崩溃
    // 修复: 使用独立的 new ArrayBuffer(n)，byteOffset 保证为 0
    const ab = new ArrayBuffer(chunk.byteLength);

    // 正确读取 chunk 数据（考虑 chunk 自身的 byteOffset）
    const srcFloat32 = new Float32Array(
      chunk.buffer,
      chunk.byteOffset,
      chunk.byteLength / 4,
    );
    const dstFloat32 = new Float32Array(ab);
    dstFloat32.set(srcFloat32); // 安全拷贝到独立内存

    // 应用音量增益（在独立内存上操作，不影响任何外部数据）
    const vol = this.engine.volume;
    for (let i = 0; i < dstFloat32.length; i++) {
      dstFloat32[i] *= vol;
    }

    // 推送：Buffer.from(ab) 的 byteOffset = 0，naudiodon C++ 层安全读取
    // [SAFETY CHECK] 确保输出流仍然有效且可写
    if (this.engine.audioOutput && this.engine.isPlaying) {
      this.push(Buffer.from(ab));
    }

    this.bytesWritten += chunk.byteLength;
    const secondsProcessed =
      (this.bytesWritten / (this.targetSampleRate * this.channels * 4)) *
      this.playbackRate;
    this.engine.playbackTime = Math.max(0, this.startTime + secondsProcessed);

    callback();
  }
}

export class AudioEngine {
  constructor() {
    this.audioOutput = null;
    this.activeDevice = null;
    this.isPlaying = false;
    this.ffmpegProcess = null;
    this.playbackTime = 0;
    this.volume = 1.0;
    this.playbackRate = 1.0;
    this.currentFilePath = null;
    this.processor = null;
  }

  getMediaInfo(uri) {
    return this._getFileInfo(uri);
  }

  getDevices() {
    try {
      const devices = getDevices();
      return devices
        .filter((d) => d.maxOutputChannels > 0)
        .map((d) => ({
          id: d.id,
          name: d.name,
          hostApi: d.hostApi,
          sampleRate: d.defaultSampleRate || 44100,
          maxChannels: d.maxOutputChannels,
        }));
    } catch (e) {
      return [];
    }
  }

  async setDevice(deviceId) {
    const devices = getDevices();
    const device = devices.find((d) => d.id === deviceId);
    if (device) {
      this.activeDevice = device;
      console.log(`[AudioEngine] Active device set: ${device.name}`);
      return { success: true, device: this.activeDevice };
    }
    return { success: false, error: "Device not found" };
  }

  async play(filePath, startTime = 0, playbackRate = 1.0) {
    // [STABILITY IMPROVEMENT] 不再直接丢弃请求，而是等待之前的操作完成
    // 这样可以确保快速操作时的最后一次请求一定会被执行
    while (this._playLocked) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    this._playLocked = true;

    try {
      await this._releaseResources();

      if (/^https?:\/\//i.test(filePath)) {
        filePath = normalizeStreamUri(filePath);
      }
      this.currentFilePath = filePath;
      this.playbackRate = playbackRate;
      this.playbackTime = startTime;

      const info = await this._getFileInfo(filePath);
      const fileSampleRate = info.sampleRate || 44100;
      const channels = Math.max(1, Math.min(2, info.channels || 2));
      const targetSampleRate =
        this.activeDevice && this.activeDevice.sampleRate > 0
          ? this.activeDevice.sampleRate
          : 44100;

      console.log(
        `[AudioEngine] Play: ${filePath} | src=${fileSampleRate}Hz → out=${targetSampleRate}Hz | rate=${playbackRate}`,
      );

      try {
        this.audioOutput = new AudioIO({
          outOptions: {
            channelCount: channels,
            sampleFormat: SampleFormatFloat32,
            sampleRate: targetSampleRate,
            deviceId: this.activeDevice ? this.activeDevice.id : -1,
            closeOnError: false,
          },
        });
      } catch (e) {
        console.error("[AudioEngine] PortAudio Error:", e.message);
        return { success: false, error: e.message };
      }

      // [96kHz FIX] 三段式滤镜链
      // Step 1: 将源文件（任意采样率）干净地重采样到目标设备采样率
      // Step 2: 在目标率上用 asetrate 做 Nightcore 变速变调（避免对高采样率直接操作）
      // Step 3: 将 asetrate 改变的采样率显式拉回 targetSampleRate 作为输出
      const filters = [];
      if (playbackRate !== 1.0) {
        const ncSampleRateOnTarget = Math.round(
          targetSampleRate * playbackRate,
        );
        filters.push(`aresample=${targetSampleRate}`); // Step 1: 纯净降采样
        filters.push(`asetrate=${ncSampleRateOnTarget}`); // Step 2: Nightcore 变调
        filters.push(`aresample=${targetSampleRate}`); // Step 3: 回到输出率
      } else if (fileSampleRate !== targetSampleRate) {
        filters.push(`aresample=${targetSampleRate}`); // 仅需重采样（如 96kHz→44.1kHz）
      }

      this.processor = new AudioProcessor({
        engine: this,
        targetSampleRate,
        channels,
        playbackRate,
        startTime,
      });

      this.ffmpegProcess = ffmpeg(filePath)
        .seekInput(startTime)
        .format("f32le")
        .audioChannels(channels)
        .audioFrequency(targetSampleRate);

      if (/^https?:\/\//i.test(filePath)) {
        const opts = [];
        if (isNeteaseStreamUrl(filePath)) {
          opts.push("-user_agent", NETEASE_UA, "-headers", NETEASE_HEADERS);
        } else {
          opts.push("-user_agent", "EchoesStudio/1.0");
        }
        // 勿使用 -tls_verify：多数 ffmpeg-static 未编译该选项；http:// 流也不需要 TLS
        this.ffmpegProcess.inputOptions(opts);
      }

      if (filters.length > 0) {
        this.ffmpegProcess.audioFilters(filters);
      }

      this.ffmpegProcess.on("error", (err) => {
        if (!err.message.includes("SIGKILL"))
          console.error("[FFmpeg] Error:", err.message);
      });

      this.ffmpegProcess.pipe(this.processor);
      this.processor.pipe(this.audioOutput);

      this.audioOutput.start();
      this.isPlaying = true;

      return { success: true };
    } finally {
      this._playLocked = false;
    }
  }

  setVolume(vol) {
    this.volume = vol;
  }

  getVolume() {
    return this.volume;
  }

  async setPlaybackRate(rate) {
    if (this.currentFilePath && Math.abs(this.playbackRate - rate) > 0.01) {
      return this.play(this.currentFilePath, this.playbackTime, rate);
    }
  }

  // 这里的 pause 不再只是暂停流，而是停止资源，这是保证独占模式下稳定性的关键
  async pause() {
    if (this.isPlaying) {
      console.log(`[AudioEngine] Pausing at ${this.playbackTime}`);
      this.isPlaying = false;
      await this._releaseResources();
    }
  }

  resume() {
    if (!this.isPlaying && this.currentFilePath) {
      console.log(`[AudioEngine] Resuming from ${this.playbackTime}`);
      this.play(this.currentFilePath, this.playbackTime, this.playbackRate);
    }
  }

  async stop() {
    this.isPlaying = false;
    await this._releaseResources();
    this.currentFilePath = null;
    this.playbackTime = 0;
  }

  /**
   * 资源回收：安全停止背景进程和音频通道
   * 采用严格的异步序列：Unpipe -> Kill FFmpeg -> Wait -> Stop AudioIO
   */
  async _releaseResources() {
    // 1. 立即停止管道传输
    if (this.processor) {
      try {
        if (this.audioOutput) this.processor.unpipe(this.audioOutput);
        this.processor.destroy();
      } catch (_) {}
      this.processor = null;
    }

    // 2. 杀掉解码进程
    if (this.ffmpegProcess) {
      try {
        this.ffmpegProcess.kill("SIGKILL");
      } catch (_) {}
      this.ffmpegProcess = null;
    }

    // 3. 给 PortAudio 线程一个短暂的缓冲时间来刷新最后的缓冲区
    // 这是解决 N-API status 10 (invalid arg) 的关键，防止在写入中途强制关闭句柄
    // 3. 给 PortAudio 线程一个短暂的缓冲时间来刷新最后的缓冲区
    // 这是解决 N-API status 10 (invalid arg) 的关键，防止在写入中途强制关闭句柄
    if (this.audioOutput) {
      const ao = this.audioOutput;
      this.audioOutput = null; // 先解除引用防止新数据进入

      // 先 unpipe 确保没有新数据流向 ao
      if (this.processor) {
        try {
          this.processor.unpipe(ao);
        } catch (_) {}
      }

      await new Promise((resolve) => setTimeout(resolve, 50)); // 短暂等待确保最后的数据写入正在处理中

      try {
        console.log("[AudioEngine] Quitting AudioIO...");
        // naudiodon 的正确释放方法是 .quit()，它是异步并返回 promise 的
        await ao.quit();
        console.log("[AudioEngine] AudioIO quit successfully.");
      } catch (e) {
        console.warn(`[AudioEngine] AudioIO quit failed/ignored: ${e.message}`);
      }
    }
  }

  getStatus() {
    return {
      isPlaying: this.isPlaying,
      currentTime: this.playbackTime,
      filePath: this.currentFilePath,
      playbackRate: this.playbackRate,
    };
  }

  _getFileInfo(filePath) {
    const uri = /^https?:\/\//i.test(filePath)
      ? normalizeStreamUri(filePath)
      : filePath;
    return new Promise((resolve) => {
      const netease = isNeteaseStreamUrl(uri);
      const probeOpts = netease
        ? ["-user_agent", NETEASE_UA, "-headers", NETEASE_HEADERS]
        : [];
      const cb = (err, metadata) => {
        if (err || !metadata || !metadata.streams) {
          resolve({ sampleRate: 44100, channels: 2 });
          return;
        }
        const stream = metadata.streams.find((s) => s.codec_type === "audio");
        resolve({
          sampleRate: stream ? parseInt(stream.sample_rate) : 44100,
          channels: stream ? stream.channels || 2 : 2,
        });
      };
      if (probeOpts.length) ffmpeg.ffprobe(uri, probeOpts, cb);
      else ffmpeg.ffprobe(uri, cb);
    });
  }
}

export const audioEngine = new AudioEngine();
