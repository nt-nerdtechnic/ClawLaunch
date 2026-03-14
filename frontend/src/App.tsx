import { useState, useEffect } from 'react';
import { Layout, Settings, Activity, CheckCircle2, Play, Square, Loader2, Boxes, MonitorPlay, BarChart3, LogOut, AlertCircle, X } from 'lucide-react';
import { MiniView } from './components/MiniView';
import { SkillManager } from './components/SkillManager';
import { ActionCenter } from './components/ActionCenter';
import { StaffGrid } from './components/StaffGrid';
import { Analytics } from './components/Analytics';
import { ThemeToggle } from './components/ThemeToggle';
import { LanguageToggle } from './components/LanguageToggle';
import { useTranslation } from 'react-i18next';
// @ts-ignore
import SetupWizard from './components/onboarding/SetupWizard';
import UpdateBanner from './components/UpdateBanner';
import { useStore } from './store';
import { execInTerminal } from './utils/terminal';

function App() {
  const { running, setRunning, logs, addLog, envStatus, setEnvStatus, config, setConfig, setDetectedConfig, setCoreSkills, setWorkspaceSkills } = useStore();
  const [viewMode, setViewMode] = useState<'mini' | 'expanded'>('expanded');
  const [activeTab, setActiveTab] = useState('monitor'); // Default to monitor if onboarding finished
  const [onboardingFinished, setOnboardingFinished] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    initializeApp();
    
    if (window.electronAPI) {
      window.electronAPI.onLog((payload) => {
        addLog(payload.data, payload.source as any);
      });
    }
  }, []); // Run ONLY once on mount

  // Separate effect for snapshot sync
  useEffect(() => {
    if (!config.corePath) return;

    const interval = setInterval(() => {
        syncSnapshot();
    }, 10000); // Sync every 10 seconds

    return () => clearInterval(interval);
  }, [config.corePath]);

  const { theme } = useStore();
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const initializeApp = async () => {
    await checkEnvironment();
    await loadConfig();
    await detectPaths(); // 只偵測但不修補，待用戶選擇模式後再決定
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
            let detected: any = { coreSkills: [], existingConfig: null };
            try {
                detected = JSON.parse(res.stdout);
            } catch (e) {
                console.warn("Detected paths but result was not valid JSON", res.stdout);
            }
            
            // [NEW] 僅緩存偵測結果，不直接修改 config
            if (detected && detected.existingConfig) {
                setDetectedConfig({
                    ...detected.existingConfig,
                    corePath: detected.existingConfig.corePath || '',
                    configPath: detected.existingConfig.configPath || '',
                    workspacePath: detected.existingConfig.workspacePath || detected.existingConfig.configPath || ''
                });
            }

            if (detected.coreSkills) setCoreSkills(detected.coreSkills);
            if (detected.existingConfig?.workspaceSkills) setWorkspaceSkills(detected.existingConfig.workspaceSkills);
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
          let savedConfig = {};
          try {
            savedConfig = JSON.parse(res.stdout);
          } catch(e) {
            console.error("Config JSON parse failed", res.stdout);
          }
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

  const syncSnapshot = async () => {
    if (window.electronAPI && config.corePath) {
      try {
        // Try reading from corePath/runtime/last-snapshot.json
        const snapshotPath = `${config.corePath}/runtime/last-snapshot.json`;
        const res = await window.electronAPI.exec(`cat "${snapshotPath}"`);
        if (res.code === 0 && res.stdout) {
          try {
            const snapshot = JSON.parse(res.stdout);
            const { setSnapshot } = useStore.getState();
            setSnapshot(snapshot);
          } catch (e) {
            console.warn("Snapshot corrupted or empty", e);
          }
        }
      } catch (e) {
        // Silent fail if not exists yet
      }
    }
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
      addLog(t('logs.stoppingGateway'), 'system');
      try {
        const cmd = config.corePath 
             ? `cd ${config.corePath} && pnpm openclaw gateway stop` 
             : 'pnpm openclaw gateway stop';
        const resRaw: any = await execInTerminal(cmd, { title: 'Stopping OpenClaw Gateway', holdOpen: false });
        
        const code = resRaw.code ?? resRaw.exitCode;
        if (code === 0) {
            setRunning(false);
            addLog(t('logs.gatewayStopped'), 'system');
        }
      } catch (e: any) {
        addLog(t('logs.stopGatewayFailed', { msg: e.message }), 'stderr');
      }
    } else {
      addLog(t('logs.startingGateway'), 'system');
      try {
        const cmd = config.corePath 
            ? `cd ${config.corePath} && pnpm openclaw gateway start` 
            : 'pnpm openclaw gateway start';
        
        const resRaw: any = await execInTerminal(cmd, { 
            title: 'Starting OpenClaw Gateway', 
            holdOpen: true,
            cwd: config.corePath
        });

        const code = resRaw.code ?? resRaw.exitCode;
        if (code === 0) {
          setRunning(true);
          addLog(t('logs.gatewayStartCmdSent'), 'system');
        } else {
          addLog(t('logs.errorMsg', { msg: resRaw.stderr }), 'stderr');
        }
      } catch (e: any) {
        addLog(t('logs.startGatewayFailed', { msg: e.message }), 'stderr');
      }
    }
  };

  const handleSaveConfig = async () => {
    if (!window.electronAPI) return;
    addLog(t('logs.savingConfig'), 'system');
    try {
      const res = await window.electronAPI.exec(`config:write ${JSON.stringify(config)}`);
      if (res.code === 0) {
        addLog(t('logs.configSaved'), 'system');
      } else {
        addLog(t('logs.saveConfigFailed', { msg: res.stderr }), 'stderr');
      }
    } catch (e: any) {
      addLog(t('logs.commFailed', { msg: e.message }), 'stderr');
    }
  };

  const handleResetOnboarding = () => {
    localStorage.removeItem('onboarding_finished');
    setOnboardingFinished(false);
    setActiveTab('monitor');
    setShowLogoutConfirm(false);
  };

  if (viewMode === 'mini') {
    return <MiniView running={running} onToggle={toggleGateway} onExpand={toggleViewMode} />;
  }

  // If not finished onboarding, show the wizard
  if (!onboardingFinished) {
    return <SetupWizard onFinished={handleOnboardingComplete} />;
  }

  return (
    <div className="flex h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans overflow-hidden animate-in fade-in duration-700">
      {/* Sidebar */}
      <div className="w-64 bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col p-4 space-y-6">
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
          <NavItem icon={<Activity size={18}/>} label={t('app.tabs.monitor')} active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} />
          <NavItem icon={<BarChart3 size={18}/>} label={t('app.tabs.analytics')} active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} />
          <NavItem icon={<Boxes size={18}/>} label={t('app.tabs.skills')} active={activeTab === 'skills'} onClick={() => setActiveTab('skills')} />
          <NavItem icon={<Settings size={18}/>} label={t('app.tabs.settings')} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>

        <div onClick={toggleViewMode} className="p-4 bg-blue-600/10 rounded-2xl border border-blue-500/20 cursor-pointer hover:bg-blue-600/20 transition-all flex items-center justify-between group">
            <div className="text-[10px] text-blue-400 uppercase font-black tracking-widest">{t('app.switchMiniMode')}</div>
            <MonitorPlay size={14} className="text-blue-400 group-hover:scale-110 transition-transform" />
        </div>

        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-600 px-2 flex justify-between items-center font-mono">
          <span>{t('app.version')}</span>
          <span className="flex items-center"><div className="w-2 h-2 rounded-full bg-emerald-500 mr-1 animate-pulse"></div> {t('app.online')}</span>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#020617] relative">
        <header className="h-20 border-b border-slate-200 dark:border-slate-800/50 flex items-center px-10 justify-between relative backdrop-blur-md bg-white/20 dark:bg-slate-950/20">
          <div>
            <h2 className="font-bold text-xl text-slate-900 dark:text-slate-100 uppercase tracking-tight">
                {activeTab === 'monitor' ? t('app.headers.monitor') : activeTab === 'analytics' ? t('app.headers.analytics') : activeTab === 'skills' ? t('app.headers.skills') : t('app.headers.settings')}
            </h2>
          </div>
          <div className="flex items-center space-x-4">
            <LanguageToggle />
            <ThemeToggle />

            <div 
                onClick={() => setShowLogoutConfirm(true)}
                title={t('app.logoutTooltip')}
                className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-all group relative active:scale-95"
            >
                <LogOut size={18} className="text-slate-500 dark:text-slate-400 group-hover:text-red-500 dark:group-hover:text-red-400 transition-colors" />
            </div>
          </div>
        </header>

        {/* Custom Logout Confirmation Dialog */}
        {showLogoutConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setShowLogoutConfirm(false)}></div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 slide-in-from-bottom-8 duration-300">
              <div className="p-8 space-y-6">
                <div className="flex justify-between items-start">
                  <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500">
                    <AlertCircle size={24} />
                  </div>
                  <button onClick={() => setShowLogoutConfirm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                    <X size={20} />
                  </button>
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">
                    {t('app.logoutTooltip')}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                    {t('app.logoutConfirm')}
                  </p>
                </div>

                <div className="flex gap-4 pt-2">
                  <button 
                    onClick={() => setShowLogoutConfirm(false)}
                    className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
                  >
                    {t('wizard.backBtn').replace('← ', '')}
                  </button>
                  <button 
                    onClick={handleResetOnboarding}
                    className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/25 transition-all active:scale-95"
                  >
                    {t('monitor.disconnect')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 p-10 overflow-y-auto relative">
          {activeTab !== 'onboarding' && onboardingFinished && <UpdateBanner />}
          {activeTab === 'skills' && <SkillManager />}

          {activeTab === 'analytics' && <Analytics />}

          {activeTab === 'monitor' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="bg-slate-50 dark:bg-slate-900/30 backdrop-blur-md border border-slate-200 dark:border-slate-800 p-8 rounded-3xl flex items-center justify-between shadow-lg">
                <div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t('monitor.gatewayTitle')}</h3>
                    <p className="text-sm text-slate-500 mt-1">{t('monitor.gatewayDesc')}</p>
                </div>
                <button onClick={toggleGateway} className={`px-8 py-4 rounded-2xl font-black flex items-center transition-all ${running ? 'bg-red-500/10 dark:bg-red-500/20 text-red-500 dark:text-red-400 border border-red-500/30 dark:border-red-500/40 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 dark:border-emerald-500/40 hover:bg-emerald-500/20'}`}>
                  {running ? <Square size={18} className="mr-2 fill-current" /> : <Play size={18} className="mr-2 fill-current" />}
                  {running ? t('monitor.disconnect') : t('monitor.startService')}
                </button>
              </div>

              <ActionCenter />
              <StaffGrid />

              <div className="grid grid-cols-3 gap-8">
                <StatusCard label={t('monitor.status.node')} status={envStatus.node} />
                <StatusCard label={t('monitor.status.git')} status={envStatus.git} />
                <StatusCard label={t('monitor.status.pnpm')} status={envStatus.pnpm} />
              </div>

              <div className="bg-slate-50 dark:bg-black/90 rounded-3xl border border-slate-200 dark:border-slate-800 flex flex-col h-[400px] overflow-hidden shadow-2xl">
                 <div className="bg-slate-100 dark:bg-slate-900 px-6 py-3 border-b border-slate-200 dark:border-slate-800 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('monitor.liveStream')}</div>
                 <div className="p-6 font-mono text-[12px] space-y-1.5 overflow-y-auto flex-1 text-slate-600 dark:text-slate-300">
                    {logs.map((log, i) => <div key={i} className="flex">
                        <span className="text-slate-400 dark:text-slate-600 mr-3">[{log.time}]</span>
                        <span>{String(log.text || '')}</span>
                    </div>)}
                 </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
              <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in zoom-in-95">
                  <div className="p-8 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] space-y-6 shadow-xl shadow-slate-200/50 dark:shadow-none">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('settings.botToken')}</label>
                        <input 
                          type="password" 
                          value={config.botToken} 
                          onChange={(e) => setConfig({ botToken: e.target.value })}
                          placeholder={t('settings.botTokenPlaceholder')}
                          className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-blue-600 dark:text-blue-400 font-mono outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors" 
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('settings.inferenceEngine')}</label>
                        <select 
                          value={config.model}
                          onChange={(e) => setConfig({ model: e.target.value })}
                          className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-blue-600 dark:text-blue-400 outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
                        >
                            <option value="google-antigravity/gemini-3-flash">google-antigravity/gemini-3-flash</option>
                            <option value="ollama/llama3.2:3b">ollama/llama3.2:3b</option>
                            <option value="claude-3-5">anthropic/claude-3.5-sonnet</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('settings.corePath')}</label>
                            <input 
                                type="text" 
                                value={config.corePath} 
                                onChange={(e) => setConfig({ corePath: e.target.value })}
                                placeholder={t('settings.corePathPlaceholder')}
                                className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors" 
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('settings.configPath')}</label>
                            <input 
                                type="text" 
                                value={config.configPath} 
                                onChange={(e) => setConfig({ configPath: e.target.value })}
                                placeholder={t('settings.configPathPlaceholder')}
                                className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors" 
                            />
                        </div>
                        <div className="space-y-2 hover:col-span-2 transition-all">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('settings.workspacePath')}</label>
                            <input 
                                type="text" 
                                value={config.workspacePath} 
                                onChange={(e) => setConfig({ workspacePath: e.target.value })}
                                placeholder={t('settings.workspacePathPlaceholder')}
                                className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors" 
                            />
                        </div>
                      </div>
                  </div>
                  <button 
                    onClick={handleSaveConfig}
                    className="w-full bg-blue-600 hover:bg-blue-500 active:scale-[0.98] py-4 rounded-2xl font-black text-white shadow-xl shadow-blue-600/20 transition-all"
                  >
                    {t('settings.saveConfig')}
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
  const { t } = useTranslation();
  return (
    <div className="bg-slate-50 dark:bg-slate-900/20 backdrop-blur-sm border border-slate-200 dark:border-slate-800 p-6 rounded-3xl flex items-center justify-between group shadow-sm transition-all hover:border-slate-300 dark:hover:border-slate-700">
      <div className="flex-1">
        <div className="text-[10px] text-slate-500 dark:text-slate-600 uppercase font-black tracking-[0.2em] mb-2">{label}</div>
        <div className={`font-black tracking-tighter text-2xl ${status === 'ok' ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-600'}`}>{status === 'ok' ? t('monitor.status.verified') : t('monitor.status.analyzing')}</div>
      </div>
      {status === 'ok' ? <CheckCircle2 className="text-emerald-500 transition-transform group-hover:scale-110" /> : <Loader2 className="text-amber-500 animate-spin" />}
    </div>
  );
}

export default App;