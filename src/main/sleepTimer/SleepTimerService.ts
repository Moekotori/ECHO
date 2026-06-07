import { app, BrowserWindow } from 'electron';
import { getAudioSession } from '../audio/AudioSession';
import { noteDataProtectionPlaybackActivity } from '../app/dataProtection';
import { syncSmtcStatus } from '../integrations/smtc/SmtcStatusSync';
import { savePlaybackMemoryNow } from '../ipc/playbackIpc';
import type { SleepTimerAction, SleepTimerStatus, SleepTimerStartRequest } from '../../shared/types/sleepTimer';

/** 睡眠定时器日志前缀 */
const LOG_PREFIX = '[SleepTimer]';

/** 睡眠定时器核心服务（单例） */
class SleepTimerService {
  /** 倒计时 interval 句柄 */
  private intervalId: ReturnType<typeof setInterval> | null = null;

  /** 倒计时开始时间戳 */
  private startTimeMs = 0;

  /** 总时长（毫秒） */
  private totalDurationMs = 0;

  /** 当前到期动作 */
  private action: SleepTimerAction = 'pause';

  /** 是否启用淡出 */
  private fadeOutEnabled = false;

  /** 设定时长（分钟） */
  private durationMinutes = 0;

  /** 每秒 tick 回调集合 */
  private readonly tickCallbacks = new Set<(remainingMs: number) => void>();

  /** 完成回调集合 */
  private readonly completeCallbacks = new Set<() => void>();

  /** 状态变更回调集合 */
  private readonly changeCallbacks = new Set<(status: SleepTimerStatus) => void>();

  /** 启动倒计时，如果已有运行中的定时器则覆盖 */
  start(request: SleepTimerStartRequest): void {
    // 校验时长
    if (!Number.isFinite(request.durationMinutes) || request.durationMinutes <= 0) {
      throw new Error('durationMinutes must be a positive finite number');
    }

    // 如果已有定时器在运行，先清理
    this.clearInterval();

    this.durationMinutes = request.durationMinutes;
    this.action = request.action;
    this.fadeOutEnabled = request.fadeOut;
    this.totalDurationMs = request.durationMinutes * 60 * 1000;
    this.startTimeMs = Date.now();

    console.log(`${LOG_PREFIX} Started: ${request.durationMinutes}min, action=${request.action}, fadeOut=${request.fadeOut}`);

    // 启动每秒 tick
    this.intervalId = setInterval(() => {
      this.tick();
    }, 1000);

    // 立即触发一次 onChange
    this.emitChange();

    // 立即触发一次 tick 回调
    const remainingMs = this.getRemainingMs();
    this.emitTick(remainingMs);
  }

  /** 取消定时器，清理所有 interval 和状态 */
  cancel(): void {
    console.log(`${LOG_PREFIX} Cancelled`);
    this.clearInterval();
    this.resetState();
    this.emitChange();
  }

  /** 返回当前状态 */
  getStatus(): SleepTimerStatus {
    return {
      isActive: this.intervalId !== null,
      remainingMs: this.getRemainingMs(),
      action: this.action,
      fadeOutEnabled: this.fadeOutEnabled,
      durationMinutes: this.durationMinutes,
    };
  }

  /** 注册每秒回调，返回取消函数 */
  onTick(callback: (remainingMs: number) => void): () => void {
    this.tickCallbacks.add(callback);
    return () => {
      this.tickCallbacks.delete(callback);
    };
  }

  /** 注册完成回调，返回取消函数 */
  onComplete(callback: () => void): () => void {
    this.completeCallbacks.add(callback);
    return () => {
      this.completeCallbacks.delete(callback);
    };
  }

  /** 注册状态变更回调，返回取消函数 */
  onChange(callback: (status: SleepTimerStatus) => void): () => void {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  /** 完全清理（应用退出时调用） */
  dispose(): void {
    this.clearInterval();
    this.resetState();
    this.tickCallbacks.clear();
    this.completeCallbacks.clear();
    this.changeCallbacks.clear();
  }

  // ---- 内部方法 ----

  /** 每秒 tick 处理 */
  private tick(): void {
    const remainingMs = this.getRemainingMs();

    if (remainingMs <= 0) {
      console.log(`${LOG_PREFIX} Timer expired (0s remaining), executing action...`);
      // 倒计时结束，先通知渲染进程剩余时间为 0
      this.emitTick(0);
      this.executeAction();
      this.clearInterval();
      this.resetState();
      this.emitComplete();
      this.emitChange();
      return;
    }

    this.emitTick(remainingMs);
    this.emitChange();
  }

  /** 根据动作执行对应操作（支持渐弱） */
  private executeAction(): void {
    const action = this.action;
    console.log(`${LOG_PREFIX} Timer expired, executing action: ${action}, fadeOut: ${this.fadeOutEnabled}`);

    if (action === 'pause') {
      // 策略：优先通过渲染进程执行（与点击暂停按钮同一路径）
      // 回退：直接调用主进程 AudioSession
      this.pauseViaRenderer().then(() => {
        console.log(`${LOG_PREFIX} Renderer pause resolved`);
      }).catch((err) => {
        console.warn(`${LOG_PREFIX} Renderer pause failed, falling back to direct AudioSession:`, err);
        this.doPause();
      });
    } else if (this.fadeOutEnabled) {
      // 渐弱模式：先通过渲染进程暂停，完成后再执行最终动作
      this.pauseViaRenderer().then(() => {
        console.log(`${LOG_PREFIX} Fade-out pause completed via renderer, executing final action: ${action}`);
        this.executeFinalAction(action);
      }).catch((err) => {
        console.warn(`${LOG_PREFIX} Renderer fade-out pause failed, trying direct then final action:`, err);
        this.doPause().finally(() => this.executeFinalAction(action));
      });
    } else {
      this.executeFinalAction(action);
    }
  }

  /**
   * 通过渲染进程触发暂停（多策略回退）
   *
   * 策略优先级：
   *   1. window.echo.audio.pause() — IPC 标准路径
   *   2. 点击播放栏暂停按钮 — DOM 模拟用户操作
   *   3. getAudioSession().pause() — 主进程直接调用
   */
  private pauseViaRenderer(): Promise<void> {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) {
      console.warn(`${LOG_PREFIX} No available BrowserWindow, falling back to direct pause`);
      return this.doPause();
    }

    console.log(`${LOG_PREFIX} Attempting pause via renderer (strategy: echo.audio.pause)`);

    // 策略 1: 标准 API 调用
    return win.webContents.executeJavaScript('window.echo.audio.pause()')
      .then(() => {
        console.log(`${LOG_PREFIX} Strategy 1 (echo.audio.pause): success`);
      })
      .catch((err1) => {
        console.warn(`${LOG_PREFIX} Strategy 1 failed:`, err1?.message || err1);

        // 策略 2: DOM 模拟点击暂停按钮
        console.log(`${LOG_PREFIX} Trying strategy 2: DOM button click`);
        return win.webContents.executeJavaScript(`
          (() => {
            // 查找播放栏中的暂停按钮（通常有 data-action="pause" 或特定 class）
            const btn = document.querySelector('[data-action="pause"]')
              || document.querySelector('.transport-btn-pause')
              || document.querySelector('button[aria-label*="pause" i]')
              || document.querySelector('button[title*="pause" i]');
            if (btn) { btn.click(); return 'clicked'; }
            // 如果找不到暂停按钮，尝试查找当前播放/暂停切换按钮
            const toggleBtn = document.querySelector('[data-action="toggle-playback"]')
              || document.querySelector('.play-pause-btn');
            if (toggleBtn) { toggleBtn.click(); return 'clicked-toggle'; }
            return 'no-button-found';
          })()
        `).then((result: string) => {
          console.log(`${LOG_PREFIX} Strategy 2 (DOM click): ${result}`);
          if (result === 'no-button-found') {
            throw new Error('No pause button found in DOM');
          }
        }).catch((err2) => {
          console.warn(`${LOG_PREFIX} Strategy 2 failed:`, err2?.message || err2);

          // 策略 3: 回退到主进程直接调用
          console.log(`${LOG_PREFIX} Trying strategy 3: direct AudioSession.pause()`);
          return this.doPause();
        });
      });
  }

  /**
   * 直接调用播放控制管线暂停音频
   * 与 playback:pause IPC handler 走同一条路径：
   *   数据保护标记 → AudioSession.pause() → 保存播放记忆 → SMTC 同步
   */
  private async doPause(): Promise<void> {
    const session = getAudioSession();
    const beforeState = session.getStatus().state;
    console.log(`${LOG_PREFIX} doPause: audioState before="${beforeState}"`);

    // 标记数据保护活动停止
    try {
      noteDataProtectionPlaybackActivity(false);
    } catch (err) {
      console.warn(`${LOG_PREFIX} noteDataProtectionPlaybackActivity failed:`, err);
    }

    // 执行暂停
    const status = await session.pause();
    console.log(`${LOG_PREFIX} doPause: audioSession.pause() resolved, newState="${status.state}"`);

    // 保存播放记忆（恢复位置等）
    try {
      savePlaybackMemoryNow();
    } catch (err) {
      console.warn(`${LOG_PREFIX} savePlaybackMemoryNow failed:`, err);
    }

    // 同步系统媒体传输控制（Windows 音量混合器等）
    try {
      syncSmtcStatus();
    } catch (err) {
      console.warn(`${LOG_PREFIX} syncSmtcStatus failed:`, err);
    }

    console.log(`${LOG_PREFIX} doPause: complete`);
  }

  /**
   * 直接调用播放控制管线停止音频
   * 与 playback:stop IPC handler 同路径
   */
  private doStop(): void {
    const session = getAudioSession();
    console.log(`${LOG_PREFIX} doStop: audioState before="${session.getStatus().state}"`);

    try {
      noteDataProtectionPlaybackActivity(false);
    } catch (err) {
      console.warn(`${LOG_PREFIX} noteDataProtectionPlaybackActivity failed:`, err);
    }

    session.stop();

    try {
      savePlaybackMemoryNow();
    } catch (err) {
      console.warn(`${LOG_PREFIX} savePlaybackMemoryNow failed:`, err);
    }

    try {
      syncSmtcStatus();
    } catch (err) {
      console.warn(`${LOG_PREFIX} syncSmtcStatus failed:`, err);
    }

    console.log(`${LOG_PREFIX} doStop: complete`);
  }

  /** 执行最终动作（stop 或 quit） */
  private executeFinalAction(action: SleepTimerAction): void {
    switch (action) {
      case 'stop':
        this.doStop();
        break;
      case 'quit':
        app.quit();
        break;
      // pause 不应到达这里
    }
  }

  /** 计算剩余毫秒数 */
  private getRemainingMs(): number {
    if (this.intervalId === null) {
      return 0;
    }
    const elapsed = Date.now() - this.startTimeMs;
    return Math.max(0, this.totalDurationMs - elapsed);
  }

  /** 清理 interval */
  private clearInterval(): void {
    if (this.intervalId !== null) {
      globalThis.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** 重置内部状态 */
  private resetState(): void {
    this.startTimeMs = 0;
    this.totalDurationMs = 0;
    this.action = 'pause';
    this.fadeOutEnabled = false;
    this.durationMinutes = 0;
  }

  /** 触发所有 tick 回调 */
  private emitTick(remainingMs: number): void {
    for (const callback of this.tickCallbacks) {
      try {
        callback(remainingMs);
      } catch {
        // 回调异常不影响其他回调
      }
    }
  }

  /** 触发所有完成回调 */
  private emitComplete(): void {
    for (const callback of this.completeCallbacks) {
      try {
        callback();
      } catch {
        // 回调异常不影响其他回调
      }
    }
  }

  /** 触发所有状态变更回调 */
  private emitChange(): void {
    const status = this.getStatus();
    for (const callback of this.changeCallbacks) {
      try {
        callback(status);
      } catch {
        // 回调异常不影响其他回调
      }
    }
  }
}

// ---- 单例导出 ----

let instance: SleepTimerService | null = null;

/** 获取睡眠定时器服务单例 */
export const getSleepTimerService = (): SleepTimerService => {
  if (instance === null) {
    instance = new SleepTimerService();
  }
  return instance;
};
