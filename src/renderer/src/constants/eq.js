/** PortAudio host API index labels (Windows); reserved for device UI. */
export const HOST_API_NAMES = {
  0: "Standard (MME)",
  1: "DirectSound",
  2: "WASAPI",
  3: "WDM-KS",
  4: "ASIO",
};

export const EQ_PRESETS = {
  Custom: null,
  Flat: { preamp: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  "Bass Boost": { preamp: -2, bands: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0] },
  "Treble Boost": { preamp: -2, bands: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  Vocal: { preamp: -1, bands: [-2, -1, 0, 2, 4, 5, 3, 1, 0, -1] },
  Electronic: { preamp: -2, bands: [5, 4, 0, -2, -2, 0, 2, 4, 5, 5] },
  Pop: { preamp: -1, bands: [2, 1, 0, -1, -2, -2, -1, 0, 1, 2] },
  Rock: { preamp: -2, bands: [4, 3, -1, -2, -3, -1, 1, 3, 4, 5] },
};
