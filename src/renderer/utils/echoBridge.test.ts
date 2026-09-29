// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eqFrequenciesHz } from '../../shared/types/eq';

describe('renderer EQ bridge fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    delete (window as unknown as { echo?: unknown }).echo;
  });

  it('persists EQ presets and channel balance without the Electron preload bridge', async () => {
    const { getEqBridge } = await import('./echoBridge');
    const eq = getEqBridge();

    expect(eq).toBeTruthy();

    await eq?.setBandGain({ band: 2, gainDb: 4.5 });
    await eq?.setBandQ({ band: 2, q: 2.5 });
    await eq?.setBandFilterType({ band: 2, filterType: 'highShelf' });
    await eq?.setBandEnabled({ band: 2, enabled: false });
    const savedPreset = await eq?.savePreset({
      name: 'Browser Bright',
      preampDb: -4,
      bands: (await eq.getState()).bands,
    });
    await eq?.setPreset(savedPreset?.id ?? '');
    const savedProfile = await eq?.saveProfile({
      name: 'Browser Desk',
      state: await eq.getState(),
    });
    await eq?.bindProfileToOutput({
      profileId: savedProfile?.id ?? '',
      target: { outputMode: 'shared', outputDeviceId: 'browser-device', outputDeviceName: 'Browser Device' },
    });
    await eq?.setChannelBalanceState({ enabled: true, balance: 0.25, monoMode: 'sum' });

    vi.resetModules();
    const { getEqBridge: getReloadedEqBridge } = await import('./echoBridge');
    const reloaded = getReloadedEqBridge();
    const presets = await reloaded?.listPresets();
    const profiles = await reloaded?.listProfiles();
    const state = await reloaded?.getState();
    const binding = await reloaded?.getProfileBinding({ outputMode: 'shared', outputDeviceId: 'browser-device', outputDeviceName: 'Browser Device' });
    const channelBalance = await reloaded?.getChannelBalanceState();

    expect(presets?.some((preset) => preset.id === 'browser-bright')).toBe(true);
    expect(profiles?.some((profile) => profile.id === 'browser-desk')).toBe(true);
    expect(state).toMatchObject({ presetId: 'browser-bright', presetName: 'Browser Bright', preampDb: -4 });
    expect(state?.bands[2]).toMatchObject({ q: 2.5, filterType: 'highShelf', enabled: false });
    expect(binding).toMatchObject({ profileId: 'browser-desk', profileName: 'Browser Desk' });
    expect(channelBalance).toMatchObject({ enabled: true, balance: 0.25, monoMode: 'sum' });
  });

  it('imports browser fallback presets without overwriting an existing preset id', async () => {
    const { getEqBridge } = await import('./echoBridge');
    const eq = getEqBridge();

    await eq?.savePreset({
      name: 'Browser Bright',
      preampDb: -4,
      bands: (await eq.getState()).bands,
    });

    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function click(this: HTMLInputElement) {
      Object.defineProperty(this, 'files', {
        configurable: true,
        value: [
          new File([
            JSON.stringify({
              type: 'echo-next-eq-preset',
              version: 1,
              preset: {
                name: 'Browser Bright',
                preampDb: -6,
                bands: bandsForImport(),
              },
            }),
          ], 'browser-bright.json', { type: 'application/json' }),
        ],
      });
      this.onchange?.(new Event('change'));
    });

    const imported = await eq?.importPreset();
    const presets = await eq?.listPresets();

    expect(imported?.preset).toMatchObject({ id: 'browser-bright-2', name: 'Browser Bright', preampDb: -6 });
    expect(imported?.metadata).toMatchObject({ source: 'echo-json', importedFilterCount: eqFrequenciesHz.length });
    expect(presets?.filter((preset) => preset.name === 'Browser Bright').map((preset) => preset.id)).toEqual(['browser-bright', 'browser-bright-2']);
    clickSpy.mockRestore();
  });

  it('reports Equalizer APO import metadata in the browser fallback bridge', async () => {
    const { getEqBridge } = await import('./echoBridge');
    const eq = getEqBridge();

    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function click(this: HTMLInputElement) {
      Object.defineProperty(this, 'files', {
        configurable: true,
        value: [
          new File([
            [
              'Preamp: -6 dB',
              'Filter 1: ON PK Fc 105 Hz Gain -3 dB Q 1',
              'Filter 2: ON LS Fc 80 Hz Gain 2 dB Q 0.7',
            ].join('\n'),
          ], 'apo-headphones.txt', { type: 'text/plain' }),
        ],
      });
      this.onchange?.(new Event('change'));
    });

    const imported = await eq?.importPreset();

    expect(imported?.preset).toMatchObject({ id: 'apo-headphones', name: 'apo-headphones', preampDb: -6 });
    expect(imported?.metadata).toMatchObject({
      source: 'equalizer-apo',
      importedFilterCount: 2,
      skippedFilterCount: 0,
      graphicEqPointCount: 0,
    });
    clickSpy.mockRestore();
  });

  it('previews Equalizer APO imports without saving them first', async () => {
    const { getEqBridge } = await import('./echoBridge');
    const eq = getEqBridge();

    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function click(this: HTMLInputElement) {
      Object.defineProperty(this, 'files', {
        configurable: true,
        value: [
          new File([
            [
              'Preamp: -5 dB',
              'Filter 1: ON PK Fc 1000 Hz Gain 2 dB Q 1',
            ].join('\n'),
          ], 'preview-apo.txt', { type: 'text/plain' }),
        ],
      });
      this.onchange?.(new Event('change'));
    });

    const preview = await eq?.previewImportPreset();
    const presetsBeforeApply = await eq?.listPresets();
    const saved = await eq?.savePreset(preview!.request);
    const presetsAfterApply = await eq?.listPresets();

    expect(preview?.request).toMatchObject({ id: 'preview-apo', name: 'preview-apo', preampDb: -5 });
    expect(preview?.metadata).toMatchObject({ source: 'equalizer-apo', importedFilterCount: 1 });
    expect(presetsBeforeApply?.some((preset) => preset.id === 'preview-apo')).toBe(false);
    expect(saved).toMatchObject({ id: 'preview-apo', name: 'preview-apo' });
    expect(presetsAfterApply?.some((preset) => preset.id === 'preview-apo')).toBe(true);
    clickSpy.mockRestore();
  });
});

const bandsForImport = () =>
  eqFrequenciesHz.map((frequencyHz) => ({
    frequencyHz,
    gainDb: 0,
    q: 1,
    filterType: 'peaking',
    enabled: true,
  }));
