# NT-ClawLaunch CLI Interface 實作計劃

> 目標：讓 NT-ClawLaunch Electron App 本身提供 CLI 介面，使 AI Agent 與終端用戶都能以命令列操控所有功能。

---

## 背景與動機

NT-ClawLaunch 目前的功能已透過 IPC `shell:exec` 全面模組化（共 9 個 handler 模組，約 **55 個命令**）：

- 所有指令回傳統一格式 `{ code, stdout, stderr, exitCode }`
- 命令已按功能分組至 `electron/ipc/shell/` 各子模組
- 另有 `activity`、`usage`、`chat` 等獨立 IPC handler
- 缺少的只是一個「外部入口」讓 App 以外的程序也能呼叫這些命令

**參考專案**：[OpenCLI (jackwener/opencli)](https://github.com/jackwener/opencli) — 11.4k ⭐  
核心設計理念：Adapter 模式、標準化輸出、AI-first Discovery、Unix Exit Code 語意。

---

## 架構設計

```
                  ┌─────────────────────────────────────────┐
                  │         NT-ClawLaunch (Electron)         │
                  │                                          │
  Terminal User   │   ┌─────────────────────────────────┐   │
  AI Agent    ──► │   │   CLI HTTP Server (127.0.0.1)    │   │──► 現有 shell handlers
  Shell Scripts   │   │   POST /exec                     │   │
                  │   │   GET  /health                   │   │
                  │   │   GET  /commands                 │   │
                  │   └─────────────────────────────────┘   │
                  │          ↕ 寫入 port 檔                  │
                  │   ~/.clawlaunch/.cli-server.port         │
                  └─────────────────────────────────────────┘
                                      ▲
                  ┌───────────────────┘
                  │
        clawlaunch CLI Binary  (scripts/clawlaunch.mjs)
        讀取 port file → HTTP POST → 格式化輸出 → exit code
```

**關鍵原則**：
- 不修改任何現有 IPC handler
- HTTP server 只監聽 localhost（安全邊界）
- CLI binary 是薄包裝層，不含業務邏輯

---

## 完整命令清單（從程式碼分析）

### App — 應用程式管理

| IPC 命令 | CLI 用法 | 說明 |
|---|---|---|
| `app:get-version` | `clawlaunch app:version` | 取得 App 版本號 |
| `app:check-update` | `clawlaunch app:check-update` | 檢查 GitHub 最新 release |
| `app:quit` | `clawlaunch app:quit` | 關閉 App |
| _(server 內建)_ | `clawlaunch health` | Server 健康狀態（版本/uptime）|
| _(server 內建)_ | `clawlaunch list` | 列出所有可用命令（AI discovery）|

### Config — Launcher 設定

| IPC 命令 | CLI 用法 | 說明 |
|---|---|---|
| `config:read` | `clawlaunch config:read` | 讀取 launcher 設定（含 appVersion）|
| `config:write <json>` | `clawlaunch config:write <json>` | 寫入 launcher 設定 |
| `config:reset` | `clawlaunch config:reset` | 重置設定（清空 clawlaunch.json）|
| `config:probe <path>` | `clawlaunch config:probe <path>` | 探測指定路徑的 openclaw.json |
| `config:migrate-openclaw <json>` | `clawlaunch config:migrate` | 遷移 OpenClaw 設定 |
| `config:model-options <json>` | `clawlaunch config:model-options` | 取得可用模型選項清單 |
| `detect:paths <json>` | `clawlaunch detect:paths` | 自動偵測 corePath/configPath |

### Auth — 認證管理

| IPC 命令 | CLI 用法 | 說明 |
|---|---|---|
| `auth:list-profiles <json>` | `clawlaunch auth:list` | 列出認證 profiles（含 summary）|
| `auth:add-profile <json>` | `clawlaunch auth:add` | 新增認證 profile |
| `auth:remove-profile <json>` | `clawlaunch auth:remove` | 刪除認證 profile |
| `auth:create-agent <json>` | `clawlaunch auth:create-agent` | 建立新 Agent（含 profile）|
| `agent:list <json>` | `clawlaunch agent:list` | 列出所有 Agent |
| `agent:delete <json>` | `clawlaunch agent:delete` | 刪除 Agent |
| `agent:set-name <json>` | `clawlaunch agent:rename` | 重命名 Agent |
| `agent:auth-list <json>` | `clawlaunch agent:auth-list` | 查看 Agent 的認證設定 |

### Gateway — 服務閘道

| IPC 命令 | CLI 用法 | 說明 |
|---|---|---|
| `gateway:start-bg-json <json>` | `clawlaunch gateway:start <cmd>` | 背景啟動 Gateway 並 watchdog |
| `gateway:watchdogs-stop` | `clawlaunch gateway:stop` | 停止所有 watchdog |
| `gateway:http-watchdog-stop` | `clawlaunch gateway:http-watchdog:stop` | 停止 HTTP 健康檢查 watchdog |
| `gateway:http-watchdog-start-json <json>` | `clawlaunch gateway:http-watchdog:start` | 啟動 HTTP watchdog |

### Snapshot — 讀取模型快照

| IPC 命令 | CLI 用法 | 說明 |
|---|---|---|
| `snapshot:read-model <json>` | `clawlaunch snapshot:read` | 讀取並計算 Agent 執行狀態快照 |

快照內容包含：tasks（含 blocked 判斷）、governance events、audit timeline、daily digest、history。

### Control Center — 控制中心

| IPC 命令 | CLI 用法 | 說明 |
|---|---|---|
| `control:auth:status` | `clawlaunch control:auth:status` | 查詢是否需要 control token |
| `control:auth:set-token <json>` | `clawlaunch control:set-token` | 設定或更新 control token |
| `control:auto-sync` | `clawlaunch control:sync` | 自動同步 control center 狀態 |
| `control:overview` | `clawlaunch control:overview` | 整體狀態總覽（需 token）|
| `control:budget:get` | `clawlaunch control:budget` | 查看預算政策與使用狀況 |
| `control:budget:set-policy <json>` | `clawlaunch control:budget:set` | 設定預算政策 |
| `control:approvals:list` | `clawlaunch control:approvals:list` | 列出待審批請求 |
| `control:approvals:add <json>` | `clawlaunch control:approvals:add` | 新增審批請求 |
| `control:approvals:decide <json>` | `clawlaunch control:approvals:decide` | 批准或拒絕審批 |
| `control:tasks:list` | `clawlaunch control:tasks:list` | 列出任務清單 |
| `control:tasks:add <json>` | `clawlaunch control:tasks:add` | 新增任務 |
| `control:tasks:update-status <json>` | `clawlaunch control:tasks:status` | 更新任務狀態 |
| `control:tasks:delete <json>` | `clawlaunch control:tasks:delete` | 刪除任務 |
| `control:projects:list` | `clawlaunch control:projects:list` | 列出專案清單 |
| `control:projects:add <json>` | `clawlaunch control:projects:add` | 新增專案 |
| `control:queue:list` | `clawlaunch control:queue:list` | 列出命令佇列 |
| `control:queue:add <json>` | `clawlaunch control:queue:add` | 加入佇列命令 |
| `control:queue:ack <json>` | `clawlaunch control:queue:ack` | 確認佇列項目 |
| `control:audit:list` | `clawlaunch control:audit:list` | 查看稽核記錄 |

### Skills — 技能管理

| IPC 命令 | CLI 用法 | 說明 |
|---|---|---|
| `skill:import` | `clawlaunch skill:import <path>` | 匯入 Skill 資料夾（需含 SKILL.md）|
| `skill:delete <path>` | `clawlaunch skill:delete <path>` | 刪除 workspace skill |
| `skill:delete-core <json>` | `clawlaunch skill:delete-core` | 刪除 core skill |
| `skill:move-core <json>` | `clawlaunch skill:move-to-workspace` | 將 core skill 移至 workspace |
| `skill:move-to-core <json>` | `clawlaunch skill:move-to-core` | 將 workspace skill 升為 core |

### Project — 專案（OpenClaw Runtime）

| IPC 命令 | CLI 用法 | 說明 |
|---|---|---|
| `project:check-empty <path>` | `clawlaunch project:check-empty <path>` | 確認路徑是否為空目錄 |
| `project:get-versions <json>` | `clawlaunch project:versions` | 取得目前安裝版本資訊 |
| `project:initialize <json>` | `clawlaunch project:init` | 初始化 workspace（建立 AGENTS/SOUL/TOOLS 等結構）|
| `project:update <json>` | `clawlaunch project:update` | 更新 OpenClaw 至指定版本 |
| `project:rollback <json>` | `clawlaunch project:rollback` | 回滾至備份版本 |
| `project:list-backups <json>` | `clawlaunch project:backups` | 列出可用備份 |
| `project:uninstall <json>` | `clawlaunch project:uninstall` | 解除安裝 OpenClaw |
| `process:kill-all` | `clawlaunch process:kill-all` | 強制終止所有子程序 |
| `process:force-release` | `clawlaunch process:release` | 強制釋出 port lock |

### System — 系統排程

| IPC 命令 | CLI 用法 | 說明 |
|---|---|---|
| `system:crontab:list` | `clawlaunch crontab:list` | 列出 crontab 條目 |
| `system:crontab:toggle <json>` | `clawlaunch crontab:toggle` | 啟用/停用 crontab 條目 |
| `system:crontab:delete <json>` | `clawlaunch crontab:delete` | 刪除 crontab 條目 |
| `system:launchagents:list` | `clawlaunch launchagents:list` | 列出 macOS LaunchAgents |
| `system:launchagents:toggle <json>` | `clawlaunch launchagents:toggle` | 啟用/停用 LaunchAgent |
| `system:launchagents:delete <json>` | `clawlaunch launchagents:delete` | 刪除 LaunchAgent plist |
| `cron:list <json>` | `clawlaunch cron:list` | 列出 OpenClaw 排程任務 |
| `cron:trigger <json>` | `clawlaunch cron:trigger` | 手動觸發排程任務 |
| `cron:toggle <json>` | `clawlaunch cron:toggle` | 啟用/停用排程任務 |
| `cron:delete <json>` | `clawlaunch cron:delete` | 刪除排程任務 |
| `cron:update <json>` | `clawlaunch cron:update` | 更新排程任務設定 |
| `cron:reset-errors <json>` | `clawlaunch cron:reset-errors` | 清除排程任務錯誤記錄 |
| `cron:get-last-session-log <json>` | `clawlaunch cron:last-log` | 取得最后一次執行記錄 |

### Activity & Usage — 活動記錄與用量統計

| IPC channel | CLI 用法 | 說明 |
|---|---|---|
| `activity:events:list` | `clawlaunch activity:list` | 列出活動事件（含 filter）|
| `activity:scan:now` | `clawlaunch activity:scan` | 立即掃描 sessions 與 cron 狀態 |
| `activity:watch:restart` | `clawlaunch activity:watch:restart` | 重啟 file watcher |
| `usage:scan-sessions` | `clawlaunch usage:scan` | 掃描所有 sessions 彙總用量 |

---

## CLI 設計原則

### 命令結構
```
clawlaunch <namespace>:<verb> [--json <payload>] [--format json|table|yaml|csv]
```

- **namespace** 直接對應 IPC 前綴（`control`、`cron`、`agent`⋯）
- **--json** 傳遞結構化參數（取代 IPC 的 inline JSON string）
- **--format** 控制輸出格式，預設 `table`，機器讀取用 `json`

### Exit Code 語意（對齊 Unix sysexits.h）

| Code | 意義 |
|---|---|
| 0 | 成功 |
| 1 | 其他錯誤 |
| 2 | 用法錯誤 / 未知命令 |
| 66 | 空結果（查詢無資料）|
| 69 | App 未執行（port file 不存在）|
| 77 | 需要認證（control token 未設定）|
| 78 | 設定錯誤（缺少 configPath 等）|
| 130 | Ctrl-C 中斷 |

---

## 實作項目清單

### Phase 1 — Electron 內嵌 CLI HTTP Server

**新增：`frontend/electron/services/cli-server.ts`**

- 監聽 `127.0.0.1:19827`（可由 config 覆寫）
- `POST /exec` → 路由至現有 `handle*Commands` handlers
- `GET /health` → 版本、uptime、gateway 狀態
- `GET /commands` → 輸出命令清單（供 AI discovery）
- 啟動時寫 `~/.clawlaunch/.cli-server.port`，關閉時刪除

**修改：`frontend/electron/main.ts`**

- `app.whenReady()` 後啟動 CLI server
- `app.on('before-quit')` 時停止

---

### Phase 2 — 獨立 CLI Binary

**新增：`scripts/clawlaunch.mjs`**

行為：
1. 讀取 `~/.clawlaunch/.cli-server.port`（不存在 → exit 69，印出提示訊息）
2. `POST /exec` with `{ command, args, format }`
3. `stdout` → `process.stdout`，`stderr` → `process.stderr`
4. 以 response `exitCode` 作為 process exit code

**修改：`package.json`（根目錄）**

```json
"bin": { "clawlaunch": "scripts/clawlaunch.mjs" }
```

---

### Phase 3 — SKILL.md（AI Agent Discovery，選配）

**新增：`SKILL.md`（專案根目錄）**

格式對齊 OpenCLI skill 規範，讓 Claude Code / Cursor / OpenClaw 自動 discover 所有命令。

---

## 安全考量

- HTTP server **只綁定 127.0.0.1**，不對外暴露
- Port file 設定為僅擁有者可讀（`chmod 600`）
- 所有輸入驗證保留在原有 handler 層，CLI 層不重複
- `control:*` 命令保留 token gate，CLI 呼叫同樣受保護

---

## 測試計畫

1. **App 未開**：執行任意命令 → exit 69 + 清楚錯誤訊息
2. **健康檢查**：`clawlaunch health` → 回傳版本與 uptime
3. **Discovery**：`clawlaunch list` → 完整命令清單（JSON 可 parse）
4. **格式輸出**：`clawlaunch control:tasks:list --format json | jq .`
5. **Token gate**：未設 token 執行 `control:overview` → exit 77
6. **AI 整合**：在 AGENT.md 加入 `clawlaunch list`，Claude Code 自動 discover 工具

---

*最後更新：2026-04-10*
