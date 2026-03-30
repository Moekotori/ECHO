export const getArtistInfoUrl = (artist = "") => {
  const artistPath = encodeURIComponent(artist.trim()).replace(/%20/g, "+");
  return `https://www.last.fm/music/${artistPath}`;
};

export const getAlbumInfoUrl = (artist = "", album = "", title = "") => {
  const safeArtist = (artist || "").trim();
  const safeAlbum = (album || "").trim();
  const safeTitle = (title || "").trim();
  const isUnknownAlbum = !safeAlbum || safeAlbum === "Unknown Album";
  const isUnknownArtist = !safeArtist || safeArtist === "Unknown Artist";

  if (!isUnknownAlbum && !isUnknownArtist) {
    const artistPath = encodeURIComponent(safeArtist).replace(/%20/g, "+");
    const albumPath = encodeURIComponent(safeAlbum).replace(/%20/g, "+");
    return `https://www.last.fm/music/${artistPath}/${albumPath}`;
  }

  const q = encodeURIComponent(
    [safeArtist, safeAlbum, safeTitle].filter(Boolean).join(" "),
  );
  return `https://www.last.fm/search/albums?q=${q}`;
};
