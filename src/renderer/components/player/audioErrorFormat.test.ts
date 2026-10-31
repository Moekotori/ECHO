import { describe, expect, it } from 'vitest';
import { fallbackTranslations } from '../../i18n/locales';
import { formatAudioHostError, shouldSuppressAudioHostError } from './audioErrorFormat';

describe('audio error formatting', () => {
  it('suppresses non-actionable playback control errors', () => {
    const messages = [
      "Error invoking remote method 'playback:play-local-file': Error: eq_control_disconnected",
      'eq_control_closed',
      'eq_control_sync_skipped',
      'audio_session_run_cancelled',
      'echo_authorization_required',
      "Error invoking remote method 'connect:connect': Error: connect_donator_unlock_required",
      'connect_hwid_not_allowed',
      'The play() request was interrupted by a call to pause(). https://goo.gl/LdLk22',
    ];

    for (const message of messages) {
      expect(shouldSuppressAudioHostError(message)).toBe(true);
      expect(formatAudioHostError(message)).toBeNull();
    }
  });

  it('keeps actionable playback errors visible', () => {
    const message = 'echo-audio-host spawn_error: missing binary';

    expect(shouldSuppressAudioHostError(message)).toBe(false);
    expect(formatAudioHostError(message)).toBe(fallbackTranslations['audioError.hostSpawnFailed']);
  });

  it('formats confirmed local corrupt-file failures as a damaged file message', () => {
    expect(formatAudioHostError('audio_file_decode_failed_or_corrupt; positionSeconds=42.000; durationSeconds=120.000')).toBe(
      fallbackTranslations['audioError.corruptFile'],
    );
  });

  it('formats broad decode failures without claiming the file is damaged', () => {
    const formatted = formatAudioHostError(
      'ffmpeg_exit_code_69; kind="input_invalid"; stderr="Invalid data found when processing input"',
    );

    expect(formatted).toBe(fallbackTranslations['audioError.decodeFailed']);
    expect(formatAudioHostError('system_audio_decode_error; positionSeconds=172.450; durationSeconds=221.565')).toBe(
      formatted,
    );
  });

  it('formats system audio seek failures as a plain playback message', () => {
    expect(formatAudioHostError('system_audio_seek_timeout')).toBe(fallbackTranslations['audioError.seekUnsupported']);
    expect(formatAudioHostError('system_audio_range_not_satisfiable')).toBe(fallbackTranslations['audioError.seekUnsupported']);
  });

  it('formats system audio media failures without suggesting the native engine failed', () => {
    const formatted = formatAudioHostError('system_audio_playback_failed');

    expect(formatted).toBe(fallbackTranslations['audioError.systemPlaybackFailed']);
    expect(formatted).not.toContain('音频引擎');
  });

  it('formats output device failures with concrete next actions', () => {
    const exclusive = formatAudioHostError('exclusive_output_fallback_blocked');
    const native = formatAudioHostError('native_writable_error: device failed');

    expect(exclusive).toBe(fallbackTranslations['audioError.exclusiveFailed']);
    expect(native).toBe(fallbackTranslations['audioError.deviceInitFailed']);
  });

  it('formats exclusive WASAPI format errors without exposing raw IPC details', () => {
    const message =
      'Error invoking remote method playback:play-local-file: Error: echo-audio-host runtime_error; mode="exclusive"; nativeMessage="WASAPI exclusive open failed: WASAPI exclusive format unsupported (hr=0x88890008)"';
    const formatted = formatAudioHostError(message);

    expect(formatted).toBe(fallbackTranslations['audioError.exclusiveFailed']);
    expect(formatted).not.toContain('Error invoking remote method');
    expect(formatted).not.toContain('0x88890008');
  });

  it('formats invalid executable spawn errors as an audio engine startup problem', () => {
    const message = "Error invoking remote method 'playback:play-local-file': Error: spawn EFTYPE";

    expect(formatAudioHostError(message)).toBe(fallbackTranslations['audioError.hostInvalidExe']);
  });

  it('formats Windows native access violations without exposing the raw IPC error', () => {
    const message =
      "Error invoking remote method 'playback:play-media-item': Error: echo-audio-host exit_code_3221225477; mode=\"shared\"; exitCodeHex=0xC0000005; nativeCrash=access_violation";

    const formatted = formatAudioHostError(message);

    expect(formatted).toBe(fallbackTranslations['audioError.hostAccessViolation']);
    expect(formatted).not.toContain('Error invoking remote method');
  });

  it('formats signed native access violation exit codes without exposing the raw IPC error', () => {
    const message =
      "Error invoking remote method 'playback:play-media-item': Error: echo-audio-host exit_code_-3221225477; mode=\"shared\"";

    const formatted = formatAudioHostError(message);

    expect(formatted).toBe(fallbackTranslations['audioError.hostAccessViolation']);
    expect(formatted).not.toContain('Error invoking remote method');
  });
});
