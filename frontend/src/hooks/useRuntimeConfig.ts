import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import type { DetectedConfig } from '../store';

/**
 * Runtime configuration hook
 * Manages openclaw.json related configuration states and operations
 */
export function useRuntimeConfig(
  resolvedConfigDir: string,
  activeTab: string,
  detectedConfig: DetectedConfig | null,
  fallbackCorePath?: string,
  fallbackWorkspacePath?: string
) {
  const { t } = useTranslation();
  const runtimeProfile = useStore((s) => s.runtimeProfile);
  const setRuntimeProfile = useStore((s) => s.setRuntimeProfile);
  const [runtimeProfileError, setRuntimeProfileError] = useState('');
  const [runtimeDraftModel, setRuntimeDraftModel] = useState('');
  const [runtimeDraftBotToken, setRuntimeDraftBotToken] = useState('');
  const [runtimeDraftGatewayPort, setRuntimeDraftGatewayPort] = useState('');
  const [runtimeDraftCronMaxConcurrentRuns, setRuntimeDraftCronMaxConcurrentRuns] = useState(8);
  const [dynamicModelOptions, setDynamicModelOptions] = useState<Array<{ provider: string; group: string; models: string[] }>>([]);
  const [dynamicModelSource, setDynamicModelSource] = useState('');
  const [dynamicModelLoading, setDynamicModelLoading] = useState(false);
  const isLoadingModelOptionsRef = useRef(false);

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
  }, [resolvedConfigDir, fallbackCorePath, fallbackWorkspacePath, t]);  

  // Sync valid runtime models and tokens
  useEffect(() => {
    if (activeTab !== 'runtimeSettings') return;
    
    const nextModel = String(runtimeProfile?.model || detectedConfig?.model || '').trim();
    const nextBotToken = String(runtimeProfile?.botToken || detectedConfig?.botToken || '').trim();
    const nextGatewayPort = String((runtimeProfile?.gateway as Record<string, unknown> | null | undefined)?.port ?? '').trim();
    const nextCronMaxConcurrentRuns = Number((runtimeProfile?.cron as Record<string, unknown> | null | undefined)?.maxConcurrentRuns ?? 8) || 8;
    setRuntimeDraftModel(nextModel);
    setRuntimeDraftBotToken(nextBotToken);
    setRuntimeDraftGatewayPort(nextGatewayPort);
    setRuntimeDraftCronMaxConcurrentRuns(nextCronMaxConcurrentRuns);
  }, [activeTab, runtimeProfile, detectedConfig]);

  // Load dynamic model options
  const loadDynamicModelOptions = useCallback(
    async (corePath: string, effectiveAuthorizedProviders: string[], syncRemote = false) => {
      if (isLoadingModelOptionsRef.current) return;
      if (!window.electronAPI || !resolvedConfigDir) {
        setDynamicModelOptions([]);
        setDynamicModelSource('');
        return;
      }

      isLoadingModelOptionsRef.current = true;
      setDynamicModelLoading(true);
      try {
        console.log('[useRuntimeConfig] Starting loadDynamicModelOptions...', { syncRemote });
        const payload = {
          corePath,
          configPath: resolvedConfigDir,
          providers: effectiveAuthorizedProviders,
          syncRemote,
        };

        // 15 秒保值超時，避免後端卡死導致 UI 永久轉圈
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Sync timeout')), 15000)
        );

        const res = await Promise.race([
          window.electronAPI.exec(`config:model-options ${JSON.stringify(payload)}`),
          timeoutPromise,
        ]);

        console.log('[useRuntimeConfig] Received response from config:model-options', res);

        if ((res.code ?? res.exitCode) !== 0) {
          throw new Error(res.stderr || t('runtime.errors.loadDynamicModelsFailed'));
        }
        const parsed = JSON.parse(res.stdout || '{}');
        const groups = Array.isArray(parsed?.groups)
          ? parsed.groups
              .map((group: { provider?: unknown; group?: unknown; models?: unknown[] }) => ({
                provider: String(group?.provider || group?.group || '').trim().toLowerCase() || 'unknown',
                group: String(group?.group || group?.provider || '').trim() || 'unknown',
                models: Array.isArray(group?.models)
                  ? group.models.map((m: unknown) => String(m || '').trim()).filter(Boolean)
                  : [],
              }))
              .filter((group: { models: string[] }) => group.models.length > 0)
          : [];
        setDynamicModelOptions(groups);
        setDynamicModelSource(String(parsed?.source || ''));
      } catch (err) {
        console.error('[useRuntimeConfig] Error or timeout during model loading:', err);
        setDynamicModelOptions([]);
        setDynamicModelSource('');
      } finally {
        setDynamicModelLoading(false);
        isLoadingModelOptionsRef.current = false;
      }
    },
    [resolvedConfigDir, t]
  );

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
    runtimeDraftCronMaxConcurrentRuns,
    setRuntimeDraftCronMaxConcurrentRuns,
    dynamicModelOptions,
    setDynamicModelOptions,
    dynamicModelSource,
    setDynamicModelSource,
    dynamicModelLoading,
    setDynamicModelLoading,
    loadDynamicModelOptions,
  };
}
