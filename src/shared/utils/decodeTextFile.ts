const utf8Bom = [0xef, 0xbb, 0xbf] as const;
const utf16LeBom = [0xff, 0xfe] as const;
const utf16BeBom = [0xfe, 0xff] as const;

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  signature.every((byte, index) => bytes[index] === byte);

const decode = (bytes: Uint8Array, encoding: string, fatal = false): string =>
  new TextDecoder(encoding, { fatal }).decode(bytes).replace(/^\uFEFF/u, '');

export const decodeTextFileBytes = (bytes: Uint8Array): string => {
  if (startsWith(bytes, utf8Bom)) {
    return decode(bytes, 'utf-8');
  }

  if (startsWith(bytes, utf16LeBom)) {
    return decode(bytes, 'utf-16le');
  }

  if (startsWith(bytes, utf16BeBom)) {
    return decode(bytes, 'utf-16be');
  }

  try {
    return decode(bytes, 'utf-8', true);
  } catch {
    return decode(bytes, 'gb18030');
  }
};
