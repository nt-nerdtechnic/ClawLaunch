/**
 * 配置和通用工具 Service
 * 包含所有與配置、格式化相關的工具方法
 */

export const ConfigService = {
  /**
   * 將字符串轉義用於 shell 命令
   */
  shellQuote: (value: string): string => {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
  },

  /**
   * 規範化配置目錄路徑
   * 移除末尾的 /openclaw.json
   */
  normalizeConfigDir: (rawPath: string): string => {
    const trimmed = (rawPath || '').trim();
    if (!trimmed) return '';
    return trimmed.replace(/[\\/]openclaw\.json$/i, '');
  },

  /**
   * 構建 OpenClaw 環境變數前綴
   */
  buildOpenClawEnvPrefix: (configPath?: string, _corePath?: string): string => {
    const configDir = ConfigService.normalizeConfigDir(configPath || '');
    const configFilePath = configDir ? `${configDir}/openclaw.json` : '';
    const stateDirEnv = configDir ? `OPENCLAW_STATE_DIR=${ConfigService.shellQuote(configDir)} ` : '';
    const configPathEnv = configFilePath ? `OPENCLAW_CONFIG_PATH=${ConfigService.shellQuote(configFilePath)} ` : '';
    return `${stateDirEnv}${configPathEnv}`;
  },

  /**
   * 解析和驗證 Gateway Port
   */
  resolveGatewayPortArg: (gatewayPort?: string | number): string | null => {
    const raw = String(gatewayPort ?? '').trim();
    if (!raw) return null;
    if (!/^\d+$/.test(raw)) return null;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return ` --port ${port}`;
  },

  /**
   * 解析 Gateway Port 用於前置檢查
   */
  resolveGatewayPortForPrecheck: (gatewayPort?: string | number): { port: number } | null => {
    const raw = String(gatewayPort ?? '').trim();
    if (!raw) return null;
    if (!/^\d+$/.test(raw)) return null;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { port };
  },

  /**
   * 檢查 Gateway 是否在配置的埠上監聽
   */
  isGatewayListeningOnConfiguredPort: async (gatewayPort?: string | number): Promise<boolean | null> => {
    if (!window.electronAPI) return null;
    const portInfo = ConfigService.resolveGatewayPortForPrecheck(gatewayPort);
    if (!portInfo) return null;

    try {
      const probeRes: any = await window.electronAPI.exec(
        `lsof -nP -iTCP:${portInfo.port} -sTCP:LISTEN`
      );
      const probeCode = probeRes.code ?? probeRes.exitCode;
      const probeOutput = String(probeRes.stdout || '').trim();
      return probeCode === 0 && !!probeOutput;
    } catch {
      return null;
    }
  },
};

/**
 * 模型和提供者相關工具
 */
export const ModelService = {
  /**
   * 從模型名稱推斷提供者
   */
  inferProviderFromModel: (modelRef: string): string => {
    const model = String(modelRef || '').trim().toLowerCase();
    if (!model) return '';
    if (model.includes('/')) {
      return model.split('/')[0];
    }
    if (model.startsWith('claude')) return 'anthropic';
    if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
    if (model.startsWith('gemini')) return 'google';
    if (model.startsWith('minimax')) return 'minimax';
    if (model.startsWith('kimi')) return 'moonshot';
    if (model.startsWith('grok')) return 'xai';
    if (model.startsWith('ollama')) return 'ollama';
    return '';
  },

  /**
   * 獲取提供者別名
   */
  getProviderAliases: (providerRef: string, PROVIDER_ALIAS_MAP: Record<string, string[]>): string[] => {
    const normalized = String(providerRef || '').trim().toLowerCase();
    if (!normalized) return [];
    return PROVIDER_ALIAS_MAP[normalized] || [normalized];
  },

  /**
   * 檢查提供者是否符合過濾條件
   */
  providerMatchesFilters: (
    providerRef: string,
    filters: string[],
    PROVIDER_ALIAS_MAP: Record<string, string[]>
  ): boolean => {
    const providerAliases = ModelService.getProviderAliases(providerRef, PROVIDER_ALIAS_MAP);
    if (filters.length === 0) return true;
    return filters.some((filter) => {
      const filterAliases = ModelService.getProviderAliases(filter, PROVIDER_ALIAS_MAP);
      return providerAliases.some((alias) => filterAliases.includes(alias));
    });
  },

  /**
   * 檢查模型是否被授權
   */
  isModelAuthorizedByProvider: (
    modelRef: string,
    effectiveAuthorizedProviders: string[],
    PROVIDER_ALIAS_MAP: Record<string, string[]>
  ): boolean => {
    const model = String(modelRef || '').trim().toLowerCase();
    if (!model || effectiveAuthorizedProviders.length === 0) return true;

    const runtimeAliases = new Set(
      effectiveAuthorizedProviders.flatMap((provider) =>
        ModelService.getProviderAliases(provider, PROVIDER_ALIAS_MAP)
      )
    );

    const inferredProvider = ModelService.inferProviderFromModel(model);
    if (!inferredProvider) return true;

    const inferredAliases = ModelService.getProviderAliases(inferredProvider, PROVIDER_ALIAS_MAP);
    return inferredAliases.some((alias) => runtimeAliases.has(alias));
  },
};
