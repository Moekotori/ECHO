import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readScanCueAsync } from '../ScanCueReader';
import { TsMetadataReader } from './TsMetadataReader';

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it('uses prepared CUE facts after the sheet is unavailable and rejects facts for another virtual track', async () => {
  await mkdir('misc', { recursive: true });
  root = await mkdtemp(resolve('misc/cue-facts-'));
  const audio = join(root, 'album.wav');
  const cue = join(root, 'album.cue');
  await writeFile(audio, 'unsupported audio');
  await writeFile(cue, 'TITLE "Album"\nFILE "album.wav" WAVE\nTRACK 01 AUDIO\nTITLE "First"\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nINDEX 01 01:00:00');
  const fact = (await readScanCueAsync(cue, false)).tracks[0].cueTrack!;
  await rm(cue);
  const reader = new TsMetadataReader();
  const result = await reader.read(`${cue}#cueTrack=1`, { cueTrack: fact, readCover: false });
  expect(result.fields).toMatchObject({ title: 'First', album: 'Album', duration: 60, trackNo: 1 });
  await expect(reader.read(`${cue}#cueTrack=2`, { cueTrack: fact })).rejects.toThrow('Prepared CUE facts');
});
