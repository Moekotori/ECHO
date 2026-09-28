// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LibraryAlbum } from '../../../shared/types/library';
import type { AlbumSplitJobStatus, AlbumSplitPlan } from '../../../shared/types/albumSplit';
import { AlbumSplitDrawer } from './AlbumSplitDrawer';

vi.mock('../../i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, string | number>) =>
      Object.entries(options ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), key),
  }),
}));

const album: LibraryAlbum = {
  id: 'album-1',
  albumKey: 'album-1',
  title: 'Live',
  albumArtist: 'Band',
  year: 1999,
  trackCount: 1,
  duration: 180,
  coverId: null,
  coverThumb: null,
};

const plan = (): AlbumSplitPlan => ({
  albumId: 'album-1',
  albumTitle: 'Live',
  albumArtist: 'Band',
  year: 1999,
  trackTotal: 1,
  sourceFiles: [{ path: 'D:\\Music\\live.flac', sizeBytes: 1024, codec: 'flac' }],
  backupFiles: [{ path: 'D:\\Music\\live.flac', role: 'audio', sizeBytes: 1024 }],
  tracks: [{
    trackId: 't1',
    trackNumber: 1,
    discNumber: null,
    title: 'Opening',
    artist: 'Band',
    sourcePath: 'D:\\Music\\live.flac',
    startSeconds: 0,
    durationSeconds: 180,
    fileName: '01 - Opening.flac',
  }],
  skippedTracks: [],
  hasCover: false,
  ffmpegAvailable: true,
  ffmpegError: null,
  suggestedOutputDir: 'D:\\Music\\Live - Tracks',
  suggestedBackupDir: 'D:\\Music\\Live ECHO backup',
});

const job = (): AlbumSplitJobStatus => ({
  id: 'job-1',
  albumId: 'album-1',
  status: 'backing-up',
  outputDir: 'D:\\Music\\Live - Tracks',
  backupDir: 'D:\\Music\\Live ECHO backup',
  format: 'flac',
  total: 1,
  completed: 0,
  failed: 0,
  backupTotal: 1,
  backupCompleted: 0,
  currentTitle: 'live.flac',
  outputs: [],
  importedCount: null,
  error: null,
  startedAt: '2026-09-28T00:00:00.000Z',
  finishedAt: null,
});

describe('AlbumSplitDrawer', () => {
  it('keeps start disabled until the backup confirmation is checked', async () => {
    const planAlbumSplit = vi.fn().mockResolvedValue(plan());
    const startAlbumSplit = vi.fn().mockResolvedValue(job());
    window.echo = { library: { planAlbumSplit, startAlbumSplit } } as never;

    render(<AlbumSplitDrawer album={album} isOpen onClose={vi.fn()} />);

    const start = await screen.findByRole('button', { name: 'albumSplit.action.start' });
    expect((start as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'albumSplit.backup.confirm' }));
    expect((start as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(start);
    await waitFor(() => expect(startAlbumSplit).toHaveBeenCalledWith(expect.objectContaining({
      albumId: 'album-1',
      backupConfirmed: true,
      format: 'flac',
      outputDir: 'D:\\Music\\Live - Tracks',
    })));
  });
});
