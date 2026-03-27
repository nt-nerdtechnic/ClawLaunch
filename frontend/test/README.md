# NT-ClawLaunch 前端測試指南

本專案使用 **Vitest** 作為單元測試框架，旨在確保核心邏輯的穩定性與正確性。

## 🧪 測試架構

- **測試工具**：Vitest, jsdom, @testing-library/react
- **測試目錄**：`frontend/test/`
- **設定檔**：`vitest.config.ts`

## 📊 測試完整性說明

目前的測試覆蓋了前端架構中邏輯最密集的五個核心部分：

### 1. 核心工具層 (`utils/`)
- **`shell.test.ts`**：嚴格驗證 `shellQuote` 函數。確保在不同作業系統與特殊字元（如 `$`, `;`, `!`, `'`）下，命令列參數能被正確逸出，防止命令注入風險。
- **`terminal.test.ts`**：驗證 `execInTerminal` 的指令生成邏輯。透過 Mock Electron API，確保生成的 `osascript` 字串符合 MacOS Terminal 的執行規範，並正確處理 `cwd` 與 `holdOpen` 等參數。

### 2. 資料常數層 (`constants/`)
- **`providers.test.ts`**：驗證 AI 模型供應商（Provider）與認證方式（AuthChoice）之間的映射關係。確保 OAuth 流程標記無誤，這對於前端 UI 渲染正確的登入流程至關重要。

### 3. 商務邏輯與服務層 (`services/`)
- **`configService.test.ts`**：
  - **路徑正規化**：確保設定檔路徑在不同平台（Unix/Windows）下的處理結果一致。
  - **模型推斷**：驗證從模型名稱（如 `claude-*`）自動推斷供應商（Anthropic）的邏輯，這影響了整個應用程式的自動化配置品質。

### 4. 狀態管理層 (`store.ts`)
- **`store.test.ts`**：這是專案最複雜的部分。測試內容包含：
  - **日誌容量管理**：驗證 Log 超過 100 筆時的自動裁剪。
  - **訊息流 (Streaming)**：模擬 SSE/Chunk 附加過程，確保 `appendChatChunk` 能正確更新狀態。
  - **未讀計數**：驗證當 Chat 視窗關閉時，AI 回覆是否能正確累積未讀通知。
  - **事件確認 (Ack)**：測試 Event Queue 的移轉邏輯。

## 🛠 如何維護測試

### 執行測試
```bash
pnpm test          # 執行一次性測試
pnpm test --watch  # 開啟監聽模式
pnpm test:ui       # 開啟視覺化測試面板
```

### 撰寫規範
1. **集中放置**：所有新測試應放置於 `frontend/test/` 目錄下。
2. **AAA 原則**：每個 `it` 區塊應遵循 Arrange (準備), Act (執行), Assert (斷言)。
3. **Mocking**：
   - 外部 API、Electron API 或複雜的 Web API（如 `localStorage`）應在 `test/setup.ts` 中統一 Mock 或在各測試中局部 Mock。

## 📈 未來擴充方向
- **組件測試**：針對 `components/` 下的高價值 UI 組件進行渲染測試。
- **E2E 測試**：引入 Playwright 進行跨進程（Main + Renderer）的整合測試。
