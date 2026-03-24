/**
 * Config and utility service
 * Includes all utility methods related to configuration and formatting
 */

export const ConfigService = {
  /**
   * Escape string for shell commands
   */
  shellQuote: (value: string): string => {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
  },

  /**
   * Normalize config directory path
   * Removes the trailing /openclaw.json
   */
  normalizeConfigDir: (rawPath: string): string => {
    const trimmed = (rawPath || '').trim();
    if (!trimmed) return '';
    return trimmed.replace(/[\\/]openclaw\.json$/i, '');
  },

  /**
   * Build OpenClaw environment variable prefix
   */
  buildOpenClawEnvPrefix: (configPath?: string, _corePath?: string): string => {
    const configDir = ConfigService.normalizeConfigDir(configPath || '');
    const configFilePath = configDir ? `${configDir}/openclaw.json` : '';
    const stateDirEnv = configDir ? `OPENCLAW_STATE_DIR=${ConfigService.shellQuote(configDir)} ` : '';
    const configPathEnv = configFilePath ? `OPENCLAW_CONFIG_PATH=${ConfigService.shellQuote(configFilePath)} ` : '';
    return `${stateDirEnv}${configPathEnv}`;
  },

};

/**
 * Model and provider related tools
 */
export const ModelService = {
  /**
   * Infer provider from model name
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
   * Get provider alias
   */
  getProviderAliases: (providerRef: string, PROVIDER_ALIAS_MAP: Record<string, string[]>): string[] => {
    const normalized = String(providerRef || '').trim().toLowerCase();
    if (!normalized) return [];
    return PROVIDER_ALIAS_MAP[normalized] || [normalized];
  },

  /**
   * Check if provider matches the filter criteria
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
   * Check if model is authorized
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
