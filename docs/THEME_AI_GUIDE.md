# ECHO AI 主题生成指南

这份文档给 AI 阅读。用户可以把它连同自己的审美描述一起发送给 AI，让 AI 生成 ECHO 可导入的自定义主题 JSON。

目标：生成一个 `echo-next.custom-theme` JSON 文件。用户在 ECHO 的 `设置 -> 外观 -> 自定义当前主题 -> 导入参数` 中导入后，就能得到一个“我的主题”。

## 生成原则

- 只输出 JSON，不输出 CSS、JS、HTML 或解释性文字。
- JSON 必须能被 `JSON.parse` 解析：不要写注释，不要有尾随逗号，不要使用单引号。
- 颜色只使用 `#RRGGBB` 十六进制格式，例如 `#101416`。不要输出 `rgb()`、`rgba()`、`hsl()`、透明色或渐变字符串。
- 字段名必须完全匹配本文档，不要发明新字段。
- 至少提供 `light` 或 `dark` 其中一组。推荐同时提供两组。
- 主题可以故意低对比度，但要知道这可能影响可读性。ECHO 只提醒，不会阻止用户保存。
- 优先做有审美一致性的主题：背景、面板、播放器、侧栏、文字、强调色要像同一个设计系统。
- 不要只把所有颜色都换成同一色相的深浅变化。至少使用一个主强调色、一个辅助强调色和一组中性色。

## 顶层结构

输出这个结构：

```json
{
  "schema": "echo-next.custom-theme",
  "version": 2,
  "exportedAt": "2026-06-03T00:00:00.000Z",
  "theme": {
    "id": "theme-ai-example",
    "name": "AI Example",
    "basePreset": "classic",
    "createdAt": "2026-06-03T00:00:00.000Z",
    "updatedAt": "2026-06-03T00:00:00.000Z",
    "light": {},
    "dark": {}
  }
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schema` | 是 | 固定为 `echo-next.custom-theme` |
| `version` | 是 | 固定为 `2` |
| `exportedAt` | 是 | ISO 时间字符串 |
| `theme.id` | 是 | 1-80 个字符，只用字母、数字、下划线、点、冒号、短横线 |
| `theme.name` | 是 | 用户看到的主题名，最多 48 个字符 |
| `theme.basePreset` | 是 | 基础预设名，见下方列表 |
| `theme.createdAt` | 是 | ISO 时间字符串 |
| `theme.updatedAt` | 是 | ISO 时间字符串 |
| `theme.light` | 否 | 浅色模式覆盖参数 |
| `theme.dark` | 否 | 深色模式覆盖参数 |

可用的 `basePreset`：

```text
classic, echoTwilight, sakuraMilk, peachSoda, mintCandy, berryDream,
matchaCream, lemonMochi, cottonCloud, melonCream, seaSaltJelly,
caramelPudding, neonCandy, nyanCat, childrenDoodle, wisteriaBubble,
strawberryCookie, graphiteAurora, amberNoir, oceanStudio, rosewoodVinyl,
darkSideMoon, shibuyaNight, kyotoKurenai, ukiyoIndigo, fujiSnow,
matsuriLantern, ginzaNoir, frostJazz, FINAL
```

不知道选什么时用 `classic`。如果用户要求“保留某个预设的气质再微调”，就把那个预设写入 `basePreset`。

## 色调结构

`light` 和 `dark` 的字段相同。可以只写需要覆盖的字段，但建议生成完整字段，方便用户导入后直接得到完整效果。

```json
{
  "appBg": "#f4f8fb",
  "appBg2": "#d8e8ef",
  "appBg3": "#dce3f2",
  "panel": "#fbfdff",
  "panelSoft": "#e6eef4",
  "accent": "#245f9e",
  "accentStrong": "#163f70",
  "secondary": "#7f3e70",
  "heading": "#142234",
  "text": "#34495f",
  "muted": "#546a80",
  "border": "#5c7da9",
  "onAccent": "#ffffff",
  "buttonText": "#34495f",
  "titlebar": "#fbfdff",
  "sidebar": "#e6eef4",
  "player": "#fbfdff",
  "field": "#ffffff",
  "row": "#ffffff",
  "rowHover": "#eef4fa",
  "rowActive": "#dce9ff",
  "chip": "#ffffff",
  "focus": "#245f9e",
  "danger": "#d64545",
  "success": "#2f8f72",
  "warning": "#c98a16",
  "panelOpacityPercent": 78,
  "glassPercent": 20,
  "shadowPercent": 82,
  "cornerRadiusPx": 14,
  "panelBlurPx": 15,
  "saturationPercent": 100,
  "motionEnabled": true,
  "motionSpeedSeconds": 0.18,
  "motionIntensityPercent": 64
}
```

## 颜色字段含义

| 字段 | 用途 | 生成建议 |
| --- | --- | --- |
| `appBg` | 主窗口底色 | 决定主题第一印象 |
| `appBg2` | 背景渐变中段 | 和 `appBg` 同气质但有层次 |
| `appBg3` | 背景渐变尾色 | 可加入轻微冷暖对比 |
| `panel` | 主要面板色 | 需要承载正文和按钮 |
| `panelSoft` | 弱层级面板 | 侧栏、次级区域、柔和背景 |
| `accent` | 主强调色 | 主按钮、进度、焦点 |
| `accentStrong` | 强强调色 | 标题高光、强调层次 |
| `secondary` | 第三强调色 | 小状态、高亮点缀 |
| `heading` | 主文字 | 标题、重要文字 |
| `text` | 正文文字 | 歌名、设置正文、列表文字 |
| `muted` | 次要文字 | 描述、辅助说明 |
| `border` | 边框和分割线 | 不要比文字更抢眼 |
| `onAccent` | 强调按钮上的文字 | 必须能压住 `accent` |
| `buttonText` | 普通按钮文字 | 通常接近 `text` |
| `titlebar` | 窗口顶部栏 | 通常接近 `panel` 或 `appBg` |
| `sidebar` | 左侧导航背景 | 通常接近 `panelSoft` |
| `player` | 底部播放器背景 | 可比 `panel` 稍深或稍实 |
| `field` | 输入框和搜索框 | 需要和 `text` 有可读性 |
| `row` | 列表普通行 | 通常接近 `panel` |
| `rowHover` | 列表悬停行 | 比 `row` 稍有变化 |
| `rowActive` | 列表选中行 | 带一点 `accent` 气质 |
| `chip` | 筛选芯片、小按钮底色 | 通常接近 `field` |
| `focus` | 键盘焦点和描边高亮 | 通常等于或接近 `accent` |
| `danger` | 危险色 | 删除、错误 |
| `success` | 成功色 | 正常、连接成功 |
| `warning` | 警告色 | 提醒、注意 |

## 数值字段范围

| 字段 | 范围 | 说明 |
| --- | --- | --- |
| `panelOpacityPercent` | 40-100 | 面板不透明度，越低越透 |
| `glassPercent` | 0-80 | 玻璃感和背景模糊层次 |
| `shadowPercent` | 0-100 | 阴影强度 |
| `cornerRadiusPx` | 0-28 | 圆角大小 |
| `panelBlurPx` | 0-32 | 面板模糊程度 |
| `saturationPercent` | 60-140 | 整体饱和度 |
| `motionEnabled` | `true` / `false` | 是否启用主题动效 |
| `motionSpeedSeconds` | 0.12-8 | 动效速度，越小越快 |
| `motionIntensityPercent` | 0-160 | 动效强度 |

## 对比度建议

ECHO 允许用户保存低对比度主题，但 AI 应该优先保证可读性。

推荐检查：

- `text` 对 `appBg` 尽量达到 4.5:1。
- `heading` 对 `appBg` 尽量达到 4.5:1。
- `buttonText` 对 `panel` 尽量达到 4.5:1。
- `onAccent` 对 `accent` 尽量达到 3:1。

浅色主题常见做法：

- 背景用浅色，文字用深色。
- `accent` 如果偏深，`onAccent` 用 `#ffffff`。
- 面板不要和背景完全一样，至少有轻微层次。

深色主题常见做法：

- 背景用深色，文字用浅色。
- `accent` 可以更明亮，但避免荧光色过多。
- `muted` 不要太暗，否则辅助文字会看不清。

## 完整示例

```json
{
  "schema": "echo-next.custom-theme",
  "version": 2,
  "exportedAt": "2026-06-03T00:00:00.000Z",
  "theme": {
    "id": "theme-ai-midnight-lychee",
    "name": "Midnight Lychee",
    "basePreset": "classic",
    "createdAt": "2026-06-03T00:00:00.000Z",
    "updatedAt": "2026-06-03T00:00:00.000Z",
    "light": {
      "appBg": "#f8f1f5",
      "appBg2": "#ead8e8",
      "appBg3": "#d7edf0",
      "panel": "#fffafd",
      "panelSoft": "#efe2eb",
      "accent": "#9f3d72",
      "accentStrong": "#67264b",
      "secondary": "#2f7f87",
      "heading": "#2a1724",
      "text": "#4b3241",
      "muted": "#735b69",
      "border": "#b67598",
      "onAccent": "#ffffff",
      "buttonText": "#4b3241",
      "titlebar": "#fffafd",
      "sidebar": "#efe2eb",
      "player": "#fff7fb",
      "field": "#ffffff",
      "row": "#ffffff",
      "rowHover": "#f5edf2",
      "rowActive": "#efd4e4",
      "chip": "#fffafd",
      "focus": "#9f3d72",
      "danger": "#c84355",
      "success": "#2f8f72",
      "warning": "#bd7a1c",
      "panelOpacityPercent": 80,
      "glassPercent": 18,
      "shadowPercent": 78,
      "cornerRadiusPx": 14,
      "panelBlurPx": 14,
      "saturationPercent": 104,
      "motionEnabled": true,
      "motionSpeedSeconds": 0.22,
      "motionIntensityPercent": 58
    },
    "dark": {
      "appBg": "#0d0910",
      "appBg2": "#1d1020",
      "appBg3": "#0b2428",
      "panel": "#211725",
      "panelSoft": "#17101a",
      "accent": "#f08abd",
      "accentStrong": "#ffd6ea",
      "secondary": "#72d0d7",
      "heading": "#fff6fb",
      "text": "#eadce7",
      "muted": "#c8aeba",
      "border": "#c875a4",
      "onAccent": "#321020",
      "buttonText": "#eadce7",
      "titlebar": "#18101b",
      "sidebar": "#17101a",
      "player": "#211725",
      "field": "#17101a",
      "row": "#201522",
      "rowHover": "#2a1a2e",
      "rowActive": "#3a2039",
      "chip": "#26192b",
      "focus": "#f08abd",
      "danger": "#ff6b7a",
      "success": "#65d6a1",
      "warning": "#f0b45b",
      "panelOpacityPercent": 88,
      "glassPercent": 24,
      "shadowPercent": 96,
      "cornerRadiusPx": 14,
      "panelBlurPx": 18,
      "saturationPercent": 108,
      "motionEnabled": true,
      "motionSpeedSeconds": 0.22,
      "motionIntensityPercent": 70
    }
  }
}
```

## 用户提示词模板

用户可以把下面这段发给 AI，并在最后补充自己的审美描述：

```text
请根据我提供的 ECHO AI 主题生成指南，为 ECHO 生成一个可导入的自定义主题 JSON。

要求：
- 只输出一个 JSON 代码块。
- 使用 schema = "echo-next.custom-theme"，version = 2。
- 同时生成 light 和 dark 两套色调。
- 所有颜色必须是 #RRGGBB。
- 不要输出 CSS、JS、解释文字或注释。
- 字段必须符合指南，不要增加不存在的字段。
- 尽量保证正文、标题、按钮和强调按钮可读。

我的主题需求：
主题名：
关键词：
想要的氛围：
喜欢的颜色：
不喜欢的颜色：
更偏浅色还是深色：
是否需要高对比度：
是否需要动效：
参考对象或画面：
```

## AI 生成前检查清单

生成 JSON 前检查：

- `schema` 是否为 `echo-next.custom-theme`。
- `version` 是否为 `2`。
- `theme.id` 是否只包含安全字符且不超过 80 个字符。
- `theme.name` 是否不超过 48 个字符。
- `basePreset` 是否在允许列表中。
- 是否至少有 `light` 或 `dark`。
- 所有颜色是否都是 `#RRGGBB`。
- 数值是否在范围内。
- JSON 是否没有注释和尾随逗号。
- 主题是否符合用户描述，而不是只随机堆颜色。

## 进阶：插件主题结构

如果用户不是要导入单个 JSON，而是要制作主题插件，可以使用 `contributes.themePresets`。插件主题不是本文档的主要目标，但结构如下：

```json
{
  "id": "echo.ai-theme-pack",
  "name": "AI Theme Pack",
  "version": "0.1.0",
  "apiVersion": 2,
  "entry": "plugin.js",
  "permissions": [],
  "contributes": {
    "themePresets": [
      {
        "id": "midnight-lychee",
        "title": "Midnight Lychee",
        "description": "荔枝粉、夜色紫和冷青色高光。",
        "basePreset": "classic",
        "preview": "linear-gradient(135deg, #0d0910 0%, #1d1020 50%, #72d0d7 100%)",
        "swatches": ["#0d0910", "#f08abd", "#72d0d7", "#eadce7"],
        "light": {
          "appBg": "#f8f1f5",
          "panel": "#fffafd",
          "accent": "#9f3d72",
          "heading": "#2a1724",
          "text": "#4b3241",
          "onAccent": "#ffffff"
        },
        "dark": {
          "appBg": "#0d0910",
          "panel": "#211725",
          "accent": "#f08abd",
          "heading": "#fff6fb",
          "text": "#eadce7",
          "onAccent": "#321020"
        }
      }
    ]
  }
}
```

插件主题额外规则：

- `themePresets` 最多 12 个。
- `preview` 只能是纯色或 `linear-gradient(...)`。
- `swatches` 只放 `#RRGGBB` 颜色。
- 主题插件不需要权限，不注入任意 CSS。
