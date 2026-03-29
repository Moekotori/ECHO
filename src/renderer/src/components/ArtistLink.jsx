import { getArtistInfoUrl } from "../utils/links";

export function ArtistLink({
  artist,
  className = "",
  stopPropagation = false,
  locale = "en",
}) {
  const tr = (en, zhCN) => (locale === "zh-CN" ? zhCN : en);
  const unknownArtist = tr("Unknown Artist", "未知艺术家");
  const displayArtist = (artist || unknownArtist).trim();
  const isUnknown =
    !displayArtist ||
    displayArtist === "Unknown Artist" ||
    displayArtist === unknownArtist;

  if (isUnknown) {
    return <span className={className || ""}>{unknownArtist}</span>;
  }

  const openArtistPage = (e) => {
    if (stopPropagation) e.stopPropagation();
    e.preventDefault();
    window.open(getArtistInfoUrl(displayArtist), "_blank");
  };

  return (
    <span
      role="link"
      tabIndex={0}
      className={`artist-link ${className}`.trim()}
      title={tr(`View ${displayArtist} details`, `查看 ${displayArtist} 详情`)}
      onClick={openArtistPage}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          openArtistPage(e);
        }
      }}
    >
      {displayArtist}
    </span>
  );
}
