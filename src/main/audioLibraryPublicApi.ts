// Lightweight audio-domain surface for library scanning and metadata repair.
// Keep this separate from audioPublicApi so scan startup does not initialize
// playback, output, Electron window, or runtime-component modules.
export {
  createCueTrackPath,
  readCueSheet,
  readEmbeddedCueSheet,
  resolveCueTrack,
} from './audio/CueSheet';
export {
  readTagLibAudioTechnicalMetadata,
  shouldPreferTagLibForAlacTechnicalFields,
} from './audio/AlacTechnicalMetadata';
export { resolveMp4ContainerAudioCodec } from './audio/Mp4AudioCodec';
export { normalizeAudioSampleRate } from './audio/SampleRateGuards';
