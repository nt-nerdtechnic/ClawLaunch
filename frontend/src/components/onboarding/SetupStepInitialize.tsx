// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { Package, Settings, Database, ArrowRight, Loader2, CheckCircle2, AlertCircle, Monitor, FolderOpen } from 'lucide-react';
import { useStore } from '../../store';
import { useTranslation } from 'react-i18next';
import TerminalLog from '../common/TerminalLog';

const PathItem = ({ label, path, icon, description, onBrowse, onChange, error, warning }) => {
    const { t } = useTranslation();
    const isError = !!error;
    const isWarning = !!warning && !isError;

    const borderClass = isError
        ? 'border-red-300'
        : isWarning
        ? 'border-amber-300'
        : 'border-gray-200 focus-within:border-blue-400';

    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center px-1">
                <div className="flex flex-col">
                    <p className="text-[10px] text-gray-400 uppercase font-black tracking-wider flex items-center gap-1.5">
                        <span className="text-blue-500 opacity-60">{icon}</span>
                        {label}
                    </p>
                    <p className="text-[9px] text-gray-400 font-medium italic">{description}</p>
                </div>
                <div className={`w-1.5 h-1.5 rounded-full ${path && !isError ? (isWarning ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]') : isError ? 'bg-red-500' : 'bg-gray-200'}`} />
            </div>
            <div className={`flex items-stretch gap-2 bg-slate-50 border rounded-2xl px-3 py-1.5 transition-colors ${isError ? 'bg-red-50 border-red-200' : isWarning ? 'bg-amber-50/30 border-amber-200' : 'border-gray-100 focus-within:border-blue-400'}`}>
                <input
                    type="text"
                    value={path || ''}
                    onChange={(e) => onChange?.(e.target.value)}
                    placeholder={t('setupInitialize.selectBtn')}
                    className={`flex-1 bg-transparent text-[12px] font-mono outline-none ${path ? 'text-slate-700' : 'text-slate-400'}`}
                />
                <button
                    onClick={onBrowse}
                    title={t('modelSetup.paths.browse')}
                    className="shrink-0 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors flex items-center justify-center"
                >
                    <FolderOpen size={14} className="text-blue-500" />
                </button>
            </div>
            {isError && <p className="text-[10px] text-red-500 font-bold px-1 flex items-center gap-1"><AlertCircle size={10} /> {error}</p>}
            {isWarning && <p className="text-[10px] text-amber-600 font-bold px-1 flex items-center gap-1"><AlertCircle size={10} /> {warning}</p>}
        </div>
    );
};

const SetupStepInitialize = ({ onNext }) => {
    const { config, setConfig, addLog, logs } = useStore();
    const { t } = useTranslation();
    const logEndRef = React.useRef(null);
    const [initializing, setInitializing] = useState(false);
    const [initialized, setInitialized] = useState(false);
    const [progress, setProgress] = useState('');
    const [errors, setErrors] = useState({ corePath: '', configPath: '', workspacePath: '' });
    const [warnings, setWarnings] = useState({ corePath: '', configPath: '', workspacePath: '' });
    const [checking, setChecking] = useState(false);
    const [versions, setVersions] = useState<string[]>(['main']);
    const [selectedVersion, setSelectedVersion] = useState('main');
    const [downloadMethod] = useState('zip');
    const [createdItems, setCreatedItems] = useState<string[]>([]);
    const [existingItems, setExistingItems] = useState<string[]>([]);
    const [hasInitializeAttempt, setHasInitializeAttempt] = useState(false);

    const pushProgress = (message: string) => {
        setProgress(message);
        addLog(message, 'system');
    };

    useEffect(() => {
        const fetchVersions = async () => {
            const res = await window.electronAPI.exec('project:get-versions');
            if (res.code === 0) {
                try {
                    const tagList = JSON.parse(res.stdout);
                    if (Array.isArray(tagList) && tagList.every((item) => typeof item === 'string')) {
                        setVersions(tagList);
                    }
                } catch(e) {}
            }
        };
        fetchVersions();
    }, []);

    // 新建專案時，對已填入的路徑自動驗證，立即顯示「目錄已有資料」警告
    useEffect(() => {
        const autoValidatePrefilled = async () => {
            const keysToCheck: Array<'corePath' | 'configPath' | 'workspacePath'> = ['corePath', 'configPath', 'workspacePath'];
            for (const key of keysToCheck) {
                const val = config[key];
                if (val && typeof val === 'string' && val.trim()) {
                    await validatePath(key, val.trim());
                }
            }
        };
        autoValidatePrefilled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleBrowse = async (key) => {
        if (window.electronAPI && window.electronAPI.selectDirectory) {
            const selectedPath = await window.electronAPI.selectDirectory();
            if (selectedPath) {
                setConfig({ [key]: selectedPath });
                validatePath(key, selectedPath);
            }
        }
    };

    const validatePath = async (key, path) => {
        setChecking(true);
        try {
            const res = await window.electronAPI.exec(`project:check-empty ${path}`);
            if (res.code === 0) {
                const data = JSON.parse(res.stdout);
                if (!data.isEmpty && !data.notExist) {
                    let warnMsg = '';
                    if (key === 'configPath') {
                        // 特別提示：此目錄已有 OpenClaw 設定與授權資料，新建專案建議改用全新路徑
                        warnMsg = '⚠️ 此目錄已有 OpenClaw 設定（含授權資料）。新建專案建議改用全新目錄，避免繼承舊授權。';
                    } else {
                        let subDir = '';
                        if (key === 'corePath') subDir = 'openclaw';
                        if (key === 'workspacePath') subDir = 'openclaw-workspace';
                        warnMsg = t('setupInitialize.pathWarning', { name: subDir });
                    }
                    setWarnings(prev => ({ ...prev, [key]: warnMsg }));
                    setErrors(prev => ({ ...prev, [key]: '' }));
                } else {
                    setErrors(prev => ({ ...prev, [key]: '' }));
                    setWarnings(prev => ({ ...prev, [key]: '' }));
                }
            }
        } catch (e) {
            console.error("Validation failed", e);
        } finally {
            setChecking(false);
        }
    };

    const handleCancel = async () => {
        try {
            await window.electronAPI.exec('process:kill-all');
            addLog(t('setupInitialize.cancelSuccess'), 'system');
            setInitializing(false);
            setProgress('');
        } catch (e) {
            addLog(`Cancel failed: ${e.message}`, 'stderr');
        }
    };

    const handleInitialize = async () => {
        if (!config.corePath || !config.configPath || !config.workspacePath) return;
        if (Object.values(errors).some(e => e)) return;

        setHasInitializeAttempt(true);
        setInitializing(true);
        setCreatedItems([]);
        setExistingItems([]);
        pushProgress(t('setupInitialize.checkPaths'));

        try {
            const payload = {
                corePath: config.corePath,
                configPath: config.configPath,
                workspacePath: config.workspacePath,
                version: selectedVersion,
                method: downloadMethod
            };

            const res = await window.electronAPI.exec(`project:initialize ${JSON.stringify(payload)}`);
            if (res.code === 0) {
                // 如果後端有回傳實際路徑（例如建立了子目錄），同步更新到 store
                try {
                   const result = JSON.parse(res.stdout);
                   const updates = {};
                   if (result.corePath) updates.corePath = result.corePath;
                   if (result.configPath) updates.configPath = result.configPath;
                   if (result.workspacePath) updates.workspacePath = result.workspacePath;
                   const nextConfig = { ...config, ...updates };
                   
                   if (Object.keys(updates).length > 0) {
                       setConfig(updates);
                   }

                   // Persist the resolved runtime paths immediately to avoid stale launcher config overriding user choice.
                   if (window.electronAPI) {
                       await window.electronAPI.exec(`config:write ${JSON.stringify(nextConfig)}`);
                   }

                   if (Array.isArray(result.createdItems)) {
                       setCreatedItems(result.createdItems);
                   }
                   if (Array.isArray(result.existingItems)) {
                       setExistingItems(result.existingItems);
                   }
                } catch(e) {}
                
                pushProgress('🎉 ' + t('setupInitialize.success'));
                setInitializing(false); 
                setInitialized(true);
            } else {
                addLog(res.stderr, 'stderr');
                pushProgress(t('setupInitialize.error', { msg: res.stderr }));
                setInitializing(false);
            }
        } catch (e) {
            addLog(e.message, 'stderr');
            pushProgress(t('setupInitialize.error', { msg: e.message }));
            setInitializing(false);
        }
    };
    
    // 自動捲動日誌
    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    const isReady = config.corePath && config.configPath && config.workspacePath && !Object.values(errors).some(e => e) && !checking;

    return (
        <div className="w-full max-w-2xl mx-auto bg-white rounded-[32px] shadow-2xl shadow-gray-100 border border-gray-100 p-10 animate-in fade-in zoom-in-95 duration-500">
            <div className="mb-10 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 bg-indigo-50 rounded-2xl text-indigo-600 mb-6 rotate-3">
                    <Package size={28} />
                </div>
                <h2 className="text-3xl font-black text-gray-900 tracking-tight">{t('setupInitialize.title')}</h2>
                <p className="text-gray-500 mt-3 text-lg font-medium">{t('setupInitialize.subtitle')}</p>
            </div>

            <div className="space-y-6">
                {/* 版本選擇器 */}
                <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center px-1">
                        <p className="text-[10px] text-gray-400 uppercase font-black tracking-wider flex items-center gap-1.5">
                            <span className="text-blue-500 opacity-60"><Package size={14} /></span>
                            {t('setupInitialize.selectVersion')}
                        </p>
                        <span className="text-[9px] text-indigo-500 font-bold bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100/50">GITHUB CLAW</span>
                    </div>
                    <div className="relative group">
                        <select 
                            value={selectedVersion}
                            onChange={(e) => setSelectedVersion(e.target.value)}
                            className="w-full bg-slate-50 hover:bg-white border border-gray-100 hover:border-blue-500/30 transition-all appearance-none rounded-2xl p-3 text-[12px] font-mono text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/10"
                        >
                            {versions.map(v => (
                                <option key={v} value={v}>{v === 'main' ? `${v} (Latest)` : v}</option>
                            ))}
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover:text-blue-500 transition-colors">
                            <Settings size={14} />
                        </div>
                    </div>
                </div>

                {/* 下載模式說明 (僅保留 ZIP) */}
                <div className="flex flex-col gap-2">
                    <p className="text-[10px] text-gray-400 uppercase font-black tracking-wider flex items-center gap-1.5 px-1">
                        <span className="text-blue-500 opacity-60"><Monitor size={14} /></span>
                        {t('setupInitialize.downloadMethod')}
                    </p>
                    <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100/50 flex items-center gap-3">
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-indigo-600 shadow-sm border border-indigo-50">
                            <Database size={20} />
                        </div>
                        <div className="flex-1">
                            <h4 className="text-[11px] font-black text-indigo-900 uppercase tracking-tight">ZIP 極速下載模式</h4>
                            <p className="text-[9px] text-indigo-500 font-medium italic">
                                💡 已為您選擇最穩定的傳輸方案，避開 Git 卡頓，確保部署成功。
                            </p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6">
                    <PathItem 
                        label={t('setupInitialize.corePath')}
                        description={t('setupInitialize.coreDesc')}
                        path={config.corePath}
                        icon={<Package size={14} />}
                        onBrowse={() => handleBrowse('corePath')}
                        onChange={(val) => setConfig({ corePath: val })}
                        error={errors.corePath}
                        warning={warnings.corePath}
                    />
                    <PathItem 
                        label={t('setupInitialize.configPath')}
                        description={t('setupInitialize.configDesc')}
                        path={config.configPath}
                        icon={<Settings size={14} />}
                        onBrowse={() => handleBrowse('configPath')}
                        onChange={(val) => setConfig({ configPath: val })}
                        error={errors.configPath}
                        warning={warnings.configPath}
                    />
                    <PathItem 
                        label={t('setupInitialize.workspacePath')}
                        description={t('setupInitialize.workspaceDesc')}
                        path={config.workspacePath}
                        icon={<Database size={14} />}
                        onBrowse={() => handleBrowse('workspacePath')}
                        onChange={(val) => setConfig({ workspacePath: val })}
                        error={errors.workspacePath}
                        warning={warnings.workspacePath}
                    />
                </div>

                <div className="pt-6 space-y-4">
                    {initialized && (
                        <div className="w-full bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                            <p className="text-[11px] font-black text-emerald-800 uppercase tracking-wider mb-3">
                                Initialization Summary
                            </p>
                            <div className="space-y-3">
                                {createdItems.length > 0 ? (
                                    <div className="max-h-40 overflow-auto space-y-1">
                                        {createdItems.map((item) => (
                                            <p key={item} className="text-[11px] font-mono text-emerald-900 break-all">
                                                {item}
                                            </p>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-[11px] text-emerald-800 font-semibold">
                                        Success. No new files were created in this run; existing paths were reused.
                                    </p>
                                )}

                                <div className="space-y-1 pt-2 border-t border-emerald-200/70">
                                    <p className="text-[10px] font-black text-emerald-800 uppercase tracking-wider">Resolved Paths</p>
                                    <p className="text-[11px] font-mono text-emerald-900 break-all">core: {config.corePath || '-'}</p>
                                    <p className="text-[11px] font-mono text-emerald-900 break-all">config: {config.configPath || '-'}</p>
                                    <p className="text-[11px] font-mono text-emerald-900 break-all">workspace: {config.workspacePath || '-'}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {initialized && existingItems.length > 0 && (
                        <div className="w-full bg-amber-50 border border-amber-100 rounded-2xl p-4">
                            <p className="text-[11px] font-black text-amber-800 uppercase tracking-wider mb-3">
                                Already Existed
                            </p>
                            <div className="max-h-40 overflow-auto space-y-1">
                                {existingItems.map((item) => (
                                    <p key={item} className="text-[11px] font-mono text-amber-900 break-all">
                                        {item}
                                    </p>
                                ))}
                            </div>
                        </div>
                    )}

                    {!initializing ? (
                        <button 
                            onClick={initialized ? onNext : handleInitialize}
                            disabled={!isReady && !initialized}
                            className={`w-full py-5 rounded-2xl font-black text-white shadow-xl transition-all flex items-center justify-center gap-3 uppercase tracking-widest text-sm ${
                                (isReady || initialized) 
                                    ? (initialized ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-200' : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-200') 
                                    : 'bg-gray-200 cursor-not-allowed shadow-none'
                            }`}
                        >
                            {checking ? <Loader2 className="animate-spin" size={20} /> : <ArrowRight size={20} />}
                            {initialized ? '點擊此處繼續下一步 (Next Step)' : t('setupInitialize.startBtnDownload')}
                        </button>
                    ) : (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-4">
                            <div className="w-full py-5 bg-indigo-50 rounded-2xl flex flex-col items-center justify-center gap-3 border border-indigo-100 shadow-inner">
                                <div className="flex items-center gap-3 text-indigo-600 font-black uppercase tracking-widest text-sm">
                                    {progress.includes('完成') ? <CheckCircle2 size={20} className="text-emerald-500" /> : <Loader2 className="animate-spin" size={20} />}
                                    {progress}
                                </div>
                            </div>

                            {/* 取消按鈕 */}
                            {!progress.includes('完成') && (
                                <button 
                                    onClick={handleCancel}
                                    className="w-full py-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-[11px] font-black uppercase tracking-widest border border-red-100 transition-all flex items-center justify-center gap-2"
                                >
                                    <AlertCircle size={14} />
                                    {t('setupInitialize.cancelBtn')}
                                </button>
                            )}
                        </div>
                    )}

                    {/* 實時日誌視窗（曾執行初始化後持續保留，避免視窗瞬間消失） */}
                    {(initializing || hasInitializeAttempt) && (
                        <TerminalLog 
                            logs={logs} 
                            height="h-32" 
                            title="OpenClaw Initialization" 
                        />
                    )}
                </div>
            </div>

            <div className="mt-8 text-center">
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em]">
                    OpenClaw Infrastructure Provisioning System
                </p>
            </div>
        </div>
    );
};

export default SetupStepInitialize;
