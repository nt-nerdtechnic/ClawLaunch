# OpenClaw JSON 配置頁面自動更新功能分析報告

**分析時間**：2026/3/31  
**分析範圍**：自動更新 OpenClaw 版本、配置頁面功能、Bug 檢查與缺漏修復

---

## 1. 功能架構概述

### 1.1 整體流程
```
前端 UI (RuntimeSettingsPage.tsx)
    ↓ [選擇版本 + 點擊更新]
Hook (useRuntimeActions.ts)
    ↓ [handleUpdateOpenClaw 函數]
Electron IPC [project:update] → 
    ↓
後端 (project-commands.ts)
    ├─ 下載 tarball (curl + tar)
    ├─ 安裝依賴 (pnpm install)
    └─ 更新完成
    ↓
前端自動重啟 Gateway
    ├─ Daemon 模式：pnpm openclaw gateway start
    └─ 非 Daemon 模式：execInTerminal
```

### 1.2 相關的核心文件
| 文件 | 功能 | 行數 |
|------|------|------|
| [RuntimeSettingsPage.tsx](frontend/src/pages/RuntimeSettingsPage.tsx#L200-L330) | 配置頁面 UI | 200-330 |
| [useRuntimeActions.ts](frontend/src/hooks/useRuntimeActions.ts#L248-L298) | 更新邏輯 Hook | 248-298 |
| [project-commands.ts](frontend/electron/ipc/shell/project-commands.ts#L283-L350) | 後端更新實現 | 283-350 |

---

## 2. 發現的 Bug 與缺漏

### 🔴 **BUG #1：I18n 翻譯完全缺失**
**優先級**：🔴 HIGH  
**類型**：功能缺陷  
**位置**：`src/locales/` 目錄

**症狀**：
- 在 `RuntimeSettingsPage.tsx` 中使用了 15+ 個 `t()` 翻譯鍵值
- 但在 `zh-TW.json` 和 `en.json` 中完全找不到相關定義
- 用戶看到的會是 `[runtime.update.title]` 之類的原始鍵值

**涉及的缺失鍵值**：
```javascript
// 版本管理相關
runtime.update.title                 // "OpenClaw 核心版本與更新"
runtime.update.currentVersion        // "當前版本"
runtime.update.versionLoading        // "版本偵測中..."
runtime.update.versionUnavailable    // "版本不可用"
runtime.update.selectVersion         // "選擇目標版本"
runtime.update.refreshVersions       // "刷新版本列表"
runtime.update.installedLabel        // "已安裝"
runtime.update.updateBtn             // "更新"
runtime.update.updating              // "更新中..."
runtime.update.missingCore           // "錯誤：未設定 Core Path"
runtime.update.started               // "開始更新至 {{version}}..."
runtime.update.failed                // "更新失敗：{{msg}}"
runtime.update.success               // "更新完成！"
runtime.update.restartingGateway     // "正在重啟 Gateway..."
runtime.update.gatewayRestarted      // "Gateway 已重啟"

// 設定相關
setupInitialize.versionSource        // "版本來源"
setupInitialize.latestSuffix         // "最新版"
```

**修復方案**：
需要在兩個本地化文件中補齊翻譯。

---

### 🔴 **BUG #2：版本列表獲取邏輯缺陷**
**優先級**：🔴 HIGH  
**類型**：邊界情況  
**位置**：[project-commands.ts#L30-L48](frontend/electron/ipc/shell/project-commands.ts#L30-L48)

**症狀**：
- 如果 `git ls-remote` 命令失敗（網絡問題、權限問題等），只會返回 `['main']`
- 無法區分「真正無版本」和「網絡失敗」的情況
- 用戶無法知道是否成功取得完整版本列表

**代碼**：
```typescript
gitProcess.on('close', (code) => {
  if (code !== 0) {
    // 問題：所有失敗都返回相同結果
    resolve({ code: 0, stdout: JSON.stringify(['main']), exitCode: 0 });
    return;
  }
  // ... 解析版本 ...
});
```

**具體風險**：
1. 用戶可能在網絡不穩定時看不到可用版本
2. 沒有超時保護（git 命令可能永遠卡住）
3. 沒有重試機制

**修復方案**：
- 增加超時限制（30 秒內完成）
- 區分失敗原因並返回詳細的錯誤信息
- 增加重試按鈕的反饋

---

### 🟡 **BUG #3：版本按鈕邏輯缺陷**
**優先級**：🟡 MEDIUM  
**類型**：UX 問題  
**位置**：[RuntimeSettingsPage.tsx#L317-L327](frontend/src/pages/RuntimeSettingsPage.tsx#L317-L327)

**症狀**：
```typescript
disabled={
  !config?.corePath?.trim() || 
  isUpdating || 
  (!!openClawVersion && selectedVersion === openClawVersion)  // ← 問題
}
```

**問題分析**：
- 當已安裝版本 = 選中版本時，按鈕被禁用
- 但實際上用戶可能想要「重新安裝」相同版本（修復損壞或重新初始化）
- 這不符合用戶期望

**修復建議**：
只在 `isUpdating` 時禁用，允許重新安裝相同版本。

---

### 🟡 **BUG #4：更新後 Gateway 重啟缺少驗證**
**優先級**：🟡 MEDIUM  
**類型**：穩定性問題  
**位置**：[useRuntimeActions.ts#L273-L293](frontend/src/hooks/useRuntimeActions.ts#L273-L293)

**症狀**：
```typescript
// 更新完成後，直接重啟 Gateway
await window.electronAPI.exec(`cd ${shellQuote(corePath)} && ...`);

// 問題：沒有等待前一個停止確實完成
await new Promise<void>((r) => setTimeout(r, 1500));  // ← 固定 1.5 秒

// 可能該版本的 Gateway 啟動變慢了
if (config.installDaemon) {
  await window.electronAPI.exec(`...pnpm openclaw gateway start`);
} else {
  await execInTerminal(`...pnpm openclaw gateway run --verbose --force`);
}
```

**風險**：
1. 固定等待時間可能不夠（新版本啟動變慢）
2. 沒有驗證 Gateway 是否真的重啟成功
3. 如果重啟失敗，用戶不知道需要手動重啟

**修復建議**：
- 動態等待 Gateway 完全停止（檢查 Port）
- 增加重啟後的驗證（檢查 `openclaw gateway status`）
- 失敗時提示用戶手動重啟

---

### 🟡 **BUG #5：下載失敗後無清理機制**
**優先級**：🟡 MEDIUM  
**類型**：資源管理  
**位置**：[project-commands.ts#L310-L318](frontend/electron/ipc/shell/project-commands.ts#L310-L318)

**症狀**：
```typescript
const downloadCmd = `curl -L ... | tar -xz --strip-components=1 -C ${shellQuote(corePath)}`;
const downloadRes = await runCommandWithStreaming(downloadCmd, ...);
if (downloadRes.code !== 0) {
  // 問題：直接返回失敗，不清理已下載的部分文件
  return { code: 1, stderr: downloadRes.stderr || ..., exitCode: 1 };
}
```

**具體後果**：
1. Core Path 會遺留部分解壓文件
2. 下次更新時可能產生衝突
3. 用戶必須手動清理，無法優雅地重試

**修復建議**：
- 在 Core Path 中建立臨時目錄 `_update_tmp`
- 下載到臨時目錄並驗證完整性
- 成功再進行原位置更新
- 失敗時清理臨時目錄

---

### 🟡 **BUG #6：依賴安裝失敗後無回滾**
**優先級**：🟡 MEDIUM  
**類型**：穩定性  
**位置**：[project-commands.ts#L320-L327](frontend/electron/ipc/shell/project-commands.ts#L320-L327)

**症狀**：
```typescript
const installRes = await runCommandWithStreaming(
  'zsh -ilc "pnpm install --no-frozen-lockfile" 2>&1 || ...',
  'Installing dependencies...'
);
if (installRes.code !== 0) {
  // 問題：不知道失敗前的狀態，無法回滾
  return { code: 1, stderr: detail || ..., exitCode: 1 };
}
```

**風險**：
1. 如果 `pnpm install` 因網絡中斷而失敗，`node_modules` 可能處於不一致狀態
2. 用戶下次啟動可能因缺少依賴而崩潰
3. 沒有 `pnpm install --frozen-lockfile` 的驗證

**修復建議**：
- 在下載前備份 `pnpm-lock.yaml` 和 `node_modules`
- 安裝失敗時恢復備份
- 或提供 `rollback` 命令

---

### 🟢 **BUG #7：版本字符串驗證缺失**
**優先級**：🟢 LOW  
**類型**：安全性  
**位置**：[useRuntimeActions.ts#L262-L265](frontend/src/hooks/useRuntimeActions.ts#L262-L265)

**症狀**：
```typescript
const res = await window.electronAPI.exec(`project:update ${JSON.stringify(payload)}`);
// payload = { corePath, version }
// 沒有驗證 version 字符串是否安全
```

**潛在風險**：
- 理論上 [project-commands.ts#L305](frontend/electron/ipc/shell/project-commands.ts#L305) 的 `validateVersionRef` 應該檢查
- 但代碼未顯示 `validateVersionRef` 的實現
- 如果沒有正確驗證，可能導致 Shell 注入風險

**修復建議**：
驗證 `validateVersionRef` 的實現是否充分。

---

## 3. 缺漏功能分析

### ❌ **MISSING #1：版本變更日誌 (Changelog)**

**現狀**：
- UI 中預留了 `checkUpdateChangelog` 的翻譯鍵
- 但 `RuntimeSettingsPage.tsx` 中沒有顯示 Changelog 的邏輯

**建議**：
- 在選擇版本時顯示該版本的 Changelog
- 從 GitHub Release API 獲取（需要額外的 IPC 命令）

---

### ❌ **MISSING #2：更新前的完整性檢查**

**現狀**：
- 只做了 `curl` 和 `tar` 的完整性檢查
- 沒有驗證 OpenClaw 版本是否與已安裝的依賴兼容

**建議**：
```bash
# 更新完成後執行
pnpm openclaw doctor --check-only
```

---

### ❌ **MISSING #3：更新進度顯示**

**現狀**：
```typescript
const unlisten = window.electronAPI.onLog?.((payload) => {
  addLog(payload.data.replace(/\n$/, ''), payload.source);
});
```
只是轉發日誌，沒有進度條

**建議**：
- 追蹤進度：下載進度、解壓進度、安裝進度
- 顯示 ETA

---

### ❌ **MISSING #4：自動備份機制**

**現狀**：
- 更新前沒有自動備份 `openclaw.json` 或 `.git` 信息
- 如果更新失敗，用戶可能無法恢復

**建議**：
- 在 `corePath` 中創建 `.backups/update-{timestamp}` 目錄
- 備份 `package.json` 和 `pnpm-lock.yaml`

---

### ❌ **MISSING #5：自動重試機制**

**現狀**：
- 如果網絡中斷，直接失敗
- 用戶必須手動重試整個更新流程

**建議**：
- 實現指數退避重試（3 次嘗試）
- 每次失敗後等待 5 秒

---

## 4. 資料來源與配置邏輯分析

### 4.1 版本列表取得流程
```
[RuntimeSettingsPage.tsx 第 195 行]
useEffect(() => { 
  void fetchAvailableVersions(); 
}, [])

    ↓

const fetchAvailableVersions = async () => {
  const res = await window.electronAPI.exec('project:get-versions');
  if (res.code === 0 && res.stdout?.trim()) {
    const parsed = JSON.parse(res.stdout);
    setAvailableVersions(parsed);
  }
}

    ↓

[project-commands.ts 第 30-48 行]
if (fullCommand.startsWith('project:get-versions')) {
  const repoUrl = 'https://github.com/openclaw/openclaw.git';
  // git ls-remote --tags {repoUrl}
  // 返回 ['main', 'v2026.3.5', 'v2026.3.4', ...]
}
```

**分析**：
- ✅ 動態獲取版本（GitHub repo）
- ✅ 按時間倒序排列
- ❌ 沒有緩存機制（每次都重新獲取）
- ❌ 沒有超時保護

### 4.2 openclaw.json 配置監測流程
```
[RuntimeSettingsPage.tsx 第 80-90 行]
useEffect(() => {
  window.electronAPI.exec(`cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw --version`)
    .then(res => {
      const match = res.stdout.match(/\d{4}\.\d+\.\d+/);
      if (match) setOpenClawVersion('v' + match[0]);
    });
}, [config.corePath]);
```

**分析**：
- ✅ 每當 `corePath` 變化時重新檢測版本
- ❌ 沒有快取，頻繁執行
- ❌ 沒有超時保護
- ❌ 失敗時沒有錯誤提示

---

## 5. 詳細修復建議

### 🔧 **修復優先級序列**

| 優先級 | Bug ID | 工作量 | 風險 |
|--------|--------|--------|------|
| P0 | #1 (I18n) | 2 小時 | 低 |
| P1 | #2 (版本列表) | 3 小時 | 中 |
| P1 | #3 (按鈕邏輯) | 0.5 小時 | 低 |
| P1 | #4 (Gateway 驗證) | 2 小時 | 中 |
| P2 | #5 (下載清理) | 2 小時 | 低 |
| P2 | #6 (回滾機制) | 3 小時 | 中 |
| P3 | #7 (版本驗證) | 1 小時 | 低 |

### 🛠️ **具體修復清單**

#### 修復 #1：I18n 翻譯補齊
```json
// src/locales/zh-TW.json 補充
{
  "runtime": {
    "update": {
      "title": "OpenClaw 核心版本與更新",
      "currentVersion": "當前版本",
      "versionLoading": "版本偵測中...",
      "versionUnavailable": "版本不可用（未設定 Core Path）",
      "selectVersion": "選擇目標版本",
      "refreshVersions": "刷新版本清單",
      "installedLabel": "已安裝",
      "updateBtn": "更新至此版本",
      "updating": "更新中...",
      "missingCore": "錯誤：未配置 Core Path，無法更新",
      "started": "開始更新至 {{version}}...",
      "failed": "更新失敗：{{msg}}",
      "success": "版本更新完成！",
      "restartingGateway": "更新完成，正在重啟 Gateway...",
      "gatewayRestarted": "Gateway 已重啟，更新流程完全結束"
    }
  },
  "setupInitialize": {
    "versionSource": "GitHub",
    "latestSuffix": "最新版"
  }
}
```

#### 修復 #2：版本列表超時與錯誤處理
```typescript
// project-commands.ts 修改
if (fullCommand.startsWith('project:get-versions')) {
  try {
    const repoUrl = 'https://github.com/openclaw/openclaw.git';
    
    return new Promise<CommandResult>((resolve) => {
      const gitProcess = spawn(`git ls-remote --tags ${repoUrl}`, { 
        shell: true,
        timeout: 30000  // 新增：30 秒超時
      });
      
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      
      // 新增：超時保護
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        gitProcess.kill();
      }, 30000);
      
      gitProcess.stdout.on('data', (data: Buffer) => { 
        stdout += data.toString(); 
      });
      
      gitProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      
      gitProcess.on('close', (code) => {
        clearTimeout(timeoutHandle);
        
        if (timedOut) {
          // 超時：返回快取或 fallback
          resolve({ 
            code: 0, 
            stdout: JSON.stringify(['main']),
            exitCode: 0,
            warning: 'Version list fetch timed out, using fallback'
          });
          return;
        }
        
        if (code !== 0) {
          // 網絡失敗：返回詳細錯誤
          resolve({ 
            code: 0,  // 保持兼容性
            stdout: JSON.stringify(['main']),
            exitCode: 0,
            error: stderr || `git ls-remote failed (code ${code})`
          });
          return;
        }
        
        const tags = stdout
          .split('\n')
          .filter(line => line.includes('refs/tags/'))
          .map(line => line.split('refs/tags/')[1].replace('^{}', ''))
          .filter((v, i, a) => a.indexOf(v) === i)
          .reverse();
        
        resolve({ 
          code: 0, 
          stdout: JSON.stringify(['main', ...tags]), 
          exitCode: 0 
        });
      });
    });
  } catch (e) {
    return { 
      code: 1, 
      stderr: (e as Error)?.message || 'get versions failed', 
      exitCode: 1 
    };
  }
}
```

#### 修復 #3：版本按鈕邏輯調整
```typescript
// RuntimeSettingsPage.tsx 行 317-327
<button
  type="button"
  onClick={() => void handleUpdateOpenClaw(selectedVersion)}
  disabled={
    !config?.corePath?.trim() || 
    isUpdating  // 移除版本比較邏輯，允許重新安裝
  }
  className="..."
>
  {isUpdating ? (
    <><Loader2 size={14} className="animate-spin" /><span>{t('runtime.update.updating')}</span></>
  ) : (
    <><span>🔄</span><span>{t('runtime.update.updateBtn')}</span></>
  )}
</button>
```

#### 修復 #4：Gateway 重啟驗證
```typescript
// useRuntimeActions.ts handleUpdateOpenClaw 函數修改
const handleUpdateOpenClaw = async (targetVersion: string) => {
  if (!config.corePath?.trim()) {
    addLog(t('runtime.update.missingCore'), 'stderr');
    return;
  }
  const version = targetVersion.trim() || 'main';
  setIsUpdating(true);
  addLog(t('runtime.update.started', { version }), 'system');

  const unlisten = window.electronAPI.onLog?.((payload) => {
    const text = payload.data.replace(/\n$/, '');
    if (text) addLog(text, payload.source);
  });

  try {
    const payload = { corePath: config.corePath, version };
    const res = await window.electronAPI.exec(`project:update ${JSON.stringify(payload)}`);

    if ((res.code ?? res.exitCode) !== 0) {
      addLog(t('runtime.update.failed', { msg: res.stderr || `exit ${res.code}` }), 'stderr');
      return;
    }

    addLog(t('runtime.update.success'), 'system');
    addLog(t('runtime.update.restartingGateway'), 'system');
    
    const envPrefix = buildOpenClawEnvPrefix();
    const corePath = config.corePath;

    // 新增：等待 Gateway 完全停止
    await window.electronAPI.exec(
      `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw gateway stop`
    ).catch(() => {});

    // 新增：動態等待（最多 10 秒）
    let waited = 0;
    const checkPort = async (): Promise<boolean> => {
      const port = ((runtimeProfile?.gateway as Record<string, unknown>) ?? {}).port;
      if (!port) return true;
      const res = await window.electronAPI.exec(`lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null | wc -l`);
      return String(res.stdout || '0').trim() === '0';
    };

    while (waited < 10000 && !(await checkPort())) {
      await new Promise<void>((r) => setTimeout(r, 500));
      waited += 500;
    }

    if (config.installDaemon) {
      await window.electronAPI.exec(
        `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw gateway start`
      ).catch(() => {});
    } else {
      await execInTerminal(
        `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw gateway run --verbose --force`,
        { title: 'OpenClaw Gateway', holdOpen: false, cwd: corePath }
      );
    }

    // 新增：驗證 Gateway 是否成功重啟
    await new Promise<void>((r) => setTimeout(r, 3000));
    const statusRes = await window.electronAPI.exec(
      `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw gateway status`
    ).catch(() => ({ code: 1, stderr: 'status check failed' }));

    if ((statusRes.code ?? 1) !== 0) {
      addLog(t('runtime.update.gatewayWarning', { msg: '請手動驗證 Gateway 是否正常啟動' }), 'stderr');
    } else {
      addLog(t('runtime.update.gatewayRestarted'), 'system');
    }
  } catch (e: unknown) {
    addLog(t('runtime.update.failed', { msg: e instanceof Error ? e.message : String(e) }), 'stderr');
  } finally {
    unlisten?.();
    setIsUpdating(false);
  }
};
```

---

## 6. 測試建議

### 測試用例 #1：正常更新流程
```
1. 設定 Core Path
2. 點擊「刷新版本清單」
3. 選擇不同版本
4. 點擊更新
5. 驗證版本號變更
6. 驗證 Gateway 正常重啟
```

### 測試用例 #2：版本列表取不到
```
1. 斷開網絡
2. 點擊「刷新版本清單」
3. 驗證是否提示錯誤或返回 fallback
4. 恢復網絡，重試
```

### 測試用例 #3：更新失敗恢復
```
1. Core Path 磁盤空間不足
2. 開始更新
3. 驗證是否清理臨時文件
4. 驗證原版本是否可恢復
```

---

## 7. 性能優化建議

| 項目 | 現狀 | 建議 | 效果 |
|------|------|------|------|
| 版本列表 | 每次都 git ls-remote | 緩存 5 分鐘 | 減少網絡請求 90% |
| 版本檢測 | 每次都 `pnpm openclaw --version` | 緩存到 localStorage | 減少 CLI 調用 |
| 下載 | 單線程 tarball | 改用 Git shallow clone | 更快（已部分支持） |
| 安裝 | `--no-frozen-lockfile` | 優先用 `--frozen-lockfile` | 更確定的依賴版本 |

---

## 8. 總結

### 發現的問題統計
- 🔴 **嚴重 Bug**：2 個 (I18n 缺失、版本列表邏輯)
- 🟡 **中等 Bug**：4 個 (按鈕、Gateway、清理、回滾)
- 🟢 **輕微 Bug**：1 個 (版本驗證)
- ❌ **缺失功能**：5 個 (Changelog、完整性檢查、進度、備份、重試)

### 建議的修復時間表
- **第一週**：修復所有 P0/P1 Bug (~6 小時)
- **第二週**：實現缺失功能 (~12 小時)
- **第三週**：完整測試與性能優化 (~8 小時)

### 最關鍵的三件事
1. 補齊 I18n 翻譯（用戶看不懂界面）
2. 增加版本列表超時保護（避免 UI 卡住）
3. 自動驗證 Gateway 重啟（確保更新成功）
