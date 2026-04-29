/** PortAudio host API index labels (Windows); reserved for device UI. */
export const HOST_API_NAMES = {
  0: 'Standard (MME)',
  1: 'DirectSound',
  2: 'WASAPI',
  3: 'WDM-KS',
  4: 'ASIO'
}

const z16 = () => Array(16).fill(0)

/**
 * 16-band gain presets. Presets only override matching gain slots, so older user
 * layouts keep their frequency/type/Q choices.
 */
export const EQ_PRESETS = {
  Custom: null,
  Flat: { preamp: 0, bands: z16() },
  'Reference (Harman 2018)': {
    preamp: -3,
    bands: [4, 3.5, 2.5, 1.5, 0.5, 0, -0.5, -0.8, -1, -0.8, 0.2, 1, 1.5, 1.8, 1.4, 0.8]
  },
  Warm: {
    preamp: -2,
    bands: [2.8, 2.5, 2.1, 1.4, 1.0, 0.8, 0.4, 0, -0.4, -0.8, -1.2, -1.0, -0.5, 0.2, 0.6, 0.8]
  },
  Bright: {
    preamp: -2,
    bands: [-1.2, -1.0, -0.8, -0.6, -0.5, -0.2, 0, 0.3, 0.8, 1.3, 1.8, 2.4, 2.8, 3.0, 2.6, 1.8]
  },
  'Dialogue / Podcast': {
    preamp: -2,
    bands: [-4, -3.5, -3, -2, -1.2, 0.2, 1.8, 3, 3.2, 2.6, 1.6, 0.5, -0.6, -1.6, -2.5, -3]
  },
  'Late Night': {
    preamp: -5,
    bands: [5.5, 4.5, 3.3, 2.0, 0.8, 0.2, -0.2, -0.4, -0.2, 0.5, 1.2, 2, 2.8, 3.4, 3.6, 3.2]
  },
  'V-Shape': {
    preamp: -4,
    bands: [5.5, 5, 4, 2.2, 0.4, -1.2, -2.2, -2.6, -2.2, -1, 0.6, 2.4, 3.8, 4.8, 5.2, 4.6]
  },
  'Bass Boost': {
    preamp: -2,
    bands: [5, 4.4, 3.2, 1.8, 0.8, 0.2, 0, 0, 0, 0, 0, 0.2, 0.4, 0.5, 0.4, 0.2]
  },
  'Treble Boost': {
    preamp: -2,
    bands: [-0.6, -0.5, -0.4, -0.2, 0, 0, 0.2, 0.5, 1, 1.8, 2.6, 3.4, 4, 4.2, 3.8, 3]
  },
  Vocal: {
    preamp: -2,
    bands: [-2.5, -2, -1.2, -0.2, 0.8, 1.8, 2.8, 3.2, 2.6, 1.4, 0.4, -0.2, -0.6, -0.8, -1, -1]
  },
  Electronic: {
    preamp: -4,
    bands: [5, 4.6, 3.4, 1.4, -0.4, -1.4, -1.2, 0, 1.4, 2.6, 3.8, 4.5, 4.2, 3.6, 3.2, 2.6]
  },
  Pop: {
    preamp: -2,
    bands: [2.8, 2.3, 1.6, 0.8, 0, -0.8, -1.2, -1.0, -0.2, 0.8, 1.6, 2.2, 2.2, 1.8, 1.5, 1.2]
  },
  Rock: {
    preamp: -4,
    bands: [4.2, 3.6, 2.4, 1.0, -0.4, -1.4, -1.6, -0.8, 0.6, 2.2, 3.4, 4, 4.2, 4, 3.4, 2.6]
  },
  Classical: {
    preamp: -2,
    bands: [1.8, 1.6, 1.1, 0.4, 0, -0.2, -0.2, 0, 0.5, 1, 1.4, 1.8, 2, 2.2, 2, 1.4]
  },
  'Hi-Res Air': {
    preamp: -2,
    bands: [-0.4, -0.2, 0, 0, 0, 0, 0.2, 0.4, 0.8, 1.2, 1.8, 2.3, 2.8, 3.0, 2.6, 1.8]
  }
}
