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

const genericAudioPlaybackFailureMessage =
  '播放没有成功。ECHO 已保留详细诊断；你可以先重试播放，或在“设置 > 播放”里临时切换到兼容输出。';

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
    return '这首音频文件可能已经损坏或不完整，ECHO 已停止播放它。建议重新获取这份文件后再导入。';
  }

  if (audioDecodeFailurePattern.test(error)) {
    return '这首歌暂时解码失败。可以先重试播放；如果只在这首歌上稳定复现，再检查文件完整性或重新导入。';
  }

  if (/\bsystem_audio_seek_timeout\b|\bsystem_audio_range_(?:not_supported|not_satisfiable)\b/u.test(error)) {
    return '当前位置暂时跳不过去，可能是文件或网络来源不支持拖动。';
  }

  if (/\bsystem_audio_playback_failed\b|\bsystem_audio_source_empty\b|\bMEDIA_ERR_\w+\b|\bHTMLMediaElement\b|\bNotSupportedError\b/u.test(error)) {
    return '系统播放器没有成功播放这首歌。可以重试一次，或切换到兼容输出后再播放。';
  }

  if (exclusiveOutputFailurePattern.test(error)) {
    return 'WASAPI 独占输出没有成功。可能是设备不支持当前格式，或正被其他应用占用；可以先切回 WASAPI Shared 再播放。';
  }

  if (nativeOutputInitializeFailurePattern.test(error)) {
    return '音频设备初始化失败。请确认输出设备仍在线；如果刚插拔过 DAC，可以先重启音频引擎或降低采样率/缓冲设置。';
  }

  if (/\bdevice_initialize_timeout\b/u.test(error)) {
    return '音频设备响应太慢，可能是 USB DAC 或驱动暂时卡住。建议重新插拔 USB，或在设置里重启音频引擎。';
  }

  if (error.includes('echo-audio-host timeout_waiting_for_ready')) {
    return '音频输出启动超时。通常是驱动初始化太慢、设备被占用，或当前采样率/缓冲设置被设备拒绝。';
  }

  if (error.includes('echo-audio-host spawn_error:')) {
    return '音频引擎无法启动。请检查 native host 是否存在，或是否被安全软件拦截。';
  }

  if (/\bspawn\s+EFTYPE\b|\bnot a valid Win32 application\b|%1 is not a valid Win32 application/iu.test(error)) {
    return '音频引擎无法启动：程序文件不是有效的 Windows 可执行文件。建议重新安装或重新打包，避免 echo-audio-host.exe / ffmpeg.exe 被损坏或替换。';
  }

  if (nativeAccessViolationPattern.test(error)) {
    return '音频引擎在启动 Windows 输出时崩溃。可以先重启音频引擎或 Windows 音频服务；仍复现时，临时切到 DirectSound 兼容输出。';
  }

  if (/\becho-audio-host (exit_code_-?\d+|exit_signal_|exclusive_denied)/u.test(error)) {
    return '音频输出设备启动失败，可能是设备拒绝了当前输出模式、采样率或缓冲设置。';
  }

  return genericAudioPlaybackFailureMessage;
};
