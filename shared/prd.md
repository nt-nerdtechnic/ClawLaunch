# PRD: 一鍵更新機制 (One-Click Update)

## 1. 產品目標
降低用戶維護 OpenClaw Core 的門檻，實現無需透過終端機即可完成系統升級。

## 2. 功能清單
- **[FE/BE] 版本檢測**：每次啟動時自動對比本地版本與 GitHub Remote 版本。
- **[UI] 更新提醒**：若有新版本，在 Dashboard 顯示顯眼的更新橫幅 (Banner)。
- **[BE] 更新執行**：呼叫 `git pull` 與 `pnpm install`。
- **[UI/FE] 進度可視化**：在 UI 顯示更新進度條與當前執行的步驟。
- **[FE] 重啟提示**：更新完成後顯示「立即重啟以套用更新」按鈕。

## 3. 邏輯流程
1. Dashboard 載入 -> 觸發版本檢查 API。
2. 若有新版 -> UI 顯示 Update Banner -> 用戶點擊「立即更新」。
3. 進入 Updating 狀態 -> 鎖定 UI 避免操作 -> 執行 `git pull` -> 執行 `pnpm install`。
4. 更新成功 -> 顯示 Success Modal -> 點擊重啟 -> 程式重新載入。

## 4. 驗證準則
- 更新過程中若網路中斷應有報錯提示。
- 更新完成後應正確顯示新版本號。
