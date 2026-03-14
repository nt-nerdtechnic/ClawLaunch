import React, { useState, useEffect } from 'react';
import { Key, ExternalLink, Bot, ArrowRight, Package, Settings, Database, Loader2, Cpu, Brain, Globe, Zap, Network, AlertCircle } from 'lucide-react';
import { useStore } from '../../store';
import { useTranslation } from 'react-i18next';
import TerminalLog from '../common/TerminalLog';

const PathItem = ({ label, path, icon, onBrowse }) => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center px-1">
                <p className="text-[10px] text-gray-500 uppercase font-black tracking-wider flex items-center gap-1.5">
                    <span className="text-blue-500 opacity-60">{icon}</span>
                    {label}
                </p>
                <div className={`w-1.5 h-1.5 rounded-full ${path && path !== t('modelSetup.paths.notSet') ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-red-500 animate-pulse'}`} />
            </div>
            <div 
                onClick={onBrowse}
                className="group flex items-center gap-3 bg-black/40 hover:bg-black/60 border border-white/5 hover:border-blue-500/30 p-2.5 rounded-xl transition-all cursor-pointer shadow-inner"
            >
                <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-slate-300 font-mono truncate px-1">
                        {path || t('modelSetup.paths.clickToSelect')}
                    </p>
                </div>
                <button 
                    className="shrink-0 px-3 py-1.5 bg-blue-600/10 hover:bg-blue-600 text-blue-400 group-hover:text-white text-[10px] font-black rounded-lg border border-blue-500/20 transition-all uppercase tracking-tighter"
                >
                    {t('modelSetup.paths.browse')}
                </button>
            </div>
        </div>
    );
};

const SetupStepModel = ({ onNext }) => {
  const { 
    config, setConfig, envStatus, setEnvStatus, 
    detectedConfig, userType, detectingPaths, 
    pathsConfirmed, setPathsConfirmed, setDetectedConfig
  } = useStore();
  const { t } = useTranslation();

  const [probingKey, setProbingKey] = useState(null);
  const [showFullSetup, setShowFullSetup] = useState(userType === 'new');
  const [connecting, setConnecting] = useState(false);
  const [localLogs, setLocalLogs] = useState([]);
  const [execError, setExecError] = useState(null);
  const logCleanupRef = React.useRef(null);

  React.useEffect(() => {
    if (window.electronAPI && connecting) {
        logCleanupRef.current = window.electronAPI.onLog((payload) => {
            setLocalLogs(prev => [...prev.slice(-49), { text: payload.data, source: payload.source, time: new Date().toLocaleTimeString() }]);
        });
    }
    return () => {
        if (typeof logCleanupRef.current === 'function') {
            logCleanupRef.current();
        }
    };
  }, [connecting]);

  const addLocalLog = (text, source = 'system') => {
    setLocalLogs(prev => [...prev.slice(-49), { text, source, time: new Date().toLocaleTimeString() }]);
  };
  
  // CLI AuthChoices Alignment
  const providerGroups = [
    {
      id: 'anthropic', label: 'Anthropic', icon: <Brain size={16} />,
      desc: 'Claude 3.7 / 3.5 Sonnet',
      choices: [
        { id: 'apiKey', name: 'Anthropic API Key', desc: '輸入您的 API 密鑰', reqKey: true, defaultModel: 'claude-3-7-sonnet-latest', link: 'https://console.anthropic.com/' },
        { id: 'token', name: 'Setup Token (CLI)', desc: '貼上由 CLI 產生的 Setup-Token', reqKey: true, defaultModel: 'claude-3-7-sonnet-latest', link: null }
      ]
    },
    {
      id: 'openai', label: 'OpenAI', icon: <Cpu size={16} />,
      desc: 'GPT-4o / Codex',
      choices: [
        { id: 'openai-api-key', name: 'OpenAI API Key', desc: '輸入您的 sk- API 密鑰', reqKey: true, defaultModel: 'gpt-4o', link: 'https://platform.openai.com/' },
        { id: 'openai-codex', name: 'OpenAI Codex (OAuth)', desc: '透過瀏覽器登入授權，無須輸入 Key', reqKey: false, defaultModel: 'gpt-4o', link: null }
      ]
    },
    {
      id: 'google', label: 'Google', icon: <Globe size={16} />,
      desc: 'Gemini 2.0 Flash / Pro',
      choices: [
        { id: 'gemini-api-key', name: 'Gemini API Key', desc: '輸入您的 AIzaSy... 密鑰', reqKey: true, defaultModel: 'gemini-2.0-flash', link: 'https://aistudio.google.com/app/apikey' },
        { id: 'google-gemini-cli', name: 'Gemini CLI (OAuth)', desc: '非官方 OAuth 流程授權', reqKey: false, defaultModel: 'gemini-2.0-flash', link: null }
      ]
    },
    {
      id: 'minimax', label: 'MiniMax', icon: <Zap size={16} />,
      desc: 'MiniMax M2.5',
      choices: [
        { id: 'minimax-api', name: 'MiniMax M2.5 (API Key)', desc: '官方 API Key 授權', reqKey: true, defaultModel: 'MiniMax-M2.5', link: 'https://platform.minimaxi.com/' },
        { id: 'minimax-portal', name: 'MiniMax OAuth', desc: '透過瀏覽器授權登入', reqKey: false, defaultModel: 'MiniMax-M2.5', link: null }
      ]
    },
    {
      id: 'local', label: 'Local / Custom', icon: <Database size={16} />,
      desc: 'Ollama, vLLM, DeepSeek Local',
      choices: [
        { id: 'ollama', name: 'Ollama', desc: '本地運行開源模型 (11434 端口)，隱私至上', reqKey: false, defaultModel: 'ollama/llama3', link: null },
        { id: 'vllm', name: 'vLLM', desc: '自定義本地伺服器 / OpenAI 相容介面', reqKey: false, defaultModel: 'vllm', link: null }
      ]
    },
    {
      id: 'other', label: 'Ecosystem', icon: <Network size={16} />,
      desc: 'Chutes, Moonshot, OpenRouter...',
      choices: [
        { id: 'chutes', name: 'Chutes (OAuth)', desc: '透過 Chutes OAuth 登入', reqKey: false, defaultModel: 'chutes', link: null },
        { id: 'moonshot-api-key', name: 'Moonshot (Kimi K2.5)', desc: '輸入 Kimi API Key', reqKey: true, defaultModel: 'kimi-k2.5', link: 'https://platform.moonshot.cn/console/api-keys' },
        { id: 'openrouter-api-key', name: 'OpenRouter', desc: '統一 API 閘道，支援多種模型', reqKey: true, defaultModel: 'openrouter/auto', link: 'https://openrouter.ai/keys' },
        { id: 'xai-api-key', name: 'xAI (Grok)', desc: '輸入 Grok API Key', reqKey: true, defaultModel: 'grok-4', link: 'https://console.x.ai/' },
      ]
    }
  ];

  const determineInitialProvider = () => {
    if (config.authChoice) {
      const foundGroup = providerGroups.find(g => g.choices.some(c => c.id === config.authChoice));
      if (foundGroup) return foundGroup.id;
    }
    return 'anthropic';
  };

  const determineInitialChoice = () => {
    if (config.authChoice) return config.authChoice;
    return 'apiKey';
  };

  const [selectedProviderId, setSelectedProviderId] = useState(determineInitialProvider());
  const [selectedChoiceId, setSelectedChoiceId] = useState(determineInitialChoice());

  const currentProviderGroup = providerGroups.find(g => g.id === selectedProviderId) || providerGroups[0];
  const currentChoice = currentProviderGroup.choices.find(c => c.id === selectedChoiceId) || currentProviderGroup.choices[0];

  const handleProviderSelect = (pid) => {
    setSelectedProviderId(pid);
    const group = providerGroups.find(g => g.id === pid);
    if (group) {
        setSelectedChoiceId(group.choices[0].id);
        setConfig({ authChoice: group.choices[0].id, model: group.choices[0].defaultModel, apiKey: '' });
    }
  };

  const handleChoiceSelect = (cid, cmodel) => {
      setSelectedChoiceId(cid);
      setConfig({ authChoice: cid, model: cmodel });
  };

  const handleBrowse = async (key) => {
    if (window.electronAPI && window.electronAPI.selectDirectory) {
      const selectedPath = await window.electronAPI.selectDirectory();
      if (selectedPath) {
        setConfig({ [key]: selectedPath });
        setProbingKey(key);
        
        try {
            const res = await window.electronAPI.exec(`config:probe ${selectedPath}`);
            if (res.code === 0 && res.stdout) {
                const probed = JSON.parse(res.stdout);
                if (probed.apiKey || probed.model) {
                    setConfig({
                        apiKey: probed.apiKey || config.apiKey,
                        model: probed.model || config.model,
                        configPath: probed.configPath || config.configPath,
                        authChoice: probed.authChoice || config.authChoice
                    });
                    
                    setDetectedConfig({ 
                        apiKey: probed.apiKey, 
                        model: probed.model,
                        authChoice: probed.authChoice,
                        botToken: probed.botToken,
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
        authChoice: detectedConfig.authChoice || config.authChoice,
        corePath: detectedConfig.corePath || config.corePath,
        configPath: detectedConfig.configPath || config.configPath,
        workspacePath: detectedConfig.workspacePath || config.workspacePath
      };
      setConfig(newConfig);
      
      if (userType === 'existing' && ((newConfig.apiKey && newConfig.apiKey.length > 5) || newConfig.model || newConfig.authChoice)) {
          localStorage.setItem('onboarding_finished', 'true');
          onNext();
      } else if ((newConfig.apiKey && newConfig.apiKey.length > 0) || newConfig.model || newConfig.authChoice) {
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

    if (userType === 'new' && config.corePath && config.configPath && !pathsConfirmed) {
        setPathsConfirmed(true);
    }
  }, []);

  const handleNext = async () => {
    if (currentChoice && (!currentChoice.reqKey || config.apiKey)) {
      if (!config.corePath) {
        setExecError('缺少核心路徑 (Core Path missing)。請先在上方設定 Core Path 後再繼續授權。');
        return;
      }

      setConnecting(true);
      setExecError(null);
      setLocalLogs([]);

      addLocalLog("🚀 正在啟動 OpenClaw 核心授權程序 (Adapter Mode)...", "system");

      try {
          const corePath = config.corePath;
          const execCmd = corePath && corePath.includes('npm') ? 'npm run' : 'pnpm';
          
          // 核心對齊：Provider-specific flags
          const authFlagMapping = {
              'apiKey': '--anthropic-api-key',
              'openai-api-key': '--openai-api-key',
              'gemini-api-key': '--gemini-api-key',
              'minimax-api': '--minimax-api-key',
              'moonshot-api-key': '--moonshot-api-key',
              'openrouter-api-key': '--openrouter-api-key',
              'xai-api-key': '--xai-api-key',
              'mistral-api-key': '--mistral-api-key',
              'ollama': '' // Ollama usually doesn't need a key here if already running
          };

          const flag = authFlagMapping[config.authChoice] || '--apiKey';
          const authFlags = config.apiKey ? `${flag} "${config.apiKey}"` : '';
          
          const stateDirEnv = config.workspacePath ? `OPENCLAW_STATE_DIR="${config.workspacePath}" ` : '';
          const configPathEnv = config.configPath ? `OPENCLAW_CONFIG_PATH="${config.configPath}/config.json" ` : '';
          const envPrefix = `${stateDirEnv}${configPathEnv}`;
          const workspaceFlag = config.workspacePath ? `--workspace "${config.workspacePath}" ` : '';
          
          const onboardCmd = `cd "${corePath}" && ${envPrefix}${execCmd} openclaw onboard --auth-choice ${config.authChoice} ${authFlags} ${workspaceFlag}--install-daemon --non-interactive --accept-risk`;
          
          addLocalLog(`> 指令: openclaw onboard --auth-choice ${config.authChoice} ...`, 'system');
          
          const res = await window.electronAPI.exec(onboardCmd);
          
          if (res.exitCode === 0 || res.code === 0) {
              addLocalLog("✅ 核心授權成功！正在同步配置至工作區...", "system");
              await new Promise(r => setTimeout(r, 1000));
              onNext();
          } else {
              const errorMsg = res.stderr || "授權失敗，請檢查 Key 是否正確或網路連接。";
              setExecError(errorMsg);
              addLocalLog(`❌ 授權回報異常: ${errorMsg}`, "stderr");
              setConnecting(false);
          }
      } catch (err) {
          setExecError(err.message);
          addLocalLog(`❌ 系統執行錯誤: ${err.message}`, "stderr");
          setConnecting(false);
      }
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-left">
      {/* 步驟頭部 */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-50 rounded-full text-blue-600 mb-4">
          <Bot size={24} />
        </div>
        <h2 className="text-2xl font-bold text-gray-800">
            {(detectedConfig || config.model) ? t('modelSetup.title.reconnect') : t('modelSetup.title.new')}
        </h2>
        <p className="text-gray-500 mt-2 italic text-sm">
            {(detectedConfig || config.model) 
              ? (connecting ? "「神經連結建立中，請保持頻率一致...」" : t('modelSetup.subtitle.reconnectDesc'))
              : (!pathsConfirmed ? t('modelSetup.subtitle.needAlign') : (connecting ? "「正在將靈魂注入機甲核心...」" : t('modelSetup.subtitle.aligned')))}
        </p>
      </div>

      <div className="space-y-6">
        {/* 第一階段：環境與偵測 (偵測優先) */}
        {!pathsConfirmed && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* ...環境區同前... */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${envStatus.node !== 'loading' && envStatus.git !== 'loading' ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
                <span className="text-sm font-medium text-gray-700 font-black">{t('modelSetup.env.title')}</span>
              </div>
              <div className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span className="text-[10px] text-gray-400 uppercase tracking-tighter">Node.js</span>
                  <span className={`text-[11px] font-bold ${envStatus.node === 'loading' ? 'text-gray-400' : envStatus.node === 'error' ? 'text-red-500' : 'text-blue-600'}`}>
                    {envStatus.node === 'loading' ? t('modelSetup.env.loading') : envStatus.node === 'error' ? t('modelSetup.env.notInstalled') : t('modelSetup.env.ready')}
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] text-gray-400 uppercase tracking-tighter">Git</span>
                  <span className={`text-[11px] font-bold ${envStatus.git === 'loading' ? 'text-gray-400' : envStatus.git === 'error' ? 'text-red-500' : 'text-blue-600'}`}>
                    {envStatus.git === 'loading' ? t('modelSetup.env.loading') : envStatus.git === 'error' ? t('modelSetup.env.notInstalled') : t('modelSetup.env.ready')}
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
                        {t('modelSetup.paths.title')}
                    </h4>
                    {(detectingPaths || probingKey) && <Loader2 size={14} className="text-blue-400 animate-spin" />}
                </div>

                <div className="grid grid-cols-1 gap-4 relative z-10">
                    <div className="relative group">
                        <PathItem 
                            label={t('modelSetup.paths.core')} 
                            path={config.corePath || t('modelSetup.paths.notSet')} 
                            icon={<Package size={14}/>} 
                            onBrowse={() => handleBrowse('corePath')}
                        />
                    </div>
                    <div className="relative group">
                        <PathItem 
                            label={t('modelSetup.paths.config')} 
                            path={config.configPath || t('modelSetup.paths.notSet')} 
                            icon={<Settings size={14}/>} 
                            onBrowse={() => handleBrowse('configPath')}
                        />
                    </div>
                    <div className="relative group">
                        <PathItem 
                            label={t('modelSetup.paths.workspace')} 
                            path={config.workspacePath || t('modelSetup.paths.notSet')} 
                            icon={<Database size={14}/>} 
                            onBrowse={() => handleBrowse('workspacePath')}
                        />
                    </div>
                </div>
            </div>

            {/* 自動偵測提示區 (僅在非新建專案時顯示) */}
            {detectedConfig && userType !== 'new' && (
                <div className="p-4 bg-gradient-to-r from-blue-700 to-blue-600 rounded-2xl shadow-xl shadow-blue-500/20 text-white flex items-center justify-between border border-blue-400/20 animate-in zoom-in-95">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-md">
                            <Bot size={20} className="text-white" />
                        </div>
                        <div>
                            <h4 className="text-sm font-black tracking-tight">{t('modelSetup.autoDetect.title')}</h4>
                            <p className="text-[10px] opacity-90 font-medium tracking-wide">{t('modelSetup.autoDetect.desc')}</p>
                        </div>
                    </div>
                    <button 
                        onClick={handleImport}
                        className="px-5 py-2.5 bg-white text-blue-700 text-[11px] font-black rounded-xl hover:bg-blue-50 transition-all shadow-lg active:scale-95 flex items-center gap-2 uppercase tracking-tighter"
                    >
                        {t('modelSetup.autoDetect.quickBtn')} <ArrowRight size={14} />
                    </button>
                </div>
            )}

            {!detectedConfig && (
                <button 
                  onClick={() => setPathsConfirmed(true)} 
                  disabled={!config.corePath || !config.configPath}
                  className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-gray-100 disabled:text-gray-300 text-white font-black py-4 rounded-2xl transition-all shadow-2xl flex items-center justify-center gap-2 px-8 uppercase tracking-widest text-xs"
                >
                  {t('modelSetup.paths.confirmPathBtn')} <ArrowRight size={16} />
                </button>
            )}
          </div>
        )}

        {/* 第二階段：模型與密鑰配置 (路徑完成後解鎖) */}
        {pathsConfirmed && (
          <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
             <button 
                onClick={() => setPathsConfirmed(false)}
                className={`text-[10px] font-black text-gray-400 hover:text-blue-600 flex items-center gap-1 transition-colors uppercase tracking-widest ${userType === 'new' ? 'hidden' : ''}`}
             >
                {t('modelSetup.modelSelect.backToPaths')}
             </button>

            {/* 配置摘要 (若已有資料 且 不顯示選單) */}
            {(config.authChoice || config.model) && !showFullSetup && (
                <div className="p-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl space-y-4">
                    <div className="flex justify-between items-center">
                        <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">
                            {(detectedConfig && userType !== 'new') ? t('modelSetup.modelSelect.summaryTitleDetected') : t('modelSetup.modelSelect.summaryTitleCurrent')}
                        </h4>
                        <button 
                            onClick={() => setShowFullSetup(true)}
                            className="text-[10px] font-black text-blue-600 hover:underline"
                        >
                            {t('modelSetup.modelSelect.changeModel')}
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
                            <p className="text-[9px] text-gray-400 uppercase font-black">Auth Choice</p>
                            <p className="text-xs font-bold text-slate-700 truncate">{config.authChoice || t('modelSetup.modelSelect.notSet')}</p>
                        </div>
                        <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
                            <p className="text-[9px] text-gray-400 uppercase font-black">{t('modelSetup.modelSelect.apiKey')}</p>
                            <p className="text-xs font-mono text-slate-700">
                                {config.apiKey ? `••••••••${config.apiKey.slice(-4)}` : t('modelSetup.modelSelect.envAligned')}
                            </p>
                        </div>
                    </div>

                    {connecting && (
                        <div className="space-y-2 animate-in fade-in duration-300">
                            <div className="flex items-center gap-2 text-[10px] font-black text-blue-500 uppercase tracking-widest px-1">
                                <Loader2 size={12} className="animate-spin" />
                                授權同步中 (Real-time Logs)
                            </div>
                            <TerminalLog logs={localLogs} height="h-32" />
                        </div>
                    )}

                    {!connecting && execError && (
                        <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-600 text-[11px] animate-in slide-in-from-top-1">
                            <AlertCircle size={14} className="shrink-0 mt-0.5" />
                            <p className="font-medium">{execError}</p>
                        </div>
                    )}

                    <button 
                        onClick={handleNext}
                        disabled={connecting}
                        className={`w-full ${connecting ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-500'} text-white font-black py-3.5 rounded-2xl transition-all shadow-xl shadow-blue-500/20 uppercase tracking-widest text-xs flex items-center justify-center gap-2`}
                    >
                        {connecting ? (
                            <>
                                <Loader2 size={16} className="animate-spin" /> 正在對齊頻率 (Aligning...)
                            </>
                        ) : (
                            (detectedConfig || config.model) ? '向靈魂核心授權 (Authorize Soul Core)' : t('modelSetup.modelSelect.readyInjectBtn')
                        )}
                    </button>
                </div>
            )}

            {/* 模型選擇卡片 (僅在需要修改或無資料時顯示) */}
            {(showFullSetup || (!config.authChoice && !config.model)) && (
                <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
                    
                    {/* 第 1 步：選擇供應商生態系 */}
                    <div className="space-y-3">
                        <label className="text-sm font-extrabold text-gray-700 flex items-center gap-2">
                            <span className="w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[10px]">1</span>
                            選擇靈魂生態系 (Provider)
                        </label>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {providerGroups.map(group => (
                                <button 
                                    key={group.id}
                                    onClick={() => handleProviderSelect(group.id)}
                                    className={`p-3 rounded-2xl border-2 text-left transition-all flex flex-col items-start gap-1 ${
                                        selectedProviderId === group.id ? 'border-blue-500 bg-blue-50/50 shadow-sm' : 'border-gray-100 hover:border-blue-200 bg-white'
                                    }`}
                                >
                                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center mb-1 ${selectedProviderId === group.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                                        {group.icon}
                                    </div>
                                    <h3 className={`font-black text-[12px] ${selectedProviderId === group.id ? 'text-blue-900' : 'text-gray-700'}`}>{group.label}</h3>
                                    <p className="text-[9px] text-gray-400 font-medium truncate w-full">{group.desc}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 第 2 步：選擇驗證方式 */}
                    <div className="space-y-3 bg-gray-50 p-4 rounded-3xl border border-gray-100">
                        <label className="text-sm font-extrabold text-gray-700 flex items-center gap-2 mb-2">
                            <span className="w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[10px]">2</span>
                            選擇授權模式 (Auth Choice)
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {currentProviderGroup.choices.map(choice => (
                                <div 
                                    key={choice.id}
                                    onClick={() => handleChoiceSelect(choice.id, choice.defaultModel)}
                                    className={`p-4 rounded-2xl border-2 cursor-pointer transition-all relative overflow-hidden ${
                                        selectedChoiceId === choice.id ? 'border-blue-500 bg-white shadow-md transform scale-[1.02]' : 'border-transparent bg-white shadow-sm hover:border-blue-200'
                                    }`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <h3 className="font-black text-gray-800 text-[12px]">{choice.name}</h3>
                                        {!choice.reqKey && <span className="text-[7px] bg-emerald-500 text-white px-1.5 py-0.5 rounded font-black tracking-widest">OAUTH/LOCAL</span>}
                                    </div>
                                    <p className="text-[10px] text-gray-500 leading-tight mt-2">{choice.desc}</p>
                                </div>
                            ))}
                        </div>

                        {/* 如果需要 API Key，顯示輸入框 */}
                        {currentChoice?.reqKey && (
                            <div className="space-y-3 pt-4 border-t border-gray-200/60 mt-4">
                                <div className="flex justify-between items-center px-1">
                                    <label className="text-[11px] font-black tracking-widest text-slate-500 uppercase">
                                        輸入 API 密鑰
                                    </label>
                                    {currentChoice.link && (
                                        <a 
                                            href={currentChoice.link} 
                                            target="_blank" rel="noreferrer" 
                                            className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-1 font-black uppercase tracking-tighter"
                                        >
                                            {t('modelSetup.modelSelect.getKey')} <ExternalLink size={10} />
                                        </a>
                                    )}
                                </div>
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 group-focus-within:text-blue-500 transition-colors">
                                        <Key size={16} />
                                    </div>
                                    <input 
                                        type="password" 
                                        placeholder={t('modelSetup.modelSelect.keyPlaceholder')} 
                                        value={config.apiKey} 
                                        onChange={(e) => setConfig({ apiKey: e.target.value })} 
                                        className="w-full pl-11 pr-4 py-4 bg-white border border-gray-200 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 outline-none transition-all text-sm font-mono shadow-sm" 
                                    />
                                </div>
                            </div>
                        )}
                        {!currentChoice?.reqKey && (
                            <div className="pt-4 border-t border-gray-200/60 mt-4 px-1">
                                <p className="text-[11px] font-black text-emerald-600">
                                    ✓ 此授權模式無須輸入 API 密鑰。按下授權後將會進行對應的驗證流程（如自動開啟瀏覽器或本地服務）。
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="pt-4 space-y-4">
                        {connecting && (
                            <div className="space-y-2 animate-in fade-in duration-300">
                                <div className="flex items-center gap-2 text-[10px] font-black text-blue-500 uppercase tracking-widest px-1">
                                    <Loader2 size={12} className="animate-spin" />
                                    授權同步中 (Real-time Logs)
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
                            disabled={connecting || (currentChoice?.reqKey && !config.apiKey)}
                            className={`w-full flex items-center justify-center gap-3 ${connecting ? 'bg-blue-400' : 'bg-slate-900 hover:bg-slate-800'} disabled:bg-slate-100 disabled:text-slate-300 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-xl shadow-slate-900/10 uppercase tracking-widest text-xs`}
                        >
                            {connecting ? (
                                <>
                                    <Loader2 size={18} className="animate-spin" /> 對齊靈魂頻率中...
                                </>
                            ) : (
                                <>向靈魂核心授權 (Authorize Soul Core) <ArrowRight size={18} /></>
                            )}
                        </button>
                    </div>
                </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SetupStepModel;
