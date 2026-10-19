// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../i18n/I18nProvider';
import { LibraryWallFilterControl } from './LibraryWallFilterControl';
import { AlbumsSortControl } from '../../pages/albums/AlbumsSortControl';
import { FolderSortControl } from '../../pages/folders/FolderSortControl';

beforeEach(() => { window.localStorage.clear(); window.localStorage.setItem('echo-next.locale', 'zh-CN'); });
afterEach(cleanup);
it('loads folders on demand, reuses them, and preserves portal option interactions', async () => {
  const getFolders = vi.fn().mockResolvedValue([{ id: 'f1', name: 'Music', path: '/music', status: 'active' }]);
  const onFolderChange = vi.fn();
  window.echo = { library: { getFolders } } as unknown as typeof window.echo;
  render(<I18nProvider><LibraryWallFilterControl sourceMode="local" remoteSources={[]} remoteSourceId={null}
    selectedFolderId="" onSourceModeChange={vi.fn()} onRemoteSourceChange={vi.fn()} onFolderChange={onFolderChange} /></I18nProvider>);
  expect(getFolders).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(await screen.findByRole('combobox', { name: '文件夹' }));
  fireEvent.click(screen.getByRole('option', { name: 'Music' }));
  expect(onFolderChange).toHaveBeenCalledWith('f1');
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(getFolders).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  window.dispatchEvent(new Event('library:changed'));
  await waitFor(() => expect(getFolders).toHaveBeenCalledTimes(1));
});
it('changes album sort direction without losing the selected sort family', () => {
  const onChange = vi.fn();
  render(<I18nProvider><AlbumsSortControl sort="titleAsc" onChange={onChange} /></I18nProvider>);
  fireEvent.click(screen.getByRole('button', { name: /标题 A-Z/ }));
  fireEvent.click(screen.getByRole('button', { name: '降序' }));
  expect(onChange).toHaveBeenCalledWith('titleDesc');
});
it('offers folder artist and album directions while hiding unsupported remote rules', () => {
  const onChange = vi.fn();
  render(<I18nProvider><FolderSortControl value="artist" onChange={onChange} ariaLabel="Folder sort"
    hiddenValues={new Set(['bpmAsc', 'bpmDesc', 'lastPlayed', 'playCountAsc', 'playCountDesc'])} /></I18nProvider>);
  fireEvent.click(screen.getByRole('button', { name: '按艺术家' }));
  fireEvent.click(screen.getByRole('button', { name: '艺术家 Z-A' }));
  expect(onChange).toHaveBeenCalledWith('artistDesc');
  expect(screen.queryByRole('option', { name: /BPM/ })).toBeNull();
});
