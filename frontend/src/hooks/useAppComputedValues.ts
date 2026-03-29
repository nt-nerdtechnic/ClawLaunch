import { useCallback, useMemo } from 'react';
import type { TFunction } from 'i18next';
import { ModelService } from '../services/configService';
import { PROVIDER_ALIAS_MAP, PROVIDER_MODEL_CATALOGUE } from '../constants/providers';
import type { AuthProfileRow } from './useAuthProfiles';

export type ModelOptionGroup = {
  provider: string;
  group: string;
  models: string[];
};

type UseAppComputedValuesParams = {
  runtimeProfile: Record<string, unknown> | null | undefined;
  authProfiles: AuthProfileRow[];
  dynamicModelOptions: ModelOptionGroup[];
  runtimeDraftModel: string;
  corePath: string;
  workspacePath: string;
  resolvedConfigDir: string;
  resolvedConfigFilePath: string;
  t: TFunction;
};

export function useAppComputedValues({
  runtimeProfile,
  authProfiles,
  dynamicModelOptions,
  runtimeDraftModel,
  corePath,
  workspacePath,
  resolvedConfigDir,
  resolvedConfigFilePath,
  t,
}: UseAppComputedValuesParams) {
  const runtimeProviders: string[] = ((runtimeProfile?.providers as string[] | undefined) ?? []);

  const healthyAuthProviders = useMemo(
    () => Array.from(new Set(
      authProfiles
        .filter((profile) => profile.agentPresent && profile.credentialHealthy)
        .map((profile) => String(profile.provider || profile.profileId.split(':')[0] || '').toLowerCase())
        .filter(Boolean)
    )),
    [authProfiles]
  );

  const effectiveAuthorizedProviders = useMemo(
    () => (healthyAuthProviders.length > 0
      ? healthyAuthProviders
      : runtimeProviders.map((provider) => String(provider || '').toLowerCase()).filter(Boolean)),
    [healthyAuthProviders, runtimeProviders]
  );

  const fallbackModelOptions: ModelOptionGroup[] = useMemo(
    () => (effectiveAuthorizedProviders.length > 0
      ? effectiveAuthorizedProviders
          .map((provider) => {
            const entry = PROVIDER_MODEL_CATALOGUE[provider.toLowerCase()];
            return entry ? { provider: provider.toLowerCase(), group: entry.label, models: entry.models } : null;
          })
          .filter(Boolean) as ModelOptionGroup[]
      : Object.entries(PROVIDER_MODEL_CATALOGUE).map(([provider, entry]) => ({ provider, group: entry.label, models: entry.models }))),
    [effectiveAuthorizedProviders]
  );

  const availableModelOptions: ModelOptionGroup[] = useMemo(
    () => (dynamicModelOptions.length > 0 ? dynamicModelOptions : fallbackModelOptions),
    [dynamicModelOptions, fallbackModelOptions]
  );

  const visibleModelOptions: ModelOptionGroup[] = useMemo(
    () => availableModelOptions.filter(({ provider }) =>
      ModelService.providerMatchesFilters(provider, effectiveAuthorizedProviders, PROVIDER_ALIAS_MAP)
    ),
    [availableModelOptions, effectiveAuthorizedProviders]
  );

  const modelOptionGroups = useMemo(
    () => (visibleModelOptions.length > 0 ? visibleModelOptions : availableModelOptions),
    [visibleModelOptions, availableModelOptions]
  );

  const authorizedProvidersKey = useMemo(
    () => effectiveAuthorizedProviders.join('|'),
    [effectiveAuthorizedProviders]
  );

  const selectedModelProvider = useMemo(
    () => ModelService.inferProviderFromModel(runtimeDraftModel),
    [runtimeDraftModel]
  );

  const isModelAuthorizedByProvider = useCallback(
    (modelRef: string) => ModelService.isModelAuthorizedByProvider(modelRef, effectiveAuthorizedProviders, PROVIDER_ALIAS_MAP),
    [effectiveAuthorizedProviders]
  );

  const selectedModelAuthorized = useMemo(
    () => !runtimeDraftModel.trim() || isModelAuthorizedByProvider(runtimeDraftModel),
    [runtimeDraftModel, isModelAuthorizedByProvider]
  );

  const authorizedProviderBadges = useMemo(
    () => Array.from(new Set(
      healthyAuthProviders.length > 0
        ? healthyAuthProviders
        : runtimeProviders.map((provider) => String(provider || '').toLowerCase()).filter(Boolean)
    )),
    [healthyAuthProviders, runtimeProviders]
  );

  const getProviderDisplayLabel = useCallback(
    (providerRef: string, fallbackLabel?: string) => {
      const normalized = String(providerRef || '').trim().toLowerCase();
      return PROVIDER_MODEL_CATALOGUE[normalized]?.label || fallbackLabel || providerRef || 'Unknown';
    },
    []
  );

  const gatewayRuntimeZones = useMemo(
    () => [
      {
        key: 'core',
        label: t('monitor.zoneCore'),
        value: corePath,
        folderPath: corePath,
        accent: 'from-sky-500/15 to-cyan-500/10 dark:from-sky-500/10 dark:to-cyan-500/5',
        border: 'border-sky-200/80 dark:border-sky-700/50'
      },
      {
        key: 'config',
        label: t('monitor.zoneConfig'),
        value: resolvedConfigFilePath,
        folderPath: resolvedConfigDir,
        accent: 'from-indigo-500/15 to-blue-500/10 dark:from-indigo-500/10 dark:to-blue-500/5',
        border: 'border-indigo-200/80 dark:border-indigo-700/50'
      },
      {
        key: 'workspace',
        label: t('monitor.zoneWorkspace'),
        value: workspacePath,
        folderPath: workspacePath,
        accent: 'from-emerald-500/15 to-teal-500/10 dark:from-emerald-500/10 dark:to-teal-500/5',
        border: 'border-emerald-200/80 dark:border-emerald-700/50'
      }
    ],
    [t, corePath, resolvedConfigFilePath, resolvedConfigDir, workspacePath]
  );

  return {
    effectiveAuthorizedProviders,
    modelOptionGroups,
    authorizedProvidersKey,
    selectedModelProvider,
    selectedModelAuthorized,
    authorizedProviderBadges,
    gatewayRuntimeZones,
    getProviderDisplayLabel,
    isModelAuthorizedByProvider,
  };
}
