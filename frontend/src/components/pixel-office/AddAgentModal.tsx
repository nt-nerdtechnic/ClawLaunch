import { useState, useEffect } from 'react';
import { X, Loader2, AlertCircle, CheckCircle2, Eye, EyeOff, Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthProfile {
  profileId: string;
  provider: string;
  mode?: string;
  globalPresent: boolean;
  credentialHealthy: boolean;
  severity: 'ok' | 'warn' | 'critical';
}

interface AuthChoiceOption {
  id: string;
  label: string;
  placeholder: string;
  credentialless: boolean;
}

const NEW_CRED_CHOICES: AuthChoiceOption[] = [
  { id: 'apiKey',             label: 'Anthropic (API Key)',   placeholder: 'sk-ant-…',  credentialless: false },
  { id: 'openai-api-key',     label: 'OpenAI (API Key)',      placeholder: 'sk-…',      credentialless: false },
  { id: 'gemini-api-key',     label: 'Google Gemini',         placeholder: 'AIza…',     credentialless: false },
  { id: 'minimax-api',        label: 'MiniMax',               placeholder: 'eyJ…',      credentialless: false },
  { id: 'moonshot-api-key',   label: 'Moonshot (Kimi)',       placeholder: 'sk-…',      credentialless: false },
  { id: 'openrouter-api-key', label: 'OpenRouter',            placeholder: 'sk-or-…',   credentialless: false },
  { id: 'xai-api-key',        label: 'xAI (Grok)',            placeholder: 'xai-…',     credentialless: false },
  { id: 'ollama',             label: 'Ollama (local)',         placeholder: '',           credentialless: true  },
  { id: 'vllm',               label: 'vLLM (local)',           placeholder: '',           credentialless: true  },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface AddAgentModalProps {
  onClose: () => void;
  onCreated: (agentId: string) => void;
}

type Mode = 'clone' | 'new';

export default function AddAgentModal({ onClose, onCreated }: AddAgentModalProps) {
  const { t } = useTranslation();
  const config = useStore(s => s.config);

  // Agent ID & display name
  const [agentId, setAgentId] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Mode: clone existing vs new credential
  const [mode, setMode] = useState<Mode>('clone');

  // Clone mode state
  const [profiles, setProfiles] = useState<AuthProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set());

  // New credential mode state
  const [authChoice, setAuthChoice] = useState(NEW_CRED_CHOICES[0].id);
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  // Submission state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Load existing global profiles on mount
  useEffect(() => {
    async function load() {
      if (!window.electronAPI?.exec || !config.configPath) {
        setProfilesLoading(false);
        return;
      }
      try {
        const res = await window.electronAPI.exec(
          `auth:list-profiles ${JSON.stringify({ configPath: config.configPath })}`
        );
        if (res.code === 0) {
          const parsed = JSON.parse(res.stdout || '{}');
          const list: AuthProfile[] = (parsed.profiles ?? []).filter(
            (p: AuthProfile) => p.globalPresent
          );
          setProfiles(list);
          // Pre-select all healthy profiles
          setSelectedProfileIds(new Set(
            list.filter(p => p.credentialHealthy).map(p => p.profileId)
          ));
        }
      } catch { /* silent */ }
      setProfilesLoading(false);
    }
    void load();
  }, [config.configPath]);

  const agentIdError = agentId && !/^[a-z0-9][a-z0-9-]{0,30}$/.test(agentId)
    ? t('pixelOffice.addAgent.agentIdHint', 'Lowercase letters, digits and hyphens only')
    : '';

  const selectedChoice = NEW_CRED_CHOICES.find(c => c.id === authChoice) ?? NEW_CRED_CHOICES[0];

  const canSubmit =
    !loading && !success && !!agentId && !agentIdError && (
      mode === 'clone'
        ? selectedProfileIds.size > 0
        : selectedChoice.credentialless || !!secret.trim()
    );

  const toggleProfile = (id: string) => {
    setSelectedProfileIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError('');
    try {
      let payload: Record<string, unknown>;
      if (mode === 'clone') {
        payload = {
          agentId: agentId.trim(),
          name: displayName.trim() || agentId.trim(),
          configPath: config.configPath,
          corePath: config.corePath,
          cloneFromGlobal: true,
          profileIds: Array.from(selectedProfileIds),
        };
      } else {
        payload = {
          agentId: agentId.trim(),
          name: displayName.trim() || agentId.trim(),
          authChoice,
          secret: secret.trim(),
          corePath: config.corePath,
          configPath: config.configPath,
          workspacePath: config.workspacePath,
        };
      }
      const res = await window.electronAPI.exec(`auth:create-agent ${JSON.stringify(payload)}`);
      if (res.code !== 0) {
        setError(res.stderr || 'Failed to create agent');
        return;
      }
      setSuccess(true);
      setTimeout(() => { onCreated(agentId.trim()); onClose(); }, 1200);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const fieldCls = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-400 dark:focus:border-indigo-500 disabled:opacity-50';
  const labelCls = 'block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1';

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-[320px] rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3">
          <span className="text-[12px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
            {t('pixelOffice.addAgent.title', 'New Agent')}
          </span>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X size={13} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {/* Agent ID */}
          <div>
            <label className={labelCls}>{t('pixelOffice.addAgent.agentId', 'Agent ID')}</label>
            <input
              type="text"
              value={agentId}
              onChange={e => setAgentId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="e.g. worker-2"
              maxLength={31}
              disabled={loading || success}
              className={`${fieldCls} font-mono`}
              autoFocus
            />
            {agentIdError
              ? <p className="mt-0.5 text-[9px] text-red-500">{agentIdError}</p>
              : agentId && <p className="mt-0.5 text-[9px] text-slate-400">agents/{agentId}/</p>
            }
          </div>

          {/* Display Name */}
          <div>
            <label className={labelCls}>{t('pixelOffice.addAgent.displayName', '顯示名稱')}</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder={agentId || 'e.g. Apple Bot'}
              maxLength={40}
              disabled={loading || success}
              className={fieldCls}
            />
          </div>

          {/* Mode tabs */}
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-[10px] font-bold">
            {(['clone', 'new'] as Mode[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 py-1.5 transition-colors ${
                  mode === m
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900'
                }`}
              >
                {m === 'clone'
                  ? t('pixelOffice.addAgent.modeClone', '使用現有憑證')
                  : t('pixelOffice.addAgent.modeNew', '新增憑證')}
              </button>
            ))}
          </div>

          {/* Clone mode: profile list */}
          {mode === 'clone' && (
            <div>
              <label className={labelCls}>
                {t('pixelOffice.addAgent.selectProfiles', '選擇要複製的 Profile')}
              </label>
              {profilesLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 size={14} className="animate-spin text-slate-400" />
                </div>
              ) : profiles.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[10px] text-amber-600 dark:text-amber-400">
                  <AlertCircle size={11} />
                  {t('pixelOffice.addAgent.noGlobalProfiles', '目前沒有全域 Profile，請先在設定中新增憑證')}
                </div>
              ) : (
                <div className="space-y-1 max-h-36 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 p-1">
                  {profiles.map(p => (
                    <button
                      key={p.profileId}
                      type="button"
                      onClick={() => toggleProfile(p.profileId)}
                      disabled={loading || success}
                      className={`flex items-center gap-2 w-full rounded-lg px-2.5 py-1.5 text-left transition-colors disabled:opacity-50 ${
                        selectedProfileIds.has(p.profileId)
                          ? 'bg-indigo-50 dark:bg-indigo-900/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-900'
                      }`}
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        selectedProfileIds.has(p.profileId)
                          ? 'border-indigo-500 bg-indigo-500'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}>
                        {selectedProfileIds.has(p.profileId) && <Check size={9} className="text-white" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[10px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                          {p.provider}
                        </span>
                        <span className="block text-[8px] font-mono text-slate-400 truncate">{p.profileId}</span>
                      </span>
                      <span className={`shrink-0 text-[8px] font-bold rounded px-1 py-px ${
                        p.severity === 'ok'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : p.severity === 'critical'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {p.severity}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* New credential mode */}
          {mode === 'new' && (
            <>
              <div>
                <label className={labelCls}>{t('pixelOffice.addAgent.authChoice', 'Auth Provider')}</label>
                <div className="relative">
                  <select
                    value={authChoice}
                    onChange={e => { setAuthChoice(e.target.value); setSecret(''); }}
                    disabled={loading || success}
                    className={fieldCls}
                  >
                    {NEW_CRED_CHOICES.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={11} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
              </div>
              {!selectedChoice.credentialless && (
                <div>
                  <label className={labelCls}>{t('pixelOffice.addAgent.apiKey', 'API Key')}</label>
                  <div className="relative">
                    <input
                      type={showSecret ? 'text' : 'password'}
                      value={secret}
                      onChange={e => setSecret(e.target.value)}
                      placeholder={selectedChoice.placeholder}
                      disabled={loading || success}
                      className={`${fieldCls} pr-8 font-mono`}
                    />
                    <button type="button" tabIndex={-1} onClick={() => setShowSecret(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showSecret ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Error / Success */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-[10px] text-red-600 dark:text-red-400">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 px-3 py-2 text-[10px] text-green-600 dark:text-green-400">
              <CheckCircle2 size={12} />
              {t('pixelOffice.addAgent.success', 'Agent 建立成功！')}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={12} className="animate-spin" />}
            {loading
              ? t('pixelOffice.addAgent.creating', 'Creating…')
              : t('pixelOffice.addAgent.create', 'Create Agent')}
          </button>
        </form>
      </div>
    </div>
  );
}
