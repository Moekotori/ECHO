import { getAlbumInfoUrl } from "../utils/links";

export function AlbumCoverLink({
  artist,
  album,
  title,
  className = "",
  stopPropagation = false,
  children,
  locale = "en",
}) {
  const tr = (en, zhCN) => (locale === "zh-CN" ? zhCN : en);
  const unknownAlbum = tr("Unknown Album", "未知专辑");
  const unknownArtist = tr("Unknown Artist", "未知艺术家");
  const displayAlbum = (album || unknownAlbum).trim();
  const displayArtist = (artist || unknownArtist).trim();
  const displayTitle = (title || "").trim();
  const displayQuery = [displayArtist, displayAlbum, displayTitle]
    .filter(
      (x) =>
        x &&
        x !== "Unknown Artist" &&
        x !== "Unknown Album" &&
        x !== unknownArtist &&
        x !== unknownAlbum,
    )
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
          ? tr(
              `View album details: ${displayQuery}`,
              `查看专辑详情：${displayQuery}`,
            )
          : tr("View album details", "查看专辑详情")
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
