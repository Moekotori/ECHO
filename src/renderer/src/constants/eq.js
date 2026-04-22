/** PortAudio host API index labels (Windows); reserved for device UI. */
export const HOST_API_NAMES = {
  0: 'Standard (MME)',
  1: 'DirectSound',
  2: 'WASAPI',
  3: 'WDM-KS',
  4: 'ASIO'
}

const z16 = () => Array(16).fill(0)

/** 预设仅覆盖对应下标的增益；缺省项保留当前频段的 gain（兼容 16 段布局）。 */
export const EQ_PRESETS = {
  Custom: null,
  Flat: { preamp: 0, bands: z16() },
  'Bass Boost': {
    preamp: -2,
    bands: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  'Treble Boost': {
    preamp: -2,
    bands: [0, 0, 0, 0, 0, 0, 0, 1, 2, 4, 5, 5, 5, 5, 6, 6]
  },
  Vocal: {
    preamp: -1,
    bands: [-2, -1, 0, 2, 4, 5, 3, 1, 0, -0.5, -1, -1, 0, 0, -1, -1]
  },
  Electronic: {
    preamp: -2,
    bands: [5, 4, 2, -1, -2, -2, 0, 2, 3, 4, 5, 5, 4, 3, 3, 3]
  },
  Pop: {
    preamp: -1,
    bands: [2, 1, 1, 0, -1, -2, -2, -1, 0, 1, 2, 2, 1, 1, 1, 1]
  },
  Rock: {
    preamp: -2,
    bands: [4, 3, 1, -1, -2, -3, -2, 0, 2, 3, 4, 4, 4, 5, 5, 4]
  },
  /** 略抬两端、略收中低频堆叠，适合古典器乐 */
  Classical: {
    preamp: -1.5,
    bands: [2, 2, 1, 0, -1, -1, 0, 1, 2, 2, 1, 1, 2, 3, 3, 2]
  },
  /** 平直基础上轻微空气感（高频段） */
  'Hi-Res Air': {
    preamp: -1,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1, 1.5, 2, 2, 2.5, 2, 1.5]
  }
}
