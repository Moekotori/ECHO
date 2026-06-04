const nonActionableAudioErrorPatterns = [
  /^Desktop bridge unavailable\b/u,
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
    return '音频文件可能已经损坏或不完整，ECHO 已停止播放这首歌。请重新获取这份音频文件。';
  }

  if (audioDecodeFailurePattern.test(error)) {
    return '音频解码失败，ECHO 已停止播放这首歌。请尝试重新播放；如果只在这首歌上稳定复现，再检查文件或重新导入。';
  }

  if (/\bsystem_audio_seek_timeout\b|\bsystem_audio_range_(?:not_supported|not_satisfiable)\b/u.test(error)) {
    return '系统音频无法跳转到该位置，可能是文件或网络源不支持拖动';
  }

  if (/\bsystem_audio_playback_failed\b|\bsystem_audio_source_empty\b|\bMEDIA_ERR_\w+\b|\bHTMLMediaElement\b|\bNotSupportedError\b/u.test(error)) {
    return '系统音频播放失败，请尝试重新播放或切换到兼容输出';
  }

  if (/\bdevice_initialize_timeout\b/u.test(error)) {
    return '设备驱动响应过慢,可能是 USB DAC 异常。建议重新插拔 USB,或在设置里点"重启音频引擎"。';
  }

  if (error.includes('echo-audio-host timeout_waiting_for_ready')) {
    return '音频输出启动超时，可能是驱动初始化太慢、设备被占用，或采样率/缓冲设置被拒绝。';
  }

  if (error.includes('echo-audio-host spawn_error:')) {
    return '音频引擎无法启动，请检查 native host 是否存在或被安全软件拦截。';
  }

  if (/\bspawn\s+EFTYPE\b|\bnot a valid Win32 application\b|%1 is not a valid Win32 application/iu.test(error)) {
    return '音频引擎无法启动：程序文件不是有效的 Windows 可执行文件。请重新安装或重新打包，避免 echo-audio-host.exe / ffmpeg.exe 被损坏或替换。';
  }

  if (nativeAccessViolationPattern.test(error)) {
    return '音频引擎在启动 Windows 共享输出时崩溃。请先重启音频引擎或 Windows 音频服务；仍复现时，可在设置 > 播放把共享后端临时切到 DirectSound 兼容。';
  }

  if (/\becho-audio-host (exit_code_-?\d+|exit_signal_|exclusive_denied)/u.test(error)) {
    return '音频输出设备启动失败，可能是设备拒绝当前输出模式、采样率或缓冲设置。';
  }

  return error;
};
