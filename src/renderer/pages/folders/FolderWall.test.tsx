// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LibraryFolderOverview } from '../../../shared/types/library';
import { FolderWall, type FolderWallTarget } from './FolderWall';

const root = (id: string, children = 0): LibraryFolderOverview => ({
  id, name: `Music ${id}`, path: `/Music/${id}`, status: 'active', createdAt: '', updatedAt: '', lastScanAt: null,
  recentScan: null, trackCount: 12, childFolderCount: children, albumCount: 1, artistCount: 1,
  totalDuration: 120, totalSizeBytes: 1000, coverThumbs: [], missingTrackCount: 0, losslessTrackCount: 12, hiResTrackCount: 0,
});
const target = (folder: LibraryFolderOverview): FolderWallTarget => ({ ...folder, folderId: folder.id, rootName: folder.name, rootPath: folder.path });
const setup = (roots = [root('1')], trail: FolderWallTarget[] = []) => {
  const props = {
    roots, location: { trail }, onLocationChange: vi.fn(), childrenByParent: {}, loadingChildren: {}, loading: false, pinned: [],
    loadChildren: vi.fn().mockResolvedValue(undefined), onSelect: vi.fn(), onOpen: vi.fn(), onContextMenu: vi.fn(), onAdd: vi.fn(),
  };
  render(<FolderWall {...props} />);
  return props;
};
afterEach(cleanup);

describe('FolderWall', () => {
  it('opens leaf folders as songs and keeps direct song access for parent folders', () => {
    const props = setup([root('leaf'), root('parent', 3)]);
    fireEvent.click(screen.getByRole('button', { name: '打开文件夹 Music leaf' }));
    expect(props.onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: 'leaf' }));
    fireEvent.click(screen.getByRole('button', { name: '查看歌曲 · Music parent' }));
    expect(props.onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: 'parent' }));
    expect(props.loadChildren).not.toHaveBeenCalled();
  });
  it('loads only the entered parent and preserves its breadcrumb trail', () => {
    const folder = root('parent', 2);
    const props = setup([folder]);
    fireEvent.click(screen.getByRole('button', { name: '打开文件夹 Music parent' }));
    expect(props.loadChildren).toHaveBeenCalledExactlyOnceWith('parent', '/Music/parent');
    expect(props.onLocationChange).toHaveBeenCalledWith({ trail: [expect.objectContaining({ folderId: 'parent' })] });
    expect(props.onOpen).not.toHaveBeenCalled();
  });
  it('bounds each page to sixty cards and searches beyond the current page', () => {
    setup(Array.from({ length: 75 }, (_, index) => root(String(index))));
    expect(document.querySelectorAll('.folder-wall-card')).toHaveLength(60);
    fireEvent.change(screen.getByRole('searchbox', { name: '查找文件夹' }), { target: { value: 'Music 74' } });
    expect(document.querySelectorAll('.folder-wall-card')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '打开文件夹 Music 74' })).toBeTruthy();
  });
  it('keeps context actions available on a card', () => {
    const props = setup();
    fireEvent.contextMenu(screen.getByRole('button', { name: '打开文件夹 Music 1' }), { clientX: 20, clientY: 30 });
    expect(props.onContextMenu).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ folderId: '1' }));
  });
  it('returns from a nested wall without starting a scan or fetching unrelated roots', () => {
    const folder = root('parent', 2);
    const props = setup([folder], [target(folder)]);
    fireEvent.click(screen.getByRole('button', { name: '上级文件夹' }));
    expect(props.onLocationChange).toHaveBeenCalledWith({ trail: [] });
    expect(props.loadChildren).not.toHaveBeenCalled();
  });
});
