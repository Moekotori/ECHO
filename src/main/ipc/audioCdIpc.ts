import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AudioStatus } from '../../shared/types/audio';
import type { AudioCdPlayTrackRequest, AudioCdStatus } from '../../shared/types/audioCd';
import { getAudioCdService } from '../audio/AudioCdService';
import { getAudioSession } from '../audio/AudioSession';
import { noteDataProtectionPlaybackActivity } from '../app/dataProtection';
import { syncSmtcStatus } from '../integrations/smtc/SmtcStatusSync';
import { enqueueAudioCommand } from './audioCommandQueue';

const normalizeDriveId = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const normalizePlayTrackRequest = (value: unknown): AudioCdPlayTrackRequest => {
  if (!value || typeof value !== 'object') {
    throw new Error('audio_cd_play_request_required');
  }

  const record = value as Record<string, unknown>;
  return {
    driveId: normalizeDriveId(record.driveId),
    device: normalizeDriveId(record.device),
    trackIndex: Number(record.trackIndex),
    output: record.output && typeof record.output === 'object'
      ? record.output as AudioCdPlayTrackRequest['output']
      : undefined,
  };
};

export const registerAudioCdIpc = (): void => {
  ipcMain.handle(IpcChannels.AudioCdGetStatus, (_event, driveId: unknown): Promise<AudioCdStatus> =>
    getAudioCdService().getStatus(normalizeDriveId(driveId)),
  );

  ipcMain.handle(IpcChannels.AudioCdPlayTrack, async (_event, rawRequest: unknown): Promise<AudioStatus> =>
    enqueueAudioCommand(async () => {
      const request = normalizePlayTrackRequest(rawRequest);
      const { drive, track, stream } = await getAudioCdService().createTrackPcmStream(request);
      noteDataProtectionPlaybackActivity(true);
      const status = await getAudioSession().playPcmStream({
        stream,
        sourceId: track.id,
        trackId: track.id,
        metadata: {
          title: track.title,
          artist: 'Audio CD',
          album: drive.volumeName || drive.name,
          albumArtist: 'Audio CD',
        },
        sampleRate: 44_100,
        channels: 2,
        decoderBackendImpl: 'ffmpeg-libcdio-pcm',
        durationSeconds: track.durationSeconds ?? undefined,
        output: request.output,
      });
      void syncSmtcStatus();
      return status;
    }),
  );
};
