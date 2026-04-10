import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Key, Loader2, FolderOpen, RefreshCw,
  ChevronDown, ChevronUp,
  MessageSquare, Phone, Bot, Server, Mails, Hash, Shield,
  MessageCircle, Waves, CheckCircle2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../../store';
import { ConfigService } from '../../../services/configService';
import { useAuthProfiles } from '../../../hooks/useAuthProfiles';
import { useAppComputedValues } from '../../../hooks/useAppComputedValues';
import { AuthManagementPanel } from '../../AuthManagementPanel';
import { TelegramPairingSection } from '../../TelegramPairingSection';
import type { PixelAgentSummary } from '../hooks/usePixelOfficeAgents';
import type { ModelOptionGroup } from '../../../hooks/useAppComputedValues';

interface ChannelOption {
  id: string;
  name: string;
  icon: React.ReactNode;
  desc: string;
  placeholder: string;
  keyLabel: string;
  reqKey?: false;
}

interface AgentSettingsTabProps {
  agentId: string;
  summary?: PixelAgentSummary;
  agentWorkspace?: string;
  agentDir?: string;
}

export default function AgentSettingsTab({
  agentId,
  summary,
  agentWorkspace,
  agentDir,
}: AgentSettingsTabProps) {
  const { t } = useTranslation();
  const config = useStore(s => s.config);
  const runtimeProfile = useStore(s => s.runtimeProfile);
  const setRuntimeProfile = useStore(s => s.setRuntimeProfile);

  const resolvedConfigDir = ConfigService.normalizeConfigDir(config.configPath);
  const resolvedConfigFilePath = resolvedConfigDir ? `${resolvedConfigDir}/openclaw.json` : '';

  // ── Auth profiles ─────────────────────────────────────────────────────────
  const { authProfiles, loadAuthProfiles } = useAuthProfiles(resolvedConfigDir, 'runtimeSettings');

  // ── Agent identity draft ──────────────────────────────────────────────────
  const [draftName, setDraftName] = useState(summary?.displayName ?? agentId);
  const [draftModel, setDraftModel] = useState(summary?.model ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => { setDraftName(summary?.displayName ?? agentId); }, [summary?.displayName, agentId]);
  useEffect(() => { setDraftModel(summary?.model ?? ''); }, [summary?.model]);

  // ── Dynamic model options ─────────────────────────────────────────────────
  const [dynamicModelOptions, setDynamicModelOptions] = useState<ModelOptionGroup[]>([]);
  const [dynamicModelLoading, setDynamicModelLoading] = useState(false);
  const loadCallSeqRef = useRef(0);

  const loadDynamicModelOptions = useCallback(async (
    corePath: string,
    effectiveAuthorizedProviders: string[],
    syncRemote = false,
  ) => {
    if (!window.electronAPI || !resolvedConfigDir) return;
    const seq = ++loadCallSeqRef.current;
    setDynamicModelLoading(true);
    try {
      const payload = { corePath, configPath: resolvedConfigDir, providers: effectiveAuthorizedProviders, syncRemote };
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sync timeout')), 30000)
      );
      const res = await Promise.race([
        window.electronAPI.exec(`config:model-options ${JSON.stringify(payload)}`),
        timeoutPromise,
      ]);
      if (seq !== loadCallSeqRef.current) return;
      if ((res.code ?? res.exitCode) !== 0) throw new Error(res.stderr || 'model-options failed');
      const parsed = JSON.parse(res.stdout || '{}');
      const groups: ModelOptionGroup[] = Array.isArray(parsed?.groups)
        ? parsed.groups
            .map((g: { provider?: unknown; group?: unknown; models?: unknown[] }) => ({
              provider: String(g?.provider || g?.group || '').trim().toLowerCase() || 'unknown',
              group: String(g?.group || g?.provider || '').trim() || 'unknown',
              models: Array.isArray(g?.models) ? g.models.map((m: unknown) => String(m || '').trim()).filter(Boolean) : [],
            }))
            .filter((g: ModelOptionGroup) => g.models.length > 0)
        : [];
      setDynamicModelOptions(groups);
    } catch {
      if (seq === loadCallSeqRef.current) setDynamicModelOptions([]);
    } finally {
      if (seq === loadCallSeqRef.current) setDynamicModelLoading(false);
    }
  }, [resolvedConfigDir]);

  // ── Computed model values ─────────────────────────────────────────────────
  const {
    effectiveAuthorizedProviders,
    modelOptionGroups,
    selectedModelProvider,
    selectedModelAuthorized,
    authorizedProviderBadges,
    getProviderDisplayLabel,
  } = useAppComputedValues({
    runtimeProfile,
    authProfiles,
    dynamicModelOptions,
    runtimeDraftModel: draftModel,
    corePath: config.corePath,
    workspacePath: agentWorkspace ?? config.workspacePath,
    resolvedConfigDir,
    resolvedConfigFilePath,
    t,
  });

  useEffect(() => {
    if (config.corePath && resolvedConfigDir) {
      void loadDynamicModelOptions(config.corePath, effectiveAuthorizedProviders);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.corePath, resolvedConfigDir]);

  // ── Model picker expand ───────────────────────────────────────────────────
  const [expandedModelGroups, setExpandedModelGroups] = useState<Set<string>>(new Set());
  const toggleModelGroup = (key: string) =>
    setExpandedModelGroups(prev => {
      const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next;
    });

  // ── Channel management ────────────────────────────────────────────────────
  const CHANNEL_OPTIONS = useMemo<ChannelOption[]>(() => [
    { id: 'telegram',   name: 'Telegram',    icon: <MessageSquare size={14} />, desc: t('runtime.providers.telegram.desc'),    placeholder: t('runtime.providers.telegram.placeholder'),   keyLabel: t('runtime.providers.keyLabels.botToken') },
    { id: 'whatsapp',   name: 'WhatsApp',    icon: <Phone size={14} />,         desc: t('runtime.providers.whatsapp.desc'),    placeholder: '',                                             keyLabel: '',                                           reqKey: false },
    { id: 'discord',    name: 'Discord',     icon: <Bot size={14} />,           desc: t('runtime.providers.discord.desc'),     placeholder: t('runtime.providers.discord.placeholder'),    keyLabel: t('runtime.providers.keyLabels.botToken') },
    { id: 'irc',        name: 'IRC',         icon: <Server size={14} />,        desc: t('runtime.providers.irc.desc'),         placeholder: '',                                             keyLabel: '',                                           reqKey: false },
    { id: 'googlechat', name: 'Google Chat', icon: <Mails size={14} />,         desc: t('runtime.providers.googlechat.desc'), placeholder: t('runtime.providers.googlechat.placeholder'), keyLabel: t('runtime.providers.keyLabels.webhookUrl') },
    { id: 'slack',      name: 'Slack',       icon: <Hash size={14} />,          desc: t('runtime.providers.slack.desc'),       placeholder: t('runtime.providers.slack.placeholder'),      keyLabel: t('runtime.providers.keyLabels.botToken') },
    { id: 'signal',     name: 'Signal',      icon: <Shield size={14} />,        desc: t('runtime.providers.signal.desc'),      placeholder: '',                                             keyLabel: '',                                           reqKey: false },
    { id: 'imessage',   name: 'iMessage',    icon: <MessageCircle size={14} />, desc: t('runtime.providers.imessage.desc'),   placeholder: '',                                             keyLabel: '',                                           reqKey: false },
    { id: 'line',       name: 'LINE',        icon: <Waves size={14} />,         desc: t('runtime.providers.line.desc'),        placeholder: t('runtime.providers.line.placeholder'),       keyLabel: t('runtime.providers.keyLabels.channelAccessToken') },
  ], [t]);

  const [selectedChannelId, setSelectedChannelId] = useState('telegram');
  const [localChannelTokens, setLocalChannelTokens] = useState<Record<string, string>>({});
  const [channelSaving, setChannelSaving] = useState('');
  const [channelSaved, setChannelSaved] = useState('');

  // Sync channel tokens from runtimeProfile
  useEffect(() => {
    const channels = (runtimeProfile?.channels || {}) as Record<string, Record<string, unknown>>;
    const tokens: Record<string, string> = {};
    for (const ch of CHANNEL_OPTIONS) {
      if (ch.id === 'telegram') {
        tokens['telegram'] = String(runtimeProfile?.botToken || '').trim();
      } else {
        tokens[ch.id] = String(channels?.[ch.id]?.botToken || '').trim();
      }
    }
    setLocalChannelTokens(tokens);
  }, [runtimeProfile, CHANNEL_OPTIONS]);

  const selectedChannel = CHANNEL_OPTIONS.find(c => c.id === selectedChannelId) ?? CHANNEL_OPTIONS[0];
  const currentChannelToken = localChannelTokens[selectedChannelId] ?? '';
  const getSavedChannelToken = (chId: string) => localChannelTokens[chId] ?? '';

  const handleApplyChannelToken = async () => {
    if (!window.electronAPI) return;
    const corePath = String(config.corePath || '').trim();
    if (!corePath || !resolvedConfigDir) return;
    setChannelSaving(selectedChannelId);
    setChannelSaved('');
    try {
      const shellQuote = ConfigService.shellQuote;
      const envPrefix = ConfigService.buildOpenClawEnvPrefix(config.configPath);
      const profileArg = ConfigService.buildGatewayProfileArg(config.configPath);
      const safeId = selectedChannelId.replace(/[^a-z0-9_-]/gi, '');
      const field = selectedChannelId === 'telegram' ? 'channels.telegram.botToken' : `channels.${safeId}.botToken`;
      const cmd = `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw ${profileArg}config set ${field} ${shellQuote(JSON.stringify(currentChannelToken))} --json`;
      const res = await window.electronAPI.exec(cmd);
      if ((res.code ?? res.exitCode) !== 0) throw new Error(res.stderr || 'save channel token failed');
      const probeRes = await window.electronAPI.exec(`config:probe ${shellQuote(resolvedConfigDir)}`);
      if (probeRes.code === 0 && probeRes.stdout) setRuntimeProfile(JSON.parse(probeRes.stdout));
      setChannelSaved(selectedChannelId);
      setTimeout(() => setChannelSaved(''), 2200);
    } catch {
      // silent — user can retry
    } finally {
      setChannelSaving('');
    }
  };

  // ── Save (name + model) ───────────────────────────────────────────────────
  const nameUnchanged = draftName.trim() === (summary?.displayName ?? agentId).trim();
  const modelUnchanged = draftModel.trim() === (summary?.model ?? '').trim();
  const nothingChanged = nameUnchanged && modelUnchanged;

  const handleSave = useCallback(async () => {
    if (!config.configPath || !config.corePath) return;
    setSaveState('saving');
    try {
      if (!nameUnchanged) {
        const res = await window.electronAPI?.exec(`agent:set-name ${JSON.stringify({
          agentId, name: draftName.trim(), configPath: config.configPath, corePath: config.corePath,
        })}`);
        if (!res || (res.exitCode !== 0 && res.code !== 0)) throw new Error(res?.stderr || 'set-name failed');
      }
      if (!modelUnchanged) {
        const res = await window.electronAPI?.exec(`agent:set-model ${JSON.stringify({
          agentId, model: draftModel.trim(), configPath: config.configPath,
        })}`);
        if (!res || (res.exitCode !== 0 && res.code !== 0)) throw new Error(res?.stderr || 'set-model failed');
      }
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2200);
    } catch {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 2500);
    }
  }, [agentId, draftName, draftModel, nameUnchanged, modelUnchanged, config.configPath, config.corePath]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const dynamicModelSource = dynamicModelOptions.length > 0
    ? t('common.labels.dynamic', 'Dynamic')
    : t('common.labels.static', 'Static');

  const saveButtonLabel =
    saveState === 'saving' ? t('settings.savingConfigButton', 'Saving…')
    : saveState === 'saved' ? t('settings.configSavedButton', 'Saved!')
    : saveState === 'error' ? t('settings.saveConfigFailedButton', 'Failed')
    : t('settings.saveConfig', 'Save');

  const openFolder = (p?: string) => { if (p) void window.electronAPI?.openPath?.(p); };

  return (
    <div className="p-4 space-y-4 animate-in fade-in zoom-in-95">

      {/* Agent Identity */}
      <div className="p-6 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[24px] space-y-4 shadow-lg shadow-slate-200/50 dark:shadow-none">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
          {t('pixelOffice.drawer.tabs.info', 'Agent Info')}
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            {t('pixelOffice.rename.title', '顯示名稱')}
          </label>
          <input
            type="text"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            maxLength={40}
            placeholder={agentId}
            className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
          />
          {!nameUnchanged && (
            <div className="text-[10px] text-amber-500 dark:text-amber-400 font-bold">
              ({t('settings.modifiedUnsaved', '已修改，尚未儲存')})
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Agent ID</label>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3">
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{agentId}</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            {t('common.labels.status', 'Status')}
          </label>
          <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-bold border ${
            summary?.snapshotState === 'active'
              ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800/40'
              : 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-700'
          }`}>
            {summary?.snapshotState === 'active' ? t('pixelOffice.agentWorking', '運行中') : t('pixelOffice.agentIdle', '閒置')}
          </span>
        </div>
      </div>

      {/* Workspace Paths */}
      <div className="p-6 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[24px] space-y-4 shadow-lg shadow-slate-200/50 dark:shadow-none">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
          {t('settings.workspacePath', 'Workspace Paths')}
        </div>
        {([
          { label: t('pixelOffice.drawer.info.workspace', 'Workspace'), value: agentWorkspace },
          { label: t('pixelOffice.drawer.info.agentDir', 'Agent Dir'), value: agentDir },
        ] as const).map(({ label, value }) => (
          <div key={label} className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{label}</label>
            <div className="flex items-stretch gap-2">
              <div className="flex-1 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400 truncate min-w-0">
                {value || <span className="text-slate-400 dark:text-slate-600 italic">—</span>}
              </div>
              <button
                onClick={() => openFolder(value)}
                disabled={!value}
                title={t('settings.browseFolder', 'Open folder')}
                className="px-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center disabled:opacity-40"
              >
                <FolderOpen size={15} className="text-slate-500 dark:text-slate-400" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Gateway & Model */}
      <div className="p-6 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[24px] space-y-6 shadow-lg shadow-slate-200/50 dark:shadow-none">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
          {t('runtime.sections.gatewayAndModel', '網關與模型設定')}
        </div>

        <AuthManagementPanel onAuthChange={loadAuthProfiles} />

        {/* Model input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
              {t('settings.inferenceEngine', '推論引擎')}
              <button
                onClick={() => void loadDynamicModelOptions(config.corePath, effectiveAuthorizedProviders, true)}
                disabled={dynamicModelLoading}
                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md transition-colors text-blue-500 disabled:opacity-50"
                title={t('common.labels.syncRemote', 'Sync remote')}
              >
                <RefreshCw size={12} className={dynamicModelLoading ? 'animate-spin' : ''} />
              </button>
            </label>
            {selectedModelProvider && (
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                selectedModelAuthorized
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300'
              }`}>
                <Key size={11} />
                {getProviderDisplayLabel(selectedModelProvider, selectedModelProvider)}
              </span>
            )}
          </div>
          <input
            type="text"
            value={draftModel}
            onChange={e => setDraftModel(e.target.value)}
            placeholder={t('runtime.auth.inputKey', 'e.g. claude-3-5-sonnet-20241022')}
            className={`w-full rounded-2xl border px-4 py-3 font-mono text-xs outline-none transition-colors ${
              selectedModelAuthorized
                ? 'bg-white dark:bg-black/40 border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 focus:border-blue-400 dark:focus:border-blue-500/50'
                : 'bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 focus:border-amber-400 dark:focus:border-amber-600'
            }`}
          />
          {!modelUnchanged && (
            <div className="text-[10px] text-amber-500 dark:text-amber-400 font-bold">
              ({t('settings.auth.modifiedUnsaved', '已修改，尚未儲存')})
            </div>
          )}
        </div>

        {/* Model picker */}
        <div className="rounded-[20px] border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-white via-slate-50 to-sky-50/70 dark:from-slate-950/70 dark:via-slate-900/60 dark:to-sky-950/30 p-4 space-y-4 shadow-lg shadow-slate-200/40 dark:shadow-none">
          <div className="flex flex-wrap items-center gap-2">
            {authorizedProviderBadges.length > 0 ? (
              <>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mr-1">
                  {t('settings.authorizedFilter', '已授權')}：
                </span>
                {authorizedProviderBadges.map(provider => (
                  <span
                    key={provider}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
                    {getProviderDisplayLabel(provider, provider)}
                  </span>
                ))}
              </>
            ) : (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('settings.noAccountDetected', '尚未偵測到帳號')}
              </span>
            )}
            {dynamicModelLoading && <Loader2 size={13} className="animate-spin text-slate-400 ml-auto" />}
          </div>

          {modelOptionGroups.length > 0 ? (
            <div className="grid grid-cols-1 gap-3">
              {modelOptionGroups.map(({ provider, group, models }) => {
                const groupKey = `${provider}-${group}`;
                const isExpanded = expandedModelGroups.has(groupKey);
                const displayed = isExpanded ? models : models.slice(0, 6);
                return (
                  <div key={groupKey} className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 dark:border-slate-700/70 dark:bg-slate-900/60">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">
                        {getProviderDisplayLabel(provider, group)}
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500">
                        {t('settings.modelsCount', { count: models.length })}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {displayed.map((model: string) => (
                        <button
                          key={model}
                          type="button"
                          onClick={() => setDraftModel(model)}
                          className={`rounded-xl border px-3 py-2 text-left font-mono text-[11px] transition-colors ${
                            draftModel === model
                              ? 'border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-300'
                              : 'border-slate-200 bg-slate-50/70 text-slate-600 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-900'
                          }`}
                        >
                          {model}
                        </button>
                      ))}
                    </div>
                    {models.length > 6 && (
                      <button
                        type="button"
                        onClick={() => toggleModelGroup(groupKey)}
                        className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                      >
                        {isExpanded
                          ? <><ChevronUp size={11} />{t('common.labels.collapse', '收合')}</>
                          : <><ChevronDown size={11} />{t('common.labels.expandAll', { count: models.length })}</>}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-300">
              {t('settings.noModelsFromAuth', '尚未偵測到可用模型')}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
            <span>
              {t('settings.modelSource', '模型來源')}：{dynamicModelLoading ? t('common.labels.executing', '載入中') : dynamicModelSource}
            </span>
            {!selectedModelAuthorized && draftModel && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300">
                {t('settings.modelNotInAuthScope', '模型不在授權範圍')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Channel Bot Token management */}
      <div className="p-6 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[24px] space-y-6 shadow-lg shadow-slate-200/50 dark:shadow-none">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
            {t('runtime.channel.management')}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('runtime.channel.desc')}
          </div>
        </div>

        {/* Configured tokens overview */}
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

        {/* Channel selector grid */}
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
                selectedChannelId === ch.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
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

        {/* Token input */}
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
                onChange={e => setLocalChannelTokens(prev => ({ ...prev, [selectedChannelId]: e.target.value }))}
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
                  onClick={() => { void handleApplyChannelToken(); }}
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

        {/* Telegram pairing */}
        <TelegramPairingSection />
      </div>

      {/* Usage Stats */}
      <div className="p-6 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[24px] space-y-4 shadow-lg shadow-slate-200/50 dark:shadow-none">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
          {t('pixelOffice.drawer.tabs.analytics', '使用統計')}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label={t('pixelOffice.drawer.info.sessions', 'Sessions')} value={String(summary?.sessionCount ?? 0)} />
          <StatCard
            label={t('pixelOffice.drawer.info.tokensIn', 'In')}
            value={(summary?.tokensIn ?? 0) >= 1000 ? `${((summary?.tokensIn ?? 0) / 1000).toFixed(1)}K` : String(summary?.tokensIn ?? 0)}
          />
          <StatCard
            label={t('pixelOffice.drawer.info.tokensOut', 'Out')}
            value={(summary?.tokensOut ?? 0) >= 1000 ? `${((summary?.tokensOut ?? 0) / 1000).toFixed(1)}K` : String(summary?.tokensOut ?? 0)}
          />
        </div>
        {(summary?.cost ?? 0) > 0 && (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/10 px-4 py-2.5 flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
              {t('pixelOffice.drawer.info.cost', 'Cost')}
            </span>
            <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-300">
              ${summary!.cost.toFixed(6)}
            </span>
          </div>
        )}
      </div>

      {/* Save Button */}
      <button
        onClick={() => { void handleSave(); }}
        disabled={saveState === 'saving' || nothingChanged}
        className={`w-full py-4 rounded-2xl font-black text-white shadow-xl transition-all ${
          saveState === 'saved'
            ? 'bg-emerald-600 shadow-emerald-600/20'
            : saveState === 'error'
              ? 'bg-rose-600 shadow-rose-600/20'
              : nothingChanged
                ? 'bg-slate-400 shadow-slate-400/20 cursor-not-allowed'
                : 'bg-blue-600 shadow-blue-600/20 hover:bg-blue-500 active:scale-[0.98]'
        } disabled:opacity-70`}
      >
        {saveButtonLabel}
      </button>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-3 py-2.5 text-center">
      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-sm font-bold text-slate-700 dark:text-slate-200">{value}</div>
    </div>
  );
}
