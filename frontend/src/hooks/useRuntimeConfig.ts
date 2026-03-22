import { useState, useEffect } from 'react';

/**
 * 運行時配置 Hook
 * 管理 openclaw.json 相關的配置狀態和操作
 */
export function useRuntimeConfig(
  resolvedConfigDir: string,
  activeTab: string,
  detectedConfig: any,
  fallbackCorePath?: string,
  fallbackWorkspacePath?: string
) {
  const [runtimeProfile, setRuntimeProfile] = useState<any>(null);
  const [runtimeProfileError, setRuntimeProfileError] = useState('');
  const [runtimeDraftModel, setRuntimeDraftModel] = useState('');
  const [runtimeDraftBotToken, setRuntimeDraftBotToken] = useState('');
  const [runtimeDraftGatewayPort, setRuntimeDraftGatewayPort] = useState('');
  const [dynamicModelOptions, setDynamicModelOptions] = useState<any[]>([]);
  const [dynamicModelSource, setDynamicModelSource] = useState('');
  const [dynamicModelLoading, setDynamicModelLoading] = useState(false);

  const shellQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;

  // 探測運行時配置（全域，不限 tab，應用程式載入即執行）
  // 依序嘗試：設定區 → 工作區 → 核心區，三區輪詢確保能找到 openclaw.json
  useEffect(() => {
    const probeRuntimeConfig = async () => {
      if (!window.electronAPI) return;

      if (!resolvedConfigDir) {
        setRuntimeProfile(null);
        setRuntimeProfileError('尚未設定 Config Path，無法讀取 openclaw.json。');
        return;
      }

      // 建立三區候選路徑（設定區優先，去重）
      const candidates: string[] = [resolvedConfigDir];
      if (fallbackWorkspacePath?.trim() && fallbackWorkspacePath.trim() !== resolvedConfigDir) {
        candidates.push(fallbackWorkspacePath.trim());
      }
      if (fallbackCorePath?.trim() && fallbackCorePath.trim() !== resolvedConfigDir) {
        candidates.push(fallbackCorePath.trim());
      }

      for (const candidate of candidates) {
        try {
          const res = await window.electronAPI.exec(`config:probe ${shellQuote(candidate)}`);
          if (res.code === 0 && res.stdout) {
            setRuntimeProfile(JSON.parse(res.stdout));
            setRuntimeProfileError('');
            return;
          }
        } catch {
          // 繼續嘗試下一個候選路徑
        }
      }

      // 三區均未找到
      setRuntimeProfile(null);
      const checkedPaths = candidates.map(p => `${p}/openclaw.json`).join('、');
      setRuntimeProfileError(`找不到 openclaw.json：已搜尋 ${checkedPaths}，均不存在或無法讀取。`);
    };

    probeRuntimeConfig();
  }, [resolvedConfigDir, fallbackCorePath, fallbackWorkspacePath]);

  // 同步有效的運行時模型和 token
  useEffect(() => {
    if (activeTab !== 'runtimeSettings') return;
    
    const nextModel = String(runtimeProfile?.model || detectedConfig?.model || '').trim();
    const nextBotToken = String(runtimeProfile?.botToken || detectedConfig?.botToken || '').trim();
    const nextGatewayPort = String(runtimeProfile?.gateway?.port ?? '').trim();
    setRuntimeDraftModel(nextModel);
    setRuntimeDraftBotToken(nextBotToken);
    setRuntimeDraftGatewayPort(nextGatewayPort);
  }, [activeTab, runtimeProfile, detectedConfig]);

  // 加載動態模型選項
  const loadDynamicModelOptions = async (
    corePath: string,
    effectiveAuthorizedProviders: string[]
  ) => {
    if (!window.electronAPI || !resolvedConfigDir) {
      setDynamicModelOptions([]);
      setDynamicModelSource('');
      return;
    }

    setDynamicModelLoading(true);
    try {
      const payload = {
        corePath,
        configPath: resolvedConfigDir,
        providers: effectiveAuthorizedProviders,
      };
      const res = await window.electronAPI.exec(`config:model-options ${JSON.stringify(payload)}`);
      if ((res.code ?? res.exitCode) !== 0) {
        throw new Error(res.stderr || '讀取動態模型清單失敗');
      }
      const parsed = JSON.parse(res.stdout || '{}');
      const groups = Array.isArray(parsed?.groups)
        ? parsed.groups
            .map((group: any) => ({
              provider: String(group?.provider || group?.group || '').trim().toLowerCase() || 'unknown',
              group: String(group?.group || group?.provider || '').trim() || 'unknown',
              models: Array.isArray(group?.models) ? group.models.map((m: any) => String(m || '').trim()).filter(Boolean) : [],
            }))
            .filter((group: any) => group.models.length > 0)
        : [];
      setDynamicModelOptions(groups);
      setDynamicModelSource(String(parsed?.source || ''));
    } catch {
      setDynamicModelOptions([]);
      setDynamicModelSource('');
    } finally {
      setDynamicModelLoading(false);
    }
  };

  return {
    runtimeProfile,
    setRuntimeProfile,
    runtimeProfileError,
    runtimeDraftModel,
    setRuntimeDraftModel,
    runtimeDraftBotToken,
    setRuntimeDraftBotToken,
    runtimeDraftGatewayPort,
    setRuntimeDraftGatewayPort,
    dynamicModelOptions,
    setDynamicModelOptions,
    dynamicModelSource,
    setDynamicModelSource,
    dynamicModelLoading,
    setDynamicModelLoading,
    loadDynamicModelOptions,
  };
}
