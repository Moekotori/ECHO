import { useState, useEffect, useCallback } from "react";
import {
  Download,
  FolderHeart,
  Music,
  Loader2,
  CheckCircle2,
  AlertCircle,
  CloudDownload,
} from "lucide-react";

export default function DownloaderView({
  t,
  config,
  setConfig,
  onSuccess,
  userPlaylists = [],
  setUserPlaylists,
  setPlaylist,
  setSelectedUserPlaylistId,
}) {
  const tt =
    t ||
    ((k, vars) => {
      if (!vars) return k;
      return String(k).replace(
        /\{(\w+)\}/g,
        (_, name) => vars[name] ?? `{${name}}`,
      );
    });
  const [url, setUrl] = useState("");
  const [metadata, setMetadata] = useState(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [linkImportUrl, setLinkImportUrl] = useState("");
  const [linkImportTarget, setLinkImportTarget] = useState("new");
  const [linkImporting, setLinkImporting] = useState(false);
  const [linkImportStatus, setLinkImportStatus] = useState("");

  const handleLinkPlaylistImport = useCallback(async () => {
    if (!window.api?.playlistLink?.importPlaylist) return;
    const playlistSaveDir = (
      config.playlistImportFolder ||
      config.downloadFolder ||
      ""
    ).trim();
    if (!playlistSaveDir) {
      alert(tt("dlr.alert.setFolder"));
      return;
    }
    const raw = linkImportUrl.trim();
    if (!raw) return;
    setLinkImporting(true);
    setLinkImportStatus(tt("dlr.status.connecting"));
    const unsub = window.api.playlistLink.onImportProgress((p) => {
      if (p.phase === "meta") {
        setLinkImportStatus(`${p.playlistName} · ${p.total} tracks`);
      } else if (p.phase === "download") {
        setLinkImportStatus(
          `Downloading ${p.current}/${p.total} · ${p.trackName || ""}`,
        );
      } else if (p.phase === "bulk") {
        const pct =
          p.progress != null && Number.isFinite(p.progress)
            ? ` ${Math.round(p.progress)}%`
            : "";
        setLinkImportStatus(
          `${p.message || tt("dlr.status.downloading")}${pct}`,
        );
      }
    });
    try {
      const r = await window.api.playlistLink.importPlaylist({
        playlistInput: raw,
        downloadFolder: playlistSaveDir,
      });
      const newItems = (r.added || []).map(({ path, trackTitle }) => ({
        name:
          path.split(/[/\\]/).pop() || trackTitle || tt("dlr.track.default"),
        path,
        type: "local",
      }));
      if (newItems.length > 0 && setPlaylist) {
        setPlaylist((prev) => {
          const seen = new Set(prev.map((x) => x.path));
          const next = [...prev];
          for (const t of newItems) {
            if (!seen.has(t.path)) {
              seen.add(t.path);
              next.push(t);
            }
          }
          return next;
        });
        const paths = newItems.map((x) => x.path);
        if (setUserPlaylists && setSelectedUserPlaylistId) {
          if (linkImportTarget === "new") {
            const id = crypto.randomUUID();
            const plName = r.playlistName || tt("dlr.playlist.imported");
            setUserPlaylists((prev) => [...prev, { id, name: plName, paths }]);
            setSelectedUserPlaylistId(id);
          } else {
            setUserPlaylists((prev) =>
              prev.map((p) =>
                p.id === linkImportTarget
                  ? { ...p, paths: [...new Set([...p.paths, ...paths])] }
                  : p,
              ),
            );
            setSelectedUserPlaylistId(linkImportTarget);
          }
        }
      }
      const failN = (r.failed || []).length;
      const okN = (r.added || []).length;
      if (failN > 0) {
        const first = r.failed[0];
        alert(
          tt("dlr.importFinished", {
            ok: okN,
            failed: failN,
            name: first.name,
            error: first.error,
          }),
        );
      } else if (okN === 0) {
        alert(tt("dlr.noTracks"));
      }
      setLinkImportUrl("");
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      unsub();
      setLinkImporting(false);
      setLinkImportStatus("");
    }
  }, [
    config.playlistImportFolder,
    config.downloadFolder,
    linkImportUrl,
    linkImportTarget,
    setPlaylist,
    setUserPlaylists,
    setSelectedUserPlaylistId,
  ]);

  useEffect(() => {
    const unsubscribe = window.api.media.onProgress((data) => {
      setProgress(data.progress);
    });
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  const handleFetchMetadata = async () => {
    if (!url.trim()) return;
    setIsLoadingMeta(true);
    setStatus("loading_meta");
    setErrorMsg("");
    setMetadata(null);
    try {
      const meta = await window.api.media.getMetadata(url);
      setMetadata(meta);
      setStatus("ready");
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || tt("dlr.error.fetchMetadata"));
      setStatus("error");
    } finally {
      setIsLoadingMeta(false);
    }
  };

  const handleDownload = async () => {
    if (!url || !config.downloadFolder) return;
    setIsDownloading(true);
    setStatus("downloading");
    setProgress(0);
    setErrorMsg("");

    // Scan existing folder files before download
    const filesBefore = await window.api
      .readDirectoryHandler(config.downloadFolder)
      .catch(() => []);

    try {
      await window.api.media.downloadAudio(url, config.downloadFolder);
      setStatus("success");

      // Auto-add feature: Diff files to find the new one
      const filesAfter = await window.api
        .readDirectoryHandler(config.downloadFolder)
        .catch(() => []);
      const newFiles = filesAfter.filter(
        (fa) => !filesBefore.find((fb) => fb.path === fa.path),
      );

      if (newFiles.length > 0 && onSuccess) {
        onSuccess(newFiles[0].path);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || tt("dlr.error.download"));
      setStatus("error");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="md-root">
      <section className="md-section">
        <div className="md-input-row">
          <input
            type="text"
            className="md-input"
            placeholder={tt("md.link.placeholder")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            type="button"
            className="md-btn-parse"
            onClick={handleFetchMetadata}
            disabled={!url || isLoadingMeta || isDownloading}
          >
            {isLoadingMeta ? (
              <Loader2 size={24} className="spin" />
            ) : (
              tt("md.link.parse")
            )}
          </button>
        </div>
      </section>

      {metadata && (
        <section className="md-section md-meta-section">
          <div className="md-thumb">
            {metadata.thumbnail ? (
              <img src={metadata.thumbnail} alt="" />
            ) : (
              <Music size={48} className="md-thumb-placeholder" />
            )}
          </div>
          <div className="md-meta-body">
            <div className="md-badge-row">
              <span className="md-badge md-badge-pink">
                {tt("md.badge.hires")}
              </span>
              <span className="md-badge md-badge-mint">
                {tt("md.badge.tagging")}
              </span>
            </div>
            <h2 className="md-title">{metadata.title}</h2>
            <p className="md-artist">
              {metadata.artist || tt("md.unknownArtist")}
            </p>
          </div>
        </section>
      )}

      {status === "error" && (
        <div className="md-alert md-alert-error" role="alert">
          <AlertCircle size={20} />
          <span>{errorMsg}</span>
        </div>
      )}

      {status === "success" && (
        <div className="md-alert md-alert-success" role="status">
          <CheckCircle2 size={24} />
          <span>{tt("md.done")}</span>
        </div>
      )}

      <div className="md-footer">
        {!config.downloadFolder ? (
          <div className="md-folder-card">
            <FolderHeart size={48} className="md-folder-icon" />
            <h3 className="md-folder-title">{tt("md.noDir")}</h3>
            <p className="md-folder-hint">{tt("md.noDirHint")}</p>
            <button
              type="button"
              className="md-btn-secondary"
              onClick={async () => {
                const folders = await window.api.openDirectoryHandler();
                if (folders && folders.length > 0)
                  setConfig((p) => ({ ...p, downloadFolder: folders[0] }));
              }}
            >
              {tt("md.setFolder")}
            </button>
          </div>
        ) : (
          <div className="md-actions">
            {isDownloading && (
              <div className="md-progress-block">
                <div className="md-progress-labels">
                  <span>{tt("md.downloading")}</span>
                  <span className="md-progress-pct">
                    {progress.toFixed(1)}%
                  </span>
                </div>
                <div className="md-progress-track">
                  <div
                    className="md-progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              className={
                status === "ready" && !isDownloading
                  ? "md-btn-download md-btn-download--ready"
                  : "md-btn-download"
              }
              onClick={handleDownload}
              disabled={
                (status !== "ready" &&
                  status !== "success" &&
                  status !== "error") ||
                isDownloading
              }
            >
              <Download size={24} />
              {isDownloading ? tt("md.extracting") : tt("md.startExtract")}
            </button>
          </div>
        )}
      </div>

      <section className="md-section md-playlist-link-wrap">
        <div className="playlist-link-panel no-drag">
          <div className="playlist-link-heading">
            <CloudDownload size={16} aria-hidden />
            <span>{tt("md.addFromLink")}</span>
          </div>
          <p className="playlist-link-hint">{tt("dlr.linkHint")}</p>
          <div className="playlist-link-row">
            <input
              type="text"
              className="playlist-link-input"
              placeholder={tt("dlr.linkInput.placeholder")}
              value={linkImportUrl}
              onChange={(e) => setLinkImportUrl(e.target.value)}
              disabled={linkImporting}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLinkPlaylistImport();
              }}
            />
            <select
              className="playlist-link-select"
              value={linkImportTarget}
              onChange={(e) => setLinkImportTarget(e.target.value)}
              disabled={linkImporting}
            >
              <option value="new">{tt("dlr.target.new")}</option>
              {userPlaylists.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {tt("dlr.target.merge", { name: pl.name })}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn user-pl-btn playlist-link-submit"
              disabled={linkImporting || !linkImportUrl.trim()}
              onClick={handleLinkPlaylistImport}
            >
              {linkImporting ? tt("md.adding") : tt("md.add")}
            </button>
          </div>
          {linkImportStatus ? (
            <p className="playlist-link-status">{linkImportStatus}</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
