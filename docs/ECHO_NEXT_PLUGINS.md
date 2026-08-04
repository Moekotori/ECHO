# ECHO Next 插件创作指南

适用范围：ECHO Next 本地插件系统，当前宿主支持 `apiVersion` 1 和 2，推荐新插件使用 `apiVersion: 2`。

这份文档写给插件作者。目标不是教插件突破宿主限制，而是教你在 ECHO 的安全边界内做出稳定、轻量、不会拖慢播放的扩展。

如果你正在让 AI 帮你写插件，建议先把 [ForAIReadme](./plugin-sdk/ForAIReadme.md) 发给它。那份文档把插件类型、权限、manifest、运行边界和 AI 常见错误整理成了更适合模型执行的清单。

## 一句话模型

ECHO 插件是放在用户数据目录 `plugins/` 下的本地文件夹。宿主读取 `echo.plugin.json`，在受控 VM 沙箱里运行 `plugin.js`，按用户确认的权限暴露一个有限的全局 `echo` API，并把 `panel.html` 当作 sandbox iframe 显示。

插件可以做：

- 注册命令，让用户手动运行小工具。
- 读取当前播放状态，做轻量记录或展示。
- 分页读取曲库公开字段。
- 返回元数据、歌词、封面候选，交给宿主和用户决定是否采用。
- 提供自定义音源搜索候选，并在用户触发播放时返回显式 `http` / `https` 音频 URL。
- 使用插件自己的设置、存储、日志和面板。
- 在 `apiVersion: 2` 下通过宿主受控网络 API 访问 `http` / `https`。

插件不能做：

- 直接访问 Node、Electron、SQLite、主应用 DOM、原生音频 host、解码器、DSP 或输出设备。
- Hook 播放热路径、修改音频 buffer、控制 WASAPI/ASIO/native host 细节。
- 任意读写本机文件。
- 自动写入曲库记录或改源音频文件。
- 后台全库扫描、持续高频轮询、长时间同步阻塞。

ECHO 的核心原则是：插件能扩展体验，但不能牺牲播放稳定性。

## 快速开始

1. 打开 ECHO 的“插件”页面。
2. 点“打开目录”，进入真实插件目录。目录通常是 Electron `userData/plugins`，不要硬猜路径，以插件页打开的目录为准。
3. 点一个示例插件，例如“播放状态面板”“命令工具”“曲库脚本”或“自定义音源”。
4. 编辑示例目录里的 `echo.plugin.json`、`plugin.js`、`panel.html`。
5. 回到插件页点“刷新”或“重载”。
6. 启用插件时确认权限。
7. 出错先看插件页里的日志，再缩小权限和代码。

## 零基础照着做第一个插件

这一节按“完全没写过 ECHO 插件”的用户来写。你只要会新建文件、复制文本、保存文件，就能先跑起来一个插件。

### 你需要准备什么

| 工具 | 用来做什么 |
| --- | --- |
| ECHO NEXT | 打开插件页面、创建示例、启用插件、看日志 |
| 一个文本编辑器 | 记事本也行，VS Code 更舒服 |
| 一个小音乐库 | 用来测试播放状态、曲库读取、provider 结果 |

不要一上来就改 ECHO 主程序源码。普通插件只需要放进 ECHO 打开的 `plugins/` 目录里。

### 第 1 步：找到插件目录

1. 打开 ECHO NEXT。
2. 进入 `Plugins` / “插件”页面。
3. 点击“打开目录”。
4. 系统会打开一个文件夹，这就是插件目录。
5. 以后所有插件文件夹都放在这里。

不要自己猜路径。不同系统、便携版、开发版的用户数据目录可能不一样，以 ECHO 打开的目录为准。

### 第 2 步：新建插件文件夹

在刚才打开的插件目录里，新建一个文件夹：

```text
echo.hello-plugin
```

文件夹名建议和插件 id 一样。插件 id 只能用小写字母、数字、`.`、`_`、`-`，并且要用小写字母或数字开头。新手直接照这个格式写：

```text
echo.你的插件名
```

例如：

```text
echo.my-tool
echo.playback-note
echo.aurora-theme
```

### 第 3 步：写 `echo.plugin.json`

进入 `echo.hello-plugin` 文件夹，新建文件：

```text
echo.plugin.json
```

把下面内容完整复制进去：

```json
{
  "id": "echo.hello-plugin",
  "name": "Hello Plugin",
  "version": "0.0.1",
  "apiVersion": 2,
  "entry": "plugin.js",
  "permissions": [],
  "contributes": {
    "commands": [
      {
        "id": "hello",
        "title": "Hello"
      }
    ]
  }
}
```

这个文件告诉 ECHO：

| 字段 | 你现在先这样理解 |
| --- | --- |
| `id` | 插件的唯一名字，不能和别的插件重复 |
| `name` | 插件页面显示给人看的名字 |
| `version` | 插件版本，先写 `0.0.1` |
| `apiVersion` | 新插件写 `2` |
| `entry` | 插件启动时执行哪个 JS 文件 |
| `permissions` | 插件要什么权限；这个 Hello 插件不需要权限 |
| `contributes.commands` | 告诉 UI：这个插件有一个叫 `hello` 的命令 |

### 第 4 步：写 `plugin.js`

同一个文件夹里再新建文件：

```text
plugin.js
```

把下面内容完整复制进去：

```js
console.log('hello plugin loaded');

echo.commands.register('hello', { title: 'Hello' }, async () => {
  await echo.ui.notify('Hello from ECHO plugin');
  return { ok: true, message: 'Hello from ECHO plugin' };
});
```

这段代码做了三件事：

1. 插件启动时写一条日志。
2. 注册一个叫 `hello` 的命令。
3. 用户运行命令时，发一个通知，并返回一段 JSON。

注意：`echo.plugin.json` 里的命令 id 和 `plugin.js` 里的命令 id 必须一样。这里都叫 `hello`。

### 第 5 步：确认文件结构

现在你的插件目录应该长这样：

```text
plugins/
  echo.hello-plugin/
    echo.plugin.json
    plugin.js
```

如果文件名写成下面这样，ECHO 可能找不到：

```text
echo.plugin.json.txt
plugin.js.txt
Echo.Plugin.Json
Plugin.JS
```

Windows 记事本容易把文件保存成 `.txt`。如果你看不到扩展名，先在资源管理器里打开“显示文件扩展名”。

### 第 6 步：回到 ECHO 刷新

1. 回到 ECHO 的插件页面。
2. 点击“刷新”。
3. 你应该能看到 `Hello Plugin`。
4. 如果看不到，先检查文件夹名、`echo.plugin.json` 文件名、JSON 逗号有没有写错。

### 第 7 步：启用插件

1. 点开 `Hello Plugin`。
2. 点击“启用”。
3. 这个插件没有权限，所以不需要额外信任危险权限。
4. 启用后看插件日志，应该有 `hello plugin loaded`。

如果启用时报错，先看插件详情里的日志。ECHO 会把启动错误写在那里。

### 第 8 步：运行命令

插件启用后，在插件详情里找到命令 `Hello`，点击运行。你应该看到：

- 插件通知：`Hello from ECHO plugin`
- 日志里有命令运行记录。

到这里，第一个插件已经成功了。

### 第 9 步：修改插件后怎么生效

你改了 `plugin.js` 或 `echo.plugin.json` 之后：

1. 保存文件。
2. 回到插件页面。
3. 点击这个插件的“重载”。
4. 如果改了 manifest 但页面没变，点击“刷新”。

不要一边改文件一边期待 ECHO 自动立刻发现。插件系统当前按“刷新/重载”更新。

## 最小主题插件

如果你只是想做主题，不需要写复杂 JS。主题插件主要写 manifest，`plugin.js` 可以只放一行日志。

文件结构：

```text
plugins/
  echo.simple-theme/
    echo.plugin.json
    plugin.js
```

`echo.plugin.json`：

```json
{
  "id": "echo.simple-theme",
  "name": "Simple Theme",
  "version": "0.0.1",
  "apiVersion": 2,
  "entry": "plugin.js",
  "permissions": [],
  "contributes": {
    "themePresets": [
      {
        "id": "simple-blue",
        "title": "Simple Blue",
        "description": "一个最小主题示例。",
        "basePreset": "classic",
        "preview": "linear-gradient(135deg, #10243a 0%, #5cc8dc 100%)",
        "swatches": ["#10243a", "#5cc8dc", "#ffffff"],
        "light": {
          "appBg": "#eef8ff",
          "panel": "#ffffff",
          "accent": "#257f96",
          "text": "#234150"
        },
        "dark": {
          "appBg": "#08111f",
          "panel": "#142234",
          "accent": "#5cc8dc",
          "text": "#c8dce8"
        }
      }
    ]
  }
}
```

`plugin.js`：

```js
console.log('simple theme plugin loaded');
```

启用插件后，进入 `Settings` / “设置” > “外观”，找到“插件主题”，点击主题卡片。ECHO 会把它导入到“我的主题”，之后你还可以继续微调颜色、透明度、圆角和动效。

主题插件常见错误：

| 错误 | 结果 | 正确写法 |
| --- | --- | --- |
| 颜色写 `red` | 会被忽略 | 写 `#ff0000` |
| 颜色写 `#fff` | 会被忽略 | 写 6 位 `#ffffff` |
| 写任意 CSS | 不会生效 | 只写结构化字段 |
| 没有 `light` 也没有 `dark` | 主题会被丢弃 | 至少写一组 |
| `preview` 里写 `url(...)` | 预览会被丢弃 | 只用纯色或 `linear-gradient(...)` |

## 不知道该做哪种插件时先看这里

| 你想做什么 | 先做成什么插件 | 需要权限吗 |
| --- | --- | --- |
| 点一下按钮，弹个提示或保存一点小状态 | 命令插件 | 通常不需要 |
| 显示当前播放状态 | 命令或面板插件 | `playback:read` |
| 控制播放、暂停、跳转 | 命令或面板插件 | `playback:control` |
| 统计曲库里有多少歌缺标签 | 命令插件 | `library:read` |
| 给歌曲提供候选标签 | Metadata Provider | `library:read` |
| 给歌曲提供候选歌词 | Lyrics Provider | `library:read` |
| 给歌曲提供候选封面 | Cover Provider | `library:read` |
| 分析无损/DSD 可信度 | Command 或 Panel + Command | `library:read` + `audio:analyze` |
| 接入一个第三方音乐搜索源 | Source Provider | `sources:provide`，可能还要 `network` |
| 做一个可导入主题 | Theme Preset | 不需要 |
| 做一个复杂界面 | Panel + Command | 按命令实际用到的 API 申请 |

新手建议顺序：

1. 先做命令插件。
2. 再做主题插件。
3. 再做读取曲库的命令。
4. 再做 provider。
5. 最后再做面板。

## 让 AI 帮你写插件时怎么说

你可以直接把下面这段发给 AI，然后把你的需求补进去：

```text
请按 ECHO Next 插件系统写一个本地插件。
先阅读 docs/ECHO_NEXT_PLUGINS.md 和 docs/plugin-sdk/ForAIReadme.md。
不要修改 ECHO 主程序源码，只生成插件文件夹内的文件。
使用 apiVersion: 2。
权限最小化，不要申请无关权限。
插件目录名和 id 使用 echo.my-plugin 这种格式。
需要提供 echo.plugin.json、plugin.js、README.md。
如果需要面板，再提供 panel.html，并通过 plugin:runCommand 调用命令。
不要使用 require/import/process/window/document/fetch。
网络访问必须通过 echo.net，并声明 network 权限。
我的需求是：在这里写你的需求。
```

如果 AI 生成了代码，你要检查：

- 它有没有让你改 `src/main/...` 或 `src/renderer/...`。普通插件不应该改这些。
- 它有没有写 `require`、`import`、`process`、`window`、`document`、`fetch`。
- 它有没有一次申请很多权限。
- 它有没有告诉你把文件放进 ECHO 插件页打开的目录。
- 它有没有写清楚怎么刷新、启用、看日志。

## 常见新手错误

| 现象 | 最可能原因 | 怎么修 |
| --- | --- | --- |
| 插件页看不到插件 | 文件夹没放进插件目录，或 `echo.plugin.json` 文件名错 | 点“打开目录”，确认结构 |
| 插件显示 manifest 错误 | JSON 少逗号、多逗号、引号错 | 用 JSON 校验器检查 |
| 启用后立刻报错 | `plugin.js` 顶层代码抛错 | 看插件日志，先删到最小代码 |
| 命令不出现 | manifest 里声明了，但 `plugin.js` 没注册 | `contributes.commands[].id` 和 `echo.commands.register` 保持一致 |
| 命令点击没反应 | handler 抛错或超时 | 看日志，减少代码，先返回 `{ ok: true }` |
| 权限不足 | manifest 没写对应权限，或启用时没信任 | 补权限，刷新，再重新启用 |
| 面板里找不到 `echo` | 面板本来就没有 `echo` | 面板用 `postMessage` 调 `plugin:runCommand` |
| 网络请求失败 | 用了 `fetch` 或没申请 `network` | 用 `echo.net.fetchJson/fetchText` |
| 曲库读取很慢 | 一次读太多 | 分页，`pageSize <= 100` |
| 导出包里带了缓存 | 手动塞了 `plugin-storage.json` | 删除运行缓存再发布 |

插件目录推荐形态：

```text
plugins/
  echo.my-plugin/
    echo.plugin.json
    plugin.js
    panel.html
    README.md
    echo-plugin.d.ts
```

运行中可能出现这些宿主文件：

```text
plugins/
  plugin-state.json
  echo.my-plugin/
    plugin-storage.json
    plugin-settings.json
```

这些文件是运行状态，不应当手动写入发布包。ECHO 导出插件包时也会排除它们。

## 文件职责

| 文件 | 是否必需 | 作用 |
| --- | --- | --- |
| `echo.plugin.json` | 必需 | 插件 manifest，声明 id、版本、入口、权限和贡献点 |
| `plugin.js` | 通常必需 | 插件入口脚本，在受控 VM 沙箱运行 |
| `panel.html` | 可选 | 插件面板，作为 sandbox iframe 显示 |
| `echo-plugin.d.ts` | 可选 | SDK 类型提示，来自 `docs/plugin-sdk/echo-plugin.d.ts` |
| `README.md` | 可选 | 给自己或用户看的说明 |
| `.css` / `.txt` / `.json` | 可选 | 静态资源或配置，导出包只支持根目录单文件 |

当前导入导出只处理插件根目录下的单文件，不递归子目录。可导出的扩展名是 `.js`、`.mjs`、`.cjs`、`.html`、`.css`、`.json`、`.md`、`.txt`。

## 编辑器类型提示

如果你用 VS Code 或支持 JS 类型检查的编辑器，可以把仓库的 SDK 类型复制到插件目录：

```text
docs/plugin-sdk/echo-plugin.d.ts -> plugins/echo.my-plugin/echo-plugin.d.ts
```

再放一个 `jsconfig.json`：

```json
{
  "compilerOptions": {
    "checkJs": true,
    "types": ["./echo-plugin"]
  }
}
```

这样 `plugin.js` 里访问 `echo.playback.getStatus()`、`echo.metadata.registerProvider()` 等 API 时会有提示。

## Manifest 基础

最小插件：

```json
{
  "id": "echo.my-plugin",
  "name": "我的插件",
  "version": "0.0.1",
  "apiVersion": 2,
  "entry": "plugin.js",
  "permissions": []
}
```

带面板、命令、provider 和插件设置的完整形态：

```json
{
  "id": "echo.metadata-helper",
  "name": "Metadata Helper",
  "version": "0.1.0",
  "apiVersion": 2,
  "minEchoVersion": "26.5.29",
  "entry": "plugin.js",
  "panel": "panel.html",
  "permissions": ["library:read", "network"],
  "contributes": {
    "commands": [
      {
        "id": "lookup-current-track",
        "title": "查询当前曲目"
      }
    ],
    "metadataProviders": [
      {
        "id": "tags",
        "title": "标签候选"
      }
    ],
    "lyricsProviders": [
      {
        "id": "lyrics",
        "title": "歌词候选"
      }
    ],
    "coverProviders": [
      {
        "id": "covers",
        "title": "封面候选"
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
      },
      {
        "id": "enable-extra-lookup",
        "title": "Extra lookup",
        "type": "boolean",
        "defaultValue": false
      }
    ]
  }
}
```

字段说明：

| 字段 | 规则 |
| --- | --- |
| `id` | 插件唯一 id，2 到 64 个字符，小写字母或数字开头，可含小写字母、数字、`.`、`_`、`-` |
| `name` | 显示名称，最多约 80 字符 |
| `version` | 插件版本字符串，最多约 40 字符 |
| `apiVersion` | 当前支持 1 到 2，新插件推荐 2 |
| `minEchoVersion` | 可选，仅作为兼容性展示和作者提示 |
| `entry` | 入口脚本文件名，必须是插件根目录内 `.js` 文件，不能写子目录 |
| `panel` | 可选面板文件名，必须是插件根目录内 `.html` 文件 |
| `permissions` | 插件请求权限，用户启用时确认 |
| `contributes.commands` | 插件命令声明，UI 可以展示 |
| `contributes.panels` | 面板入口声明 |
| `contributes.metadataProviders` | 元数据候选 provider |
| `contributes.sourceProviders` | 自定义音源 provider |
| `contributes.lyricsProviders` | 歌词候选 provider |
| `contributes.coverProviders` | 封面候选 provider |
| `contributes.themePresets` | 可导入的自定义主题预设 |
| `contributes.settings` | 插件自己的设置表单 |

注意：manifest 里的贡献点用于展示和声明。真正可运行的命令/provider 仍然要在 `plugin.js` 里注册。

## 主题预设

插件可以通过 `contributes.themePresets` 声明可导入的主题。主题贡献不需要权限，也不需要在 `plugin.js` 里注册逻辑；启用插件后，它会出现在“设置 > 外观”的插件主题区域。用户点击后，ECHO 会把它导入到“我的主题”，之后仍可继续微调、导出或删除。

主题插件只能提供结构化主题参数，不能注入任意 CSS。颜色只接受 `#RRGGBB`，数值会被宿主夹在安全范围内，`preview` 只接受纯色或 `linear-gradient(...)` 预览。每个主题至少要提供 `light` 或 `dark` 其中一组覆盖。

每个插件最多贡献 12 个主题。`light` / `dark` 可覆盖的颜色字段包括 `appBg`、`appBg2`、`appBg3`、`panel`、`panelSoft`、`accent`、`accentStrong`、`secondary`、`heading`、`text`、`muted`、`border`、`onAccent`、`buttonText`、`titlebar`、`sidebar`、`player`、`field`、`row`、`rowHover`、`rowActive`、`chip`、`focus`、`danger`、`success`、`warning`。

可覆盖的数值字段：`panelOpacityPercent` 40-100，`glassPercent` 0-80，`shadowPercent` 0-100，`cornerRadiusPx` 0-28，`panelBlurPx` 0-32，`saturationPercent` 60-140，`motionEnabled` 布尔值，`motionSpeedSeconds` 0.12-8，`motionIntensityPercent` 0-160。

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
        "description": "高透明玻璃、冷色背景和暖色强调。",
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

## API 版本选择

推荐直接使用 `apiVersion: 2`。

`apiVersion: 1` 的行为：

- `echo.settings.get()` 读取应用设置快照。
- `echo.settings.set(patch)` 写应用设置 patch，需要 `settings:write`，风险高。
- `echo.net` 不可用。
- 仍兼容早期示例插件。

`apiVersion: 2` 的行为：

- `echo.settings.get(key)` / `getAll()` / `set(...)` 只读写本插件自己的设置，不再写全局应用设置。
- `echo.net.fetchJson()` / `fetchText()` 可用，但必须声明并被用户信任 `network` 权限。
- 可以声明 `lyricsProviders`、`coverProviders`、`settings`。

除非你在维护旧插件，否则不要用 v1 写应用全局设置。新插件的配置应放在 `contributes.settings` 里。

## 权限设计

插件默认禁用。启用时用户必须确认 manifest 里请求的所有权限。缺少信任权限时，API 会抛出 `plugin_permission_denied:*`。

| 权限 | 状态 | 风险 | 说明 |
| --- | --- | --- | --- |
| `playback:read` | 已开放 | 低 | 读取当前播放状态、曲目 id、进度、音频状态快照 |
| `playback:control` | 已开放 | 中 | 播放、暂停、停止、跳转 |
| `library:read` | 已开放 | 中 | 分页读取曲库摘要和公开曲目字段，也用于 metadata、lyrics、cover provider |
| `sources:provide` | 已开放 | 中 | 注册自定义音源搜索和播放解析 |
| `settings:read` | 已开放 | 中 | v1 读取应用设置；v2 插件设置不需要它 |
| `settings:write` | 已开放 | 高 | v1 写应用设置 patch；新插件尽量不要申请 |
| `audio:analyze` | 已开放 | 高 | 通过宿主受控 API 按曲库 `trackId` 分析无损/DSD 可信度，不开放任意文件或进程执行 |
| `network` | 已开放 | 高 | v2 通过宿主受控 API 访问 `http` / `https` |
| `fs:plugin` | 受限 | 中 | 不开放任意文件 API，插件存储请用 `echo.storage` |
| `library:write` | 预留 | 高 | 当前不提供实际曲库写入 API |

权限最小化建议：

- 只展示播放状态：只申请 `playback:read`。
- 控制播放：再加 `playback:control`。
- 做曲库统计、元数据、歌词、封面候选：申请 `library:read`。
- 做自定义音源：申请 `sources:provide`。
- 访问第三方 API：使用 `apiVersion: 2` 并申请 `network`。
- 不要为了“以后可能用”提前申请高风险权限。

## `plugin.js` 运行环境

`plugin.js` 在 Node `vm` 沙箱中运行，但不是普通 Node 脚本。

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
- Node 文件系统、网络、数据库、Electron 模块

入口脚本同步启动阶段最多运行约 1 秒。不要在文件顶层做重 CPU 工作。网络、曲库查询、批处理都应放进命令或 provider handler 里，并保持短小。

最小入口：

```js
console.log('plugin loaded');

echo.commands.register('hello', { title: 'Hello' }, async () => {
  await echo.ui.notify('Hello from plugin');
  return { ok: true };
});
```

## 公开 API 总览

| API | 权限 | 用途 |
| --- | --- | --- |
| `echo.events.on(eventName, handler)` | 视事件而定 | 监听宿主事件 |
| `echo.commands.register(id, options, handler)` | 无固定权限 | 注册可由宿主或面板触发的命令 |
| `echo.playback.getStatus()` | `playback:read` | 获取播放状态 |
| `echo.playback.play/pause/stop/seek()` | `playback:control` | 控制播放 |
| `echo.library.getSummary()` | `library:read` | 获取曲库摘要 |
| `echo.library.getTracks(query)` | `library:read` | 分页读取公开曲目字段 |
| `echo.audio.analyzeTrack(trackId)` | `audio:analyze` | 请求宿主按曲库 `trackId` 返回音频可信度报告 |
| `echo.metadata.registerProvider(...)` | `library:read` | 返回元数据候选 |
| `echo.lyrics.registerProvider(...)` | `library:read` | 返回歌词候选 |
| `echo.covers.registerProvider(...)` | `library:read` | 返回封面候选 |
| `echo.sources.registerProvider(...)` | `sources:provide` | 返回音源候选和播放 URL |
| `echo.settings.get/getAll/set` | v2 为插件设置 | 读写插件自己的设置 |
| `echo.net.fetchJson/fetchText` | `network` + v2 | 宿主受控网络请求 |
| `echo.storage.get/set` | 无任意 FS | 读写插件自己的小型 JSON 存储 |
| `echo.ui.notify(message)` | 无固定权限 | 写插件日志通知 |

## 事件

当前开放事件：

| 事件 | 权限 | 频率与含义 |
| --- | --- | --- |
| `playback:status` | `playback:read` | 播放状态合并推送，约 500ms 节流，也就是最多约 2Hz |
| `library:changed` | `library:read` | 曲库变化信号，payload 不保证长期稳定，只当刷新信号用 |

示例：

```js
const unsubscribe = echo.events.on('playback:status', async (status) => {
  await echo.storage.set('lastStatus', {
    state: status.state,
    trackId: status.currentTrackId,
    positionSeconds: Math.round(status.positionSeconds || 0)
  });
});

echo.commands.register('stop-listening', { title: '停止监听' }, () => {
  unsubscribe();
});
```

事件 handler 最多约 2 秒，超时会记录 `plugin_event_handler_timeout`。不要在 `playback:status` 里做网络请求、全库查询或大 JSON 写入。

## 命令

命令适合用户手动触发的动作，例如“记录当前播放”“查询当前曲目”“导出一个小摘要”。

```js
echo.commands.register('copy-now-playing', { title: '记录当前播放' }, async () => {
  const status = await echo.playback.getStatus();
  await echo.storage.set('lastCommandResult', {
    trackId: status.currentTrackId,
    state: status.state,
    savedAt: new Date().toISOString()
  });
  await echo.ui.notify('已记录当前播放状态。');
  return { ok: true };
});
```

命令限制：

- 参数 JSON 最大约 64 KB。
- 返回 JSON 最大约 256 KB。
- 执行超时约 2 秒。
- 失败会写入插件日志。

如果任务超过 2 秒，应拆成多次手动命令，或只返回“已排队”的轻量结果。当前插件系统不适合做长驻后台任务。

## 播放状态与播放控制

读取状态：

```js
const status = await echo.playback.getStatus();
console.log(status.state, status.currentTrackId, status.positionSeconds);
```

控制播放：

```js
await echo.playback.pause();
await echo.playback.seek(60);
await echo.playback.play();
```

播放控制是中风险能力。插件不要自动根据高频事件连续 `seek()` 或 `play/pause()`，否则会破坏用户操作和播放稳定性。

## 曲库读取

曲库 API 永远要分页。

```js
const page = await echo.library.getTracks({
  page: 1,
  pageSize: 50,
  search: 'artist or title',
  sort: 'recent',
  sourceProvider: 'local',
  fields: ['id', 'title', 'artist', 'album', 'duration', 'coverThumb']
});
```

限制：

- `pageSize` 最大 100，默认 50。
- `search` 最大约 120 字符。
- 默认字段：`id`、`mediaType`、`path`、`title`、`artist`、`album`、`duration`、`coverThumb`、`unavailable`。
- 可选字段以 `docs/plugin-sdk/echo-plugin.d.ts` 和 `src/shared/types/plugins.ts` 为准。

分页批处理建议：

```js
echo.commands.register('count-missing-album', { title: '统计缺少专辑的曲目' }, async () => {
  let page = 1;
  let missing = 0;

  while (page <= 20) {
    const result = await echo.library.getTracks({
      page,
      pageSize: 100,
      fields: ['id', 'title', 'album']
    });

    missing += result.items.filter((track) => !track.album).length;
    if (!result.hasMore) break;
    page += 1;

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  await echo.ui.notify(`前 ${page} 页里有 ${missing} 首缺少专辑。`);
  return { missing, scannedPages: page };
});
```

不要一次拉完整曲库。大型曲库会跨进程传输大量 JSON，影响 UI 和播放响应。

## 元数据 Provider

Metadata Provider 返回候选标签，不直接写曲库。宿主会裁剪字段、展示候选，并由用户决定是否采用。

Manifest：

```json
{
  "permissions": ["library:read"],
  "contributes": {
    "metadataProviders": [
      { "id": "tags", "title": "标签候选" }
    ]
  }
}
```

`plugin.js`：

```js
echo.metadata.registerProvider('tags', { title: '标签候选' }, async ({ track }) => {
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
        year: 2026,
        confidence: 0.8,
        source: 'My Plugin',
        sourceUrl: 'https://example.com'
      }
    ]
  };
});
```

候选字段：

- `title`
- `artist`
- `album`
- `albumArtist`
- `genre`
- `year`
- `trackNo`
- `discNo`
- `bpm`
- `confidence`，范围 0 到 1
- `source`
- `sourceUrl`

限制：

- 单插件最多 8 个 metadata provider。
- 单 provider 每次最多 5 个候选。
- 请求最大约 32 KB，返回最大约 64 KB。
- provider 超时约 2.5 秒。
- 不返回二进制封面，不写文件，不写 SQLite。

## 歌词 Provider

歌词 Provider 返回歌词候选，宿主决定是否预览、应用或缓存。

Manifest：

```json
{
  "apiVersion": 2,
  "permissions": ["library:read"],
  "contributes": {
    "lyricsProviders": [
      { "id": "lyrics", "title": "歌词候选" }
    ]
  }
}
```

`plugin.js`：

```js
echo.lyrics.registerProvider('lyrics', { title: '歌词候选' }, async ({ track }) => {
  if (!track.title) {
    return { candidates: [] };
  }

  return {
    candidates: [
      {
        title: track.title,
        language: 'zh',
        lrc: '[00:00.00]示例歌词',
        source: 'My Lyrics Provider',
        confidence: 0.7
      }
    ]
  };
});
```

候选字段：

- `title`
- `language`
- `lrc`
- `text`
- `source`
- `sourceUrl`
- `confidence`

限制：

- 单插件最多 4 个 lyrics provider。
- 单 provider 每次最多 5 个候选。
- `lrc` / `text` 会被裁剪到约 80 KB。
- 请求最大约 32 KB，返回最大约 128 KB。
- provider 超时约 2.5 秒。

## 封面 Provider

Cover Provider 返回图片 URL 候选。候选必须是 `http` / `https` 图片 URL，宿主负责后续缓存、裁剪、写库决策。

Manifest：

```json
{
  "apiVersion": 2,
  "permissions": ["library:read"],
  "contributes": {
    "coverProviders": [
      { "id": "covers", "title": "封面候选" }
    ]
  }
}
```

`plugin.js`：

```js
echo.covers.registerProvider('covers', { title: '封面候选' }, async ({ track }) => {
  if (!track.album && !track.title) {
    return { candidates: [] };
  }

  return {
    candidates: [
      {
        imageUrl: 'https://example.com/cover.jpg',
        title: track.album || track.title,
        source: 'My Cover Provider',
        width: 1200,
        height: 1200,
        confidence: 0.75
      }
    ]
  };
});
```

限制：

- 单插件最多 4 个 cover provider。
- 单 provider 每次最多 8 个候选。
- `imageUrl` 必须是 `http` / `https`。
- 请求最大约 32 KB，返回最大约 128 KB。
- provider 超时约 2.5 秒。

## 自定义音源 Provider

Source Provider 用于“插件音源”。它只返回搜索候选，并在用户触发播放时解析成显式音频 URL。

它不是远程库同步 provider，也不能写入远程曲库、DSP、解码器或输出链路。

Manifest：

```json
{
  "apiVersion": 2,
  "permissions": ["sources:provide"],
  "contributes": {
    "sourceProviders": [
      { "id": "direct-url", "title": "Direct URL Demo" }
    ]
  }
}
```

`plugin.js`：

```js
const demoTracks = [
  {
    providerTrackId: 'demo-stream',
    title: 'Demo stream',
    artist: 'Local plugin',
    album: 'Custom source',
    duration: null,
    playable: true,
    source: 'Direct URL Demo',
    url: 'https://example.com/audio/demo.mp3'
  }
];

echo.sources.registerProvider('direct-url', { title: 'Direct URL Demo' }, {
  search: async ({ query }) => {
    const needle = String(query || '').toLowerCase();
    return {
      tracks: demoTracks
        .filter((track) => !needle || `${track.title} ${track.artist}`.toLowerCase().includes(needle))
        .map(({ url, ...track }) => track),
      total: demoTracks.length,
      hasMore: false
    };
  },
  resolvePlayback: async ({ providerTrackId }) => {
    const track = demoTracks.find((item) => item.providerTrackId === providerTrackId);
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

搜索候选字段：

- `providerTrackId`，必填
- `title`，必填
- `artist`
- `album`
- `albumArtist`
- `duration`
- `coverUrl`
- `webUrl`
- `playable`
- `unavailableReason`
- `source`

播放解析字段：

- `url`，必填，必须是 `http` / `https`
- `expiresAt`
- `mimeType`
- `bitrate`
- `sampleRate`
- `bitDepth`
- `codec`
- `headers`
- `requiresProxy`
- `supportsRange`

限制：

- 单插件最多 4 个 source provider。
- 单 provider 每次最多 25 个搜索候选。
- 搜索请求最大约 32 KB，搜索返回最大约 128 KB。
- 播放解析请求最大约 16 KB，播放解析返回最大约 32 KB。
- provider 超时约 2.5 秒。
- `resolvePlayback` 只应在用户真的要播放时做必要解析，不要在 `search` 里预拉所有播放 URL。

## 插件设置

v2 插件设置由 manifest 声明，宿主在插件详情页渲染表单，并保存到 `plugin-settings.json`。

支持类型：

- `string`
- `select`
- `boolean`
- `number`
- `secret`

示例：

```json
{
  "contributes": {
    "settings": [
      {
        "id": "base-url",
        "title": "API URL",
        "description": "第三方 API 地址",
        "type": "string",
        "defaultValue": "https://example.com"
      },
      {
        "id": "quality",
        "title": "Quality",
        "type": "select",
        "defaultValue": "high",
        "options": [
          { "label": "High", "value": "high" },
          { "label": "Low", "value": "low" }
        ]
      },
      {
        "id": "enabled",
        "title": "Enabled",
        "type": "boolean",
        "defaultValue": false
      },
      {
        "id": "limit",
        "title": "Limit",
        "type": "number",
        "defaultValue": 5,
        "min": 1,
        "max": 25
      },
      {
        "id": "api-key",
        "title": "API Key",
        "type": "secret"
      }
    ]
  }
}
```

读取设置：

```js
const baseUrl = await echo.settings.get('base-url');
const allSettings = await echo.settings.getAll();
```

写入设置：

```js
await echo.settings.set('enabled', true);
await echo.settings.set({ limit: 10 });
```

注意：

- v2 设置是插件自己的命名空间，不写应用全局 settings。
- 宿主会按 manifest 过滤和裁剪设置值。
- `secret` 只是 UI 上用密码框显示，当前不是系统凭据保险箱。不要保存高价值长期密钥。
- 单个设置 patch 最大约 32 KB。
- 插件设置总量最大约 128 KB。
- 插件包导出不包含 `plugin-settings.json`。

## 网络访问

网络访问只在 `apiVersion: 2` 生效，并且必须申请 `network` 权限。

Manifest：

```json
{
  "apiVersion": 2,
  "permissions": ["network"]
}
```

请求 JSON：

```js
const data = await echo.net.fetchJson({
  url: 'https://example.com/api/search?q=test',
  method: 'GET',
  headers: {
    accept: 'application/json'
  },
  timeoutMs: 3000
});
```

请求文本：

```js
const text = await echo.net.fetchText('https://example.com/lyrics.txt');
```

限制：

- 只允许 `http` / `https` URL。
- 只允许 `GET` / `POST`。
- 请求 JSON 最大约 64 KB。
- 响应最大约 512 KB。
- 默认和最大超时约 5 秒。
- 允许的请求 header：`accept`、`accept-language`、`content-type`、`user-agent`。
- `authorization`、`cookie`、`set-cookie`、`x-api-key`、`x-auth-token` 等敏感 header 会被过滤。
- 非 2xx 响应会抛出 `plugin_network_http_<status>`。

网络 provider 编写建议：

- 把网络请求放到用户触发的命令或 provider handler 中。
- 对同一首歌的结果做插件 storage 缓存，但控制大小。
- 不要在 `playback:status` 事件里请求网络。
- 不要用短间隔轮询。
- 对失败返回空候选，并写清楚日志。

## 插件存储

`echo.storage` 用于保存插件自己的小型 JSON 数据。

```js
await echo.storage.set('lastLookup', {
  title: 'Song',
  savedAt: new Date().toISOString()
});

const lastLookup = await echo.storage.get('lastLookup');
```

限制：

- key 最大约 96 字符。
- 单个 value 最大约 64 KB。
- 单插件 storage 总量最大约 256 KB。
- 存储文件是 `plugin-storage.json`。
- 插件包导出不包含 storage。

storage 适合保存缓存索引、上次操作状态、小型配置。不要保存整页曲库、图片二进制、歌词大集合或长日志。

## 面板 `panel.html`

面板作为 sandbox iframe 运行。它不接触主应用 DOM，也不能直接访问 `plugin.js` 里的 `echo` 对象。

面板要和宿主交互，只能通过受控 `postMessage` bridge：

```js
parent.postMessage({
  channel: 'echo:plugin-panel',
  version: 1,
  type: 'request',
  requestId: 'request-1',
  pluginId: 'echo.my-plugin',
  action: 'plugin:getSummary'
}, '*');
```

响应：

```js
window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.channel !== 'echo:plugin-panel' || message.type !== 'response') {
    return;
  }
  if (message.ok) {
    console.log(message.result);
  } else {
    console.error(message.error);
  }
});
```

当前 panel action：

| action | payload | 作用 |
| --- | --- | --- |
| `plugin:getSummary` | 无 | 返回当前插件摘要、权限、活动、安全信息 |
| `plugin:getLogs` | 无 | 返回当前插件日志 |
| `plugin:runCommand` | `{ "commandId": "...", "args": [] }` | 执行当前插件命令 |

面板想做有权限的事，应在 `plugin.js` 里注册命令，再由面板触发 `plugin:runCommand`。不要假设面板可以直接读曲库或控制播放。

最小面板：

```html
<!doctype html>
<meta charset="utf-8">
<button id="refresh">刷新</button>
<pre id="output">等待中...</pre>
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

document.getElementById('refresh').addEventListener('click', async () => {
  output.textContent = JSON.stringify(await requestHost('plugin:getSummary'), null, 2);
});
</script>
```

## 导入、导出与发布

插件页默认导出 `.echo` 插件包，并兼容导入旧 `.echo-plugin.json` 包。包内容仍是受限 JSON 结构：

```json
{
  "type": "echo-next-plugin-package",
  "version": 1,
  "exportedAt": "2026-05-29T00:00:00.000Z",
  "manifest": {},
  "files": [
    {
      "path": "plugin.js",
      "content": "..."
    }
  ]
}
```

导出规则：

- 包最大约 2 MB。
- 最多 32 个文件。
- 单文件最大约 512 KB。
- 只导出插件根目录文件，不递归子目录。
- 排除 `plugin-state.json`、`plugin-storage.json`、`plugin-settings.json`。
- 排除 `.echo` 插件包文件，并兼容排除旧 `.echo-plugin.json` 包文件，避免递归打包。

导入规则：

- 必须是 `type: "echo-next-plugin-package"` 和 `version: 1`。
- 目标插件 id 已存在时，普通 UI 导入会拒绝覆盖。
- 导入后默认禁用，需要用户确认权限再启用。
- 宿主记录来源、导入时间、包版本和 checksum。

发布前清单：

- `echo.plugin.json` 使用 `apiVersion: 2`，除非维护旧插件。
- 权限最小化。
- README 写清用途、权限原因、第三方服务边界。
- 不包含个人 token、cookie、运行缓存。
- 不依赖本机绝对路径。
- 不使用高频轮询。
- 大数据都分页。
- 错误路径有清晰日志。

## 调试

插件页会显示：

- manifest 解析错误。
- 启用状态。
- 权限风险。
- 面板 sandbox 状态。
- 命令/provider 数量。
- 活动摘要，例如命令次数、事件次数、网络次数、storage 写入次数、错误次数。
- 插件日志。

`console.log` / `console.warn` / `console.error` 会进入插件日志：

```js
console.log('lookup started');
console.warn('provider returned no result');
console.error('lookup failed', error.message);
```

常用排查顺序：

1. manifest 是否能被插件页识别。
2. 插件是否已启用，权限是否全部确认。
3. `plugin.js` 顶层是否抛错。
4. 命令是否注册，id 是否一致。
5. provider 是否申请了正确权限。
6. 返回 JSON 是否超出大小限制。
7. 网络是否缺少 `network` 权限或被 header 限制挡住。
8. 面板 `pluginId`、`channel`、`requestId` 是否正确。

连续启动失败保护：

- 10 分钟内连续 3 次启动失败，宿主会自动禁用插件。
- 日志里会出现 `plugin_disabled_after_repeated_errors`。
- 修复文件后，可以手动重新启用。

## 性能与播放安全

ECHO 是播放器，插件必须默认把播放体验放在第一位。

必须遵守：

- 不在顶层做重 CPU 工作。
- 不在 `playback:status` 里做网络请求、全库查询或大写入。
- 不高频调用 `seek()`、`play()`、`pause()`。
- 曲库读取永远分页。
- Provider handler 保持 2.5 秒内完成。
- 网络超时设置短一点，失败返回空候选。
- 大任务拆成手动命令，不要自启动后台扫库。
- storage 只保存小型 JSON。
- source provider 的 `search` 只返回候选，`resolvePlayback` 只在播放时解析。
- 对第三方 API 失败、限流、空结果保持安静，不弹出连续噪声。

推荐模式：

```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scanSomePages(maxPages) {
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await echo.library.getTracks({ page, pageSize: 100 });
    // do small work
    if (!result.hasMore) break;
    await sleep(0);
  }
}
```

不推荐模式：

```js
// 不要这样：事件太高频，还叠加曲库和网络。
echo.events.on('playback:status', async () => {
  const tracks = await echo.library.getTracks({ pageSize: 100 });
  await echo.net.fetchJson('https://example.com/update');
  await echo.storage.set('huge', tracks);
});
```

## 常见错误码

| 错误码 | 含义与处理 |
| --- | --- |
| `plugin_permission_confirmation_required` | 启用时没有确认全部请求权限 |
| `plugin_permission_denied:*` | 调用了未被信任的能力 |
| `plugin_manifest_invalid` | manifest 解析失败 |
| `apiVersion must be between 1 and 2` | API 版本不兼容当前宿主 |
| `plugin_not_enabled` | 插件未启用或已被宿主禁用 |
| `plugin_command_not_found` | 命令未注册或 id 写错 |
| `plugin_command_timeout` | 命令超过约 2 秒 |
| `plugin_command_args_too_large` | 命令参数超过约 64 KB |
| `plugin_command_result_too_large` | 命令返回超过约 256 KB |
| `plugin_event_not_supported:*` | 监听了未开放事件 |
| `plugin_event_handler_limit` | 同插件事件 handler 太多 |
| `plugin_event_handler_timeout` | 异步事件 handler 超过约 2 秒 |
| `plugin_metadata_provider_invalid` | metadata provider 注册参数不合法 |
| `plugin_metadata_provider_limit` | metadata provider 超过 8 个 |
| `plugin_metadata_provider_timeout` | metadata provider 超过约 2.5 秒 |
| `plugin_metadata_request_too_large` | metadata 请求超过约 32 KB |
| `plugin_metadata_result_too_large` | metadata 返回超过约 64 KB |
| `plugin_lyrics_provider_invalid` | lyrics provider 注册参数不合法 |
| `plugin_lyrics_provider_limit` | lyrics provider 超过 4 个 |
| `plugin_lyrics_provider_timeout` | lyrics provider 超过约 2.5 秒 |
| `plugin_cover_provider_invalid` | cover provider 注册参数不合法 |
| `plugin_cover_provider_limit` | cover provider 超过 4 个 |
| `plugin_cover_provider_timeout` | cover provider 超过约 2.5 秒 |
| `plugin_source_provider_invalid` | source provider 注册参数不合法 |
| `plugin_source_provider_limit` | source provider 超过 4 个 |
| `plugin_source_provider_timeout` | source provider 超过约 2.5 秒 |
| `plugin_source_provider_not_playable` | source provider 没有 `resolvePlayback` |
| `plugin_source_playback_url_invalid` | 播放 URL 不是合法 `http` / `https` |
| `plugin_source_search_request_too_large` | source 搜索请求超过约 32 KB |
| `plugin_source_search_result_too_large` | source 搜索返回超过约 128 KB |
| `plugin_source_playback_request_too_large` | source 播放解析请求超过约 16 KB |
| `plugin_source_playback_result_too_large` | source 播放解析返回超过约 32 KB |
| `plugin_storage_value_too_large` | 单个 storage value 超过约 64 KB |
| `plugin_storage_quota_exceeded` | 插件 storage 总量超过约 256 KB |
| `plugin_settings_patch_too_large` | 设置 patch 超过约 32 KB |
| `plugin_setting_value_too_large` | 插件设置单次写入过大 |
| `plugin_settings_quota_exceeded` | 插件设置总量超过约 128 KB |
| `plugin_network_requires_api_v2` | v1 插件调用了网络 API |
| `plugin_network_url_invalid` | 网络 URL 不合法 |
| `plugin_network_method_not_allowed` | 网络方法不是 `GET` / `POST` |
| `plugin_network_request_too_large` | 网络请求超过约 64 KB |
| `plugin_network_response_too_large` | 网络响应超过约 512 KB |
| `plugin_network_http_<status>` | 第三方服务返回非 2xx |
| `plugin_package_invalid` | 导入文件不是 ECHO 插件包 |
| `plugin_package_too_large` | 插件包超过约 2 MB |
| `plugin_package_file_limit_exceeded` | 插件包文件超过 32 个 |
| `plugin_package_file_too_large` | 单个包文件超过约 512 KB |
| `plugin_import_target_exists` | 目标插件 id 已存在，普通导入拒绝覆盖 |
| `plugin_disabled_after_repeated_errors` | 插件连续启动失败，被宿主自动隔离 |

## 完整示例：网络元数据候选插件

`echo.plugin.json`：

```json
{
  "id": "echo.demo-metadata",
  "name": "Demo Metadata",
  "version": "0.1.0",
  "apiVersion": 2,
  "entry": "plugin.js",
  "panel": "panel.html",
  "permissions": ["library:read", "network"],
  "contributes": {
    "commands": [
      { "id": "test-lookup", "title": "测试查询" }
    ],
    "metadataProviders": [
      { "id": "tags", "title": "Demo 标签候选" }
    ],
    "settings": [
      {
        "id": "base-url",
        "title": "API URL",
        "type": "string",
        "defaultValue": "https://example.com"
      }
    ],
    "panels": [
      { "id": "main", "title": "Demo Metadata", "path": "panel.html" }
    ]
  }
}
```

`plugin.js`：

```js
async function lookup(track) {
  const baseUrl = await echo.settings.get('base-url');
  if (!baseUrl || !track.title) {
    return [];
  }

  try {
    const url = `${String(baseUrl).replace(/\/$/, '')}/search?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist || '')}`;
    const data = await echo.net.fetchJson({
      url,
      headers: { accept: 'application/json' },
      timeoutMs: 3000
    });

    if (!Array.isArray(data?.items)) {
      return [];
    }

    return data.items.slice(0, 3).map((item) => ({
      title: item.title || track.title,
      artist: item.artist || track.artist,
      album: item.album,
      genre: item.genre,
      year: Number(item.year) || undefined,
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5)),
      source: 'Demo Metadata',
      sourceUrl: item.url
    }));
  } catch (error) {
    console.warn('lookup failed', error.message);
    return [];
  }
}

echo.metadata.registerProvider('tags', { title: 'Demo 标签候选' }, async ({ track }) => ({
  candidates: await lookup(track)
}));

echo.commands.register('test-lookup', { title: '测试查询' }, async () => {
  const page = await echo.library.getTracks({
    page: 1,
    pageSize: 1,
    sort: 'recent',
    fields: ['id', 'title', 'artist', 'album']
  });

  const track = page.items[0];
  if (!track) {
    await echo.ui.notify('曲库为空。');
    return { candidates: [] };
  }

  const candidates = await lookup(track);
  await echo.ui.notify(`找到 ${candidates.length} 个候选。`);
  return { track, candidates };
});
```

`panel.html`：

```html
<!doctype html>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; margin: 16px; color: #1f2937; }
  button { padding: 6px 10px; }
  pre { white-space: pre-wrap; border: 1px solid #d1d5db; padding: 12px; }
</style>
<button id="run">测试查询</button>
<pre id="output">等待操作...</pre>
<script>
const pluginId = 'echo.demo-metadata';
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
  const response = await requestHost('plugin:runCommand', { commandId: 'test-lookup' });
  output.textContent = JSON.stringify(response, null, 2);
});
</script>
```

## 作者检查清单

写插件前：

- 明确插件是命令、provider、面板，还是三者组合。
- 列出必须权限，删掉“可能用得上”的权限。
- 判断是否需要 `network`。如果需要，使用 `apiVersion: 2`。
- 判断是否真的需要面板。简单工具优先做命令。

写插件时：

- 顶层只注册 handler，不做重工作。
- 所有曲库操作分页。
- 所有网络请求有短超时。
- 所有 provider 返回候选，不直接写库。
- 所有错误都能返回空结果或清晰日志。
- 不把 token、cookie、用户缓存打进发布包。

发布前：

- 新装导入后默认禁用是正常行为。
- 启用权限说明能让用户看懂。
- 插件连续启动失败不会让主程序坏掉。
- 导出包里没有 `plugin-storage.json`、`plugin-settings.json`、`plugin-state.json`。
- 在播放音乐时试一次插件主流程，确认没有明显卡顿。

## 源码参考

主要契约位置：

- `src/shared/types/plugins.ts`
- `docs/plugin-sdk/echo-plugin.d.ts`
- `src/main/plugins/PluginManifest.ts`
- `src/main/plugins/PluginService.ts`
- `src/main/ipc/pluginIpc.ts`
- `src/renderer/pages/PluginsPage.tsx`

如果文档和代码不一致，以这些源码文件为准。
