import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export type AuthProfileRow = {
  profileId: string;
  provider: string;
  mode: string;
  globalPresent: boolean;
  agentPresent: boolean;
  agentCount: number;
  credentialHealthy: boolean;
  diagnostics?: string[];
  severity?: 'ok' | 'warn' | 'critical';
  repairGuides?: string[];
};

/**
 * Authentication management hook
 * Manages all authorization-related states and operations
 */
export function useAuthProfiles(
  resolvedConfigDir: string,
  activeTab: string,
  _onAuthChange?: () => void
) {
  const { t } = useTranslation();
  const [authProfiles, setAuthProfiles] = useState<AuthProfileRow[]>([]);
  const [authProfileSummary, setAuthProfileSummary] = useState<{
    total: number;
    healthy: number;
    warn: number;
    critical: number;
  } | null>(null);
  const [authProfilesLoading, setAuthProfilesLoading] = useState(false);
  const [authProfilesError, setAuthProfilesError] = useState('');
  const [authRemovingId, setAuthRemovingId] = useState('');
  const [authAdding, setAuthAdding] = useState(false);
  const [authAddProvider, setAuthAddProvider] = useState('anthropic');
  const [authAddChoice, setAuthAddChoice] = useState('apiKey');
  const [authAddSecret, setAuthAddSecret] = useState('');
  const [authAddError, setAuthAddError] = useState('');
  const [authAddTokenCommand, setAuthAddTokenCommand] = useState('claude setup-token');
  const [authAddTokenRunning, setAuthAddTokenRunning] = useState(false);
  const [authAddTokenError, setAuthAddTokenError] = useState('');

  // Load authorization list (useCallback 穩定引用，避免 useEffect 無限循環)
  const loadAuthProfiles = useCallback(async () => {
    if (!window.electronAPI || !resolvedConfigDir) {
      setAuthProfiles([]);
      setAuthProfileSummary(null);
      setAuthProfilesError('');
      return;
    }

    setAuthProfilesLoading(true);
    setAuthProfilesError('');
    try {
      const res = await window.electronAPI.exec(
        `auth:list-profiles ${JSON.stringify({ configPath: resolvedConfigDir })}`
      );
      if ((res.code ?? res.exitCode) !== 0) {
        throw new Error(res.stderr || t('auth.errors.loadProfilesFailed'));
      }
      const parsed = JSON.parse(res.stdout || '{}');
      const rows = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
      setAuthProfiles(rows);
      setAuthProfileSummary(parsed?.summary || null);
    } catch (e: any) {
      setAuthProfiles([]);
      setAuthProfileSummary(null);
      setAuthProfilesError(e?.message || t('auth.errors.loadProfilesFailed'));
    } finally {
      setAuthProfilesLoading(false);
    }
  }, [resolvedConfigDir, t]);

  // Initially load authorization list when activeTab changes
  // 注意：loadAuthProfiles 已被 useCallback memoize，不需要放入 dependency，
  // 避免非穩定函數引用觸發無限循環。
  useEffect(() => {
    if (activeTab !== 'runtimeSettings') return;
    loadAuthProfiles();
  }, [activeTab, resolvedConfigDir]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    authProfiles,
    setAuthProfiles,
    authProfileSummary,
    setAuthProfileSummary,
    authProfilesLoading,
    authProfilesError,
    authRemovingId,
    setAuthRemovingId,
    authAdding,
    setAuthAdding,
    authAddProvider,
    setAuthAddProvider,
    authAddChoice,
    setAuthAddChoice,
    authAddSecret,
    setAuthAddSecret,
    authAddError,
    setAuthAddError,
    authAddTokenCommand,
    setAuthAddTokenCommand,
    authAddTokenRunning,
    setAuthAddTokenRunning,
    authAddTokenError,
    setAuthAddTokenError,
    loadAuthProfiles,
  };
}
