# NT-ClawLaunch 開發與打包指南 🚀

這份指南將告訴您如何自行打包與重啟您的 NT-ClawLaunch 機甲。

## 常用指令 (scripts)

請在 `/Users/neillu/Desktop/NT-ClawLaunch/frontend` 目錄下執行：

### 1. 開發模式 (熱重載) ⚡
如果您正在修改代碼並希望立即看到結果：
```bash
npm run dev
```
這會同時啟動 Vite (前端) 與 Electron (外殼)，並支援代碼更改後的自動刷新。

### 2. 生產環境打包 📦
當您完成所有修復，想要驗證代碼在正式環境的編譯狀況：
```bash
npm run build
```
這會生成 `dist` (Vite) 與 `dist-electron` (後端解析邏輯) 目錄。

### 3. 本地預覽編譯版 🔍
執行已 build 好的成品（需先執行完 build）：
```bash
cross-env NODE_ENV=production electron .
```

---

## 打包流程解密

1. **前端編譯**：使用 `vite` 將 React 代碼壓縮並輸出至 `dist`。
2. **Electron 編譯**：使用 `tsc` (TypeScript) 將 `electron/main.ts` 編譯至 `dist-electron/main.js`。
3. **路徑同步**：確保 `preload.js` 同步複製到輸出目錄，否則視窗會無法呼叫系統 API。

## 故障排除

- **黑畫面**：通常是因為 Vite 伺服器還沒準備好 Electron 就啟動了。請關閉進程並重新執行 `npm run dev`。
- **解析失效**：如果您修改了 `main.ts` 但沒看到效果，請確保執行了 `npm run build:electron` 或直接使用 `npm run dev` (它會自動幫您重新編譯)。

---

*祝您狩獵愉快！* 🦞✨
