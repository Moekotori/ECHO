// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryTrack } from '../../../shared/types/library';
import { communityLibraryZhCNMessages } from '../../i18n/locales/communityLibraryFamily';
import { TrackContextMenu } from './TrackContextMenu';

vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({
  t: (key: string) => communityLibraryZhCNMessages[key as keyof typeof communityLibraryZhCNMessages] ?? key,
}) }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('opens a cover from the shared menu and copies its original without sending a playback action', async () => {
  const copy = vi.fn().mockResolvedValue(true);
  window.echo = { library: { copyTrackOriginalCover: copy } } as unknown as typeof window.echo;
  const onAction = vi.fn();
  const onClose = vi.fn();
  const track = { id: 'cover-track', title: 'Song', artist: 'Artist', path: '/song.flac', coverId: 'cover-id', coverThumb: 'echo-cover://thumb/cover-id' } as LibraryTrack;
  render(<TrackContextMenu track={track} position={{ x: 10, y: 10 }} onAction={onAction} onClose={onClose} />);
  fireEvent.click(await screen.findByRole('menuitem', { name: '查看封面大图' }));
  expect(await screen.findByRole('dialog', { name: '查看封面大图：Song' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '复制封面原图' }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith('cover-track'));
  expect(onAction).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();
});
