# NT-ClawLaunch Development Guide

All commands below should be run from the `frontend/` directory.

## Common Scripts

### Development mode (hot reload)

```bash
npm run dev
```

Starts Vite (port 5173) and Electron in parallel. Code changes in `src/` hot-reload in the renderer; changes to `electron/main.ts` trigger an Electron restart.

### Production build

```bash
npm run build
```

Runs TypeScript compilation (`tsc`) + Vite bundling. Outputs:
- `dist/` — Vite-built renderer assets
- `dist-electron/` — compiled Electron main process

### Preview a production build (without packaging)

```bash
cross-env NODE_ENV=production electron .
```

Requires a completed `npm run build` first.

### Package distributable

```bash
npm run dist
```

Uses `electron-builder` to produce a signed `.dmg` (macOS) in `release/`.

---

## Build Pipeline Details

1. **Renderer (Vite)** — React + TypeScript source in `src/` → `dist/`
2. **Main process (tsc)** — `electron/main.ts` → `dist-electron/main.js` using `--module esnext` (ESM, not CJS)
3. **Preload** — `electron/preload.js` is copied as-is to `dist-electron/`; this file must stay in sync with the channels declared in `main.ts`

### Critical: Electron 41 ESM requirement

Electron 41 intercepts ESM `import` statements from its own module system correctly. **Do not compile `main.ts` to CommonJS** — `require('electron')` resolves to the npm package (a path string), not the Electron API.

Required `tsconfig` flag:
```json
{ "compilerOptions": { "module": "esnext" } }
```

Required `__dirname` polyfill in `main.ts`:
```ts
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

### Critical: ELECTRON_RUN_AS_NODE=1

Shell environments (including Claude Code) set `ELECTRON_RUN_AS_NODE=1`, which makes the Electron binary act as plain Node.js. Any script that imports `electron` in this context will fail. This is expected — it does not reflect real app behavior when launched via `npm run dev` or the built `.app`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Black screen on `npm run dev` | Electron launched before Vite server was ready | Kill the process and re-run `npm run dev` |
| Changes to `main.ts` not taking effect | Old `dist-electron/main.js` still running | Run `npm run build:electron` or restart with `npm run dev` |
| `require is not defined` in main process | `main.ts` compiled to CommonJS | Ensure `"module": "esnext"` in tsconfig |
| Port 5173 already in use | Stale Vite process from previous session | Run `node scripts/cleanup-dev-port.mjs` |

---

---

# NT-ClawLaunch 開發指南

以下所有指令請在 `frontend/` 目錄下執行。

## 常用指令

### 開發模式（熱重載）

```bash
npm run dev
```

同時啟動 Vite（port 5173）與 Electron。`src/` 的程式碼更改會即時熱重載；`electron/main.ts` 的更改會觸發 Electron 重啟。

### 生產環境打包

```bash
npm run build
```

執行 TypeScript 編譯（`tsc`）+ Vite 建構，輸出至：
- `dist/` — Vite 建構的 renderer 資源
- `dist-electron/` — 編譯後的 Electron 主程序

### 本地預覽編譯版（不打包）

```bash
cross-env NODE_ENV=production electron .
```

需先完成 `npm run build`。

### 打包發行版

```bash
npm run dist
```

使用 `electron-builder` 在 `release/` 產生 `.dmg`（macOS）。

---

## 打包流程說明

1. **Renderer（Vite）** — `src/` 的 React + TypeScript → `dist/`
2. **主程序（tsc）** — `electron/main.ts` → `dist-electron/main.js`，使用 `--module esnext`（ESM，非 CJS）
3. **Preload** — `electron/preload.js` 原樣複製至 `dist-electron/`；此檔案必須與 `main.ts` 中宣告的 channel 保持同步

### 重要：Electron 41 ESM 需求

Electron 41 透過自身的模組系統正確攔截 ESM `import` 語句。**請勿將 `main.ts` 編譯為 CommonJS** — `require('electron')` 會解析到 npm 套件（回傳路徑字串），而非 Electron API。

### 重要：ELECTRON_RUN_AS_NODE=1

Shell 環境（包含 Claude Code）會設定 `ELECTRON_RUN_AS_NODE=1`，使 Electron 執行檔以純 Node.js 模式運作。在此環境中引入 `electron` 的腳本將會失敗。這是預期行為，不影響透過 `npm run dev` 或 `.app` 正常啟動的結果。

---

## 故障排除

| 症狀 | 原因 | 解法 |
|------|------|------|
| `npm run dev` 出現黑畫面 | Electron 在 Vite 伺服器就緒前啟動 | 關閉程序並重新執行 `npm run dev` |
| 修改 `main.ts` 後沒有效果 | 舊的 `dist-electron/main.js` 仍在執行 | 執行 `npm run build:electron` 或重啟 `npm run dev` |
| 主程序出現 `require is not defined` | `main.ts` 被編譯為 CommonJS | 確認 tsconfig 中有 `"module": "esnext"` |
| Port 5173 被佔用 | 前次 session 遺留的 Vite 程序 | 執行 `node scripts/cleanup-dev-port.mjs` |
