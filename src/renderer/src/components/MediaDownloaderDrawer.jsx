import { useEffect } from "react";
import { X } from "lucide-react";
import DownloaderView from "../DownloaderView";

export default function MediaDownloaderDrawer({
  open,
  onClose,
  config,
  setConfig,
  t,
  onSuccess,
  userPlaylists,
  setUserPlaylists,
  setPlaylist,
  setSelectedUserPlaylistId,
}) {
  const tt = t || ((k) => k);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`lyrics-drawer-backdrop ${open ? "lyrics-drawer-backdrop--open" : ""}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`lyrics-drawer-panel ${open ? "lyrics-drawer-panel--open" : ""}`}
        role="dialog"
        aria-label={tt("md.aria")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lyrics-drawer-header">
          <h2 className="lyrics-drawer-title">{tt("md.title")}</h2>
          <button
            type="button"
            className="lyrics-drawer-close"
            onClick={onClose}
            aria-label={tt("lyrics.close")}
          >
            <X size={20} />
          </button>
        </div>
        <div className="lyrics-drawer-body md-drawer-body">
          <DownloaderView
            t={tt}
            config={config}
            setConfig={setConfig}
            onSuccess={onSuccess}
            userPlaylists={userPlaylists}
            setUserPlaylists={setUserPlaylists}
            setPlaylist={setPlaylist}
            setSelectedUserPlaylistId={setSelectedUserPlaylistId}
          />
        </div>
      </aside>
    </>
  );
}
