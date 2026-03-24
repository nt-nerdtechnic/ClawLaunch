# Contributing Guide

Thank you for your interest in NT-ClawLaunch! We welcome all forms of community participation.

## Reporting Bugs

Search [GitHub Issues](https://github.com/your-org/NT-ClawLaunch/issues) for existing reports before opening a new one. A good bug report includes:

- **Concise title** — describe the specific problem
- **Steps to reproduce** — how to trigger the error again
- **Expected vs. actual behavior** — what should happen vs. what did happen
- **Environment info** — macOS version, Node.js version, OpenClaw CLI version

## Feature Suggestions

Open an Issue first so maintainers and the community can evaluate feasibility and direction before any code is written.

## Development Workflow

1. **Fork the repository** to your GitHub account.
2. **Create a branch** — all development should happen on a dedicated feature or bugfix branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Follow code standards** — the project uses ESLint. Run before submitting:
   ```bash
   npm run lint
   ```
4. **Submit a Pull Request**:
   - Describe what problem your changes solve
   - PR titles should follow Conventional Commits (e.g., `feat: add session scan filter`)

## Environment Setup

See the [Quick Start section in README.md](README.md#quick-start). No Rust toolchain is required — the project is pure TypeScript/JavaScript (Electron + React).

---

---

# 貢獻指南

感謝您對 NT-ClawLaunch 的關注！我們非常歡迎社群的參與。

## 如何回報 Bug

請先在 [GitHub Issues](https://github.com/your-org/NT-ClawLaunch/issues) 中搜尋是否已有相似的回報，再開啟新的 Issue。好的 Bug 回報包含：

- **簡潔的標題** — 描述具體問題
- **重現步驟** — 如何讓這個錯誤再次發生
- **預期行為與實際行為** — 您認為應該發生什麼，而實際上發生了什麼
- **環境資訊** — macOS 版本、Node.js 版本、OpenClaw CLI 版本

## 功能提案

請先在 Issue 中發起討論，讓維護者與社群一起評估可行性與發展方向，再開始撰寫程式碼。

## 開發流程

1. **Fork 儲存庫** 至您的個人 GitHub 帳號。
2. **建立分支** — 所有開發應在獨立的分支上進行：
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **遵守代碼風格** — 本專案使用 ESLint，提交前請執行：
   ```bash
   npm run lint
   ```
4. **提交 Pull Request**：
   - 描述您的變更解決了什麼問題
   - PR 標題請遵循 Conventional Commits 規範（例如：`feat: 新增 session 掃描過濾`）

## 開發環境設置

請參考 [README.md 的快速開始章節](README.md#快速開始)。本專案為純 TypeScript/JavaScript（Electron + React），**不需要** Rust 工具鏈。

---

感謝您的貢獻！
