import { useState, useEffect, useCallback } from "react";
import { X, Radio, AlertCircle } from "lucide-react";

export default function CastReceiveDrawer({ open, onClose, t, locale = "en" }) {
  const tt = t || ((k) => k);
  const tr = (en, zhCN) => (locale === "zh-CN" ? zhCN : en);
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

  const ip = status?.dlnaLanIp || tr("N/A", "不可用");
  const port = status?.dlnaPort || tr("N/A", "不可用");
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
        aria-label={tt("cast.aria")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lyrics-drawer-header">
          <h2 className="lyrics-drawer-title">{tt("cast.title")}</h2>
          <button
            type="button"
            className="lyrics-drawer-close"
            onClick={onClose}
            aria-label={tt("lyrics.close")}
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
            {tr(
              "On the same Wi‑Fi as this computer, send music to",
              "在与此电脑同一 Wi‑Fi 下，可将音乐投送到",
            )}{" "}
            <strong>{friendlyName}</strong>。
            {tr(
              "Local playback pauses when casting starts.",
              "开始投送后，本地播放会暂停。",
            )}
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
            <strong>{tr("Apps and DLNA:", "应用与 DLNA：")}</strong>
            {tr(
              " Echoes is a standard UPnP AV (DLNA MediaRenderer). Any app that can cast to a TV/speaker over DLNA and sends a playable HTTP(S) stream can usually connect; device names and metadata vary by app. QQ Music and some others on Android/iOS support DLNA—check each app’s help. Spotify desktop normally uses Spotify Connect or system Bluetooth/speakers, not DLNA; if a build offers DLNA or a third-party bridge, try selecting this PC from the device list.",
              " Echoes 是标准的 UPnP AV（DLNA MediaRenderer）接收端。凡是支持 DLNA 投屏并发送可播放 HTTP(S) 流的应用通常都能连接；设备名与元数据会因应用而异。QQ 音乐等部分 Android/iOS 应用支持 DLNA，具体可查看各自帮助文档。Spotify 桌面端通常使用 Spotify Connect 或系统蓝牙/扬声器而非 DLNA；若某版本提供 DLNA 或第三方桥接，可尝试在设备列表选择此电脑。",
            )}
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
            <strong>{tr("NetEase Cloud Music:", "网易云音乐：")}</strong>
            {tr(
              ' Enable "Connect DLNA devices" in settings; on the player screen open Devices / Cast and pick this device (same name as above). If it does not appear: confirm the LAN IP shown below is on the same subnet as your phone (wrong NIC or VPN is common); set env ECHOES_DLNA_IP to this PC’s Wi‑Fi IPv4 and check Windows Firewall for this app and UDP 1900. If playback fails, the URL may be encrypted—cast from inside the official app and keep it updated.',
              " 在设置里开启“连接 DLNA 设备”；在播放页打开设备/投屏并选择本设备（名称与上方一致）。若未显示：请确认下方 LAN IP 与手机处于同一网段（网卡选错或 VPN 干扰很常见）；可将环境变量 ECHOES_DLNA_IP 设置为本机 Wi‑Fi IPv4，并检查 Windows 防火墙及 UDP 1900。若播放失败，可能是链接加密导致——建议在官方应用内发起投送并保持应用最新。",
            )}
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
            {tr("Device display name (DLNA)", "设备显示名称（DLNA）")}
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
              ? tr("Working…", "处理中…")
              : dlnaOn
                ? tr("Stop DLNA receiver", "停止 DLNA 接收")
                : tr("Start DLNA receiver", "启动 DLNA 接收")}
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
                <strong>{tr("LAN", "局域网")}</strong> {ip}:{port}
              </div>
              {status?.transportState && (
                <div style={{ marginTop: 6 }}>
                  <strong>{tr("State", "状态")}</strong> {status.transportState}
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
                  <strong>{tr("URI", "地址")}</strong>{" "}
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
              <span>DLNA: {dlnaErr}</span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
