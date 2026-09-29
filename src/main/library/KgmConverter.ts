import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { KuGou, detectAudioType, ready } from '@clamber_l/crypto';

const KGM_MARKER = '.kgm';

let wasmReady = false;
const ensureWasm = async (): Promise<void> => {
  if (!wasmReady) {
    await ready;
    wasmReady = true;
  }
};

export const isKgmFile = (filePath: string): boolean =>
  filePath.toLocaleLowerCase().includes(KGM_MARKER);

const resolveDecodedPath = (inputPath: string): string => {
  const dir = dirname(inputPath);
  const name = basename(inputPath);
  const kgmIndex = name.toLocaleLowerCase().lastIndexOf(KGM_MARKER);
  const base = kgmIndex > 0 ? name.slice(0, kgmIndex) : basename(name, extname(name));
  return resolve(dir, `${base}.flac`);
};

export class KgmConverter {
  /**
   * 如果文件是 KGM/KGMA 加密格式则解密到同目录，返回解码后的文件路径。
   * 非 KGM 文件直接返回原路径。已有解码文件时跳过解密。
   */
  async convertIfNeeded(filePath: string): Promise<string> {
    const inputPath = resolve(filePath);
    if (!isKgmFile(inputPath)) {
      return inputPath;
    }

    const decodedPath = resolveDecodedPath(inputPath);

    // 已解密过，直接复用
    if (existsSync(decodedPath)) {
      return decodedPath;
    }

    await ensureWasm();
    return this.convert(inputPath, decodedPath);
  }

  private convert(inputPath: string, outputPath: string): string {
    const data = readFileSync(inputPath);

    // KGM 文件至少需要 0x400 字节头
    if (data.length < 0x400) {
      throw new Error(`KGM file too small (${data.length} bytes): ${basename(inputPath)}`);
    }

    // 前 0x400 字节是加密头（含密钥），传给 WASM 解析器提取解密密钥
    const header = new Uint8Array(data.buffer, data.byteOffset, 0x400);
    const kugou = KuGou.from_header(header);

    // 解密音频数据（原地修改）
    const audio = new Uint8Array(data.buffer, data.byteOffset + 0x400);
    kugou.decrypt(audio, 0);

    // 检测解密后的真实音频格式
    const extInfo = detectAudioType(audio);
    const ext = extInfo?.audioType ?? 'bin';
    extInfo?.free();

    const finalPath = outputPath.replace(/\.flac$/i, `.${ext}`);
    writeFileSync(finalPath, audio);
    return finalPath;
  }
}

export const getKgmConverter = (): KgmConverter => new KgmConverter();
