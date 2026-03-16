// @ts-nocheck
import React, { useState } from 'react';
import { Rocket, CheckCircle2, Loader2, PartyPopper, Terminal, AlertCircle, ArrowRight, Server } from 'lucide-react';
import { useStore } from '../../store';
import { Trans, useTranslation } from 'react-i18next';
import TerminalLog from '../common/TerminalLog';
import { useOnboardingAction } from '../../hooks/useOnboardingAction';

/**
 * NT-ClawLaunch Onboarding: Final Launch Step
 * Optimized with Action Strategy Pattern (2026-03-15)
 */
const SetupStepLaunch = ({ onComplete }) => {
  const { config, setConfig, userType, workspaceSkills } = useStore();
  const { t } = useTranslation();
  const onboardingAction = useOnboardingAction();
  const [status, setStatus] = useState('preparing'); // preparing, success, partial_failure
  const [progress, setProgress] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);

  const steps = {
    preparing: t('launch.steps.preparing'),
    success: t('launch.steps.success')
  };

  const runSetup = async () => {
    try {
      setHasStarted(true);
      setStatus('preparing');
      setProgress(20);
      
      const success = await onboardingAction.execute('launch');
      
      if (success) {
        setProgress(100);
        setStatus('success');
      } else {
        setStatus('partial_failure');
      }
    } catch (err) {
      console.error(err);
      setStatus('partial_failure');
    }
  };

  if (!hasStarted) {
    return (
      <div className="w-full max-w-2xl mx-auto bg-white rounded-3xl shadow-xl shadow-gray-100 border border-gray-100 p-10 animate-in fade-in zoom-in-95 duration-500">
        <div className="text-center space-y-4 mb-8">
          <div className="w-20 h-20 bg-blue-100 rounded-[28px] flex items-center justify-center text-blue-600 mx-auto border border-blue-200/60">
            <Rocket size={34} />
          </div>
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">最終啟動設定 (Final Launch)</h2>
          <p className="text-gray-500 font-medium">這是最後一步。背景服務安裝選項只會在這裡出現並生效。</p>
        </div>

        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-start justify-between gap-4 mb-8">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 w-10 h-10 rounded-xl flex items-center justify-center ${config.installDaemon ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
              <Server size={18} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-black text-slate-800">{t('modelSetup.daemon.title')}</p>
              <p className="text-[11px] text-slate-500 leading-relaxed max-w-xl">{t('modelSetup.daemon.desc')}</p>
              <p className={`text-[10px] font-black uppercase tracking-widest ${config.installDaemon ? 'text-emerald-600' : 'text-slate-400'}`}>
                {config.installDaemon ? t('modelSetup.daemon.enabled') : t('modelSetup.daemon.disabled')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setConfig({ installDaemon: !config.installDaemon })}
            className={`shrink-0 mt-1 inline-flex h-7 w-12 items-center rounded-full border transition-all ${config.installDaemon ? 'bg-emerald-500 border-emerald-500 justify-end' : 'bg-white border-slate-300 justify-start'}`}
            aria-pressed={config.installDaemon}
            aria-label={t('modelSetup.daemon.toggle')}
            title={t('modelSetup.daemon.toggle')}
          >
            <span className="mx-1 h-5 w-5 rounded-full bg-white shadow-sm" />
          </button>
        </div>

        <button
          onClick={runSetup}
          className="w-full flex items-center justify-center gap-3 bg-slate-900 hover:bg-slate-800 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-xl uppercase tracking-widest text-xs"
        >
          開始最終啟動檢查 <ArrowRight size={18} />
        </button>
      </div>
    );
  }

  if (onboardingAction.error) {
      return (
          <div className="w-full max-w-2xl mx-auto bg-white rounded-3xl shadow-xl shadow-gray-100 border border-red-100 p-12 text-center animate-in fade-in zoom-in-95 duration-500">
              <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center text-red-600 mx-auto mb-8 animate-bounce">
                  <Terminal size={48} />
              </div>
              <h2 className="text-2xl font-bold text-gray-800">{t('launch.error.title')}</h2>
              <p className="text-red-500 mt-4 font-mono text-sm px-4 py-2 bg-red-50 rounded-xl inline-block">{onboardingAction.error}</p>
              
              <div className="mt-8">
                  <TerminalLog logs={onboardingAction.logs} height="h-48" title="Error Debug Log" />
              </div>

              <button 
                onClick={() => window.location.reload()}
                className="mt-8 bg-gray-900 hover:bg-black text-white px-10 py-4 rounded-2xl font-black transition-all shadow-lg active:scale-95"
              >
                {t('launch.error.retryBtn')}
              </button>
          </div>
      );
  }

  if (status === 'partial_failure') {
      return (
          <div className="w-full max-w-2xl mx-auto bg-white rounded-3xl shadow-xl shadow-gray-100 border border-amber-200 p-12 text-center animate-in fade-in zoom-in-95 duration-500">
              <div className="w-24 h-24 bg-amber-100 rounded-[32px] flex items-center justify-center text-amber-600 mx-auto mb-8 border border-amber-200/50">
                  <AlertCircle size={48} />
              </div>
              <h2 className="text-2xl font-bold text-gray-800">部分服務未就緒 (Partial Services Down)</h2>
              <p className="text-gray-500 mt-2 text-sm">檢查發現部分服務探測異常，您可以在 Dashboard 中手動啟動。</p>

              <div className="mt-6">
                  <TerminalLog logs={onboardingAction.logs} height="h-40" title="Launch Check Logs" />
              </div>

              <div className="mt-8 flex flex-col gap-3">
                  <p className="text-[11px] text-gray-400 font-medium">
                      提示：您可以重試檢查，或直接進入 Dashboard。
                  </p>
                  <div className="flex gap-3">
                      <button
                          onClick={() => { setProgress(0); onboardingAction.reset(); runSetup(); }}
                          className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 px-6 py-4 rounded-2xl font-black transition-all active:scale-95 text-sm"
                      >
                          重試檢查 (Retry)
                      </button>
                      <button
                          onClick={onComplete}
                          className="flex-1 bg-amber-500 hover:bg-amber-400 text-white px-6 py-4 rounded-2xl font-black transition-all shadow-lg active:scale-95 text-sm"
                      >
                          進入 Dashboard
                      </button>
                  </div>
              </div>
          </div>
      );
  }

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-3xl shadow-xl shadow-gray-100 border border-gray-100 p-12 animate-in fade-in zoom-in-95 duration-500">
      {status !== 'success' ? (
        <div className="space-y-10">
          <div className="text-center space-y-6">
            <div className="relative inline-flex items-center justify-center">
                <div className="w-24 h-24 bg-blue-50 rounded-full animate-ping absolute opacity-20"></div>
                <div className="w-24 h-24 bg-blue-100 rounded-[32px] flex items-center justify-center text-blue-600 relative animate-pulse shadow-inner border border-blue-200/50">
                <Rocket size={40} />
                </div>
            </div>

            <div className="space-y-2">
                <h2 className="text-3xl font-black text-gray-900 tracking-tight">{steps[status]}</h2>
                <p className="text-gray-500 font-medium">{t('launch.wip.desc')}</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between text-xs font-black text-gray-400 uppercase tracking-widest px-1">
              <span>{t('launch.wip.initializing')}</span>
              <span className="text-blue-600">{progress}%</span>
            </div>
            <div className="w-full h-4 bg-gray-100 rounded-2xl overflow-hidden border border-gray-200/50 p-1">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl transition-all duration-700 ease-out shadow-sm"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>

          <div className="space-y-3">
             <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
                <Loader2 size={12} className="animate-spin text-blue-500" />
                驗證進度 (Verification Pulse)
             </div>
             <TerminalLog logs={onboardingAction.logs} height="h-48" title="OpenClaw Launch Logs" />
          </div>
        </div>
      ) : (
        <div className="space-y-8 animate-in zoom-in duration-600 py-4">
          <div className="text-center space-y-6">
            <div className="w-24 h-24 bg-emerald-100 rounded-[32px] flex items-center justify-center text-emerald-600 mx-auto shadow-inner border border-emerald-200/50 animate-bounce">
                <CheckCircle2 size={48} />
            </div>

            <div className="space-y-2">
                <h2 className="text-4xl font-black text-gray-900 tracking-tight">{String(t('launch.success.title') || 'Ready')}</h2>
              <p className="text-gray-500 font-medium text-lg leading-relaxed whitespace-pre-line">
                <Trans i18nKey="launch.success.desc" components={{ br: <br /> }} />
              </p>
            </div>
          </div>

          <div className="bg-slate-50 rounded-3xl p-8 text-left border border-slate-100 space-y-6">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Terminal size={14} className="text-slate-500" />系統配置摘要 (Config Summary)
            </h4>
            <ul className="space-y-4">
              <SummaryItem label="用戶定位" value={userType === 'existing' ? '已有安裝 (Existing)' : '新建專案 (New)'} />
              <SummaryItem 
                label="靈魂核心" 
                value={(() => {
                    const mapping = {
                        'apiKey': 'Anthropic API Key',
                        'openai-api-key': 'OpenAI API Key',
                        'gemini-api-key': 'Gemini API Key',
                        'ollama': 'Ollama (Local)',
                        'vllm': 'vLLM (Local)',
                        'minimax-api': 'MiniMax API',
                        'moonshot-api-key': 'Moonshot (Kimi)',
                        'openrouter-api-key': 'OpenRouter',
                        'xai-api-key': 'xAI (Grok)'
                    };
                    return mapping[config.authChoice] || config.authChoice || 'Unknown';
                })()} 
              />
              <SummaryItem label="通訊終端" value={config.platform || 'Unknown'} />
              <SummaryItem label="已安裝技能" value={`${workspaceSkills?.length || 0} 項模組`} />
            </ul>
          </div>

          <button 
            onClick={onComplete}
            className="w-full flex items-center justify-center gap-3 bg-gray-900 hover:bg-black text-white font-black py-5 px-8 rounded-[24px] transition-all shadow-2xl shadow-gray-200 active:scale-[0.98] group"
          >
            {t('launch.success.enterBtn')} 
            <PartyPopper size={24} className="group-hover:rotate-12 transition-transform text-amber-400" />
          </button>
        </div>
      )}
    </div>
  );
};

const SummaryItem = ({ label, value }) => (
    <li className="flex items-start gap-3 group">
        <div className="mt-0.5 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center text-white shrink-0 shadow-lg shadow-emerald-500/20 group-hover:scale-110 transition-transform">
            <CheckCircle2 size={12} strokeWidth={4} />
        </div>
        <div>
            <span className="text-slate-500 text-sm font-medium mr-2">{label}:</span>
            <span className="font-black text-slate-800 text-sm">{value}</span>
        </div>
    </li>
);

export default SetupStepLaunch;
