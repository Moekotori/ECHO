# ECHO 官网（website/）

这个目录是 **ECHO 官网**，与播放器主工程完全隔离（不会改到 `src/renderer`）。

## 本地开发

```bash
cd website
npm install
npm run dev
```

## 维护方式（你不需要会前端）

绝大多数情况下，发新版只做两件事：

1) **上传安装包到服务器**
- 服务器目录示例：`/var/www/echo-downloads/`
- 对应网站路径：`/downloads/xxx.exe`

2) **更新版本信息 JSON**
- 文件：`website/public/content/releases.json`
- 你只需要改：`version`、`publishedAt`、`files[].name/path/bytes/sha256`

可选：更新更新日志
- 文件：`website/public/content/changelog.json`

## 三步发版（推荐最省心）

在你香港服务器上：

1. 把新的 `.exe` 上传到 `/var/www/echo-downloads/`
2. 覆盖服务器上的 `releases.json`（以及可选 `changelog.json`）
3. 如果你没改页面代码：**不需要重新 build**（网站运行时会 `fetch('/content/releases.json')`）

如果你改了页面代码：

```bash
cd website
npm run build
```

然后把 `website/dist/` 同步到服务器站点目录（例如 `/var/www/echo-site/`）。

## 校验 JSON（避免手滑）

```bash
cd website
npm run check:content
```

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
