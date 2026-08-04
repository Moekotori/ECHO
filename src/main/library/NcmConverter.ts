import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, parse, resolve } from 'node:path';

const ncmExtension = '.ncm';
const ncmConverterFileNames: Record<string, string> = {
  win32: 'NCMConverter.exe',
  linux: 'NCMConverter',
};
const decodedAudioExtensions = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus']);

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

const getProcessResourcesPath = (): string | null => {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof resourcesPath === 'string' && resourcesPath.trim() ? resourcesPath : null;
};

const getNcmConverterFileName = (platform = process.platform): string => ncmConverterFileNames[platform] ?? ncmConverterFileNames.win32;

const resolveBundledNcmConverterPath = (platform = process.platform): string | null => {
  const ncmConverterFileName = getNcmConverterFileName(platform);
  const resourcesPath = getProcessResourcesPath();
  const candidates = [
    resourcesPath ? resolve(resourcesPath, 'tools', ncmConverterFileName) : null,
    resourcesPath ? resolve(resourcesPath, ncmConverterFileName) : null,
    resolve(process.cwd(), 'electron-app', 'tools', ncmConverterFileName),
    resolve(process.cwd(), 'tools', ncmConverterFileName),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

const runConverter = (converterPath: string, inputPath: string): Promise<CommandResult> =>
  new Promise((resolveResult) => {
    const child = spawn(converterPath, [inputPath], {
      cwd: dirname(inputPath),
      windowsHide: true,
      shell: false,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', (error) => resolveResult({ stdout: '', stderr: error.message, exitCode: -1 }));
    child.on('close', (exitCode) =>
      resolveResult({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode,
      }),
    );
  });

const isDecodedAudioPath = (filePath: string): boolean => decodedAudioExtensions.has(extname(filePath).toLocaleLowerCase());

export const isNcmFile = (filePath: string): boolean => extname(filePath).toLocaleLowerCase() === ncmExtension;

export class NcmConverter {
  constructor(
    private readonly converterPathResolver: () => string | null = () => resolveBundledNcmConverterPath(),
    private readonly platform = process.platform,
  ) {}

  async convertIfNeeded(filePath: string): Promise<string> {
    const inputPath = resolve(filePath);
    if (!isNcmFile(inputPath)) {
      return inputPath;
    }

    if (this.platform !== 'win32') {
      throw new Error(`NCM 解密暂不支持当前平台: ${this.platform}`);
    }

    const converterPath = this.converterPathResolver();
    const ncmConverterFileName = getNcmConverterFileName(this.platform);
    if (!converterPath || !existsSync(converterPath)) {
      throw new Error(`NCM 解密工具不可用: ${ncmConverterFileName}`);
    }

    const inputStat = statSync(inputPath);
    const existingOutput = this.findDecodedOutput(inputPath, inputStat.mtimeMs - 1000);
    if (existingOutput) {
      return existingOutput;
    }

    const startedAtMs = Date.now();
    const result = await runConverter(converterPath, inputPath);
    if (result.exitCode !== 0) {
      throw new Error((result.stderr || result.stdout).trim() || 'NCM 解密失败');
    }

    const outputPath = this.findDecodedOutput(inputPath, startedAtMs - 1000);
    if (!outputPath) {
      throw new Error(`NCM 解密完成但没有生成音频文件: ${basename(inputPath)}`);
    }

    return outputPath;
  }

  private findDecodedOutput(inputPath: string, minMtimeMs: number): string | null {
    const directory = dirname(inputPath);
    const inputBaseName = parse(inputPath).name.toLocaleLowerCase();

    const candidates = readdirSync(directory)
      .map((entry) => resolve(directory, entry))
      .filter((entryPath) => {
        try {
          const entryStat = statSync(entryPath);
          const parsed = parse(entryPath);
          return (
            entryStat.isFile() &&
            entryStat.mtimeMs >= minMtimeMs &&
            parsed.name.toLocaleLowerCase() === inputBaseName &&
            isDecodedAudioPath(entryPath)
          );
        } catch {
          return false;
        }
      })
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

    return candidates[0] ?? null;
  }
}

export const getNcmConverter = (): NcmConverter => new NcmConverter();
