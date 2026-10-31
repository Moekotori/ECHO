import type { AudioOutputSettings, AudioStatus } from './audio';

export type AudioCdDrive = {
  id: string;
  device: string;
  name: string;
  mediaLoaded: boolean;
  driveLetter?: string | null;
  volumeName?: string | null;
  error?: string | null;
};

export type AudioCdTrack = {
  id: string;
  driveId: string;
  device: string;
  index: number;
  title: string;
  startSeconds: number | null;
  endSeconds: number | null;
  durationSeconds: number | null;
  playable: boolean;
};

export type AudioCdStatus = {
  ffmpegAvailable: boolean;
  libcdioAvailable: boolean;
  drives: AudioCdDrive[];
  selectedDriveId: string | null;
  tracks: AudioCdTrack[];
  error: string | null;
};

export type AudioCdPlayTrackRequest = {
  driveId?: string | null;
  device?: string | null;
  trackIndex: number;
  output?: AudioOutputSettings;
};

export type AudioCdApi = {
  getStatus: (driveId?: string | null) => Promise<AudioCdStatus>;
  playTrack: (request: AudioCdPlayTrackRequest) => Promise<AudioStatus>;
};
