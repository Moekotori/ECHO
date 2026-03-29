import { useState, useEffect, useRef } from "react";
import { X, RefreshCw, Minus, Plus, Upload } from "lucide-react";

export default function LyricsSettingsDrawer({
  open,
  onClose,
  config,
  setConfig,
  t,
  lyricsMatchStatus,
  onRefreshLyrics,
  onApplyLyricsText,
  onNativeLyricsFilePick,
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
  const SOURCE_OPTIONS = [
    { value: "local", label: tt("lyrics.source.local") },
    { value: "lrclib", label: tt("lyrics.source.lrclib") },
    { value: "netease", label: tt("lyrics.source.netease") },
    { value: "qq", label: tt("lyrics.source.qq") },
  ];

  const [showTextarea, setShowTextarea] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setShowTextarea(false);
      setPasteText("");
      setDropdownOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const dropdownWrapRef = useRef(null);
  useEffect(() => {
    if (!dropdownOpen) return;
    const onDoc = (e) => {
      if (
        dropdownWrapRef.current &&
        !dropdownWrapRef.current.contains(e.target)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [dropdownOpen]);

  const offsetMs = config.lyricsOffsetMs ?? 0;
  const fontSize = config.lyricsFontSize ?? 32;

  const statusLabel =
    lyricsMatchStatus === "loading"
      ? tt("lyrics.status.loading")
      : lyricsMatchStatus === "matched"
        ? tt("lyrics.status.matched")
        : lyricsMatchStatus === "none"
          ? tt("lyrics.status.none")
          : tt("lyrics.status.idle");

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    const name = (f.name || "").toLowerCase();
    if (!name.endsWith(".lrc") && !name.endsWith(".lrcx")) return;
    if (f.path && window.api?.readBufferHandler) {
      const buf = await window.api.readBufferHandler(f.path);
      if (buf) {
        const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        const text = new TextDecoder("utf-8").decode(u8);
        onApplyLyricsText(text);
      }
    } else {
      const text = await f.text();
      onApplyLyricsText(text);
    }
  };

  const handleApplyPaste = () => {
    if (!pasteText.trim()) return;
    onApplyLyricsText(pasteText);
    setPasteText("");
    setShowTextarea(false);
  };

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
        aria-label={tt("lyrics.aria")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lyrics-drawer-header">
          <h2 className="lyrics-drawer-title">{tt("lyrics.title")}</h2>
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
          <section className="lyrics-drawer-section">
            <h3 className="lyrics-drawer-section-title">
              {tt("lyrics.displayStyle")}
            </h3>
            <div className="lyrics-drawer-row">
              <span className="lyrics-drawer-label">{tt("lyrics.romaji")}</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!config.lyricsShowRomaji}
                className={`lyrics-drawer-switch ${config.lyricsShowRomaji ? "on" : ""}`}
                onClick={() =>
                  setConfig((p) => ({
                    ...p,
                    lyricsShowRomaji: !p.lyricsShowRomaji,
                  }))
                }
              >
                <span className="lyrics-drawer-switch-thumb" />
              </button>
            </div>
            <div className="lyrics-drawer-row">
              <span className="lyrics-drawer-label">
                {tt("lyrics.translation")}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={!!config.lyricsShowTranslation}
                className={`lyrics-drawer-switch ${config.lyricsShowTranslation ? "on" : ""}`}
                onClick={() =>
                  setConfig((p) => ({
                    ...p,
                    lyricsShowTranslation: !p.lyricsShowTranslation,
                  }))
                }
              >
                <span className="lyrics-drawer-switch-thumb" />
              </button>
            </div>
            <div className="lyrics-drawer-slider-block">
              <div className="lyrics-drawer-label-row">
                <span className="lyrics-drawer-label">
                  {tt("lyrics.mainLineSize")}
                </span>
                <span className="lyrics-drawer-value">{fontSize}px</span>
              </div>
              <input
                type="range"
                min={18}
                max={56}
                step={1}
                value={fontSize}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    lyricsFontSize: parseInt(e.target.value, 10),
                  }))
                }
                className="lyrics-drawer-range"
              />
            </div>
          </section>

          <section className="lyrics-drawer-section">
            <h3 className="lyrics-drawer-section-title">
              {tt("lyrics.source")}
            </h3>
            <div className="lyrics-drawer-status">
              <span
                className={`lyrics-drawer-status-dot ${
                  lyricsMatchStatus === "matched"
                    ? "ok"
                    : lyricsMatchStatus === "none"
                      ? "bad"
                      : lyricsMatchStatus === "loading"
                        ? "pending"
                        : ""
                }`}
              />
              <span>{tt("lyrics.status", { status: statusLabel })}</span>
            </div>
            <div className="lyrics-drawer-dropdown-wrap" ref={dropdownWrapRef}>
              <button
                type="button"
                className="lyrics-drawer-dropdown-trigger"
                onClick={() => setDropdownOpen((v) => !v)}
              >
                {SOURCE_OPTIONS.find((o) => o.value === config.lyricsSource)
                  ?.label || tt("lyrics.selectSource")}
              </button>
              {dropdownOpen && (
                <ul className="lyrics-drawer-dropdown-menu">
                  {SOURCE_OPTIONS.map((o) => (
                    <li key={o.value}>
                      <button
                        type="button"
                        className={
                          config.lyricsSource === o.value ? "active" : ""
                        }
                        onClick={() => {
                          setConfig((p) => ({ ...p, lyricsSource: o.value }));
                          setDropdownOpen(false);
                        }}
                      >
                        {o.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              className="lyrics-drawer-refresh"
              onClick={() => onRefreshLyrics()}
              title={tt("lyrics.fetchAgain")}
            >
              <RefreshCw size={16} />
              {tt("lyrics.refresh")}
            </button>
          </section>

          <section className="lyrics-drawer-section">
            <h3 className="lyrics-drawer-section-title">
              {tt("lyrics.localSync")}
            </h3>
            <div className="lyrics-drawer-offset">
              <span className="lyrics-drawer-label">
                {tt("lyrics.timingOffset")}
              </span>
              <div className="lyrics-drawer-offset-controls">
                <button
                  type="button"
                  className="lyrics-drawer-icon-btn"
                  onClick={() =>
                    setConfig((p) => ({
                      ...p,
                      lyricsOffsetMs: (p.lyricsOffsetMs ?? 0) - 50,
                    }))
                  }
                  aria-label={tt("lyrics.decrease50")}
                >
                  <Minus size={18} />
                </button>
                <span className="lyrics-drawer-offset-value">
                  {offsetMs} ms
                </span>
                <button
                  type="button"
                  className="lyrics-drawer-icon-btn"
                  onClick={() =>
                    setConfig((p) => ({
                      ...p,
                      lyricsOffsetMs: (p.lyricsOffsetMs ?? 0) + 50,
                    }))
                  }
                  aria-label={tt("lyrics.increase50")}
                >
                  <Plus size={18} />
                </button>
              </div>
              <p className="lyrics-drawer-hint">{tt("lyrics.offsetHint")}</p>
            </div>

            <div
              className="lyrics-drawer-dropzone"
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={handleDrop}
            >
              <Upload size={22} strokeWidth={1.75} />
              <p>{tt("lyrics.dropOrChoose")}</p>
              <button
                type="button"
                className="lyrics-drawer-link-btn"
                onClick={() => {
                  if (window.api?.openLyricsFileHandler) {
                    onNativeLyricsFilePick?.();
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
              >
                {tt("lyrics.chooseFile")}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".lrc,.lrcx,text/plain"
              className="lyrics-drawer-file-input"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const text = await f.text();
                onApplyLyricsText(text);
              }}
            />

            <button
              type="button"
              className="lyrics-drawer-secondary-btn"
              onClick={() => setShowTextarea((v) => !v)}
            >
              {tt("lyrics.editPlain")}
            </button>
            {showTextarea && (
              <div className="lyrics-drawer-textarea-block">
                <textarea
                  className="lyrics-drawer-textarea"
                  placeholder={tt("lyrics.pastePlaceholder")}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={8}
                />
                <button
                  type="button"
                  className="lyrics-drawer-primary-btn"
                  onClick={handleApplyPaste}
                >
                  {tt("lyrics.apply")}
                </button>
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
