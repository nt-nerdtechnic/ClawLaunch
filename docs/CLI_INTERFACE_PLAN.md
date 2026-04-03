# NT-ClawLaunch CLI Interface 實作計劃

> 目標：讓 NT-ClawLaunch Electron App 本身提供 CLI 介面，使 AI Agent 與終端用戶都能以命令列操控所有功能。

---

## 背景與動機

NT-ClawLaunch 目前的功能已透過 IPC `shell:exec` 全面模組化：

- 所有指令回傳統一格式 `{ code, stdout, stderr, exitCode }`
- 命令已按功能分組（app / config / control / gateway / skill / auth / project / snapshot / system）
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
  Shell Scripts   │   │   POST /exec                     │   │    (app / config / control
                  │   │   GET  /health                   │   │     / gateway / skill / auth
                  │   │   GET  /commands                 │   │     / project / snapshot / system)
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

## 實作項目清單

### Phase 1 — Electron 內嵌 CLI HTTP Server

**新增檔案：`frontend/electron/services/cli-server.ts`**

職責：
- 監聽 `127.0.0.1` 固定 port（預設 `19827`，可由 config 覆寫）
- 路由 `POST /exec` → 呼叫現有 `handle*Commands` handlers
- 路由 `GET /health` → 回傳版本、uptime、gateway 狀態
- 路由 `GET /commands` → 列出所有已知命令（供 AI discovery）
- App 啟動時寫入 `~/.clawlaunch/.cli-server.port`
- App 關閉時刪除 port file

**修改：`frontend/electron/main.ts`**
- 在 `app.whenReady()` 後啟動 CLI server
- 在 `app.on('before-quit')` 時停止 CLI server

---

### Phase 2 — 獨立 CLI Binary

**新增檔案：`scripts/clawlaunch.mjs`**

```
用法：
  clawlaunch <command> [args...]    執行命令
  clawlaunch list                   列出所有可用命令
  clawlaunch health                 確認 App 是否在執行
  clawlaunch <command> --format json|table|yaml|csv    指定輸出格式
```

行為：
1. 讀取 `~/.clawlaunch/.cli-server.port`（若不存在 → exit 69）
2. `POST http://127.0.0.1:<port>/exec` with `{ command, format }`
3. 將 `stdout` 印至 `process.stdout`，`stderr` 印至 `process.stderr`
4. 以 response 的 `exitCode` 作為 process exit code

**修改：`frontend/package.json`**
- 在根 `package.json` 加入 `"bin": { "clawlaunch": "scripts/clawlaunch.mjs" }`
- 加入 npm 安裝說明（`npm link` for dev, `npm install -g` for prod）

---

### Phase 3 — SKILL.md（選配，AI Agent Discovery）

**新增檔案：`SKILL.md`（專案根目錄）**

格式對齊 OpenCLI skill 規範，讓 Claude Code / Cursor / OpenClaw 能自動 discover 所有命令。

---

## Exit Code 語意（對齊 Unix sysexits.h）

| Code | 常數 | 意義 |
|---|---|---|
| 0 | OK | 成功 |
| 1 | ERR | 其他錯誤 |
| 2 | USAGE | 用法錯誤 / 未知命令 |
| 66 | EX_NOINPUT | 空結果（查詢無資料）|
| 69 | EX_UNAVAILABLE | App 未執行（port file 不存在）|
| 77 | EX_NOPERM | 需要認證 |
| 78 | EX_CONFIG | 設定錯誤 |
| 130 | SIGINT | Ctrl-C 中斷 |

---

## 命令對照表（現有 IPC → CLI）

| CLI 命令 | 對應 IPC 命令 | 說明 |
|---|---|---|
| `clawlaunch app:version` | `app:get-version` | 取得 App 版本 |
| `clawlaunch app:check-update` | `app:check-update` | 檢查更新 |
| `clawlaunch config:read` | `config:read` | 讀取 launcher 設定 |
| `clawlaunch config:write <json>` | `config:write <json>` | 寫入設定 |
| `clawlaunch gateway:status` | `gateway:status` | Gateway 狀態 |
| `clawlaunch gateway:start <cmd>` | `gateway:start <cmd>` | 啟動 Gateway |
| `clawlaunch gateway:stop` | `gateway:stop` | 停止 Gateway |
| `clawlaunch skill:list` | `skill:list` | 列出所有 Skill |
| `clawlaunch skill:install <id>` | `skill:install <id>` | 安裝 Skill |
| `clawlaunch auth:list` | `auth:list-profiles` | 列出認證 Profiles |
| `clawlaunch project:list` | `project:list` | 列出專案 |
| `clawlaunch project:init` | `project:initialize` | 初始化專案 |
| `clawlaunch snapshot:list` | `snapshot:list` | 列出 Snapshots |
| `clawlaunch control:status` | `control:auth:status` | 控制中心狀態 |
| `clawlaunch system:crontab:list` | `system:crontab:list` | 列出 Cron 任務 |
| `clawlaunch health` | _(server 內建)_ | Server 健康狀態 |
| `clawlaunch list` | _(server 內建)_ | 列出所有命令 |

---

## 安全考量

- HTTP server **只綁定 127.0.0.1**，不對外暴露
- 不提供任何 auth bypass 命令的 shortcut
- 所有輸入在 handler 層已有驗證，CLI 層不額外重複
- Port file 設定為僅擁有者可讀（`chmod 600`）

---

## 實作順序

```
Phase 1  [  ] cli-server.ts — 核心 HTTP server
Phase 1  [  ] main.ts 修改 — 啟動 / 停止 server
Phase 2  [  ] scripts/clawlaunch.mjs — CLI binary
Phase 2  [  ] package.json bin 登記
Phase 3  [  ] SKILL.md — AI discovery（選配）
```

---

## 測試計畫

1. **手動**：App 啟動後執行 `node scripts/clawlaunch.mjs list`，確認回傳命令清單
2. **健康檢查**：`node scripts/clawlaunch.mjs health` 回傳版本與狀態
3. **Exit code**：App 未開時執行任意命令 → 應 exit 69
4. **格式輸出**：`clawlaunch skill:list --format json` → 驗證 JSON 可被 `jq` 解析
5. **AI 整合**：在 Claude Code 的 AGENT.md 加入 `clawlaunch list`，驗證 AI 能自動 discover 工具

---

*最後更新：2026-04-03*
