import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';
const state = vi.hoisted(() => ({ accepted: false, handlers: new Map<string, (...args: any[]) => any>(), importPlaylist: vi.fn().mockResolvedValue({ playlistId: 'imported' }) }));
vi.mock('electron', () => ({ app: {}, dialog: {}, ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => state.handlers.set(channel, handler) } }));
vi.mock('../app/appSettings', () => ({ getAppSettings: () => ({ streamingPlaylistImportNoticeAccepted: state.accepted }) }));
vi.mock('../streaming/StreamingService', () => ({ getStreamingService: () => ({ importPlaylistFromUrl: state.importPlaylist }), getStreamingProviderDescriptors: vi.fn(), readDefaultStreamingFavoritesSnapshot: vi.fn() }));
vi.mock('../streaming/LiveStreamResolver', () => ({ resolveLiveStream: vi.fn() }));
import { registerStreamingIpc } from './streamingIpc';
describe('streaming playlist consent', () => {
  beforeEach(() => { state.accepted = false; state.importPlaylist.mockClear(); state.handlers.clear(); registerStreamingIpc(); });
  it('blocks import before contacting a provider when consent is absent', async () => {
    await expect(state.handlers.get(IpcChannels.StreamingImportPlaylistFromUrl)!(null, 'https://music.163.com/playlist?id=1')).rejects.toThrow('请先阅读并同意');
    expect(state.importPlaylist).not.toHaveBeenCalled();
  });
  it('imports only after persisted consent is present', async () => {
    state.accepted = true;
    await state.handlers.get(IpcChannels.StreamingImportPlaylistFromUrl)!(null, 'https://music.163.com/playlist?id=1');
    expect(state.importPlaylist).toHaveBeenCalledWith('https://music.163.com/playlist?id=1');
  });
});
