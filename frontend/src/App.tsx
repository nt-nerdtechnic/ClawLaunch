import { useState, useEffect } from 'react';
import { Layout, Settings, Activity, CheckCircle2, Play, Square, Loader2, User, Boxes, MonitorPlay, BarChart3 } from 'lucide-react';
import { MiniView } from './components/MiniView';
import { SkillManager } from './components/SkillManager';
import { Analytics } from './components/Analytics';
// @ts-ignore
import SetupWizard from './components/onboarding/SetupWizard';
import UpdateBanner from './components/UpdateBanner';
import { useStore } from './store';

declare global {
  interface Window {
    electronAPI: {
      exec: (command: string, args?: string[]) => Promise<{ code: number, stdout: string, stderr: string, exitCode?: number }>;
      onLog: (callback: (payload: { data: string, source: 'stdout' | 'stderr' }) => void) => void;
      resize: (mode: 'mini' | 'expanded') => void;
    }
  }
}

function App() {
  const { running, setRunning, logs, addLog, envStatus, setEnvStatus, config, setConfig, setDetectedConfig } = useStore();
  const [viewMode, setViewMode] = useState<'mini' | 'expanded'>('expanded');
  const [activeTab, setActiveTab] = useState('monitor'); // Default to monitor if onboarding finished
  const [onboardingFinished, setOnboardingFinished] = useState(false);

  useEffect(() => {
    initializeApp();
    
    if (window.electronAPI) {
      window.electronAPI.onLog((payload) => {
        addLog(payload.data, payload.source as any);
      });
    }
  }, []);

  const initializeApp = async () => {
    await checkEnvironment();
    await loadConfig();
    await detectPaths(); // New: Auto detect if not set
    await syncGatewayStatus();
    checkOnboardingStatus();
  };

  const detectPaths = async () => {
    const { setDetectingPaths } = useStore.getState();
    setDetectingPaths(true);
    
    if (window.electronAPI) {
      try {
          const res = await window.electronAPI.exec('detect:paths');
          if (res.code === 0 && res.stdout) {
            const detected = JSON.parse(res.stdout);
            const patch: any = {};
            
            // 自動修補路徑
            if (!config.corePath && detected.corePath) patch.corePath = detected.corePath;
            if (!config.configPath && detected.configPath) patch.configPath = detected.configPath;
            if (!config.workspacePath && (detected.workspacePath || detected.configPath)) {
                patch.workspacePath = detected.workspacePath || detected.configPath;
            }

            // [NEW] 緩存完整配置訊息以便「一鍵對接」
            if (detected.existingConfig && (detected.existingConfig.apiKey || detected.existingConfig.model)) {
                setDetectedConfig({
                    ...detected.existingConfig,
                    corePath: detected.corePath,
                    configPath: detected.configPath,
                    workspacePath: detected.workspacePath || detected.configPath
                });
            }

            if (Object.keys(patch).length > 0) {
              setConfig(patch);
              addLog(`>>> 自動偵測完成: 已連結至機甲核心`, 'system');
            }
          }
      } catch (e) {
          console.error("Auto detection failed", e);
      }
    }
    setDetectingPaths(false);
  };

  const loadConfig = async () => {
    if (window.electronAPI) {
      try {
        const res = await window.electronAPI.exec('config:read');
        if (res.code === 0 && res.stdout) {
          const savedConfig = JSON.parse(res.stdout);
          const { setConfig } = useStore.getState(); // Directly get from store to avoid stale closure
          setConfig(savedConfig);
        }
      } catch (e) {
        console.error("Failed to load config", e);
      }
    }
  };

  const checkOnboardingStatus = () => {
    // Logic to check if OpenClaw is already configured
    // For now, let's keep it in onboarding if not explicitly finished
    const finished = localStorage.getItem('onboarding_finished') === 'true';
    setOnboardingFinished(finished);
    if (!finished) {
      setActiveTab('onboarding');
    }
  };

  const handleOnboardingComplete = () => {
    localStorage.setItem('onboarding_finished', 'true');
    setOnboardingFinished(true);
    setActiveTab('monitor');
  };

  const toggleViewMode = () => {
    const newMode = viewMode === 'expanded' ? 'mini' : 'expanded';
    setViewMode(newMode);
    window.electronAPI.resize(newMode);
  };

  const syncGatewayStatus = async () => {
      try {
          const cmd = config.corePath 
            ? `cd ${config.corePath} && pnpm openclaw gateway status` 
            : 'pnpm openclaw gateway status';
          const res = await window.electronAPI.exec(cmd);
          if (res.stdout.includes('online') || res.stdout.includes('running')) {
              setRunning(true);
          }
      } catch(e) {}
  }

  const checkEnvironment = async () => {
    const check = async (cmd: string) => {
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

  const toggleGateway = async () => {
    if (running) {
      addLog(">>> 正在停止 Gateway...", 'system');
      try {
        await window.electronAPI.exec('pnpm openclaw gateway stop');
        setRunning(false);
        addLog(">>> Gateway 已停止", 'system');
      } catch (e: any) {
        addLog(`誤差: 停止 Gateway 失敗 - ${e.message}`, 'stderr');
      }
    } else {
      addLog(">>> 正在啟動 OpenClaw Gateway...", 'system');
      try {
        const cmd = config.corePath 
            ? `cd ${config.corePath} && pnpm openclaw gateway start` 
            : 'pnpm openclaw gateway start';
        const res = await window.electronAPI.exec(cmd);
        if (res.code === 0) {
          setRunning(true);
          addLog(">>> Gateway 啟動指令已發送", 'system');
        } else {
          addLog(`錯誤: ${res.stderr}`, 'stderr');
        }
      } catch (e: any) {
        addLog(`誤差: 啟動 Gateway 失敗 - ${e.message}`, 'stderr');
      }
    }
  };

  const handleSaveConfig = async () => {
    if (!window.electronAPI) return;
    addLog(">>> 正在保存配置...", 'system');
    try {
      const res = await window.electronAPI.exec(`config:write ${JSON.stringify(config)}`);
      if (res.code === 0) {
        addLog(">>> 配置已成功保存到本地磁碟", 'system');
      } else {
        addLog(`誤差: 保存配置失敗 - ${res.stderr}`, 'stderr');
      }
    } catch (e: any) {
      addLog(`誤差: 通訊失敗 - ${e.message}`, 'stderr');
    }
  };

  if (viewMode === 'mini') {
    return <MiniView running={running} onToggle={toggleGateway} onExpand={toggleViewMode} />;
  }

  // If not finished onboarding, show the wizard
  if (!onboardingFinished) {
    return <SetupWizard onFinished={handleOnboardingComplete} />;
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden animate-in fade-in duration-700">
      {/* Sidebar */}
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col p-4 space-y-6">
        <div className="flex items-center space-y-1 py-4 px-2">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center mr-3 shadow-xl shadow-blue-500/20">
            <Layout size={20} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-lg leading-none tracking-tight">NT-Claw</div>
            <div className="text-[10px] text-blue-500 font-mono uppercase tracking-widest">Launch Pad</div>
          </div>
        </div>
        
        <nav className="flex-1 space-y-1">
          <NavItem icon={<Activity size={18}/>} label="進程監控" active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} />
          <NavItem icon={<BarChart3 size={18}/>} label="數據看板" active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} />
          <NavItem icon={<Boxes size={18}/>} label="技能管理" active={activeTab === 'skills'} onClick={() => setActiveTab('skills')} />
          <NavItem icon={<Settings size={18}/>} label="配置編輯" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>

        <div onClick={toggleViewMode} className="p-4 bg-blue-600/10 rounded-2xl border border-blue-500/20 cursor-pointer hover:bg-blue-600/20 transition-all flex items-center justify-between group">
            <div className="text-[10px] text-blue-400 uppercase font-black tracking-widest">切換小窗模式</div>
            <MonitorPlay size={14} className="text-blue-400 group-hover:scale-110 transition-transform" />
        </div>

        <div className="pt-4 border-t border-slate-800 text-[10px] text-slate-600 px-2 flex justify-between items-center font-mono">
          <span>VER 2026.1.0</span>
          <span className="flex items-center"><div className="w-2 h-2 rounded-full bg-emerald-500 mr-1 animate-pulse"></div> ONLINE</span>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#020617] relative">
        <header className="h-20 border-b border-slate-800/50 flex items-center px-10 justify-between relative backdrop-blur-md bg-slate-950/20">
          <div>
            <h2 className="font-bold text-xl text-slate-100 uppercase tracking-tight">
                {activeTab === 'monitor' ? '核心進程哨兵' : activeTab === 'analytics' ? 'Token 消耗透視' : activeTab === 'skills' ? '技能插件矩陣' : '全局配置矩陣'}
            </h2>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center bg-slate-900/80 px-4 py-2 rounded-full border border-slate-800">
                <Activity size={14} className={`mr-2 ${running ? 'text-emerald-400 animate-pulse' : 'text-slate-600'}`} />
                <span className={`text-[10px] font-black ${running ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {running ? 'GATEWAY ACTIVE' : 'STANDBY'}
                </span>
            </div>
            <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center cursor-pointer hover:bg-slate-700 transition-colors">
                <User size={18} className="text-slate-400" />
            </div>
          </div>
        </header>

        <div className="flex-1 p-10 overflow-y-auto relative">
          {activeTab !== 'onboarding' && onboardingFinished && <UpdateBanner />}
          {activeTab === 'skills' && <SkillManager />}

          {activeTab === 'analytics' && <Analytics />}

          {activeTab === 'monitor' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="bg-slate-900/30 backdrop-blur-md border border-slate-800 p-8 rounded-3xl flex items-center justify-between shadow-lg">
                <div>
                    <h3 className="text-xl font-bold text-slate-100">Gateway 通訊中樞</h3>
                    <p className="text-sm text-slate-500 mt-1">負責維持所有 AI 代理的通訊鏈路穩定性。</p>
                </div>
                <button onClick={toggleGateway} className={`px-8 py-4 rounded-2xl font-black flex items-center transition-all ${running ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/20'}`}>
                  {running ? <Square size={18} className="mr-2 fill-current" /> : <Play size={18} className="mr-2 fill-current" />}
                  {running ? '中斷連線' : '啟動服務'}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-8">
                <StatusCard label="Node.js Engine" status={envStatus.node} />
                <StatusCard label="Git Version Control" status={envStatus.git} />
                <StatusCard label="pnpm Manager" status={envStatus.pnpm} />
              </div>

              <div className="bg-black/90 rounded-3xl border border-slate-800 flex flex-col h-[400px] overflow-hidden shadow-2xl">
                 <div className="bg-slate-900 px-6 py-3 border-b border-slate-800 text-[10px] font-black text-slate-500 uppercase tracking-widest">Live Stream</div>
                 <div className="p-6 font-mono text-[12px] space-y-1.5 overflow-y-auto flex-1 text-slate-300">
                    {logs.map((log, i) => <div key={i} className="flex">
                        <span className="text-slate-600 mr-3">[{log.time}]</span>
                        <span>{log.text}</span>
                    </div>)}
                 </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
              <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in zoom-in-95">
                  <div className="p-8 bg-slate-900/30 border border-slate-800 rounded-[32px] space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Telegram Bot Token</label>
                        <input 
                          type="password" 
                          value={config.botToken} 
                          onChange={(e) => setConfig({ botToken: e.target.value })}
                          placeholder="輸入您的 Bot Token..."
                          className="w-full bg-black/40 border border-slate-800 rounded-xl px-4 py-3 text-blue-400 font-mono outline-none focus:border-blue-500/50 transition-colors" 
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Primary Inference Engine</label>
                        <select 
                          value={config.model}
                          onChange={(e) => setConfig({ model: e.target.value })}
                          className="w-full bg-black/40 border border-slate-800 rounded-xl px-4 py-3 text-blue-400 outline-none focus:border-blue-500/50 transition-colors"
                        >
                            <option value="google-antigravity/gemini-3-flash">google-antigravity/gemini-3-flash</option>
                            <option value="ollama/llama3.2:3b">ollama/llama3.2:3b</option>
                            <option value="claude-3-5">anthropic/claude-3.5-sonnet</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">OpenClaw 主核心區 (Core)</label>
                            <input 
                                type="text" 
                                value={config.corePath} 
                                onChange={(e) => setConfig({ corePath: e.target.value })}
                                placeholder="留空則使用系統預設路徑"
                                className="w-full bg-black/40 border border-slate-800 rounded-xl px-4 py-3 text-slate-300 font-mono text-xs outline-none focus:border-blue-500/50 transition-colors" 
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">OpenClaw 設定區 (Config)</label>
                            <input 
                                type="text" 
                                value={config.configPath} 
                                onChange={(e) => setConfig({ configPath: e.target.value })}
                                placeholder="留空則使用預設路徑"
                                className="w-full bg-black/40 border border-slate-800 rounded-xl px-4 py-3 text-slate-300 font-mono text-xs outline-none focus:border-blue-500/50 transition-colors" 
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">工作區 (Workspace)</label>
                            <input 
                                type="text" 
                                value={config.workspacePath} 
                                onChange={(e) => setConfig({ workspacePath: e.target.value })}
                                placeholder="例如: ~/.openclaw"
                                className="w-full bg-black/40 border border-slate-800 rounded-xl px-4 py-3 text-slate-300 font-mono text-xs outline-none focus:border-blue-500/50 transition-colors" 
                            />
                        </div>
                      </div>
                  </div>
                  <button 
                    onClick={handleSaveConfig}
                    className="w-full bg-blue-600 hover:bg-blue-500 active:scale-[0.98] py-4 rounded-2xl font-black text-white shadow-xl shadow-blue-600/20 transition-all"
                  >
                    保存配置變更
                  </button>
              </div>
          )}
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick }: { icon: any, label: string, active?: boolean, onClick: () => void }) {
  return (
    <div onClick={onClick} className={`flex items-center px-4 py-4 rounded-2xl cursor-pointer transition-all duration-300 ${active ? 'bg-blue-600/10 text-blue-400 shadow-inner' : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'}`}>
      <span className={`mr-4 ${active ? 'scale-110 opacity-100' : 'opacity-70'}`}>{icon}</span>
      <span className={`text-[13px] font-bold uppercase tracking-wider ${active ? 'opacity-100' : 'opacity-60'}`}>{label}</span>
    </div>
  );
}

function StatusCard({ label, status }: { label: string, status: string }) {
  return (
    <div className="bg-slate-900/20 backdrop-blur-sm border border-slate-800 p-6 rounded-3xl flex items-center justify-between group">
      <div className="flex-1">
        <div className="text-[10px] text-slate-600 uppercase font-black tracking-[0.2em] mb-2">{label}</div>
        <div className={`font-black tracking-tighter text-2xl ${status === 'ok' ? 'text-slate-100' : 'text-slate-600'}`}>{status === 'ok' ? 'VERIFIED' : 'ANALYZING...'}</div>
      </div>
      {status === 'ok' ? <CheckCircle2 className="text-emerald-500 transition-transform group-hover:scale-110" /> : <Loader2 className="text-amber-500 animate-spin" />}
    </div>
  );
}

export default App;