/** 睡眠定时器到期动作 */
export type SleepTimerAction = 'pause' | 'stop' | 'quit';

/** 睡眠定时器状态 */
export type SleepTimerStatus = {
  /** 是否正在倒计时 */
  isActive: boolean;
  /** 剩余毫秒数 */
  remainingMs: number;
  /** 到期动作 */
  action: SleepTimerAction;
  /** 是否启用淡出 */
  fadeOutEnabled: boolean;
  /** 设定时长（分钟） */
  durationMinutes: number;
};

/** 启动睡眠定时器的请求参数 */
export type SleepTimerStartRequest = {
  /** 倒计时分钟数 */
  durationMinutes: number;
  /** 到期动作 */
  action: SleepTimerAction;
  /** 是否启用淡出 */
  fadeOut: boolean;
};
