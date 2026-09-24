import { describe, expect, it } from 'vitest';
import { normalizeAudioOutputSettings } from './normalizeAudioOutputSettings';

describe('normalizeAudioOutputSettings', () => {
  it('preserves valid advanced PCM, ECHO SRC, and SDM settings', () => {
    const advancedOutput = {
      outputMode: 'exclusive',
      echoSrcMode: 'family4x',
      echoSrcQualityProfile: 'transparent',
      echoSrcAdvancedModeEnabled: true,
      echoSrcFilterProfile: 'poly-sinc-ext2-short',
      echoSrcFilterProfile1x: 'poly-sinc-hb',
      echoSrcFilterProfileNx: 'sinc-xla',
      echoSrcComputeBackend: 'cuda',
      pcmDitherMode: 'ultra-shaped',
      sdmMode: 'pcmToDsd',
      sdmTargetRate: 'dsd256',
      sdmQualityProfile: 'reference',
      sdmComputeBackend: 'cuda',
      sdmOversamplingFilterProfile1x: 'poly-sinc-hb',
      sdmOversamplingFilterProfileNx: 'sinc-xla',
    };

    expect(normalizeAudioOutputSettings(advancedOutput, 'win32')).toEqual(advancedOutput);
  });

  it('drops invalid advanced DSP values rather than forwarding an unsafe request', () => {
    expect(normalizeAudioOutputSettings({
      outputMode: 'exclusive',
      echoSrcMode: 'invalid-mode',
      echoSrcQualityProfile: 'invalid-quality',
      echoSrcAdvancedModeEnabled: 'enabled',
      echoSrcFilterProfile: 'invalid-filter',
      echoSrcFilterProfile1x: 'invalid-filter',
      echoSrcFilterProfileNx: 'invalid-filter',
      echoSrcComputeBackend: 'opencl',
      pcmDitherMode: 'invalid-dither',
      sdmMode: 'invalid-mode',
      sdmTargetRate: 'dsd1024',
      sdmQualityProfile: 'invalid-quality',
      sdmComputeBackend: 'opencl',
      sdmOversamplingFilterProfile1x: 'invalid-filter',
      sdmOversamplingFilterProfileNx: 'invalid-filter',
    }, 'win32')).toEqual({ outputMode: 'exclusive' });
  });
});
