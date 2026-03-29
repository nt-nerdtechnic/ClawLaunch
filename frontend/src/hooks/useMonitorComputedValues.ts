import { useMemo } from 'react';
import type { TFunction } from 'i18next';

type UseMonitorComputedValuesParams = {
  corePath: string;
  workspacePath: string;
  resolvedConfigDir: string;
  resolvedConfigFilePath: string;
  t: TFunction;
};

export function useMonitorComputedValues({
  corePath,
  workspacePath,
  resolvedConfigDir,
  resolvedConfigFilePath,
  t,
}: UseMonitorComputedValuesParams) {
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
    gatewayRuntimeZones,
  };
}
