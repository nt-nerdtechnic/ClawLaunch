# NT-ClawLaunch Frontend

The frontend package is an Electron 41 + React 19 desktop application that serves as the management interface for the OpenClaw AI gateway.

## Requirements

- Node.js 18+
- npm (or pnpm)
- OpenClaw CLI on `$PATH`

## Quick Start

Install dependencies:
```bash
npm install
```

Start development mode (Vite + Electron with hot reload):
```bash
npm run dev
```

Build for production:
```bash
npm run build
```

Package distributable:
```bash
npm run dist
```

## Stack

| Layer | Library / Version |
|-------|-------------------|
| Shell | Electron 41 |
| UI framework | React 19 + TypeScript 5 |
| Build tool | Vite 7 |
| Styling | Tailwind CSS 4 |
| State | Zustand 5 |
| Charts | Recharts 3 |
| Animations | Framer Motion 12 |
| i18n | i18next 25 |

## Tailwind CSS Notes

The project uses Tailwind CSS v4 syntax. The entry point is `src/index.css` with `@import "tailwindcss"` at the top. Do not remove this import. If new styles are not taking effect, verify that the `tailwindcss` package is installed and the import is present.

## See Also

- [DEVELOPMENT.md](../DEVELOPMENT.md) — build pipeline details, troubleshooting, ESM/Electron gotchas
- [README.md](../README.md) — full feature and architecture overview

---

---

# NT-ClawLaunch Frontend（繁體中文）

本 frontend 套件是基於 Electron 41 + React 19 的桌面應用程式，作為 OpenClaw AI Gateway 的管理介面。

## 系統需求

- Node.js 18+
- npm（或 pnpm）
- OpenClaw CLI 已加入 `$PATH`

## 快速啟動

安裝相依套件：
```bash
npm install
```

啟動開發模式（Vite + Electron，支援熱重載）：
```bash
npm run dev
```

建構生產版本：
```bash
npm run build
```

打包發行版：
```bash
npm run dist
```

## 技術棧

| 層級 | 函式庫 / 版本 |
|------|--------------|
| 外殼 | Electron 41 |
| UI 框架 | React 19 + TypeScript 5 |
| 建構工具 | Vite 7 |
| 樣式 | Tailwind CSS 4 |
| 狀態管理 | Zustand 5 |
| 圖表 | Recharts 3 |
| 動畫 | Framer Motion 12 |
| 多語言 | i18next 25 |

## Tailwind CSS 說明

本專案使用 Tailwind CSS v4 語法。進入點為 `src/index.css`，頂部需有 `@import "tailwindcss"`。請勿移除此引用。若新增的樣式未生效，請確認 `tailwindcss` 套件已正確安裝且引用存在。

## 延伸閱讀

- [DEVELOPMENT.md](../DEVELOPMENT.md) — 建構流程、故障排除、ESM/Electron 注意事項
- [README.md](../README.md) — 完整功能與架構說明
