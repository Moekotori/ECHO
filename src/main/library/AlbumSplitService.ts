import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { copyFile as nodeCopyFile } from 'node:fs/promises';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, extname, join, resolve } from 'node:path';
import type {
  AlbumSplitBackupFile,
  AlbumSplitJobStatus,
  AlbumSplitOutput,
  AlbumSplitPlan,
  AlbumSplitPlanOptions,
  AlbumSplitPlanSkippedTrack,
  AlbumSplitPlanTrack,
  AlbumSplitRequest,
  AlbumSplitSourceFile,
} from '../../shared/types/albumSplit';
import type { ImportAudioFilesResult, LibraryAlbum, LibraryTrack } from '../../shared/types/library';
import { resolveCueTrack, type CueTrack } from '../audio/CueSheet';
import { resolveFfmpegToolchain } from '../audio/FfmpegToolchain';
import {
  buildAlbumSplitBackupDir,
  buildAlbumSplitFfmpegArgs,
  buildAlbumSplitFileName,
  buildAlbumSplitOutputDir,
  normalizeAlbumSplitFileNamePattern,
  normalizeAlbumSplitFormat,
  sanitizeAlbumSplitFileName,
} from './AlbumSplitCommand';

export type AlbumSplitServiceDependencies = {
  getAlbum: (albumId: string) => LibraryAlbum | null;
  getAllAlbumTracks: (albumId: string) => LibraryTrack[];
  resolveCoverAsset: (coverId: string) => { filePath: string; mimeType: string | null } | null;
  importAudioFiles: (paths: string[]) => Promise<ImportAudioFilesResult>;
  resolveCueTrack?: (filePath: string) => CueTrack | null;
  resolveFfmpeg?: () => { healthy: boolean; path: string; error?: string | null };
  spawn?: typeof nodeSpawn;
  fileExists?: (path: string) => boolean;
  fileSize?: (path: string) => number | null;
  ensureDir?: (path: string) => void;
  copyFile?: (from: string, to: string) => Promise<void>;
  now?: () => Date;
};

const maxFinishedJobs = 12;

const nowIso = (now: () => Date): string => now().toISOString();

const defaultFileSize = (path: string): number | null => {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
};

const resolveCueTrackPathSafe = (path: string): CueTrack | null => {
  try {
    return resolveCueTrack(path);
  } catch {
    return null;
  }
};

const samePath = (left: string, right: string): boolean => {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b;
};

const cueTrackNumber = (track: LibraryTrack, cue: CueTrack, fallback: number): number =>
  track.trackNo && track.trackNo > 0 ? track.trackNo : cue.trackNumber > 0 ? cue.trackNumber : fallback;

const isActiveJob = (status: AlbumSplitJobStatus['status']): boolean =>
  status === 'queued' || status === 'backing-up' || status === 'running' || status === 'importing';

export class AlbumSplitService {
  private readonly jobs = new Map<string, AlbumSplitJobStatus>();
  private readonly children = new Map<string, ChildProcess>();
  private readonly cancelled = new Set<string>();
  private readonly protectedPaths = new Map<string, Set<string>>();
  private readonly resolveCue: (filePath: string) => CueTrack | null;
  private readonly resolveFfmpeg: () => { healthy: boolean; path: string; error?: string | null };
  private readonly spawn: typeof nodeSpawn;
  private readonly fileExists: (path: string) => boolean;
  private readonly fileSize: (path: string) => number | null;
  private readonly ensureDir: (path: string) => void;
  private readonly copyFile: (from: string, to: string) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly dependencies: AlbumSplitServiceDependencies) {
    this.resolveCue = dependencies.resolveCueTrack ?? resolveCueTrackPathSafe;
    this.resolveFfmpeg = dependencies.resolveFfmpeg ?? (() => resolveFfmpegToolchain());
    this.spawn = dependencies.spawn ?? nodeSpawn;
    this.fileExists = dependencies.fileExists ?? existsSync;
    this.fileSize = dependencies.fileSize ?? defaultFileSize;
    this.ensureDir = dependencies.ensureDir ?? ((path) => mkdirSync(path, { recursive: true }));
    this.copyFile = dependencies.copyFile ?? ((from, to) => nodeCopyFile(from, to));
    this.now = dependencies.now ?? (() => new Date());
  }

  plan(albumId: string, options: AlbumSplitPlanOptions = {}): AlbumSplitPlan {
    const album = this.dependencies.getAlbum(albumId);
    if (!album) {
      throw new Error(`Unknown album ${albumId}`);
    }

    const format = normalizeAlbumSplitFormat(options.format);
    const pattern = normalizeAlbumSplitFileNamePattern(options.fileNamePattern);
    const tracks = this.dependencies.getAllAlbumTracks(albumId);
    const planned: Array<Omit<AlbumSplitPlanTrack, 'fileName'>> = [];
    const skipped: AlbumSplitPlanSkippedTrack[] = [];
    const sourcePaths = new Set<string>();
    const codecBySource = new Map<string, string | null>();
    const backupFiles: AlbumSplitBackupFile[] = [];
    const backupSeen = new Set<string>();

    const addBackup = (path: string, role: AlbumSplitBackupFile['role']): void => {
      const key = resolve(path).toLocaleLowerCase();
      if (backupSeen.has(key) || !this.fileExists(path)) {
        return;
      }
      backupSeen.add(key);
      backupFiles.push({ path, role, sizeBytes: this.fileSize(path) });
    };

    tracks.forEach((track, index) => {
      if (track.mediaType === 'remote' || track.mediaType === 'streaming') {
        skipped.push({ trackId: track.id, title: track.title, reason: 'remote' });
        return;
      }
      const cue = this.resolveCue(track.path);
      if (!cue) {
        skipped.push({ trackId: track.id, title: track.title, reason: 'not-cue' });
        return;
      }
      if (!this.fileExists(cue.audioPath)) {
        skipped.push({ trackId: track.id, title: track.title, reason: 'missing-source' });
        return;
      }
      sourcePaths.add(cue.audioPath);
      addBackup(cue.audioPath, 'audio');
      if (extname(cue.cuePath).toLowerCase() === '.cue' && !samePath(cue.cuePath, cue.audioPath)) {
        addBackup(cue.cuePath, 'cue');
      }
      if (track.codec && !codecBySource.get(cue.audioPath)) {
        codecBySource.set(cue.audioPath, track.codec);
      }
      planned.push({
        trackId: track.id,
        trackNumber: cueTrackNumber(track, cue, index + 1),
        discNumber: track.discNo && track.discNo > 0 ? track.discNo : null,
        title: track.title || cue.title || `Track ${cue.trackNumber}`,
        artist: track.artist || cue.performer || album.albumArtist,
        sourcePath: cue.audioPath,
        startSeconds: cue.startSeconds,
        durationSeconds: cue.endSeconds !== null ? Math.max(0, cue.endSeconds - cue.startSeconds) : null,
      });
    });

    const multiDisc = new Set(planned.map((track) => track.discNumber).filter((disc): disc is number => disc !== null)).size > 1;
    const trackTotal = planned.length;
    const seenNames = new Map<string, number>();
    const plannedTracks: AlbumSplitPlanTrack[] = planned.map((track) => {
      let fileName = buildAlbumSplitFileName(pattern, format, track, { multiDisc, trackTotal });
      const collisions = seenNames.get(fileName.toLowerCase()) ?? 0;
      seenNames.set(fileName.toLowerCase(), collisions + 1);
      if (collisions > 0) {
        const extension = extname(fileName);
        fileName = `${fileName.slice(0, -extension.length)} (${collisions + 1})${extension}`;
      }
      return { ...track, fileName };
    });

    const sourceFiles: AlbumSplitSourceFile[] = Array.from(sourcePaths).map((path) => ({
      path,
      sizeBytes: this.fileSize(path),
      codec: codecBySource.get(path) ?? null,
    }));
    const ffmpeg = this.resolveFfmpeg();
    const firstSource = sourceFiles[0]?.path ?? null;

    return {
      albumId,
      albumTitle: album.title,
      albumArtist: album.albumArtist,
      year: album.year,
      trackTotal,
      sourceFiles,
      backupFiles,
      tracks: plannedTracks,
      skippedTracks: skipped,
      hasCover: Boolean(album.coverId && this.dependencies.resolveCoverAsset(album.coverId)),
      ffmpegAvailable: ffmpeg.healthy,
      ffmpegError: ffmpeg.healthy ? null : (ffmpeg.error ?? ffmpeg.path),
      suggestedOutputDir: firstSource ? buildAlbumSplitOutputDir(firstSource, album.title) : '',
      suggestedBackupDir: firstSource ? buildAlbumSplitBackupDir(firstSource, album.title) : '',
    };
  }

  start(request: AlbumSplitRequest): AlbumSplitJobStatus {
    if (request.backupConfirmed !== true) {
      throw new Error('请先确认已经另行备份整轨和 CUE。未确认前不会复制，也不会写出分轨文件。');
    }
    const plan = this.plan(request.albumId, { format: request.format, fileNamePattern: request.fileNamePattern });
    if (!plan.ffmpegAvailable) {
      throw new Error(`FFmpeg 不可用，无法分轨：${plan.ffmpegError ?? ''}`.trim());
    }
    if (plan.tracks.length === 0 || plan.backupFiles.length === 0 || !plan.suggestedBackupDir) {
      throw new Error('这张专辑没有可以分轨的曲目（需要 CUE 整轨文件）。');
    }
    const outputDir = request.outputDir.trim() ? resolve(request.outputDir) : plan.suggestedOutputDir;
    if (!outputDir) {
      throw new Error('请选择分轨输出文件夹。');
    }
    if (plan.sourceFiles.some((source) => samePath(outputDir, source.path))) {
      throw new Error('输出文件夹不能是整轨文件本身。');
    }
    for (const running of this.jobs.values()) {
      if (running.albumId === request.albumId && isActiveJob(running.status)) {
        throw new Error('这张专辑正在分轨中，请等待完成。');
      }
    }

    const format = normalizeAlbumSplitFormat(request.format);
    const job: AlbumSplitJobStatus = {
      id: randomUUID(),
      albumId: request.albumId,
      status: 'queued',
      outputDir,
      backupDir: plan.suggestedBackupDir,
      format,
      total: plan.tracks.length,
      completed: 0,
      failed: 0,
      backupTotal: plan.backupFiles.length,
      backupCompleted: 0,
      currentTitle: null,
      outputs: plan.tracks.map((track) => ({
        trackId: track.trackId,
        trackNumber: track.trackNumber,
        title: track.title,
        fileName: track.fileName,
        status: 'pending',
        error: null,
      })),
      importedCount: null,
      error: null,
      startedAt: nowIso(this.now),
      finishedAt: null,
    };
    this.jobs.set(job.id, job);
    this.pruneFinishedJobs();
    void this.run(job, plan, { ...request, outputDir, format });
    return this.snapshot(job);
  }

  getStatus(jobId: string): AlbumSplitJobStatus | null {
    const job = this.jobs.get(jobId);
    return job ? this.snapshot(job) : null;
  }

  cancel(jobId: string): AlbumSplitJobStatus | null {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    if (isActiveJob(job.status)) {
      this.cancelled.add(jobId);
      this.children.get(jobId)?.kill();
    }
    return this.snapshot(job);
  }

  close(): void {
    for (const [jobId, child] of this.children) {
      this.cancelled.add(jobId);
      child.kill();
    }
  }

  private snapshot(job: AlbumSplitJobStatus): AlbumSplitJobStatus {
    return { ...job, outputs: job.outputs.map((output) => ({ ...output })) };
  }

  private pruneFinishedJobs(): void {
    const finished = Array.from(this.jobs.values())
      .filter((job) => job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed')
      .sort((left, right) => (left.finishedAt ?? '').localeCompare(right.finishedAt ?? ''));
    while (finished.length > maxFinishedJobs) {
      const oldest = finished.shift();
      if (oldest) {
        this.jobs.delete(oldest.id);
        this.protectedPaths.delete(oldest.id);
      }
    }
  }

  private async run(job: AlbumSplitJobStatus, plan: AlbumSplitPlan, request: AlbumSplitRequest): Promise<void> {
    job.status = 'backing-up';
    try {
      await this.backupSources(job, plan);
    } catch (error) {
      this.finish(job, this.cancelled.has(job.id) ? 'cancelled' : 'failed', this.cancelled.has(job.id) ? null : (error instanceof Error ? error.message : String(error)));
      return;
    }
    if (this.cancelled.has(job.id)) {
      this.finish(job, 'cancelled', null);
      return;
    }

    const ffmpeg = this.resolveFfmpeg();
    const cover = request.embedCover && plan.hasCover ? this.resolveCoverFor(request.albumId) : null;
    const album = this.dependencies.getAlbum(request.albumId);
    const genre = this.dependencies.getAllAlbumTracks(request.albumId).find((track) => track.genre)?.genre ?? null;

    job.status = 'running';
    job.currentTitle = null;
    try {
      this.ensureDir(request.outputDir);
    } catch (error) {
      this.finish(job, 'failed', error instanceof Error ? error.message : String(error));
      return;
    }

    const producedPaths: string[] = [];
    for (const track of plan.tracks) {
      if (this.cancelled.has(job.id)) {
        break;
      }
      const output = job.outputs.find((candidate) => candidate.trackId === track.trackId);
      if (!output) {
        continue;
      }
      const outputPath = join(request.outputDir, track.fileName);
      job.currentTitle = track.title;
      output.status = 'running';

      if (this.isProtectedOutput(job.id, outputPath, track.sourcePath)) {
        this.markOutput(job, output, 'failed', '输出路径与源文件或备份相同，已跳过以免覆盖原文件。');
        continue;
      }
      if (!request.overwrite && this.fileExists(outputPath)) {
        this.markOutput(job, output, 'skipped', '目标文件已存在。');
        continue;
      }

      try {
        await this.runFfmpeg(job.id, ffmpeg.path, buildAlbumSplitFfmpegArgs({
          inputPath: track.sourcePath,
          outputPath,
          format: request.format,
          startSeconds: track.startSeconds,
          durationSeconds: track.durationSeconds,
          metadata: {
            title: track.title,
            artist: track.artist,
            album: plan.albumTitle,
            albumArtist: plan.albumArtist || album?.albumArtist || track.artist,
            trackNumber: track.trackNumber,
            trackTotal: plan.trackTotal,
            discNumber: track.discNumber,
            year: plan.year,
            genre,
          },
          cover,
        }));
        this.markOutput(job, output, 'done', null);
        producedPaths.push(outputPath);
      } catch (error) {
        if (this.cancelled.has(job.id)) {
          output.status = 'pending';
          break;
        }
        this.markOutput(job, output, 'failed', error instanceof Error ? error.message : String(error));
      }
    }

    job.currentTitle = null;
    if (this.cancelled.has(job.id)) {
      this.finish(job, 'cancelled', null);
      return;
    }

    if (request.importAfter && producedPaths.length > 0) {
      job.status = 'importing';
      try {
        const result = await this.dependencies.importAudioFiles(producedPaths);
        job.importedCount = result.importedCount;
      } catch (error) {
        job.importedCount = 0;
        job.error = `分轨完成，但导入媒体库失败：${error instanceof Error ? error.message : String(error)}`;
      }
    }

    this.finish(job, job.failed > 0 && job.completed === 0 ? 'failed' : 'completed', job.error);
  }

  private async backupSources(job: AlbumSplitJobStatus, plan: AlbumSplitPlan): Promise<void> {
    const backupDir = plan.suggestedBackupDir;
    this.ensureDir(backupDir);
    job.backupDir = backupDir;
    const usedNames = new Set<string>();
    const protectedPaths = new Set<string>();
    for (const source of plan.sourceFiles) {
      protectedPaths.add(resolve(source.path).toLocaleLowerCase());
    }

    for (const file of plan.backupFiles) {
      if (this.cancelled.has(job.id)) {
        return;
      }
      if (!this.fileExists(file.path)) {
        throw new Error(`备份失败，找不到源文件：${file.path}`);
      }
      const destination = this.backupDestination(backupDir, file.path, usedNames);
      protectedPaths.add(resolve(destination).toLocaleLowerCase());
      job.currentTitle = basename(file.path);
      if (this.fileExists(destination)) {
        const sourceSize = this.fileSize(file.path);
        const destinationSize = this.fileSize(destination);
        if (sourceSize === null || destinationSize === null || sourceSize !== destinationSize) {
          throw new Error(`备份位置已有不同内容的文件，已停止以免覆盖：${destination}`);
        }
        job.backupCompleted += 1;
        continue;
      }
      await this.copyFile(file.path, destination);
      if (this.cancelled.has(job.id)) {
        return;
      }
      job.backupCompleted += 1;
    }

    this.protectedPaths.set(job.id, protectedPaths);
    job.currentTitle = null;
  }

  private backupDestination(directory: string, sourcePath: string, usedNames: Set<string>): string {
    const extension = extname(sourcePath);
    const stem = sanitizeAlbumSplitFileName(basename(sourcePath, extension));
    let name = `${stem}${extension}`;
    let index = 2;
    while (usedNames.has(name.toLocaleLowerCase('und'))) {
      name = `${stem} (${index})${extension}`;
      index += 1;
    }
    usedNames.add(name.toLocaleLowerCase('und'));
    const destination = join(directory, name);
    if (samePath(destination, sourcePath)) {
      throw new Error('备份路径与源文件相同，已停止。');
    }
    return destination;
  }

  private isProtectedOutput(jobId: string, outputPath: string, sourcePath: string): boolean {
    if (samePath(outputPath, sourcePath)) {
      return true;
    }
    return this.protectedPaths.get(jobId)?.has(resolve(outputPath).toLocaleLowerCase()) === true;
  }

  private resolveCoverFor(albumId: string): { path: string; mimeType: string | null } | null {
    const album = this.dependencies.getAlbum(albumId);
    if (!album?.coverId) {
      return null;
    }
    const asset = this.dependencies.resolveCoverAsset(album.coverId);
    return asset && this.fileExists(asset.filePath) ? { path: asset.filePath, mimeType: asset.mimeType } : null;
  }

  private markOutput(job: AlbumSplitJobStatus, output: AlbumSplitOutput, status: AlbumSplitOutput['status'], error: string | null): void {
    output.status = status;
    output.error = error;
    if (status === 'done') {
      job.completed += 1;
    } else if (status === 'failed') {
      job.failed += 1;
    }
  }

  private finish(job: AlbumSplitJobStatus, status: 'completed' | 'cancelled' | 'failed', error: string | null): void {
    job.status = status;
    job.error = error;
    job.currentTitle = null;
    job.finishedAt = nowIso(this.now);
    this.cancelled.delete(job.id);
    this.children.delete(job.id);
    this.protectedPaths.delete(job.id);
  }

  private runFfmpeg(jobId: string, ffmpegPath: string, args: string[]): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const child = this.spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      this.children.set(jobId, child);
      const stderrLines: string[] = [];
      let settled = false;
      const onData = (chunk: string): void => {
        for (const line of chunk.split(/\r?\n/u)) {
          const trimmed = line.trim();
          if (trimmed) {
            stderrLines.push(trimmed);
            if (stderrLines.length > 6) {
              stderrLines.shift();
            }
          }
        }
      };
      const settle = (error: Error | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        child.stderr?.removeListener('data', onData);
        child.removeListener('error', onError);
        child.removeListener('exit', onExit);
        if (this.children.get(jobId) === child) {
          this.children.delete(jobId);
        }
        if (error) {
          reject(error);
        } else {
          resolvePromise();
        }
      };
      const onError = (error: Error): void => settle(error instanceof Error ? error : new Error(String(error)));
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (code === 0) {
          settle(null);
          return;
        }
        const tail = stderrLines.join(' | ');
        settle(new Error(`FFmpeg ${code === null ? `signal ${signal ?? 'unknown'}` : `exit ${code}`}${tail ? ` - ${tail}` : ''}`));
      };

      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', onData);
      child.on('error', onError);
      child.on('exit', onExit);
    });
  }
}
