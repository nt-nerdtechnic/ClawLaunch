import React, { useState, useEffect, useRef } from 'react';
import { Rocket, CheckCircle2, Loader2, PartyPopper, Terminal, AlertCircle } from 'lucide-react';
import { useStore } from '../../store';
import { useTranslation } from 'react-i18next';
import TerminalLog from '../common/TerminalLog';

/**
 * NT-ClawLaunch Onboarding: Final Launch Step
 * Ref: Neil's Strategy - "Emotional Design & Loading States" (2026-03-12)
 * Implementation: Real Logic Bridge - connects to backend via window.electronAPI.exec
 */
const SetupStepLaunch = ({ onComplete }) => {
  const { config } = useStore();
  const { t } = useTranslation();
  const [status, setStatus] = useState('preparing'); // preparing, installing, finishing, success
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [localLogs, setLocalLogs] = useState([]);
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
      // Step 1: Preparing
      setStatus('preparing');
      setProgress(10);
      addLocalLog(t('launch.logs.initDir'), 'system');
      await new Promise(r => setTimeout(r, 1000));
      setProgress(20);

      // Step 2: Installing / Bridging CLI Auth
      setStatus('installing');
      addLocalLog('🚀 啟動靈魂核心授權橋接程序...', 'system');
      
      const isQuickSync = config.userType === 'existing' && !config.manuallyModified; 
      const corePath = config.corePath;
      const execCmd = corePath && corePath.includes('npm') ? 'npm run' : 'pnpm'; 

      if (isQuickSync) {
        addLocalLog(t('launch.logs.quickSync'), 'system');
        await new Promise(r => setTimeout(r, 800));
      } else {
        // [A] Execute CLI Onboard
        if (config.authChoice) {
            addLocalLog(`🔗 執行底層授權指令 (AuthChoice: ${config.authChoice})...`, 'system');
            
            // 建立與 OpenClaw 核心指令對齊的參數映射表
            const authFlagMapping = {
                'apiKey': '--anthropic-api-key',
                'openai-api-key': '--openai-api-key',
                'gemini-api-key': '--gemini-api-key',
                'minimax-api': '--minimax-api-key',
                'moonshot-api-key': '--moonshot-api-key',
                'moonshot-api-key-cn': '--moonshot-api-key',
                'openrouter-api-key': '--openrouter-api-key',
                'xai-api-key': '--xai-api-key',
                'mistral-api-key': '--mistral-api-key'
            };

            const flag = authFlagMapping[config.authChoice] || '--apiKey'; // 降級方案
            const authFlags = config.apiKey ? `${flag} "${config.apiKey}"` : '';
            
            // 使用 window.electronAPI.exec 直接執行，日誌會透過 ipc 傳回 localLogs
            const authCmd = `cd "${corePath}" && ${execCmd} openclaw onboard --auth-choice ${config.authChoice} ${authFlags} --non-interactive --accept-risk`;
            
            addLocalLog(`> 指令已發送至後端系統...`, 'system');
            const authRes = await window.electronAPI.exec(authCmd);

            if (authRes.exitCode === 0 || authRes.code === 0) {
                 addLocalLog('✅ 核心授權程序完成', 'system');
            } else {
                 addLocalLog(`⚠️ 授權程序回報異常：${authRes.stderr || '請檢查日誌輸出'}`, 'stderr');
            }
        }
      }
      
      setProgress(60);

      // Step 3: Finishing (Channel Setup & Skill Implementation)
      setStatus('finishing');
      
      // [B] Messaging Channel Bonding
      if (!isQuickSync && config.platform) {
           addLocalLog(`📡 啟動通訊頻道繫結程序 (${config.platform})...`, 'system');
           
           let channelFlags = '';
           if (config.botToken) {
               if (['telegram', 'slack', 'line'].includes(config.platform)) {
                   channelFlags = `--token "${config.botToken}"`;
               } else if (config.platform === 'discord') {
                   channelFlags = `--bot-token "${config.botToken}"`;
               } else if (config.platform === 'googlechat') {
                   channelFlags = `--webhook-url "${config.botToken}"`;
               }
           }

           const channelCmd = `cd "${corePath}" && ${execCmd} openclaw channels add --channel ${config.platform} ${channelFlags}`;
           addLocalLog(`> 正在繫結通訊終端...`, 'system');
           
           const channelRes = await window.electronAPI.exec(channelCmd);

           if (channelRes.exitCode === 0) {
               addLocalLog('✅ 通訊頻道繫結完成', 'system');
           } else {
               addLocalLog(`⚠️ 頻道繫結有誤：${channelRes.stderr || '請檢查日誌'}`, 'stderr');
           }
      }

      // [C] Skills Superpowers
      if (!isQuickSync && config.enabledSkills && config.enabledSkills.length > 0) {
          addLocalLog(`🧩 賦予龍蝦超能力 (${config.enabledSkills.length} 項能力注入)...`, 'system');
          for (const skillId of config.enabledSkills) {
              addLocalLog(`> 注入模組: ${skillId}...`, 'system');
              await window.electronAPI.exec(`cd "${corePath}" && ${execCmd} openclaw config set skills.entries.${skillId}.enabled true`);
          }
          addLocalLog('✅ 技能注入程序完成', 'system');
      }

      await new Promise(r => setTimeout(r, 1000));
      
      setProgress(100);
      setStatus('success');
      addLocalLog(t('launch.logs.initComplete'), 'system');

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

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-3xl shadow-xl shadow-gray-100 border border-gray-100 p-12 animate-in fade-in zoom-in-95 duration-500">
      {status !== 'success' ? (
        <div className="space-y-10">
          <div className="text-center space-y-6">
            {/* 蝦爪跳動動畫 */}
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

          {/* 進度條 */}
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

          {/* 實體日誌區域 (小視窗) */}
          <div className="space-y-3">
             <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
                <Loader2 size={12} className="animate-spin text-blue-500" />
                {t('launch.wip.process')}
             </div>
             <TerminalLog logs={localLogs} height="h-48" title="OpenClaw Setup Logs" />
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
              <Terminal size={14} className="text-slate-500" /> {t('launch.success.configSummaryTitle')}
            </h4>
            <ul className="space-y-4">
              <SummaryItem label="靈魂核心" value={config.model || 'Unknown'} />
              <SummaryItem label="加密頻道" value={config.platform ? config.platform.charAt(0).toUpperCase() + config.platform.slice(1) : 'Unknown'} />
              <SummaryItem label="注入異能" value={`${config.enabledSkills?.length || 0} 項能力模組`} />
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
