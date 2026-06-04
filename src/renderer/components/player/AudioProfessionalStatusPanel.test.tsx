// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AudioStatus } from '../../../shared/types/audio';
import { I18nProvider } from '../../i18n/I18nProvider';
import { AudioProfessionalStatusPanel } from './AudioProfessionalStatusPanel';

const roomCorrectionStatus = (): AudioStatus => ({
  outputMode: 'exclusive',
  actualDeviceSampleRate: 48000,
  requestedOutputSampleRate: 48000,
  bitPerfectCandidate: false,
  bitPerfectDisabledReason: 'room_correction_enabled',
  roomCorrectionEnabled: true,
  dspActive: true,
  warnings: ['room_correction_bit_perfect_disabled', 'room_correction_clipping_risk'],
  state: 'playing',
} as unknown as AudioStatus);

beforeEach(() => {
  window.localStorage.setItem('echo-next.locale', 'en-US');
});

afterEach(() => {
  cleanup();
});

describe('AudioProfessionalStatusPanel', () => {
  it('renders friendly Room Correction DSP warnings', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={roomCorrectionStatus()} />
      </I18nProvider>,
    );

    expect(screen.getByText('DSP active')).toBeTruthy();
    expect(screen.getByText(/Room correction disables bit-perfect output/u)).toBeTruthy();
    expect(screen.getByText(/Room correction output has clipping risk/u)).toBeTruthy();
  });
});
