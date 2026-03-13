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
    pathsConfirmed, setPathsConfirmed, setDetectedConfig
  } = useStore();

  const [probingKey, setProbingKey] = useState(null);
  const [showFullSetup, setShowFullSetup] = useState(false);

  const handleBrowse = async (key) => {
    if (window.electronAPI && window.electronAPI.selectDirectory) {
      const selectedPath = await window.electronAPI.selectDirectory();
      if (selectedPath) {
        setConfig({ [key]: selectedPath });
        setProbingKey(key);
        
        // 自動探針：掃描新選取的路徑是否含有配置
        try {
            const res = await window.electronAPI.exec(`config:probe ${selectedPath}`);
            if (res.code === 0 && res.stdout) {
                const probed = JSON.parse(res.stdout);
                if (probed.apiKey || probed.model) {
                    setConfig({
                        apiKey: probed.apiKey || config.apiKey,
                        model: probed.model || config.model,
                        configPath: probed.configPath || config.configPath
                    });
                    
                    // 同步更新偵測到的配置
                    setDetectedConfig({ 
                        apiKey: probed.apiKey, 
                        model: probed.model,
                        corePath: key === 'corePath' ? selectedPath : config.corePath,
                        configPath: probed.configPath || config.configPath,
                        workspacePath: key === 'workspacePath' ? selectedPath : config.workspacePath
                    });
                }
            }
        } catch(e) {
            console.error("Probe failed", e);
        } finally {
            setTimeout(() => setProbingKey(null), 500); 
        }
      }
    }
  };

  const handleImport = () => {
    if (detectedConfig) {
      const newConfig = {
        apiKey: detectedConfig.apiKey || config.apiKey,
        model: detectedConfig.model || config.model,
        corePath: detectedConfig.corePath || config.corePath,
        configPath: detectedConfig.configPath || config.configPath,
        workspacePath: detectedConfig.workspacePath || config.workspacePath
      };
      setConfig(newConfig);
      
      // 智慧跳轉：如果已經有靈魂（API Key 或模型），直接進入下一步
      if ((newConfig.apiKey && newConfig.apiKey.length > 0) || newConfig.model) {
          onNext();
      } else {
          setPathsConfirmed(true);
      }
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
    // 只要有金鑰或模型，即視為配置就緒
    if (config.apiKey || config.model) {
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
        <h2 className="text-2xl font-bold text-gray-800">
            {(detectedConfig || config.model) ? '連結並回歸機甲核心' : '為您的龍蝦注入靈魂'}
        </h2>
        <p className="text-gray-500 mt-2 italic text-sm">
            {(detectedConfig || config.model) 
              ? '「偵測到熟悉的靈魂頻率，正在準備重新連線...」' 
              : (!pathsConfirmed ? '「若要啟動機甲，必先對齊三區路徑」' : '「三區對位成功，準備加載核心靈魂」')}
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
                <span className="text-sm font-medium text-gray-700 font-black">組建環境狀態</span>
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
            <div className="p-5 bg-slate-900 rounded-3xl border border-slate-800 space-y-5 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10 rotate-12 pointer-events-none">
                    <Database size={80} className="text-blue-500" />
                </div>
                
                <div className="flex justify-between items-center relative z-10">
                    <h4 className="text-[11px] font-black text-blue-400 uppercase tracking-[0.3em] flex items-center gap-2">
                        機甲三區路徑分治系統
                    </h4>
                    {(detectingPaths || probingKey) && <Loader2 size={14} className="text-blue-400 animate-spin" />}
                </div>

                <div className="grid grid-cols-1 gap-4 relative z-10">
                    <div className="relative group">
                        <PathItem 
                            label="主核心區 (Core Path)" 
                            path={config.corePath || '未定位'} 
                            icon={<Package size={14}/>} 
                            onBrowse={() => handleBrowse('corePath')}
                        />
                        {probingKey === 'corePath' && (
                            <div className="absolute inset-0 bg-blue-600/5 backdrop-blur-[1px] rounded-xl flex items-center justify-center border border-blue-500/20 animate-pulse">
                                <span className="text-[10px] font-black text-blue-400 uppercase">正在校驗核心內容...</span>
                            </div>
                        )}
                    </div>

                    <div className="relative group">
                        <PathItem 
                            label="設定區資料夾 (Config Folder)" 
                            path={config.configPath || '未定位'} 
                            icon={<Settings size={14}/>} 
                            onBrowse={() => handleBrowse('configPath')}
                        />
                        {probingKey === 'configPath' && (
                            <div className="absolute inset-0 bg-blue-600/5 backdrop-blur-[1px] rounded-xl flex items-center justify-center border border-blue-500/20 animate-pulse">
                                <span className="text-[10px] font-black text-blue-400 uppercase">讀取設定檔案中...</span>
                            </div>
                        )}
                        {config.configPath && detectedConfig?.apiKey && (
                            <div className="absolute -top-2 -right-2 bg-emerald-500 text-white text-[8px] font-black px-2 py-0.5 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)] border border-white/20 animate-bounce">
                                配置已自動對齊
                            </div>
                        )}
                    </div>

                    <div className="relative group">
                        <PathItem 
                            label="工作區資料夾 (Workspace Folder)" 
                            path={config.workspacePath || '未定位'} 
                            icon={<Database size={14}/>} 
                            onBrowse={() => handleBrowse('workspacePath')}
                        />
                        {probingKey === 'workspacePath' && (
                            <div className="absolute inset-0 bg-blue-600/5 backdrop-blur-[1px] rounded-xl flex items-center justify-center border border-blue-500/20 animate-pulse">
                                <span className="text-[10px] font-black text-blue-400 uppercase">確認工作空間...</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 自動偵測提示區 */}
            {detectedConfig && (
                <div className="p-4 bg-gradient-to-r from-blue-700 to-blue-600 rounded-2xl shadow-xl shadow-blue-500/20 text-white flex items-center justify-between border border-blue-400/20 animate-in zoom-in-95">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-md">
                            <Bot size={20} className="text-white" />
                        </div>
                        <div>
                            <h4 className="text-sm font-black tracking-tight">偵測到既存靈魂！</h4>
                            <p className="text-[10px] opacity-90 font-medium tracking-wide">模型與 API 已對齊，準備好啟動機甲</p>
                        </div>
                    </div>
                    <button 
                        onClick={handleImport}
                        className="px-5 py-2.5 bg-white text-blue-700 text-[11px] font-black rounded-xl hover:bg-blue-50 transition-all shadow-lg active:scale-95 flex items-center gap-2 uppercase tracking-tighter"
                    >
                        快速對接並啟動 <ArrowRight size={14} />
                    </button>
                </div>
            )}

            {!detectedConfig && (
                <button 
                  onClick={() => setPathsConfirmed(true)} 
                  disabled={!config.corePath || !config.configPath}
                  className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-gray-100 disabled:text-gray-300 text-white font-black py-4 rounded-2xl transition-all shadow-2xl flex items-center justify-center gap-2 px-8 uppercase tracking-widest text-xs"
                >
                  確認路徑並手動設定核心 <ArrowRight size={16} />
                </button>
            )}
          </div>
        )}

        {/* 第二階段：模型與密鑰配置 (路徑完成後解鎖) */}
        {pathsConfirmed && (
          <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
             <button 
                onClick={() => setPathsConfirmed(false)}
                className="text-[10px] font-black text-gray-400 hover:text-blue-600 flex items-center gap-1 transition-colors uppercase tracking-widest"
             >
                ← 返回修改路徑
             </button>

            {/* 配置摘要 (若已有資料) */}
            {(config.apiKey || config.model) && !showFullSetup && (
                <div className="p-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl space-y-4">
                    <div className="flex justify-between items-center">
                        <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">
                            {(detectedConfig || config.model) ? '偵測到的核心配置' : '當前準備注入的靈魂'}
                        </h4>
                        <button 
                            onClick={() => setShowFullSetup(true)}
                            className="text-[10px] font-black text-blue-600 hover:underline"
                        >
                            更換其他模型
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
                            <p className="text-[9px] text-gray-400 uppercase font-black">核心模型</p>
                            <p className="text-xs font-bold text-slate-700 truncate">{config.model || '未設定'}</p>
                        </div>
                        <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
                            <p className="text-[9px] text-gray-400 uppercase font-black">API 密鑰</p>
                            <p className="text-xs font-mono text-slate-700">
                                {config.apiKey ? `••••••••${config.apiKey.slice(-4)}` : '(已透過環境對位)'}
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={handleNext}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-3.5 rounded-2xl transition-all shadow-xl shadow-blue-500/20 uppercase tracking-widest text-xs"
                    >
                        {(detectedConfig || config.model) ? '準備就緒：快速對接並啟動' : '準備就緒：注入靈魂核心'}
                    </button>
                </div>
            )}

            {/* 模型選擇卡片 (僅在需要修改或無資料時顯示) */}
            {(showFullSetup || (!config.apiKey && !config.model)) && (
                <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
                    <div className="space-y-3">
                        <label className="text-sm font-extrabold text-gray-700 flex items-center gap-2">
                            <span className="w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[10px]">1</span>
                            選擇主理模型
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                            <div 
                            onClick={() => setConfig({ model: 'claude-3-5' })}
                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                                config.model === 'claude-3-5' ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-500/5' : 'border-gray-200 hover:border-blue-200'
                            }`}
                            >
                            <h3 className="font-bold text-gray-800 text-sm">Claude 3.5 Sonnet</h3>
                            <p className="text-[10px] text-gray-500 mt-1">程式碼與邏輯能力頂級，推薦首選。</p>
                            </div>
                            <div 
                            onClick={() => setConfig({ model: 'gpt-4o' })}
                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                                config.model === 'gpt-4o' ? 'border-green-500 bg-green-50 shadow-lg shadow-green-500/5' : 'border-gray-200 hover:border-green-200'
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
                            <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-1 font-bold">
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
                            className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-mono shadow-inner" 
                            />
                        </div>
                        <p className="text-[10px] text-gray-400 font-medium">
                            密鑰僅會加密儲存於您的本地電腦。若使用專屬模型或本地部署，此項可留空。
                        </p>
                    </div>

                    <div className="pt-6">
                        <button 
                            onClick={handleNext} 
                            className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:bg-gray-200 disabled:text-gray-400 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-xl shadow-slate-900/10 uppercase tracking-widest text-xs"
                        >
                            確認並綁定通訊軟體 <ArrowRight size={18} />
                        </button>
                    </div>
                </div>
            ) [diff_block_end]}
          </div>
        )}
      </div>
    </div>
  );
};

export default SetupStepModel;
