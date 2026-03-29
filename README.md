# NT-ClawLaunch

**NT-ClawLaunch** is a desktop control plane for managing [OpenClaw](https://openclaw.ai) AI gateway instances. It wraps the OpenClaw CLI in an Electron shell and provides a full-featured UI for onboarding, monitoring, agent observability, and runtime configuration — without requiring any changes to the agents themselves.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](CONTRIBUTING.md)

> **Platform:** macOS · **Stack:** Electron 41 + React 19 + Vite 7 + TypeScript + Tailwind CSS 4 + Zustand

> **Platform Support:** Currently macOS only. Support for Linux and Windows may be considered in future releases.
>
> **Web UI:** The management interface is only available via the Electron desktop app. Direct browser access (e.g. `http://localhost:5173`) is not supported due to system-level security considerations.

---

## Features

### Onboarding Wizard (6 steps)
A guided setup flow that takes a developer from zero to a running gateway in one session:

| Step | What it does |
|------|-------------|
| **Welcome** | Choose `new` (fresh install) or `existing` (detect current installation) |
| **Initialize** | Scaffold Core, Config, and Workspace directories; write initial `config.json` |
| **Model** | Confirm three path roots, then authorize the AI model — OAuth (external terminal) or API key (non-interactive) |
| **Messaging** | Bind a communication channel (`openclaw channels add`); high-risk group channels run a doctor pre-check |
| **Skills** | Scan, import, and delete workspace skills |
| **Launch** | Install daemon (`openclaw onboard --install-daemon`) or just verify CLI availability; run readiness check |

### Monitoring Dashboard
Real-time view of the running gateway and connected agents — session count, active tasks, pending approvals, budget summary, and 24-hour event digest.

### Activity Observation Engine
Passive observability with zero agent modification required. The engine watches three sources concurrently:

- **Filesystem watcher** — `fs.watch({ recursive: true })` on CorePath and WorkspacePath; classifies events by path structure into categories: `skill`, `session`, `config`, `task`, `audit`, `workspace`, `unknown`
- **JSONL session scanner** — parses OpenClaw session files (`.jsonl`) looking for `type: 'message'` events with embedded tool calls (`exec`, `write`, `edit`) to reconstruct what each agent did
- **Cron job monitor** — tracks `lastRunAtMs` changes across macOS crontab entries, LaunchAgents, and OpenClaw `jobs.json`

All events are deduplicated and stored in a 500-event ring buffer persisted to `activity-store.json`.

### Analytics
Multi-dimensional usage tracking across agents, projects, tasks, models, providers, and session types. Visualized with Recharts. Includes session scan (token/cost breakdown) and daily digest.

### Control Center
Task board with DoD/artifact/rollback details, approval action queue, and audit timeline with severity filtering and time-window selection.

### Skills Management
Browse, enable/disable, and delete both Core skills and Workspace skills. Live scan from the filesystem with diff-aware import.

### Settings
Two settings pages:
- **Launcher Settings** — corePath, configPath, workspacePath, gateway port (auto-detect or manual), daemon toggle, unrestricted mode
- **Runtime Settings** — model, auth method, messaging platform/tokens, theme, language

### Other
- **Multi-instance support** — each Electron process gets its own isolated `userData` directory (per-PID), so multiple instances run independently with separate config and auth
- **Dynamic port detection** — scans ports 10000–60000 via `net.createServer()` to find a free port for the gateway
- **Chat interface** — floating chat widget backed by `openclaw:chat.invoke` IPC; streaming chunks via `openclaw:chat.chunk` event
- **Update banner** — detects new versions and prompts in-app
- **i18n** — English and Traditional Chinese via i18next; switchable at runtime
- **MiniView** — condensed single-card layout for secondary screens

---

## Architecture

```
NT-ClawLaunch/
├── frontend/
│   ├── electron/             # Electron main/preload + backend-like services
│   │   ├── main.ts
│   │   ├── preload.js
│   │   ├── services/
│   │   └── utils/
│   ├── src/                  # React application (pages, components, hooks, stores)
│   ├── test/                 # Vitest tests
│   ├── scripts/              # Dev helper scripts (e.g. cleanup ports)
│   ├── docs/                 # Frontend-specific docs (E2E scenarios)
│   └── package.json
├── docs/                     # Product/design/refactor planning docs
├── package.json              # Workspace scripts (pnpm --filter frontend ...)
├── README.md
├── README.en.md
└── DEVELOPMENT.md
```

### IPC Channel Map

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `shell:exec` | renderer → main | Run any shell command; stdout streamed via `shell:stdout` |
| `config:read` / `config:write` | renderer → main | Read/write persistent `config.json` |
| `dialog:selectDirectory` | renderer → main | Native folder picker |
| `shell:open-path` / `shell:open-external` | renderer → main | Open file or URL |
| `shell:kill-port-holder` | renderer → main | Kill process holding a port |
| `port:find-free` | renderer → main | Scan for free port in range |
| `window:resize` / `window:set-title` | renderer → main | Window management |
| `events:ack` / `events:state` | renderer → main | Event queue acknowledgement |
| `usage:scan-sessions` | renderer → main | Scan JSONL sessions for token/cost data |
| `openclaw:chat.invoke` / `openclaw:chat.abort` | renderer → main | Chat request / abort |
| `openclaw:chat.chunk` | main → renderer | Streaming chat response |
| `activity:events:list` | renderer → main | Query activity ring buffer |
| `activity:scan:now` | renderer → main | Trigger immediate JSONL + cron scan |
| `activity:watch:restart` | renderer → main | Restart filesystem watcher |

### Config Persistence

| Concern | Path |
|---------|------|
| Persistent launcher config | `~/Library/Application Support/NT-ClawLaunch/config.json` |
| Per-instance state (isolation) | `~/Library/Application Support/NT-ClawLaunch-{PID}/control-center-state.json` |
| Activity ring buffer | `~/Library/Application Support/NT-ClawLaunch/activity-store.json` |

Multi-instance isolation is achieved by calling `app.setPath('userData', ...-${process.pid})` before `app.whenReady()`, giving each window its own Chromium profile and IPC state. The launcher config itself uses a stable path (`NT-ClawLaunch/`) shared across instances so settings persist across restarts.

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm or pnpm
- [OpenClaw CLI](https://openclaw.ai) installed and on `$PATH`

### Environment Variables

There is currently no required `.env` / `.env.example` file in this repository. Runtime settings are persisted by the desktop app in `~/Library/Application Support/NT-ClawLaunch/config.json`.

### Run from Workspace Root

```bash
npm install
npm run dev      # delegates to frontend via pnpm --filter frontend dev
```

### Development

```bash
cd frontend
npm install
npm run dev        # starts Vite (port 5173) + Electron in parallel
```

### Production Build

```bash
cd frontend
npm run build      # TypeScript + Vite → dist/ + dist-electron/
npm run dist       # electron-builder → release/*.dmg (macOS)
```

### Preview a Built Binary

```bash
cd frontend
cross-env NODE_ENV=production electron .
```

---

## Development Notes

- **ESM only** — `electron/main.ts` must compile to `--module esnext`. CJS `require('electron')` does not work in Electron 41; use named ESM imports.
- **`__dirname` polyfill** — add `const __dirname = path.dirname(fileURLToPath(import.meta.url))` in `main.ts`.
- **`ELECTRON_RUN_AS_NODE=1`** — Claude Code / shell environments set this flag, making the Electron binary behave as plain Node.js. Tests that import `electron` will fail in this context; this is expected and does not reflect real-app behavior.

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for a full troubleshooting guide.

---

## Contributing

Pull requests are welcome. Please open an issue first for significant changes. See [CONTRIBUTING.md](CONTRIBUTING.md) for code style and branch conventions.

## License

[MIT](LICENSE)

---

---

# NT-ClawLaunch（繁體中文）

**NT-ClawLaunch** 是管理 [OpenClaw](https://openclaw.ai) AI Gateway 實例的桌面控制平台。它將 OpenClaw CLI 包裝在 Electron 外殼中，提供完整的 UI 介面，涵蓋安裝導引、監控、Agent 可觀測性與執行期設定——且無需修改任何 Agent 本身的程式碼。

> **平台：** macOS · **技術棧：** Electron 41 + React 19 + Vite 7 + TypeScript + Tailwind CSS 4 + Zustand

> **平台支援：** 目前僅支援 macOS。Linux 與 Windows 等其他平台的支援將於未來版本中評估。
>
> **Web 管理介面：** 基於系統層面的安全考量，管理介面目前不開放透過瀏覽器存取（例如 `http://localhost:5173`），僅支援 Electron 桌面應用程式。

---

## 功能特點

### 安裝導引精靈（6 個步驟）

| 步驟 | 說明 |
|------|------|
| **Welcome** | 選擇 `new`（全新安裝）或 `existing`（偵測現有安裝）|
| **Initialize** | 建立 Core、Config、Workspace 目錄；寫入初始 `config.json` |
| **Model** | 確認三個路徑根目錄，然後授權 AI 模型——OAuth（開啟外部終端機）或 API Key（非互動式）|
| **Messaging** | 綁定通訊頻道（`openclaw channels add`）；高風險群組頻道會先執行 doctor 前置檢查 |
| **Skills** | 掃描、匯入、刪除工作區技能 |
| **Launch** | 安裝背景服務（`openclaw onboard --install-daemon`）或僅驗證 CLI 可用性；執行就緒度檢查 |

### 監控儀表板

即時顯示 Gateway 與已連線 Agent 的狀態——Session 數量、活躍任務、待審批事項、預算摘要、24 小時事件摘要。

### 活動觀測引擎

被動式可觀測性，**無需修改任何 Agent**。引擎同時監聽三個來源：

- **檔案系統監聽器** — 對 CorePath 與 WorkspacePath 使用 `fs.watch({ recursive: true })`，依路徑結構分類事件：`skill`、`session`、`config`、`task`、`audit`、`workspace`、`unknown`
- **JSONL Session 掃描器** — 解析 OpenClaw 的 Session 檔案（`.jsonl`），尋找帶有嵌入式工具呼叫（`exec`、`write`、`edit`）的 `type: 'message'` 事件，重建每個 Agent 的操作記錄
- **Cron Job 監控器** — 追蹤 macOS crontab、LaunchAgents 與 OpenClaw `jobs.json` 的 `lastRunAtMs` 變化

所有事件均去重後儲存於 500 筆環形緩衝，持久化至 `activity-store.json`。

### 分析儀表板

跨 Agent、專案、任務、模型、Provider、Session 類型的多維度用量追蹤。以 Recharts 視覺化呈現，包含 Token/費用細分與每日摘要。

### 控制中心

任務看板（含 DoD/Artifact/Rollback 詳細資訊）、審批動作隊列、以及支援嚴重性過濾與時間窗口的審計時間軸。

### 技能管理

瀏覽、啟用/停用、刪除 Core 技能與 Workspace 技能。支援從檔案系統即時掃描並進行差異感知匯入。

### 設定

- **啟動器設定** — corePath、configPath、workspacePath、Gateway 連接埠（自動偵測或手動）、Daemon 開關、不受限模式
- **執行期設定** — 模型、授權方式、訊息平台/Token、主題、語言

### 其他

- **多實例支援** — 每個 Electron 程序擁有獨立的 `userData` 目錄（依 PID 隔離），多個實例可獨立運行，互不干擾
- **動態連接埠偵測** — 使用 `net.createServer()` 掃描 10000–60000 連接埠，自動為 Gateway 找到可用埠
- **聊天介面** — 浮動聊天元件，透過 `openclaw:chat.invoke` IPC 驅動，以 `openclaw:chat.chunk` 串流回應
- **更新橫幅** — 偵測新版本並在應用程式內提示
- **i18n** — 英文與繁體中文，透過 i18next 實作，可在執行期切換
- **MiniView** — 精簡的單卡片佈局，適合副螢幕使用

---

## 架構

```
NT-ClawLaunch/
├── frontend/
│   ├── electron/             # Electron main/preload + 類後端服務
│   │   ├── main.ts
│   │   ├── preload.js
│   │   ├── services/
│   │   └── utils/
│   ├── src/                  # React 應用（pages/components/hooks/store）
│   ├── test/                 # Vitest 測試
│   ├── scripts/              # 開發輔助腳本（例如清理連接埠）
│   ├── docs/                 # 前端專屬文件（如 E2E 情境）
│   └── package.json
├── docs/                     # 產品/設計/重構規劃文件
├── package.json              # 工作區腳本（pnpm --filter frontend ...）
├── README.md
├── README.en.md
└── DEVELOPMENT.md
```

---

## 快速開始

### 前置需求

- Node.js 18+
- npm 或 pnpm
- 已安裝 [OpenClaw CLI](https://openclaw.ai) 且在 `$PATH` 中

### 環境變數

目前此專案沒有必填的 `.env` / `.env.example` 檔案。執行期設定由桌面應用程式寫入 `~/Library/Application Support/NT-ClawLaunch/config.json`。

### 由工作區根目錄啟動

```bash
npm install
npm run dev      # 透過 pnpm --filter frontend dev 轉呼叫 frontend
```

### 開發模式

```bash
cd frontend
npm install
npm run dev        # 同時啟動 Vite（port 5173）與 Electron
```

### 生產建構

```bash
cd frontend
npm run build      # TypeScript + Vite → dist/ + dist-electron/
npm run dist       # electron-builder → release/*.dmg（macOS）
```

---

## 參與貢獻

歡迎提交 Pull Request。重大變更請先開 Issue 討論。

## 授權

[MIT](LICENSE)
