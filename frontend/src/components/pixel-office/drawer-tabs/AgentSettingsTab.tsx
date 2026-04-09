import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, Loader2, Database, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PixelAgentSummary } from '../hooks/usePixelOfficeAgents';

interface AuthProfile {
  provider: string;
  authChoice: string;
  hasKey: boolean;
  healthy: boolean;
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
  const [profiles, setProfiles] = useState<AuthProfile[]>([]);
  const [authLoading, setAuthLoading] = useState(false);
  const [authScanned, setAuthScanned] = useState(false);

  useEffect(() => {
    if (!agentDir) { setAuthScanned(true); return; }
    let cancelled = false;
    setAuthLoading(true);
    window.electronAPI.exec(`agent:auth-list ${JSON.stringify(agentDir)}`)
      .then(res => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(res.stdout || '{}') as { profiles?: AuthProfile[] };
          setProfiles(Array.isArray(parsed.profiles) ? parsed.profiles : []);
        } catch { setProfiles([]); }
      })
      .catch(() => setProfiles([]))
      .finally(() => { if (!cancelled) { setAuthLoading(false); setAuthScanned(true); } });
    return () => { cancelled = true; };
  }, [agentDir]);

  const openFolder = (path?: string) => {
    if (path) void window.electronAPI?.openPath?.(path);
  };

  return (
    <div className="p-3 space-y-4">

      {/* Agent Info */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
            <Database size={9} />
            {t('pixelOffice.drawer.tabs.info', 'Info')}
          </span>
        </div>
        <div className="px-3 py-2 space-y-2">
          <Row label="Agent ID" value={agentId} mono />
          <Row label={t('pixelOffice.drawer.info.model', 'Model')} value={summary?.model ?? '—'} mono />
          <Row label={t('pixelOffice.drawer.info.sessions', 'Sessions')} value={String(summary?.sessionCount ?? 0)} />
          <Row
            label={t('pixelOffice.drawer.info.tokensIn', 'Tokens In')}
            value={(summary?.tokensIn ?? 0).toLocaleString()}
          />
          <Row
            label={t('pixelOffice.drawer.info.tokensOut', 'Tokens Out')}
            value={(summary?.tokensOut ?? 0).toLocaleString()}
          />
          <Row
            label={t('pixelOffice.drawer.info.cost', 'Cost')}
            value={(summary?.cost ?? 0) > 0 ? `$${(summary!.cost).toFixed(6)}` : '—'}
          />
          {agentWorkspace && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 shrink-0 mt-0.5">
                {t('pixelOffice.drawer.info.workspace', 'Workspace')}
              </span>
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-right font-mono text-[8px] text-slate-700 dark:text-slate-200 truncate max-w-[65%]">
                  {agentWorkspace}
                </span>
                <button
                  type="button"
                  onClick={() => openFolder(agentWorkspace)}
                  className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <FolderOpen size={9} />
                </button>
              </div>
            </div>
          )}
          {agentDir && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 shrink-0 mt-0.5">
                {t('pixelOffice.drawer.info.agentDir', 'Agent Dir')}
              </span>
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-right font-mono text-[8px] text-slate-700 dark:text-slate-200 truncate max-w-[65%]">
                  {agentDir}
                </span>
                <button
                  type="button"
                  onClick={() => openFolder(agentDir)}
                  className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <FolderOpen size={9} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Auth Profiles */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
            {t('pixelOffice.drawer.auth.title', 'Per-Agent Auth')}
          </span>
          {agentDir && (
            <span className="text-[8px] font-mono text-slate-400/60 truncate max-w-[55%]">{agentDir}</span>
          )}
        </div>

        <div className="px-3 py-2">
          {authLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={14} className="animate-spin text-slate-400" />
            </div>
          )}

          {!authLoading && authScanned && profiles.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 py-4 text-slate-400">
              <ShieldOff size={16} className="opacity-30" />
              <p className="text-[10px] text-center">
                {agentDir
                  ? t('pixelOffice.drawer.auth.noProfiles', 'No auth profiles found for this agent.')
                  : t('pixelOffice.drawer.auth.noAgentDir', 'Configure agents.list[].agentDir in openclaw.json.')}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            {profiles.map((p, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                  p.healthy && p.hasKey
                    ? 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/30 dark:bg-emerald-950/10'
                    : 'border-amber-200 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-950/10'
                }`}
              >
                {p.healthy && p.hasKey
                  ? <ShieldCheck size={11} className="shrink-0 text-emerald-500" />
                  : <ShieldOff size={11} className="shrink-0 text-amber-500" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-slate-700 dark:text-slate-200 capitalize truncate">{p.provider}</p>
                  {p.authChoice && (
                    <p className="text-[8px] font-mono text-slate-400 truncate">{p.authChoice}</p>
                  )}
                </div>
                <span className={`shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded border ${
                  p.healthy && p.hasKey
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40'
                    : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/40'
                }`}>
                  {p.healthy && p.hasKey ? t('common.status.ok', 'OK') : t('common.status.warn', 'WARN')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Note: model changes require openclaw.json edit */}
      <p className="text-[8px] text-slate-400 dark:text-slate-600 text-center">
        {t('pixelOffice.drawer.settings.modelReadOnly', 'Model changes require editing openclaw.json')}
      </p>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 shrink-0">{label}</span>
      <span className={`text-right truncate max-w-[65%] ${mono ? 'font-mono text-[8px]' : 'text-[10px]'} text-slate-700 dark:text-slate-200`}>
        {value}
      </span>
    </div>
  );
}
