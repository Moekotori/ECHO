import type { TranslationKey } from '../../i18n/locales';
import { translateStatic } from '../../i18n/translateStatic';

const nonActionableAudioErrorPatterns = [
  /^Desktop bridge unavailable\b/u,
  /\becho_authorization_required\b/u,
  /\bconnect_(?:donator_unlock_required|hwid_not_allowed)\b/u,
  /\beq_control_(?:closed|disconnected)\b/u,
  /\beq_control_sync_skipped\b/u,
  /\baudio_session_run_cancelled\b/u,
  /\bplay\(\) request was interrupted by a call to (?:pause|load)\(\)/iu,
];

const nativeAccessViolationPattern =
  /\bnativeCrash=access_violation\b|\bexitCodeHex=0xC0000005\b|\becho-audio-host\s+exit_code_-?(?:3221225477|1073741819)\b/iu;
const confirmedDamagedAudioFilePattern = /\baudio_file_decode_failed_or_corrupt\b/iu;
const audioDecodeFailurePattern =
  /\bsystem_audio_decode_error\b|\bkind="input_invalid"\b|invalid data found when processing input|decode_frame\(\) failed|error while decoding stream/iu;
const exclusiveOutputFailurePattern =
  /\bexclusive_output_(?:fallback_blocked|fell_back_to_shared|unstable)\b|\bexclusive_denied\b|\bmode="exclusive"\b.*Failed to initialize output device|\bWASAPI exclusive\b.*(?:failed|unsupported|denied)|\b0x88890008\b/iu;
const nativeOutputInitializeFailurePattern = /\bFailed to initialize output device\b|\bnative_writable_error\b/iu;

const tAudio = (key: TranslationKey): string => translateStatic(key);

export const shouldSuppressAudioHostError = (error: string | null | undefined): boolean => {
  if (!error) {
    return true;
  }

  return nonActionableAudioErrorPatterns.some((pattern) => pattern.test(error));
};

export const formatAudioHostError = (error: string | null | undefined): string | null => {
  if (shouldSuppressAudioHostError(error)) {
    return null;
  }

  if (!error) {
    return null;
  }

  if (confirmedDamagedAudioFilePattern.test(error)) {
    return tAudio('audioError.corruptFile');
  }

  if (audioDecodeFailurePattern.test(error)) {
    return tAudio('audioError.decodeFailed');
  }

  if (/\bsystem_audio_seek_timeout\b|\bsystem_audio_range_(?:not_supported|not_satisfiable)\b/u.test(error)) {
    return tAudio('audioError.seekUnsupported');
  }

  if (/\bsystem_audio_playback_failed\b|\bsystem_audio_source_empty\b|\bMEDIA_ERR_\w+\b|\bHTMLMediaElement\b|\bNotSupportedError\b/u.test(error)) {
    return tAudio('audioError.systemPlaybackFailed');
  }

  if (exclusiveOutputFailurePattern.test(error)) {
    return tAudio('audioError.exclusiveFailed');
  }

  if (nativeOutputInitializeFailurePattern.test(error)) {
    return tAudio('audioError.deviceInitFailed');
  }

  if (/\bdevice_initialize_timeout\b/u.test(error)) {
    return tAudio('audioError.deviceTimeout');
  }

  if (error.includes('echo-audio-host timeout_waiting_for_ready')) {
    return tAudio('audioError.hostReadyTimeout');
  }

  if (error.includes('echo-audio-host spawn_error:')) {
    return tAudio('audioError.hostSpawnFailed');
  }

  if (/\bspawn\s+EFTYPE\b|\bnot a valid Win32 application\b|%1 is not a valid Win32 application/iu.test(error)) {
    return tAudio('audioError.hostInvalidExe');
  }

  if (nativeAccessViolationPattern.test(error)) {
    return tAudio('audioError.hostAccessViolation');
  }

  if (/\becho-audio-host (exit_code_-?\d+|exit_signal_|exclusive_denied)/u.test(error)) {
    return tAudio('audioError.hostExitFailed');
  }

  return tAudio('audioError.generic');
};
