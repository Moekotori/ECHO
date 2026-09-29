import { spawn as nodeSpawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import type { Readable } from 'node:stream';
import type { AudioCdDrive, AudioCdPlayTrackRequest, AudioCdStatus, AudioCdTrack } from '../../shared/types/audioCd';
import { resolveFfmpegToolchainPath } from './FfmpegToolchain';

type SpawnFn = typeof nodeSpawn;

type ProcessResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

type AudioCdCapabilities = {
  ffmpegAvailable: boolean;
  libcdioAvailable: boolean;
};

export type AudioCdServiceDependencies = {
  platform?: NodeJS.Platform;
  cwd?: string;
  ffmpegPath?: string | null;
  spawn?: SpawnFn;
  listDrives?: () => Promise<AudioCdDrive[]>;
};

type ResolvedAudioCdTrack = {
  drive: AudioCdDrive;
  track: AudioCdTrack;
};

const cdPcmSampleRate = 44_100;
const cdPcmChannels = 2;
const processOutputLimit = 256_000;

const appendCapped = (current: string, chunk: unknown): string => {
  const next = `${current}${Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)}`;
  return next.length > processOutputLimit ? next.slice(next.length - processOutputLimit) : next;
};

const parseSeconds = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const formatSeconds = (value: number): string => Math.max(0, value).toFixed(6);

const parseDurationText = (value: string): number | null => {
  const match = value.match(/\bDuration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/iu);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (![hours, minutes, seconds].every(Number.isFinite)) {
    return null;
  }

  return (hours * 3600) + (minutes * 60) + seconds;
};

const parseTimeBase = (value: string | null): number => {
  if (!value) {
    return 1;
  }

  const fraction = value.match(/^(\d+)\/(\d+)$/u);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (Number.isFinite(numerator) && numerator > 0 && Number.isFinite(denominator) && denominator > 0) {
      return numerator / denominator;
    }
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const createTrack = (
  drive: Pick<AudioCdDrive, 'id' | 'device'>,
  index: number,
  startSeconds: number | null,
  endSeconds: number | null,
  title?: string | null,
): AudioCdTrack => {
  const safeIndex = Math.max(1, Math.round(index));
  const durationSeconds =
    startSeconds !== null && endSeconds !== null && endSeconds > startSeconds
      ? endSeconds - startSeconds
      : null;

  return {
    id: `${drive.id}:track-${String(safeIndex).padStart(2, '0')}`,
    driveId: drive.id,
    device: drive.device,
    index: safeIndex,
    title: title?.trim() || `Track ${String(safeIndex).padStart(2, '0')}`,
    startSeconds,
    endSeconds,
    durationSeconds,
    playable: startSeconds !== null && durationSeconds !== null && durationSeconds > 0,
  };
};

const parseFfmetadataChapters = (drive: Pick<AudioCdDrive, 'id' | 'device'>, text: string): AudioCdTrack[] => {
  const tracks: AudioCdTrack[] = [];
  const blocks = text.split(/\r?\n(?=\[CHAPTER\])/u).filter((block) => block.includes('[CHAPTER]'));

  for (const block of blocks) {
    const timeBase = parseTimeBase(block.match(/^TIMEBASE=(.+)$/imu)?.[1]?.trim() ?? null);
    const start = parseSeconds(block.match(/^START=(\d+)$/imu)?.[1]);
    const end = parseSeconds(block.match(/^END=(\d+)$/imu)?.[1]);
    if (start === null || end === null || end <= start) {
      continue;
    }

    const title = block.match(/^title=(.+)$/imu)?.[1]?.trim() ?? null;
    tracks.push(createTrack(drive, tracks.length + 1, start * timeBase, end * timeBase, title));
  }

  return tracks;
};

const parseLogChapters = (drive: Pick<AudioCdDrive, 'id' | 'device'>, text: string): AudioCdTrack[] => {
  const tracks: AudioCdTrack[] = [];
  const chapterPattern = /Chapter\s+#\d+:(\d+):\s+start\s+([0-9.]+),\s+end\s+([0-9.]+)/giu;

  for (const match of text.matchAll(chapterPattern)) {
    const startSeconds = parseSeconds(match[2]);
    const endSeconds = parseSeconds(match[3]);
    if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) {
      continue;
    }

    tracks.push(createTrack(drive, Number(match[1]) + 1, startSeconds, endSeconds));
  }

  return tracks;
};

export const parseAudioCdTracksFromFfmpegOutput = (
  drive: Pick<AudioCdDrive, 'id' | 'device'>,
  output: string,
): AudioCdTrack[] => {
  const metadataTracks = parseFfmetadataChapters(drive, output);
  if (metadataTracks.length > 0) {
    return metadataTracks;
  }

  const logTracks = parseLogChapters(drive, output);
  if (logTracks.length > 0) {
    return logTracks;
  }

  const durationSeconds = parseDurationText(output);
  return durationSeconds && durationSeconds > 0
    ? [createTrack(drive, 1, 0, durationSeconds, 'Full disc')]
    : [];
};

const normalizeDriveDevice = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/[\\/]+$/u, '');
  if (!normalized || /[\r\n]/u.test(normalized)) {
    return null;
  }

  return normalized;
};

const createDriveId = (device: string): string => `cd:${device.toUpperCase()}`;

export const parseWindowsAudioCdDrives = (jsonText: string): AudioCdDrive[] => {
  const text = jsonText.trim();
  if (!text) {
    return [];
  }

  const parsed = JSON.parse(text) as unknown;
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const drives: AudioCdDrive[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const device = normalizeDriveDevice(record.Drive);
    if (!device) {
      continue;
    }

    const driveLetter = device.match(/^([A-Z]):$/iu)?.[1]?.toUpperCase() ?? null;
    const name = typeof record.Name === 'string' && record.Name.trim()
      ? record.Name.trim()
      : `CD drive ${device}`;
    const volumeName = typeof record.VolumeName === 'string' && record.VolumeName.trim()
      ? record.VolumeName.trim()
      : null;

    drives.push({
      id: createDriveId(device),
      device,
      name,
      mediaLoaded: record.MediaLoaded === true,
      driveLetter,
      volumeName,
    });
  }

  return drives;
};

export class AudioCdService {
  private readonly platform: NodeJS.Platform;
  private readonly cwd?: string;
  private readonly ffmpegPath?: string | null;
  private readonly spawn: SpawnFn;
  private readonly listDrivesOverride?: () => Promise<AudioCdDrive[]>;
  private capabilitiesPromise: Promise<AudioCdCapabilities> | null = null;

  constructor(dependencies: AudioCdServiceDependencies = {}) {
    this.platform = dependencies.platform ?? process.platform;
    this.cwd = dependencies.cwd;
    this.ffmpegPath = dependencies.ffmpegPath;
    this.spawn = dependencies.spawn ?? nodeSpawn;
    this.listDrivesOverride = dependencies.listDrives;
  }

  async getStatus(driveId?: string | null): Promise<AudioCdStatus> {
    const [capabilities, drives] = await Promise.all([
      this.getCapabilities(),
      this.listDrives(),
    ]);
    const selectedDrive = this.selectDrive(drives, driveId);

    if (!capabilities.ffmpegAvailable || !capabilities.libcdioAvailable) {
      return {
        ...capabilities,
        drives,
        selectedDriveId: selectedDrive?.id ?? null,
        tracks: [],
        error: capabilities.ffmpegAvailable ? 'libcdio_unavailable' : 'ffmpeg_unavailable',
      };
    }

    if (!selectedDrive) {
      return {
        ...capabilities,
        drives,
        selectedDriveId: null,
        tracks: [],
        error: drives.length === 0 ? 'no_cd_drive' : 'no_cd_drive_selected',
      };
    }

    if (selectedDrive.mediaLoaded === false) {
      return {
        ...capabilities,
        drives,
        selectedDriveId: selectedDrive.id,
        tracks: [],
        error: 'no_disc_loaded',
      };
    }

    try {
      const tracks = await this.inspectDisc(selectedDrive);
      return {
        ...capabilities,
        drives,
        selectedDriveId: selectedDrive.id,
        tracks,
        error: tracks.length > 0 ? null : 'audio_cd_tracks_unavailable',
      };
    } catch (error) {
      return {
        ...capabilities,
        drives,
        selectedDriveId: selectedDrive.id,
        tracks: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createTrackPcmStream(request: AudioCdPlayTrackRequest): Promise<ResolvedAudioCdTrack & { stream: Readable }> {
    const trackIndex = Number(request.trackIndex);
    if (!Number.isInteger(trackIndex) || trackIndex < 1 || trackIndex > 99) {
      throw new Error('audio_cd_invalid_track_index');
    }

    const status = await this.getStatus(request.driveId ?? null);
    const fallbackDrive = request.device ? this.createDetachedDrive(request.device) : null;
    const drive = status.drives.find((candidate) => candidate.id === status.selectedDriveId) ?? fallbackDrive;
    if (!drive) {
      throw new Error(status.error ?? 'audio_cd_drive_unavailable');
    }

    const tracks = status.tracks.length > 0 ? status.tracks : await this.inspectDisc(drive);
    const track = tracks.find((candidate) => candidate.index === trackIndex);
    if (!track) {
      throw new Error('audio_cd_track_not_found');
    }

    if (!track.playable || track.startSeconds === null || track.durationSeconds === null) {
      throw new Error('audio_cd_track_timing_unavailable');
    }

    return {
      drive,
      track,
      stream: this.spawnTrackDecode(drive, track),
    };
  }

  async listDrives(): Promise<AudioCdDrive[]> {
    if (this.listDrivesOverride) {
      return this.listDrivesOverride();
    }

    if (this.platform === 'win32') {
      return this.listWindowsDrives();
    }

    return this.listUnixDrives();
  }

  private createDetachedDrive(deviceValue: string): AudioCdDrive | null {
    const device = normalizeDriveDevice(deviceValue);
    if (!device) {
      return null;
    }

    return {
      id: createDriveId(device),
      device,
      name: `CD drive ${device}`,
      mediaLoaded: true,
      driveLetter: device.match(/^([A-Z]):$/iu)?.[1]?.toUpperCase() ?? null,
      volumeName: null,
    };
  }

  private selectDrive(drives: AudioCdDrive[], driveId?: string | null): AudioCdDrive | null {
    if (driveId) {
      return drives.find((drive) => drive.id === driveId) ?? null;
    }

    return drives.find((drive) => drive.mediaLoaded) ?? drives[0] ?? null;
  }

  private getFfmpegPath(): string {
    return resolveFfmpegToolchainPath({
      ffmpegPath: this.ffmpegPath,
      cwd: this.cwd,
    });
  }

  private getCapabilities(): Promise<AudioCdCapabilities> {
    this.capabilitiesPromise ??= this.detectCapabilities();
    return this.capabilitiesPromise;
  }

  private async detectCapabilities(): Promise<AudioCdCapabilities> {
    try {
      const result = await this.runProcess(this.getFfmpegPath(), ['-hide_banner', '-devices'], 5_000);
      const output = `${result.stdout}\n${result.stderr}`;
      return {
        ffmpegAvailable: result.code === 0,
        libcdioAvailable: /\blibcdio\b/iu.test(output),
      };
    } catch {
      return {
        ffmpegAvailable: false,
        libcdioAvailable: false,
      };
    }
  }

  private async listWindowsDrives(): Promise<AudioCdDrive[]> {
    const command = [
      'Get-CimInstance Win32_CDROMDrive',
      'Select-Object Drive,MediaLoaded,Name,MediaType,VolumeName',
      'ConvertTo-Json -Compress',
    ].join(' | ');

    try {
      const result = await this.runProcess('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        command,
      ], 5_000);
      return parseWindowsAudioCdDrives(result.stdout);
    } catch {
      return [];
    }
  }

  private async listUnixDrives(): Promise<AudioCdDrive[]> {
    const candidates = this.platform === 'darwin'
      ? ['/dev/rdisk1', '/dev/disk1', '/dev/rdisk2', '/dev/disk2']
      : ['/dev/cdrom', '/dev/sr0', '/dev/sr1', '/dev/dvd'];
    const drives: AudioCdDrive[] = [];

    for (const device of candidates) {
      try {
        await access(device);
      } catch {
        continue;
      }

      drives.push({
        id: createDriveId(device),
        device,
        name: `CD drive ${device}`,
        mediaLoaded: true,
        driveLetter: null,
        volumeName: null,
      });
    }

    return drives;
  }

  private async inspectDisc(drive: AudioCdDrive): Promise<AudioCdTrack[]> {
    const metadata = await this.runProcess(this.getFfmpegPath(), [
      '-hide_banner',
      '-nostdin',
      '-f',
      'libcdio',
      '-i',
      drive.device,
      '-map_metadata',
      '0',
      '-f',
      'ffmetadata',
      'pipe:1',
    ], 8_000).catch((error) => {
      if (error instanceof Error && error.message === 'process_timeout') {
        throw error;
      }
      return null;
    });

    const metadataTracks = metadata
      ? parseAudioCdTracksFromFfmpegOutput(drive, `${metadata.stdout}\n${metadata.stderr}`)
      : [];
    if (metadataTracks.length > 0) {
      return metadataTracks;
    }

    const probe = await this.runProcess(this.getFfmpegPath(), [
      '-hide_banner',
      '-nostdin',
      '-f',
      'libcdio',
      '-i',
      drive.device,
      '-t',
      '0.01',
      '-f',
      'null',
      '-',
    ], 8_000);
    const tracks = parseAudioCdTracksFromFfmpegOutput(drive, `${probe.stdout}\n${probe.stderr}`);
    if (tracks.length > 0) {
      return tracks;
    }

    return this.fallbackCdaTracks(drive);
  }

  private async fallbackCdaTracks(drive: AudioCdDrive): Promise<AudioCdTrack[]> {
    if (this.platform !== 'win32' || !drive.driveLetter) {
      return [];
    }

    try {
      const entries = await readdir(`${drive.driveLetter}:\\`);
      return entries
        .filter((entry) => /\.cda$/iu.test(entry))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((entry, index) => createTrack(drive, index + 1, null, null, entry.replace(/\.cda$/iu, '')));
    } catch {
      return [];
    }
  }

  private spawnTrackDecode(drive: AudioCdDrive, track: AudioCdTrack): Readable {
    const stream = new PassThrough();
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-f',
      'libcdio',
      '-ss',
      formatSeconds(track.startSeconds ?? 0),
      '-i',
      drive.device,
      '-t',
      formatSeconds(track.durationSeconds ?? 0),
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-f',
      'f32le',
      '-ac',
      String(cdPcmChannels),
      '-ar',
      String(cdPcmSampleRate),
      'pipe:1',
    ];
    const spawnOptions: SpawnOptions = {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    };
    const child = this.spawn(this.getFfmpegPath(), args, spawnOptions);
    let stderr = '';
    let closed = false;

    const stopChild = (): void => {
      if (!closed && !child.killed) {
        child.kill();
      }
    };
    const originalDestroy = stream.destroy.bind(stream);
    stream.destroy = ((error?: Error): PassThrough => {
      stopChild();
      return originalDestroy(error);
    }) as PassThrough['destroy'];

    child.stdout?.pipe(stream);
    child.stderr?.on('data', (chunk) => {
      stderr = appendCapped(stderr, chunk);
    });
    child.once('error', (error) => {
      stream.destroy(error);
    });
    child.once('close', (code, signal) => {
      closed = true;
      if (stream.destroyed) {
        return;
      }
      if (code && code !== 0) {
        stream.destroy(new Error(`audio_cd_ffmpeg_exit_${code}: ${stderr.trim()}`));
        return;
      }

      if (signal) {
        stream.destroy(new Error(`audio_cd_ffmpeg_signal_${signal}`));
      }
    });

    return stream;
  }

  private runProcess(file: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const spawnOptions: SpawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      };
      const child = this.spawn(file, args, spawnOptions);

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill();
        reject(new Error('process_timeout'));
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => {
        stdout = appendCapped(stdout, chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr = appendCapped(stderr, chunk);
      });
      child.once('error', (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code, signal) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve({ code, signal, stdout, stderr });
      });
    });
  }
}

let audioCdService: AudioCdService | null = null;

export const getAudioCdService = (): AudioCdService => {
  audioCdService ??= new AudioCdService();
  return audioCdService;
};

export const resetAudioCdServiceForTests = (): void => {
  audioCdService = null;
};
