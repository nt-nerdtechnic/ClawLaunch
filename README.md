# NT-ClawLaunch

**NT-ClawLaunch** 是一個專為加速國際開源專案啟動而設計的自主協作與管理平台。它不僅僅是一個啟動器，更是一套整合前端介面與桌面端自動化控制的完整生態系統。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](CONTRIBUTING.md)

## 🚀 核心功能

*   **自主啟動嚮導 (Setup Wizard)：** 透過直覺的引導流程，幫助開發者快速配置模型、訊息配對與技能矩陣。
*   **環境自動化：** 整合 Electron IPC，提供一鍵式的 `git clone` 與 `pnpm install` 實作邏輯。
*   **即時監控面板：** 精緻的 Dashboard 視覺化，即時追蹤專案運行狀態與數據。
*   **一鍵更新機制：** 自動比對遠端版本並優雅執行更新。

## 📂 專案結構

*   `frontend/`：基於 React 與 Electron 的現代化 UI 介面。
*   `docs/`：完整的開發與使用者文件。
*   `vault/`：執行日誌與本地資料快照。

## 🧩 一鍵更新機制規格摘要

以下內容已由原本的 `shared/` 規格檔整併至 README：

*   **版本檢測**：啟動時檢查本地與遠端版本，若有更新即提示。
*   **更新執行**：透過桌面端 IPC 執行 `git pull` 與依賴安裝流程。
*   **進度可視化**：更新期間顯示執行日誌與狀態。
*   **完成重啟**：更新成功後提示重啟以套用新版本。

目前對應的 IPC 能力（概念）如下：

*   `check_version`：回傳 `local`、`remote`、`hasUpdate`。
*   `execute_update`：回傳 `success` 與 `logs`。

## 🛠 快速啟動

### 前置需求
*   Node.js (v18+)
*   pnpm
*   Rust (若需編譯後端)

### 安裝步驟
1.  **複製儲存庫**
    ```bash
    git clone https://github.com/your-org/NT-ClawLaunch.git
    cd NT-ClawLaunch
    ```
2.  **安裝依賴**
    ```bash
    pnpm install
    ```
3.  **啟動開發環境**
    ```bash
    npm run dev
    ```

## 🤝 參與貢獻

我們非常歡迎各種形式的貢獻！在開始之前，請務必閱讀 [CONTRIBUTING.md](CONTRIBUTING.md) 以瞭解我們的開發流程與程式碼規範。

## 📄 授權條款

本專案採用 [MIT License](LICENSE) 授權。
