# ECHO 插件 ForAIReadme

这份文档写给正在帮助用户编写 ECHO Next 插件的 AI。你的目标不是绕过宿主限制，而是在 ECHO 的插件边界内生成可加载、可调试、轻量、不会影响播放稳定性的插件。

配套资料：

- `docs/ECHO_NEXT_PLUGINS.md`：完整插件创作指南。
- `docs/plugin-sdk/echo-plugin.d.ts`：当前插件 API 类型定义。
- `src/main/plugins/PluginManifest.ts`：manifest 校验规则。
- `src/shared/types/plugins.ts`：权限、贡献点、provider 返回值类型。

## 先建立正确模型

ECHO 插件不是普通 Node 项目。一个插件通常是用户数据目录 `plugins/` 下的独立文件夹：

```text
plugins/
  echo.my-plugin/
    echo.plugin.json
    plugin.js
    panel.html
    README.md
    echo-plugin.d.ts
```

宿主读取 `echo.plugin.json`，在受控 VM 沙箱里运行 `plugin.js`，按用户确认的权限暴露全局 `echo` API。可选的 `panel.html` 是 sandbox iframe，它不能直接访问 `plugin.js` 里的 `echo`，只能通过 `postMessage` 触发受控 action。

运行状态文件由宿主维护，不要写进发布包：

```text
plugin-state.json
plugin-storage.json
plugin-settings.json
```

## AI 写插件的流程

1. 先判断插件类型：命令工具、播放状态面板、曲库脚本、metadata provider、lyrics provider、cover provider、source provider、theme preset。
2. 选择 `apiVersion: 2`，除非用户明确维护旧插件。
3. 只申请当前功能必须的权限。
4. 写 `echo.plugin.json`，声明入口、权限和贡献点。
5. 写 `plugin.js`，真正注册命令、事件或 provider。manifest 只声明 UI 信息，不会自动注册逻辑。
6. 如果需要面板，再写 `panel.html`，通过 `plugin:runCommand` 调用插件命令。
7. 补一份插件自己的 `README.md`，说明用途、权限原因、第三方服务和调试方式。
8. 验收 manifest 路径、权限、返回值大小、超时和日志。

如果用户只是要“写一个插件”，不要直接改 ECHO 主程序源码。插件应放在真实插件目录或作为示例文件交付。只有当用户要求修改插件系统本身时，才改 `src/main/plugins`、`src/main/ipc`、`src/renderer/pages/PluginsPage.tsx` 等宿主代码。

## 面向新手用户时必须说清楚

用户不一定知道插件目录、manifest、入口脚本是什么意思。AI 生成插件时不要只给一段 `plugin.js`，而是按下面格式交付：

1. 先给文件树。
2. 再分别给 `echo.plugin.json`、`plugin.js`、可选 `panel.html`、`README.md`。
3. 明确告诉用户把整个插件文件夹放进 ECHO 插件页“打开目录”显示的 `plugins/` 目录。
4. 明确告诉用户回到插件页点击“刷新”。
5. 明确告诉用户启用插件时确认权限。
6. 明确告诉用户改完文件后点“重载”。
7. 明确告诉用户报错先看插件详情里的日志。

推荐输出模板：

```text
你会得到这个插件文件夹：

echo.my-plugin/
  echo.plugin.json
  plugin.js
  README.md

使用方法：
1. 打开 ECHO NEXT > Plugins > 打开目录。
2. 把 echo.my-plugin 整个文件夹放进去。
3. 回到 Plugins 页面点刷新。
4. 点开插件，确认权限，然后启用。
5. 如果修改了文件，保存后点重载。
6. 如果失败，打开插件日志，把错误复制出来。
```

给新手解释时使用普通话术：

| 概念 | 新手解释 |
| --- | --- |
| manifest | 插件说明书，告诉 ECHO 这个插件叫什么、要什么权限、入口文件是谁 |
| entry | 插件启动时运行的 JS 文件 |
| permission | 插件想做某件事前必须得到用户同意 |
| command | 用户手动点击运行的一段插件功能 |
| provider | 插件返回候选结果，ECHO 和用户决定是否采用 |
| panel | 插件自己的小界面，但它不能直接访问 `echo` |
| storage | 插件自己的小型 JSON 存储，不是任意文件读写 |

如果用户说“我不会写代码”，优先给最小命令插件或最小主题插件，不要直接生成 provider + panel + network 的复杂组合。

## 插件类型速查

| 用户需求 | 贡献点 | 注册 API | 权限 |
| --- | --- | --- | --- |
| 点按钮运行一个工具 | `commands` | `echo.commands.register` | 通常无，按实际 API 追加 |
| 展示当前播放 | `commands` / `panels` | `echo.events.on('playback:status')` 或 `echo.playback.getStatus` | `playback:read` |
| 控制播放 | `commands` / `panels` | `echo.playback.play/pause/stop/seek` | `playback:control` |
| 分页读曲库做统计 | `commands` | `echo.library.getSummary/getTracks` | `library:read` |
| 返回标签候选 | `metadataProviders` | `echo.metadata.registerProvider` | `library:read` |
| 返回歌词候选 | `lyricsProviders` | `echo.lyrics.registerProvider` | `library:read` |
| 返回封面候选 | `coverProviders` | `echo.covers.registerProvider` | `library:read` |
| 做插件音源搜索 | `sourceProviders` | `echo.sources.registerProvider` | `sources:provide` |
| 提供可导入主题 | `themePresets` | 不需要运行时注册 | 不需要权限 |
| 调第三方 HTTP API | 按功能声明 | `echo.net.fetchJson/fetchText` | `network` |
| 保存插件配置 | `settings` | `echo.settings.get/getAll/set` | v2 插件设置不需要 `settings:write` |
| 保存小型状态 | 无 | `echo.storage.get/set` | 不需要任意文件权限 |

## Manifest 模板

最小插件：

```json
{
  "id": "echo.my-plugin",
  "name": "My Plugin",
  "version": "0.0.1",
  "apiVersion": 2,
  "entry": "plugin.js",
  "permissions": []
}
```

带命令、面板、provider 和设置的插件：

```json
{
  "id": "echo.metadata-helper",
  "name": "Metadata Helper",
  "version": "0.1.0",
  "apiVersion": 2,
  "minEchoVersion": "26.6.1",
  "entry": "plugin.js",
  "panel": "panel.html",
  "permissions": ["library:read", "network"],
  "contributes": {
    "commands": [
      {
        "id": "lookup-current-track",
        "title": "Lookup current track"
      }
    ],
    "metadataProviders": [
      {
        "id": "tags",
        "title": "Metadata candidates"
      }
    ],
    "panels": [
      {
        "id": "main",
        "title": "Metadata Helper",
        "path": "panel.html"
      }
    ],
    "settings": [
      {
        "id": "provider-base-url",
        "title": "Provider URL",
        "type": "string",
        "defaultValue": "https://example.com/api"
      }
    ]
  }
}
```

Manifest 注意事项：

- `id` 必须是小写字母或数字开头，最多 64 字符，可含小写字母、数字、`.`、`_`、`-`。
- `entry` 只能是插件根目录内的 `.js` 文件名，不能写子目录。
- `panel` / `contributes.panels[].path` 只能是插件根目录内的 `.html` 文件名。
- 导入导出只处理插件根目录单文件，不递归子目录。
- 可导出的扩展名：`.js`、`.mjs`、`.cjs`、`.html`、`.css`、`.json`、`.md`、`.txt`。
- 贡献点里的 id 和 `plugin.js` 注册的 id 要一致。

主题预设插件是一个例外：它主要写 `contributes.themePresets`，不需要权限，也不需要 `plugin.js` 注册主题逻辑。启用插件后，主题会出现在“设置 > 外观”的插件主题区域，用户点击后会导入到“我的主题”再继续微调。

```json
{
  "id": "echo.aurora-theme",
  "name": "Aurora Theme",
  "version": "0.1.0",
  "apiVersion": 2,
  "entry": "plugin.js",
  "permissions": [],
  "contributes": {
    "themePresets": [
      {
        "id": "aurora-glass",
        "title": "Aurora Glass",
        "description": "Glass panels with cool backgrounds and a warm accent.",
        "basePreset": "classic",
        "preview": "linear-gradient(135deg, #08111f 0%, #183b56 48%, #f0b35b 100%)",
        "swatches": ["#08111f", "#183b56", "#f0b35b", "#e8f8ff"],
        "light": {
          "appBg": "#eef8ff",
          "panel": "#ffffff",
          "accent": "#257f96",
          "text": "#234150",
          "panelOpacityPercent": 78,
          "glassPercent": 26,
          "cornerRadiusPx": 10,
          "panelBlurPx": 18,
          "saturationPercent": 108
        },
        "dark": {
          "appBg": "#08111f",
          "panel": "#142234",
          "accent": "#5cc8dc",
          "text": "#c8dce8",
          "panelOpacityPercent": 72,
          "glassPercent": 34,
          "cornerRadiusPx": 10,
          "panelBlurPx": 22,
          "motionIntensityPercent": 90
        }
      }
    ]
  }
}
```

主题字段只接受结构化参数，不允许任意 CSS。颜色必须是 `#RRGGBB`，预览只能是纯色或 `linear-gradient(...)`，每个主题至少要有 `light` 或 `dark` 一组覆盖。

每个插件最多写 12 个主题。`light` / `dark` 可覆盖的颜色字段：`appBg`、`appBg2`、`appBg3`、`panel`、`panelSoft`、`accent`、`accentStrong`、`secondary`、`heading`、`text`、`muted`、`border`、`onAccent`、`buttonText`、`titlebar`、`sidebar`、`player`、`field`、`row`、`rowHover`、`rowActive`、`chip`、`focus`、`danger`、`success`、`warning`。

数值字段范围：`panelOpacityPercent` 40-100，`glassPercent` 0-80，`shadowPercent` 0-100，`cornerRadiusPx` 0-28，`panelBlurPx` 0-32，`saturationPercent` 60-140，`motionEnabled` 布尔值，`motionSpeedSeconds` 0.12-8，`motionIntensityPercent` 0-160。不要把数字写成布尔值或 CSS 字符串。

## `plugin.js` 运行边界

可用全局对象：

- `echo`
- `console.log` / `console.warn` / `console.error`
- `setTimeout`
- `clearTimeout`

不可用：

- `require`
- `import`
- `process`
- `window`
- `document`
- Node `fs` / `path` / `http`
- Electron、SQLite、主应用 DOM、音频 host、解码器、DSP、输出设备

不要在顶层做重 CPU 工作、网络请求或全库扫描。顶层只注册命令、事件和 provider，把实际工作放进 handler。

最小命令：

```js
console.log('plugin loaded');

echo.commands.register('hello', { title: 'Hello' }, async () => {
  await echo.ui.notify('Hello from plugin');
  return { ok: true };
});
```

## 权限最小化

权限不是“越多越强”，而是用户要承担的风险。AI 不要为了省事一次性申请所有权限。

| 权限 | 何时申请 |
| --- | --- |
| `playback:read` | 读取播放状态或监听 `playback:status` |
| `playback:control` | 主动播放、暂停、停止、跳转 |
| `library:read` | 读曲库、metadata/lyrics/cover provider |
| `sources:provide` | 注册自定义音源 provider |
| `network` | 用 `echo.net.fetchJson/fetchText` 访问 HTTP/HTTPS |
| `settings:read` | 仅维护 v1 旧插件读取应用设置时使用 |
| `settings:write` | 高风险；新插件不要用它写应用全局设置 |
| `fs:plugin` | 当前没有任意文件 API，优先用 `echo.storage` |
| `library:write` | 预留能力，当前不要申请 |

## 常用模式

### 分页读取曲库

```js
echo.commands.register('count-missing-album', { title: 'Count missing albums' }, async () => {
  let page = 1;
  let missing = 0;

  while (page <= 10) {
    const result = await echo.library.getTracks({
      page,
      pageSize: 100,
      fields: ['id', 'title', 'artist', 'album']
    });

    missing += result.items.filter((track) => !track.album).length;
    if (!result.hasMore) break;
    page += 1;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  await echo.ui.notify(`Missing album count: ${missing}`);
  return { missing, scannedPages: page };
});
```

不要一次拉完整曲库，不要在 `playback:status` 事件里跑曲库查询。

### Metadata provider

```js
echo.metadata.registerProvider('tags', { title: 'Metadata candidates' }, async ({ track }) => {
  if (!track.title || !track.artist) {
    return { candidates: [] };
  }

  return {
    candidates: [
      {
        title: track.title,
        artist: track.artist,
        album: track.album,
        genre: 'Alternative',
        confidence: 0.8,
        source: 'My Plugin'
      }
    ]
  };
});
```

Provider 返回候选，不直接写曲库。宿主决定是否展示、采用或缓存。

### 受控网络请求

```js
echo.metadata.registerProvider('remote-tags', { title: 'Remote tags' }, async ({ track }) => {
  const baseUrl = await echo.settings.get('provider-base-url');
  if (!baseUrl || !track.title) {
    return { candidates: [] };
  }

  const query = encodeURIComponent(`${track.artist || ''} ${track.title}`);
  const data = await echo.net.fetchJson(`${baseUrl}?q=${query}`);

  return {
    candidates: Array.isArray(data?.items)
      ? data.items.slice(0, 5).map((item) => ({
          title: String(item.title || track.title),
          artist: String(item.artist || track.artist || ''),
          album: String(item.album || ''),
          confidence: 0.6,
          source: 'Remote API'
        }))
      : []
  };
});
```

`plugin.js` 访问网络必须走 `echo.net`。它只支持受控 `GET` / `POST`、有限 header、超时和响应大小限制。不要在 `plugin.js` 里使用 `fetch`、`XMLHttpRequest`、`require('http')`，也不要偷偷把 token 写死在代码里。

### Source provider

```js
const tracks = [
  {
    providerTrackId: 'demo-stream',
    title: 'Demo Stream',
    artist: 'ECHO Plugin',
    playable: true,
    source: 'Demo',
    url: 'https://example.com/audio/demo.mp3'
  }
];

echo.sources.registerProvider('direct-url', { title: 'Direct URL Demo' }, {
  search: async ({ query }) => {
    const needle = String(query || '').toLowerCase();
    return {
      tracks: tracks
        .filter((track) => !needle || `${track.title} ${track.artist}`.toLowerCase().includes(needle))
        .map(({ url, ...track }) => track),
      total: tracks.length,
      hasMore: false
    };
  },
  resolvePlayback: async ({ providerTrackId }) => {
    const track = tracks.find((item) => item.providerTrackId === providerTrackId);
    if (!track) {
      throw new Error('plugin_source_track_not_found');
    }
    return {
      url: track.url,
      mimeType: 'audio/mpeg',
      supportsRange: true
    };
  }
});
```

搜索阶段只返回候选，播放阶段才返回显式 `http` / `https` 音频 URL。不要把插件做成解码器、DSP 或输出设备。

## 面板写法

`panel.html` 没有 `echo` 对象。面板要做有权限的事，先在 `plugin.js` 注册命令，再通过 bridge 调用：

```html
<!doctype html>
<meta charset="utf-8">
<button id="run">Run</button>
<pre id="output">Ready</pre>
<script>
const pluginId = 'echo.my-plugin';
const channel = 'echo:plugin-panel';
const pending = new Map();
const output = document.getElementById('output');

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.channel !== channel || message.type !== 'response') return;
  const resolve = pending.get(message.requestId);
  if (!resolve) return;
  pending.delete(message.requestId);
  resolve(message);
});

function requestHost(action, payload) {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random()}`;
    pending.set(requestId, resolve);
    parent.postMessage({ channel, version: 1, type: 'request', requestId, pluginId, action, payload }, '*');
  });
}

document.getElementById('run').addEventListener('click', async () => {
  const response = await requestHost('plugin:runCommand', {
    commandId: 'hello',
    args: []
  });
  output.textContent = JSON.stringify(response, null, 2);
});
</script>
```

可用 panel action：

- `plugin:getSummary`
- `plugin:getLogs`
- `plugin:runCommand`

## 性能与安全限制

AI 生成代码时要主动遵守这些限制：

- 命令约 2 秒超时。
- 事件 handler 约 2 秒超时。
- provider 约 2.5 秒超时。
- 网络请求默认约 5 秒超时。
- 单插件最多 8 个 metadata provider、4 个 source provider、4 个 lyrics provider、4 个 cover provider。
- 单插件最多 12 个 theme preset。
- 单次 source 搜索最多返回 25 首。
- 单次 metadata 最多 5 个候选，lyrics 最多 5 个候选，cover 最多 8 个候选。
- 曲库 `pageSize` 最大 100。
- command args 最大约 64 KB，结果最大约 256 KB。
- storage 单 key 最大约 64 KB，总量约 256 KB。
- 不要保存图片二进制、大批歌词、整页曲库或长日志。

## AI 常见错误清单

生成前逐项检查：

- 是否用了 `apiVersion: 2`。
- manifest `permissions` 是否最小。
- manifest 贡献点和 `plugin.js` 注册 id 是否一致。
- 如果是 `themePresets`，是否没有申请无关权限、没有尝试注入 CSS，且至少提供了 `light` 或 `dark`。
- 是否在 `plugin.js` 中误用了 `require`、`import`、`process`、`fetch`、`window`、`document`。
- 是否在 `plugin.js` 顶层做了网络、全库扫描或重 CPU 工作。
- 是否把 `panel.html` 当成可以直接调用 `echo`。
- 面板里的 `pluginId` 是否和 manifest 完全一致。
- provider 是否返回候选，而不是直接写曲库。
- source provider 是否只返回 `http` / `https` 音频 URL。
- 曲库读取是否分页且 `pageSize <= 100`。
- 网络代码是否通过 `echo.net`，并声明了 `network` 权限。
- 是否硬编码了 token、cookie、本机绝对路径或用户隐私。
- 是否依赖子目录资源。当前插件包导入导出不递归子目录。
- 是否有清晰的 `console.log/warn/error` 方便插件页排查。

## 推荐交付格式

当你给用户生成一个插件，优先交付这些文件：

```text
echo.my-plugin/
  echo.plugin.json
  plugin.js
  panel.html
  README.md
  echo-plugin.d.ts
  jsconfig.json
```

`echo-plugin.d.ts` 可从 `docs/plugin-sdk/echo-plugin.d.ts` 复制，`jsconfig.json` 可写成：

```json
{
  "compilerOptions": {
    "checkJs": true,
    "types": ["./echo-plugin"]
  }
}
```

最后告诉用户：把插件文件夹放进 ECHO 插件页打开的 `plugins/` 目录，刷新，确认权限，再启用。出错先看插件页日志。
