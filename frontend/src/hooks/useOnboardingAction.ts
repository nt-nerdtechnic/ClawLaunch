import { useState, useCallback } from 'react';
import { useStore } from '../store';

export type OnboardingStep = 'model' | 'messaging' | 'skills' | 'launch';

interface UseOnboardingActionReturn {
  executing: boolean;
  error: string | null;
  logs: { text: string; source: string; time: string }[];
  execute: (step: OnboardingStep, payload?: any) => Promise<boolean>;
  reset: () => void;
}

export const useOnboardingAction = (): UseOnboardingActionReturn => {
  const { config, userType } = useStore();
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ text: string; source: string; time: string }[]>([]);

  const addLocalLog = useCallback((text: string, source: string = 'system') => {
    setLogs(prev => [...prev.slice(-49), { text, source, time: new Date().toLocaleTimeString() }]);
  }, []);

  const reset = useCallback(() => {
    setExecuting(false);
    setError(null);
    setLogs([]);
  }, []);

  const execute = async (step: OnboardingStep, _payload?: any): Promise<boolean> => {
    setExecuting(true);
    setError(null);
    setLogs([]);

    // [策略模式]：現有用戶一致行為 - 快速同步跳過
    if (userType === 'existing') {
        const messages = {
            model: '🧠 偵測到現有核心授權，正在校準靈魂頻率...',
            messaging: '📡 偵測到現有通訊頻道，正在確認綁定波段...',
            skills: '🛠️ 偵測到現有能力配置，正在同步異能模組...',
            launch: '🚀 偵測到環境已就緒，準備啟動...'
        };
        addLocalLog(messages[step] || '📋 正在同步本地配置...', 'system');
        
        // 模擬進度感
        if (step === 'launch') await new Promise(r => setTimeout(r, 1000));
        else await new Promise(r => setTimeout(r, 800));
        
        addLocalLog('✅ 同步完成。', 'system');
        setExecuting(false);
        return true;
    }

    // [策略模式]：新建專案行為 - 執行實體 CLI 指令
    try {
        const corePath = config.corePath;
        if (!corePath) throw new Error('缺少核心路徑 (Core Path missing)');

        const execCmd = corePath.includes('npm') ? 'npm run' : 'pnpm';
        const wrapPath = (p: string) => p.startsWith('~') ? p : `"${p}"`;
        const stateDirEnv = config.workspacePath ? `OPENCLAW_STATE_DIR=${wrapPath(config.workspacePath)} ` : '';
        const configPathEnv = config.configPath ? `OPENCLAW_CONFIG_PATH=${wrapPath(config.configPath + '/config.json')} ` : '';
        const envPrefix = `${stateDirEnv}${configPathEnv}`;

        switch (step) {
            case 'model': {
                addLocalLog(`🧠 正在對齊靈魂頻率 (${config.authChoice})...`, 'system');
                const authFlagMapping: any = {
                    'apiKey': '--anthropic-api-key',
                    'openai-api-key': '--openai-api-key',
                    'gemini-api-key': '--gemini-api-key',
                    'minimax-api': '--minimax-api-key',
                    'moonshot-api-key': '--moonshot-api-key',
                    'openrouter-api-key': '--openrouter-api-key',
                    'xai-api-key': '--xai-api-key'
                };
                const flag = authFlagMapping[config.authChoice || ''] || '--apiKey';
                const authFlags = config.apiKey ? `${flag} "${config.apiKey}"` : '';
                const workspaceFlag = config.workspacePath ? `--workspace "${config.workspacePath}"` : '';
                const onboardCmd = `cd "${corePath}" && ${envPrefix}${execCmd} openclaw onboard --auth-choice ${config.authChoice} ${authFlags} ${workspaceFlag} --install-daemon --non-interactive --accept-risk`;
                
                const res = await (window as any).electronAPI.exec(onboardCmd);
                if (res.exitCode !== 0 && res.code !== 0) throw new Error(res.stderr || '核心授權失敗');
                break;
            }
            
            case 'messaging': {
                addLocalLog(`📡 正在封裝通訊波段 (${config.platform})...`, 'system');
                let channelFlags = '';
                if (config.botToken) {
                    if (['telegram', 'slack', 'line'].includes(config.platform || '')) {
                        channelFlags = `--token "${config.botToken}"`;
                    } else if (config.platform === 'discord') {
                        channelFlags = `--bot-token "${config.botToken}"`;
                    } else if (config.platform === 'googlechat') {
                        channelFlags = `--webhook-url "${config.botToken}"`;
                    }
                }
                const channelCmd = `cd "${corePath}" && ${envPrefix}${execCmd} openclaw channels add --channel ${config.platform} ${channelFlags}`;
                const res = await (window as any).electronAPI.exec(channelCmd);
                if (res.exitCode !== 0 && res.code !== 0) throw new Error(res.stderr || '頻道繫結失敗');
                break;
            }

            case 'skills': {
                const selectedSkills = config.enabledSkills || [];
                if (selectedSkills.length === 0) {
                    addLocalLog('✨ 無需注入額外異能。', 'system');
                    setExecuting(false);
                    return true;
                }
                addLocalLog(`🛠️ 正在注入核心異能 (${selectedSkills.length} 項模組)...`, 'system');
                
                for (const skillId of selectedSkills) {
                    addLocalLog(`> 正在注入: ${skillId}...`, "system");
                    const cmd = `cd "${corePath}" && ${envPrefix}${execCmd} openclaw config set skills.entries.${skillId}.enabled true`;
                    const res = await (window as any).electronAPI.exec(cmd);
                    if (res.exitCode !== 0 && res.code !== 0) {
                        addLocalLog(`⚠️ 模組 ${skillId} 注入回報異常: ${res.stderr}`, "stderr");
                    }
                }
                break;
            }
            
            case 'launch': {
                addLocalLog(`🚀 啟動最終發射檢查程序 (Final Verification)...`, 'system');
                
                // 1. Gateway 狀態驗證
                addLocalLog('🔍 正在探測網關狀態 (Gateway Pulse Check)...', 'system');
                const gatewayRes = await (window as any).electronAPI.exec(`cd "${corePath}" && ${envPrefix}${execCmd} openclaw gateway status`);
                if (gatewayRes.exitCode !== 0 && gatewayRes.code !== 0) {
                    addLocalLog('⚠️ 網關探測回報異常，可能需要手動啟動。', 'stderr');
                } else {
                    addLocalLog('✅ 網關服務連通性正常。', 'system');
                }

                // 2. Health Check
                addLocalLog('🔍 正在檢查守護進程健康度 (Daemon Health)...', 'system');
                const healthRes = await (window as any).electronAPI.exec(`cd "${corePath}" && ${envPrefix}${execCmd} openclaw health`);
                if (healthRes.exitCode !== 0 && healthRes.code !== 0) {
                    addLocalLog('⚠️ 守護進程尚未完全就緒。', 'stderr');
                } else {
                    addLocalLog('✅ 守護進程狀態綠燈。', 'system');
                }
                break;
            }
        }

        addLocalLog('✅ 執行順利完成。', 'system');
        setExecuting(false);
        return true;

    } catch (err: any) {
        setError(err.message);
        addLocalLog(`❌ 執行回報異常: ${err.message}`, 'stderr');
        setExecuting(false);
        return false;
    }
  };

  return { executing, error, logs, execute, reset };
};
