import { getAlbumInfoUrl } from "../utils/links";

export function AlbumCoverLink({
  artist,
  album,
  title,
  className = "",
  stopPropagation = false,
  children,
}) {
  const displayAlbum = (album || "Unknown Album").trim();
  const displayArtist = (artist || "Unknown Artist").trim();
  const displayTitle = (title || "").trim();
  const displayQuery = [displayArtist, displayAlbum, displayTitle]
    .filter((x) => x && x !== "Unknown Artist" && x !== "Unknown Album")
    .join(" ");

  const openAlbumPage = (e) => {
    if (stopPropagation) e.stopPropagation();
    e.preventDefault();
    window.open(
      getAlbumInfoUrl(displayArtist, displayAlbum, displayTitle),
      "_blank",
    );
  };

  return (
    <div
      role="link"
      tabIndex={0}
      className={`album-cover-link ${className}`.trim()}
      title={
        displayQuery
          ? `View album details: ${displayQuery}`
          : "View album details"
      }
      onClick={openAlbumPage}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          openAlbumPage(e);
        }
      }}
    >
      {children}
    </div>
  );
}
