# 貢獻指南 (Contributing Guide)

感謝您對 NT-ClawLaunch 的關注！我們非常歡迎社群的參與。以下是參與貢獻的一些基本原則與步驟。

## 🐞 如何回報 Bug？

如果您發現了 Bug，請先在 [GitHub Issues](https://github.com/your-org/NT-ClawLaunch/issues) 中搜尋是否已有相似的回報。若無，請開啟一個新的 Issue 並提供：
*   **簡潔的標題：** 描述具體問題。
*   **重現步驟：** 如何讓這個錯誤再次發生？
*   **預期行為與實際行為：** 您認為應該發生什麼，而實際上發生了什麼？
*   **環境資訊：** OS 版本、Node.js 版本等。

## 💡 功能提案

有好的點子嗎？請先在 Issue 中發起討論，讓維護者與社群一起評估可行性與發展方向。

## 💻 開發流程

1.  **Fork 儲存庫：** 將專案 Fork 到您的個人帳號下。
2.  **建立分支：** 所有的開發應在獨立的 Feature 或 Bugfix 分支上進行。
    ```bash
    git checkout -b feature/your-awesome-feature
    ```
3.  **遵守代碼風格：** 本專案使用 ESLint 與 Prettier。請在提交前執行：
    ```bash
    pnpm lint
    ```
4.  **提交 Pull Request (PR)：**
    *   描述您的變更解決了什麼問題。
    *   確保所有的測試均已通過。
    *   PR 標題請遵循 Conventional Commits 規範 (例如：`feat: 增加自動導航功能`)。

## 🛠 開發環境設置

請參考 `README.md` 中的快速啟動章節。如果您需要變動後端邏輯，請確保您的系統已安裝 Rust 工具鏈。

---

感謝您的貢獻，讓 NT-ClawLaunch 變得更好！
