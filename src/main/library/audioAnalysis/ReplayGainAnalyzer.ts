import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessByStdio, SpawnOptionsWithStdioTuple } from 'node:child_process';
import type { Readable } from 'node:stream';
import readline from 'node:readline';
import { DEFAULT_REPLAY_GAIN_TARGET_LUFS } from '../../../shared/constants/replayGain';
import { dbToLinearGain } from '../../../shared/utils/replayGain';
import { resolveFfmpegToolchainPath } from '../../audio/FfmpegToolchain';

type AnalyzerProcess = ChildProcessByStdio<null, Readable, Readable>;
type AnalyzerSpawnOptions = SpawnOptionsWithStdioTuple<'ignore', 'ignore', 'pipe'> & {
  windowsHide: boolean;
};
type AnalyzerSpawner = (file: string, args: string[], options: AnalyzerSpawnOptions) => AnalyzerProcess;

export type ReplayGainAnalyzerDependencies = {
  ffmpegPath?: string;
  spawn?: AnalyzerSpawner;
  logger?: (message: string) => void;
};

export type ReplayGainAnalyzerResult = {
  integratedLufs: number;
  trackGainDb: number;
  trackPeak: number | null;
};

const maxAnalyzeSeconds = 180;
const minAnalyzeSeconds = 20;

const defaultLogger = (message: string): void => {
  console.warn(message);
};

const verboseAudioLogsEnabled = process.env.ECHO_VERBOSE_AUDIO_LOGS === '1';

const appendTailLine = (lines: string[], line: string): void => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  lines.push(trimmed);
  if (lines.length > 32) {
    lines.shift();
  }
};

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

export const parseReplayGainEbur128Summary = (stderrLines: string[], targetLufs = DEFAULT_REPLAY_GAIN_TARGET_LUFS): ReplayGainAnalyzerResult | null => {
  const text = stderrLines.join('\n');
  const integratedMatches = Array.from(text.matchAll(/\bI:\s*([+-]?\d+(?:\.\d+)?)\s*LUFS\b/giu));
  const integratedLufs = Number(integratedMatches.at(-1)?.[1]);
  if (!Number.isFinite(integratedLufs)) {
    return null;
  }

  const peakMatches = Array.from(text.matchAll(/\b(?:Peak|True peak):\s*([+-]?\d+(?:\.\d+)?)\s*dBFS\b/giu));
  const peakDb = Number(peakMatches.at(-1)?.[1]);
  const trackPeak = Number.isFinite(peakDb) ? round(dbToLinearGain(peakDb), 6) : null;

  return {
    integratedLufs: round(integratedLufs, 2),
    trackGainDb: round(targetLufs - integratedLufs, 2),
    trackPeak,
  };
};

export class ReplayGainAnalyzer {
  private readonly ffmpegPath: string;
  private readonly spawn: AnalyzerSpawner;
  private readonly logger: (message: string) => void;
  private readonly shouldLogResult: boolean;

  constructor(dependencies: ReplayGainAnalyzerDependencies = {}) {
    this.ffmpegPath = dependencies.ffmpegPath ?? resolveFfmpegToolchainPath();
    this.spawn = dependencies.spawn ?? (nodeSpawn as AnalyzerSpawner);
    this.logger = dependencies.logger ?? defaultLogger;
    this.shouldLogResult = Boolean(dependencies.logger) || verboseAudioLogsEnabled;
  }

  async analyze(filePath: string, durationSeconds = maxAnalyzeSeconds, targetLufs = DEFAULT_REPLAY_GAIN_TARGET_LUFS): Promise<ReplayGainAnalyzerResult> {
    const analyzeSeconds = Math.max(minAnalyzeSeconds, Math.min(maxAnalyzeSeconds, durationSeconds || maxAnalyzeSeconds));
    const args = [
      '-hide_banner',
      '-nostdin',
      '-i',
      filePath,
      '-vn',
      '-t',
      String(analyzeSeconds),
      '-af',
      'ebur128=peak=true',
      '-f',
      'null',
      '-',
    ];
    const stderrLines: string[] = [];
    const proc = this.spawn(this.ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    const stderr = readline.createInterface({ input: proc.stderr });
    stderr.on('line', (line) => appendTailLine(stderrLines, line));

    await new Promise<void>((resolve, reject) => {
      proc.on('error', reject);
      proc.on('exit', (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`ffmpeg_exit_${code ?? signal ?? 'unknown'}: ${stderrLines.slice(-8).join(' | ')}`));
      });
    });

    const parsed = parseReplayGainEbur128Summary(stderrLines, targetLufs);
    if (!parsed) {
      throw new Error('replay_gain_loudness_unavailable');
    }

    if (this.shouldLogResult) {
      this.logger(
        `[ReplayGainAnalyzer] file="${filePath}" lufs=${parsed.integratedLufs} gainDb=${parsed.trackGainDb} peak=${parsed.trackPeak ?? 'n/a'}`,
      );
    }
    return parsed;
  }
}

