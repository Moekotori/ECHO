/**
 * 用户自定义播放列表：导入/导出与合并（路径与主库曲目 path 对齐）
 */

export const PLAYLISTS_FILE_TYPE = "echoes-user-playlists";

export function normalizeImportedPlaylists(data) {
  if (!data || typeof data !== "object") return [];
  if (data.type === PLAYLISTS_FILE_TYPE && Array.isArray(data.playlists)) {
    return data.playlists.map((p) => ({
      id: crypto.randomUUID(),
      name: String(p.name || "Playlist"),
      paths: Array.isArray(p.paths)
        ? p.paths.filter((x) => typeof x === "string")
        : [],
    }));
  }
  if (Array.isArray(data.playlists)) {
    return data.playlists.map((p) => ({
      id: crypto.randomUUID(),
      name: String(p?.name || "Playlist"),
      paths: Array.isArray(p?.paths)
        ? p.paths.filter((x) => typeof x === "string")
        : [],
    }));
  }
  if (data.name != null && Array.isArray(data.paths)) {
    return [
      {
        id: crypto.randomUUID(),
        name: String(data.name || "Playlist"),
        paths: data.paths.filter((x) => typeof x === "string"),
      },
    ];
  }
  return [];
}

export function buildPlaylistsExportPayload(playlists) {
  return {
    type: PLAYLISTS_FILE_TYPE,
    v: 1,
    playlists: playlists.map(({ name, paths }) => ({
      name,
      paths: [...paths],
    })),
  };
}
