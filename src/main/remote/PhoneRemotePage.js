export const MOBILE_REMOTE_HTML_V2 = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#f8f3f7" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="ECHO Remote" />
  <link rel="manifest" />
  <title>ECHO Remote</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f9f5f8;
      --text: #211d24;
      --sub: #746b78;
      --muted: #a49ba8;
      --line: rgba(41, 33, 46, 0.1);
      --panel: rgba(255, 255, 255, 0.68);
      --panel-strong: rgba(255, 255, 255, 0.92);
      --accent: #d66f9c;
      --accent-2: #9b8cff;
      --wash: rgba(214, 111, 156, 0.18);
      --shadow: 0 18px 46px rgba(44, 35, 50, 0.12);
      --blur: blur(22px);
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body { margin: 0; width: 100%; min-height: 100%; overflow: hidden; }
    body {
      background:
        radial-gradient(circle at 8% 0%, rgba(255,255,255,0.9), transparent 32%),
        radial-gradient(circle at 90% 8%, rgba(174, 193, 228, 0.28), transparent 34%),
        linear-gradient(180deg, #f8f4f6 0%, #f5f5f4 52%, #eef1f4 100%);
      color: var(--text);
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    button, input, select { font: inherit; }
    button { touch-action: manipulation; }
    .ambient {
      position: fixed;
      inset: -24px;
      z-index: 0;
      pointer-events: none;
      opacity: 0.14;
      filter: blur(46px) saturate(0.92);
      transform: scale(1.08);
    }
    .ambient img { width: 100%; height: 100%; object-fit: cover; display: none; }
    .ambient.has-cover img { display: block; }
    .shell {
      position: relative;
      z-index: 1;
      height: 100dvh;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto auto;
      gap: 8px;
      padding: max(10px, env(safe-area-inset-top)) 12px max(8px, env(safe-area-inset-bottom));
    }
    .status-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 34px;
      padding: 0 1px;
    }
    .status-main {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 13px;
      color: var(--sub);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .status-main strong { color: var(--text); font-size: 14px; }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #f59e0b;
      box-shadow: 0 0 0 5px rgba(245, 158, 11, 0.14);
      flex: 0 0 auto;
    }
    .dot.ok { background: #23c36b; box-shadow-color: rgba(35, 195, 107, 0.16); }
    .dot.bad { background: #ef4444; box-shadow-color: rgba(239, 68, 68, 0.16); }
    .chip {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.62);
      color: var(--sub);
      border-radius: 999px;
      padding: 7px 11px;
      font-size: 12px;
      white-space: nowrap;
      max-width: 48vw;
      overflow: hidden;
      text-overflow: ellipsis;
      backdrop-filter: var(--blur);
    }
    .pages {
      min-height: 0;
      overflow: hidden;
      border-radius: 24px;
    }
    .page {
      height: 100%;
      display: none;
      overflow: auto;
      padding: 7px 0 10px;
      scrollbar-width: none;
    }
    .page::-webkit-scrollbar { display: none; }
    .page.active { display: block; }
    .now-page {
      text-align: center;
      display: none;
      align-content: start;
      gap: 13px;
      padding-top: 3px;
    }
    .now-page.active { display: grid; }
    .cover-wrap {
      width: min(72vw, 330px, 42dvh);
      aspect-ratio: 1;
      margin: 0 auto;
      border-radius: 29px;
      overflow: hidden;
      background: linear-gradient(145deg, rgba(255,255,255,0.82), rgba(226,232,240,0.66));
      box-shadow: var(--shadow);
      display: grid;
      place-items: center;
      color: rgba(33, 29, 36, 0.26);
      font-size: 82px;
    }
    .cover-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .meta { display: grid; gap: 5px; padding: 0 8px; }
    .title {
      margin: 0;
      font-size: clamp(24px, 7vw, 36px);
      line-height: 1.06;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }
    .artist {
      margin: 0;
      color: var(--sub);
      font-size: 15px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .quality {
      color: var(--sub);
      font-size: 12px;
      font-weight: 750;
      min-height: 18px;
    }
    .seek-block { display: grid; gap: 7px; padding: 2px 7px 0; }
    .time-row { display: flex; justify-content: space-between; color: var(--sub); font-size: 12px; }
    input[type="range"] {
      width: 100%;
      height: 24px;
      accent-color: var(--accent);
    }
    .quick-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      padding: 0 4px;
    }
    .icon-btn {
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.56);
      color: var(--text);
      border-radius: 16px;
      min-height: 40px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 760;
      backdrop-filter: var(--blur);
    }
    .icon-btn .ico { font-size: 16px; line-height: 1; }
    .icon-btn.active {
      border-color: rgba(214,111,156,0.34);
      background: rgba(255, 237, 245, 0.84);
      color: #b94e7c;
    }
    .panel {
      background: var(--panel);
      border: 1px solid rgba(255,255,255,0.76);
      border-radius: 24px;
      box-shadow: 0 16px 46px rgba(44, 35, 50, 0.1);
      backdrop-filter: var(--blur);
    }
    .lyrics-page {
      display: none;
      min-height: 100%;
      align-content: center;
      gap: 18px;
      padding: 20px 4px;
      text-align: center;
    }
    .lyrics-page.active { display: grid; }
    .lyric-stack { display: grid; gap: 18px; }
    .lyric-line {
      margin: 0;
      color: var(--muted);
      font-size: 17px;
      line-height: 1.45;
      opacity: 0.62;
      overflow-wrap: anywhere;
    }
    .lyric-line.current {
      color: var(--text);
      font-size: clamp(27px, 8.5vw, 42px);
      line-height: 1.18;
      font-weight: 860;
      opacity: 1;
    }
    .lyrics-tools { display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; }
    .list-page { padding: 0 0 12px; }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 5px 3px 12px;
    }
    .section-head h2 {
      margin: 0;
      font-size: 27px;
      line-height: 1;
      letter-spacing: 0;
    }
    .section-head span {
      color: var(--sub);
      font-size: 13px;
      display: block;
      margin-top: 8px;
    }
    .library-list, .queue-list, .search-list {
      display: grid;
      gap: 0;
      overflow: hidden;
      border-radius: 22px;
      background: rgba(255,255,255,0.56);
      border: 1px solid rgba(42, 33, 48, 0.055);
      backdrop-filter: var(--blur);
    }
    .search-list:empty {
      display: none;
    }
    .list-more {
      width: 100%;
      margin-top: 9px;
    }
    .row {
      display: grid;
      grid-template-columns: 46px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-height: 66px;
      padding: 9px 7px;
      border-radius: 0;
      background: transparent;
      border: 0;
      border-bottom: 1px solid rgba(42, 33, 48, 0.065);
    }
    .row:last-child { border-bottom: 0; }
    .row.current {
      background: rgba(255, 247, 250, 0.82);
      box-shadow: inset 3px 0 0 rgba(214, 99, 138, 0.72);
    }
    .thumb {
      width: 46px;
      height: 46px;
      border-radius: 13px;
      overflow: hidden;
      background: linear-gradient(145deg, #ffffff, #eef1f5);
      display: grid;
      place-items: center;
      color: #8d8790;
      font-weight: 900;
      font-size: 15px;
      letter-spacing: 0;
      box-shadow: inset 0 0 0 1px rgba(42, 33, 48, 0.035);
    }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .row-main { min-width: 0; display: grid; gap: 2px; }
    .row-title {
      font-size: 15px;
      font-weight: 820;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row-sub {
      font-size: 12.5px;
      color: var(--sub);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row-actions {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .tiny {
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.72);
      color: var(--text);
      border-radius: 999px;
      min-width: 30px;
      width: 32px;
      height: 32px;
      padding: 0;
      display: inline-grid;
      place-items: center;
      font-size: 14px;
      font-weight: 880;
      box-shadow: 0 6px 16px rgba(44, 35, 50, 0.07);
    }
    .tiny.primary {
      background: #262128;
      border-color: #262128;
      color: #fff;
    }
    .tiny.danger { color: #d84c66; }
    .empty {
      min-height: 230px;
      display: grid;
      place-items: center;
      text-align: center;
      color: var(--sub);
      padding: 24px;
    }
    .controls-page { display: none; gap: 10px; padding: 3px 0 10px; }
    .controls-page.active { display: grid; }
    .control-card {
      display: grid;
      gap: 10px;
      padding: 12px;
      border-radius: 20px;
      background: rgba(255,255,255,0.54);
      border: 1px solid rgba(42, 33, 48, 0.055);
      backdrop-filter: var(--blur);
    }
    .control-card h3 {
      margin: 0;
      font-size: 13px;
      color: var(--sub);
      letter-spacing: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .control-card strong { color: var(--text); }
    .control-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    select, input[type="search"] {
      width: 100%;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.78);
      color: var(--text);
      border-radius: 18px;
      padding: 13px 14px;
      outline: none;
    }
    input[type="search"] { padding-left: 14px; }
    .toggle-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .status-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .status-item {
      border-radius: 16px;
      background: rgba(255,255,255,0.58);
      border: 1px solid var(--line);
      padding: 10px;
      display: grid;
      gap: 2px;
      color: var(--sub);
      font-size: 12px;
      overflow: hidden;
    }
    .status-item strong { color: var(--text); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .transport {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 8px;
      padding: 9px 10px 9px 13px;
      border-radius: 24px;
      background: rgba(255,255,255,0.82);
      border: 1px solid rgba(255,255,255,0.9);
      box-shadow: 0 16px 34px rgba(44, 35, 50, 0.12);
      backdrop-filter: var(--blur);
    }
    .mini-track { min-width: 0; display: grid; gap: 2px; padding-left: 4px; }
    .mini-title { font-size: 13px; font-weight: 860; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .mini-sub { color: var(--sub); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .transport-controls { display: flex; align-items: center; gap: 6px; }
    .round {
      border: 0;
      border-radius: 999px;
      background: rgba(255,255,255,0.92);
      color: var(--text);
      width: 40px;
      height: 40px;
      box-shadow: 0 8px 18px rgba(44, 35, 50, 0.1);
      font-size: 17px;
      display: inline-grid;
      place-items: center;
    }
    .round.play {
      width: 56px;
      height: 56px;
      color: #fff;
      background: linear-gradient(135deg, #2b2729, #776d76);
      font-size: 24px;
      box-shadow: 0 16px 30px rgba(44, 35, 50, 0.24);
    }
    .tabs {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 4px;
      padding: 4px;
      border-radius: 24px;
      background: rgba(255,255,255,0.72);
      border: 1px solid rgba(255,255,255,0.9);
      backdrop-filter: var(--blur);
    }
    .tab-btn {
      min-height: 40px;
      border: 0;
      border-radius: 18px;
      background: transparent;
      color: var(--sub);
      font-size: 12px;
      font-weight: 860;
      display: grid;
      place-items: center;
      gap: 1px;
    }
    .tab-btn.active {
      color: var(--text);
      background: #fff;
      box-shadow: 0 8px 18px rgba(44,35,50,0.09);
    }
    .tab-btn span { font-size: 16px; line-height: 1; }
    .install-tip {
      display: none;
      font-size: 12px;
      color: var(--sub);
      line-height: 1.5;
    }
    .install-tip.show { display: block; }
    @media (max-width: 370px) {
      .shell { padding-left: 10px; padding-right: 10px; }
      .quick-row { grid-template-columns: repeat(2, 1fr); }
      .row { grid-template-columns: 42px minmax(0, 1fr); }
      .row-actions { grid-column: 2; justify-content: flex-start; }
      .thumb { width: 42px; height: 42px; border-radius: 12px; }
      .transport { grid-template-columns: 1fr; }
      .transport-controls { justify-content: center; }
    }
  </style>
</head>
<body>
  <div id="ambient" class="ambient"><img id="ambientCover" alt="" /></div>
  <main class="shell">
    <header class="status-bar">
      <div class="status-main">
        <span id="dot" class="dot"></span>
        <strong>ECHO</strong>
        <span>·</span>
        <span id="statusText">正在连接 ECHO...</span>
      </div>
      <span id="deviceChip" class="chip">本机</span>
    </header>

    <section class="pages">
      <article id="pageNow" class="page now-page active">
        <div id="cover" class="cover-wrap">♪</div>
        <div class="meta">
          <h1 id="title" class="title">ECHO</h1>
          <p id="artist" class="artist">等待播放</p>
          <div id="quality" class="quality">Native</div>
        </div>
        <div class="seek-block">
          <input id="seek" type="range" min="0" max="0" step="0.1" value="0" />
          <div class="time-row"><span id="pos">0:00</span><span id="dur">0:00</span></div>
        </div>
        <div class="quick-row">
          <button id="like" class="icon-btn"><span class="ico">♡</span><span>喜欢</span></button>
          <button id="mode" class="icon-btn"><span class="ico">↻</span><span id="modeText">循环</span></button>
          <button id="mute" class="icon-btn"><span class="ico">♬</span><span>静音</span></button>
          <button id="lyricsQuick" class="icon-btn"><span class="ico">词</span><span>歌词</span></button>
        </div>
      </article>

      <article id="pageLyrics" class="page lyrics-page">
        <div class="lyric-stack">
          <p id="lyricPrev" class="lyric-line"></p>
          <p id="lyricCurrent" class="lyric-line current">暂无歌词</p>
          <p id="lyricNext" class="lyric-line"></p>
        </div>
        <div class="lyrics-tools">
          <button id="desktopLyricsToggle" class="icon-btn"><span class="ico">▣</span><span>桌面歌词</span></button>
          <button id="openLyricsDesktop" class="icon-btn"><span class="ico">词</span><span>显示歌词页</span></button>
        </div>
      </article>

      <article id="pageLibrary" class="page list-page">
        <div class="section-head">
          <div><h2>曲目</h2><span id="libraryPageCount">0 首</span></div>
          <button id="libraryRefresh" class="tiny">刷新</button>
        </div>
        <section class="control-card">
          <input id="librarySearchInput" type="search" placeholder="搜索曲目 / 艺人 / 专辑..." />
        </section>
        <div id="libraryList" class="library-list"></div>
        <button id="libraryMore" class="icon-btn list-more"><span class="ico">＋</span><span>加载更多</span></button>
      </article>

      <article id="pageQueue" class="page list-page">
        <div class="section-head">
          <div><h2>播放队列</h2><span id="queueCount">0 首</span></div>
          <button id="clearQueue" class="tiny danger">清空</button>
        </div>
        <div id="queueList" class="queue-list"></div>
      </article>

      <article id="pageControl" class="page controls-page">
        <section class="control-card">
          <h3>音量 <strong id="volumeText">100%</strong></h3>
          <input id="volume" type="range" min="0" max="1" step="0.01" value="1" />
          <div class="control-row">
            <button id="muteControl" class="icon-btn"><span class="ico">♬</span><span>快速静音</span></button>
            <button id="rateReset" class="icon-btn"><span class="ico">1x</span><span>速度复位</span></button>
          </div>
        </section>

        <section class="control-card">
          <h3>播放速度 <strong id="rateText">1.00x</strong></h3>
          <input id="rate" type="range" min="0.5" max="2" step="0.05" value="1" />
        </section>

        <section class="control-card">
          <h3>输出设备 <strong id="deviceName">系统默认</strong></h3>
          <select id="deviceSelect"></select>
          <div class="toggle-grid">
            <button id="exclusiveToggle" class="icon-btn"><span class="ico">◎</span><span>独占</span></button>
            <button id="gaplessToggle" class="icon-btn"><span class="ico">∞</span><span>Gapless</span></button>
            <button id="automixToggle" class="icon-btn"><span class="ico">≈</span><span>Automix</span></button>
            <button id="eqToggle" class="icon-btn"><span class="ico">≋</span><span>EQ</span></button>
          </div>
        </section>

        <section class="control-card">
          <h3>音效与模式</h3>
          <select id="playModeSelect">
            <option value="loop">列表循环</option>
            <option value="shuffle">随机播放</option>
            <option value="single">单曲循环</option>
          </select>
          <select id="eqSelect"></select>
        </section>

        <section class="control-card">
          <h3>搜索本地曲库 <strong id="libraryCount">0 首</strong></h3>
          <input id="searchInput" type="search" placeholder="搜索曲目 / 艺人 / 专辑..." />
          <div id="searchList" class="search-list"></div>
        </section>

        <section class="control-card">
          <h3>连接状态</h3>
          <div class="status-grid">
            <div class="status-item"><span>当前 IP</span><strong id="ipText">--</strong></div>
            <div class="status-item"><span>客户端</span><strong id="clientText">LAN</strong></div>
            <div class="status-item"><span>音频引擎</span><strong id="engineText">--</strong></div>
            <div class="status-item"><span>响度归一化</span><strong>未启用</strong></div>
          </div>
          <p id="installTip" class="install-tip">可以添加到主屏幕，打开后会更像 ECHO 专属遥控器。</p>
          <button id="installButton" class="icon-btn" style="display:none"><span class="ico">＋</span><span>添加到主屏幕</span></button>
        </section>
      </article>
    </section>

    <section class="transport">
      <div class="mini-track">
        <span id="miniTitle" class="mini-title">ECHO</span>
        <span id="miniSub" class="mini-sub">正在连接 ECHO...</span>
      </div>
      <div class="transport-controls">
        <button id="prev" class="round" aria-label="上一首">‹‹</button>
        <button id="play" class="round play" aria-label="播放或暂停">▶</button>
        <button id="next" class="round" aria-label="下一首">››</button>
      </div>
    </section>

    <nav class="tabs">
      <button class="tab-btn active" data-page="Now"><span>♪</span>播放</button>
      <button class="tab-btn" data-page="Lyrics"><span>词</span>歌词</button>
      <button class="tab-btn" data-page="Library"><span>曲</span>曲目</button>
      <button class="tab-btn" data-page="Queue"><span>☰</span>队列</button>
      <button class="tab-btn" data-page="Control"><span>⚙</span>控制</button>
    </nav>
  </main>

  <script>
    const $ = (id) => document.getElementById(id)
    const els = {
      dot: $('dot'),
      statusText: $('statusText'),
      deviceChip: $('deviceChip'),
      ambient: $('ambient'),
      ambientCover: $('ambientCover'),
      cover: $('cover'),
      title: $('title'),
      artist: $('artist'),
      quality: $('quality'),
      seek: $('seek'),
      pos: $('pos'),
      dur: $('dur'),
      like: $('like'),
      mode: $('mode'),
      modeText: $('modeText'),
      mute: $('mute'),
      lyricsQuick: $('lyricsQuick'),
      lyricPrev: $('lyricPrev'),
      lyricCurrent: $('lyricCurrent'),
      lyricNext: $('lyricNext'),
      desktopLyricsToggle: $('desktopLyricsToggle'),
      libraryList: $('libraryList'),
      libraryPageCount: $('libraryPageCount'),
      librarySearchInput: $('librarySearchInput'),
      libraryMore: $('libraryMore'),
      libraryRefresh: $('libraryRefresh'),
      queueList: $('queueList'),
      queueCount: $('queueCount'),
      volume: $('volume'),
      volumeText: $('volumeText'),
      rate: $('rate'),
      rateText: $('rateText'),
      deviceSelect: $('deviceSelect'),
      deviceName: $('deviceName'),
      exclusiveToggle: $('exclusiveToggle'),
      gaplessToggle: $('gaplessToggle'),
      automixToggle: $('automixToggle'),
      eqToggle: $('eqToggle'),
      playModeSelect: $('playModeSelect'),
      eqSelect: $('eqSelect'),
      searchInput: $('searchInput'),
      searchList: $('searchList'),
      libraryCount: $('libraryCount'),
      ipText: $('ipText'),
      clientText: $('clientText'),
      engineText: $('engineText'),
      installTip: $('installTip'),
      installButton: $('installButton'),
      miniTitle: $('miniTitle'),
      miniSub: $('miniSub'),
      play: $('play')
    }

    let ws = null
    let reconnectMs = 650
    let heartbeat = 0
    let lastState = null
    let deferredInstallPrompt = null
    let deviceSignature = ''
    let eqSignature = ''
    let searchTimer = 0
    let libraryTimer = 0
    const token = new URLSearchParams(location.search).get('t') || ''
    const manifestLink = document.querySelector('link[rel="manifest"]')
    if (manifestLink) manifestLink.href = '/remote-manifest.webmanifest' + location.search
    els.ipText.textContent = location.host

    function formatTime(value) {
      const seconds = Math.max(0, Number(value) || 0)
      const m = Math.floor(seconds / 60)
      const s = Math.floor(seconds % 60)
      return m + ':' + String(s).padStart(2, '0')
    }

    function setStatus(kind, text) {
      els.dot.className = 'dot ' + (kind || '')
      els.statusText.textContent = text
    }

    function send(type, payload) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type, payload }))
    }

    function command(commandName, payload) {
      send('command', { command: commandName, payload: payload || {} })
    }

    function clearNode(node) {
      while (node.firstChild) node.removeChild(node.firstChild)
    }

    function setCover(src) {
      clearNode(els.cover)
      if (src) {
        const img = document.createElement('img')
        img.src = src
        img.alt = ''
        img.onload = () => updatePalette(img)
        img.onerror = () => {
          els.cover.textContent = '♪'
          setAmbient('')
        }
        els.cover.appendChild(img)
        setAmbient(src)
      } else {
        els.cover.textContent = '♪'
        setAmbient('')
      }
    }

    function setAmbient(src) {
      if (!src) {
        els.ambient.classList.remove('has-cover')
        els.ambientCover.removeAttribute('src')
        return
      }
      els.ambient.classList.add('has-cover')
      els.ambientCover.src = src
    }

    function updatePalette(img) {
      try {
        const canvas = document.createElement('canvas')
        const size = 24
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data
        let r = 0
        let g = 0
        let b = 0
        let count = 0
        for (let i = 0; i < data.length; i += 16) {
          const alpha = data[i + 3]
          if (alpha < 80) continue
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          count += 1
        }
        if (!count) return
        r = Math.round(r / count)
        g = Math.round(g / count)
        b = Math.round(b / count)
        const root = document.documentElement
        root.style.setProperty('--accent', 'rgb(' + r + ', ' + g + ', ' + b + ')')
        root.style.setProperty('--accent-2', 'rgb(' + Math.min(255, r + 34) + ', ' + Math.min(255, g + 30) + ', ' + Math.min(255, b + 54) + ')')
        root.style.setProperty('--wash', 'rgba(' + r + ', ' + g + ', ' + b + ', 0.18)')
      } catch {
        /* cross-origin covers simply keep the default accent */
      }
    }

    function makeThumb(item) {
      const thumb = document.createElement('div')
      thumb.className = 'thumb'
      if (item && item.cover) {
        const img = document.createElement('img')
        img.src = item.cover
        img.alt = ''
        img.onerror = () => {
          clearNode(thumb)
          thumb.textContent = initials(item.title || item.artist || 'E')
        }
        thumb.appendChild(img)
      } else {
        thumb.textContent = initials((item && (item.title || item.artist)) || 'E')
      }
      return thumb
    }

    function initials(text) {
      const clean = String(text || 'ECHO').trim()
      if (!clean) return 'E'
      const parts = clean.split(/\s+/).filter(Boolean)
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
      return clean.slice(0, 2).toUpperCase()
    }

    function tiny(label, title, action, className) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'tiny ' + (className || '')
      btn.textContent = label
      btn.title = title || label
      btn.onclick = action
      return btn
    }

    function renderRow(item, mode) {
      const row = document.createElement('div')
      row.className = 'row' + (item.isCurrent ? ' current' : '')
      row.appendChild(makeThumb(item))
      const main = document.createElement('div')
      main.className = 'row-main'
      const title = document.createElement('div')
      title.className = 'row-title'
      title.textContent = item.title || 'Unknown Track'
      const sub = document.createElement('div')
      sub.className = 'row-sub'
      const bits = [item.artist, item.album].filter(Boolean)
      sub.textContent = bits.join(' · ') || (item.isCurrent ? '正在播放' : 'ECHO')
      main.appendChild(title)
      main.appendChild(sub)
      row.appendChild(main)
      const actions = document.createElement('div')
      actions.className = 'row-actions'
      actions.appendChild(tiny('▶', '立即播放', () => command(mode === 'queue' ? 'playQueueItem' : 'playTrack', { id: item.id }), 'primary'))
      if (!item.isCurrent) actions.appendChild(tiny('↥', '下一首播放', () => command('playNext', { id: item.id })))
      if (mode === 'search' || mode === 'library') actions.appendChild(tiny('+', '加入队列', () => command('queueTrack', { id: item.id })))
      if (mode === 'queue' && !item.isCurrent) actions.appendChild(tiny('×', '移出队列', () => command('removeQueueItem', { id: item.id }), 'danger'))
      row.appendChild(actions)
      return row
    }

    function renderQueue(queue) {
      const list = Array.isArray(queue) ? queue : []
      els.queueCount.textContent = Math.max(0, list.length - (list[0] && list[0].isCurrent ? 1 : 0)) + ' 首待播'
      clearNode(els.queueList)
      if (!list.length) {
        const empty = document.createElement('div')
        empty.className = 'empty panel'
        empty.textContent = '队列还是空的。去控制页搜索曲库，或者在桌面端把歌加入队列。'
        els.queueList.appendChild(empty)
        return
      }
      list.forEach((item) => els.queueList.appendChild(renderRow(item, 'queue')))
    }

    function renderSearch(search) {
      const results = (search && Array.isArray(search.results)) ? search.results : []
      clearNode(els.searchList)
      if (!els.searchInput.value.trim()) return
      if (!results.length) {
        const empty = document.createElement('div')
        empty.className = 'empty'
        empty.style.minHeight = '88px'
        empty.textContent = '没有找到匹配歌曲'
        els.searchList.appendChild(empty)
        return
      }
      results.forEach((item) => els.searchList.appendChild(renderRow(item, 'search')))
    }

    function renderLibrary(library) {
      const results = (library && Array.isArray(library.results)) ? library.results : []
      const total = Math.max(0, Number(library && library.total) || 0)
      const shown = results.length
      els.libraryPageCount.textContent = total ? shown + ' / ' + total + ' 首' : '0 首'
      if (document.activeElement !== els.librarySearchInput) {
        els.librarySearchInput.value = (library && library.query) || ''
      }
      clearNode(els.libraryList)
      if (!results.length) {
        const empty = document.createElement('div')
        empty.className = 'empty panel'
        empty.textContent = (library && library.query) ? '没有找到匹配曲目' : '还没有曲目可显示'
        els.libraryList.appendChild(empty)
      } else {
        results.forEach((item) => els.libraryList.appendChild(renderRow(item, 'library')))
      }
      els.libraryMore.style.display = library && library.hasMore ? '' : 'none'
    }

    function updateSelect(select, items, value, signature, setSignature) {
      if (signature.current === items.signature) {
        select.value = value
        return
      }
      signature.current = items.signature
      clearNode(select)
      items.list.forEach((item) => {
        const option = document.createElement('option')
        option.value = item.value
        option.textContent = item.label
        select.appendChild(option)
      })
      select.value = value
      setSignature(items.signature)
    }

    function renderControls(controls, playback) {
      controls = controls || {}
      playback = playback || {}
      els.volume.value = Math.max(0, Math.min(1, Number(playback.volume) || 0))
      els.volumeText.textContent = Math.round(Number(els.volume.value) * 100) + '%'
      els.rate.value = Math.max(0.5, Math.min(2, Number(playback.playbackRate) || 1))
      els.rateText.textContent = Number(els.rate.value).toFixed(2) + 'x'
      els.playModeSelect.value = playback.playMode || 'loop'
      els.deviceName.textContent = controls.outputDeviceName || '系统默认'
      els.deviceChip.textContent = controls.outputDeviceName || '本机'
      els.libraryCount.textContent = (controls.libraryCount || 0) + ' 首'
      els.engineText.textContent = controls.useNativeEngine ? (controls.audioExclusive ? 'Native Exclusive' : 'Native') : 'WebAudio'
      els.exclusiveToggle.classList.toggle('active', controls.audioExclusive === true)
      els.gaplessToggle.classList.toggle('active', controls.gaplessEnabled === true)
      els.automixToggle.classList.toggle('active', controls.automixEnabled === true)
      els.eqToggle.classList.toggle('active', controls.useEQ === true)
      els.desktopLyricsToggle.classList.toggle('active', controls.desktopLyricsEnabled === true)

      const devices = Array.isArray(controls.outputDevices) ? controls.outputDevices : []
      const nextDeviceSignature = JSON.stringify(devices.map((d) => [d.id, d.name, d.isDefault]))
      if (nextDeviceSignature !== deviceSignature) {
        deviceSignature = nextDeviceSignature
        clearNode(els.deviceSelect)
        devices.forEach((device) => {
          const option = document.createElement('option')
          option.value = device.id || ''
          option.textContent = device.name || 'Unknown device'
          els.deviceSelect.appendChild(option)
        })
      }
      els.deviceSelect.value = controls.outputDeviceId || ''

      const presets = Array.isArray(controls.eqPresets) ? controls.eqPresets : ['Custom', 'Flat']
      const nextEqSignature = presets.join('|')
      if (nextEqSignature !== eqSignature) {
        eqSignature = nextEqSignature
        clearNode(els.eqSelect)
        presets.forEach((preset) => {
          const option = document.createElement('option')
          option.value = preset
          option.textContent = preset
          els.eqSelect.appendChild(option)
        })
      }
      els.eqSelect.value = controls.activePreset || 'Custom'
    }

    function render(state) {
      lastState = state || {}
      const track = lastState.track || {}
      const playback = lastState.playback || {}
      const lyrics = lastState.lyrics || {}
      const controls = lastState.controls || {}
      els.title.textContent = track.title || 'ECHO'
      els.artist.textContent = track.artist || track.album || '等待播放'
      els.quality.textContent = track.qualityText || 'Native'
      els.miniTitle.textContent = track.title || 'ECHO'
      els.miniSub.textContent = track.artist || track.qualityText || '手机遥控器'
      setCover(track.cover || '')
      els.play.textContent = playback.isPlaying ? 'Ⅱ' : '▶'
      els.seek.max = Math.max(0, Number(playback.duration) || 0)
      els.seek.value = Math.max(0, Number(playback.position) || 0)
      els.pos.textContent = formatTime(playback.position)
      els.dur.textContent = formatTime(playback.duration)
      els.like.classList.toggle('active', !!track.liked)
      els.mute.classList.toggle('active', !!playback.isMuted)
      const mode = playback.playMode || 'loop'
      els.modeText.textContent = mode === 'shuffle' ? '随机' : mode === 'single' ? '单曲' : '循环'
      els.mode.classList.toggle('active', mode !== 'loop')
      els.lyricPrev.textContent = lyrics.prev || ''
      els.lyricCurrent.textContent = lyrics.current || '暂无歌词'
      els.lyricNext.textContent = lyrics.next || ''
      renderLibrary(lastState.library)
      renderQueue(lastState.queue)
      renderSearch(lastState.search)
      renderControls(controls, playback)
    }

    function connect() {
      clearInterval(heartbeat)
      setStatus('', reconnectMs > 650 ? '正在重新连接 ECHO...' : '正在连接 ECHO...')
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(proto + '//' + location.host + '/remote-ws' + location.search)
      ws.onopen = () => {
        reconnectMs = 650
        setStatus('ok', '已连接')
        send('hello', { token })
        send('queue_request', {})
        command('browseTracks', { query: '', offset: 0 })
        heartbeat = setInterval(() => send('ping', { at: Date.now() }), 10000)
      }
      ws.onmessage = (event) => {
        let msg = null
        try { msg = JSON.parse(event.data) } catch { return }
        if (msg.type === 'auth_failed') {
          setStatus('bad', '口令已失效，请在桌面端重新扫码')
          return
        }
        if (msg.type === 'hello') {
          const id = msg.payload && msg.payload.clientId ? msg.payload.clientId.slice(-4) : 'LAN'
          els.clientText.textContent = 'Client ' + id
        }
        if (msg.type === 'state') render(msg.payload)
      }
      ws.onclose = () => {
        clearInterval(heartbeat)
        setStatus('bad', '正在重新连接 ECHO...')
        setTimeout(connect, reconnectMs)
        reconnectMs = Math.min(8000, Math.round(reconnectMs * 1.6))
      }
      ws.onerror = () => setStatus('bad', '连接异常，正在重试')
    }

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn))
        document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'))
        $('page' + btn.dataset.page).classList.add('active')
      })
    })

    $('prev').onclick = () => command('previous')
    $('next').onclick = () => command('next')
    els.play.onclick = () => command('togglePlay')
    els.like.onclick = () => command('toggleLike')
    els.mode.onclick = () => command('cyclePlayMode')
    els.mute.onclick = () => command('toggleMute')
    $('muteControl').onclick = () => command('toggleMute')
    els.lyricsQuick.onclick = () => {
      command('toggleLyricsView')
      document.querySelector('[data-page="Lyrics"]').click()
    }
    $('openLyricsDesktop').onclick = () => command('toggleLyricsView')
    $('clearQueue').onclick = () => command('clearQueue')
    $('rateReset').onclick = () => command('setPlaybackRate', { rate: 1 })
    els.desktopLyricsToggle.onclick = () => command('setDesktopLyrics', { enabled: !(lastState && lastState.controls && lastState.controls.desktopLyricsEnabled) })
    els.exclusiveToggle.onclick = () => command('setExclusive', { enabled: !(lastState && lastState.controls && lastState.controls.audioExclusive) })
    els.gaplessToggle.onclick = () => command('setGapless', { enabled: !(lastState && lastState.controls && lastState.controls.gaplessEnabled) })
    els.automixToggle.onclick = () => command('setAutomix', { enabled: !(lastState && lastState.controls && lastState.controls.automixEnabled) })
    els.eqToggle.onclick = () => command('setEqEnabled', { enabled: !(lastState && lastState.controls && lastState.controls.useEQ) })
    els.seek.addEventListener('change', () => command('seek', { position: Number(els.seek.value) || 0 }))
    els.volume.addEventListener('input', () => {
      els.volumeText.textContent = Math.round(Number(els.volume.value) * 100) + '%'
    })
    els.volume.addEventListener('change', () => command('setVolume', { volume: Number(els.volume.value) || 0 }))
    els.rate.addEventListener('input', () => {
      els.rateText.textContent = Number(els.rate.value).toFixed(2) + 'x'
    })
    els.rate.addEventListener('change', () => command('setPlaybackRate', { rate: Number(els.rate.value) || 1 }))
    els.deviceSelect.addEventListener('change', () => command('setOutputDevice', { id: els.deviceSelect.value }))
    els.playModeSelect.addEventListener('change', () => command('setPlayMode', { mode: els.playModeSelect.value }))
    els.eqSelect.addEventListener('change', () => command('setEqPreset', { preset: els.eqSelect.value }))
    els.searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(() => command('searchTracks', { query: els.searchInput.value }), 180)
    })
    els.searchInput.addEventListener('search', () => command('searchTracks', { query: els.searchInput.value }))
    els.librarySearchInput.addEventListener('input', () => {
      clearTimeout(libraryTimer)
      libraryTimer = setTimeout(() => command('browseTracks', { query: els.librarySearchInput.value, offset: 0 }), 180)
    })
    els.librarySearchInput.addEventListener('search', () => command('browseTracks', { query: els.librarySearchInput.value, offset: 0 }))
    els.libraryRefresh.onclick = () => command('browseTracks', { query: els.librarySearchInput.value, offset: 0 })
    els.libraryMore.onclick = () => {
      const library = (lastState && lastState.library) || {}
      const shown = Array.isArray(library.results) ? library.results.length : 0
      command('browseTracks', {
        query: els.librarySearchInput.value || library.query || '',
        offset: (Number(library.offset) || 0) + shown,
        append: true
      })
    }

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault()
      deferredInstallPrompt = event
      els.installTip.classList.add('show')
      els.installButton.style.display = ''
    })
    els.installButton.onclick = async () => {
      if (!deferredInstallPrompt) return
      deferredInstallPrompt.prompt()
      await deferredInstallPrompt.userChoice.catch(() => null)
      deferredInstallPrompt = null
      els.installButton.style.display = 'none'
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations
              .filter((registration) => registration.scope && registration.scope.includes(location.origin))
              .map((registration) => registration.unregister())
          )
        )
        .catch(() => {})
        .finally(() => {
          navigator.serviceWorker
            .register('/remote-sw.js?v=5&' + new URLSearchParams(location.search).toString())
            .then((registration) => registration.update().catch(() => {}))
            .catch(() => {})
        })
    }
    connect()
  </script>
</body>
</html>`
