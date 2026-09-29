// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  LibraryPage,
  LibraryPlaylistItem,
  LibraryTrack,
} from "../../shared/types/library";
import { I18nProvider } from "../i18n/I18nProvider";
import { PlaybackQueueProvider } from "../stores/PlaybackQueueProvider";
import { LikedPage } from "./LikedPage";

vi.mock("../components/ui/InfiniteScrollSentinel", () => ({
  InfiniteScrollSentinel: ({
    canLoadMore,
    onLoadMore,
  }: {
    canLoadMore: boolean;
    onLoadMore: () => void;
  }) => (
    <button type="button" disabled={!canLoadMore} onClick={onLoadMore}>
      Load more liked
    </button>
  ),
  readPageScrollTop: () => 0,
  writePageScrollTop: () => undefined,
}));

const track = (
  id: string,
  overrides: Partial<LibraryTrack> = {},
): LibraryTrack => ({
  id,
  path: `D:\\Music\\${id}.flac`,
  title: `Track ${id}`,
  artist: "Artist",
  album: "Album",
  albumArtist: "Artist",
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: "flac",
  sampleRate: 96000,
  bitDepth: 24,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
  ...overrides,
});

const playlistItem = (
  id: string,
  overrides: Partial<LibraryPlaylistItem> = {},
): LibraryPlaylistItem => ({
  id,
  playlistId: "liked",
  mediaType: "track",
  mediaId: id,
  sourceProvider: "local",
  sourceItemId: null,
  titleSnapshot: null,
  artistSnapshot: null,
  albumSnapshot: null,
  durationSnapshot: null,
  coverId: null,
  coverThumb: null,
  position: 1,
  addedAt: "2026-07-22T08:00:00.000Z",
  addedFrom: null,
  unavailable: false,
  track: null,
  album: null,
  ...overrides,
});

const page = <T,>(
  items: T[],
  overrides: Partial<LibraryPage<T>> = {},
): LibraryPage<T> => ({
  items,
  page: 1,
  pageSize: 100,
  total: items.length,
  hasMore: false,
  ...overrides,
});

const installLibrary = (
  getLikedTracks: ReturnType<typeof vi.fn>,
  getLikedAlbums: ReturnType<typeof vi.fn>,
  syncLikedSongs: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    playlistId: "liked",
    importedCount: 0,
    addedCount: 0,
    providers: [],
    syncedAt: "2026-07-22T08:00:00.000Z",
  }),
  exportPlaylist: ReturnType<typeof vi.fn> = vi
    .fn()
    .mockResolvedValue("D:\\Exports\\liked.json"),
): void => {
  window.echo = {
    library: {
      getLikedTracks,
      getLikedAlbums,
      getLikedSongsPlaylist: vi.fn().mockResolvedValue({ id: "liked-tracks" }),
      exportPlaylist,
      unlikeTrack: vi.fn(),
      unlikeAlbum: vi.fn(),
      clearLikedTracks: vi.fn(),
      clearLikedAlbums: vi.fn(),
    },
    playback: {
      getStatus: vi.fn(),
      playLocalFile: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      openLocalAudioFile: vi.fn(),
    },
    streaming: {
      syncLikedSongs,
      setTrackLiked: vi.fn(),
    },
  } as unknown as Window["echo"];
};

const renderLikedPage = (): ReturnType<typeof render> =>
  render(
    <I18nProvider>
      <PlaybackQueueProvider>
        <main className="page-surface">
          <LikedPage />
        </main>
      </PlaybackQueueProvider>
    </I18nProvider>,
  );

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", undefined);
  window.localStorage.setItem("echo-next.locale", "zh-CN");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LikedPage", () => {
  it("keeps the guided empty state inside the new collection workspace", async () => {
    installLibrary(
      vi.fn().mockResolvedValue(page([])),
      vi.fn().mockResolvedValue(page([])),
    );
    renderLikedPage();

    expect(await screen.findByText("把喜欢的音乐，放在一个地方")).toBeTruthy();
    expect(screen.getByText("从以下来源添加喜欢的音乐")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "喜欢分类" })).toBeTruthy();
    expect(screen.queryByText("下载")).toBeNull();
  });

  it("renders the selected two-column table design without download actions", async () => {
    const item = playlistItem("track-1", { track: track("track-1") });
    installLibrary(
      vi.fn().mockResolvedValue(page([item])),
      vi.fn().mockResolvedValue(page([])),
    );
    const { container } = renderLikedPage();

    expect(await screen.findByText("Track track-1")).toBeTruthy();
    expect(container.querySelector(".liked-library-nav")).toBeTruthy();
    expect(container.querySelector(".liked-track-table")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "音质" })).toBeTruthy();
    expect(screen.queryByText("下载")).toBeNull();
    expect(screen.queryByRole("button", { name: /下载/ })).toBeNull();
  });

  it("switches sources as local filters without triggering network sync", async () => {
    const item = playlistItem("track-1", { track: track("track-1") });
    const getLikedTracks = vi.fn().mockResolvedValue(page([item]));
    const syncLikedSongs = vi.fn();
    installLibrary(
      getLikedTracks,
      vi.fn().mockResolvedValue(page([])),
      syncLikedSongs,
    );
    renderLikedPage();

    await screen.findByText("Track track-1");
    fireEvent.click(screen.getByRole("button", { name: "网易云" }));

    await waitFor(() =>
      expect(getLikedTracks).toHaveBeenCalledWith({
        page: 1,
        pageSize: 100,
        search: "",
        sort: "recent",
        sourceProvider: "netease",
      }),
    );
    expect(syncLikedSongs).not.toHaveBeenCalled();
  });

  it("sorts the most-played collection with the frequent library sort", async () => {
    const item = playlistItem("track-1", { track: track("track-1") });
    const getLikedTracks = vi.fn().mockResolvedValue(page([item]));
    installLibrary(getLikedTracks, vi.fn().mockResolvedValue(page([])));
    renderLikedPage();

    await screen.findByText("Track track-1");
    fireEvent.click(screen.getByRole("button", { name: /最常播放/ }));

    await waitFor(() =>
      expect(getLikedTracks).toHaveBeenCalledWith({
        page: 1,
        pageSize: 100,
        search: "",
        sort: "frequent",
      }),
    );
  });

  it("keeps all tracks distinct from the recently-liked shortcut", async () => {
    const item = playlistItem("track-1", { track: track("track-1") });
    const getLikedTracks = vi.fn().mockResolvedValue(page([item]));
    const getLikedAlbums = vi.fn().mockResolvedValue(page([]));
    installLibrary(getLikedTracks, getLikedAlbums);
    renderLikedPage();

    await screen.findByText("Track track-1");
    expect(getLikedTracks).toHaveBeenCalledWith({
      page: 1,
      pageSize: 100,
      search: "",
      sort: "default",
    });

    getLikedAlbums.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /最近喜欢/ }));
    await waitFor(() =>
      expect(getLikedTracks).toHaveBeenCalledWith({
        page: 1,
        pageSize: 100,
        search: "",
        sort: "recent",
      }),
    );
    expect(getLikedAlbums).not.toHaveBeenCalled();
  });

  it("shows selection actions without offering download", async () => {
    const item = playlistItem("track-1", { track: track("track-1") });
    installLibrary(
      vi.fn().mockResolvedValue(page([item])),
      vi.fn().mockResolvedValue(page([])),
    );
    const { container } = renderLikedPage();

    await screen.findByText("Track track-1");
    expect(container.querySelector(".liked-track-table")?.getAttribute("data-has-selection")).toBe("false");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 Track track-1" }),
    );

    expect(container.querySelector(".liked-track-table")?.getAttribute("data-has-selection")).toBe("true");
    expect(screen.getByRole("toolbar", { name: "已选歌曲操作" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "播放下一首" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "添加到" })).toBeTruthy();
    expect(screen.queryByText("下载")).toBeNull();
  });

  it("supports keyboard row navigation and space selection", async () => {
    const first = playlistItem("track-1", { track: track("track-1") });
    const second = playlistItem("track-2", { track: track("track-2") });
    installLibrary(
      vi.fn().mockResolvedValue(page([first, second])),
      vi.fn().mockResolvedValue(page([])),
    );
    const { container } = renderLikedPage();

    await screen.findByText("Track track-1");
    const rows = container.querySelectorAll<HTMLElement>(
      ".liked-track-table-row",
    );
    rows[0]?.focus();
    fireEvent.keyDown(rows[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);

    fireEvent.keyDown(rows[1]!, { key: " " });
    expect(
      (
        screen.getByRole("checkbox", {
          name: "选择 Track track-2",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("closes a row menu after running an action", async () => {
    const item = playlistItem("track-1", { track: track("track-1") });
    installLibrary(
      vi.fn().mockResolvedValue(page([item])),
      vi.fn().mockResolvedValue(page([])),
    );
    const { container } = renderLikedPage();

    await screen.findByText("Track track-1");
    const menu = container.querySelector<HTMLDetailsElement>(
      ".liked-row-menu",
    )!;
    menu.open = true;
    fireEvent.click(
      screen.getByRole("button", {
        name: "将 Track track-1 设为下一首",
      }),
    );

    expect(menu.open).toBe(false);
  });

  it("syncs a provider from its dedicated sidebar control", async () => {
    const item = playlistItem("track-1", { track: track("track-1") });
    const syncLikedSongs = vi.fn().mockResolvedValue({
      playlistId: "liked",
      importedCount: 2,
      addedCount: 1,
      providers: [
        {
          provider: "netease",
          success: true,
          importedCount: 2,
          addedCount: 1,
          total: 2,
        },
      ],
      syncedAt: "2026-07-22T08:00:00.000Z",
    });
    installLibrary(
      vi.fn().mockResolvedValue(page([item])),
      vi.fn().mockResolvedValue(page([])),
      syncLikedSongs,
    );
    renderLikedPage();

    await screen.findByText("Track track-1");
    fireEvent.click(screen.getByRole("button", { name: "同步收藏 网易云" }));

    await waitFor(() => expect(syncLikedSongs).toHaveBeenCalledWith("netease"));
    expect(
      await screen.findByText("网易云 我喜欢已同步：2 首，新增 1 首。"),
    ).toBeTruthy();
  });

  it("exports through More using an export icon rather than a download action", async () => {
    const item = playlistItem("track-1", { track: track("track-1") });
    const exportPlaylist = vi.fn().mockResolvedValue("D:\\Exports\\liked.json");
    installLibrary(
      vi.fn().mockResolvedValue(page([item])),
      vi.fn().mockResolvedValue(page([])),
      undefined,
      exportPlaylist,
    );
    renderLikedPage();

    await screen.findByText("Track track-1");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 Track track-1" }),
    );
    fireEvent.click(screen.getByText("更多操作"));
    fireEvent.click(screen.getByRole("button", { name: "导出" }));

    await waitFor(() =>
      expect(exportPlaylist).toHaveBeenCalledWith({
        playlistId: "liked-tracks",
        format: "json",
      }),
    );
    expect(screen.queryByText("下载")).toBeNull();
  });

  it("loads the next liked-track page from the workspace sentinel", async () => {
    const first = playlistItem("track-1", { track: track("track-1") });
    const second = playlistItem("track-2", { track: track("track-2") });
    const getLikedTracks = vi
      .fn()
      .mockImplementation(async (query: { page: number; pageSize: number }) => {
        if (query.pageSize === 1) {
          return page([], { total: 2 });
        }
        return query.page === 2
          ? page([second], { page: 2, total: 2 })
          : page([first], { page: 1, total: 2, hasMore: true });
      });
    installLibrary(getLikedTracks, vi.fn().mockResolvedValue(page([])));
    renderLikedPage();

    await screen.findByText("Track track-1");
    expect(
      document
        .querySelector(".liked-track-table")
        ?.contains(screen.getByRole("button", { name: "Load more liked" })),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Load more liked" }));

    await waitFor(() =>
      expect(getLikedTracks).toHaveBeenCalledWith({
        page: 2,
        pageSize: 100,
        search: "",
        sort: "default",
      }),
    );
    expect(await screen.findByText("Track track-2")).toBeTruthy();
  });

  it("loads the complete filtered collection before playing all", async () => {
    const first = playlistItem("track-1", { track: track("track-1") });
    const second = playlistItem("track-2", { track: track("track-2") });
    const getLikedTracks = vi
      .fn()
      .mockImplementation(async (query: { page: number; pageSize: number }) => {
        if (query.pageSize === 1) {
          return page([], { total: 2 });
        }
        if (query.pageSize === 500) {
          return query.page === 2
            ? page([second], { page: 2, pageSize: 500, total: 2 })
            : page([first], {
                page: 1,
                pageSize: 500,
                total: 2,
                hasMore: true,
              });
        }
        return page([first], { total: 2, hasMore: true });
      });
    installLibrary(getLikedTracks, vi.fn().mockResolvedValue(page([])));
    renderLikedPage();

    await screen.findByText("Track track-1");
    fireEvent.click(screen.getByRole("button", { name: "播放全部" }));

    await waitFor(() =>
      expect(getLikedTracks).toHaveBeenCalledWith({
        page: 2,
        pageSize: 500,
        search: "",
        sort: "default",
      }),
    );
  });
});
