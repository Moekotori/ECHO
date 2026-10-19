import { decodeTextFileBytes } from '../../../shared/utils/decodeTextFile';
import { maxCustomLyricsFileBytes } from './customLyricsFile';

export const readCustomLyricsFile = async (file: File): Promise<string> => {
  if (file.size > maxCustomLyricsFileBytes) throw new Error('Lyrics file is too large to import.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > maxCustomLyricsFileBytes) throw new Error('Lyrics file is too large to import.');
  if (!file.name.toLowerCase().endsWith('.krc') || ![0x6b, 0x72, 0x63, 0x31].every((byte, i) => bytes[i] === byte)) {
    return decodeTextFileBytes(bytes);
  }
  const { Unzlib } = await import('fflate');
  const key = [0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69];
  const compressed = bytes.subarray(4);
  for (let i = 0; i < compressed.length; i++) compressed[i] ^= key[i % key.length];
  const chunks: Uint8Array[] = [];
  let size = 0;
  const decoder = new Unzlib((chunk) => {
    size += chunk.length;
    if (size > maxCustomLyricsFileBytes) throw new Error('Lyrics file expands beyond the import limit.');
    chunks.push(chunk);
  });
  // Small input chunks bound transient inflater output as well as retained output.
  for (let offset = 0; offset < compressed.length; offset += 256) {
    decoder.push(compressed.subarray(offset, offset + 256), offset + 256 >= compressed.length);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  if (!output.length) throw new Error('KRC file does not contain readable lyrics.');
  return decodeTextFileBytes(output);
};
