import { useState, useEffect, useCallback } from "react";
import { X, ToggleLeft, ToggleRight, Link, Play } from "lucide-react";

function extractVideoId(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();

  const ytLong = trimmed.match(
    /(?:youtube\.com\/(?:watch\?.*v=|embed\/|v\/))([a-zA-Z0-9_-]{11})/,
  );
  if (ytLong) return { id: ytLong[1], source: "youtube" };

  const ytShort = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (ytShort) return { id: ytShort[1], source: "youtube" };

  const bvMatch = trimmed.match(/(BV[a-zA-Z0-9]{10})/i);
  if (bvMatch) return { id: bvMatch[1], source: "bilibili" };

  const biliUrl = trimmed.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]{10})/i);
  if (biliUrl) return { id: biliUrl[1], source: "bilibili" };

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return { id: trimmed, source: "youtube" };
  }

  return null;
}

const QUALITY_LABELS = {
  tiny: "144p",
  small: "240p",
  medium: "360p",
  large: "480p",
  hd720: "720p",
  hd1080: "1080p",
  hd1440: "1440p",
  hd2160: "4K",
  highres: "4K+",
};

function getMvQualityPresentation(
  mvId,
  mvPlaybackQuality,
  biliDirectStream,
  tt,
) {
  if (!mvPlaybackQuality) return null;
  const label = QUALITY_LABELS[mvPlaybackQuality] || mvPlaybackQuality;
  if (mvId?.source === "bilibili") {
    if (biliDirectStream?.ok) {
      return {
        badge: label,
        inline: label,
        hint: tt("mv.qualityHint.direct", {
          format: biliDirectStream.format?.toUpperCase() || "DASH",
        }),
        pillClass: "mv-drawer-quality-live",
      };
    }
    return {
      badge: `~${label}`,
      inline: `~${label}`,
      hint: tt("mv.qualityHint.fallback"),
      pillClass: "mv-drawer-quality-estimate",
    };
  }
  return {
    badge: label,
    inline: label,
    hint: tt("mv.qualityHint.youtube"),
    pillClass: "mv-drawer-quality-live",
  };
}

export default function MvSettingsDrawer({
  open,
  onClose,
  config,
  setConfig,
  t,
  signInStatus,
  onYoutubeSignIn,
  onBilibiliSignIn,
  mvId,
  setMvId,
  mvPlaybackQuality,
  biliDirectStream,
  onRestartPlayback,
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
  const [customUrl, setCustomUrl] = useState("");
  const [urlError, setUrlError] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setUrlError("");
    }
  }, [open]);

  const handleCustomMv = useCallback(() => {
    setUrlError("");
    const result = extractVideoId(customUrl);
    if (!result) {
      setUrlError(tt("mv.urlError"));
      return;
    }
    setMvId({ id: result.id, source: result.source });
    setCustomUrl("");
    if (onRestartPlayback) onRestartPlayback();
  }, [customUrl, setMvId, onRestartPlayback]);

  const selectStyle = {
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid var(--glass-border)",
    background: "rgba(255,255,255,0.08)",
    color: "var(--text-main)",
    outline: "none",
    width: "100%",
    maxWidth: 220,
  };

  const qualityPres = getMvQualityPresentation(
    mvId,
    mvPlaybackQuality,
    biliDirectStream,
    tt,
  );

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
        aria-label={tt("mv.aria")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lyrics-drawer-header">
          <h2 className="lyrics-drawer-title">{tt("mv.title")}</h2>
          <button
            type="button"
            className="lyrics-drawer-close"
            onClick={onClose}
            aria-label={tt("lyrics.close")}
          >
            <X size={20} />
          </button>
        </div>

        <div className="lyrics-drawer-body">
          {/* Custom MV */}
          <section className="mv-drawer-section">
            <h3 className="mv-drawer-section-title">
              <Link size={16} />
              {tt("mv.custom")}
            </h3>
            <p className="mv-drawer-hint">{tt("mv.customHint")}</p>
            <div className="mv-drawer-url-row">
              <input
                type="text"
                className="mv-drawer-url-input"
                placeholder={tt("mv.urlPlaceholder")}
                value={customUrl}
                onChange={(e) => {
                  setCustomUrl(e.target.value);
                  setUrlError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCustomMv();
                }}
              />
              <button
                type="button"
                className="mv-drawer-url-btn"
                onClick={handleCustomMv}
                disabled={!customUrl.trim()}
              >
                <Play size={16} />
              </button>
            </div>
            {urlError && <p className="mv-drawer-url-error">{urlError}</p>}
            {mvId && (
              <div
                className={`mv-drawer-now-playing-box ${qualityPres ? "mv-drawer-now-playing-box--stack" : ""}`}
              >
                <p className="mv-drawer-now-playing">
                  {tt("mv.nowPlaying", {
                    source: tt(`mv.source.${mvId.source}`),
                    id: mvId.id,
                  })}
                </p>
                {qualityPres && (
                  <>
                    <span className="mv-drawer-quality-badge">
                      {qualityPres.badge}
                    </span>
                    <span className="mv-drawer-quality-hint">
                      {qualityPres.hint}
                    </span>
                  </>
                )}
              </div>
            )}
          </section>

          {/* Playback */}
          <section className="mv-drawer-section">
            <h3 className="mv-drawer-section-title">{tt("mv.playback")}</h3>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">
                  {tt("mv.enableInLyrics")}
                </span>
              </div>
              <button
                className={`toggle-btn ${config.enableMV ? "active" : ""}`}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    enableMV: !prev.enableMV,
                  }));
                  if (config.enableMV && !config.mvAsBackground) setMvId(null);
                }}
              >
                {config.enableMV ? (
                  <ToggleRight size={28} />
                ) : (
                  <ToggleLeft size={28} />
                )}
              </button>
            </div>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">{tt("mv.source")}</span>
              </div>
              <select
                value={config.mvSource || "youtube"}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, mvSource: e.target.value }))
                }
                style={selectStyle}
              >
                <option value="youtube">{tt("mv.source.youtube")}</option>
                <option value="bilibili">{tt("mv.source.bilibili")}</option>
              </select>
            </div>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">
                  {tt("mv.videoQuality")}
                  {qualityPres && (
                    <span className={qualityPres.pillClass}>
                      {qualityPres.inline}
                    </span>
                  )}
                </span>
              </div>
              <select
                value={config.mvQuality || "high"}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, mvQuality: e.target.value }))
                }
                style={selectStyle}
              >
                <option value="ultra">{tt("mv.quality.ultra")}</option>
                <option value="highfps">{tt("mv.quality.highfps")}</option>
                <option value="high">{tt("mv.quality.high")}</option>
                <option value="medium">{tt("mv.quality.medium")}</option>
                <option value="low">{tt("mv.quality.low")}</option>
              </select>
            </div>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">{tt("mv.mute")}</span>
              </div>
              <button
                className={`toggle-btn ${config.mvMuted ? "active" : ""}`}
                onClick={() =>
                  setConfig((prev) => ({ ...prev, mvMuted: !prev.mvMuted }))
                }
              >
                {config.mvMuted ? (
                  <ToggleRight size={28} />
                ) : (
                  <ToggleLeft size={28} />
                )}
              </button>
            </div>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">{tt("mv.autoFallback")}</span>
              </div>
              <button
                className={`toggle-btn ${config.autoFallbackToBilibili ? "active" : ""}`}
                onClick={() =>
                  setConfig((prev) => ({
                    ...prev,
                    autoFallbackToBilibili: !prev.autoFallbackToBilibili,
                  }))
                }
              >
                {config.autoFallbackToBilibili ? (
                  <ToggleRight size={28} />
                ) : (
                  <ToggleLeft size={28} />
                )}
              </button>
            </div>
          </section>

          {/* Immersive Background */}
          <section className="mv-drawer-section">
            <h3 className="mv-drawer-section-title">{tt("mv.immersive")}</h3>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">{tt("mv.asBackground")}</span>
              </div>
              <button
                className={`toggle-btn ${config.mvAsBackground ? "active" : ""}`}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    mvAsBackground: !prev.mvAsBackground,
                  }));
                  if (config.mvAsBackground && !config.enableMV) setMvId(null);
                }}
              >
                {config.mvAsBackground ? (
                  <ToggleRight size={28} />
                ) : (
                  <ToggleLeft size={28} />
                )}
              </button>
            </div>

            {config.mvAsBackground && (
              <div className="mv-drawer-row">
                <div className="mv-drawer-row-info">
                  <span className="mv-drawer-label">{tt("mv.bgOpacity")}</span>
                  <span className="mv-drawer-value">
                    {Math.round(
                      (config.mvBackgroundOpacity !== undefined
                        ? config.mvBackgroundOpacity
                        : 0.8) * 100,
                    )}
                    %
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={
                    config.mvBackgroundOpacity !== undefined
                      ? config.mvBackgroundOpacity
                      : 0.8
                  }
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      mvBackgroundOpacity: parseFloat(e.target.value),
                    }))
                  }
                  style={{ flex: 1, maxWidth: 180 }}
                />
              </div>
            )}
          </section>

          {/* Account */}
          <section className="mv-drawer-section">
            <h3 className="mv-drawer-section-title">{tt("mv.account")}</h3>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">
                  YouTube
                  {signInStatus.youtube ? (
                    <span className="signin-badge signed-in">
                      {tt("mv.signedIn")}
                    </span>
                  ) : (
                    <span className="signin-badge not-signed">
                      {tt("mv.notSignedIn")}
                    </span>
                  )}
                </span>
              </div>
              <button
                type="button"
                className="mv-drawer-action-btn"
                onClick={onYoutubeSignIn}
              >
                {signInStatus.youtube ? tt("mv.resignIn") : tt("mv.signIn")}
              </button>
            </div>

            <div className="mv-drawer-row">
              <div className="mv-drawer-row-info">
                <span className="mv-drawer-label">
                  Bilibili
                  {signInStatus.bilibili ? (
                    <span className="signin-badge signed-in">
                      {tt("mv.signedIn")}
                    </span>
                  ) : (
                    <span className="signin-badge not-signed">
                      {tt("mv.notSignedIn")}
                    </span>
                  )}
                </span>
              </div>
              <button
                type="button"
                className="mv-drawer-action-btn"
                onClick={onBilibiliSignIn}
              >
                {signInStatus.bilibili ? tt("mv.resignIn") : tt("mv.signIn")}
              </button>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
