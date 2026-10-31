import { closeSync, openSync, readSync } from 'node:fs';

export const readFilePrefixSync = (path: string, byteLength: number): Buffer => {
  const length = Math.max(0, Math.trunc(byteLength));
  if (length === 0) {
    return Buffer.alloc(0);
  }

  const descriptor = openSync(path, 'r');
  try {
    const prefix = Buffer.allocUnsafe(length);
    const bytesRead = readSync(descriptor, prefix, 0, length, 0);
    return prefix.subarray(0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
};

export const hasPortableExecutableHeader = (path: string): boolean => {
  try {
    const header = readFilePrefixSync(path, 2);
    return header.length === 2 && header[0] === 0x4d && header[1] === 0x5a;
  } catch {
    return false;
  }
};
