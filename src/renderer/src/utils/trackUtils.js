export const stripExtension = (name = "") => name.replace(/\.[^/.]+$/, "");

export const parseArtistTitleFromName = (name = "") => {
  const separators = [" - ", " – ", " — ", "_", "／", "/", "-", "–", "—"];
  for (const separator of separators) {
    if (!name.includes(separator)) continue;
    const [left, ...rest] = name.split(separator);
    if (!left || rest.length === 0) continue;
    const artist = left.trim();
    const title = rest.join(separator).trim();
    if (artist && title) return { artist, title };
  }
  return null;
};

export const toOrderNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
};

export const compareTrackOrder = (a, b) => {
  const discDiff = toOrderNumber(a.info.discNo) - toOrderNumber(b.info.discNo);
  if (discDiff !== 0) return discDiff;

  const trackDiff =
    toOrderNumber(a.info.trackNo) - toOrderNumber(b.info.trackNo);
  if (trackDiff !== 0) return trackDiff;

  return a.info.fileName.localeCompare(b.info.fileName, undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

export const parseTrackInfo = (track, meta) => {
  const rawName = track?.name || "";
  const fileName = stripExtension(rawName);
  const pathParts = (track?.path || "").split(/[/\\]/).filter(Boolean);
  const folderAlbum =
    pathParts.length > 1 ? pathParts[pathParts.length - 2] : "Unknown Album";

  const trackNoFromName =
    fileName.match(/^\s*(\d{1,3})[.)\-\s_]+/)?.[1] || null;
  const noTrackNo = fileName.replace(/^\s*\d+[.)\-\s_]+/, "").trim();
  const normalized = noTrackNo || fileName;
  const parsedName = parseArtistTitleFromName(normalized);

  const metaArtist =
    meta?.artist && meta.artist !== "Unknown Artist" ? meta.artist : null;
  const artist =
    metaArtist || meta?.albumArtist || parsedName?.artist || "Unknown Artist";
  const title =
    meta?.title || parsedName?.title || normalized || "Unknown Track";

  return {
    fileName,
    title,
    artist,
    album: meta?.album || track?.album || folderAlbum || "Unknown Album",
    cover: meta?.cover || null,
    trackNo:
      meta?.trackNo ?? (trackNoFromName ? Number(trackNoFromName) : null),
    discNo: meta?.discNo ?? null,
  };
};
