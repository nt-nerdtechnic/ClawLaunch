# NT-ClawLaunch E2E Scenarios

## Scope

This checklist validates five critical flows:

1. No gateway available
2. Missing/dirty snapshot data
3. Cross-section navigation regression
4. Onboarding OAuth provider routing
5. Existing onboarding end-to-end

## Preconditions

- Working directory: `frontend/`
- Build command available: `npm run build`
- App launched from Electron dev mode: `npm run dev`

---

## Scenario A: No Gateway

### Steps

1. Ensure no process is listening on the configured gateway port (default 18900).
2. Launch app and go to Monitor.
3. Verify gateway toggle remains in stopped/offline state.
4. Switch tabs in sequence: Monitor → Analytics → Skills → Settings → Monitor.
5. Open Action Center and verify empty states.

### Expected

- No white screen or runtime crash.
- Health section shows degraded/offline states only.
- Action Center shows empty hints instead of stack traces.
- Live Stream does not force browser/page focus.

---

## Scenario B: Missing Snapshot / Dirty Data

### Steps

1. Remove or rename runtime snapshot source file.
2. Reload app.
3. Go to Analytics.
4. Verify all sections render fallback state:
   - Usage window cards
   - Subscription window
   - Data connectors
   - Context pressure
   - Cost hotspots
5. Return to Monitor and open Task Operations section.

### Expected

- Analytics remains renderable (no blank page).
- Empty charts show placeholder text.
- Context and cost cards show no-data copy.
- Task board / approvals / evidence / event queue all show safe empty state.

---

## Scenario C: Regression Navigation

### Steps

1. Start with gateway stopped.
2. Cycle through all tabs 3 times.
3. In Monitor, interact with:
   - Task Operations (all blocks)
   - Staff Grid
   - Live Stream
4. In Analytics, switch period buttons: Today / 7d / 30d repeatedly.

### Expected

- No React error boundary fallback appears.
- No console-level uncaught exception.
- UI remains responsive and no auto-scroll page jumps.

---

## Scenario D: Onboarding OAuth Smoke Checklist

### Goal

Verify each OAuth option in onboarding triggers `openclaw models auth login` with the expected provider and method.

### Preconditions

- Open onboarding wizard and navigate to the model selection step.
- Enable terminal or command logging so the spawned OpenClaw command is visible.
- Stop after the external auth flow is launched; full login completion is not required for this smoke pass.

### Checklist

| Done | UI option | Expected provider | Expected method | Expected command fragment |
|------|-----------|-------------------|-----------------|--------------------------|
| [ ] | OpenAI Codex OAuth | `openai-codex` | `oauth` | `models auth login --provider openai-codex --method oauth` |
| [ ] | Google Gemini CLI OAuth | `google-gemini-cli` | `oauth` | `models auth login --provider google-gemini-cli --method oauth` |
| [ ] | Chutes OAuth | `chutes` | `oauth` | `models auth login --provider chutes --method oauth` |
| [ ] | Qwen Portal OAuth | `qwen-portal` | `device` | `models auth login --provider qwen-portal --method device` |

### Expected

- Every OAuth click routes to `openclaw models auth login`, not `openclaw onboard --auth-choice`.
- Provider and method match the table above.
- Browser/device auth flow opens without immediate CLI argument error.

---

## Scenario E: Existing Onboarding End-to-End

### Goal

Validate the full `existing` onboarding path from Welcome → Model → Messaging → Launch, including path hydration, auth validation, platform-specific channel validation, and launch readiness behavior.

### Preconditions

- Prepare one existing OpenClaw config directory with a valid `openclaw.json`.
- Ensure app can detect paths through `detect:paths`.
- Open onboarding wizard and choose the `existing` path.
- Keep onboarding logs visible in UI so each step result can be verified.

### Test Data Matrix

| Case | Config condition | Expected outcome |
|------|-----------------|-----------------|
| E1 | `openclaw.json` has valid auth profiles and selected platform channel | Full flow passes to completion |
| E2 | `openclaw.json` has channels, but missing currently selected `platform` channel | Fails at Messaging with explicit platform error |
| E3 | Missing/empty `configPath` | Fails at Model/Messaging with missing config path error |
| E4 | Existing flow without explicit `authChoice` in launcher config | Model step is not blocked by unsupported auth choice guard |

### Step-by-step Checklist

#### Step 1: Welcome (Choose Existing)

- [ ] Click `existing` in Welcome.
- [ ] Verify `corePath`, `configPath`, `workspacePath` are prefilled from detected config.
- [ ] Verify `authChoice` is also hydrated from detected config when available.
- [ ] Verify the wizard can continue to Model (no immediate reset or path wipe).

Acceptance: Prefilled paths match detected values from `detect:paths`. No unexpected overwrite to empty string for `configPath`/`workspacePath`.

#### Step 2: Model (Existing Validation)

- [ ] Click next on Model step without changing settings.
- [ ] Verify existing-user validation path is used (no forced new-project onboarding command path).
- [ ] For credentialless modes (`ollama` / `vllm`), verify dual-layer credential check is skipped.
- [ ] For credential modes, verify dual-layer auth persistence validation runs.

Acceptance: Existing flow is not blocked by `unsupported auth choice` guard. Log shows model validation success path.

Failure signal: `不支援或不安全的授權類型: unknown` appears for existing flow.

#### Step 3: Messaging (Platform-specific Validation)

- [ ] Keep `platform` as currently selected value (e.g. `telegram`).
- [ ] Click next on Messaging step.
- [ ] Verify onboarding checks the selected platform channel exists, not just "any channel exists".

Acceptance:
- If selected platform channel exists: step passes.
- If selected platform channel is missing: step fails with `目前選擇的通訊頻道未配置: <platform>`.

#### Step 4: Launch (Existing Final Verification)

- [ ] Continue to Launch step.
- [ ] Test with `installDaemon = true`: verify launch readiness checks execute.
- [ ] Test with `installDaemon = false`: verify only CLI availability check (`openclaw --version`) is required.
- [ ] Verify step finishes and onboarding completes without runtime crash.

Acceptance: Existing flow completes and returns to normal app state. No React error boundary, no onboarding dead-end.

### Regression Guard Checklist (Existing Flow)

- [ ] Existing + empty launcher `authChoice` does not block Model step.
- [ ] Existing selection does not clear detected paths unexpectedly.
- [ ] Messaging fails fast when selected platform channel is absent.
- [ ] Launch behavior differs correctly by `installDaemon` setting.

### Optional Evidence to Capture

- [ ] Screenshot: Welcome with prefilled detected paths.
- [ ] Screenshot: Messaging platform mismatch error (negative case E2).
- [ ] Screenshot: Launch success state for both daemon modes.
- [ ] Export/attach onboarding logs for each case (E1–E4).

---

## Final Verification Commands

Run from `frontend/`:

```bash
npm run lint
npm run build
```

## Release Gate

Release can proceed only when all scenarios pass and both verification commands exit with code 0.

---

---

# NT-ClawLaunch E2E 測試場景（繁體中文）

## 範圍

本清單驗證五個關鍵流程：

1. 無 Gateway 可用
2. 快照資料缺失或損毀
3. 跨頁籤導覽回歸
4. 安裝導引 OAuth 提供者路由
5. 現有安裝的完整 Onboarding 流程

## 前置條件

- 工作目錄：`frontend/`
- 建構指令可用：`npm run build`
- 應用程式以 Electron 開發模式啟動：`npm run dev`

---

## 場景 A：無 Gateway

### 步驟

1. 確認設定的 Gateway 連接埠（預設 18900）上無任何程序監聽。
2. 啟動應用程式並切換至 Monitor 頁籤。
3. 確認 Gateway 開關保持停止/離線狀態。
4. 依序切換頁籤：Monitor → Analytics → Skills → Settings → Monitor。
5. 開啟 Action Center 並確認空狀態顯示正常。

### 預期結果

- 不出現白畫面或執行期崩潰。
- Health 區塊僅顯示降級/離線狀態。
- Action Center 顯示空狀態提示，而非堆疊追蹤。
- Live Stream 不強制將焦點移至瀏覽器/頁面。

---

## 場景 B：快照缺失 / 資料損毀

### 步驟

1. 刪除或重新命名執行期快照來源檔案。
2. 重新載入應用程式。
3. 切換至 Analytics 頁籤。
4. 確認所有區塊皆以降級狀態顯示：
   - 用量視窗卡片
   - 訂閱視窗
   - 資料連線器
   - Context pressure
   - 費用熱點
5. 返回 Monitor 並開啟 Task Operations 區塊。

### 預期結果

- Analytics 頁面可正常渲染（無空白頁）。
- 空圖表顯示佔位文字。
- Context 與費用卡片顯示無資料文案。
- 任務看板、審批、證據、事件隊列皆顯示安全的空狀態。

---

## 場景 C：導覽回歸

### 步驟

1. 以 Gateway 停止狀態開始。
2. 依序切換所有頁籤，重複 3 次。
3. 在 Monitor 頁籤中操作：
   - Task Operations（所有區塊）
   - Staff Grid
   - Live Stream
4. 在 Analytics 頁籤中反覆切換時間段按鈕：Today / 7d / 30d。

### 預期結果

- 不出現 React error boundary 降級畫面。
- 無未捕捉的 console 例外。
- UI 保持響應，無自動捲動跳頁。

---

## 場景 D：Onboarding OAuth 冒煙測試

請參閱上方英文版的完整測試表格，確認每個 OAuth 選項觸發正確的 `openclaw models auth login` 指令及參數。

---

## 場景 E：現有安裝的完整 Onboarding 流程

請參閱上方英文版的完整步驟清單與測試矩陣（E1–E4）。

---

## 最終驗證指令

在 `frontend/` 目錄下執行：

```bash
npm run lint
npm run build
```

## 發行閘門

所有場景通過且以上兩條指令皆以 code 0 退出，方可進行發行。
