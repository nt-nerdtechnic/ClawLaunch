import { useState, useEffect } from 'react';
import { Layout, Terminal, Settings, Download, Activity, CheckCircle2, Play, Square, Loader2, User, Boxes, MonitorPlay, BarChart3, AlertCircle } from 'lucide-react';
import { MiniView } from './components/MiniView';
import { SkillManager } from './components/SkillManager';
import { Analytics } from './components/Analytics';
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
  const { running, setRunning, logs, addLog, envStatus, setEnvStatus } = useStore();
  const [viewMode, setViewMode] = useState<'mini' | 'expanded'>('expanded');
  const [activeTab, setActiveTab] = useState('installer');
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    checkEnvironment();
    syncGatewayStatus();
    
    if (window.electronAPI) {
      window.electronAPI.onLog((payload) => {
        addLog(payload.data, payload.source as any);
      });
    }
  }, []);

  const toggleViewMode = () => {
    const newMode = viewMode === 'expanded' ? 'mini' : 'expanded';
    setViewMode(newMode);
    window.electronAPI.resize(newMode);
  };

  const syncGatewayStatus = async () => {
      try {
          const res = await window.electronAPI.exec('pnpm openclaw gateway status');
          if (res.stdout.includes('online') || res.stdout.includes('running')) {
              setRunning(true);
          }
      } catch(e) {}
  }

  const checkEnvironment = async () => {
    addLog("[*] 正在診斷本地環境...");
    
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
    addLog("[+] 環境診斷完成。");
  };

  const handleInstall = async () => {
    setInstalling(true);
    addLog(">>> 開始一鍵安裝 OpenClaw...", 'system');
    
    try {
      addLog("[1/2] 正在克隆儲存庫...", 'system');
      const clone = await window.electronAPI.exec('git clone https://github.com/OpenClaw/openclaw.git OpenClaw-Instance');
      
      if (clone.stdout.includes('fatal') && !clone.stdout.includes('already exists')) {
          throw new Error("Clone failed");
      }

      addLog("[2/2] 正在安裝依賴...", 'system');
      const install = await window.electronAPI.exec('cd OpenClaw-Instance && pnpm install');
      
      if (install.exitCode === 0 || install.code === 0) {
        addLog("✅ OpenClaw 安裝成功！", 'system');
        setInstalled(true);
      }
    } catch (e) {
      addLog("[!] 安裝失敗，請手動檢查環境。", 'stderr');
    } finally {
      setInstalling(false);
    }
  };

  const toggleGateway = async () => {
    if (running) {
      addLog(">>> 正在停止 Gateway...", 'system');
      await window.electronAPI.exec('pnpm openclaw gateway stop');
      setRunning(false);
    } else {
      addLog(">>> 正在啟動 OpenClaw Gateway...", 'system');
      window.electronAPI.exec('pnpm openclaw gateway start');
      setRunning(true);
    }
  };

  if (viewMode === 'mini') {
    return <MiniView running={running} onToggle={toggleGateway} onExpand={toggleViewMode} />;
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
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
          <NavItem icon={<Download size={18}/>} label="安裝導引" active={activeTab === 'installer'} onClick={() => setActiveTab('installer')} />
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
                {activeTab === 'installer' ? '一鍵部署中心' : activeTab === 'monitor' ? '核心進程哨兵' : activeTab === 'analytics' ? 'Token 消耗透視' : activeTab === 'skills' ? '技能插件矩陣' : '全局配置矩陣'}
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

        <div className="flex-1 p-10 overflow-y-auto relative scrollbar-hide">
          {activeTab === 'installer' && (
            <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <section className="grid grid-cols-3 gap-8">
                <StatusCard label="Node.js Engine" status={envStatus.node} />
                <StatusCard label="Git Version Control" status={envStatus.git} />
                <StatusCard label="pnpm Manager" status={envStatus.pnpm} />
              </section>

              {Object.values(envStatus).includes('error') && (
                  <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-3xl flex items-start space-x-4">
                      <AlertCircle className="text-red-500 shrink-0" />
                      <div>
                          <h4 className="font-bold text-red-400 text-sm">偵測到環境缺失</h4>
                          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                              請確保系統已安裝 Node.js 22+ 與 Git。您可以從 <a href="https://nodejs.org" className="text-blue-500 underline">官網</a> 下載。
                          </p>
                      </div>
                  </div>
              )}

              <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 flex items-center">
                        <Terminal size={14} className="mr-2" /> 部署日誌串流
                    </h3>
                </div>
                <div className="bg-black/80 backdrop-blur-xl rounded-2xl border border-slate-800 overflow-hidden shadow-2xl flex flex-col h-[300px]">
                  <div className="p-6 font-mono text-[12px] space-y-2 overflow-y-auto flex-1 scrollbar-hide text-blue-400/90 leading-relaxed">
                    {logs.map((log, i) => (
                        <div key={i} className="flex">
                            <span className="text-slate-600 mr-3 select-none">[{log.time}]</span>
                            <span className={log.source === 'stderr' ? 'text-red-400' : log.source === 'system' ? 'text-emerald-400' : 'text-blue-300'}>{log.text}</span>
                        </div>
                    ))}
                    <div className="animate-pulse w-2 h-4 bg-blue-500 mt-2" />
                  </div>
                </div>
              </section>

              <div className="flex justify-center">
                <button onClick={handleInstall} disabled={installing || installed || Object.values(envStatus).includes('error')} className={`group relative px-10 py-5 rounded-2xl font-black text-lg transition-all duration-500 flex items-center ${installed ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-2xl active:scale-95 disabled:opacity-50'}`}>
                    {installing ? <Loader2 className="mr-3 animate-spin" /> : <Download className="mr-3" />}
                    {installed ? 'OpenClaw 已成功就緒' : installing ? '正在建立主權實例...' : '啟動一鍵部署程序'}
                </button>
              </div>
            </div>
          )}

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
              <div className="bg-black/90 rounded-3xl border border-slate-800 flex flex-col h-[400px] overflow-hidden shadow-2xl">
                 <div className="bg-slate-900 px-6 py-3 border-b border-slate-800 text-[10px] font-black text-slate-500 uppercase tracking-widest">Live Stream</div>
                 <div className="p-6 font-mono text-[12px] space-y-1.5 overflow-y-auto flex-1 text-slate-300">
                    {logs.map((log, i) => <div key={i}>[{log.time}] {log.text}</div>)}
                 </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
              <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in zoom-in-95">
                  <div className="p-8 bg-slate-900/30 border border-slate-800 rounded-[32px] space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Telegram Bot Token</label>
                        <input type="password" value="••••••••••••••••••••••••" className="w-full bg-black/40 border border-slate-800 rounded-xl px-4 py-3 text-blue-400 font-mono outline-none" readOnly />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Primary Inference Engine</label>
                        <select className="w-full bg-black/40 border border-slate-800 rounded-xl px-4 py-3 text-blue-400 outline-none">
                            <option>google-antigravity/gemini-3-flash</option>
                            <option>ollama/llama3.2:3b</option>
                        </select>
                      </div>
                  </div>
                  <button className="w-full bg-blue-600 py-4 rounded-2xl font-black text-white shadow-xl">保存配置變更</button>
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
