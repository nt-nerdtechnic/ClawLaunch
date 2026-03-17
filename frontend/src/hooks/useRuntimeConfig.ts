import { useState, useEffect } from 'react';

/**
 * 運行時配置 Hook
 * 管理 openclaw.json 相關的配置狀態和操作
 */
export function useRuntimeConfig(
  resolvedConfigDir: string,
  activeTab: string,
  detectedConfig: any
) {
  const [runtimeProfile, setRuntimeProfile] = useState<any>(null);
  const [runtimeDraftModel, setRuntimeDraftModel] = useState('');
  const [runtimeDraftBotToken, setRuntimeDraftBotToken] = useState('');
  const [dynamicModelOptions, setDynamicModelOptions] = useState<any[]>([]);
  const [dynamicModelSource, setDynamicModelSource] = useState('');
  const [dynamicModelLoading, setDynamicModelLoading] = useState(false);

  const shellQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;

  // 探測運行時配置
  useEffect(() => {
    if (activeTab !== 'runtimeSettings') return;

    const probeRuntimeConfig = async () => {
      if (!resolvedConfigDir || !window.electronAPI) {
        setRuntimeProfile(null);
        return;
      }

      try {
        const res = await window.electronAPI.exec(`config:probe ${shellQuote(resolvedConfigDir)}`);
        if (res.code === 0 && res.stdout) {
          setRuntimeProfile(JSON.parse(res.stdout));
        } else {
          setRuntimeProfile(null);
        }
      } catch {
        setRuntimeProfile(null);
      }
    };

    probeRuntimeConfig();
  }, [activeTab, resolvedConfigDir]);

  // 同步有效的運行時模型和 token
  useEffect(() => {
    if (activeTab !== 'runtimeSettings') return;
    
    const nextModel = String(runtimeProfile?.model || detectedConfig?.model || '').trim();
    const nextBotToken = String(runtimeProfile?.botToken || detectedConfig?.botToken || '').trim();
    setRuntimeDraftModel(nextModel);
    setRuntimeDraftBotToken(nextBotToken);
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
    runtimeDraftModel,
    setRuntimeDraftModel,
    runtimeDraftBotToken,
    setRuntimeDraftBotToken,
    dynamicModelOptions,
    setDynamicModelOptions,
    dynamicModelSource,
    setDynamicModelSource,
    dynamicModelLoading,
    setDynamicModelLoading,
    loadDynamicModelOptions,
  };
}
