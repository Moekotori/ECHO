import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X, Radio, AlertCircle } from "lucide-react";

export default function CastReceiveDrawer({ open, onClose }) {
  const { t } = useTranslation();
  const [friendlyName, setFriendlyName] = useState("Echoes Studio");
  const [dlnaOn, setDlnaOn] = useState(false);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const applyStatus = useCallback((s) => {
    if (!s) return;
    setStatus(s);
    setDlnaOn(!!s.dlnaEnabled);
  }, []);

  const refresh = useCallback(async () => {
    if (!window.api?.cast?.getStatus) return;
    try {
      const s = await window.api.cast.getStatus();
      applyStatus(s);
    } catch (_) {}
  }, [applyStatus]);

  useEffect(() => {
    if (!open) return;
    refresh();
    if (!window.api?.cast?.onStatus) return;
    const off = window.api.cast.onStatus((s) => applyStatus(s));
    return off;
  }, [open, refresh, applyStatus]);

  const toggleDlna = async () => {
    if (!window.api?.cast) return;
    setBusy(true);
    try {
      if (dlnaOn) {
        await window.api.cast.dlnaStop();
      } else {
        const r = await window.api.cast.dlnaStart({ friendlyName });
        if (!r.ok && r.error) {
          alert(r.error);
        }
      }
      await refresh();
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const ip = status?.dlnaLanIp || "N/A";
  const port = status?.dlnaPort || "N/A";
  const dlnaErr = status?.lastError;

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
        aria-label={t("drawer.castAria")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lyrics-drawer-header">
          <h2 className="lyrics-drawer-title">{t("drawer.castTitle")}</h2>
          <button
            type="button"
            className="lyrics-drawer-close"
            onClick={onClose}
            aria-label={t("aria.close")}
          >
            <X size={20} />
          </button>
        </div>
        <div
          className="lyrics-drawer-body md-drawer-body"
          style={{ maxWidth: 420 }}
        >
          <p
            style={{
              opacity: 0.85,
              fontSize: 14,
              lineHeight: 1.5,
              marginBottom: 16,
            }}
          >
            {t("castDrawer.introBefore")}
            <strong>{friendlyName}</strong>
            {t("castDrawer.introAfter")}
          </p>
          <p
            style={{
              opacity: 0.9,
              fontSize: 13,
              lineHeight: 1.55,
              marginBottom: 16,
              padding: "10px 12px",
              borderRadius: "var(--border-radius-sm)",
              background: "rgba(255,255,255,0.06)",
            }}
          >
            {t("castDrawer.appsDlna")}
          </p>
          <p
            style={{
              opacity: 0.9,
              fontSize: 13,
              lineHeight: 1.55,
              marginBottom: 16,
              padding: "10px 12px",
              borderRadius: "var(--border-radius-sm)",
              background: "rgba(255,255,255,0.06)",
            }}
          >
            {t("castDrawer.netease")}
          </p>

          <label
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 700,
              opacity: 0.7,
              marginBottom: 6,
            }}
          >
            {t("castDrawer.deviceNameLabel")}
          </label>
          <input
            type="text"
            value={friendlyName}
            disabled={dlnaOn || busy}
            onChange={(e) => setFriendlyName(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "var(--border-radius-sm)",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(0,0,0,0.15)",
              color: "inherit",
              marginBottom: 16,
            }}
          />

          <button
            type="button"
            className="export-btn"
            style={{ width: "100%", marginBottom: 12 }}
            disabled={busy}
            onClick={toggleDlna}
          >
            <Radio size={16} />
            {busy
              ? t("castDrawer.working")
              : dlnaOn
                ? t("castDrawer.stopReceiver")
                : t("castDrawer.startReceiver")}
          </button>

          {dlnaOn && (
            <div
              className="glass-panel"
              style={{
                padding: 12,
                fontSize: 13,
                lineHeight: 1.6,
                marginBottom: 12,
              }}
            >
              <div>
                <strong>{t("castDrawer.lan")}</strong> {ip}:{port}
              </div>
              {status?.transportState && (
                <div style={{ marginTop: 6 }}>
                  <strong>{t("castDrawer.state")}</strong>{" "}
                  {status.transportState}
                </div>
              )}
              {status?.currentUri && (
                <div
                  style={{
                    marginTop: 6,
                    wordBreak: "break-all",
                    opacity: 0.9,
                  }}
                >
                  <strong>{t("castDrawer.uri")}</strong>{" "}
                  {status.currentUri.slice(0, 200)}
                  {status.currentUri.length > 200 ? "…" : ""}
                </div>
              )}
            </div>
          )}

          {dlnaErr && (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                padding: 10,
                borderRadius: "var(--border-radius-sm)",
                background: "rgba(255,80,80,0.12)",
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{t("castDrawer.dlnaError", { error: dlnaErr })}</span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
