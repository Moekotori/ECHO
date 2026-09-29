import { describe, expect, it } from 'vitest';
import type { HqPlayerPlaybackHandoffPlan } from '../../../shared/types/hqplayer';
import { createHqPlayerPlaybackControlPlan } from './HqPlayerControlAdapter';

type HandoffPlanInput = Omit<HqPlayerPlaybackHandoffPlan, 'control'>;

const basePlan = {
  endpoint: {
    connectionMode: 'localDesktop' as const,
    host: '127.0.0.1',
    port: 4321,
  },
  defaultPlaybackBackend: 'hqplayer' as const,
  profileName: 'HQ Linear',
  createdAt: '2026-05-20T10:00:00.000Z',
};

describe('HqPlayerControlAdapter', () => {
  it('creates a dry-run play-source plan from a ready handoff without exposing header values', () => {
    const handoff: HandoffPlanInput = {
      ...basePlan,
      state: 'ready',
      reason: null,
      source: {
        trackId: 'track-1',
        mediaType: 'streaming',
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        url: 'http://127.0.0.1:17890/hqplayer-media/token',
        exposure: 'media-server',
        headers: { Authorization: 'Bearer secret' },
        mimeType: 'audio/flac',
        expiresAt: '2026-05-20T11:00:00.000Z',
        durationSeconds: 180,
        startSeconds: 14,
        mediaServer: null,
        streaming: {
          provider: 'netease',
          providerTrackId: 'song-1',
          bitrate: 900000,
          sampleRate: 96000,
          bitDepth: 24,
          codec: 'flac',
          supportsRange: true,
        },
      },
      fallback: null,
    };

    const plan = createHqPlayerPlaybackControlPlan(handoff);

    expect(plan).toMatchObject({
      state: 'prepared',
      reason: null,
      action: 'play-source',
      transport: 'dry-run',
      source: {
        trackId: 'track-1',
        exposure: 'media-server',
        hasHeaders: true,
      },
      metadata: {
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        durationSeconds: 180,
      },
      startSeconds: 14,
    });
    expect(JSON.stringify(plan)).not.toContain('Bearer secret');
  });

  it('skips control planning when handoff falls back to ECHO playback', () => {
    const handoff: HandoffPlanInput = {
      ...basePlan,
      state: 'fallback',
      reason: 'echo_native_selected',
      source: null,
      fallback: {
        backend: 'echoNative',
        reason: 'echo_native_selected',
      },
    };

    expect(createHqPlayerPlaybackControlPlan(handoff)).toMatchObject({
      state: 'skipped',
      reason: 'handoff_not_ready',
      action: 'none',
      source: null,
      metadata: null,
      startSeconds: null,
    });
  });
});
