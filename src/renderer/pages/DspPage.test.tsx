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

describe('DspPage Pro access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('recommends the Steam edition without mounting community DSP controls and can hide the route', async () => {
    const getStatus = vi.fn(async () => ({ ...unlockedStatus, dspUnlocked: false, source: 'included' as const }));
    const bridge = installBridge(getStatus);
    const navigateHome = vi.fn();
    window.addEventListener('app:navigate:route', navigateHome);

    render(<DspPage />);

    expect(await screen.findByText('建议在 Steam 版体验 DSP')).toBeTruthy();
    expect(screen.getByText(/社区版 DSP 功能的实现目前存在问题/)).toBeTruthy();
    expect(getEqBridgeMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '账号与激活' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '前往 Steam 体验' }));
    expect(bridge.openExternalUrl).toHaveBeenCalledWith('https://store.steampowered.com/app/5105090/ECHO/');

    fireEvent.click(screen.getByRole('button', { name: '在侧边栏隐藏音效处理' }));
    await waitFor(() => expect(bridge.setSettings).toHaveBeenCalledWith(expect.objectContaining({
      sidebarHiddenRouteIds: expect.arrayContaining(['dsp']),
    })));
    expect(navigateHome).toHaveBeenCalledWith(expect.objectContaining({ detail: 'home' }));

    window.removeEventListener('app:navigate:route', navigateHome);
  });

  it('unlocks in place when the local Pro entitlement changes', async () => {
    const getStatus = vi.fn()
      .mockResolvedValueOnce({ ...unlockedStatus, dspUnlocked: false, source: 'included' })
      .mockResolvedValue(unlockedStatus);
    installBridge(getStatus);

    render(<DspPage />);
    expect(await screen.findByText('建议在 Steam 版体验 DSP')).toBeTruthy();

    window.dispatchEvent(new Event('echo-pro:status-changed'));

    await waitFor(() => expect(getEqBridgeMock).toHaveBeenCalled());
    expect(screen.queryByText('建议在 Steam 版体验 DSP')).toBeNull();
    expect(screen.getByText('EQ workbench')).toBeTruthy();
  });
});
