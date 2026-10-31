import { existsSync } from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import { basename, extname, join, resolve } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import type { AudioExportRequest, AudioExportResult } from '../../shared/types/audio';
import { resolveCueTrack } from './CueSheet';
import { resolveFfmpegToolchain } from './FfmpegToolchain';
import {
  appendAudioExportExtension,
  buildAudioExportFfmpegArgs,
  formatAudioExportPlaybackRate,
  normalizeAudioExportFormat,
  normalizeAudioExportPlaybackRate,
  sanitizeAudioExportFileName,
} from './AudioExportCommand';

type ExportInput = {
  inputPath: string;
  startSeconds: number;
  durationSeconds: number | null;
};

const isRemoteOrVirtualPath = (value: string): boolean =>
  /^https?:\/\//iu.test(value.trim()) ||
  (/^[a-z][a-z0-9+.-]*:/iu.test(value.trim()) && !/^[a-z]:[\\/]/iu.test(value.trim()));

const normalizeExportInput = (filePath: string): ExportInput => {
  if (isRemoteOrVirtualPath(filePath)) {
    throw new Error('当前导出只支持本地音频文件。流媒体请使用下载功能。');
  }

  const cueTrack = resolveCueTrack(filePath);
  const inputPath = cueTrack?.audioPath ?? filePath;

  if (!existsSync(inputPath)) {
    throw new Error('当前音频文件不存在，无法导出。');
  }

  return {
    inputPath,
    startSeconds: cueTrack?.startSeconds ?? 0,
    durationSeconds: cueTrack?.endSeconds !== null && cueTrack?.endSeconds !== undefined
      ? Math.max(0, cueTrack.endSeconds - cueTrack.startSeconds)
      : null,
  };
};

const sameFilePath = (left: string, right: string): boolean => {
  const resolvedLeft = resolve(left);
  const resolvedRight = resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
};

const defaultExportBaseName = (request: AudioExportRequest, inputPath: string): string => {
  const title = request.title?.trim();
  const artist = request.artist?.trim();
  const metadataName = [artist, title].filter(Boolean).join(' - ');
  if (metadataName) {
    return sanitizeAudioExportFileName(metadataName);
  }

  return sanitizeAudioExportFileName(basename(inputPath, extname(inputPath)));
};

const runFfmpegExport = (ffmpegPath: string, args: string[]): Promise<void> =>
  new Promise((resolvePromise, reject) => {
    const child = nodeSpawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    const stderrLines: string[] = [];
    let settled = false;

    const rejectOnce = (error: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (trimmed) {
          stderrLines.push(trimmed);
          if (stderrLines.length > 8) {
            stderrLines.shift();
          }
        }
      }
    });
    child.on('error', (error) => rejectOnce(error instanceof Error ? error : new Error(String(error))));
    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      if (code === 0) {
        resolvePromise();
        return;
      }

      const tail = stderrLines.join(' | ');
      reject(new Error(`音频导出失败：FFmpeg ${code === null ? `signal ${signal ?? 'unknown'}` : `exit ${code}`}${tail ? ` - ${tail}` : ''}`));
    });
  });

export const exportAudioFile = async (
  request: AudioExportRequest,
  parentWindow?: BrowserWindow | null,
): Promise<AudioExportResult | null> => {
  if (!request || typeof request !== 'object' || typeof request.filePath !== 'string' || !request.filePath.trim()) {
    throw new Error('没有可导出的音频文件。');
  }

  const format = normalizeAudioExportFormat(request.format);
  const playbackRate = normalizeAudioExportPlaybackRate(request.playbackRate);
  const input = normalizeExportInput(request.filePath);
  const baseName = defaultExportBaseName(request, input.inputPath);
  const speedSuffix = Math.abs(playbackRate - 1) >= 0.001 ? ` - ${formatAudioExportPlaybackRate(playbackRate)}` : '';
  const defaultPath = join(app.getPath('downloads'), `${baseName}${speedSuffix}.${format}`);
  const dialogOptions = {
    title: '导出当前音频',
    defaultPath,
    filters: [{ name: `${format.toUpperCase()} 音频`, extensions: [format] }],
  };
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) {
    return null;
  }

  const outputPath = appendAudioExportExtension(result.filePath, format);
  if (outputPath !== result.filePath && existsSync(outputPath)) {
    throw new Error('导出目标已存在。请换一个文件名，避免静默覆盖。');
  }
  if (sameFilePath(outputPath, input.inputPath)) {
    throw new Error('导出目标不能覆盖当前播放的源文件，请选择另一个文件名。');
  }

  const ffmpeg = resolveFfmpegToolchain();
  if (!ffmpeg.healthy) {
    throw new Error(`FFmpeg 不可用，无法导出音频：${ffmpeg.error ?? ffmpeg.path}`);
  }

  await runFfmpegExport(ffmpeg.path, buildAudioExportFfmpegArgs({
    inputPath: input.inputPath,
    outputPath,
    format,
    playbackRate,
    startSeconds: input.startSeconds,
    durationSeconds: input.durationSeconds,
  }));

  return {
    filePath: outputPath,
    format,
    playbackRate,
  };
};
