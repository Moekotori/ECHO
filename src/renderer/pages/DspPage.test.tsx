// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AudioStatus, ChannelBalanceState } from '../../shared/types/audio';
import type { EqState, RoomCorrectionState } from '../../shared/types/eq';
import { DspPage } from './DspPage';

const eqState: EqState = {
  enabled: false,
  preampDb: 0,
  dspHeadroomDb: 0,
  dspSafetyLimiterEnabled: true,
  presetId: 'flat',
  presetName: 'Flat',
  clippingRisk: false,
  bands: [],
};

const roomCorrection: RoomCorrectionState = {
  enabled: false,
  status: 'empty',
  irId: null,
  irName: null,
  channelMode: 'none',
  sampleRate: null,
  tapCount: 0,
  trimDb: 0,
  latencySamples: 0,
  clippingRisk: false,
  error: null,
};

const channelBalance: ChannelBalanceState = {
  enabled: false,
  balance: 0,
  leftGainDb: 0,
  rightGainDb: 0,
  bandGains: {
    low: { leftGainDb: 0, rightGainDb: 0 },
    mid: { leftGainDb: 0, rightGainDb: 0 },
    high: { leftGainDb: 0, rightGainDb: 0 },
  },
  leftDelayMs: 0,
  rightDelayMs: 0,
  swapLeftRight: false,
  monoMode: 'off',
  invertLeft: false,
  invertRight: false,
  constantPower: true,
  clippingRisk: false,
};

const baseAudioStatus = (overrides: Partial<AudioStatus> = {}): AudioStatus => ({
  host: 'ready',
  state: 'idle',
  outputMode: 'exclusive',
  outputDeviceName: null,
  fileSampleRate: 44100,
  requestedOutputSampleRate: 44100,
  actualDeviceSampleRate: 44100,
  echoSrcMode: 'off',
  echoSrcQualityProfile: 'transparent',
  echoSrcTargetSampleRate: null,
  echoSrcActive: false,
  eqEnabled: false,
  channelBalanceEnabled: false,
  dspActive: false,
  dspLimiterProtecting: false,
  dspClippingRisk: false,
  clippingRisk: false,
  warnings: [],
  audioLevels: null,
  ...overrides,
} as unknown as AudioStatus);

let audioStatus: AudioStatus | null = baseAudioStatus();
let settings = {
  audioEchoSrcMode: 'off',
  audioEchoSrcQualityProfile: 'transparent',
};

vi.mock('../components/audio/EqPanel', () => ({
  EqPanel: () => <div data-testid="eq-panel" />,
}));

vi.mock('../components/audio/HeadphoneCorrectionPanel', () => ({
  HeadphoneCorrectionPanel: () => <div data-testid="headphone-panel" />,
}));

vi.mock('../i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      if (key === 'dsp.status.modulesActive' && options?.count !== undefined) {
        return `${options.count} 个 section 启用`;
      }

      return key;
    },
  }),
}));

vi.mock('../stores/playbackStatusStore', () => ({
  refreshPlaybackStatus: vi.fn(() => Promise.resolve()),
  useSharedPlaybackStatus: () => ({ audioStatus, error: null }),
}));

vi.mock('../utils/echoBridge', () => ({
  getEqBridge: () => ({
    getState: vi.fn(() => Promise.resolve(eqState)),
    getRoomCorrectionState: vi.fn(() => Promise.resolve(roomCorrection)),
    getChannelBalanceState: vi.fn(() => Promise.resolve(channelBalance)),
  }),
}));

const renderDspPage = (): ReturnType<typeof render> => render(<DspPage />);

const openSrcPanel = (): void => {
  fireEvent.click(screen.getByRole('button', { name: /UZUME SRC \/ PCM/u }));
};

const openModulePanel = (name: RegExp): void => {
  fireEvent.click(screen.getByRole('button', { name }));
};

beforeEach(() => {
  audioStatus = baseAudioStatus();
  settings = {
    audioEchoSrcMode: 'off',
    audioEchoSrcQualityProfile: 'transparent',
  };
  window.localStorage.clear();
  Object.defineProperty(window, 'echo', {
    configurable: true,
    value: {
      app: {
        getSettings: vi.fn(() => Promise.resolve(settings)),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DspPage UZUME SRC surface', () => {
  it('shows format path transitions instead of disabling PCM DSP controls from bit-perfect', () => {
    audioStatus = baseAudioStatus({
      bitPerfectCandidate: true,
      uzumeFormatPath: 'pcm_bitperfect',
      uzumeBitPerfectState: 'available',
    });

    renderDspPage();

    expect(screen.getAllByText('PCM bit-perfect').length).toBeGreaterThan(0);
    expect(screen.getByText('由控件触发')).toBeTruthy();
    expect(screen.getByText('打开此 section 会退出 PCM bit-perfect，后端会重新规划为 PCM processed。')).toBeTruthy();
  });

  it('explains that enabling DSP sections exits DSD direct instead of leaving dead controls', () => {
    audioStatus = baseAudioStatus({
      bitPerfectCandidate: true,
      activeDsdOutputMode: 'dop',
      uzumeFormatPath: 'dsd_direct',
      uzumeBitPerfectState: 'available',
    });

    renderDspPage();

    expect(screen.getAllByText('DSD direct').length).toBeGreaterThan(0);
    expect(screen.getByText('打开此 section 会退出 DSD direct / DoP，后端会重新规划为 DSD -> PCM processed。')).toBeTruthy();
  });

  it('marks UZUME SRC as unimplemented instead of exposing live switches', () => {
    renderDspPage();
    openSrcPanel();

    expect(screen.getByText('UZUME Poly-Sinc SRC 未实现')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /A\/B 原生/u })).toBeNull();
    expect(screen.queryByRole('button', { name: /Transparent/u })).toBeNull();
    expect(screen.queryByRole('button', { name: /2x PCM/u })).toBeNull();

    expect(screen.getByText('2x PCM')).toBeTruthy();
    expect(screen.getAllByText('未实现').length).toBeGreaterThan(0);
    expect(screen.getByText('Headroom 未实现')).toBeTruthy();
    expect(screen.getByText('EQ 未实现')).toBeTruthy();
    expect(screen.getByText('OPRA 未实现')).toBeTruthy();
    expect(screen.getByText('FIR 未实现')).toBeTruthy();
    expect(screen.getByText('Matrix 未实现')).toBeTruthy();
    expect(screen.getByText('Safety 未实现')).toBeTruthy();
  });

  it('renders every UZUME child module as a read-only unimplemented surface', () => {
    renderDspPage();

    [
      { button: /UZUME Headroom/u, title: 'UZUME Headroom 未实现' },
      { button: /UZUME EQ/u, title: 'UZUME EQ 未实现' },
      { button: /OPRA Headphone/u, title: 'OPRA Headphone 未实现' },
      { button: /UZUME FIR/u, title: 'UZUME FIR 未实现' },
      { button: /UZUME Matrix/u, title: 'UZUME Matrix 未实现' },
      { button: /UZUME Safety/u, title: 'UZUME Safety 未实现' },
    ].forEach((module) => {
      openModulePanel(module.button);

      expect(screen.getByText(module.title)).toBeTruthy();
      expect(screen.getByText('没有 UZUME 控件')).toBeTruthy();
      expect(screen.getByText('兼容读数')).toBeTruthy();
    });

    expect(screen.queryByTestId('eq-panel')).toBeNull();
    expect(screen.queryByTestId('headphone-panel')).toBeNull();
  });

  it('shows active SOXR upsampling as a compatibility path, not a UZUME implementation', () => {
    audioStatus = baseAudioStatus({
      dspActive: true,
      echoSrcMode: 'family8x',
      echoSrcActive: true,
      echoSrcTargetSampleRate: 352800,
      warnings: ['echo_src_active:44100->352800'],
    });
    settings = {
      audioEchoSrcMode: 'family8x',
      audioEchoSrcQualityProfile: 'transparent',
    };

    renderDspPage();
    openSrcPanel();

    expect(screen.getByText('ECHO/SOXR 兼容升频')).toBeTruthy();
    expect(screen.getByText('ECHO/SOXR')).toBeTruthy();
    expect(screen.getAllByText('兼容路径').length).toBeGreaterThan(0);
  });
});
