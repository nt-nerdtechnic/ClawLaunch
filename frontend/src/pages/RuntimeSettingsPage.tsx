import React, { useState, useEffect, useMemo } from 'react';
import { Key, Loader2, ShieldCheck, AlertCircle, Plus, Trash2, Brain, Cpu, Globe, Zap, Network, Database, ChevronDown, ChevronUp, MessageSquare, Phone, Bot, Server, Mails, Hash, Shield, MessageCircle, Waves, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface AuthProfileRow {
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
}

interface TelegramPairingRequest {
  id: string;
  code: string;
  createdAt?: string;
  lastSeenAt?: string;
  meta?: {
    username?: string;
    firstName?: string;
    lastName?: string;
    accountId?: string;
  };
}

interface AuthChoiceDef { id: string; name: string; desc: string; reqKey: boolean; oauthFlow?: boolean; isTokenFlow?: boolean; placeholder?: string; link?: string | null; helpText?: string; }
interface ProviderGroupDef { id: string; label: string; desc: string; icon: React.ReactNode; choices: AuthChoiceDef[]; }

interface ChannelOption {
  id: string;
  name: string;
  icon: React.ReactNode;
  desc: string;
  placeholder: string;
  keyLabel: string;
  reqKey?: false;
}

// Channel option interface moved to top level
// Instances moved inside component to support t()

interface RuntimeSettingsPageProps {
  config: any;
  setConfig: (config: any) => void;
  runtimeProfile: any;
  runtimeDraftModel: string;
  setRuntimeDraftModel: (model: string) => void;
  runtimeDraftBotToken: string;
  setRuntimeDraftBotToken: (token: string) => void;
  runtimeDraftGatewayPort: string;
  setRuntimeDraftGatewayPort: (port: string) => void;
  dynamicModelOptions: any[];
  dynamicModelLoading: boolean;
  selectedModelProvider: string;
  selectedModelAuthorized: boolean;
  getProviderDisplayLabel: (provider: string, fallback?: string) => string;
  authorizedProviderBadges: string[];
  modelOptionGroups: any[];
  effectiveAuthorizedProviders: string[];
  isModelAuthorizedByProvider: (model: string) => boolean;

  // Auth Profiles
  authProfiles: AuthProfileRow[];
  authProfileSummary: any;
  authProfilesLoading: boolean;
  authProfilesError: string;
  authRemovingId: string;
  onHandleRemoveAuthProfile: (profileId: string) => Promise<void>;

  // Auth Add
  authAdding: boolean;
  authAddProvider: string;
  setAuthAddProvider: (provider: string) => void;
  authAddChoice: string;
  setAuthAddChoice: (choice: string) => void;
  authAddSecret: string;
  setAuthAddSecret: (secret: string) => void;
  authAddError: string;
  authAddTokenCommand: string;
  setAuthAddTokenCommand: (cmd: string) => void;
  authAddTokenRunning: boolean;
  authAddTokenError: string;
  onHandleAddAuthProfile: () => Promise<void>;
  onHandleRunAuthTokenCommand: () => Promise<void>;
  onHandleOpenClawDoctor: () => Promise<void>;
  onHandleSecurityCheck: () => Promise<void>;
  runtimeProfileError?: string;

  // Telegram
  telegramPairingRequests: TelegramPairingRequest[];
  telegramAuthorizedUsers: any[];
  telegramPairingLoading: boolean;
  telegramPairingApprovingCode: string;
  telegramPairingRejectingCode: string;
  telegramPairingClearing: boolean;
  telegramPairingError: string;
  onHandleApproveTelegramPairing: (request: TelegramPairingRequest) => Promise<void>;
  onHandleRejectTelegramPairing: (request: TelegramPairingRequest) => Promise<void>;
  onHandleClearTelegramPairingRequests: () => Promise<void>;
  onSaveChannelToken: (channelId: string, token: string) => Promise<void>;

  // Handlers
  onSave: () => Promise<void>;
  saveState?: 'idle' | 'saving' | 'saved' | 'error';
}

export const RuntimeSettingsPage: React.FC<RuntimeSettingsPageProps> = ({
  config,
  setConfig: _setConfig,
  runtimeProfile,
  runtimeDraftModel,
  setRuntimeDraftModel,
  runtimeDraftBotToken,
  setRuntimeDraftBotToken,
  runtimeDraftGatewayPort,
  setRuntimeDraftGatewayPort,
  dynamicModelOptions,
  dynamicModelLoading,
  selectedModelProvider,
  selectedModelAuthorized,
  getProviderDisplayLabel,
  authorizedProviderBadges,
  modelOptionGroups,
  effectiveAuthorizedProviders: _effectiveAuthorizedProviders,
  isModelAuthorizedByProvider: _isModelAuthorizedByProvider,
  authProfiles,
  authProfileSummary: _authProfileSummary,
  authProfilesLoading,
  authProfilesError,
  authRemovingId,
  onHandleRemoveAuthProfile,
  authAdding,
  authAddProvider,
  setAuthAddProvider,
  authAddChoice,
  setAuthAddChoice,
  authAddSecret,
  setAuthAddSecret,
  authAddError,
  authAddTokenCommand,
  setAuthAddTokenCommand,
  authAddTokenRunning,
  authAddTokenError,
  onHandleAddAuthProfile,
  onHandleRunAuthTokenCommand,
  onHandleOpenClawDoctor,
  onHandleSecurityCheck,
  runtimeProfileError,
  telegramPairingRequests,
  telegramAuthorizedUsers,
  telegramPairingLoading,
  telegramPairingApprovingCode,
  telegramPairingRejectingCode,
  telegramPairingClearing,
  telegramPairingError,
  onHandleApproveTelegramPairing,
  onHandleRejectTelegramPairing,
  onHandleClearTelegramPairingRequests,
  onSaveChannelToken,
  onSave,
  saveState = 'idle',
}) => {
  const { t } = useTranslation();

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

  const AUTH_PROVIDER_GROUPS = useMemo<ProviderGroupDef[]>(() => [
    {
      id: 'anthropic', label: 'Anthropic', desc: 'Claude 3.7 / 3.5 Sonnet', icon: <Brain size={14} />,
      choices: [
        { id: 'apiKey', name: 'API Key', desc: t('runtime.providers.anthropic.desc'), reqKey: true, placeholder: 'sk-ant-...', link: 'https://console.anthropic.com/' },
        { id: 'token', name: 'Setup Token (CLI)', desc: t('runtime.providers.anthropicCli.desc'), reqKey: true, isTokenFlow: true, placeholder: t('runtime.providers.anthropicCli.placeholder'), link: null, helpText: t('runtime.providers.anthropicCli.help') },
      ],
    },
    {
      id: 'openai', label: 'OpenAI', desc: 'GPT-4o / Codex', icon: <Cpu size={14} />,
      choices: [
        { id: 'openai-api-key', name: 'API Key', desc: t('runtime.providers.openai.desc'), reqKey: true, placeholder: 'sk-...', link: 'https://platform.openai.com/' },
        { id: 'openai-codex', name: 'Codex OAuth', desc: t('runtime.providers.openaiCodex.desc'), reqKey: false, oauthFlow: true, link: null },
      ],
    },
    {
      id: 'google', label: 'Google', desc: 'Gemini 2.0 Flash / Pro', icon: <Globe size={14} />,
      choices: [
        { id: 'gemini-api-key', name: 'API Key', desc: t('runtime.providers.gemini.desc'), reqKey: true, placeholder: 'AIzaSy...', link: 'https://aistudio.google.com/app/apikey' },
        { id: 'google-gemini-cli', name: 'Gemini OAuth', desc: t('runtime.providers.geminiCli.desc'), reqKey: false, oauthFlow: true, link: null },
      ],
    },
    {
      id: 'openrouter', label: 'OpenRouter', desc: t('runtime.providers.openrouter.desc'), icon: <Globe size={14} />,
      choices: [
        { id: 'openrouter-api-key', name: 'API Key', desc: t('runtime.providers.openrouter.desc'), reqKey: true, placeholder: 'sk-or-...', link: 'https://openrouter.ai/keys' },
      ],
    },
    {
      id: 'minimax', label: 'MiniMax', desc: 'MiniMax M2.5', icon: <Zap size={14} />,
      choices: [
        { id: 'minimax-api', name: 'API Key', desc: t('runtime.providers.minimax.desc'), reqKey: true, placeholder: '...', link: 'https://platform.minimaxi.com/' },
        { id: 'minimax-coding-plan-global-token', name: 'Coding Plan Token (Global)', desc: t('runtime.providers.minimaxOauthGlobal.desc'), reqKey: true, placeholder: 'MINIMAX_OAUTH_TOKEN', link: 'https://platform.minimax.io/' },
        { id: 'minimax-coding-plan-cn-token', name: 'Coding Plan Token (CN)', desc: t('runtime.providers.minimaxOauthCn.desc'), reqKey: true, placeholder: 'MINIMAX_OAUTH_TOKEN', link: 'https://platform.minimaxi.com/' },
      ],
    },
    {
      id: 'moonshot', label: 'Moonshot', desc: 'Kimi K2.5', icon: <Zap size={14} />,
      choices: [
        { id: 'moonshot-api-key', name: 'Kimi API Key', desc: t('runtime.providers.moonshot.desc'), reqKey: true, placeholder: 'sk-...', link: 'https://platform.moonshot.cn/console/api-keys' },
      ],
    },
    {
      id: 'xai', label: 'xAI', desc: 'Grok-4 / Grok-2', icon: <Cpu size={14} />,
      choices: [
        { id: 'xai-api-key', name: 'Grok API Key', desc: t('runtime.providers.xai.desc'), reqKey: true, placeholder: 'xai-...', link: 'https://console.x.ai/' },
      ],
    },
    {
      id: 'chutes', label: 'Chutes', desc: 'Decentralized AI', icon: <Network size={14} />,
      choices: [
        { id: 'chutes', name: 'OAuth', desc: t('runtime.providers.chutes.desc'), reqKey: false, oauthFlow: true, link: null },
      ],
    },
    {
      id: 'local', label: 'Local', desc: 'Ollama / vLLM', icon: <Database size={14} />,
      choices: [
        { id: 'ollama', name: 'Ollama', desc: t('runtime.providers.ollama.desc'), reqKey: false, link: null },
        { id: 'vllm', name: 'vLLM', desc: t('runtime.providers.vllm.desc'), reqKey: false, link: null },
      ],
    },
    {
      id: 'qwen', label: 'Qwen', desc: t('runtime.providers.qwen.desc'), icon: <Cpu size={14} />,
      choices: [
        { id: 'qwen-portal', name: 'Qwen Portal', desc: t('runtime.providers.qwen.desc'), reqKey: true, placeholder: '...', link: null },
      ],
    },
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
    const channels = (runtimeProfile?.channels || {}) as Record<string, any>;
    const tokens: Record<string, string> = {};
    for (const ch of CHANNEL_OPTIONS) {
      if (ch.id === 'telegram') continue;
      tokens[ch.id] = String(channels?.[ch.id]?.botToken || '').trim();
    }
    setLocalChannelTokens(tokens);
  }, [runtimeProfile]);

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
    await onSaveChannelToken(selectedChannelId, currentChannelToken);
    setChannelSaving('');
    setChannelSaved(selectedChannelId);
    setTimeout(() => setChannelSaved(''), 2200);
  };

  const getSavedChannelToken = (chId: string) =>
    chId === 'telegram' ? runtimeDraftBotToken : (localChannelTokens[chId] || '');

  // Definitions for authorization providers and verification methods (matches onboarding SetupStepModel)
// AUTH_PROVIDER_GROUPS instances removed from top level and moved inside component

  // Sync to the first choice of the provider when it is selected
  const handleAuthProviderSelect = (pid: string) => {
    setAuthAddProvider(pid);
    const group = AUTH_PROVIDER_GROUPS.find((g) => g.id === pid);
    if (group) setAuthAddChoice(group.choices[0].id);
  };

  const currentAuthProviderGroup = AUTH_PROVIDER_GROUPS.find((g) => g.id === authAddProvider) ?? AUTH_PROVIDER_GROUPS[0];
  const currentAuthChoice = currentAuthProviderGroup.choices.find((c) => c.id === authAddChoice) ?? currentAuthProviderGroup.choices[0];

  const saveButtonLabel =
    saveState === 'saving'
      ? t('settings.savingConfigButton')
      : saveState === 'saved'
        ? t('settings.configSavedButton')
        : saveState === 'error'
          ? t('settings.saveConfigFailedButton')
          : t('settings.saveConfig');

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in zoom-in-95">
      {/* Quick Diagnostics Section */}
      <div className="p-8 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] space-y-4 shadow-xl shadow-slate-200/50 dark:shadow-none">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
          {t('settings.diag.title')}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {t('settings.diag.terminalHelp')}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onHandleOpenClawDoctor}
            disabled={!config?.corePath?.trim()}
            className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-700 font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:border-sky-700 dark:bg-sky-950/30 dark:hover:bg-sky-950/50 dark:text-sky-300"
          >
            <span>🩺</span>
            <span>doctor --fix</span>
          </button>
          <button
            type="button"
            onClick={onHandleSecurityCheck}
            disabled={!config?.corePath?.trim()}
            className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-700 font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:border-violet-700 dark:bg-violet-950/30 dark:hover:bg-violet-950/50 dark:text-violet-300"
          >
            <span>🔍</span>
            <span>{t('runtime.diag.securityAudit')}</span>
          </button>
        </div>
      </div>

      {/* Gateway & Model Section */}
      <div className="p-8 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] space-y-6 shadow-xl shadow-slate-200/50 dark:shadow-none">
        <div>
          {/* Gateway Port */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              Gateway Port
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
            {runtimeDraftGatewayPort !== (runtimeProfile?.gateway?.port ? String(runtimeProfile.gateway.port) : '') && (
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-amber-500 dark:text-amber-400 font-bold">
                <span>({t('settings.modifiedUnsaved')})</span>
              </div>
            )}
            <div className="text-[10px] text-slate-400 dark:text-slate-500">
              {t('settings.gateway.portHelp')}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
              Gateway & Model
            </div>
          </div>
          {runtimeProfileError && (
            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-800/60 dark:bg-rose-950/20">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-rose-500 dark:text-rose-400" />
              <div className="text-xs text-rose-700 dark:text-rose-300 font-mono leading-relaxed">
                {runtimeProfileError}
              </div>
            </div>
          )}

          <div className="mb-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 p-4 space-y-4">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
              {t('runtime.auth.management')}
            </div>

            {authProfilesLoading && (
              <div className="flex items-center gap-2 text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">{t('runtime.auth.loadingProfiles')}</span>
              </div>
            )}

            {authProfilesError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-300">
                {authProfilesError}
              </div>
            )}

            {!authProfilesLoading && authProfiles.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  {t('runtime.auth.profileStats', { total: authProfiles.length, healthy: authProfiles.filter((p) => p.credentialHealthy).length })}
                </div>
                <div className="grid gap-3">
                  {authProfiles.map((profile) => (
                    <div
                      key={profile.profileId}
                      className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 p-4 flex items-center justify-between"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
                          {profile.profileId}
                        </div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-slate-600 dark:text-slate-400">
                          <span className="px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800">
                            {profile.provider}
                          </span>
                          {profile.credentialHealthy && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                              {t('app.online')}
                            </span>
                          )}
                          {!profile.credentialHealthy && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                              <AlertCircle size={11} />
                              {t('runtime.auth.repairNeeded')}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => onHandleRemoveAuthProfile(profile.profileId)}
                        disabled={authRemovingId === profile.profileId}
                        className="ml-4 p-2 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50 transition-colors disabled:opacity-50"
                        title={t('settings.auth.removeTitle')}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-4">{t('runtime.auth.addAuth')}</div>
              {authAddError && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-300">
                  {authAddError}
                </div>
              )}
              <div className="space-y-4">

                {/* Step 1: Select Provider */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-[9px]">1</span>
                    {t('runtime.auth.selectProvider')}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 xl:grid-cols-5">
                    {AUTH_PROVIDER_GROUPS.map((pg) => (
                      <button
                        key={pg.id}
                        type="button"
                        onClick={() => handleAuthProviderSelect(pg.id)}
                        className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 text-center transition-all disabled:opacity-50 ${
                          authAddProvider === pg.id
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-500'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                      >
                        <span className={authAddProvider === pg.id ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}>
                          {pg.icon}
                        </span>
                        <span className={`text-[9px] font-black truncate w-full ${authAddProvider === pg.id ? 'text-blue-700 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400'}`}>
                          {pg.label}
                        </span>
                        <span className={`text-[8px] truncate w-full leading-none ${authAddProvider === pg.id ? 'text-blue-400 dark:text-blue-500' : 'text-slate-400 dark:text-slate-500'}`}>
                          {pg.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Step 2: Select verification method (shown only if multiple options exist for the provider) */}
                {currentAuthProviderGroup.choices.length > 1 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-[9px]">2</span>
                      {t('runtime.auth.verifyMethod')}
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {currentAuthProviderGroup.choices.map((choice) => (
                        <div
                          key={choice.id}
                          onClick={() => setAuthAddChoice(choice.id)}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${
                            authAddChoice === choice.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-500'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{choice.name}</span>
                              {choice.oauthFlow && (
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-emerald-500 text-white">OAUTH</span>
                              )}
                              {choice.isTokenFlow && (
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-blue-500 text-white">CLI TOKEN</span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{choice.desc}</p>
                          </div>
                          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors ${authAddChoice === choice.id ? 'border-blue-500 bg-blue-500' : 'border-slate-300 dark:border-slate-600'}`} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step 3: Credentials input / OAuth guide / No key required */}
                {currentAuthChoice.oauthFlow ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-700/60 dark:bg-emerald-950/20 px-4 py-3 space-y-1">
                    <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{t('settings.auth.oauthFlow')}</p>
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{t('settings.auth.oauthGuide')}</p>
                  </div>
                ) : !currentAuthChoice.reqKey ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40 px-4 py-3 space-y-1">
                    <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{t('settings.auth.noKeyRequired')}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('settings.auth.localServiceGuide')}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-[9px]">
                        {currentAuthProviderGroup.choices.length > 1 ? '3' : '2'}
                      </span>
                      {t('runtime.auth.credentials')}
                    </div>
                    <div className="flex items-center justify-between mb-1">
                      {currentAuthChoice.link ? (
                        <a
                          href={currentAuthChoice.link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1 font-black uppercase tracking-tighter ml-auto"
                        >
                          {t('runtime.auth.getApiKey')}
                        </a>
                      ) : <span />}
                    </div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Key size={14} />
                      </div>
                      <input
                        type="password"
                        value={authAddSecret}
                        onChange={(e) => setAuthAddSecret(e.target.value)}
                        placeholder={currentAuthChoice.placeholder || t('runtime.auth.inputKey')}
                        className="w-full pl-9 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-black/40 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors disabled:opacity-50"
                      />
                    </div>
                    {currentAuthChoice.helpText && (
                      <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50/50 border border-blue-100 dark:bg-blue-950/20 dark:border-blue-900/60">
                        <div className="mt-0.5 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                          <span className="text-[9px] text-white font-bold">i</span>
                        </div>
                        <p className="text-[11px] font-medium text-blue-700 dark:text-blue-300 leading-relaxed">{currentAuthChoice.helpText}</p>
                      </div>
                    )}

                    {/* Token CLI command executor (shown only during isTokenFlow) */}
                    {currentAuthChoice.isTokenFlow && (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 space-y-2">
                        <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('runtime.auth.tokenCmdLabel')}</div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={authAddTokenCommand}
                            onChange={(e) => setAuthAddTokenCommand(e.target.value)}
                            placeholder="claude setup-token"
                            disabled={authAddTokenRunning}
                            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-black/40 px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-300 outline-none focus:border-blue-400 transition-colors disabled:opacity-50"
                          />
                          <button
                            type="button"
                            onClick={onHandleRunAuthTokenCommand}
                            disabled={authAddTokenRunning}
                            className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-900 dark:bg-slate-700 text-white hover:bg-slate-800 dark:hover:bg-slate-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 transition-all flex items-center gap-1.5"
                          >
                            {authAddTokenRunning ? (
                              <><Loader2 size={11} className="animate-spin" /> {t('common.labels.executing')}</>
                            ) : t('common.labels.execute')}
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          {t('runtime.auth.tokenCmdHelp')}
                        </p>
                        {authAddTokenError && (
                          <p className="text-[10px] text-red-600 dark:text-red-400 font-medium">{authAddTokenError}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={onHandleAddAuthProfile}
                  disabled={authAdding}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold transition-colors disabled:opacity-60"
                >
                  <Plus size={16} />
                  {authAdding ? t('common.labels.executing') : t('runtime.auth.addAuth')}
                </button>


              </div>
            </div>
          </div>

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

        {/* Telegram pairing management: always displayed, independent of channel selection */}
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  {t('runtime.telegram.management')}
                </div>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  {t('runtime.telegram.pairingLabel')}
                </span>
              </div>
              <button
                type="button"
                onClick={onHandleClearTelegramPairingRequests}
                disabled={telegramPairingClearing || telegramPairingLoading || telegramPairingRequests.length === 0}
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {telegramPairingClearing ? t('common.labels.executing') : t('runtime.telegram.clearPairing')}
              </button>
            </div>

            {telegramPairingError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-300">
                {telegramPairingError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="space-y-3">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{t('monitor.telegramPairing.title')}</div>
                {telegramPairingLoading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Loader2 size={14} className="animate-spin" />
                    {t('runtime.telegram.pairingLoading')}
                  </div>
                ) : telegramPairingRequests.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    {t('runtime.telegram.noPairing')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {telegramPairingRequests.map((request) => (
                      <div
                        key={request.id || request.code}
                        className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                      >
                        <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{request.id || 'unknown-id'}</div>
                        <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-300">Code: {request.code || '-'}</div>
                        {request.meta?.accountId && (
                          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">User ID: {request.meta.accountId}</div>
                        )}
                        {(request.meta?.username || request.meta?.firstName) && (
                          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            {[request.meta.firstName, request.meta.lastName].filter(Boolean).join(' ')}
                            {request.meta.username && ` (@${request.meta.username})`}
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => onHandleApproveTelegramPairing(request)}
                            disabled={telegramPairingApprovingCode === request.code || telegramPairingRejectingCode === request.code}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
                          >
                            {telegramPairingApprovingCode === request.code ? t('runtime.telegram.approving') : t('controlCenter.actions.approve')}
                          </button>
                          <button
                            type="button"
                            onClick={() => onHandleRejectTelegramPairing(request)}
                            disabled={telegramPairingApprovingCode === request.code || telegramPairingRejectingCode === request.code}
                            className="rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-rose-500 disabled:opacity-60"
                          >
                            {telegramPairingRejectingCode === request.code ? t('runtime.telegram.rejecting') : t('controlCenter.actions.reject')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{t('runtime.telegram.authorizedUsers')}</div>
                {telegramAuthorizedUsers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    {t('runtime.telegram.noAuthorizedUsers')}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {telegramAuthorizedUsers.map((user: any) => (
                      <span
                        key={String(user?.id || '')}
                        className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-mono text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                      >
                        {String(user?.id || '')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
      </div>

      {/* Save Button */}
      <button
        onClick={onSave}
        disabled={saveState === 'saving'}
        className={`w-full py-4 rounded-2xl font-black text-white shadow-xl transition-all ${
          saveState === 'saved'
            ? 'bg-emerald-600 shadow-emerald-600/20'
            : saveState === 'error'
              ? 'bg-rose-600 shadow-rose-600/20'
              : 'bg-blue-600 shadow-blue-600/20 hover:bg-blue-500 active:scale-[0.98]'
        } disabled:cursor-wait disabled:opacity-80`}
      >
        {saveButtonLabel}
      </button>
    </div>
  );
};
