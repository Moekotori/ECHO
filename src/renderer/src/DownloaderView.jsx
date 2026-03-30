import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
  config,
  setConfig,
  onSuccess,
  userPlaylists = [],
  setUserPlaylists,
  setPlaylist,
  setSelectedUserPlaylistId,
}) {
  const { t, i18n } = useTranslation();
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
      alert(t("downloader.folderRequired"));
      return;
    }
    const raw = linkImportUrl.trim();
    if (!raw) return;
    setLinkImporting(true);
    setLinkImportStatus(t("downloader.connecting"));
    const tFn = i18n.getFixedT(i18n.language);
    const unsub = window.api.playlistLink.onImportProgress((p) => {
      if (p.phase === "meta") {
        setLinkImportStatus(
          tFn("downloader.linkMetaLine", {
            name: p.playlistName,
            total: p.total,
          }),
        );
      } else if (p.phase === "download") {
        setLinkImportStatus(
          tFn("downloader.downloadProgress", {
            current: p.current,
            total: p.total,
            track: p.trackName || "",
          }),
        );
      } else if (p.phase === "bulk") {
        const pct =
          p.progress != null && Number.isFinite(p.progress)
            ? ` ${Math.round(p.progress)}%`
            : "";
        setLinkImportStatus(
          tFn("downloader.bulkProgress", {
            message: p.message || tFn("downloader.downloading"),
            pct,
          }),
        );
      }
    });
    try {
      const r = await window.api.playlistLink.importPlaylist({
        playlistInput: raw,
        downloadFolder: playlistSaveDir,
      });
      const newItems = (r.added || []).map(({ path, trackTitle }) => ({
        name: path.split(/[/\\]/).pop() || trackTitle || "track",
        path,
        type: "local",
      }));
      if (newItems.length > 0 && setPlaylist) {
        setPlaylist((prev) => {
          const seen = new Set(prev.map((x) => x.path));
          const next = [...prev];
          for (const track of newItems) {
            if (!seen.has(track.path)) {
              seen.add(track.path);
              next.push(track);
            }
          }
          return next;
        });
        const paths = newItems.map((x) => x.path);
        if (setUserPlaylists && setSelectedUserPlaylistId) {
          if (linkImportTarget === "new") {
            const id = crypto.randomUUID();
            const plName = r.playlistName || "Imported";
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
          t("downloader.importPartial", {
            ok: okN,
            fail: failN,
            name: first.name,
            error: first.error,
          }),
        );
      } else if (okN === 0) {
        alert(t("downloader.importNone"));
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
    t,
    i18n,
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
      setErrorMsg(err.message || t("downloader.metaFailed"));
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

    const filesBefore = await window.api
      .readDirectoryHandler(config.downloadFolder)
      .catch(() => []);

    try {
      await window.api.media.downloadAudio(url, config.downloadFolder);
      setStatus("success");

      const filesAfter = await window.api
        .readDirectoryHandler(config.downloadFolder)
        .catch(() => []);
      const newFiles = filesAfter.filter(
        (fa) => !filesBefore.find((fb) => fb.path === fa.path),
      );

      if (newFiles.length > 0 && onSuccess) {
        onSuccess({
          path: newFiles[0].path,
          mvOriginUrl: url.trim(),
        });
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || t("downloader.downloadFailed"));
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
            placeholder={t("downloader.placeholderUrl")}
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
              t("downloader.parseLink")
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
                {t("downloader.badgeHiRes")}
              </span>
              <span className="md-badge md-badge-mint">
                {t("downloader.badgeMeta")}
              </span>
            </div>
            <h2 className="md-title">{metadata.title}</h2>
            <p className="md-artist">
              {metadata.artist || t("common.unknownArtist")}
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
          <span>{t("downloader.downloadComplete")}</span>
        </div>
      )}

      <div className="md-footer">
        {!config.downloadFolder ? (
          <div className="md-folder-card">
            <FolderHeart size={48} className="md-folder-icon" />
            <h3 className="md-folder-title">{t("downloader.noDirTitle")}</h3>
            <p className="md-folder-hint">{t("downloader.noDirHint")}</p>
            <button
              type="button"
              className="md-btn-secondary"
              onClick={async () => {
                const folders = await window.api.openDirectoryHandler();
                if (folders && folders.length > 0)
                  setConfig((p) => ({ ...p, downloadFolder: folders[0] }));
              }}
            >
              {t("downloader.setDownloadFolder")}
            </button>
          </div>
        ) : (
          <div className="md-actions">
            {isDownloading && (
              <div className="md-progress-block">
                <div className="md-progress-labels">
                  <span>{t("downloader.downloadingStream")}</span>
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
              {isDownloading
                ? t("downloader.extracting")
                : t("downloader.startExtraction")}
            </button>
          </div>
        )}
      </div>

      <section className="md-section md-playlist-link-wrap">
        <div className="playlist-link-panel no-drag">
          <div className="playlist-link-heading">
            <CloudDownload size={16} aria-hidden />
            <span>{t("downloader.addFromLink")}</span>
          </div>
          <p className="playlist-link-hint">
            {t("downloader.linkHintBefore")}
            <code className="playlist-link-code">
              {t("downloader.linkHintCode")}
            </code>
            {t("downloader.linkHintAfter")}
          </p>
          <div className="playlist-link-row">
            <input
              type="text"
              className="playlist-link-input"
              placeholder={t("downloader.linkPlaceholder")}
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
              <option value="new">{t("downloader.optNewPl")}</option>
              {userPlaylists.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {t("downloader.optMerge", { name: pl.name })}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn user-pl-btn playlist-link-submit"
              disabled={linkImporting || !linkImportUrl.trim()}
              onClick={handleLinkPlaylistImport}
            >
              {linkImporting ? t("downloader.adding") : t("downloader.add")}
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
