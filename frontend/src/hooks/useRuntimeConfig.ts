import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Runtime configuration hook
 * Manages openclaw.json related configuration states and operations
 */
export function useRuntimeConfig(
  resolvedConfigDir: string,
  activeTab: string,
  detectedConfig: any,
  fallbackCorePath?: string,
  fallbackWorkspacePath?: string
) {
  const { t } = useTranslation();
  const [runtimeProfile, setRuntimeProfile] = useState<any>(null);
  const [runtimeProfileError, setRuntimeProfileError] = useState('');
  const [runtimeDraftModel, setRuntimeDraftModel] = useState('');
  const [runtimeDraftBotToken, setRuntimeDraftBotToken] = useState('');
  const [runtimeDraftGatewayPort, setRuntimeDraftGatewayPort] = useState('');
  const [dynamicModelOptions, setDynamicModelOptions] = useState<any[]>([]);
  const [dynamicModelSource, setDynamicModelSource] = useState('');
  const [dynamicModelLoading, setDynamicModelLoading] = useState(false);

  const shellQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;

  // Detect runtime configuration (global, not limited to any tab, executes upon app load)
  // Try in order: config area → workspace area → core area; polling across these three zones ensures openclaw.json is found
  useEffect(() => {
    const probeRuntimeConfig = async () => {
      if (!window.electronAPI) return;

      if (!resolvedConfigDir) {
        setRuntimeProfile(null);
        setRuntimeProfileError(t('runtime.errors.missingConfigPath'));
        return;
      }

      // Create candidate paths (only restricted to the user-specified config area)
      const candidates: string[] = [resolvedConfigDir];

      for (const candidate of candidates) {
        try {
          const res = await window.electronAPI.exec(`config:probe ${shellQuote(candidate)}`);
          if (res.code === 0 && res.stdout) {
            setRuntimeProfile(JSON.parse(res.stdout));
            setRuntimeProfileError('');
            return;
          }
        } catch {
          // Continue trying the next candidate path
        }
      }

      // Not found in any of the three zones
      setRuntimeProfile(null);
      const checkedPaths = candidates.map(p => `${p}/openclaw.json`).join('、');
      setRuntimeProfileError(t('runtime.errors.configNotFound', { path: checkedPaths }));
    };

    probeRuntimeConfig();

    // 每 30 秒自動探測一次設定檔變動 (如手動修改 Port)
    const interval = setInterval(probeRuntimeConfig, 30000);
    return () => clearInterval(interval);
  }, [resolvedConfigDir, fallbackCorePath, fallbackWorkspacePath, t]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync valid runtime models and tokens
  useEffect(() => {
    if (activeTab !== 'runtimeSettings') return;
    
    const nextModel = String(runtimeProfile?.model || detectedConfig?.model || '').trim();
    const nextBotToken = String(runtimeProfile?.botToken || detectedConfig?.botToken || '').trim();
    const nextGatewayPort = String(runtimeProfile?.gateway?.port ?? '').trim();
    setRuntimeDraftModel(nextModel);
    setRuntimeDraftBotToken(nextBotToken);
    setRuntimeDraftGatewayPort(nextGatewayPort);
  }, [activeTab, runtimeProfile, detectedConfig]);

  // Load dynamic model options
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
        throw new Error(res.stderr || t('runtime.errors.loadDynamicModelsFailed'));
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
