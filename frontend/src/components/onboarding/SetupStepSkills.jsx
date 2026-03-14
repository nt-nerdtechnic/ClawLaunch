import React from 'react';
import { Package, Globe, Cpu, Shield, Check, ArrowRight, FileText, Zap, Layout, Loader2, AlertCircle } from 'lucide-react';
import { useStore } from '../../store';
import { useTranslation } from 'react-i18next';
import TerminalLog from '../common/TerminalLog';

/**
 * NT-ClawLaunch Onboarding: Skill Selection Step
 * Ref: Neil's Strategy - "Granting Superpowers" Alignment (2026-03-14)
 */
const SetupStepSkills = ({ onNext }) => {
  const { t } = useTranslation();
  const { config, toggleSkill, detectedConfig } = useStore();
  const [connecting, setConnecting] = React.useState(false);
  const [localLogs, setLocalLogs] = React.useState([]);
  const [execError, setExecError] = React.useState(null);

  const addLocalLog = (text, source = 'system') => {
    setLocalLogs(prev => [...prev.slice(-49), { text, source, time: new Date().toLocaleTimeString() }]);
  };

  const powerUps = [
    {
      id: 'browser-automation',
      icon: <Globe size={20} />,
      title: '網路導航員 (Browser)',
      desc: '自動化執行瀏覽器任務，甚至是幫您訂機票。',
      color: 'blue',
      recommended: true
    },
    {
      id: 'coding-agent',
      icon: <Cpu size={20} />,
      title: '開發自動化 (Coding)',
      desc: '整合 AI 開發核心，自動化修補與生成程式碼。',
      color: 'blue',
      recommended: true
    },
    {
      id: 'healthcheck',
      icon: <Shield size={20} />,
      title: '系統監控官 (Health)',
      desc: '自動診斷 Port 衝突與資料庫狀態，具備自我修復能力。',
      color: 'emerald',
      recommended: true
    },
    {
        id: 'obsidian-vault',
        icon: <FileText size={20} />,
        title: '記憶宮殿 (Knowledge)',
        desc: '連接您的 Obsidian 或知識庫，賦予 AI 長短期記憶。',
        color: 'purple',
        recommended: false
    }
  ];

  const coreSystems = [
    { id: 'soul-core', name: '靈魂核心 (Soul Core)', icon: <Zap size={14} /> },
    { id: 'cli-bridge', name: '終端電橋 (CLI Bridge)', icon: <Layout size={14} /> }
  ];

  const installedSkills = detectedConfig?.installedSkills || [];
  const selectedSkills = config.enabledSkills || [];

  // 智慧預選：如果初次安裝且沒選過，預選推薦項
  React.useEffect(() => {
    if (selectedSkills.length === 0 && installedSkills.length === 0) {
      powerUps.filter(s => s.recommended).forEach(s => {
        toggleSkill(s.id);
      });
    }
  }, []);



  const validateRuntimePaths = () => {
    const missing = [];
    if (!config.corePath) missing.push('Core Path');
    if (!config.configPath) missing.push('Config Path');
    if (!config.workspacePath) missing.push('Workspace Path');
    if (missing.length > 0) {
      const msg = `請先完成路徑設定：${missing.join(' / ')}`;
      setExecError(msg);
      addLocalLog(`❌ ${msg}`, 'stderr');
      return false;
    }
    return true;
  };

  const handleNext = async () => {
    if (!config.corePath || !config.configPath || !config.workspacePath) {
      const missing = [
        !config.corePath ? 'Core Path' : null,
        !config.configPath ? 'Config Path' : null,
        !config.workspacePath ? 'Workspace Path' : null
      ].filter(Boolean);
      setExecError(`缺少必要路徑：${missing.join(' / ')}。請先返回前一步完成路徑設定。`);
      return;
    }

    if (!validateRuntimePaths()) return;

    setConnecting(true);
    setExecError(null);
    setLocalLogs([]);

    const selectedSkills = config.enabledSkills || [];
    if (selectedSkills.length === 0) {
        onNext();
        return;
    }

    addLocalLog(`🧩 正在啟動能力注入程序 (${selectedSkills.length} 項模組)...`, "system");

    try {
        const corePath = config.corePath;
        const execCmd = corePath && corePath.includes('npm') ? 'npm run' : 'pnpm';

        for (const skillId of selectedSkills) {
            addLocalLog(`> 正在注入: ${skillId}...`, "system");
            const stateDirEnv = config.workspacePath ? `OPENCLAW_STATE_DIR="${config.workspacePath}" ` : '';
            const configPathEnv = config.configPath ? `OPENCLAW_CONFIG_PATH="${config.configPath}/config.json" ` : '';
            const envPrefix = `${stateDirEnv}${configPathEnv}`;
            const cmd = `cd "${corePath}" && ${envPrefix}${execCmd} openclaw config set skills.entries.${skillId}.enabled true`;
            const res = await window.electronAPI.exec(cmd);
            
            if (res.exitCode !== 0 && res.code !== 0) {
               addLocalLog(`⚠️ 模組 ${skillId} 注入回報異常: ${res.stderr}`, "stderr");
            }
        }

        addLocalLog("✅ 所有選定能力注入完成！", "system");
        await new Promise(r => setTimeout(r, 1000));
        onNext();
    } catch (err) {
        setExecError(err.message);
        addLocalLog(`❌ 技能注入系統出錯: ${err.message}`, "stderr");
        setConnecting(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-left">
      {/* 步驟頭部 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
            <Package size={20} />
          </div>
          <h2 className="text-2xl font-bold text-gray-800">
            賦予您的龍蝦超級能力
          </h2>
        </div>
        <p className="text-gray-500 italic">
          「選擇您希望下載並注入的技能模組，這將決定龍蝦的進化方向。」
        </p>
      </div>

      {/* 核心穩定性面板 (不可改) */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 mb-8 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 p-4 opacity-10 rotate-12 pointer-events-none">
            <Zap size={80} className="text-blue-500" />
        </div>
        <div className="flex items-center gap-2 text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] mb-4 relative z-10">
          核心系統狀態 (Stability Core)
        </div>
        <div className="flex flex-wrap gap-3 relative z-10">
          {coreSystems.map(skill => (
            <div key={skill.id} className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[11px] font-bold text-slate-300 shadow-sm backdrop-blur-md">
              <span className="text-blue-400">{skill.icon}</span> {skill.name}
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full ml-1 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            </div>
          ))}
        </div>
      </div>

      {/* 技能矩陣網格 */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        {powerUps.map((skill) => {
          const isInstalled = installedSkills.includes(skill.id);
          const isSelected = selectedSkills.includes(skill.id);
          
          return (
            <div 
              key={skill.id}
              onClick={() => !connecting && toggleSkill(skill.id)}
              className={`p-5 rounded-[2rem] border-2 cursor-pointer transition-all relative group h-full flex flex-col ${
                isSelected || isInstalled
                  ? 'border-blue-500 bg-blue-50/30' 
                  : 'border-gray-100 hover:border-blue-200 bg-white'
              } ${connecting ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {/* 選中標記 */}
              {(isSelected || isInstalled) && (
                <div className="absolute top-4 right-4 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg animate-in zoom-in-50">
                  <Check size={14} strokeWidth={4} />
                </div>
              )}

              {/* 推薦標籤 */}
              {skill.recommended && !isInstalled && !isSelected && (
                <div className="absolute top-4 right-4 px-2 py-0.5 bg-blue-600 text-white text-[8px] font-black rounded-full uppercase tracking-tighter">
                  REC
                </div>
              )}

              <div className={`w-12 h-12 rounded-2xl mb-4 flex items-center justify-center transition-transform group-hover:scale-110 ${
                isSelected || isInstalled ? 'bg-blue-600 text-white shadow-xl shadow-blue-600/20' : 'bg-slate-50 text-slate-400'
              }`}>
                {skill.icon}
              </div>
              <h3 className="font-black text-gray-800 text-sm mb-1">{skill.title}</h3>
              <p className="text-[11px] text-gray-400 leading-relaxed font-medium flex-grow">
                {skill.desc}
              </p>
              
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">POWER MODULE</span>
                {isInstalled ? (
                  <span className="text-[9px] font-black text-emerald-600 uppercase">已載入</span>
                ) : isSelected ? (
                  <span className="text-[9px] font-black text-blue-600 uppercase">準備注入</span>
                ) : <span className="text-[9px] font-black text-slate-300 uppercase">待命</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* 下一步按鈕與日誌 */}
      <div className="space-y-4">
        {connecting && (
            <div className="space-y-2 animate-in fade-in duration-300">
                <div className="flex items-center gap-2 text-[10px] font-black text-blue-500 uppercase tracking-widest px-1">
                    <Loader2 size={12} className="animate-spin" />
                    能力注入同步中 (Skill Injection Status)
                </div>
                <TerminalLog logs={localLogs} height="h-32" />
            </div>
        )}

        {execError && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-600 text-[11px] animate-in slide-in-from-top-1">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <p className="font-medium">{execError}</p>
            </div>
        )}

        <button 
          onClick={handleNext} 
          disabled={connecting}
          className={`w-full flex items-center justify-center gap-3 ${connecting ? 'bg-blue-400' : 'bg-slate-900 hover:bg-slate-800'} text-white font-black py-4 px-8 rounded-2xl transition-all shadow-2xl uppercase tracking-widest text-xs`}
        >
          {connecting ? (
             <>
                <Loader2 size={18} className="animate-spin" /> 正在賦予超級能力...
            </>
          ) : (
            <>注入能力：啟動龍蝦靈魂 <ArrowRight size={18} /></>
          )}
        </button>
      </div>
    </div>
  );
};

export default SetupStepSkills;
