## Plan: Launch Pad 功能對齊 Control Center
將 NT-ClawLaunch Launch Pad 在不改 UI 風格與現有框架前提下，分階段補齊 control-center 等級的可觀測性、治理與資訊揭露能力。做法是沿用現有 Electron IPC + Zustand + 現有頁籤，先補資料面與 API 對接，再補高價值功能面板，最後補審計與運維工具。

**Steps**
1. 建立能力差距矩陣與資料契約（*先決步驟*）：定義 Launch Pad 現有 Monitor/Analytics/Settings/Onboarding 欄位，對照目標能力（健康、告警、審計、重播、任務、用量細分、安全揭露）。
2. 強化資料入口（*依賴 1*）：新增標準化 IPC 命令層（health、sessions、tasks、projects、audit、replay、usage），讓前端不再依賴單一檔案解析作為主來源。
3. 擴展 Store 領域模型（*依賴 2*）：在 Zustand 新增 health、alerts、notificationQueue、auditTimeline、replayIndex、taskHeartbeat、connectionStatus、securitySummary、memoryStatus，並加入 TTL 與 stale 標記。
4. Monitor 功能升級（*依賴 3*）：在現有 Monitor 頁中增設「健康總覽、異常隊列、任務心跳、連線狀態」四區塊，保留現有卡片風格與布局節奏。
5. Analytics 深化（*依賴 3；可與 4 並行*）：擴增維度到 agent/project/task/model/provider/sessionType，加入 context pressure、subscription 狀態、connector TODO 解釋。
6. Settings 可觀測化（*依賴 3；可與 4/5 並行*）：新增安全閘門摘要、風險等級、更新狀態、資料接線狀態，改為「可解釋系統狀態」而非純欄位編輯。
7. 任務與審批操作鏈補齊（*依賴 3*）：新增 task board 細節、DoD/artifact/rollback 顯示、approval 動作結果回寫與操作審計可見。
8. 審計與重播中心（*依賴 3*）：新增 timeline、severity filter、from/to 視窗、回放統計（returned/filtered）與導出。
9. Onboarding Launch 強化（*依賴 2/3*）：完成後顯示接線健康、降級項目與下一步，不只顯示「成功/部分失敗」。
10. 驗證與回歸（*依賴 4-9*）：補單元測試與手動驗證清單，確保 gateway 啟停、權限 gate、資料降級、UI 退化皆可預期。

**Relevant files**
- /Users/neillu/Desktop/NT-ClawLaunch/frontend/src/App.tsx — 現有 tab 結構與主流程入口，承接新功能分區最小改動點。
- /Users/neillu/Desktop/NT-ClawLaunch/frontend/src/store.ts — 擴展狀態模型與快照同步機制核心位置。
- /Users/neillu/Desktop/NT-ClawLaunch/frontend/src/components/ActionCenter.tsx — 審批/動作隊列升級入口。
- /Users/neillu/Desktop/NT-ClawLaunch/frontend/src/components/Analytics.tsx — 用量多維拆解與 budget/subscription 顯示主戰場。
- /Users/neillu/Desktop/NT-ClawLaunch/frontend/src/components/StaffGrid.tsx — 人員狀態與任務上下文交叉揭露入口。
- /Users/neillu/Desktop/NT-ClawLaunch/frontend/src/components/MiniView.tsx — 關鍵指標精簡視圖同步補強。
- /Users/neillu/Desktop/NT-ClawLaunch/frontend/src/components/UpdateBanner.tsx — 更新狀態/風險提示的現有承載區。
- /Users/neillu/Desktop/NT-ClawLaunch/frontend/src/components/onboarding/SetupStepLaunch.jsx — 啟動後健康診斷與降級說明落點。
- /Users/neillu/Desktop/NT-ClawLaunch/frontend/electron/main.ts — 新增 IPC 命令與後端數據彙整橋接層。
- /Users/neillu/Desktop/NT-ClawLaunch/frontend/electron/preload.js — 安全暴露 renderer API 的邊界層。

**Verification**
1. 功能驗證：每個頁籤至少有 1 個新增高價值資訊區塊，且可在真實資料缺失時顯示降級原因。
2. 數據驗證：比較前後快照欄位覆蓋率，確認新增 health/alerts/audit/replay/task-heartbeat/connector 狀態。
3. 安全驗證：受保護操作需明確 token/gate 狀態提示；失敗時顯示可行修復建議。
4. 體驗驗證：不改設計語言（排版節奏、卡片視覺、互動方式維持一致），僅擴充功能內容。
5. 回歸驗證：gateway start/stop、onboarding、analytics 既有流程不可退化。

**Decisions**
- 僅做功能面深化，不改主題、視覺語言、框架（React + Electron + Zustand）。
- 優先「資訊揭露完整度」與「可操作性」，其次才是新交互形式。
- 採增量式交付，先讓資料可見，再逐步補齊操作閉環。

**Further Considerations**
1. 資料來源策略：以 Gateway API 為主，日誌解析為備援。建議避免長期依賴單一 log 檔作為主資料源。
2. 性能策略：保留目前輪詢節奏，新增快取 TTL 與 in-flight 去重，避免 renderer 頻繁重算。
3. 風險策略：先做 read-only 觀測能力，再逐步開放 mutation 操作面，降低誤操作風險。
