# NT-ClawLaunch Frontend

這是一個使用 React + TypeScript + Vite 構建的前端應用程式，做為 NT-ClawLaunch 的管理介面。

## 系統需求
- Node.js 22+
- Git
- pnpm 或 npm

## 快速啟動

安裝相依套件：
```bash
npm install
```

啟動開發伺服器 (將開啟帶有設計感與 Tailwind 支持的功能介面)：
```bash
npm run dev
```

編譯生產版本：
```bash
npm run build
```

## 關於 Tailwind CSS (排版與設計感)
專案內建使用了 Tailwind CSS 大量 Utility Classes 建構具備科幻、現代化與深色設計感的 UI。
先前的跑版問題（介面完全沒有設計感）肇因於缺少設定檔與依賴。

目前已修復並補齊：
- `tailwindcss@4` 依賴及重新配置為 Tailwind v4 語法 (`@import "tailwindcss"`)
- 修復 `src/index.css` 缺少 `html, body, #root { height: 100% }` 導致的黑畫面問題
- 清除 `src/App.css` 殘存的 Vite 預設會破壞版面的 CSS
- 修復 `electron/main.ts` 中的 `code: stdout` 變數賦值 Bug

如果您新增了新的樣式卻沒有生效，請確認套件已正確安裝，並且不要刪除 `src/index.css` 頂部的 `@import "tailwindcss"` 引用。

> **版本紀錄**：已於 `fix/ui-layout` 分支完成版面黑畫面與跑版的全面修復。
