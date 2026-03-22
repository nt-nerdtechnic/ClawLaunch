import React from 'react';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface LauncherSettingsPageProps {
  config: any;
  setConfig: (config: any) => void;
  onSave: () => void;
  saveState?: 'idle' | 'saving' | 'saved' | 'error';
  onAddLog: (msg: string, source: 'system' | 'stderr' | 'stdout') => void;
  onBrowsePath: (key: 'corePath' | 'configPath' | 'workspacePath') => void;
}

export const LauncherSettingsPage: React.FC<LauncherSettingsPageProps> = ({
  config,
  setConfig,
  onSave,
  saveState = 'idle',
  onAddLog: _onAddLog,
  onBrowsePath,
}) => {
  const { t } = useTranslation();

  const saveButtonLabel =
    saveState === 'saving'
      ? t('settings.savingConfigButton')
      : saveState === 'saved'
        ? t('settings.configSavedButton')
        : saveState === 'error'
          ? t('settings.saveConfigFailedButton')
          : t('settings.saveConfig');

  const shouldUseExternalTerminal = (cfg?: any) =>
    (cfg?.useExternalTerminal ?? config?.useExternalTerminal) !== false;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in zoom-in-95">
      <div className="p-8 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] space-y-8 shadow-xl shadow-slate-200/50 dark:shadow-none">
        {/* Runtime Paths Section */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">
            Launcher Runtime Paths
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Core Path */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                {t('settings.corePath')}
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  value={config.corePath || ''}
                  onChange={(e) => setConfig({ corePath: e.target.value })}
                  placeholder={t('settings.corePathPlaceholder')}
                  className="flex-1 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
                />
                <button
                  onClick={() => onBrowsePath('corePath')}
                  title="Browse folder"
                  className="px-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center"
                >
                  <FolderOpen size={15} className="text-slate-500 dark:text-slate-400" />
                </button>
              </div>
            </div>

            {/* Config Path */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                {t('settings.configPath')}
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  value={config.configPath || ''}
                  onChange={(e) => setConfig({ configPath: e.target.value })}
                  placeholder={t('settings.configPathPlaceholder')}
                  className="flex-1 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
                />
                <button
                  onClick={() => onBrowsePath('configPath')}
                  title="Browse folder"
                  className="px-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center"
                >
                  <FolderOpen size={15} className="text-slate-500 dark:text-slate-400" />
                </button>
              </div>
            </div>

            {/* Workspace Path */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                {t('settings.workspacePath')}
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  value={config.workspacePath || ''}
                  onChange={(e) => setConfig({ workspacePath: e.target.value })}
                  placeholder={t('settings.workspacePathPlaceholder')}
                  className="flex-1 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
                />
                <button
                  onClick={() => onBrowsePath('workspacePath')}
                  title="Browse folder"
                  className="px-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center"
                >
                  <FolderOpen size={15} className="text-slate-500 dark:text-slate-400" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Launch Behavior Section */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">
            Launcher Start Behavior
          </div>
          {/* External Terminal Toggle */}
          <div className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                {t('settings.externalTerminalTitle')}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {t('settings.externalTerminalDesc')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConfig({ useExternalTerminal: !shouldUseExternalTerminal() })}
              className={`shrink-0 inline-flex h-7 w-12 items-center rounded-full border transition-all ${
                shouldUseExternalTerminal()
                  ? 'bg-emerald-500 border-emerald-500 justify-end'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 justify-start'
              }`}
              aria-pressed={shouldUseExternalTerminal()}
              aria-label={t('settings.externalTerminalTitle')}
              title={t('settings.externalTerminalTitle')}
            >
              <span className="mx-1 h-5 w-5 rounded-full bg-white shadow-sm" />
            </button>
          </div>

          {/* Auto Restart Gateway */}
          <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                自動重啟 Gateway（崩潰時）
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                套用於非 daemon 模式；異常退出時會依啟動模式進行自動重啟。
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConfig({ autoRestartGateway: !config.autoRestartGateway })}
              className={`shrink-0 inline-flex h-7 w-12 items-center rounded-full border transition-all ${
                config.autoRestartGateway
                  ? 'bg-emerald-500 border-emerald-500 justify-end'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 justify-start'
              }`}
              aria-pressed={config.autoRestartGateway}
              aria-label="自動重啟 Gateway"
              title="自動重啟 Gateway"
            >
              <span className="mx-1 h-5 w-5 rounded-full bg-white shadow-sm" />
            </button>
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
