// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AudioStatus, ChannelBalanceState } from '../../../shared/types/audio';
import { eqFrequenciesHz, type EqPreset, type EqState, type RoomCorrectionState } from '../../../shared/types/eq';
import { I18nProvider } from '../../i18n/I18nProvider';
import { EqPanel } from './EqPanel';

const bands = eqFrequenciesHz.map((frequencyHz) => ({
  frequencyHz,
  gainDb: 0,
  q: 1,
  filterType: 'peaking' as const,
  enabled: true,
}));

const eqState = (overrides: Partial<EqState> = {}): EqState => ({
  enabled: false,
  preampDb: 0,
  bands,
  presetId: 'flat',
  presetName: '原音如初',
  clippingRisk: false,
  ...overrides,
});

const presets: EqPreset[] = [
  { id: 'flat', name: '原音如初', preampDb: 0, bands, createdAt: 'built-in', updatedAt: 'built-in', readonly: true },
  { id: 'rock', name: '黑曜摇滚', preampDb: -3, bands, createdAt: 'built-in', updatedAt: 'built-in', readonly: true },
  { id: 'harman-target', name: '暖场哈曼', preampDb: -5, bands, createdAt: 'built-in', updatedAt: 'built-in', readonly: true },
  { id: 'subsonic-filter', name: '暗涌滤波', preampDb: -2, bands: bands.map((band, index) => (index === 0 ? { ...band, frequencyHz: 24, filterType: 'highPass' as const } : band)), createdAt: 'built-in', updatedAt: 'built-in', readonly: true },
  { id: 'sibilance-tamer', name: '齿音柔化', preampDb: -4, bands: bands.map((band, index) => (index === 8 ? { ...band, frequencyHz: 8200, filterType: 'notch' as const, q: 6 } : band)), createdAt: 'built-in', updatedAt: 'built-in', readonly: true },
  { id: 'bluetooth-speaker-cleanup', name: '蓝牙清场', preampDb: -3, bands: bands.map((band, index) => (index === 9 ? { ...band, frequencyHz: 18000, filterType: 'lowPass' as const } : band)), createdAt: 'built-in', updatedAt: 'built-in', readonly: true },
  { id: 'user-bright', name: 'User Bright', preampDb: -4, bands, createdAt: 'now', updatedAt: 'now', readonly: false },
];

const channelBalanceState = (overrides: Partial<ChannelBalanceState> = {}): ChannelBalanceState => ({
  enabled: false,
  balance: 0,
  leftGainDb: 0,
  rightGainDb: 0,
  swapLeftRight: false,
  monoMode: 'off',
  invertLeft: false,
  invertRight: false,
  constantPower: true,
  clippingRisk: false,
  ...overrides,
});

const roomCorrectionState = (overrides: Partial<RoomCorrectionState> = {}): RoomCorrectionState => ({
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
  ...overrides,
});

const audioStatus: AudioStatus = {
  host: 'ready',
  state: 'playing',
  outputDeviceId: null,
  outputDeviceName: null,
  outputDeviceType: null,
  outputBackend: 'wasapi-exclusive',
  activeOutputBackendImpl: null,
  outputMode: 'exclusive',
  useJuceOutputRequested: false,
  useJuceDecodeRequested: false,
  activeDecodeBackendImpl: null,
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentFilePath: null,
  currentTrackId: null,
  durationSeconds: 0,
  positionSeconds: 0,
  channels: 2,
  codec: 'FLAC',
  bitDepth: 24,
  bitrate: 1400000,
  fileSampleRate: 44100,
  decoderOutputSampleRate: 44100,
  requestedOutputSampleRate: 44100,
  actualDeviceSampleRate: 44100,
  sharedDeviceSampleRate: null,
  resampling: false,
  bitPerfectCandidate: false,
  sampleRateMismatch: false,
  eqEnabled: true,
  channelBalanceEnabled: false,
  dspActive: true,
  preampDb: 0,
  eqPresetName: '原音如初',
  clippingRisk: false,
  bitPerfectDisabledReason: 'eq_enabled',
  warnings: ['eq_enabled_bit_perfect_disabled'],
  error: null,
};

const renderEqPanel = (status: AudioStatus | null = audioStatus, options: { surface?: 'full' | 'eq-only' } = {}): ReturnType<typeof render> =>
  render(
    <I18nProvider>
      <EqPanel audioStatus={status} surface={options.surface} />
    </I18nProvider>,
  );

const showAdvancedEqTools = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: 'Pro' }));
};

beforeEach(() => {
  window.localStorage.setItem('echo-next.locale', 'en-US');
  window.localStorage.removeItem('echo-next.eq.uiMode');
  window.localStorage.removeItem('echo-next.eq.spectrumAnalyzer');
  window.localStorage.removeItem('echo-next.eq.analyzerMode');
  window.localStorage.removeItem('echo-next.eq.autoGainEnabled');
  const currentState = eqState({
    bands: bands.map((band, index) => (index === 1 ? { ...band, gainDb: 6 } : band)),
  });

  window.echo = {
    eq: {
      getState: vi.fn().mockResolvedValue(currentState),
      listPresets: vi.fn().mockResolvedValue(presets),
      setEnabled: vi.fn().mockImplementation((enabled: boolean) => Promise.resolve(eqState({ enabled }))),
      setBandGain: vi.fn().mockImplementation(({ band, gainDb }: { band: number; gainDb: number }) =>
        Promise.resolve(eqState({ presetId: 'custom', presetName: 'Custom', bands: bands.map((item, index) => (index === band ? { ...item, gainDb } : item)) })),
      ),
      setBandFrequency: vi.fn().mockImplementation(({ band, frequencyHz }: { band: number; frequencyHz: number }) =>
        Promise.resolve(eqState({ presetId: 'custom', presetName: 'Custom', bands: bands.map((item, index) => (index === band ? { ...item, frequencyHz } : item)) })),
      ),
      setBandQ: vi.fn().mockImplementation(({ band, q }: { band: number; q: number }) =>
        Promise.resolve(eqState({ presetId: 'custom', presetName: 'Custom', bands: bands.map((item, index) => (index === band ? { ...item, q } : item)) })),
      ),
      setBandFilterType: vi.fn().mockImplementation(({ band, filterType }: { band: number; filterType: 'peaking' | 'lowShelf' | 'highShelf' | 'lowPass' | 'highPass' | 'notch' }) =>
        Promise.resolve(eqState({ presetId: 'custom', presetName: 'Custom', bands: bands.map((item, index) => (index === band ? { ...item, filterType } : item)) })),
      ),
      setBandEnabled: vi.fn().mockImplementation(({ band, enabled }: { band: number; enabled: boolean }) =>
        Promise.resolve(eqState({ presetId: 'custom', presetName: 'Custom', bands: bands.map((item, index) => (index === band ? { ...item, enabled } : item)) })),
      ),
      setPreamp: vi.fn().mockImplementation((preampDb: number) => Promise.resolve(eqState({ preampDb }))),
      setPreset: vi.fn().mockImplementation((presetId: string) => Promise.resolve(eqState({ presetId, presetName: presetId === 'rock' ? '黑曜摇滚' : 'User Bright' }))),
      reset: vi.fn().mockResolvedValue(eqState()),
      savePreset: vi.fn().mockImplementation((request: { id?: string; name: string; preampDb: number; bands: EqState['bands'] }) =>
        Promise.resolve({
          id: request.id ?? 'user-bright',
          name: request.name,
          preampDb: request.preampDb,
          bands: request.bands,
          createdAt: 'now',
          updatedAt: 'now',
          readonly: false,
        }),
      ),
      exportPreset: vi.fn().mockResolvedValue('D:\\Exports\\Desk Headphones.json'),
      exportApoPreset: vi.fn().mockResolvedValue('D:\\Exports\\Desk Headphones.txt'),
      exportApoGraphicEqPreset: vi.fn().mockResolvedValue('D:\\Exports\\Desk Headphones GraphicEQ.txt'),
      previewImportPreset: vi.fn().mockResolvedValue({
        request: {
          name: 'User Bright',
          preampDb: -4,
          bands,
        },
        metadata: {
          source: 'echo-json',
          importedFilterCount: bands.length,
          skippedFilterCount: 0,
          graphicEqPointCount: 0,
          includedFileCount: 0,
          skippedIncludeCount: 0,
          unsupportedDirectiveCount: 0,
          unsupportedDirectiveSummary: {},
          channelScopedFilterCount: 0,
          bandwidthFilterCount: 0,
          warnings: [],
        },
        fileName: 'User Bright.json',
      }),
      importPreset: vi.fn().mockResolvedValue(presets.find((preset) => preset.id === 'user-bright')),
      deletePreset: vi.fn().mockResolvedValue(presets.slice(0, 2)),
      listProfiles: vi.fn().mockResolvedValue([]),
      saveProfile: vi.fn().mockResolvedValue({
        id: 'desk-profile',
        name: 'Desk Profile',
        state: currentState,
        bindings: [],
        createdAt: 'now',
        updatedAt: 'now',
      }),
      applyProfile: vi.fn().mockResolvedValue(currentState),
      deleteProfile: vi.fn().mockResolvedValue([]),
      bindProfileToOutput: vi.fn().mockResolvedValue({
        key: 'exclusive-null',
        label: 'EXCLUSIVE / Current output',
        profileId: 'desk-profile',
        profileName: 'Desk Profile',
      }),
      getProfileBinding: vi.fn().mockResolvedValue(null),
      getChannelBalanceState: vi.fn().mockResolvedValue(channelBalanceState()),
      setChannelBalanceState: vi.fn().mockImplementation((patch) => Promise.resolve(channelBalanceState(patch))),
      resetChannelBalance: vi.fn().mockResolvedValue(channelBalanceState()),
      getRoomCorrectionState: vi.fn().mockResolvedValue(roomCorrectionState()),
      importRoomCorrectionIr: vi.fn().mockResolvedValue(roomCorrectionState({
        enabled: false,
        status: 'loaded',
        irId: 'ir-test',
        irName: 'Desk IR',
        channelMode: 'stereo',
        sampleRate: 48000,
        tapCount: 128,
      })),
      setRoomCorrectionEnabled: vi.fn().mockImplementation((enabled: boolean) => Promise.resolve(roomCorrectionState({
        enabled,
        status: enabled ? 'active' : 'loaded',
        irId: 'ir-test',
        irName: 'Desk IR',
        channelMode: 'stereo',
        sampleRate: 48000,
        tapCount: 128,
      }))),
      setRoomCorrectionTrim: vi.fn().mockImplementation((trimDb: number) => Promise.resolve(roomCorrectionState({
        status: 'loaded',
        irId: 'ir-test',
        irName: 'Desk IR',
        channelMode: 'stereo',
        sampleRate: 48000,
        tapCount: 128,
        trimDb,
      }))),
      clearRoomCorrection: vi.fn().mockResolvedValue(roomCorrectionState()),
    },
  } as unknown as Window['echo'];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EqPanel', () => {
  it('renders Simple mode with the core EQ workflow first', async () => {
    renderEqPanel();

    await screen.findByRole('img', { name: 'Draggable 31-band EQ frequency response' });
    expect(screen.getByRole('heading', { name: 'EQ' })).toBeTruthy();
    expect(screen.getByText('Sound curve, safe headroom, and advanced tuning')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Simple' }).dataset.active).toBe('true');
    expect(screen.getByText('Signal Path')).toBeTruthy();
    expect(screen.queryByText('Selected band console')).toBeNull();
    expect(screen.queryByLabelText('Q')).toBeNull();
    expect(await screen.findByLabelText('Balance')).toBeTruthy();
    expect(screen.getByLabelText('Quick EQ preamp')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quick Auto Gain' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quick -6 dB headroom' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quick native direct' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hold original' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Bass lift/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Vocal focus/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'AirBrighter space' })).toBeTruthy();
    expect(screen.getAllByText('Headroom').length).toBeGreaterThan(0);
    expect(screen.getByText('Bit-perfect')).toBeTruthy();
  });

  it('keeps detached DSP modules out of the EQ-only surface', async () => {
    const { container } = renderEqPanel(audioStatus, { surface: 'eq-only' });

    await screen.findByRole('img', { name: 'Draggable 31-band EQ frequency response' });
    expect(screen.getByLabelText('Quick EQ preamp')).toBeTruthy();
    expect(screen.queryByLabelText('Balance')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quick -6 dB headroom' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quick native direct' })).toBeNull();

    await showAdvancedEqTools();
    expect(container.querySelector('.channel-balance-panel')).toBeNull();
    expect(container.querySelector('.eq-room-correction')).toBeNull();
    expect(container.querySelector('.eq-dsp-headroom-control')).toBeNull();
  });

  it('updates preamp from the quick strip slider', async () => {
    renderEqPanel();

    fireEvent.change(await screen.findByLabelText('Quick EQ preamp'), { target: { value: '-5.5' } });

    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-5.5));
  });

  it('temporarily compares the current Simple EQ against the original sound', async () => {
    window.echo.eq.getState = vi.fn().mockResolvedValue(eqState({ enabled: true }));
    renderEqPanel();

    const compare = await screen.findByRole('button', { name: 'Hold original' });
    fireEvent.pointerDown(compare);
    await waitFor(() => expect(window.echo.eq.setEnabled).toHaveBeenCalledWith(false));

    fireEvent.pointerUp(compare);
    await waitFor(() => expect(window.echo.eq.setEnabled).toHaveBeenCalledWith(true));
  });

  it('locks OPRA headphone correction until converted and only A/B bypasses EQ', async () => {
    const opraState = eqState({
      enabled: true,
      presetId: 'opra-sennheiser-hd650',
      presetName: '耳机校正 - Sennheiser / HD 650 / AutoEQ',
      preampDb: -5.2,
    });
    vi.mocked(window.echo.eq.getState).mockResolvedValue(opraState);
    window.echo.eq.setEnabled = vi.fn().mockImplementation((enabled: boolean) => Promise.resolve({ ...opraState, enabled }));
    renderEqPanel();

    expect(await screen.findByLabelText('Headphone correction EQ lock')).toBeTruthy();
    expect(screen.getAllByText('Managed by headphone correction').length).toBeGreaterThan(0);
    expect((screen.getByLabelText('Quick EQ preamp') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Bass lift/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Compare original' }));
    await waitFor(() => expect(window.echo.eq.setEnabled).toHaveBeenCalledWith(false));
    expect(window.echo.eq.setRoomCorrectionEnabled).not.toHaveBeenCalled();
    expect(window.echo.eq.setChannelBalanceState).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Convert to custom EQ' }));
    await waitFor(() =>
      expect(window.echo.eq.savePreset).toHaveBeenCalledWith(expect.objectContaining({
        id: expect.stringMatching(/^custom-opra-sennheiser-hd650-/),
        name: 'Custom EQ - Sennheiser / HD 650 / AutoEQ',
        preampDb: -5.2,
      })),
    );
    await waitFor(() => expect(window.echo.eq.listPresets).toHaveBeenCalled());
  });

  it('shows readable DSP comfort guidance in Simple mode', async () => {
    renderEqPanel();

    expect(await screen.findByText('Sound is being shaped')).toBeTruthy();
    expect(screen.getByText('Only enabled DSP modules are processed. Turn them off to return to the native playback path.')).toBeTruthy();

    cleanup();
    vi.mocked(window.echo.eq.getState).mockResolvedValue(eqState({ enabled: false }));
    renderEqPanel(null);

    expect(await screen.findByText('Native direct')).toBeTruthy();
    expect(screen.getByText('When DSP is off, volume is not reduced and samples are not changed. Good for hearing the original path.')).toBeTruthy();
  });

  it('applies a beginner-friendly Simple tone curve with safe preamp', async () => {
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Bass lift/i }));

    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-2.5));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 0, gainDb: 2.5 }));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 10, gainDb: 0.7 }));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 17, gainDb: 0 }));
    await waitFor(() => expect(window.echo.eq.setBandFilterType).toHaveBeenCalledWith({ band: 0, filterType: 'peaking' }));
    await waitFor(() => expect(window.echo.eq.setEnabled).toHaveBeenCalledWith(true));
  });

  it('adjusts the active Simple tone amount without exposing advanced EQ parameters', async () => {
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Bass lift/i }));
    fireEvent.input(await screen.findByLabelText('Simple tone amount'), { target: { value: '1.5' } });

    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-3.8));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 0, gainDb: 3.8 }));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 7, gainDb: 2.4 }));
    expect(screen.queryByLabelText('Q')).toBeNull();
    expect((screen.getByLabelText('Simple tone amount') as HTMLInputElement).value).toBe('1.5');
  });

  it('lets Simple users nudge tone amount without dragging the slider', async () => {
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Bass lift/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));

    await waitFor(() => expect((screen.getByLabelText('Simple tone amount') as HTMLInputElement).value).toBe('1.1'));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 0, gainDb: 2.8 }));
    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-2.8));
  });

  it('shows beginner-friendly Simple listening zones that react to tone changes', async () => {
    vi.mocked(window.echo.eq.getState).mockResolvedValue(eqState());
    renderEqPanel();

    expect(await screen.findByLabelText('Simple listening zone changes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply Low end tone, current Neutral' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply Vocal tone, current Neutral' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply Air tone, current Neutral' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Bass lift/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply Low end tone, current +2.2 dB' })).toBeTruthy());
    expect(screen.getByText('Kick and weight')).toBeTruthy();
    expect(screen.queryByText('Fc')).toBeNull();

    fireEvent.input(await screen.findByLabelText('Simple tone amount'), { target: { value: '1.5' } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply Low end tone, current +3.4 dB' })).toBeTruthy());
  });

  it('summarizes the current Simple vibe in beginner language', async () => {
    vi.mocked(window.echo.eq.getState).mockResolvedValue(eqState());
    renderEqPanel();

    const insight = await screen.findByLabelText('Simple current vibe summary');
    expect(insight.textContent).toContain('Current vibeNeutral');
    expect(insight.textContent).toContain('Main changeNeutral');
    expect(insight.textContent).toContain('AmountReady');

    fireEvent.click(screen.getByRole('button', { name: /Bass lift/i }));

    await waitFor(() => expect(insight.textContent).toContain('Current vibeBass lift'));
    await waitFor(() => expect(insight.textContent).toContain('Main changeLow end +2.2 dB'));
    expect(insight.textContent).toContain('Amount100%');
  });

  it('lets Simple users explore beginner tones with Next vibe', async () => {
    vi.mocked(window.echo.eq.getState).mockResolvedValue(eqState());
    renderEqPanel();

    const insight = await screen.findByLabelText('Simple current vibe summary');
    fireEvent.click(screen.getByRole('button', { name: 'Next vibe' }));

    await waitFor(() => expect(insight.textContent).toContain('Current vibeBass lift'));
    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-2.5));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 0, gainDb: 2.5 }));

    fireEvent.click(screen.getByRole('button', { name: 'Next vibe' }));

    await waitFor(() => expect(insight.textContent).toContain('Current vibeVocal focus'));
    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-1.7));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 16, gainDb: 1.7 }));
  });

  it('lets Simple listening zones apply matching beginner tone curves', async () => {
    vi.mocked(window.echo.eq.getState).mockResolvedValue(eqState());
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Apply Vocal tone, current Neutral' }));

    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-1.7));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 16, gainDb: 1.7 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply Vocal tone, current +1.0 dB' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Apply Air tone, current -0.3 dB' }));

    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-2));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 27, gainDb: 2 }));
  });

  it('lets Simple users undo the last beginner EQ tweak', async () => {
    vi.mocked(window.echo.eq.getState).mockResolvedValue(eqState());
    renderEqPanel();

    const undo = await screen.findByRole<HTMLButtonElement>('button', { name: /Undo/i });
    expect(undo.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Bass lift/i }));

    await waitFor(() => expect(undo.disabled).toBe(false));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply Low end tone, current +2.2 dB' })).toBeTruthy());
    fireEvent.click(undo);

    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(0));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply Low end tone, current Neutral' })).toBeTruthy());
  });

  it('lets Simple users save the current beginner tone as a user preset', async () => {
    vi.mocked(window.echo.eq.getState).mockResolvedValue(eqState());
    renderEqPanel();

    const saveVibe = await screen.findByRole<HTMLButtonElement>('button', { name: 'Save vibe' });
    expect(saveVibe.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Bass lift/i }));

    await waitFor(() => expect(saveVibe.disabled).toBe(false));
    fireEvent.click(saveVibe);

    await waitFor(() =>
      expect(window.echo.eq.savePreset).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Bass lift 100%',
        preampDb: -2.5,
      })),
    );
    await waitFor(() => expect(window.echo.eq.listPresets).toHaveBeenCalled());
  });

  it('shows a beginner-safe headroom action in Simple mode when boosts can clip', async () => {
    vi.mocked(window.echo.eq.getState).mockResolvedValue(eqState({
      enabled: true,
      presetId: 'custom',
      presetName: 'Custom',
      preampDb: 0,
      bands: bands.map((band, index) => (index === 0 ? { ...band, gainDb: 6 } : band)),
    }));
    renderEqPanel();

    expect(await screen.findByLabelText('Simple safe headroom')).toBeTruthy();
    expect(screen.getByText('Needs headroom')).toBeTruthy();
    expect(screen.getByText('Peak +6.0 dB / suggested -6.0 dB')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Make safe-6.0 dB' }));

    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-6));
  });

  it('shows the active Simple tone name instead of a generic modified label', async () => {
    window.echo.eq.getState = vi.fn().mockResolvedValue(eqState({
      enabled: true,
      presetId: 'custom',
      presetName: 'Bass lift',
      preampDb: -2.5,
      bands: bands.map((band, index) => (index <= 6 ? { ...band, gainDb: index <= 3 ? 2.5 : 1.6 } : band)),
    }));

    const { container } = renderEqPanel();

    const bassTone = await screen.findByRole('button', { name: /Bass lift/i });
    expect(container.querySelector('.eq-quick-metric strong')?.textContent).toBe('Bass lift');
    expect(bassTone.getAttribute('data-active')).toBe('true');
  });

  it('keeps the full professional tools behind Pro mode', async () => {
    renderEqPanel();

    expect(await screen.findByRole('button', { name: 'Pro' })).toBeTruthy();
    expect(screen.queryByLabelText('Unlock frequency')).toBeNull();
    expect(screen.queryByLabelText('Q')).toBeNull();
    expect(screen.queryByLabelText('EQ profile name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Store A' })).toBeNull();

    await showAdvancedEqTools();

    expect(screen.getByRole('button', { name: 'Pro' }).dataset.active).toBe('true');
    expect(screen.getByText('Signal Path')).toBeTruthy();
    expect(await screen.findByLabelText('Unlock frequency')).toBeTruthy();
    expect(screen.getByLabelText('Q')).toBeTruthy();
    expect(screen.getByLabelText('EQ profile name')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Store A' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Bass lift/i })).toBeNull();
    expect(screen.queryByLabelText('Simple listening zone changes')).toBeNull();
  });

  it('shows Room Correction controls in Pro mode and calls the FIR bridge APIs', async () => {
    const { container } = renderEqPanel();
    await showAdvancedEqTools();

    expect(screen.getAllByText('Room Correction').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Import IR' }));

    await waitFor(() => expect(window.echo.eq.importRoomCorrectionIr).toHaveBeenCalled());
    expect(await screen.findByText('Desk IR')).toBeTruthy();

    const trimInput = container.querySelector('.eq-room-correction-trim input');
    expect(trimInput).toBeTruthy();
    fireEvent.change(trimInput as HTMLInputElement, { target: { value: '-4.5' } });
    await waitFor(() => expect(window.echo.eq.setRoomCorrectionTrim).toHaveBeenCalledWith(-4.5));

    const roomButtons = Array.from(container.querySelectorAll('.eq-room-correction-actions button'));
    fireEvent.click(roomButtons[1]);
    await waitFor(() => expect(window.echo.eq.setRoomCorrectionEnabled).toHaveBeenCalledWith(true));

    fireEvent.click(roomButtons[2]);
    await waitFor(() => expect(window.echo.eq.clearRoomCorrection).toHaveBeenCalled());
  });

  it('renders friendly Room Correction error labels', async () => {
    vi.mocked(window.echo.eq.getRoomCorrectionState).mockResolvedValue(roomCorrectionState({
      status: 'error',
      error: 'impulse_too_long',
    }));

    renderEqPanel();

    expect((await screen.findAllByText('IR too long')).length).toBeGreaterThan(0);
  });

  it('names Room Correction as the bit-perfect DSP source', async () => {
    vi.mocked(window.echo.eq.getRoomCorrectionState).mockResolvedValue(roomCorrectionState({
      enabled: true,
      status: 'active',
      irId: 'ir-test',
      irName: 'Desk IR',
      channelMode: 'stereo',
      sampleRate: 48000,
      tapCount: 128,
    }));

    renderEqPanel({ ...audioStatus, eqEnabled: false, dspActive: true, bitPerfectDisabledReason: 'room_correction_enabled', warnings: ['room_correction_bit_perfect_disabled'] });
    await showAdvancedEqTools();

    expect((await screen.findAllByText('DSP active: bit-perfect disabled (Room Correction).')).length).toBeGreaterThan(0);
  });

  it('updates PEQ band Q, filter type, and bypass state from the advanced inspector', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    fireEvent.change(await screen.findByLabelText('Q'), { target: { value: '2.4' } });
    fireEvent.blur(screen.getByLabelText('Q'));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'lowShelf' } });
    fireEvent.click(screen.getByLabelText('Band enabled'));

    await waitFor(() => expect(window.echo.eq.setBandQ).toHaveBeenCalledWith({ band: 0, q: 2.4 }));
    await waitFor(() => expect(window.echo.eq.setBandFilterType).toHaveBeenCalledWith({ band: 0, filterType: 'lowShelf' }));
    await waitFor(() => expect(window.echo.eq.setBandEnabled).toHaveBeenCalledWith({ band: 0, enabled: false }));
  });

  it('supports full parametric filter types and fixes gain for pass/notch bands', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    const typeSelect = await screen.findByLabelText('Type');
    expect(typeSelect.textContent).toContain('Low pass');
    expect(typeSelect.textContent).toContain('High pass');
    expect(typeSelect.textContent).toContain('Notch');

    fireEvent.change(typeSelect, { target: { value: 'notch' } });

    await waitFor(() => expect(window.echo.eq.setBandFilterType).toHaveBeenCalledWith({ band: 0, filterType: 'notch' }));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 0, gainDb: 0 }));
    await waitFor(() => expect((screen.getByLabelText('Gain') as HTMLInputElement).disabled).toBe(true));
  });

  it('applies type-aware Q preset buttons from the pro inspector', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Narrow' }));
    await waitFor(() => expect(window.echo.eq.setBandQ).toHaveBeenCalledWith({ band: 0, q: 4 }));

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'notch' } });
    await waitFor(() => expect(window.echo.eq.setBandFilterType).toHaveBeenCalledWith({ band: 0, filterType: 'notch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Normal' }));

    await waitFor(() => expect(window.echo.eq.setBandQ).toHaveBeenCalledWith({ band: 0, q: 6 }));
  });

  it('saves profiles and binds the selected profile only to the current output when requested', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    fireEvent.change(await screen.findByLabelText('EQ profile name'), { target: { value: 'Desk Profile' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(window.echo.eq.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ name: 'Desk Profile' })));
    await waitFor(() => expect(window.echo.eq.listProfiles).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Bind current output' }));
    await waitFor(() =>
      expect(window.echo.eq.bindProfileToOutput).toHaveBeenCalledWith(expect.objectContaining({
        profileId: 'desk-profile',
        target: expect.objectContaining({ outputMode: 'exclusive' }),
      })),
    );
  });

  it('lets EQ curve nodes update gain and snapped frequency while standard frequency snap is locked', async () => {
    renderEqPanel();

    const curve = await screen.findByRole('img', { name: 'Draggable 31-band EQ frequency response' });
    curve.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 920,
      bottom: 260,
      width: 920,
      height: 260,
      toJSON: () => undefined,
    }));

    const node = await screen.findByTestId('eq-curve-node-2');
    fireEvent.pointerDown(node, { clientX: 410, clientY: 94, pointerId: 1 });
    fireEvent.pointerMove(curve, { clientX: 410, clientY: 94, pointerId: 1 });
    fireEvent.pointerUp(curve, { clientX: 410, clientY: 94, pointerId: 1 });

    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 2, gainDb: 5.5 }));
    await waitFor(() => expect(window.echo.eq.setBandFrequency).toHaveBeenCalledWith({ band: 2, frequencyHz: 400 }));

    await showAdvancedEqTools();
    fireEvent.click(screen.getByRole('button', { name: 'Reset selected' }));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 2, gainDb: 0 }));
  });

  it('maps EQ drag coordinates through the SVG screen matrix when the chart is letterboxed', async () => {
    renderEqPanel();

    const curve = await screen.findByRole('img', { name: 'Draggable 31-band EQ frequency response' });
    curve.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1100,
      bottom: 360,
      width: 1100,
      height: 360,
      toJSON: () => undefined,
    }));
    const point = {
      x: 0,
      y: 0,
      matrixTransform: vi.fn(() => ({ x: 410, y: 130 })),
    };
    Object.defineProperty(curve, 'getScreenCTM', {
      value: vi.fn(() => ({ inverse: () => ({}) })),
      configurable: true,
    });
    Object.defineProperty(curve, 'createSVGPoint', {
      value: vi.fn(() => point),
      configurable: true,
    });

    const node = await screen.findByTestId('eq-curve-node-2');
    fireEvent.pointerDown(node, { clientX: 510, clientY: 94, pointerId: 1 });
    fireEvent.pointerUp(curve, { clientX: 510, clientY: 94, pointerId: 1 });

    expect(point.matrixTransform).toHaveBeenCalled();
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 2, gainDb: 5.5 }));
    await waitFor(() => expect(window.echo.eq.setBandFrequency).toHaveBeenCalledWith({ band: 2, frequencyHz: 400 }));
  });

  it('only edits band frequency when free-frequency mode is unlocked', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    const curve = await screen.findByRole('img', { name: 'Draggable 31-band EQ frequency response' });
    curve.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 920,
      bottom: 260,
      width: 920,
      height: 260,
      toJSON: () => undefined,
    }));

    fireEvent.click(await screen.findByLabelText('Unlock frequency'));
    const node = await screen.findByTestId('eq-curve-node-2');
    fireEvent.pointerDown(node, { clientX: 410, clientY: 94, pointerId: 1, shiftKey: true });
    fireEvent.pointerMove(curve, { clientX: 410, clientY: 94, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(curve, { clientX: 410, clientY: 94, pointerId: 1, shiftKey: true });

    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 2, gainDb: 5.5 }));
    await waitFor(() => expect(window.echo.eq.setBandFrequency).toHaveBeenCalledWith({ band: 2, frequencyHz: expect.any(Number) }));
  });

  it('keeps pass and notch node drags horizontal by avoiding gain updates', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'highPass' } });
    await waitFor(() => expect(window.echo.eq.setBandFilterType).toHaveBeenCalledWith({ band: 0, filterType: 'highPass' }));
    (window.echo.eq.setBandGain as ReturnType<typeof vi.fn>).mockClear();
    (window.echo.eq.setBandFrequency as ReturnType<typeof vi.fn>).mockClear();

    const curve = await screen.findByRole('img', { name: 'Draggable 31-band EQ frequency response' });
    curve.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 920,
      bottom: 260,
      width: 920,
      height: 260,
      toJSON: () => undefined,
    }));

    const node = await screen.findByTestId('eq-curve-node-0');
    fireEvent.pointerDown(node, { clientX: 410, clientY: 40, pointerId: 1 });
    fireEvent.pointerMove(curve, { clientX: 410, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(curve, { clientX: 410, clientY: 40, pointerId: 1 });

    expect(window.echo.eq.setBandGain).not.toHaveBeenCalled();
    await waitFor(() => expect(window.echo.eq.setBandFrequency).toHaveBeenCalledWith({ band: 0, frequencyHz: 400 }));
  });

  it('supports keyboard fine gain adjustment on selected EQ nodes', async () => {
    renderEqPanel();

    const node = await screen.findByTestId('eq-curve-node-2');
    fireEvent.keyDown(node, { key: 'ArrowUp', shiftKey: true });

    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 2, gainDb: 0.1 }));
  });

  it('apply safe preamp uses the recommended headroom when peak estimate is risky', async () => {
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Apply safe preamp/i }));

    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-6));
  });

  it('renders realtime input and estimated output meter values safely', async () => {
    renderEqPanel({
      ...audioStatus,
      clippingRisk: true,
      audioLevels: {
        inputPeakDb: -5.2,
        inputRmsDb: -18.4,
        estimatedOutputPeakDb: 0.8,
        estimatedOutputRmsDb: -12.4,
        headroomDb: -0.8,
        clipCount: 3,
        lastClipAt: '2026-05-13T00:00:00.000Z',
        meterSource: 'pre_native_estimated_post_dsp',
      },
    });

    expect(await screen.findByText('Input peak')).toBeTruthy();
    expect(screen.getAllByText('-5.2 dB').length).toBeGreaterThan(0);
    expect(screen.getByText('Est. output peak')).toBeTruthy();
    expect(screen.getAllByText('Headroom').length).toBeGreaterThan(0);
    expect(screen.getByText(/pre-native \+ DSP estimate/)).toBeTruthy();
    expect(screen.getByText(/Clips 3/)).toBeTruthy();
  });

  it('shows Auto Gain in Simple and Pro modes and persists the toggle', async () => {
    renderEqPanel();

    expect(await screen.findByRole('button', { name: 'Auto Gain' })).toBeTruthy();
    expect(screen.getByText('Idle')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Auto Gain' }));

    await waitFor(() => expect(window.localStorage.getItem('echo-next.eq.autoGainEnabled')).toBe('true'));
    await showAdvancedEqTools();
    expect(screen.getByRole('button', { name: 'Auto Gain' })).toBeTruthy();
  });

  it('automatically lowers preamp when Auto Gain sees realtime clipping risk', async () => {
    renderEqPanel({
      ...audioStatus,
      clippingRisk: true,
      audioLevels: {
        inputPeakDb: -4,
        inputRmsDb: -18,
        estimatedOutputPeakDb: 0.8,
        estimatedOutputRmsDb: -12,
        headroomDb: -0.8,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Auto Gain' }));

    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(expect.any(Number)));
    const autoPreampCall = vi.mocked(window.echo.eq.setPreamp).mock.calls.find(([preampDb]) => preampDb < 0);
    expect(autoPreampCall?.[0]).toBeLessThanOrEqual(-1.8);
    expect(await screen.findByText(/Clipping|Reducing/)).toBeTruthy();
  });

  it('keeps Auto Gain from immediately fighting a manual preamp edit', async () => {
    renderEqPanel({
      ...audioStatus,
      audioLevels: {
        inputPeakDb: -4,
        inputRmsDb: -18,
        estimatedOutputPeakDb: 0.8,
        estimatedOutputRmsDb: -12,
        headroomDb: -0.8,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Auto Gain' }));
    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalled());
    vi.mocked(window.echo.eq.setPreamp).mockClear();

    const preamp = await screen.findByLabelText('EQ preamp');
    fireEvent.change(preamp, { target: { value: '-3' } });

    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-3));
    expect(screen.getByText('Holding')).toBeTruthy();
    expect(vi.mocked(window.echo.eq.setPreamp).mock.calls.filter(([preampDb]) => preampDb !== -3)).toHaveLength(0);
  });

  it('overlays realtime visual spectrum and hover readout when analyzer is enabled', async () => {
    const { container } = renderEqPanel({
      ...audioStatus,
      audioLevels: {
        inputPeakDb: -5.2,
        inputRmsDb: -18.4,
        estimatedOutputPeakDb: -6,
        estimatedOutputRmsDb: -19,
        visualSpectrum: Array.from({ length: 32 }, (_unused, index) => index / 31),
        visualSpectrumVersion: 2,
        visualEnergy: 0.5,
        visualTransient: 0.2,
        visualTelemetryState: 'pcm',
        headroomDb: 6,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
    });
    await showAdvancedEqTools();

    expect(container.querySelector('.eq-spectrum-overlay')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Analyzer' }));
    expect(container.querySelectorAll('.eq-spectrum-bar')).toHaveLength(32);

    const curve = await screen.findByRole('img', { name: 'Draggable 31-band EQ frequency response' });
    curve.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 920,
      bottom: 360,
      width: 920,
      height: 360,
      toJSON: () => undefined,
    }));
    fireEvent.pointerMove(curve, { clientX: 410, clientY: 140, pointerId: 1 });

    expect(container.querySelector('.eq-hover-readout')).toBeTruthy();
  });

  it('shows analyzer status text for live, priming, and no-signal states', async () => {
    const { container, rerender } = render(
      <I18nProvider>
        <EqPanel
          audioStatus={{
            ...audioStatus,
            audioLevels: {
              inputPeakDb: -5.2,
              inputRmsDb: -18.4,
              estimatedOutputPeakDb: -6,
              estimatedOutputRmsDb: -19,
              visualSpectrum: Array.from({ length: 32 }, () => 0.4),
              visualSpectrumVersion: 2,
              visualEnergy: 0.4,
              visualTransient: 0.2,
              visualTelemetryState: 'pcm',
              headroomDb: 6,
              clipCount: 0,
              lastClipAt: null,
              meterSource: 'pre_native_estimated_post_dsp',
            },
          }}
        />
      </I18nProvider>,
    );
    await showAdvancedEqTools();

    expect(container.querySelector('.eq-analyzer-status')?.textContent).toContain('Off');
    fireEvent.click(await screen.findByRole('button', { name: 'Analyzer' }));
    expect(container.querySelector('.eq-analyzer-status')?.textContent).toContain('Live');
    expect(container.querySelector('.eq-analyzer-status')?.getAttribute('data-state')).toBe('live');

    rerender(
      <I18nProvider>
        <EqPanel
          audioStatus={{
            ...audioStatus,
            audioLevels: {
              inputPeakDb: -5.2,
              inputRmsDb: -18.4,
              estimatedOutputPeakDb: -6,
              estimatedOutputRmsDb: -19,
              visualSpectrum: Array.from({ length: 32 }, () => 0),
              visualSpectrumVersion: 2,
              visualEnergy: 0,
              visualTransient: 0,
              visualTelemetryState: 'priming',
              headroomDb: 6,
              clipCount: 0,
              lastClipAt: null,
              meterSource: 'pre_native_estimated_post_dsp',
            },
          }}
        />
      </I18nProvider>,
    );
    expect(container.querySelector('.eq-analyzer-status')?.textContent).toContain('Priming');
    expect(container.querySelector('.eq-analyzer-status')?.getAttribute('data-state')).toBe('priming');

    rerender(
      <I18nProvider>
        <EqPanel
          audioStatus={{
            ...audioStatus,
            audioLevels: {
              inputPeakDb: -90,
              inputRmsDb: -90,
              estimatedOutputPeakDb: -90,
              estimatedOutputRmsDb: -90,
              visualSpectrum: Array.from({ length: 32 }, () => 0),
              visualSpectrumVersion: 2,
              visualEnergy: 0,
              visualTransient: 0,
              visualTelemetryState: 'pcm',
              headroomDb: 90,
              clipCount: 0,
              lastClipAt: null,
              meterSource: 'pre_native_estimated_post_dsp',
            },
          }}
        />
      </I18nProvider>,
    );
    expect(container.querySelector('.eq-analyzer-status')?.textContent).toContain('No signal');
    expect(container.querySelector('.eq-analyzer-status')?.getAttribute('data-state')).toBe('noSignal');
  });

  it('switches the analyzer overlay between input and post-EQ estimate modes', async () => {
    const { container } = renderEqPanel({
      ...audioStatus,
      audioLevels: {
        inputPeakDb: -6,
        inputRmsDb: -18,
        estimatedOutputPeakDb: -5,
        estimatedOutputRmsDb: -17,
        visualSpectrum: Array.from({ length: 32 }, () => 0.35),
        visualSpectrumVersion: 2,
        visualEnergy: 0.35,
        visualTransient: 0.1,
        visualTelemetryState: 'pcm',
        headroomDb: 5,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
    });
    await showAdvancedEqTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Analyzer' }));
    expect(container.querySelector('.eq-spectrum-bar')?.getAttribute('data-mode')).toBe('input');

    fireEvent.click(screen.getByRole('button', { name: 'Post EQ' }));
    expect(container.querySelector('.eq-spectrum-bar')?.getAttribute('data-mode')).toBe('postEq');
  });

  it('undoes and redoes EQ curve edits through existing IPC calls', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    const curve = await screen.findByRole('img', { name: 'Draggable 31-band EQ frequency response' });
    curve.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 920,
      bottom: 260,
      width: 920,
      height: 260,
      toJSON: () => undefined,
    }));

    const node = await screen.findByTestId('eq-curve-node-2');
    fireEvent.pointerDown(node, { clientX: 410, clientY: 94, pointerId: 1 });
    fireEvent.pointerUp(curve, { clientX: 410, clientY: 94, pointerId: 1 });
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 2, gainDb: 5.5 }));

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 2, gainDb: 0 }));

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 2, gainDb: 5.5 }));
  });

  it('keeps APO-style filter stack controls inside Pro mode', async () => {
    renderEqPanel();

    await screen.findByRole('button', { name: 'EQ preset' });
    expect(screen.queryByRole('button', { name: 'Add filter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete filter' })).toBeNull();

    await showAdvancedEqTools();
    expect(await screen.findByRole('button', { name: 'Add filter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete filter' })).toBeTruthy();
  });

  it('adds and removes an APO-style filter slot through the advanced stack', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Add filter' }));

    await waitFor(() => expect(window.echo.eq.setBandFrequency).toHaveBeenCalledWith({ band: 2, frequencyHz: 31.5 }));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 2, gainDb: 0 }));
    await waitFor(() => expect(window.echo.eq.setBandQ).toHaveBeenCalledWith({ band: 2, q: 1 }));
    await waitFor(() => expect(window.echo.eq.setBandFilterType).toHaveBeenCalledWith({ band: 2, filterType: 'peaking' }));
    await waitFor(() => expect(window.echo.eq.setBandEnabled).toHaveBeenCalledWith({ band: 2, enabled: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete filter' }));

    await waitFor(() => expect(window.echo.eq.setBandFrequency).toHaveBeenCalledWith({ band: 2, frequencyHz: 31.5 }));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 2, gainDb: 0 }));
    await waitFor(() => expect(window.echo.eq.setBandQ).toHaveBeenCalledWith({ band: 2, q: 1 }));
    await waitFor(() => expect(window.echo.eq.setBandFilterType).toHaveBeenCalledWith({ band: 2, filterType: 'peaking' }));
    await waitFor(() => expect(window.echo.eq.setBandEnabled).toHaveBeenCalledWith({ band: 2, enabled: false }));
  });

  it('temporarily disables EQ while holding the bypass button', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    const bypass = await screen.findByRole('button', { name: 'Hold to Bypass EQ' });
    fireEvent.pointerDown(bypass);

    await waitFor(() => expect(window.echo.eq.setEnabled).toHaveBeenCalledWith(false));
  });

  it('captures and restores local A/B EQ slots through existing IPC calls', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Store A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply A' }));

    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(0));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 1, gainDb: 6 }));
  });

  it('applies loudness-matched A/B restore through preamp compensation', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Store A' }));
    fireEvent.click(screen.getByRole('button', { name: /Apply safe preamp/i }));
    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-6));

    fireEvent.click(screen.getByLabelText('Loudness matched'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply A' }));

    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-12));
  });

  it('selects presets, resets to Flat, and prevents built-in preset deletion', async () => {
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'EQ preset' }));
    fireEvent.click(screen.getByRole('option', { name: '黑曜摇滚' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset EQ' }));

    await waitFor(() => expect(window.echo.eq.setPreset).toHaveBeenCalledWith('rock'));
    expect(window.echo.eq.reset).toHaveBeenCalled();
    expect((screen.getByRole('button', { name: /Delete/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Overwrite' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('allows overwriting current user presets without deleting built-ins', async () => {
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'EQ preset' }));
    fireEvent.click(screen.getByRole('option', { name: 'User Bright' }));

    await waitFor(() => expect(window.echo.eq.setPreset).toHaveBeenCalledWith('user-bright'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Overwrite' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));

    await waitFor(() => expect(window.echo.eq.savePreset).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-bright', name: 'User Bright' })));
  });

  it('exports the current EQ as a preset file from the Save as action', async () => {
    renderEqPanel();

    fireEvent.change(await screen.findByLabelText('Preset name'), { target: { value: 'Desk Headphones' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as' }));

    await waitFor(() =>
      expect(window.echo.eq.exportPreset).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Desk Headphones',
        bands: expect.any(Array),
      })),
    );
    expect(window.echo.eq.savePreset).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'Desk Headphones' }));
    expect((await screen.findByRole('status')).textContent).toBe('Exported EQ preset to D:\\Exports\\Desk Headphones.json');
  });

  it('exports Equalizer APO config files with visible completion feedback', async () => {
    renderEqPanel();

    fireEvent.change(await screen.findByLabelText('Preset name'), { target: { value: 'Desk Headphones' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export APO' }));

    await waitFor(() =>
      expect(window.echo.eq.exportApoPreset).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Desk Headphones',
        bands: expect.any(Array),
      })),
    );
    expect(window.echo.eq.savePreset).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'Desk Headphones' }));
    expect((await screen.findByRole('status')).textContent).toBe('Exported Equalizer APO config to D:\\Exports\\Desk Headphones.txt');
  });

  it('exports Equalizer APO GraphicEQ files with visible completion feedback', async () => {
    renderEqPanel();

    fireEvent.change(await screen.findByLabelText('Preset name'), { target: { value: 'Desk Headphones' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export GraphicEQ' }));

    await waitFor(() =>
      expect(window.echo.eq.exportApoGraphicEqPreset).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Desk Headphones',
        bands: expect.any(Array),
      })),
    );
    expect(window.echo.eq.savePreset).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'Desk Headphones' }));
    expect((await screen.findByRole('status')).textContent).toBe('Exported GraphicEQ config to D:\\Exports\\Desk Headphones GraphicEQ.txt');
  });

  it('imports an EQ preset file and applies the imported preset', async () => {
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Import preset / APO' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply import' }));

    await waitFor(() => expect(window.echo.eq.previewImportPreset).toHaveBeenCalled());
    await waitFor(() => expect(window.echo.eq.savePreset).toHaveBeenCalledWith(expect.objectContaining({ name: 'User Bright' })));
    await waitFor(() => expect(window.echo.eq.listPresets).toHaveBeenCalled());
    await waitFor(() => expect(window.echo.eq.setPreset).toHaveBeenCalledWith('user-bright'));
  });

  it('previews pasted Equalizer APO text and applies it as a preset', async () => {
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Paste APO' }));
    fireEvent.change(await screen.findByLabelText('APO text'), {
      target: {
        value: [
          'Preamp: -6 dB',
          'Filter 1: ON PK Fc 1000 Hz Gain -3 dB Q 1.4',
        ].join('\n'),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview APO' }));

    expect(await screen.findByText('Pasted APO')).toBeTruthy();
    expect(screen.getByText('Equalizer APO')).toBeTruthy();
    expect((screen.getByLabelText('Imported preset preamp') as HTMLInputElement).value).toBe('-6');

    fireEvent.click(screen.getByRole('button', { name: 'Apply import' }));

    await waitFor(() =>
      expect(window.echo.eq.savePreset).toHaveBeenCalledWith(expect.objectContaining({
        id: 'pasted-apo',
        name: 'Pasted APO',
        preampDb: -6,
        bands: expect.arrayContaining([
          expect.objectContaining({
            frequencyHz: 1000,
            gainDb: -3,
            q: 1.4,
            filterType: 'peaking',
          }),
        ]),
      })),
    );
    await waitFor(() => expect(window.echo.eq.setPreset).toHaveBeenCalledWith('pasted-apo'));
  });

  it('summarizes pasted APO headroom and applies the safe preamp before saving', async () => {
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Paste APO' }));
    fireEvent.change(await screen.findByLabelText('APO text'), {
      target: {
        value: [
          'Preamp: 0 dB',
          'Filter 1: ON PK Fc 80 Hz Gain 6 dB Q 1',
          'Filter 2: ON PK Fc 1000 Hz Gain -4 dB Q 1.2',
        ].join('\n'),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview APO' }));

    expect(await screen.findByText('Import safety')).toBeTruthy();
    expect(screen.getAllByText('Needs headroom').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+6.0 dB').length).toBeGreaterThan(0);
    expect(screen.getByText('+6.0 dB @ 80')).toBeTruthy();
    expect(screen.getByText('-4.0 dB @ 1k')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Use safe preamp' }));
    expect((screen.getByLabelText('Imported preset preamp') as HTMLInputElement).value).toBe('-6');
    fireEvent.click(screen.getByRole('button', { name: 'Apply import' }));

    await waitFor(() =>
      expect(window.echo.eq.savePreset).toHaveBeenCalledWith(expect.objectContaining({
        preampDb: -6,
      })),
    );
  });

  it('auditions pasted APO without saving and restores the previous EQ on cancel', async () => {
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Paste APO' }));
    fireEvent.change(await screen.findByLabelText('APO text'), {
      target: {
        value: [
          'Preamp: -6 dB',
          'Filter 1: ON PK Fc 1000 Hz Gain -3 dB Q 1.4',
        ].join('\n'),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview APO' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Audition import' }));

    await waitFor(() => expect(window.echo.eq.setEnabled).toHaveBeenCalledWith(true));
    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(-6));
    await waitFor(() => expect(window.echo.eq.setBandFrequency).toHaveBeenCalledWith({ band: 0, frequencyHz: 1000 }));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 0, gainDb: -3 }));
    expect(window.echo.eq.savePreset).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Update audition' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));

    await waitFor(() => expect(window.echo.eq.setEnabled).toHaveBeenCalledWith(false));
    await waitFor(() => expect(window.echo.eq.setPreamp).toHaveBeenCalledWith(0));
    await waitFor(() => expect(window.echo.eq.setBandGain).toHaveBeenCalledWith({ band: 1, gainDb: 6 }));
    expect(screen.queryByText('Pasted APO')).toBeNull();
    expect(window.echo.eq.savePreset).not.toHaveBeenCalled();
  });

  it('edits pasted APO filters before applying the imported preset', async () => {
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Paste APO' }));
    fireEvent.change(await screen.findByLabelText('APO text'), {
      target: {
        value: [
          'Preamp: -4 dB',
          'Filter 1: ON PK Fc 1000 Hz Gain -3 dB Q 1',
          'Filter 2: ON PK Fc 2500 Hz Gain 2 dB Q 1.2',
        ].join('\n'),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview APO' }));

    fireEvent.click(await screen.findByLabelText('Imported filter 1 enabled'));
    fireEvent.change(screen.getByLabelText('Imported preset preamp'), { target: { value: '-7.5' } });
    fireEvent.change(screen.getByLabelText('Imported filter 2 frequency'), { target: { value: '3200' } });
    fireEvent.change(screen.getByLabelText('Imported filter 2 gain'), { target: { value: '-1.5' } });
    fireEvent.change(screen.getByLabelText('Imported filter 2 Q'), { target: { value: '2.4' } });
    fireEvent.change(screen.getByLabelText('Imported filter 2 type'), { target: { value: 'lowShelf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply import' }));

    await waitFor(() =>
      expect(window.echo.eq.savePreset).toHaveBeenCalledWith(expect.objectContaining({
        preampDb: -7.5,
        bands: expect.arrayContaining([
          expect.objectContaining({
            frequencyHz: 1000,
            enabled: false,
          }),
          expect.objectContaining({
            frequencyHz: 3200,
            gainDb: -1.5,
            q: 2.4,
            filterType: 'lowShelf',
            enabled: true,
          }),
        ]),
      })),
    );
  });

  it('shows a scannable pasted APO filter list before applying', async () => {
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Paste APO' }));
    fireEvent.change(await screen.findByLabelText('APO text'), {
      target: {
        value: [
          'Preamp: -4 dB',
          ...Array.from({ length: 18 }, (_, index) =>
            `Filter ${index + 1}: ${index === 1 ? 'OFF' : 'ON'} PK Fc ${100 + index * 100} Hz Gain ${index % 4 - 2} dB Q 1`,
          ),
        ].join('\n'),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview APO' }));

    expect(await screen.findByText('Filter details')).toBeTruthy();
    expect(screen.getAllByText('enabled').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bypassed').length).toBeGreaterThan(0);
    expect(screen.queryByText('2 more filters hidden')).toBeNull();
    expect((screen.getByLabelText('Imported filter 18 frequency') as HTMLInputElement).value).toBe('1800');
  });

  it('filters presets by search and target curve category', async () => {
    renderEqPanel();

    fireEvent.change(await screen.findByLabelText('Search presets'), { target: { value: '哈曼' } });
    fireEvent.click(screen.getByRole('button', { name: 'Target curves' }));
    fireEvent.click(screen.getByRole('button', { name: 'EQ preset' }));

    expect(screen.getByRole('option', { name: '暖场哈曼' })).toBeTruthy();
  });

  it('groups correction PEQ presets under utility metadata', async () => {
    renderEqPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Utility' }));
    fireEvent.click(screen.getByRole('button', { name: 'EQ preset' }));

    expect(screen.getByRole('option', { name: '暗涌滤波' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '齿音柔化' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '蓝牙清场' })).toBeTruthy();
  });

  it('shows channel balance controls and clamps channel balance patches', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    fireEvent.change(await screen.findByLabelText('Balance'), { target: { value: '400' } });
    fireEvent.change(screen.getByLabelText('Left Gain'), { target: { value: '-50' } });
    fireEvent.change(screen.getByLabelText('Right Delay'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sum' }));

    await waitFor(() => expect(window.echo.eq.setChannelBalanceState).toHaveBeenCalledWith({ balance: 1 }));
    await waitFor(() => expect(window.echo.eq.setChannelBalanceState).toHaveBeenCalledWith({ leftGainDb: -12 }));
    await waitFor(() => expect(window.echo.eq.setChannelBalanceState).toHaveBeenCalledWith({ rightDelayMs: 10 }));
    await waitFor(() => expect(window.echo.eq.setChannelBalanceState).toHaveBeenCalledWith({ monoMode: 'sum' }));
  });

  it('applies spatial calibration measurements to gain and delay trims', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    fireEvent.change(await screen.findByLabelText('Left distance'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Right distance'), { target: { value: '134.3' } });
    fireEvent.change(screen.getByLabelText('Left SPL'), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText('Right SPL'), { target: { value: '72' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply measurement' }));

    await waitFor(() =>
      expect(window.echo.eq.setChannelBalanceState).toHaveBeenCalledWith({
        enabled: true,
        balance: 0,
        leftGainDb: -3,
        rightGainDb: 0,
        leftDelayMs: 1,
        rightDelayMs: 0,
        monoMode: 'off',
        swapLeftRight: false,
        invertLeft: false,
        invertRight: false,
      }),
    );
  });

  it('nudges spatial calibration from listening checks', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Image pulls left' }));
    await waitFor(() =>
      expect(window.echo.eq.setChannelBalanceState).toHaveBeenCalledWith({
        enabled: true,
        monoMode: 'off',
        leftDelayMs: 0.05,
        rightDelayMs: 0,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Right is louder' }));
    await waitFor(() =>
      expect(window.echo.eq.setChannelBalanceState).toHaveBeenCalledWith({
        enabled: true,
        monoMode: 'off',
        leftGainDb: 0,
        rightGainDb: -0.2,
      }),
    );
  });

  it('resets monitor tools without changing balance or gain trim', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Reset monitor tools' }));

    await waitFor(() =>
      expect(window.echo.eq.setChannelBalanceState).toHaveBeenCalledWith({
        monoMode: 'off',
        swapLeftRight: false,
        invertLeft: false,
        invertRight: false,
        constantPower: true,
      }),
    );
  });

  it('shows channel calibration effective gain and resets trims separately', async () => {
    renderEqPanel();
    await showAdvancedEqTools();

    fireEvent.click(await screen.findByLabelText('Calibration mode'));
    expect(screen.getByText('Effective L')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset trims only' }));

    await waitFor(() =>
      expect(window.echo.eq.setChannelBalanceState).toHaveBeenCalledWith({
        balance: 0,
        leftGainDb: 0,
        rightGainDb: 0,
      }),
    );
  });

  it('renders EQ panel keys across supported locales', async () => {
    for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP']) {
      cleanup();
      window.localStorage.setItem('echo-next.locale', locale);
      renderEqPanel();
      expect(await screen.findByRole('img')).toBeTruthy();
      expect(screen.queryByText(/settings\.eq\./)).toBeNull();
    }
  });
});
