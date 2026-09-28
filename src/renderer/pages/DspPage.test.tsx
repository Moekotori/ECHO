// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DspPage } from './DspPage';

const { getEqBridgeMock, refreshPlaybackStatusMock, translateMock } = vi.hoisted(() => ({
  getEqBridgeMock: vi.fn(),
  refreshPlaybackStatusMock: vi.fn(async () => undefined),
  translateMock: vi.fn((key: string) => key),
}));

vi.mock('../i18n/I18nProvider', () => ({
  useI18n: () => ({
    locale: 'zh-CN',
    t: translateMock,
  }),
}));

vi.mock('../stores/playbackStatusStore', () => ({
  refreshPlaybackStatus: refreshPlaybackStatusMock,
  useThrottledSharedPlaybackStatus: () => ({ audioStatus: null, error: null }),
}));

vi.mock('../utils/echoBridge', () => ({
  getEqBridge: () => getEqBridgeMock(),
}));

vi.mock('../components/audio/EqPanel', () => ({
  EqPanel: () => <div>EQ workbench</div>,
}));

vi.mock('../components/audio/HeadphoneCorrectionPanel', () => ({
  HeadphoneCorrectionPanel: () => <div>Headphone workbench</div>,
}));

const unlockedStatus = {
  unlocked: true,
  dspUnlocked: true,
  source: 'native-license' as const,
  checkedAt: '2026-07-19T00:00:00.000Z',
};

const installBridge = (getStatus: ReturnType<typeof vi.fn>) => {
  const getSettings = vi.fn(async () => ({ sidebarHiddenRouteIds: [], sidebarRouteOrder: [] }));
  const setSettings = vi.fn(async (patch) => ({ ...patch }));
  const openExternalUrl = vi.fn(async () => undefined);
  Object.defineProperty(window, 'echo', {
    configurable: true,
    value: {
      app: {
        getEchoProLocalEntitlementStatus: getStatus,
        getSettings,
        setSettings,
        openExternalUrl,
      },
    },
  });
  return { getSettings, setSettings, openExternalUrl };
};

describe('DspPage free access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    getEqBridgeMock.mockReturnValue({
      getState: vi.fn(async () => ({
        enabled: false,
        preampDb: 0,
        dspHeadroomDb: 0,
        dspSafetyLimiterEnabled: true,
        presetId: 'flat',
        presetName: 'Flat',
        clippingRisk: false,
        bands: [],
      })),
      getRoomCorrectionState: vi.fn(async () => ({
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
      })),
      getChannelBalanceState: vi.fn(async () => ({
        enabled: false,
        balance: 0,
        leftGainDb: 0,
        rightGainDb: 0,
        bandGains: {},
        leftDelayMs: 0,
        rightDelayMs: 0,
        swapLeftRight: false,
        monoMode: 'off',
        invertLeft: false,
        invertRight: false,
        constantPower: true,
        clippingRisk: false,
      })),
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'echo');
  });

  it('opens the DSP workbench for free users without checking a Pro license', async () => {
    const getStatus = vi.fn(async () => ({ ...unlockedStatus, unlocked: false, dspUnlocked: false, source: 'none' as const }));
    installBridge(getStatus);

    render(<DspPage />);

    expect(await screen.findByText('EQ workbench')).toBeTruthy();
    await waitFor(() => expect(getEqBridgeMock).toHaveBeenCalled());
    expect(getStatus).not.toHaveBeenCalled();
    expect(document.querySelector('.dsp-pro-lock')).toBeNull();
    expect(document.querySelector('.dsp-pro-badge')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^ECHO SRC/ }));
    expect(document.querySelector('.dsp-editor-shell')?.getAttribute('data-module')).toBe('src');
    fireEvent.click(screen.getByRole('button', { name: /^ECHO SDM/ }));
    expect(document.querySelector('.dsp-editor-shell')?.getAttribute('data-module')).toBe('sdm');
  });

  it('keeps DSP accessible when the entitlement API is unavailable', async () => {
    installBridge(vi.fn());
    Reflect.deleteProperty(window.echo.app, 'getEchoProLocalEntitlementStatus');

    render(<DspPage />);

    expect(await screen.findByText('EQ workbench')).toBeTruthy();
    await waitFor(() => expect(getEqBridgeMock).toHaveBeenCalled());
    expect(document.querySelector('.dsp-pro-lock')).toBeNull();
  });
});
