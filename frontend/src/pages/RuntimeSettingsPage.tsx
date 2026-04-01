import React, { useState, useEffect, useMemo } from 'react';
import { Key, Loader2, ShieldCheck, AlertCircle, ChevronDown, ChevronUp, MessageSquare, Phone, Bot, Server, Mails, Hash, Shield, MessageCircle, Waves, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { ConfigService } from '../services/configService';
import { useAuthProfiles } from '../hooks/useAuthProfiles';
import { useAppComputedValues } from '../hooks/useAppComputedValues';
import { useRuntimeActions } from '../hooks/useRuntimeActions';
import { AuthManagementPanel } from '../components/AuthManagementPanel';
import { TelegramPairingSection } from '../components/TelegramPairingSection';

interface ChannelOption {
  id: string;
  name: string;
  icon: React.ReactNode;
  desc: string;
  placeholder: string;
  keyLabel: string;
  reqKey?: false;
}

interface RuntimeSettingsPageProps {
  runtimeDraftModel: string;
  setRuntimeDraftModel: (model: string) => void;
  runtimeDraftBotToken: string;
  setRuntimeDraftBotToken: (token: string) => void;
  runtimeDraftGatewayPort: string;
  setRuntimeDraftGatewayPort: (port: string) => void;
  runtimeDraftCronMaxConcurrentRuns: number;
  setRuntimeDraftCronMaxConcurrentRuns: (n: number) => void;
  dynamicModelOptions: Array<{ provider: string; group: string; models: string[] }>;
  dynamicModelLoading: boolean;
  loadDynamicModelOptions: (corePath: string, effectiveAuthorizedProviders: string[]) => Promise<void>;
  runtimeProfileError?: string;
}

export const RuntimeSettingsPage: React.FC<RuntimeSettingsPageProps> = ({
  runtimeDraftModel,
  setRuntimeDraftModel,
  runtimeDraftBotToken,
  setRuntimeDraftBotToken,
  runtimeDraftGatewayPort,
  setRuntimeDraftGatewayPort,
  runtimeDraftCronMaxConcurrentRuns,
  setRuntimeDraftCronMaxConcurrentRuns,
  dynamicModelOptions,
  dynamicModelLoading,
  loadDynamicModelOptions,
  runtimeProfileError,
}) => {
  const { t } = useTranslation();
  // 從 Zustand 直接讀取，無須從外部傳入
  const config = useStore((s) => s.config);
  const runtimeProfile = useStore((s) => s.runtimeProfile);
  const detectedConfig = useStore((s) => s.detectedConfig);
  const setRuntimeProfile = useStore((s) => s.setRuntimeProfile);
  const addLog = useStore((s) => s.addLog);
  const resolvedConfigDir = ConfigService.normalizeConfigDir(config.configPath);
  const resolvedConfigFilePath = resolvedConfigDir ? `${resolvedConfigDir}/openclaw.json` : '';
  const { authProfiles, loadAuthProfiles } = useAuthProfiles(resolvedConfigDir, 'runtimeSettings');
  const {
    effectiveAuthorizedProviders,
    modelOptionGroups,
    selectedModelProvider,
    selectedModelAuthorized,
    authorizedProviderBadges,
    getProviderDisplayLabel,
    isModelAuthorizedByProvider,
  } = useAppComputedValues({
    runtimeProfile,
    authProfiles,
    dynamicModelOptions,
    runtimeDraftModel,
    corePath: config.corePath,
    workspacePath: config.workspacePath,
    resolvedConfigDir,
    resolvedConfigFilePath,
    t,
  });
  const shellQuote = ConfigService.shellQuote;
  const buildOpenClawEnvPrefix = (cfg?: Partial<typeof config>) =>
    ConfigService.buildOpenClawEnvPrefix(cfg?.configPath ?? config.configPath);
  const effectiveRuntimeModel = String(runtimeProfile?.model || detectedConfig?.model || '').trim();
  const effectiveRuntimeBotToken = String(runtimeProfile?.botToken || detectedConfig?.botToken || '').trim();
  const effectiveRuntimeGatewayPort = String((runtimeProfile?.gateway as Record<string, unknown> | null | undefined)?.port ?? '').trim();
  const effectiveRuntimeCronMaxConcurrentRuns = Number((runtimeProfile?.cron as Record<string, unknown> | null | undefined)?.maxConcurrentRuns ?? 8) || 8;
  const {
    handleSaveConfig,
    runtimeSaveState,
    handleSaveChannelToken,
  } = useRuntimeActions({
    config,
    resolvedConfigDir,
    runtimeDraftModel,
    runtimeDraftBotToken,
    runtimeDraftGatewayPort,
    runtimeDraftCronMaxConcurrentRuns,
    effectiveRuntimeModel,
    effectiveRuntimeBotToken,
    effectiveRuntimeGatewayPort,
    effectiveRuntimeCronMaxConcurrentRuns,
    shellQuote,
    buildOpenClawEnvPrefix,
    isModelAuthorizedByProvider,
    setRuntimeProfile,
    addLog,
    t,
  });

  useEffect(() => {
    void loadDynamicModelOptions(config.corePath, effectiveAuthorizedProviders);
  }, [config.corePath, effectiveAuthorizedProviders, loadDynamicModelOptions]);

  const CHANNEL_OPTIONS = useMemo<ChannelOption[]>(() => [
    { id: 'telegram',   name: 'Telegram',    icon: <MessageSquare size={14} />, desc: t('runtime.providers.telegram.desc'),           placeholder: t('runtime.providers.telegram.placeholder'),              keyLabel: 'Bot Token' },
    { id: 'whatsapp',   name: 'WhatsApp',    icon: <Phone size={14} />,         desc: t('runtime.providers.whatsapp.desc'),           placeholder: '',                                    keyLabel: '',                    reqKey: false },
    { id: 'discord',    name: 'Discord',     icon: <Bot size={14} />,           desc: t('runtime.providers.discord.desc'),                  placeholder: t('runtime.providers.discord.placeholder'),               keyLabel: 'Bot Token' },
    { id: 'irc',        name: 'IRC',         icon: <Server size={14} />,        desc: t('runtime.providers.irc.desc'),               placeholder: '',                                    keyLabel: '',                    reqKey: false },
    { id: 'googlechat', name: 'Google Chat', icon: <Mails size={14} />,         desc: t('runtime.providers.googlechat.desc'),        placeholder: t('runtime.providers.googlechat.placeholder'),                     keyLabel: 'Webhook URL' },
    { id: 'slack',      name: 'Slack',       icon: <Hash size={14} />,          desc: t('runtime.providers.slack.desc'),                  placeholder: t('runtime.providers.slack.placeholder'),     keyLabel: 'Bot Token' },
    { id: 'signal',     name: 'Signal',      icon: <Shield size={14} />,        desc: t('runtime.providers.signal.desc'),       placeholder: '',                                    keyLabel: '',                    reqKey: false },
    { id: 'imessage',   name: 'iMessage',    icon: <MessageCircle size={14} />, desc: t('runtime.providers.imessage.desc'),                placeholder: '',                                    keyLabel: '',                    reqKey: false },
    { id: 'line',       name: 'LINE',        icon: <Waves size={14} />,         desc: t('runtime.providers.line.desc'),        placeholder: t('runtime.providers.line.placeholder'),       keyLabel: 'Channel Access Token' },
  ], [t]);

  const dynamicModelSource = dynamicModelOptions.length > 0 ? t('common.labels.dynamic') : t('common.labels.static');

  // Model list expanded/collapsed state
  const [expandedModelGroups, setExpandedModelGroups] = useState<Set<string>>(new Set());
  const toggleModelGroup = (key: string) =>
    setExpandedModelGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Channel selection and Bot Token draft states
  const [selectedChannelId, setSelectedChannelId] = useState('telegram');
  const [localChannelTokens, setLocalChannelTokens] = useState<Record<string, string>>({});
  const [channelSaving, setChannelSaving] = useState('');
  const [channelSaved, setChannelSaved] = useState('');

  // Sync channel tokens from runtimeProfile (excluding telegram, handled by runtimeDraftBotToken)
  useEffect(() => {
    const channels = (runtimeProfile?.channels || {}) as Record<string, Record<string, unknown>>;
    const tokens: Record<string, string> = {};
    for (const ch of CHANNEL_OPTIONS) {
      if (ch.id === 'telegram') continue;
      tokens[ch.id] = String(channels?.[ch.id]?.botToken || '').trim();
    }
    setLocalChannelTokens(tokens);
  }, [runtimeProfile, CHANNEL_OPTIONS]);

  const selectedChannel = CHANNEL_OPTIONS.find(c => c.id === selectedChannelId) || CHANNEL_OPTIONS[0];

  const currentChannelToken = selectedChannelId === 'telegram'
    ? runtimeDraftBotToken
    : (localChannelTokens[selectedChannelId] || '');

  const handleChannelTokenChange = (value: string) => {
    if (selectedChannelId === 'telegram') {
      setRuntimeDraftBotToken(value);
    } else {
      setLocalChannelTokens(prev => ({ ...prev, [selectedChannelId]: value }));
    }
  };

  const handleApplyChannelToken = async () => {
    setChannelSaving(selectedChannelId);
    setChannelSaved('');
    await handleSaveChannelToken(selectedChannelId, currentChannelToken);
    setChannelSaving('');
    setChannelSaved(selectedChannelId);
    setTimeout(() => setChannelSaved(''), 2200);
  };

  const getSavedChannelToken = (chId: string) =>
    chId === 'telegram' ? runtimeDraftBotToken : (localChannelTokens[chId] || '');

  const saveButtonLabel =
    runtimeSaveState === 'saving'
      ? t('settings.savingConfigButton')
      : runtimeSaveState === 'saved'
        ? t('settings.configSavedButton')
        : runtimeSaveState === 'error'
          ? t('settings.saveConfigFailedButton')
          : t('settings.saveConfig');

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in zoom-in-95">

      {/* Gateway Port Section */}
      <div className="p-8 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] space-y-6 shadow-xl shadow-slate-200/50 dark:shadow-none">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
            Gateway Port
          </div>
        </div>
        {/* Gateway Port */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            {t('settings.gatewayPort')}
          </label>
          <div className="flex items-stretch gap-2">
            <input
              type="text"
              value={runtimeDraftGatewayPort}
              onChange={(e) => setRuntimeDraftGatewayPort(e.target.value)}
              placeholder={t('settings.gatewayPortPlaceholder')}
              className="flex-1 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
            />
          </div>
          {runtimeDraftGatewayPort !== ((runtimeProfile?.gateway as Record<string, unknown> | undefined)?.port ? String((runtimeProfile?.gateway as Record<string, unknown>)?.port) : '') && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-amber-500 dark:text-amber-400 font-bold">
              <span>({t('settings.modifiedUnsaved')})</span>
            </div>
          )}
          <div className="text-[10px] text-slate-400 dark:text-slate-500">
            {t('settings.gateway.portHelp')}
          </div>
        </div>
      </div>

      {/* Cron Settings Section */}
      <div className="p-8 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] space-y-6 shadow-xl shadow-slate-200/50 dark:shadow-none">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
            {t('runtime.cron.title')}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            {t('runtime.cron.maxConcurrentRuns')}
          </label>
          <div className="flex items-stretch gap-2">
            <input
              type="number"
              min={1}
              max={64}
              value={runtimeDraftCronMaxConcurrentRuns}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!isNaN(n) && n >= 1) setRuntimeDraftCronMaxConcurrentRuns(n);
              }}
              className="w-32 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
            />
          </div>
          {runtimeDraftCronMaxConcurrentRuns !== effectiveRuntimeCronMaxConcurrentRuns && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-amber-500 dark:text-amber-400 font-bold">
              <span>({t('settings.modifiedUnsaved')})</span>
            </div>
          )}
          <div className="text-[10px] text-slate-400 dark:text-slate-500">
            {t('runtime.cron.maxConcurrentRunsHelp')}
          </div>
        </div>
      </div>

      {/* Gateway & Model Section */}
      <div className="p-8 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] space-y-6 shadow-xl shadow-slate-200/50 dark:shadow-none">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
            Gateway & Model
          </div>
        </div>
        <div>
          {runtimeProfileError && (
            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-800/60 dark:bg-rose-950/20">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-rose-500 dark:text-rose-400" />
              <div className="text-xs text-rose-700 dark:text-rose-300 font-mono leading-relaxed">
                {runtimeProfileError}
              </div>
            </div>
          )}

          {/* Auth management panel（自包含） */}
          <AuthManagementPanel onAuthChange={loadAuthProfiles} />

          <div className="grid grid-cols-1 gap-5">
            {/* Model Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  {t('settings.inferenceEngine')}
                </label>
                {selectedModelProvider && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                      selectedModelAuthorized
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300'
                    }`}
                  >
                    <Key size={11} />
                    {getProviderDisplayLabel(selectedModelProvider, selectedModelProvider)}
                  </span>
                )}
              </div>
              <input
                type="text"
                value={runtimeDraftModel}
                onChange={(e) => setRuntimeDraftModel(e.target.value)}
                placeholder={t('runtime.auth.inputKey')}
                className={`w-full rounded-2xl border px-4 py-3 font-mono text-xs outline-none transition-colors ${
                  selectedModelAuthorized
                    ? 'bg-white dark:bg-black/40 border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 focus:border-blue-400 dark:focus:border-blue-500/50'
                    : 'bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 focus:border-amber-400 dark:focus:border-amber-600'
                }`}
              />
              {/* Currently saved default models */}
              {runtimeDraftModel !== (runtimeProfile?.model || '') && (
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-amber-500 dark:text-amber-400 font-bold">
                  <span>({t('settings.auth.modifiedUnsaved')})</span>
                </div>
              )}
            </div>
          </div>

          {/* Model Picker */}
          <div className="mt-5 rounded-[24px] border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-white via-slate-50 to-sky-50/70 dark:from-slate-950/70 dark:via-slate-900/60 dark:to-sky-950/30 p-4 space-y-4 shadow-lg shadow-slate-200/40 dark:shadow-none">
            {/* Authorized provider badges */}
            <div className="flex flex-wrap items-center gap-2">
              {authorizedProviderBadges.length > 0 ? (
                <>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mr-1">
                    {t('settings.authorizedFilter')}：
                  </span>
                  {authorizedProviderBadges.map((provider) => (
                    <span
                      key={provider}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                    >
                      <ShieldCheck size={11} />
                      {getProviderDisplayLabel(provider, provider)}
                    </span>
                  ))}
                </>
              ) : (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t('settings.noAccountDetected')}
                </span>
              )}
              {dynamicModelLoading && (
                <Loader2 size={13} className="animate-spin text-slate-400 ml-auto" />
              )}
            </div>

            {modelOptionGroups.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {modelOptionGroups.map(({ provider, group, models }) => {
                  const groupKey = `${provider}-${group}`;
                  const isGroupExpanded = expandedModelGroups.has(groupKey);
                  const displayedModels: string[] = isGroupExpanded ? models : models.slice(0, 6);
                  return (
                    <div
                      key={groupKey}
                      className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 dark:border-slate-700/70 dark:bg-slate-900/60"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">
                          {getProviderDisplayLabel(provider, group)}
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500">{t('settings.modelsCount', { count: models.length })}</div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {displayedModels.map((model: string) => {
                          const selected = runtimeDraftModel === model;
                          return (
                            <button
                              key={model}
                              type="button"
                              onClick={() => setRuntimeDraftModel(model)}
                              className={`rounded-xl border px-3 py-2 text-left font-mono text-[11px] transition-colors ${
                                selected
                                  ? 'border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-300'
                                  : 'border-slate-200 bg-slate-50/70 text-slate-600 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-900'
                              }`}
                            >
                              {model}
                            </button>
                          );
                        })}
                      </div>
                      {models.length > 6 && (
                        <button
                          type="button"
                          onClick={() => toggleModelGroup(groupKey)}
                          className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                        >
                          {isGroupExpanded ? (
                            <><ChevronUp size={11} /> {t('common.labels.collapse')}</>
                          ) : (
                            <><ChevronDown size={11} /> {t('common.labels.expandAll', { count: models.length })}</>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-300">
                {t('settings.noModelsFromAuth')}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
              <span>
                {t('settings.modelSource')}：{dynamicModelLoading ? t('common.labels.executing') : dynamicModelSource}
              </span>
              {!selectedModelAuthorized && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300">
                  {t('settings.modelNotInAuthScope')}
                </span>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Channel Bot Token management */}
      <div className="p-8 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] space-y-6 shadow-xl shadow-slate-200/50 dark:shadow-none">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
            {t('runtime.channel.management')}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('runtime.channel.desc')}
          </div>
        </div>

        {/* Configured tokens overview (independent of channel switching) */}
        {(() => {
          const configured = CHANNEL_OPTIONS.filter(ch => ch.reqKey !== false && getSavedChannelToken(ch.id));
          if (configured.length === 0) return null;
          return (
            <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-700/40 dark:bg-emerald-950/20 px-4 py-3 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mr-1 shrink-0">
                {t('runtime.channel.configuredTokens')}：
              </span>
              {configured.map(ch => {
                const tok = getSavedChannelToken(ch.id);
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setSelectedChannelId(ch.id)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-white/80 px-2.5 py-1 text-[10px] font-mono font-bold text-emerald-800 hover:border-emerald-500 transition-colors dark:border-emerald-600/50 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    <CheckCircle2 size={9} />
                    <span>{ch.name}</span>
                    <span className="opacity-60">{tok.slice(0, 4)}••••{tok.slice(-4)}</span>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* Step 1: Select channel */}
        <div className="grid grid-cols-3 gap-2">
          {CHANNEL_OPTIONS.map(ch => (
            <button
              key={ch.id}
              type="button"
              onClick={() => setSelectedChannelId(ch.id)}
              className={`p-3 rounded-2xl border-2 text-left transition-all flex flex-col items-start gap-1 ${
                selectedChannelId === ch.id
                  ? 'border-blue-500/70 bg-blue-50/60 dark:border-blue-500/40 dark:bg-blue-950/30'
                  : 'border-slate-200/80 bg-white/70 hover:border-blue-300/60 dark:border-slate-700/70 dark:bg-slate-900/40 dark:hover:border-blue-600/40'
              }`}
            >
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center mb-0.5 ${
                selectedChannelId === ch.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}>
                {ch.icon}
              </div>
              <span className={`font-black text-[11px] ${selectedChannelId === ch.id ? 'text-blue-900 dark:text-blue-200' : 'text-slate-700 dark:text-slate-300'}`}>
                {ch.name}
              </span>
              <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium truncate w-full">
                {ch.desc}
              </span>
              {ch.reqKey !== false && (() => {
                const tok = getSavedChannelToken(ch.id);
                if (!tok) return null;
                return (
                  <span className="mt-0.5 flex items-center gap-1 text-[8px] font-mono font-bold text-emerald-600 dark:text-emerald-400 truncate w-full">
                    <CheckCircle2 size={8} className="shrink-0" />
                    {tok.slice(0, 4)}••••{tok.slice(-4)}
                  </span>
                );
              })()}
            </button>
          ))}
        </div>

        {/* Step 2: Token input */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 p-4 space-y-3">
          {selectedChannel.reqKey === false ? (
            <div className="flex items-start gap-3 py-2">
              <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-black text-emerald-700 dark:text-emerald-400">
                  {t('runtime.channel.noKeyNeeded', { name: selectedChannel.name })}
                </div>
                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {t('runtime.channel.noKeyDesc')}
                </div>
              </div>
            </div>
          ) : (
            <>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                {selectedChannel.keyLabel}
              </label>
              <input
                type="text"
                value={currentChannelToken}
                onChange={(e) => handleChannelTokenChange(e.target.value)}
                placeholder={selectedChannel.placeholder}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApplyChannelToken}
                  disabled={channelSaving === selectedChannelId || !currentChannelToken.trim()}
                  className={`rounded-xl px-4 py-2 text-xs font-black transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    channelSaved === selectedChannelId
                      ? 'bg-emerald-100 text-emerald-700 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-700/60'
                      : 'bg-blue-600 text-white hover:bg-blue-500'
                  }`}
                >
                  {channelSaving === selectedChannelId ? (
                    <span className="flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" />{t('runtime.channel.applyingToken')}</span>
                  ) : channelSaved === selectedChannelId ? (
                    <span className="flex items-center gap-1.5"><CheckCircle2 size={11} />{t('runtime.channel.appliedToken')}</span>
                  ) : (
                    t('runtime.channel.applyToken')
                  )}
                </button>
                {selectedChannelId === 'telegram' && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">{t('runtime.channel.telegramTokenHelp')}</span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Telegram pairing management（自包含） */}
        <TelegramPairingSection />
      </div>

      {/* Save Button */}
      <button
        onClick={handleSaveConfig}
        disabled={runtimeSaveState === 'saving'}
        className={`w-full py-4 rounded-2xl font-black text-white shadow-xl transition-all ${
          runtimeSaveState === 'saved'
            ? 'bg-emerald-600 shadow-emerald-600/20'
            : runtimeSaveState === 'error'
              ? 'bg-rose-600 shadow-rose-600/20'
              : 'bg-blue-600 shadow-blue-600/20 hover:bg-blue-500 active:scale-[0.98]'
        } disabled:cursor-wait disabled:opacity-80`}
      >
        {saveButtonLabel}
      </button>
    </div>
  );
};
