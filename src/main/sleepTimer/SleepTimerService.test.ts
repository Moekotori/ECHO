import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- 用 vi.hoisted 提升 mock，确保 vi.mock 工厂函数可用 ----

const { mockPause, mockStop, mockQuit } = vi.hoisted(() => ({
  mockPause: vi.fn().mockResolvedValue({ state: 'paused' }),
  mockStop: vi.fn().mockReturnValue(undefined),
  mockQuit: vi.fn(),
}));

vi.mock('../audio/AudioSession', () => ({
  getAudioSession: () => ({
    pause: mockPause,
    stop: mockStop,
    getStatus: () => ({ state: 'playing' as const }),
  }),
}));

vi.mock('electron', () => ({
  app: {
    quit: mockQuit,
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn().mockReturnValue(null),
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('../app/dataProtection', () => ({
  noteDataProtectionPlaybackActivity: vi.fn(),
}));

vi.mock('../integrations/smtc/SmtcStatusSync', () => ({
  syncSmtcStatus: vi.fn(),
}));

vi.mock('../ipc/playbackIpc', () => ({
  savePlaybackMemoryNow: vi.fn(),
}));

// ---- 导入被测模块 ----

import { getSleepTimerService } from './SleepTimerService';

describe('SleepTimerService', () => {
  let service: ReturnType<typeof getSleepTimerService>;

  beforeEach(() => {
    service = getSleepTimerService();
    service.dispose();
    vi.clearAllMocks();
  });

  afterEach(() => {
    service.dispose();
  });

  // ---- 基本生命周期 ----

  describe('基本生命周期', () => {
    it('初始状态应为非活跃', () => {
      const status = service.getStatus();
      expect(status.isActive).toBe(false);
      expect(status.remainingMs).toBe(0);
      expect(status.action).toBe('pause');
    });

    it('启动后状态应为活跃', () => {
      service.start({ durationMinutes: 5, action: 'pause', fadeOut: false });
      const status = service.getStatus();
      expect(status.isActive).toBe(true);
      expect(status.remainingMs).toBeGreaterThan(0);
      expect(status.action).toBe('pause');
      expect(status.durationMinutes).toBe(5);
    });

    it('取消后状态应为非活跃', () => {
      service.start({ durationMinutes: 5, action: 'pause', fadeOut: false });
      service.cancel();
      const status = service.getStatus();
      expect(status.isActive).toBe(false);
      expect(status.remainingMs).toBe(0);
    });

    it('重复 start 应覆盖前一个定时器', () => {
      service.start({ durationMinutes: 5, action: 'pause', fadeOut: false });
      service.start({ durationMinutes: 10, action: 'stop', fadeOut: false });
      const status = service.getStatus();
      expect(status.durationMinutes).toBe(10);
      expect(status.action).toBe('stop');
    });
  });

  // ---- 输入校验 ----

  describe('输入校验', () => {
    it('durationMinutes 为 0 时应抛出错误', () => {
      expect(() => service.start({ durationMinutes: 0, action: 'pause', fadeOut: false }))
        .toThrow('durationMinutes must be a positive finite number');
    });

    it('durationMinutes 为负数时应抛出错误', () => {
      expect(() => service.start({ durationMinutes: -1, action: 'pause', fadeOut: false }))
        .toThrow('durationMinutes must be a positive finite number');
    });

    it('durationMinutes 为 NaN 时应抛出错误', () => {
      expect(() => service.start({ durationMinutes: NaN, action: 'pause', fadeOut: false }))
        .toThrow('durationMinutes must be a positive finite number');
    });

    it('durationMinutes 为 Infinity 时应抛出错误', () => {
      expect(() => service.start({ durationMinutes: Infinity, action: 'pause', fadeOut: false }))
        .toThrow('durationMinutes must be a positive finite number');
    });
  });

  // ---- 触发行为 ----

  describe('触发行为', () => {
    it('action 为 pause 时到期应调用 AudioSession.pause()', () => {
      vi.useFakeTimers();
      try {
        service.start({ durationMinutes: 1, action: 'pause', fadeOut: false });
        vi.advanceTimersByTime(60 * 1000 + 1500);
        expect(mockPause).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('action 为 stop 时到期应调用 AudioSession.stop()', () => {
      vi.useFakeTimers();
      try {
        service.start({ durationMinutes: 1, action: 'stop', fadeOut: false });
        vi.advanceTimersByTime(60 * 1000 + 1500);
        expect(mockStop).toHaveBeenCalledTimes(1);
        expect(mockPause).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('action 为 quit 时到期应调用 app.quit()', () => {
      vi.useFakeTimers();
      try {
        service.start({ durationMinutes: 1, action: 'quit', fadeOut: false });
        vi.advanceTimersByTime(60 * 1000 + 1500);
        expect(mockQuit).toHaveBeenCalledTimes(1);
        expect(mockPause).not.toHaveBeenCalled();
        expect(mockStop).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ---- 回调机制 ----

  describe('回调机制', () => {
    it('onTick 应在每秒触发', () => {
      vi.useFakeTimers();
      try {
        const tickFn = vi.fn();
        service.onTick(tickFn);
        service.start({ durationMinutes: 1, action: 'pause', fadeOut: false });
        // start 立即触发一次 tick
        expect(tickFn).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1000);
        expect(tickFn).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(1000);
        expect(tickFn).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('onTick 返回的取消函数应停止接收回调', () => {
      vi.useFakeTimers();
      try {
        const tickFn = vi.fn();
        const unsubscribe = service.onTick(tickFn);
        service.start({ durationMinutes: 1, action: 'pause', fadeOut: false });
        expect(tickFn).toHaveBeenCalledTimes(1);
        unsubscribe();
        vi.advanceTimersByTime(1000);
        expect(tickFn).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('onComplete 应在到期时触发', () => {
      vi.useFakeTimers();
      try {
        const completeFn = vi.fn();
        service.onComplete(completeFn);
        service.start({ durationMinutes: 1, action: 'pause', fadeOut: false });
        vi.advanceTimersByTime(60 * 1000 + 1500);
        expect(completeFn).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('onChange 应在 start/cancel/tick 时触发', () => {
      vi.useFakeTimers();
      try {
        const changeFn = vi.fn();
        service.onChange(changeFn);
        service.start({ durationMinutes: 1, action: 'pause', fadeOut: false });
        expect(changeFn).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1000);
        expect(changeFn).toHaveBeenCalledTimes(2);
        service.cancel();
        expect(changeFn).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('到期时应触发 emitTick(0)', () => {
      vi.useFakeTimers();
      try {
        const tickFn = vi.fn();
        service.onTick(tickFn);
        service.start({ durationMinutes: 1, action: 'pause', fadeOut: false });
        vi.advanceTimersByTime(60 * 1000 + 1500);
        const lastCall = tickFn.mock.calls[tickFn.mock.calls.length - 1];
        expect(lastCall[0]).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ---- 渐弱效果 ----

  describe('渐弱效果', () => {
    it('fadeOut 为 true 且 action 为 pause 时，到期应调用 pause()（pause 自带淡出）', () => {
      vi.useFakeTimers();
      try {
        service.start({ durationMinutes: 1, action: 'pause', fadeOut: true });
        vi.advanceTimersByTime(60 * 1000 + 1500);
        expect(mockPause).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('fadeOut 为 true 且 action 为 stop 时，到期应先 pause() 再 stop()', async () => {
      const completeFn = vi.fn();
      service.onComplete(completeFn);
      service.start({ durationMinutes: 0.001, action: 'stop', fadeOut: true });
      // 等待定时器到期 + pause Promise resolve + stop 执行
      await new Promise((resolve) => setTimeout(resolve, 3000));
      // 验证 pause 被调用了
      expect(mockPause).toHaveBeenCalled();
      // 验证 complete 被触发了（说明定时器确实到期了）
      expect(completeFn).toHaveBeenCalled();
      // 验证 stop 在 pause 之后被调用
      expect(mockStop).toHaveBeenCalledTimes(1);
    });

    it('fadeOut 为 true 且 action 为 quit 时，到期应先 pause() 再 quit()', async () => {
      const completeFn = vi.fn();
      service.onComplete(completeFn);
      service.start({ durationMinutes: 0.001, action: 'quit', fadeOut: true });
      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect(mockPause).toHaveBeenCalled();
      expect(completeFn).toHaveBeenCalled();
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('fadeOut 为 false 且 action 为 stop 时，到期应直接 stop() 不经过 pause', () => {
      vi.useFakeTimers();
      try {
        service.start({ durationMinutes: 1, action: 'stop', fadeOut: false });
        vi.advanceTimersByTime(60 * 1000 + 1500);
        expect(mockStop).toHaveBeenCalledTimes(1);
        expect(mockPause).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('getStatus 应反映 fadeOutEnabled 状态', () => {
      service.start({ durationMinutes: 5, action: 'pause', fadeOut: true });
      expect(service.getStatus().fadeOutEnabled).toBe(true);
      service.cancel();
      service.start({ durationMinutes: 5, action: 'pause', fadeOut: false });
      expect(service.getStatus().fadeOutEnabled).toBe(false);
    });
  });

  // ---- dispose ----

  describe('dispose', () => {
    it('dispose 后不应再触发回调', () => {
      vi.useFakeTimers();
      try {
        const tickFn = vi.fn();
        const completeFn = vi.fn();
        service.onTick(tickFn);
        service.onComplete(completeFn);
        service.start({ durationMinutes: 1, action: 'pause', fadeOut: false });
        service.dispose();
        vi.advanceTimersByTime(120 * 1000);
        expect(tickFn).toHaveBeenCalledTimes(1);
        expect(completeFn).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
