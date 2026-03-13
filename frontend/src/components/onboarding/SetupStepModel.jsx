import React, { useState, useEffect } from 'react';
import { Key, ExternalLink, Bot, ArrowRight, Package, Settings, Database, Loader2 } from 'lucide-react';
import { useStore } from '../../store';

const PathItem = ({ label, path, icon, onBrowse }) => (
    <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center px-1">
            <p className="text-[10px] text-gray-500 uppercase font-black tracking-wider flex items-center gap-1.5">
                <span className="text-blue-500 opacity-60">{icon}</span>
                {label}
            </p>
            <div className={`w-1.5 h-1.5 rounded-full ${path && path !== '未定位' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-red-500 animate-pulse'}`} />
        </div>
        <div 
            onClick={onBrowse}
            className="group flex items-center gap-3 bg-black/40 hover:bg-black/60 border border-white/5 hover:border-blue-500/30 p-2.5 rounded-xl transition-all cursor-pointer shadow-inner"
        >
            <div className="flex-1 min-w-0">
                <p className="text-[12px] text-slate-300 font-mono truncate px-1">
                    {path || '點擊選擇路徑...'}
                </p>
            </div>
            <button 
                className="shrink-0 px-3 py-1.5 bg-blue-600/10 hover:bg-blue-600 text-blue-400 group-hover:text-white text-[10px] font-black rounded-lg border border-blue-500/20 transition-all uppercase tracking-tighter"
            >
                瀏覽
            </button>
        </div>
    </div>
);

const SetupStepModel = ({ onNext }) => {
  const { 
    config, setConfig, envStatus, setEnvStatus, 
    detectedConfig, userType, detectingPaths, 
    pathsConfirmed, setPathsConfirmed 
  } = useStore();

  const handleBrowse = async (key) => {
    if (window.electronAPI && window.electronAPI.selectDirectory) {
      const selectedPath = await window.electronAPI.selectDirectory();
      if (selectedPath) {
        setConfig({ [key]: selectedPath });
      }
    }
  };

  const handleImport = () => {
    if (detectedConfig) {
      setConfig({
        apiKey: detectedConfig.apiKey || config.apiKey,
        model: detectedConfig.model || config.model,
        corePath: detectedConfig.corePath || config.corePath,
        configPath: detectedConfig.configPath || config.configPath,
        workspacePath: detectedConfig.workspacePath || config.workspacePath
      });
      setPathsConfirmed(true);
    }
  };

  useEffect(() => {
    const checkEnvironment = async () => {
      const check = async (cmd) => {
          try {
              const res = await window.electronAPI.exec(cmd);
              return res.exitCode === 0 || res.code === 0 ? 'ok' : 'error';
          } catch (e) {
              return 'error';
          }
      };

      const node = await check('node -v');
      const git = await check('git --version');
      const pnpm = await check('pnpm -v');

      setEnvStatus({ node, git, pnpm });
    };
    
    if (envStatus.node === 'loading') {
      checkEnvironment();
    }
  }, []);
  
  const handleNext = () => {
    if (config.apiKey) {
      onNext();
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
      {/* 步驟頭部 */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-50 rounded-full text-blue-600 mb-4">
          <Bot size={24} />
        </div>
        <h2 className="text-2xl font-bold text-gray-800">為您的龍蝦注入靈魂</h2>
        <p className="text-gray-500 mt-2">
            {!pathsConfirmed ? '首先，讓我們確認您的機甲佈置環境' : '現在，請選擇一個核心大語言模型'}
        </p>
      </div>

      <div className="space-y-6">
        {/* 第一階段：環境與偵測 (偵測優先) */}
        {!pathsConfirmed && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* 環境檢查區 */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${envStatus.node !== 'loading' && envStatus.git !== 'loading' ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
                <span className="text-sm font-medium text-gray-700">組建環境狀態</span>
              </div>
              <div className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span className="text-[10px] text-gray-400 uppercase tracking-tighter">Node.js</span>
                  <span className={`text-[11px] font-bold ${envStatus.node === 'loading' ? 'text-gray-400' : envStatus.node === 'error' ? 'text-red-500' : 'text-blue-600'}`}>
                    {envStatus.node === 'loading' ? '檢測中...' : envStatus.node === 'error' ? '未安裝' : '已就緒'}
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] text-gray-400 uppercase tracking-tighter">Git</span>
                  <span className={`text-[11px] font-bold ${envStatus.git === 'loading' ? 'text-gray-400' : envStatus.git === 'error' ? 'text-red-500' : 'text-blue-600'}`}>
                    {envStatus.git === 'loading' ? '檢測中...' : envStatus.git === 'error' ? '未安裝' : '已就緒'}
                  </span>
                </div>
              </div>
            </div>

            {/* 三區分治路徑確認區 */}
            <div className="p-5 bg-slate-900 rounded-2xl border border-slate-800 space-y-4 shadow-xl">
                <div className="flex justify-between items-center">
                    <h4 className="text-xs font-black text-blue-400 uppercase tracking-[0.2em]">三區路徑分治偵測</h4>
                    {detectingPaths && <Loader2 size={12} className="text-blue-400 animate-spin" />}
                </div>
                <div className="grid grid-cols-1 gap-4">
                    <PathItem 
                        label="主核心區 (Core)" 
                        path={config.corePath || '未定位'} 
                        icon={<Package size={14}/>} 
                        onBrowse={() => handleBrowse('corePath')}
                    />
                    <PathItem 
                        label="設定區 (Config)" 
                        path={config.configPath || '未定位'} 
                        icon={<Settings size={14}/>} 
                        onBrowse={() => handleBrowse('configPath')}
                    />
                    <PathItem 
                        label="工作區 (Workspace)" 
                        path={config.workspacePath || '未定位'} 
                        icon={<Database size={14}/>} 
                        onBrowse={() => handleBrowse('workspacePath')}
                    />
                </div>
            </div>

            {/* 自動偵測提示區 */}
            {detectedConfig && (
                <div className="p-4 bg-blue-600 rounded-xl shadow-lg shadow-blue-500/20 text-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ArrowRight size={20} className="text-white" />
                        <div>
                            <h4 className="text-sm font-bold">偵測到現有靈魂！</h4>
                            <p className="text-[10px] opacity-80">已為您對齊既存的 API 與模型設定</p>
                        </div>
                    </div>
                    <button 
                        onClick={handleImport}
                        className="px-4 py-2 bg-white text-blue-600 text-xs font-bold rounded-lg hover:bg-blue-50 transition-colors"
                    >
                        一鍵對接並繼續
                    </button>
                </div>
            )}

            {!detectedConfig && (
                <button 
                  onClick={() => setPathsConfirmed(true)} 
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-500/20"
                >
                  確認路徑並手動配置靈魂
                </button>
            )}
          </div>
        )}

        {/* 第二階段：模型與密鑰配置 (路徑完成後解鎖) */}
        {pathsConfirmed && (
          <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
             <button 
                onClick={() => setPathsConfirmed(false)}
                className="text-xs text-gray-400 hover:text-blue-600 flex items-center gap-1 transition-colors"
             >
                ← 返回修改路徑
             </button>

            {/* 模型選擇卡片 */}
            <div className="space-y-3">
              <label className="text-sm font-extrabold text-gray-700 flex items-center gap-2">
                <span className="w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[10px]">1</span>
                選擇主理模型
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div 
                  onClick={() => setConfig({ model: 'claude-3-5' })}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    config.model === 'claude-3-5' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-200'
                  }`}
                >
                  <h3 className="font-bold text-gray-800 text-sm">Claude 3.5 Sonnet</h3>
                  <p className="text-[10px] text-gray-500 mt-1">程式碼與邏輯能力頂級，推薦首選。</p>
                </div>
                <div 
                  onClick={() => setConfig({ model: 'gpt-4o' })}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    config.model === 'gpt-4o' ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-200'
                  }`}
                >
                  <h3 className="font-bold text-gray-800 text-sm">GPT-4o</h3>
                  <p className="text-[10px] text-gray-500 mt-1">綜合能力強，反應速度快，生態系完善。</p>
                </div>
              </div>
            </div>

            {/* API 密鑰輸入區 */}
            <div className="space-y-3">
              <div className="flex justify-between items-center px-1">
                <label className="text-sm font-extrabold text-gray-700 flex items-center gap-2">
                    <span className="w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[10px]">2</span>
                    填寫 API Key
                </label>
                <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-1">
                  獲取密鑰 <ExternalLink size={10} />
                </a>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <Key size={16} />
                </div>
                <input 
                  type="password" 
                  placeholder="sk-..." 
                  value={config.apiKey} 
                  onChange={(e) => setConfig({ apiKey: e.target.value })} 
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-mono" 
                />
              </div>
              <p className="text-[10px] text-gray-400">
                密鑰僅會加密儲存於您的本地電腦，絕對安全。
              </p>
            </div>

            {/* 下一步按鈕 */}
            <div className="pt-6">
              <button 
                onClick={handleNext} 
                disabled={!config.apiKey}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-3.5 px-8 rounded-xl transition-all shadow-xl shadow-slate-900/10"
              >
                下一步：綁定通訊軟體 <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SetupStepModel;
