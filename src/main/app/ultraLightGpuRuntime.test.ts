import { describe, expect, it } from 'vitest';
import {
  createNormalRuntimeArgs,
  createUltraLightGpuRuntimeArgs,
  getUltraLightGpuRuntimeEntryMode,
  getUltraLightGpuRuntimeResumePlayback,
  getUltraLightNormalRuntimeHandoff,
  isUltraLightGpuRuntime,
  prepareNormalRuntimeRelaunch,
  shouldInitializeFullMainControlPlane,
} from './ultraLightGpuRuntime';

describe('ultraLightGpuRuntime', () => {
  it('adds the GPU-disabled runtime marker exactly once', () => {
    const args = createUltraLightGpuRuntimeArgs(['electron', '.', '--echo-ultra-light-gpu-runtime']);

    expect(args).toEqual(['.', '--echo-ultra-light-gpu-runtime']);
    expect(isUltraLightGpuRuntime(args)).toBe(true);
    expect(getUltraLightGpuRuntimeEntryMode(args)).toBe('manual');
  });

  it('preserves automatic tray entry across the GPU-disabled relaunch', () => {
    const args = createUltraLightGpuRuntimeArgs(
      ['electron', '.', '--echo-ultra-light-entry=tray-auto'],
      'tray-auto',
    );

    expect(args).toEqual([
      '.',
      '--echo-ultra-light-gpu-runtime',
      '--echo-ultra-light-entry=tray-auto',
    ]);
    expect(getUltraLightGpuRuntimeEntryMode(['electron', ...args])).toBe('tray-auto');
  });

  it('preserves automatic minimize entry separately from tray hiding', () => {
    const args = createUltraLightGpuRuntimeArgs(
      ['electron', '.', '--echo-ultra-light-entry=tray-auto'],
      'minimize-auto',
    );

    expect(args).toEqual([
      '.',
      '--echo-ultra-light-gpu-runtime',
      '--echo-ultra-light-entry=minimize-auto',
    ]);
    expect(getUltraLightGpuRuntimeEntryMode(['electron', ...args])).toBe('minimize-auto');
  });

  it('carries the playing intent into the GPU-disabled runtime exactly once', () => {
    const args = createUltraLightGpuRuntimeArgs(
      ['electron', '.', '--echo-ultra-light-resume-playback'],
      'tray-auto',
      { resumePlayback: true },
    );

    expect(args).toEqual([
      '.',
      '--echo-ultra-light-gpu-runtime',
      '--echo-ultra-light-entry=tray-auto',
      '--echo-ultra-light-resume-playback',
    ]);
    expect(getUltraLightGpuRuntimeResumePlayback(['electron', ...args])).toBe(true);
    expect(getUltraLightGpuRuntimeResumePlayback(['electron', '.'])).toBe(false);
  });

  it('removes the marker when returning to the normal GPU runtime', () => {
    expect(createNormalRuntimeArgs(['electron', '.', '--echo-ultra-light-gpu-runtime']))
      .toEqual(['.']);
  });

  it('skips the renderer control plane only in the GPU-disabled Ultralight runtime', () => {
    expect(shouldInitializeFullMainControlPlane(['electron', '.'])).toBe(true);
    expect(shouldInitializeFullMainControlPlane([
      'electron',
      '.',
      '--echo-ultra-light-gpu-runtime',
    ])).toBe(false);
  });

  it('drops the transient renderer dev URL before relaunching the normal runtime', () => {
    const environment = {
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
      ECHO_KEEP_ME: '1',
    };

    expect(prepareNormalRuntimeRelaunch(
      ['electron', '.', '--echo-ultra-light-gpu-runtime'],
      environment,
    )).toEqual(['.']);
    expect(environment).toEqual({ ECHO_KEEP_ME: '1' });
  });

  it('carries a validated restore action and playback intent into the normal runtime', () => {
    const args = prepareNormalRuntimeRelaunch(
      ['electron', '.', '--echo-ultra-light-gpu-runtime'],
      {},
      { pendingAction: 'openAudioSettings', resumePlayback: true },
    );

    expect(args).toEqual([
      '.',
      '--echo-ultra-light-restore-action=openAudioSettings',
      '--echo-ultra-light-resume-playback',
    ]);
    expect(getUltraLightNormalRuntimeHandoff(['electron', ...args])).toEqual({
      pendingAction: 'openAudioSettings',
      resumePlayback: true,
    });
  });

  it('drops stale handoff markers and rejects unknown restore actions', () => {
    expect(createNormalRuntimeArgs([
      'electron',
      '.',
      '--echo-ultra-light-gpu-runtime',
      '--echo-ultra-light-restore-action=not-real',
      '--echo-ultra-light-resume-playback',
    ])).toEqual(['.']);
    expect(getUltraLightNormalRuntimeHandoff([
      'electron',
      '.',
      '--echo-ultra-light-restore-action=not-real',
    ])).toEqual({ pendingAction: undefined, resumePlayback: false });
  });
});
