export const echoLinkMobileRemotePath = '/echo-link/v2/remote';
export const echoLinkMobileRemoteManifestPath = `${echoLinkMobileRemotePath}/manifest.webmanifest`;
export const echoLinkMobileRemoteIconPath = `${echoLinkMobileRemotePath}/icon.svg`;

const mobileRemoteManifest = JSON.stringify({
  id: echoLinkMobileRemotePath,
  name: 'ECHO Link Remote',
  short_name: 'ECHO Link',
  description: 'Local-network remote control for ECHO playback.',
  start_url: echoLinkMobileRemotePath,
  scope: '/echo-link/v2/',
  display: 'standalone',
  background_color: '#07090e',
  theme_color: '#090a0f',
  orientation: 'portrait',
  icons: [{
    src: echoLinkMobileRemoteIconPath,
    sizes: 'any',
    type: 'image/svg+xml',
    purpose: 'any maskable',
  }],
});

const mobileRemoteIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="ECHO Link">
  <rect width="512" height="512" rx="112" fill="#090a0f"/>
  <circle cx="256" cy="256" r="174" fill="#71aef8" opacity=".14"/>
  <path d="M166 154h188v54H225v49h112v52H225v49h133v54H166V154Z" fill="#f4f5f7"/>
  <circle cx="368" cy="154" r="28" fill="#71aef8"/>
</svg>`;

export const createEchoLinkMobileRemoteManifest = (): string => mobileRemoteManifest;
export const createEchoLinkMobileRemoteIcon = (): string => mobileRemoteIcon;

export const createEchoLinkMobileRemotePairingUrl = (
  host: string,
  port: number,
  pairingUri: string,
): string => {
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const url = new URL(`http://${urlHost}:${port}${echoLinkMobileRemotePath}`);
  url.hash = new URLSearchParams({ pair: pairingUri }).toString();
  return url.toString();
};

const mobileRemoteHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#090a0f">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="ECHO Link">
  <link rel="manifest" href="${echoLinkMobileRemoteManifestPath}">
  <link rel="icon" href="${echoLinkMobileRemoteIconPath}" type="image/svg+xml">
  <link rel="apple-touch-icon" href="${echoLinkMobileRemoteIconPath}">
  <title>ECHO Link Remote</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Outfit, Inter, "SF Pro Display", "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif;
      background: #07090e;
      color: #f4f5f7;
      --accent: #71aef8;
      --accent-soft: rgba(113, 174, 248, .12);
      --surface: #11141b;
      --line: rgba(255, 255, 255, .12);
      --muted: #8a909d;
      --danger: #ff7b86;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; background: #07090e; }
    body {
      min-height: 100dvh;
      padding: max(42px, env(safe-area-inset-top)) 24px max(18px, env(safe-area-inset-bottom));
      overscroll-behavior: none;
    }
    button, input { font: inherit; }
    button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    [hidden] { display: none !important; }
    .app { width: min(100%, 390px); margin: 0 auto; }
    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      min-height: 24px; margin-bottom: 34px;
    }
    .brand { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
    .brand strong { font-size: 16px; font-weight: 500; letter-spacing: -.025em; }
    .mode-status {
      min-height: 32px; display: inline-flex; align-items: center; gap: 8px;
      margin: -4px -8px -4px 12px; padding: 0 8px; border: 0; border-radius: 10px;
      color: var(--accent); background: transparent; cursor: pointer;
      font-size: 12px; font-weight: 550; white-space: nowrap;
      transition: color .15s ease, background .15s ease, transform .15s ease;
    }
    .mode-status:active { transform: scale(.96); background: rgba(255,255,255,.045); }
    .mode-status svg { order: 1; color: var(--accent); }
    .mode-icon { display: none; }
    .mode-icon[data-visible="true"] { display: block; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
    .connection {
      width: 7px; height: 7px; border-radius: 50%; background: #3f444f;
      box-shadow: 0 0 0 3px rgba(255,255,255,.025);
    }
    .connection[data-state="online"] { background: var(--accent); box-shadow: 0 0 14px rgba(124,183,255,.64); }
    .connection[data-state="connecting"] { background: #b9c9dd; animation: pulse 1s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .35; } }
    .card {
      border: 1px solid var(--line); border-radius: 22px; background: var(--surface);
    }
    .setup { margin-top: 86px; padding: 34px 25px 29px; text-align: center; }
    .setup-symbol {
      width: 64px; height: 64px; display: grid; place-items: center; margin: 0 auto 22px;
      border-radius: 20px; color: var(--accent); background: var(--accent-soft); border: 1px solid rgba(124, 183, 255, .24);
    }
    .setup h1 { margin: 0; font-size: clamp(28px, 8vw, 36px); letter-spacing: -.045em; }
    .setup p { color: var(--muted); line-height: 1.65; margin: 14px auto 0; max-width: 34ch; }
    .setup-note { display: block; color: #747985; font-size: 12px; margin-top: 22px; }
    .primary, .secondary {
      min-height: 46px; padding: 0 17px; border-radius: 14px; cursor: pointer;
      transition: transform .15s ease, background .15s ease, opacity .15s ease;
    }
    .primary:active, .secondary:active, .transport button:active { transform: scale(.96); }
    .primary { margin-top: 24px; border: 0; color: #080a0f; background: var(--accent); font-weight: 800; }
    .secondary { border: 1px solid var(--line); color: #eef0f6; background: rgba(255, 255, 255, .045); }
    .now-playing { border: 0; border-radius: 0; background: transparent; }
    .artwork-shell {
      position: relative; width: 100%; aspect-ratio: 1; overflow: hidden;
      border: 1px solid rgba(255,255,255,.12); border-radius: 18px; background: #12151c;
      box-shadow: 0 20px 48px rgba(0, 0, 0, .3);
    }
    .artwork { width: 100%; height: 100%; display: block; object-fit: cover; opacity: 0; transition: opacity .24s ease; }
    .artwork[data-ready="true"] { opacity: 1; }
    .artwork-fallback {
      position: absolute; inset: 0; display: grid; place-items: center; color: #3f4653;
      font-size: clamp(46px, 17vw, 72px); font-weight: 750; letter-spacing: -.08em;
    }
    .artwork[data-ready="true"] + .artwork-fallback { display: none; }
    .track-copy { min-height: 141px; padding-top: 27px; }
    .track-title {
      margin: 0; color: #f7f8fa; font-size: clamp(32px, 10.2vw, 40px); font-weight: 720;
      letter-spacing: -.05em; line-height: 1.06; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    }
    .track-artist { margin-top: 8px; color: #d3d6dd; font-size: 14px; line-height: 1.35; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .track-album { margin-top: 4px; color: var(--muted); font-size: 12px; line-height: 1.35; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .controls { padding-top: 8px; }
    .timeline { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px; color: var(--muted); font-variant-numeric: tabular-nums; font-size: 11px; }
    input[type="range"] {
      width: 100%; height: 4px; margin: 0; border: 0; border-radius: 999px; accent-color: var(--accent);
      background: #2a2e36; cursor: pointer;
    }
    .transport {
      display: flex; align-items: center; justify-content: space-between;
      width: 100%; margin-top: 26px;
    }
    .transport button {
      width: 46px; height: 46px; flex: none; display: grid; place-items: center; border: 0;
      border-radius: 50%; color: #d8dbe1; background: transparent; cursor: pointer;
      transition: transform .15s ease, opacity .15s ease, background .15s ease;
    }
    .transport button.order-control { color: #e7e9ee; }
    .transport button.order-control[data-active="true"] {
      color: var(--accent); background: transparent;
    }
    .transport button.play {
      width: 74px; height: 74px; color: #07101b; background: var(--accent);
      box-shadow: 0 12px 30px rgba(73, 142, 228, .23);
    }
    .transport button:disabled, .volume input:disabled { cursor: default; opacity: .38; }
    .transport .play .pause-icon { display: none; }
    .transport .play[data-playing="true"] .play-icon { display: none; }
    .transport .play[data-playing="true"] .pause-icon { display: block; }
    svg { display: block; }
    .volume { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 13px; margin-top: 63px; }
    .volume svg { color: var(--muted); }
    .volume-value { min-width: 36px; color: #adb2bd; font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
    .error {
      margin-top: 17px; padding: 12px 14px; border: 1px solid rgba(255, 123, 134, .24);
      border-radius: 14px; color: #ffd7da; background: rgba(255, 123, 134, .08); font-size: 13px; line-height: 1.5;
    }
    .privacy { display: none; }
    .toast {
      position: fixed; left: 50%; bottom: max(20px, env(safe-area-inset-bottom)); z-index: 10;
      transform: translate(-50%, 18px); max-width: calc(100vw - 32px); padding: 11px 15px;
      border: 1px solid var(--line); border-radius: 12px; color: #f4f5f7; background: #20232c;
      box-shadow: 0 14px 38px rgba(0,0,0,.45); opacity: 0; pointer-events: none; transition: .2s ease;
      font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .toast[data-visible="true"] { opacity: 1; transform: translate(-50%, 0); }
    .install-app {
      display: block; min-height: 38px; margin: 13px auto 0; padding: 0 12px;
      border: 0; border-radius: 10px; color: var(--muted); background: transparent;
      cursor: pointer; font-size: 12px; font-weight: 600;
    }
    .install-app:active { color: #f4f5f7; background: rgba(255,255,255,.045); }
    @media (max-height: 740px) {
      body { padding-top: max(14px, env(safe-area-inset-top)); }
      .topbar { margin-bottom: 14px; }
      .track-copy { min-height: 78px; padding-top: 15px; }
      .controls { padding-top: 6px; }
      .transport { margin-top: 16px; }
      .volume { margin-top: 16px; }
    }
    @media (max-width: 350px) {
      body { padding-left: 18px; padding-right: 18px; }
      .mode-status { font-size: 11px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <main class="app">
    <header class="topbar">
      <div class="brand">
        <strong>ECHO Link</strong>
        <div class="connection" id="connection" data-state="offline"><span class="sr-only">Offline</span></div>
      </div>
      <button class="mode-status" id="mode-status" type="button" data-action="cyclePlaybackOrder" data-playback-control aria-label="Change playback order" hidden>
        <svg class="mode-icon" data-mode-icon="sequential" data-visible="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>
        </svg>
        <svg class="mode-icon" data-mode-icon="shuffle" data-visible="false" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m18 14 4 4-4 4M18 2l4 4-4 4M2 18h1.5c5 0 6.5-12 11.5-12h7M2 6h1.5c2.2 0 3.6 2.3 4.8 4.9M14.5 17.1c1 1 2.1.9 3.5.9h4"/>
        </svg>
        <svg class="mode-icon" data-mode-icon="repeat-one" data-visible="false" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3M11 10h1v4"/>
        </svg>
        <span id="mode-label">顺序播放</span>
      </button>
    </header>

    <section class="card setup" id="setup">
      <div class="setup-symbol" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
      </div>
      <h1 data-i18n="setupTitle">连接 ECHO</h1>
      <p id="setup-message" data-i18n="setupMessage">请在电脑上的 ECHO 设置 → 集成 → ECHO Link Basic 中生成二维码，然后使用手机相机扫描。</p>
      <button class="primary" id="retry" type="button" data-i18n="retry">重新连接</button>
      <span class="setup-note" data-i18n="setupNote">仅适用于你信任的局域网</span>
    </section>

    <section class="now-playing" id="remote" hidden>
      <div class="artwork-shell">
        <img class="artwork" id="artwork" alt="" data-ready="false">
        <div class="artwork-fallback" aria-hidden="true">E</div>
      </div>
      <div class="track-copy">
        <h1 class="track-title" id="track-title">ECHO</h1>
        <div class="track-artist" id="track-artist">—</div>
        <div class="track-album" id="track-album">—</div>
      </div>
      <div class="controls" id="control-panel">
        <div class="timeline">
          <span id="position">0:00</span>
          <input id="progress" type="range" min="0" max="1" step="1000" value="0" aria-label="Playback position">
          <span id="duration">0:00</span>
        </div>

        <div class="transport">
          <button class="order-control" id="shuffle-toggle" type="button" data-action="toggleShuffle" data-playback-control data-active="false" aria-label="Shuffle" aria-pressed="false">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m18 14 4 4-4 4M18 2l4 4-4 4M2 18h1.5c5 0 6.5-12 11.5-12h7M2 6h1.5c2.2 0 3.6 2.3 4.8 4.9M14.5 17.1c1 1 2.1.9 3.5.9h4"/>
            </svg>
          </button>
          <button type="button" data-action="previous" data-playback-control aria-label="Previous">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zm3.5 7 8.5 6V6z"/></svg>
          </button>
          <button class="play" id="play-toggle" type="button" data-action="playToggle" data-playback-control data-playing="false" aria-label="Play">
            <svg class="play-icon" width="25" height="25" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m7 4 13 8-13 8z"/></svg>
            <svg class="pause-icon" width="23" height="23" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>
          </button>
          <button type="button" data-action="next" data-playback-control aria-label="Next">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zm-10 1 8.5 6L6 18z"/></svg>
          </button>
          <button class="order-control" id="repeat-toggle" type="button" data-action="toggleRepeatOne" data-playback-control data-active="false" aria-label="Repeat one" aria-pressed="false">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3M11 10h1v4"/>
            </svg>
          </button>
        </div>

        <div class="volume">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>
          <input id="volume" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume">
          <span class="volume-value" id="volume-value">100%</span>
        </div>

        <div class="error" id="error" hidden></div>
      </div>
    </section>

    <p class="privacy" data-i18n="privacy">播放状态来自 ECHO Audio Host；此页面只发送控制请求，不读取曲库、文件路径或媒体内容。</p>
    <button class="install-app" id="install-app" type="button" data-i18n="install" hidden>添加到主屏幕</button>
  </main>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <script>
  (() => {
    'use strict';
    const copies = {
      zh: {
        setupTitle: '连接 ECHO',
        setupMessage: '请在电脑上的 ECHO 设置 → 集成 → ECHO Link Basic 中生成二维码，然后使用手机相机扫描。',
        setupNote: '仅适用于你信任的局域网',
        retry: '重新连接',
        privacy: '播放状态来自 ECHO Audio Host；此页面只发送控制请求，不读取曲库、文件路径或媒体内容。',
        offline: '未连接',
        connecting: '连接中',
        online: '已连接',
        pairing: '正在安全配对…',
        revoked: '此设备的访问权限已失效。请在 ECHO 中重新生成二维码。',
        pairFailed: '配对失败，请在 ECHO 中重新生成二维码。',
        noTrack: '暂无播放内容',
        unknownArtist: '未知艺术家',
        idle: '待机',
        loading: '加载中',
        playing: '正在播放',
        paused: '已暂停',
        stopped: '已停止',
        sequential: '顺序播放',
        shuffle: '随机播放',
        repeatOne: '单曲循环',
        changePlaybackOrder: '切换播放顺序',
        actionFailed: '控制失败',
        storageWarning: '浏览器未能保存凭证；关闭页面后需要重新配对。',
        install: '添加到主屏幕',
        installIos: '请点击 Safari 分享按钮，然后选择“添加到主屏幕”。',
        installBrowser: '请打开浏览器菜单，然后选择“添加到主屏幕”。',
      },
      en: {
        setupTitle: 'Connect to ECHO',
        setupMessage: 'Generate a QR code in ECHO Settings → Integrations → ECHO Link Basic, then scan it with this phone.',
        setupNote: 'Use only on a local network you trust',
        retry: 'Reconnect',
        privacy: 'Playback truth comes from ECHO Audio Host. This page only sends controls and cannot read library paths or media.',
        offline: 'Offline',
        connecting: 'Connecting',
        online: 'Connected',
        pairing: 'Pairing securely…',
        revoked: 'Access for this device is no longer valid. Generate a new QR code in ECHO.',
        pairFailed: 'Pairing failed. Generate a new QR code in ECHO.',
        noTrack: 'Nothing playing',
        unknownArtist: 'Unknown artist',
        idle: 'Idle',
        loading: 'Loading',
        playing: 'Playing',
        paused: 'Paused',
        stopped: 'Stopped',
        sequential: 'Sequential',
        shuffle: 'Shuffle',
        repeatOne: 'Repeat one',
        changePlaybackOrder: 'Change playback order',
        actionFailed: 'Control failed',
        storageWarning: 'The browser could not save this credential. Pair again after closing the page.',
        install: 'Add to Home Screen',
        installIos: 'Open Safari Share, then choose Add to Home Screen.',
        installBrowser: 'Open the browser menu, then choose Add to Home Screen.',
      },
    };
    const copy = navigator.language.toLowerCase().startsWith('zh') ? copies.zh : copies.en;
    document.documentElement.lang = copy === copies.zh ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.getAttribute('data-i18n');
      if (key && copy[key]) element.textContent = copy[key];
    });

    const eventNames = [
      'snapshot',
      'playback.state.changed',
      'playback.track.changed',
      'playback.progress.changed',
      'playback.volume.changed',
      'playback.output.changed',
    ];
    const elements = {
      connection: document.getElementById('connection'),
      setup: document.getElementById('setup'),
      setupMessage: document.getElementById('setup-message'),
      retry: document.getElementById('retry'),
      remote: document.getElementById('remote'),
      modeStatus: document.getElementById('mode-status'),
      modeLabel: document.getElementById('mode-label'),
      artwork: document.getElementById('artwork'),
      trackTitle: document.getElementById('track-title'),
      trackArtist: document.getElementById('track-artist'),
      trackAlbum: document.getElementById('track-album'),
      position: document.getElementById('position'),
      duration: document.getElementById('duration'),
      progress: document.getElementById('progress'),
      shuffleToggle: document.getElementById('shuffle-toggle'),
      playToggle: document.getElementById('play-toggle'),
      repeatToggle: document.getElementById('repeat-toggle'),
      volume: document.getElementById('volume'),
      volumeValue: document.getElementById('volume-value'),
      panel: document.getElementById('control-panel'),
      error: document.getElementById('error'),
      toast: document.getElementById('toast'),
      installApp: document.getElementById('install-app'),
    };
    let credential = null;
    let snapshot = null;
    let eventSource = null;
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    let eventGeneration = 0;
    let actionPending = false;
    let progressDragging = false;
    let toastTimer = null;
    let artworkObjectUrl = null;
    let artworkKey = null;
    let artworkGeneration = 0;
    let recoveryInFlight = false;
    let installPrompt = null;
    const statusRequestTimeoutMs = 8000;
    const statusHealthIntervalMs = 30000;

    const openDatabase = () => new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('indexed_db_unavailable'));
        return;
      }
      const request = indexedDB.open('echo-link-mobile-remote', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('credentials')) {
          request.result.createObjectStore('credentials');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexed_db_open_failed'));
    });

    const readCredential = async () => {
      try {
        const database = await openDatabase();
        return await new Promise((resolve, reject) => {
          const transaction = database.transaction('credentials', 'readonly');
          const request = transaction.objectStore('credentials').get('active');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
          transaction.oncomplete = () => database.close();
        });
      } catch {
        return null;
      }
    };

    const writeCredential = async (value) => {
      try {
        const database = await openDatabase();
        await new Promise((resolve, reject) => {
          const transaction = database.transaction('credentials', 'readwrite');
          transaction.objectStore('credentials').put(value, 'active');
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
        database.close();
        return true;
      } catch {
        return false;
      }
    };

    const deleteCredential = async () => {
      try {
        const database = await openDatabase();
        await new Promise((resolve, reject) => {
          const transaction = database.transaction('credentials', 'readwrite');
          transaction.objectStore('credentials').delete('active');
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
        database.close();
      } catch {
        // The in-memory credential is still cleared below.
      }
    };

    const setConnection = (state) => {
      elements.connection.dataset.state = state;
      elements.connection.setAttribute('aria-label', copy[state] || state);
      elements.connection.title = copy[state] || state;
    };

    const showToast = (message) => {
      if (!message) return;
      window.clearTimeout(toastTimer);
      elements.toast.textContent = message;
      elements.toast.dataset.visible = 'true';
      toastTimer = window.setTimeout(() => {
        elements.toast.dataset.visible = 'false';
      }, 3200);
    };

    const showError = (message) => {
      elements.error.hidden = !message;
      elements.error.textContent = message || '';
    };

    const showSetup = (message) => {
      elements.setup.hidden = false;
      elements.remote.hidden = true;
      elements.modeStatus.hidden = true;
      elements.setupMessage.textContent = message || copy.setupMessage;
      setConnection('offline');
    };

    const showRemote = () => {
      elements.setup.hidden = true;
      elements.remote.hidden = false;
      elements.modeStatus.hidden = false;
    };

    const stopEvents = () => {
      eventGeneration += 1;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    const clearAccess = async (message) => {
      stopEvents();
      releaseArtwork();
      credential = null;
      snapshot = null;
      await deleteCredential();
      showSetup(message || copy.revoked);
    };

    const formatTime = (value) => {
      const seconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
      const minutes = Math.floor(seconds / 60);
      return String(minutes) + ':' + String(seconds % 60).padStart(2, '0');
    };

    const stateLabel = (state) => copy[state] || String(state || copy.idle);

    const releaseArtwork = () => {
      artworkGeneration += 1;
      if (artworkObjectUrl) {
        URL.revokeObjectURL(artworkObjectUrl);
        artworkObjectUrl = null;
      }
      elements.artwork.removeAttribute('src');
      elements.artwork.dataset.ready = 'false';
      elements.artwork.alt = '';
      artworkKey = null;
    };

    const refreshArtwork = async (next, force) => {
      const track = next && next.track;
      const nextKey = track
        ? [track.id || '', track.title || '', track.artist || '', track.album || ''].join('|')
        : null;
      if (!track) {
        if (artworkKey !== null) releaseArtwork();
        return;
      }
      if (!force && artworkKey === nextKey) return;

      artworkKey = nextKey;
      const generation = ++artworkGeneration;
      if (artworkObjectUrl) {
        URL.revokeObjectURL(artworkObjectUrl);
        artworkObjectUrl = null;
      }
      elements.artwork.removeAttribute('src');
      elements.artwork.dataset.ready = 'false';
      elements.artwork.alt = track.title || copy.noTrack;
      try {
        const response = await fetch(credential.apiBaseUrl + '/artwork/current', {
          headers: { Authorization: 'Bearer ' + credential.accessToken },
        });
        if (response.status === 401) {
          await clearAccess(copy.revoked);
          return;
        }
        if (!response.ok) return;
        const blob = await response.blob();
        if (generation !== artworkGeneration || artworkKey !== nextKey || !blob.type.startsWith('image/')) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        const previousObjectUrl = artworkObjectUrl;
        artworkObjectUrl = objectUrl;
        elements.artwork.onload = () => {
          if (elements.artwork.src === objectUrl) {
            elements.artwork.dataset.ready = 'true';
          }
          if (previousObjectUrl) URL.revokeObjectURL(previousObjectUrl);
        };
        elements.artwork.onerror = () => {
          if (elements.artwork.src === objectUrl) {
            elements.artwork.dataset.ready = 'false';
          }
          URL.revokeObjectURL(objectUrl);
          if (artworkObjectUrl === objectUrl) artworkObjectUrl = null;
        };
        elements.artwork.src = objectUrl;
      } catch {
        // Artwork is optional; controls and playback status stay available.
      }
    };

    const renderSnapshot = (next, forceArtwork) => {
      if (!next || typeof next !== 'object') return;
      snapshot = next;
      const track = next.track || null;
      const state = next.state || 'idle';
      const isPlaying = state === 'playing' || state === 'loading';
      elements.trackTitle.textContent = track && track.title ? track.title : copy.noTrack;
      elements.trackArtist.textContent = track && track.artist ? track.artist : copy.unknownArtist;
      elements.trackAlbum.textContent = track && track.album ? track.album : stateLabel(state);
      elements.position.textContent = formatTime(next.positionMs);
      elements.duration.textContent = formatTime(next.durationMs);
      if (!progressDragging) {
        elements.progress.max = String(Math.max(1, Number(next.durationMs) || 0));
        elements.progress.value = String(Math.max(0, Math.min(Number(next.positionMs) || 0, Number(next.durationMs) || 0)));
      }
      const volume = Math.max(0, Math.min(1, Number(next.volume) || 0));
      elements.volume.value = String(volume);
      elements.volumeValue.textContent = String(Math.round(volume * 100)) + '%';
      elements.playToggle.dataset.playing = String(isPlaying);
      elements.playToggle.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
      const playbackOrder = next.playbackOrder === 'shuffle' || next.playbackOrder === 'repeat-one'
        ? next.playbackOrder
        : 'sequential';
      const modeLabel = playbackOrder === 'shuffle'
        ? copy.shuffle
        : playbackOrder === 'repeat-one'
          ? copy.repeatOne
          : copy.sequential;
      elements.modeLabel.textContent = modeLabel;
      elements.modeStatus.setAttribute('aria-label', copy.changePlaybackOrder + ': ' + modeLabel);
      document.querySelectorAll('[data-mode-icon]').forEach((icon) => {
        icon.dataset.visible = String(icon.getAttribute('data-mode-icon') === playbackOrder);
      });
      const shuffleActive = playbackOrder === 'shuffle';
      const repeatActive = playbackOrder === 'repeat-one';
      elements.shuffleToggle.dataset.active = String(shuffleActive);
      elements.shuffleToggle.setAttribute('aria-pressed', String(shuffleActive));
      elements.repeatToggle.dataset.active = String(repeatActive);
      elements.repeatToggle.setAttribute('aria-pressed', String(repeatActive));
      void refreshArtwork(next, Boolean(forceArtwork));
    };

    const parsePairingFragment = () => {
      const fragment = new URLSearchParams(location.hash.replace(/^#/u, ''));
      const pairingUri = fragment.get('pair');
      if (!pairingUri) return null;
      history.replaceState(null, '', location.pathname + location.search);
      try {
        const uri = new URL(pairingUri);
        if (uri.protocol !== 'echo:' || uri.hostname !== 'pair' || uri.searchParams.get('version') !== '2') {
          return null;
        }
        const pairingId = uri.searchParams.get('pairingId');
        const secret = uri.searchParams.get('secret');
        if (!pairingId || !secret) return null;
        return { pairingId, secret };
      } catch {
        return null;
      }
    };

    const parseJsonResponse = async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(body && body.error && body.error.message ? body.error.message : 'http_' + response.status);
        error.status = response.status;
        error.code = body && body.error ? body.error.code : null;
        throw error;
      }
      return body;
    };

    const pair = async (pairing) => {
      setConnection('connecting');
      elements.setupMessage.textContent = copy.pairing;
      const response = await fetch('/echo-link/v2/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingId: pairing.pairingId,
          secret: pairing.secret,
          clientName: 'ECHO Mobile Remote',
          platform: navigator.platform || 'web',
        }),
      });
      const paired = await parseJsonResponse(response);
      credential = {
        apiBaseUrl: location.origin + '/echo-link/v2',
        accessToken: paired.accessToken,
        clientId: paired.clientId,
      };
      if (!(await writeCredential(credential))) {
        showToast(copy.storageWarning);
      }
    };

    const request = async (path, options) => {
      if (!credential) throw new Error('not_paired');
      const nextOptions = options || {};
      const headers = Object.assign({}, nextOptions.headers || {}, {
        Authorization: 'Bearer ' + credential.accessToken,
      });
      const response = await fetch(credential.apiBaseUrl + path, Object.assign({}, nextOptions, { headers }));
      try {
        return await parseJsonResponse(response);
      } catch (error) {
        if (error && error.status === 401) {
          await clearAccess(copy.revoked);
        }
        throw error;
      }
    };

    const requestWithTimeout = async (path, options) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), statusRequestTimeoutMs);
      try {
        return await request(path, Object.assign({}, options || {}, { signal: controller.signal }));
      } finally {
        window.clearTimeout(timeout);
      }
    };

    const refreshStatus = async () => {
      const status = await requestWithTimeout('/status');
      renderSnapshot(status.playback);
      showRemote();
      showError('');
      return status;
    };

    const scheduleReconnect = () => {
      if (!credential || reconnectTimer) return;
      setConnection('connecting');
      const delay = Math.min(15000, 1000 * Math.pow(2, Math.min(reconnectAttempt, 4)));
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        startEvents();
      }, delay);
    };

    const startEvents = async () => {
      if (!credential) return;
      const generation = eventGeneration + 1;
      eventGeneration = generation;
      if (eventSource) eventSource.close();
      eventSource = null;
      try {
        const ticket = await requestWithTimeout('/events/ticket', { method: 'POST' });
        if (generation !== eventGeneration || !credential) return;
        const eventsUrl = new URL(ticket.eventsUrl, location.origin);
        const source = new EventSource(eventsUrl.toString());
        eventSource = source;
        source.onopen = () => {
          if (generation !== eventGeneration) return;
          reconnectAttempt = 0;
          setConnection('online');
        };
        const onEvent = (event) => {
          try {
            const envelope = JSON.parse(event.data);
            renderSnapshot(envelope.snapshot, envelope.type === 'playback.track.changed');
          } catch {
            // Ignore malformed third-party data; the next full snapshot will resync.
          }
        };
        eventNames.forEach((name) => source.addEventListener(name, onEvent));
        source.onerror = () => {
          if (generation !== eventGeneration) return;
          source.close();
          if (eventSource === source) eventSource = null;
          scheduleReconnect();
        };
      } catch (error) {
        if (generation === eventGeneration && credential) {
          showError(error && error.message ? error.message : copy.actionFailed);
          scheduleReconnect();
        }
      }
    };

    const recoverConnection = async () => {
      if (!credential || recoveryInFlight || document.visibilityState === 'hidden') return;
      recoveryInFlight = true;
      stopEvents();
      setConnection('connecting');
      try {
        await refreshStatus();
        if (credential) await startEvents();
      } catch {
        if (credential) scheduleReconnect();
      } finally {
        recoveryInFlight = false;
      }
    };

    const createRequestId = () => {
      if (crypto.randomUUID) return crypto.randomUUID();
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    };

    const sendAction = async (action, values) => {
      if (actionPending || !credential) return;
      actionPending = true;
      elements.panel.dataset.busy = 'true';
      document.querySelectorAll('[data-playback-control]').forEach((button) => { button.disabled = true; });
      try {
        await request('/actions/playback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ requestId: createRequestId(), action }, values || {})),
        });
        await refreshStatus();
      } catch (error) {
        if (credential) {
          const message = error && error.message ? error.message : copy.actionFailed;
          showError(message);
          showToast(copy.actionFailed);
        }
      } finally {
        actionPending = false;
        elements.panel.dataset.busy = 'false';
        document.querySelectorAll('[data-playback-control]').forEach((button) => { button.disabled = false; });
      }
    };

    document.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.getAttribute('data-action');
        if (action === 'playToggle') {
          const state = snapshot && snapshot.state;
          void sendAction(state === 'playing' || state === 'loading' ? 'pause' : 'play');
        } else if (action === 'toggleShuffle') {
          const mode = snapshot && snapshot.playbackOrder === 'shuffle' ? 'sequential' : 'shuffle';
          void sendAction('setPlaybackOrder', { mode });
        } else if (action === 'toggleRepeatOne') {
          const mode = snapshot && snapshot.playbackOrder === 'repeat-one' ? 'sequential' : 'repeat-one';
          void sendAction('setPlaybackOrder', { mode });
        } else if (action === 'cyclePlaybackOrder') {
          const current = snapshot && snapshot.playbackOrder;
          const mode = current === 'shuffle' ? 'repeat-one' : current === 'repeat-one' ? 'sequential' : 'shuffle';
          void sendAction('setPlaybackOrder', { mode });
        } else if (action) {
          void sendAction(action);
        }
      });
    });

    elements.progress.addEventListener('pointerdown', () => { progressDragging = true; });
    elements.progress.addEventListener('input', () => {
      elements.position.textContent = formatTime(Number(elements.progress.value));
    });
    elements.progress.addEventListener('change', () => {
      progressDragging = false;
      void sendAction('seek', { positionMs: Number(elements.progress.value) });
    });
    elements.volume.addEventListener('input', () => {
      elements.volumeValue.textContent = String(Math.round(Number(elements.volume.value) * 100)) + '%';
    });
    elements.volume.addEventListener('change', () => {
      void sendAction('setVolume', { volume: Number(elements.volume.value) });
    });
    elements.retry.addEventListener('click', () => {
      void initialize();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void recoverConnection();
    });
    window.addEventListener('pageshow', () => { void recoverConnection(); });
    window.addEventListener('online', () => { void recoverConnection(); });

    const statusHealthTimer = window.setInterval(() => {
      if (!credential || recoveryInFlight || document.visibilityState === 'hidden') return;
      void refreshStatus().catch(() => {
        if (!credential) return;
        stopEvents();
        scheduleReconnect();
      });
    }, statusHealthIntervalMs);

    const isStandalone = () =>
      window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const userAgent = navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/u.test(userAgent);
    const isAndroid = /Android/u.test(userAgent);
    const updateInstallVisibility = () => {
      elements.installApp.hidden = isStandalone() || (!installPrompt && !isIos && !isAndroid);
    };
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      installPrompt = event;
      updateInstallVisibility();
    });
    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      updateInstallVisibility();
    });
    elements.installApp.addEventListener('click', async () => {
      if (installPrompt) {
        const prompt = installPrompt;
        installPrompt = null;
        await prompt.prompt();
        updateInstallVisibility();
        return;
      }
      showToast(isIos ? copy.installIos : copy.installBrowser);
    });
    updateInstallVisibility();

    window.addEventListener('beforeunload', () => {
      window.clearInterval(statusHealthTimer);
      stopEvents();
      releaseArtwork();
    });

    async function initialize() {
      stopEvents();
      showError('');
      const pairing = parsePairingFragment();
      if (pairing) {
        showSetup(copy.pairing);
        try {
          await pair(pairing);
        } catch {
          credential = null;
          showSetup(copy.pairFailed);
          return;
        }
      } else if (!credential) {
        credential = await readCredential();
      }
      if (!credential) {
        showSetup(copy.setupMessage);
        return;
      }
      setConnection('connecting');
      try {
        await refreshStatus();
        await startEvents();
      } catch (error) {
        if (credential) {
          showSetup(error && error.message ? error.message : copy.revoked);
        }
      }
    }

    void initialize();
  })();
  </script>
</body>
</html>`;

export const createEchoLinkMobileRemoteHtml = (): string => mobileRemoteHtml;
