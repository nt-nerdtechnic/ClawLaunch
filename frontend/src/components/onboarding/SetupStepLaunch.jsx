import React, { useState, useEffect, useRef } from 'react';
import { Rocket, CheckCircle2, Loader2, PartyPopper, Terminal, AlertCircle } from 'lucide-react';
import { useStore } from '../../store';
import { useTranslation } from 'react-i18next';
import TerminalLog from '../common/TerminalLog';

/**
 * NT-ClawLaunch Onboarding: Final Launch Step
 * Refactored: Verification & Finalization Mode (2026-03-14)
 */
const SetupStepLaunch = ({ onComplete }) => {
  const { config } = useStore();
  const { t } = useTranslation();
  const [status, setStatus] = useState('preparing'); // preparing, installing, finishing, success, partial_failure
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [localLogs, setLocalLogs] = useState([]);
  const [checkWarnings, setCheckWarnings] = useState([]);
  const logCleanupRef = useRef(null);

  const steps = {
    preparing: t('launch.steps.preparing'),
    installing: t('launch.steps.installing'),
    finishing: t('launch.steps.finishing'),
    success: t('launch.steps.success')
  };

  const addLocalLog = (text, source = 'system') => {
    setLocalLogs(prev => [...prev.slice(-49), { text, source, time: new Date().toLocaleTimeString() }]);
  };

  useEffect(() => {
    if (window.electronAPI) {
        logCleanupRef.current = window.electronAPI.onLog((payload) => {
            addLocalLog(payload.data, payload.source);
        });
    }
    
    runSetup();

    return () => {
        if (typeof logCleanupRef.current === 'function') {
            logCleanupRef.current();
        }
    };
  }, []);

  const runSetup = async () => {
    try {
      // Guard: corePath must be set before running any CLI commands
      if (!config.corePath) {
        setError('缺少核心路徑 (Core Path missing)。請返回上一步設定 Core Path 後再繼續。');
        addLocalLog('❌ 核心路徑未設定，無法執行啟動檢查。', 'stderr');
        return;
      }

      // Step 1: Verification Warmup
      setStatus('preparing');
      setProgress(10);
      addLocalLog('🚀 啟動最終發射檢查程序 (Final Launch Verification)...', 'system');
      await new Promise(r => setTimeout(r, 1000));
      setProgress(20);

      // Step 2: System Pulse Checks
      setStatus('installing');
      const corePath = config.corePath;
      const execCmd = corePath && corePath.includes('npm') ? 'npm run' : 'pnpm';

      const stateDirEnv = config.workspacePath ? `OPENCLAW_STATE_DIR="${config.workspacePath}" ` : '';
      const configPathEnv = config.configPath ? `OPENCLAW_CONFIG_PATH="${config.configPath}/config.json" ` : '';
      const envPrefix = `${stateDirEnv}${configPathEnv}`;

      const warnings = [];

      // [1] Gateway 狀態驗證
      addLocalLog('🔍 正在探測網關狀態 (Gateway Pulse Check)...', 'system');
      const gatewayRes = await window.electronAPI.exec(`cd "${corePath}" && ${envPrefix}${execCmd} openclaw gateway status`);
      if (gatewayRes.exitCode === 0 || gatewayRes.code === 0) {
          addLocalLog('✅ 網關服務連通性正常', 'system');
      } else {
          const msg = '網關探測異常，可能需要手動啟動：' + (gatewayRes.stderr || '未知錯誤');
          addLocalLog('⚠️ ' + msg, 'stderr');
          warnings.push(msg);
      }
      setProgress(50);

      // [2] Daemon 健康度檢查
      setStatus('finishing');
      addLocalLog('🔍 正在檢查守護進程健康度 (Daemon Health Check)...', 'system');
      const healthRes = await window.electronAPI.exec(`cd "${corePath}" && ${envPrefix}${execCmd} openclaw health`);
      if (healthRes.exitCode === 0 || healthRes.code === 0) {
          addLocalLog('✅ 守護進程狀態綠燈', 'system');
      } else {
          const msg = '守護進程尚未就緒。您可以繼續並在 Dashboard 中手動啟動。';
          addLocalLog('⚠️ ' + msg, 'stderr');
          warnings.push(msg);
      }
      setProgress(80);

      // [3] 配置收尾 (Finalize Config)
      addLocalLog('🛠️ 正在執行最後的配置同步 (Syncing Workspaces)...', 'system');
      await new Promise(r => setTimeout(r, 1000));

      setProgress(100);

      if (warnings.length > 0) {
          addLocalLog('⚠️ 部分檢查未通過，請查看警告訊息後決定是否繼續。', 'stderr');
          setCheckWarnings(warnings);
          setStatus('partial_failure');
      } else {
          addLocalLog('✨ 全系統配置檢核完成。龍蝦已準備好進入戰鬥位置！', 'system');
          setStatus('success');
      }

    } catch (err) {
      console.error(err);
      setError(err.message);
      addLocalLog(t('launch.logs.installFailed', { msg: err.message }), 'stderr');
    }
  };

  if (error) {
      return (
          <div className="w-full max-w-2xl mx-auto bg-white rounded-3xl shadow-xl shadow-gray-100 border border-red-100 p-12 text-center animate-in fade-in zoom-in-95 duration-500">
              <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center text-red-600 mx-auto mb-8 animate-bounce">
                  <Terminal size={48} />
              </div>
              <h2 className="text-2xl font-bold text-gray-800">{t('launch.error.title')}</h2>
              <p className="text-red-500 mt-4 font-mono text-sm px-4 py-2 bg-red-50 rounded-xl inline-block">{error}</p>
              
              <div className="mt-8">
                  <TerminalLog logs={localLogs} height="h-48" title="Error Debug Log" />
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
              <p className="text-gray-500 mt-2 text-sm">以下服務檢查未通過，請確認後決定是否繼續進入 Dashboard。</p>

              <div className="mt-6 space-y-3 text-left">
                  {checkWarnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-100 rounded-2xl">
                          <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                          <p className="text-amber-800 text-[12px] font-medium">{w}</p>
                      </div>
                  ))}
              </div>

              <div className="mt-6">
                  <TerminalLog logs={localLogs} height="h-40" title="Launch Check Logs" />
              </div>

              <div className="mt-8 flex flex-col gap-3">
                  <p className="text-[11px] text-gray-400 font-medium">
                      提示：您可以重試檢查，或先進入 Dashboard 並在服務管理頁手動啟動各服務。
                  </p>
                  <div className="flex gap-3">
                      <button
                          onClick={() => { setStatus('preparing'); setProgress(0); setCheckWarnings([]); setLocalLogs([]); runSetup(); }}
                          className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 px-6 py-4 rounded-2xl font-black transition-all active:scale-95 text-sm"
                      >
                          重試檢查 (Retry Checks)
                      </button>
                      <button
                          onClick={onComplete}
                          className="flex-1 bg-amber-500 hover:bg-amber-400 text-white px-6 py-4 rounded-2xl font-black transition-all shadow-lg active:scale-95 text-sm"
                      >
                          仍然進入 Dashboard
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
             <TerminalLog logs={localLogs} height="h-48" title="OpenClaw Launch Logs" />
          </div>
        </div>
      ) : (
        <div className="space-y-8 animate-in zoom-in duration-600 py-4">
          <div className="text-center space-y-6">
            <div className="w-24 h-24 bg-emerald-100 rounded-[32px] flex items-center justify-center text-emerald-600 mx-auto shadow-inner border border-emerald-200/50 animate-bounce">
                <CheckCircle2 size={48} />
            </div>

            <div className="space-y-2">
                <h2 className="text-4xl font-black text-gray-900 tracking-tight">{t('launch.success.title')}</h2>
                <p className="text-gray-500 font-medium text-lg leading-relaxed" dangerouslySetInnerHTML={{ __html: t('launch.success.desc') }}></p>
            </div>
          </div>

          <div className="bg-slate-50 rounded-3xl p-8 text-left border border-slate-100 space-y-6">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Terminal size={14} className="text-slate-500" />系統配置摘要 (Config Summary)
            </h4>
            <ul className="space-y-4">
              <SummaryItem label="靈魂核心" value={config.authChoice || 'Unknown'} />
              <SummaryItem label="通訊終端" value={config.platform || 'Unknown'} />
              <SummaryItem label="注入異能" value={`${config.enabledSkills?.length || 0} 項模組`} />
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
