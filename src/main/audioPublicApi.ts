// Audio domain public API — the only import surface non-audio modules should use.
// All exports are re-exports from src/main/audio/ internals.

// ── Audio Session ──
export { getAudioSession, disposeDefaultAudioSessionGracefully } from './audio/AudioSession';
export type { AudioErrorRecoveryHandler } from './audio/AudioSession';

// ── Playback Memory / Session ──
export { getPlaybackMemoryStore } from './audio/PlaybackMemoryStore';
export type { PlaybackMemory } from './audio/PlaybackMemoryStore';
export { getPlaybackSessionStore, normalizePersistedPlaybackSession } from './audio/PlaybackSessionStore';

// ── FFmpeg Toolchain ──
export { resolveFfmpegToolchain } from './audio/FfmpegToolchain';
export type { FfmpegToolchainInfo } from './audio/FfmpegToolchain';

// ── Cue Sheet ──
export {
  createCueTrackPath,
  readCueSheet,
  readEmbeddedCueSheet,
  resolveCueTrack,
} from './audio/CueSheet';

// ── Audio Authenticity ──
export { AudioAuthenticityAnalyzer } from './audio/AudioAuthenticityAnalyzer';

// ── ALAC / MP4 / Sample Rate (library metadata) ──
export {
  readTagLibAudioTechnicalMetadata,
  shouldPreferTagLibForAlacTechnicalFields,
} from './audio/AlacTechnicalMetadata';
export { resolveMp4ContainerAudioCodec } from './audio/Mp4AudioCodec';
export { normalizeAudioSampleRate } from './audio/SampleRateGuards';

// ── Types ──
export type {
  AudioSessionAutomixRequest,
  AudioSessionGaplessRequest,
} from './audio/audioTypes';
