# Onboarding UX Strategy

This document captures the core design principles behind NT-ClawLaunch's Setup Wizard. The goal is to reduce friction for developers who are setting up the OpenClaw AI gateway for the first time, without hiding important state from those who need to understand what is happening.

## Core Design Principles

### 1. Step-by-step progress (Stepper UI)

Avoid single long forms. The flow is structured as discrete, navigable steps:
`Welcome → (Initialize) → Model → Messaging → Skills → Launch`

Each step shows its position in the sequence (`Step N of 6`) to reduce anxiety and set expectations.

### 2. Transparent loading states

When background operations run (CLI calls, path scanning, daemon installation), the UI shows what is actually executing — not just a spinner. Command output is streamed in real time so users understand what the system is doing.

### 3. Contextual help without clutter

Complex operations (OAuth login, Telegram channel pairing, daemon installation) expose inline guidance at the point of need. Tooltips and expandable sections keep the main path clean while giving advanced details to those who want them.

### 4. Plain-language labels for technical concepts

Technical terms are translated into action-oriented language at the UI layer. Deep explanations are available on demand (tooltips, expandable blocks), not forced on every user.

### 5. Completion criteria over path presence

The onboarding wizard should not consider itself "done" just because a path was detected on disk. A complete session includes confirmed paths, at least one authorized model, a bound communication channel, and a verified CLI. Each of these has an explicit check in the Launch step.

---

## Implemented Flow (As-Is)

The actual code execution path is documented in [`LAUNCH_PAD_OPTIMIZATION_PLAN.md`](LAUNCH_PAD_OPTIMIZATION_PLAN.md) under "Current Onboarding Flow", including the Mermaid diagram and known decision-point risks.

---

---

# 安裝導引 UX 策略

本文件記錄 NT-ClawLaunch 安裝精靈背後的核心設計原則。目標是降低開發者首次設定 OpenClaw AI Gateway 的摩擦，同時不向需要了解系統狀態的使用者隱藏重要資訊。

## 核心設計原則

### 1. 步驟式流程（Stepper UI）

避免單一長表單。流程被拆分為可獨立導覽的步驟：
`Welcome → (Initialize) → Model → Messaging → Skills → Launch`

每個步驟顯示目前在流程中的位置（如「步驟 N / 6」），降低使用者焦慮並建立合理預期。

### 2. 透明的載入狀態

當背景操作執行時（CLI 呼叫、路徑掃描、Daemon 安裝），UI 顯示實際執行的內容，而不只是轉圈動畫。指令輸出以串流方式即時顯示，讓使用者理解系統正在做什麼。

### 3. 情境式說明，不干擾主流程

複雜操作（OAuth 登入、Telegram 頻道配對、Daemon 安裝）在需要的節點提供內嵌說明。Tooltip 與可展開區塊保持主流程簡潔，同時為需要深入了解的使用者提供詳細資訊。

### 4. 技術術語白話化

技術名詞在 UI 層轉換為以行動為導向的描述。深入解釋以 on-demand 形式（Tooltip、可展開區塊）提供，不強迫每位使用者閱讀。

### 5. 以完成度作為判斷標準，而非路徑是否存在

安裝精靈不應僅因偵測到磁碟上存在路徑就視為「已完成」。完整的 Onboarding 應包含：已確認的路徑、至少一個已授權的模型、已綁定的通訊頻道，以及已驗證的 CLI 可用性。Launch 步驟對每項都有明確的檢查。

---

## 目前實作流程（As-Is）

實際的程式碼執行路徑記錄於 [`LAUNCH_PAD_OPTIMIZATION_PLAN.md`](LAUNCH_PAD_OPTIMIZATION_PLAN.md) 的「Current Onboarding Flow」章節，包含 Mermaid 流程圖與已知的決策點風險。
