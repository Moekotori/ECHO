import { describe, expect, it } from 'vitest';
import { parseAudioCdTracksFromFfmpegOutput, parseWindowsAudioCdDrives } from './AudioCdService';

const testDrive = {
  id: 'cd:D:',
  device: 'D:',
};

describe('AudioCdService parsers', () => {
  it('parses Windows CD-ROM drive JSON from PowerShell', () => {
    const drives = parseWindowsAudioCdDrives(JSON.stringify({
      Drive: 'D:',
      MediaLoaded: true,
      Name: 'HL-DT-ST DVDRAM',
      VolumeName: 'ALBUM_DISC',
    }));

    expect(drives).toEqual([{
      id: 'cd:D:',
      device: 'D:',
      name: 'HL-DT-ST DVDRAM',
      mediaLoaded: true,
      driveLetter: 'D',
      volumeName: 'ALBUM_DISC',
    }]);
  });

  it('parses ffmetadata chapters into playable Audio CD tracks', () => {
    const tracks = parseAudioCdTracksFromFfmpegOutput(testDrive, [
      ';FFMETADATA1',
      '[CHAPTER]',
      'TIMEBASE=1/75',
      'START=0',
      'END=37108',
      'title=Intro',
      '[CHAPTER]',
      'TIMEBASE=1/75',
      'START=37108',
      'END=56868',
      'title=Main Theme',
    ].join('\n'));

    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      id: 'cd:D::track-01',
      driveId: 'cd:D:',
      device: 'D:',
      index: 1,
      title: 'Intro',
      startSeconds: 0,
      playable: true,
    });
    expect(tracks[0].durationSeconds).toBeCloseTo(494.77, 2);
    expect(tracks[1]).toMatchObject({
      index: 2,
      title: 'Main Theme',
      playable: true,
    });
    expect(tracks[1].startSeconds).toBeCloseTo(494.77, 2);
    expect(tracks[1].durationSeconds).toBeCloseTo(263.47, 2);
  });

  it('parses FFmpeg probe chapter logs when metadata export is unavailable', () => {
    const tracks = parseAudioCdTracksFromFfmpegOutput(testDrive, [
      'Input #0, libcdio, from \'D:\':',
      '  Chapters:',
      '    Chapter #0:0: start 0.000000, end 208.426667',
      '    Chapter #0:1: start 208.426667, end 421.173333',
    ].join('\n'));

    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      index: 1,
      title: 'Track 01',
      playable: true,
    });
    expect(tracks[0].durationSeconds).toBeCloseTo(208.43, 2);
    expect(tracks[1].startSeconds).toBeCloseTo(208.43, 2);
  });
});
