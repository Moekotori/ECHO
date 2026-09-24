import {
  Heart,
  ListPlus,
  MoreHorizontal,
  Music2,
  Play,
  SkipForward,
  Trash2,
} from "lucide-react";
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type {
  LibraryPlaylistItem,
  LibraryTrack,
} from "../../../shared/types/library";
import { useI18n } from "../../i18n/I18nProvider";

type LikedTrackTableProps = {
  items: LibraryPlaylistItem[];
  tracks: LibraryTrack[];
  currentTrackId: string | null;
  selectedTrackIds: Record<string, boolean>;
  onToggleSelected: (
    track: LibraryTrack,
    index: number,
    range: boolean,
  ) => void;
  onToggleSelectAll: () => void;
  onPlay: (track: LibraryTrack) => void;
  onPlayNext: (track: LibraryTrack) => void;
  onAddToQueue: (track: LibraryTrack) => void;
  onToggleLiked: (track: LibraryTrack) => void;
  loadMoreSentinel?: ReactNode;
};

const formatDuration = (duration: number): string => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return "--:--";
  }

  const totalSeconds = Math.round(duration);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
};

const formatQuality = (track: LibraryTrack): string => {
  const codec = track.codec?.trim().toUpperCase();
  if (codec) {
    return codec;
  }
  if (track.streamingQuality === "hires") {
    return "Hi-Res";
  }
  if (track.streamingQuality === "lossless") {
    return "Lossless";
  }
  if (track.bitrate && track.bitrate > 0) {
    return `${Math.round(track.bitrate / 1000)} kbps`;
  }
  return "—";
};

const formatAddedAt = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  if (isToday) {
    return `今天 ${time}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const closeRowMenu = (event: ReactMouseEvent<HTMLButtonElement>): void => {
  event.currentTarget.closest("details")?.removeAttribute("open");
};

export const LikedTrackTable = ({
  items,
  tracks,
  currentTrackId,
  selectedTrackIds,
  onToggleSelected,
  onToggleSelectAll,
  onPlay,
  onPlayNext,
  onAddToQueue,
  onToggleLiked,
  loadMoreSentinel,
}: LikedTrackTableProps): JSX.Element => {
  const { t } = useI18n();
  const selectedCount = tracks.reduce(
    (count, track) => count + (selectedTrackIds[track.id] ? 1 : 0),
    0,
  );
  const selectableCount = tracks.reduce(
    (count, track) => count + (track.unavailable ? 0 : 1),
    0,
  );
  const allSelected =
    selectableCount > 0 && selectedCount === selectableCount;

  const handleSelectAll = (event: ChangeEvent<HTMLInputElement>): void => {
    event.stopPropagation();
    onToggleSelectAll();
  };

  return (
    <section
      className="liked-track-table"
      data-has-selection={selectedCount > 0 ? "true" : "false"}
      data-infinite-scroll-root="true"
      role="table"
      aria-label={t("likedPage.table.aria")}
    >
      <div className="liked-track-table-head" role="row">
        <span className="liked-track-select-cell" role="columnheader">
          <input
            type="checkbox"
            checked={allSelected}
            aria-label={
              allSelected
                ? t("likedPage.selection.clear")
                : t("likedPage.selection.selectAll")
            }
            onChange={handleSelectAll}
          />
        </span>
        <span role="columnheader">{t("likedPage.table.track")}</span>
        <span role="columnheader">{t("likedPage.table.album")}</span>
        <span role="columnheader">{t("likedPage.table.quality")}</span>
        <span role="columnheader">{t("likedPage.table.added")}</span>
        <span role="columnheader">{t("likedPage.table.duration")}</span>
        <span role="columnheader" aria-label={t("likedPage.action.more")} />
      </div>

      <div className="liked-track-table-body" role="rowgroup">
        {tracks.map((track, index) => {
          const item = items[index];
          const isSelected = selectedTrackIds[track.id] === true;
          const isPlaying = track.id === currentTrackId;
          return (
            <div
              className="liked-track-table-row"
              data-playing={isPlaying ? "true" : undefined}
              data-selected={isSelected ? "true" : undefined}
              data-unavailable={track.unavailable ? "true" : undefined}
              key={item?.id ?? track.id}
              role="row"
              aria-selected={isSelected}
              aria-keyshortcuts="Enter Space ArrowUp ArrowDown Home End"
              tabIndex={track.unavailable ? -1 : 0}
              onDoubleClick={() => !track.unavailable && onPlay(track)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) {
                  return;
                }
                if (!track.unavailable && event.key === "Enter") {
                  event.preventDefault();
                  onPlay(track);
                  return;
                }
                if (!track.unavailable && event.key === " ") {
                  event.preventDefault();
                  onToggleSelected(track, index, event.shiftKey);
                  return;
                }
                if (
                  event.key === "ArrowDown" ||
                  event.key === "ArrowUp" ||
                  event.key === "Home" ||
                  event.key === "End"
                ) {
                  event.preventDefault();
                  const rows = Array.from(
                    event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                      ".liked-track-table-row:not([data-unavailable='true'])",
                    ) ?? [],
                  );
                  const currentIndex = rows.indexOf(event.currentTarget);
                  const targetIndex =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? rows.length - 1
                        : Math.max(
                            0,
                            Math.min(
                              rows.length - 1,
                              currentIndex + (event.key === "ArrowDown" ? 1 : -1),
                            ),
                          );
                  rows[targetIndex]?.focus();
                }
              }}
            >
              <span className="liked-track-select-cell" role="cell">
                <input
                  type="checkbox"
                  checked={isSelected}
                  aria-label={t("likedPage.selection.track", {
                    title: track.title,
                  })}
                  onChange={() => undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleSelected(track, index, event.shiftKey);
                  }}
                />
              </span>

              <span className="liked-track-identity" role="cell">
                <span
                  className="liked-track-cover"
                  data-empty={!track.coverThumb}
                >
                  {track.coverThumb ? (
                    <img
                      src={track.coverThumb}
                      alt=""
                      loading={index < 18 ? "eager" : "lazy"}
                      draggable={false}
                    />
                  ) : (
                    <Music2 size={18} />
                  )}
                  {isPlaying ? (
                    <span className="liked-track-playing-bars" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <button
                      className="liked-track-play-button"
                      type="button"
                      aria-label={`${t("likedPage.row.play")} ${track.title}`}
                      disabled={track.unavailable}
                      onClick={(event) => {
                        event.stopPropagation();
                        onPlay(track);
                      }}
                    >
                      <Play size={14} fill="currentColor" />
                    </button>
                  )}
                </span>
                <span className="liked-track-copy">
                  <strong title={track.title}>{track.title}</strong>
                  <small title={track.artist}>{track.artist}</small>
                </span>
              </span>

              <span
                className="liked-track-album"
                role="cell"
                title={track.album}
              >
                {track.album || "—"}
              </span>
              <span className="liked-track-quality" role="cell">
                {formatQuality(track)}
              </span>
              <span className="liked-track-added" role="cell">
                {formatAddedAt(item?.addedAt ?? "")}
              </span>
              <span className="liked-track-duration" role="cell">
                {formatDuration(track.duration)}
              </span>

              <span className="liked-track-row-actions" role="cell">
                <details
                  className="liked-row-menu"
                  name="liked-track-menu"
                  onBlur={(event) => {
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    ) {
                      event.currentTarget.removeAttribute("open");
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      event.currentTarget.removeAttribute("open");
                      event.currentTarget.querySelector("summary")?.focus();
                    }
                  }}
                >
                  <summary
                    aria-label={t("likedPage.row.more", { title: track.title })}
                  >
                    <MoreHorizontal size={17} />
                  </summary>
                  <div className="liked-row-menu-popover">
                    <button
                      type="button"
                      disabled={track.unavailable}
                      onClick={(event) => {
                        closeRowMenu(event);
                        onPlay(track);
                      }}
                    >
                      <Play size={15} />
                      {t("likedPage.row.play")}
                    </button>
                    <button
                      type="button"
                      aria-label={t("likedPage.row.playNext", {
                        title: track.title,
                      })}
                      disabled={track.unavailable}
                      onClick={(event) => {
                        closeRowMenu(event);
                        onPlayNext(track);
                      }}
                    >
                      <SkipForward size={15} />
                      {t("likedPage.selection.playNext")}
                    </button>
                    <button
                      type="button"
                      aria-label={t("likedPage.row.addToQueue", {
                        title: track.title,
                      })}
                      disabled={track.unavailable}
                      onClick={(event) => {
                        closeRowMenu(event);
                        onAddToQueue(track);
                      }}
                    >
                      <ListPlus size={15} />
                      {t("likedPage.selection.addToQueue")}
                    </button>
                    <button
                      className="danger"
                      type="button"
                      onClick={(event) => {
                        closeRowMenu(event);
                        onToggleLiked(track);
                      }}
                    >
                      <Trash2 size={15} />
                      {t("likedPage.selection.remove")}
                    </button>
                  </div>
                </details>
                <button
                  className="liked-track-heart"
                  type="button"
                  aria-label={t("likedPage.album.unlikeAria", {
                    title: track.title,
                  })}
                  aria-pressed="true"
                  onClick={() => onToggleLiked(track)}
                >
                  <Heart size={17} fill="currentColor" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
      {loadMoreSentinel}
    </section>
  );
};
