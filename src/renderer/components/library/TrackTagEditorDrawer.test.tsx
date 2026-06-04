// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TrackTagEditorDrawer, applyNetworkCandidateToForm, defaultNetworkFieldSelection } from './TrackTagEditorDrawer';
import type { LibraryTrack, NetworkTagCandidate } from '../../../shared/types/library';
import type { LyricsSearchCandidate, TrackLyrics } from '../../../shared/types/lyrics';

const track = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\Local Song.flac',
  title: 'Local Song',
  artist: 'Local Artist',
  album: 'Local Album',
  albumArtist: 'Local Artist',
  trackNo: 1,
  discNo: null,
  year: null,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
  ...overrides,
});

const candidate = (overrides: Partial<NetworkTagCandidate> = {}): NetworkTagCandidate => ({
  id: 'candidate-1',
  provider: 'netease-cloud-music',
  confidence: 0.88,
  title: 'Network Song',
  artist: 'Network Artist',
  album: 'Network Album',
  albumArtist: 'Network Album Artist',
  trackNo: 2,
  discNo: 1,
  year: 2026,
  genre: 'Pop',
  duration: 181,
  coverUrl: 'https://example.test/cover.jpg',
  coverPreviewUrl: 'https://example.test/cover.jpg',
  coverMimeType: 'image/jpeg',
  raw: {},
  ...overrides,
});

const lyricsCandidate = (overrides: Partial<LyricsSearchCandidate> = {}): LyricsSearchCandidate => ({
  id: 'lyrics-candidate-1',
  provider: 'lrclib',
  providerLyricsId: 'lrclib-1',
  title: 'Local Song',
  artist: 'Local Artist',
  album: 'Local Album',
  durationSeconds: 180,
  instrumental: false,
  hasSynced: true,
  hasPlain: true,
  score: 0.96,
  sourceLabel: 'LRCLIB',
  risk: 'low',
  ...overrides,
});

const trackLyrics = (overrides: Partial<TrackLyrics> = {}): TrackLyrics => ({
  id: 'lyrics-1',
  trackId: 'track-1',
  provider: 'lrclib',
  providerLyricsId: 'lrclib-1',
  kind: 'synced',
  title: 'Local Song',
  artist: 'Local Artist',
  album: 'Local Album',
  durationSeconds: 180,
  lines: [{ timeMs: 1000, text: 'Line' }],
  plainText: 'Line',
  syncedText: '[00:01.00]Line',
  offsetMs: 0,
  score: 0.96,
  cachedAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
  ...overrides,
});

const installEcho = (
  searchNetworkTagCandidates = vi.fn(),
  lyricsOverrides: Partial<NonNullable<typeof window.echo>['lyrics']> = {},
  pluginOverrides: Partial<NonNullable<typeof window.echo>['plugins']> = {},
) => {
  window.echo = {
    library: {
      searchNetworkTagCandidates,
      chooseTrackCover: vi.fn(),
      loadEmbeddedTrackTags: vi.fn(),
      updateTrackTags: vi.fn(),
    },
    lyrics: {
      getForTrack: vi.fn().mockResolvedValue(null),
      searchCandidates: vi.fn().mockResolvedValue([]),
      applyCandidate: vi.fn().mockResolvedValue(trackLyrics()),
      embedToTrack: vi.fn().mockResolvedValue({
        trackId: 'track-1',
        provider: 'lrclib',
        kind: 'synced',
        textKind: 'synced',
        queued: true,
        message: '已加入后台写入队列；如果正在播放或加载音频，会自动延后写入。',
      }),
      markInstrumental: vi.fn(),
      rejectCandidate: vi.fn(),
      setOffset: vi.fn(),
      clearCache: vi.fn(),
      ...lyricsOverrides,
    },
    plugins: {
      list: vi.fn().mockResolvedValue({ directory: 'D:\\Echo\\plugins', plugins: [] }),
      queryMetadata: vi.fn().mockResolvedValue({ providers: [], candidates: [] }),
      getLogs: vi.fn().mockResolvedValue([]),
      ...pluginOverrides,
    },
  } as unknown as typeof window.echo;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TrackTagEditorDrawer network tags', () => {
  it('defaults empty fields to checked while keeping existing fields untouched at normal confidence', () => {
    const form = {
      title: 'Local Song',
      artist: 'Local Artist',
      album: '',
      albumArtist: '',
      trackNo: '1',
      discNo: '',
      year: '',
      genre: '',
    };

    expect(defaultNetworkFieldSelection(form, { coverThumb: null }, candidate())).toMatchObject({
      title: false,
      artist: false,
      album: true,
      albumArtist: true,
      trackNo: false,
      discNo: true,
      year: true,
      genre: true,
      cover: true,
    });
  });

  it('allows high-confidence candidates to overwrite existing fields by default', () => {
    const form = {
      title: 'Local Song',
      artist: 'Local Artist',
      album: 'Local Album',
      albumArtist: 'Local Artist',
      trackNo: '1',
      discNo: '',
      year: '',
      genre: '',
    };

    expect(defaultNetworkFieldSelection(form, { coverThumb: 'echo-cover://thumb/current' }, candidate({ confidence: 0.95 }))).toMatchObject({
      title: true,
      artist: true,
      album: true,
      cover: true,
    });
  });

  it('applies only selected candidate fields to the form model', () => {
    const form = {
      title: 'Local Song',
      artist: 'Local Artist',
      album: '',
      albumArtist: '',
      trackNo: '',
      discNo: '',
      year: '',
      genre: '',
    };

    const next = applyNetworkCandidateToForm(form, candidate(), {
      title: false,
      artist: true,
      album: true,
      albumArtist: false,
      trackNo: false,
      discNo: false,
      year: true,
      genre: false,
      cover: false,
    });

    expect(next).toMatchObject({
      title: 'Local Song',
      artist: 'Network Artist',
      album: 'Network Album',
      albumArtist: '',
      year: '2026',
    });
  });

  it('renders professional Chinese field labels', () => {
    installEcho();

    render(<TrackTagEditorDrawer track={track()} isOpen isSaving={false} error={null} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '编辑标签' })).toBeTruthy();
    expect(screen.getByLabelText('标题')).toBeTruthy();
    expect(screen.getByLabelText('艺术家')).toBeTruthy();
    expect(screen.getByLabelText('专辑')).toBeTruthy();
    expect(screen.getByLabelText('专辑艺术家')).toBeTruthy();
    expect(screen.getByLabelText('音轨号')).toBeTruthy();
    expect(screen.getByLabelText('碟号')).toBeTruthy();
    expect(screen.getByLabelText('年份')).toBeTruthy();
    expect(screen.getByLabelText('流派')).toBeTruthy();
  });

  it('selecting a network candidate shows comparison, updates the visible form, and does not save the file', async () => {
    const onSave = vi.fn();
    const searchNetworkTagCandidates = vi.fn().mockResolvedValue([candidate({ confidence: 0.96 })]);
    installEcho(searchNetworkTagCandidates);

    render(<TrackTagEditorDrawer track={track()} isOpen isSaving={false} error={null} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('tab', { name: '网络候选' }));
    fireEvent.click(screen.getByRole('button', { name: '搜索候选' }));
    await screen.findByText('Network Song');
    fireEvent.click(screen.getByText('Network Song'));

    const comparePanel = screen.getByLabelText('网络候选对比');
    expect(within(comparePanel).getByText('当前')).toBeTruthy();
    expect(within(comparePanel).getByText('候选')).toBeTruthy();
    expect(within(comparePanel).getByText('Local Song')).toBeTruthy();
    expect(within(comparePanel).getAllByText('Network Song').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '应用选中字段' }));

    expect(screen.getByText('已应用到表单，点击保存后才会写入文件和媒体库。')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '标签' }));
    await waitFor(() => expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('Network Song'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('queries plugin metadata candidates manually without saving the file', async () => {
    const onSave = vi.fn();
    const queryMetadata = vi.fn().mockResolvedValue({
      providers: [{ pluginId: 'echo.meta', id: 'tags', label: 'Plugin Tags' }],
      candidates: [
        {
          pluginId: 'echo.meta',
          providerId: 'tags',
          title: 'Plugin Song',
          artist: 'Plugin Artist',
          album: 'Plugin Album',
          year: 2026,
          confidence: 0.82,
          source: 'Plugin Tags',
        },
      ],
    });
    installEcho(vi.fn(), {}, { queryMetadata });

    render(<TrackTagEditorDrawer track={track()} isOpen isSaving={false} error={null} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('tab', { name: '网络候选' }));
    fireEvent.click(screen.getByRole('button', { name: '插件候选' }));

    await screen.findByText('Plugin Song');
    expect(queryMetadata).toHaveBeenCalledWith({
      track: {
        id: 'track-1',
        title: 'Local Song',
        artist: 'Local Artist',
        album: 'Local Album',
        albumArtist: 'Local Artist',
        duration: 180,
      },
    });
    expect(screen.getByText('Plugin Tags')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('can limit plugin metadata search to a selected provider', async () => {
    const queryMetadata = vi.fn().mockResolvedValue({
      providers: [{ pluginId: 'echo.meta', id: 'tags', title: 'Plugin Tags' }],
      candidates: [],
    });
    installEcho(vi.fn(), {}, {
      list: vi.fn().mockResolvedValue({
        directory: 'D:\\Echo\\plugins',
        plugins: [
          {
            id: 'echo.meta',
            enabled: true,
            status: 'running',
            metadataProviders: [{ pluginId: 'echo.meta', id: 'tags', title: 'Plugin Tags' }],
          },
        ],
      }),
      queryMetadata,
    });

    render(<TrackTagEditorDrawer track={track()} isOpen isSaving={false} error={null} onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: '网络候选' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Plugin Tags' }));
    fireEvent.click(screen.getByRole('button', { name: '插件候选' }));

    await waitFor(() =>
      expect(queryMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: { pluginId: 'echo.meta', providerId: 'tags' },
        }),
      ),
    );
  });

  it('shows recent plugin metadata logs when plugin candidate search fails', async () => {
    const queryMetadata = vi.fn().mockRejectedValue(new Error('plugin_metadata_provider_timeout'));
    const getLogs = vi.fn().mockResolvedValue([
      {
        id: 'log-1',
        pluginId: 'echo.meta',
        level: 'error',
        message: 'metadata provider failed: plugin_metadata_provider_timeout',
        createdAt: '2026-05-25T00:00:00.000Z',
      },
      {
        id: 'log-2',
        pluginId: 'echo.meta',
        level: 'info',
        message: 'ordinary log',
        createdAt: '2026-05-25T00:00:01.000Z',
      },
    ]);
    installEcho(vi.fn(), {}, {
      list: vi.fn().mockResolvedValue({
        directory: 'D:\\Echo\\plugins',
        plugins: [
          {
            id: 'echo.meta',
            enabled: true,
            status: 'running',
            metadataProviders: [{ pluginId: 'echo.meta', id: 'tags', title: 'Plugin Tags' }],
          },
        ],
      }),
      queryMetadata,
      getLogs,
    });

    render(<TrackTagEditorDrawer track={track()} isOpen isSaving={false} error={null} onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.click(screen.getAllByRole('tab')[1]);
    fireEvent.click(await screen.findByRole('button', { name: 'Plugin Tags' }));
    fireEvent.click(document.querySelector('.tag-editor-heading-actions button:last-child')!);

    await screen.findByText('metadata provider failed: plugin_metadata_provider_timeout');
    expect(getLogs).toHaveBeenCalledWith('echo.meta');
    expect(screen.queryByText('ordinary log')).toBeNull();
  });

  it('loading embedded tags updates the form and notifies the parent with the refreshed track', async () => {
    const onTrackUpdated = vi.fn();
    const updatedTrack = track({
      title: '山海',
      artist: '草东没有派对',
      album: '丑奴儿',
      albumArtist: '草东没有派对',
      trackNo: 10,
      year: 2016,
      coverThumb: 'echo-cover://thumb/reloaded',
    });
    installEcho();
    window.echo.library.loadEmbeddedTrackTags = vi.fn().mockResolvedValue({
      tags: {
        title: updatedTrack.title,
        artist: updatedTrack.artist,
        album: updatedTrack.album,
        albumArtist: updatedTrack.albumArtist,
        trackNo: updatedTrack.trackNo,
        discNo: updatedTrack.discNo,
        year: updatedTrack.year,
        genre: updatedTrack.genre,
      },
      coverId: 'reloaded',
      coverThumb: updatedTrack.coverThumb,
      track: updatedTrack,
    });

    render(<TrackTagEditorDrawer track={track()} isOpen isSaving={false} error={null} onClose={vi.fn()} onSave={vi.fn()} onTrackUpdated={onTrackUpdated} />);

    fireEvent.click(screen.getByRole('button', { name: '从内嵌标签加载' }));

    await waitFor(() => expect(window.echo.library.loadEmbeddedTrackTags).toHaveBeenCalledWith('track-1'));
    expect(onTrackUpdated).toHaveBeenCalledWith(updatedTrack);
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('山海');
    expect((screen.getByLabelText('艺术家') as HTMLInputElement).value).toBe('草东没有派对');
    expect(screen.getByText('已从源文件内嵌标签重新加载，并同步更新媒体库。')).toBeTruthy();
  });

  it('toggles all candidate fields from the select-all checkbox', async () => {
    const searchNetworkTagCandidates = vi.fn().mockResolvedValue([candidate({ confidence: 0.88 })]);
    installEcho(searchNetworkTagCandidates);

    render(<TrackTagEditorDrawer track={track()} isOpen isSaving={false} error={null} onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: '网络候选' }));
    fireEvent.click(screen.getByRole('button', { name: '搜索候选' }));
    await screen.findByText('Network Song');
    fireEvent.click(screen.getByText('Network Song'));

    const selectAll = screen.getByLabelText('全选') as HTMLInputElement;
    expect(selectAll.indeterminate).toBe(true);

    fireEvent.click(selectAll);

    const fieldCheckboxes = document.querySelectorAll('.tag-editor-compare-row input[type="checkbox"]:not(:disabled)');
    expect([...fieldCheckboxes].every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true);
  });

  it('blocks saving invalid positive integer fields', () => {
    const onSave = vi.fn();
    installEcho();

    render(<TrackTagEditorDrawer track={track()} isOpen isSaving={false} error={null} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('年份'), { target: { value: 'twenty' } });
    fireEvent.submit(document.querySelector('.tag-editor-drawer')!);

    expect(screen.getByText('年份必须是正整数或留空')).toBeTruthy();
    expect(screen.getByText('请先修正标红字段，再保存标签。')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('asks for confirmation before closing with unsaved changes', () => {
    const onClose = vi.fn();
    installEcho();

    render(<TrackTagEditorDrawer track={track()} isOpen isSaving={false} error={null} onClose={onClose} onSave={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Changed Song' } });
    fireEvent.click(screen.getAllByRole('button', { name: '关闭编辑标签' })[1]);

    expect(screen.getByText('有未保存更改，确认关闭并丢弃吗？')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '丢弃更改' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('searches lyrics and applies a candidate to the lyrics cache without saving tags', async () => {
    const onSave = vi.fn();
    const searchCandidates = vi.fn().mockResolvedValue([
      lyricsCandidate({ id: 'lyrics-candidate-cache', title: 'Lyrics Song', artist: 'Lyrics Artist' }),
    ]);
    const applyCandidate = vi.fn().mockResolvedValue(trackLyrics({ title: 'Lyrics Song', artist: 'Lyrics Artist' }));
    installEcho(vi.fn(), { searchCandidates, applyCandidate });

    render(<TrackTagEditorDrawer track={track()} isOpen isSaving={false} error={null} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('tab', { name: '歌词' }));
    fireEvent.click(screen.getByRole('button', { name: '搜索歌词' }));
    await screen.findByText('Lyrics Song');
    fireEvent.click(screen.getByRole('button', { name: '应用到歌词库' }));

    await waitFor(() => expect(applyCandidate).toHaveBeenCalledWith('track-1', 'lyrics-candidate-cache'));
    expect(screen.getByText('已应用到歌词库，不会写入源音频文件。')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('embeds a lyrics candidate through the new lyrics API', async () => {
    const searchCandidates = vi.fn().mockResolvedValue([
      lyricsCandidate({ id: 'lyrics-candidate-embed', title: 'Embed Lyrics', artist: 'Lyrics Artist' }),
    ]);
    const embedToTrack = vi.fn().mockResolvedValue({
      trackId: 'track-1',
      provider: 'lrclib',
      kind: 'synced',
      textKind: 'synced',
      queued: true,
      message: '已加入后台写入队列；如果正在播放或加载音频，会自动延后写入。',
    });
    installEcho(vi.fn(), { searchCandidates, embedToTrack, getForTrack: vi.fn().mockResolvedValue(trackLyrics()) });

    render(<TrackTagEditorDrawer track={track()} isOpen isSaving={false} error={null} onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: '歌词' }));
    fireEvent.click(screen.getByRole('button', { name: '搜索歌词' }));
    await screen.findByText('Embed Lyrics');
    fireEvent.click(screen.getByRole('button', { name: '应用并嵌入文件' }));

    await waitFor(() =>
      expect(embedToTrack).toHaveBeenCalledWith('track-1', {
        candidateId: 'lyrics-candidate-embed',
        preferSynced: true,
      }),
    );
    expect(screen.getByText('已加入后台写入队列；如果正在播放或加载音频，会自动延后写入。')).toBeTruthy();
  });

  it('disables file embedding for remote tracks while keeping lyrics cache actions available', async () => {
    const searchCandidates = vi.fn().mockResolvedValue([
      lyricsCandidate({ id: 'lyrics-candidate-remote', title: 'Remote Lyrics' }),
    ]);
    installEcho(vi.fn(), { searchCandidates });

    render(<TrackTagEditorDrawer track={track({ mediaType: 'remote' })} isOpen isSaving={false} error={null} onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: '歌词' }));
    fireEvent.click(screen.getByRole('button', { name: '搜索歌词' }));
    await screen.findByText('Remote Lyrics');

    expect(screen.getByText('此曲目只能应用到歌词库，不能写入源文件。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '应用并嵌入文件' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '应用到歌词库' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a friendly error when the network provider fails', async () => {
    installEcho(vi.fn().mockRejectedValue(new Error('网络来源暂时不可用，请稍后再试。')));

    render(<TrackTagEditorDrawer track={track()} isOpen isSaving={false} error={null} onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: '网络候选' }));
    fireEvent.click(screen.getByRole('button', { name: '搜索候选' }));

    expect(await screen.findByText('暂时没有拿到标签候选。请检查网络元数据来源或稍后重试；如果要搜歌词，请切到“歌词”页签。')).toBeTruthy();
  });
});
