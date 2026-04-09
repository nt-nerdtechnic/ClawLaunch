import { useState, useRef, useEffect } from 'react';
import { Trash2, X, AlertTriangle, CheckCircle, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DialogShell } from './DialogShell';
import { useStore } from '../../store';

type Phase = 'warning' | 'confirm' | 'running' | 'done';

interface UninstallStep {
  step: string;
  ok: boolean;
  error?: string;
}

interface UninstallModalProps {
  open: boolean;
  onClose: () => void;
}

export function UninstallModal({ open, onClose }: UninstallModalProps) {
  const { t } = useTranslation();
  const config = useStore((s) => s.config);

  const [phase, setPhase] = useState<Phase>('warning');
  const [confirmed, setConfirmed] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [steps, setSteps] = useState<UninstallStep[]>([]);
  const [failed, setFailed] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setPhase('warning');
      setConfirmed(false);
      setLogs([]);
      setSteps([]);
      setFailed(false);
    }
  }, [open]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const pathRows = [
    { label: t('uninstall.paths.core'), value: config.corePath },
    { label: t('uninstall.paths.config'), value: config.configPath },
    { label: t('uninstall.paths.workspace'), value: config.workspacePath },
  ].filter((r) => r.value?.trim());

  const runUninstall = async () => {
    setPhase('running');
    setLogs([]);
    setSteps([]);
    setFailed(false);

    const unlisten = window.electronAPI.onLog?.((payload) => {
      const text = payload.data.replace(/\n$/, '');
      if (text) setLogs((prev) => [...prev, text]);
    });

    try {
      const payload = {
        corePath: config.corePath,
        configPath: config.configPath,
        workspacePath: config.workspacePath,
      };
      const res = await window.electronAPI.exec(`project:uninstall ${JSON.stringify(payload)}`);

      if ((res.code ?? res.exitCode) !== 0) {
        setFailed(true);
        setLogs((prev) => [...prev, `[ERROR] ${res.stderr || 'Uninstall failed'}`]);
      } else {
        try {
          const parsed = JSON.parse(res.stdout ?? '{}');
          setSteps(parsed.results ?? []);
        } catch { /* ignore */ }
        setPhase('done');
      }
    } catch (e) {
      setFailed(true);
      setLogs((prev) => [...prev, `[ERROR] ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      unlisten?.();
    }
  };

  const handleReinstall = () => {
    localStorage.removeItem('onboarding_finished');
    localStorage.removeItem('onboarding_force_reset');
    window.location.reload();
  };

  const handleContinue = () => {
    // Reload so Zustand picks up the cleared paths from clawlaunch.json
    window.location.reload();
  };

  if (!open) return null;

  return (
    <DialogShell zIndexClass="z-[200]" maxWidthClass="max-w-lg" onClose={phase === 'running' ? () => {} : onClose}>
      <div className="p-7 space-y-5">

        {/* ── Phase: warning ──────────────────────────────────────────────── */}
        {phase === 'warning' && (
          <>
            <div className="flex justify-between items-start">
              <div className="w-11 h-11 bg-rose-500/10 rounded-2xl flex items-center justify-center text-rose-500">
                <Trash2 size={20} />
              </div>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('uninstall.title')}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{t('uninstall.warningDesc')}</p>
            </div>

            <div className="rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-950/20 p-4 space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-rose-500 mb-3">
                {t('uninstall.willDelete')}
              </div>
              {pathRows.map((r) => (
                <div key={r.label} className="flex items-start gap-2">
                  <span className="text-[10px] font-bold text-rose-400 dark:text-rose-500 uppercase tracking-wider shrink-0 pt-0.5 w-24">{r.label}</span>
                  <span className="font-mono text-xs text-rose-700 dark:text-rose-300 break-all">{r.value}</span>
                </div>
              ))}
            </div>

            <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 px-3 py-2.5">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                {t('uninstall.cannotUndo')}
              </p>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-3 rounded-2xl font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => setPhase('confirm')}
                className="flex-1 px-4 py-3 rounded-2xl font-bold text-white bg-rose-500 hover:bg-rose-600 shadow-lg shadow-rose-500/20 transition-all active:scale-95"
              >
                {t('uninstall.proceedBtn')}
              </button>
            </div>
          </>
        )}

        {/* ── Phase: confirm ──────────────────────────────────────────────── */}
        {phase === 'confirm' && (
          <>
            <div className="flex justify-between items-start">
              <div className="w-11 h-11 bg-rose-500/10 rounded-2xl flex items-center justify-center text-rose-500">
                <AlertTriangle size={20} />
              </div>
              <button onClick={() => setPhase('warning')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('uninstall.confirmTitle')}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{t('uninstall.confirmDesc')}</p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-rose-500 focus:ring-rose-400"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                {t('uninstall.confirmCheck')}
              </span>
            </label>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setPhase('warning')}
                className="flex-1 px-4 py-3 rounded-2xl font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
              >
                {t('uninstall.backBtn')}
              </button>
              <button
                onClick={runUninstall}
                disabled={!confirmed}
                className="flex-1 px-4 py-3 rounded-2xl font-bold text-white bg-rose-500 hover:bg-rose-600 shadow-lg shadow-rose-500/20 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('uninstall.confirmBtn')}
              </button>
            </div>
          </>
        )}

        {/* ── Phase: running ──────────────────────────────────────────────── */}
        {phase === 'running' && (
          <>
            <div className="flex items-center gap-3">
              <Loader2 size={20} className="animate-spin text-rose-500 shrink-0" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('uninstall.runningTitle')}</h3>
            </div>

            <div className="rounded-2xl bg-slate-950 border border-slate-800 p-4 h-48 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-0.5">
              {logs.map((line, i) => (
                <div key={i} className={line.startsWith('[ERROR]') ? 'text-rose-400' : ''}>{line}</div>
              ))}
              <div ref={logsEndRef} />
            </div>

            {failed && (
              <div className="flex items-center gap-2 text-rose-500 text-sm font-semibold">
                <XCircle size={16} />
                {t('uninstall.runningFailed')}
              </div>
            )}
          </>
        )}

        {/* ── Phase: done ─────────────────────────────────────────────────── */}
        {phase === 'done' && (
          <>
            <div className="flex justify-center">
              <div className="w-14 h-14 bg-emerald-500/10 rounded-3xl flex items-center justify-center text-emerald-500">
                <CheckCircle size={26} />
              </div>
            </div>

            <div className="text-center space-y-1.5">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('uninstall.doneTitle')}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{t('uninstall.doneDesc')}</p>
            </div>

            {steps.length > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                {steps.map((s) => (
                  <div key={s.step} className="flex items-center gap-3 px-4 py-2.5">
                    {s.ok
                      ? <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                      : <XCircle size={14} className="text-rose-400 shrink-0" />
                    }
                    <span className="text-xs font-mono text-slate-600 dark:text-slate-400 flex-1">{s.step}</span>
                    {s.error && <span className="text-[10px] text-rose-400 truncate max-w-[160px]" title={s.error}>{s.error}</span>}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleReinstall}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-all active:scale-95"
              >
                <RefreshCw size={15} />
                {t('uninstall.reinstallBtn')}
              </button>
              <button
                onClick={handleContinue}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
              >
                {t('uninstall.continueBtn')}
              </button>
            </div>
          </>
        )}

      </div>
    </DialogShell>
  );
}
