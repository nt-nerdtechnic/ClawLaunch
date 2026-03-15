import { useState, useEffect } from 'react';
import { useStore } from '../store';
import type { SkillItem } from '../store';
import { Info, Lock, ChevronDown, ChevronUp, Puzzle, ShieldCheck, RefreshCw, PackagePlus, Trash2, FolderOpen, Blocks, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ── 技能卡片元件 ──────────────────────────────────────────────────────────────
function SkillCard({
  skill,
  isCore,
  onRemove,
}: {
  skill: SkillItem;
  isCore: boolean;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const badge = isCore
    ? 'bg-violet-500/10 text-violet-500 border-violet-500/20'
    : 'bg-blue-500/10 text-blue-500 border-blue-500/20';

  return (
    <div
      className={`group flex flex-col bg-white dark:bg-slate-900/40 border rounded-3xl overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/5 
        ${isCore 
            ? 'border-slate-200 dark:border-slate-800/60' 
            : 'border-blue-100 dark:border-blue-900/30 hover:border-blue-400 dark:hover:border-blue-700'}`}
    >
      <div className="p-6 flex flex-col h-full">
        {/* 卡片頭部：標籤與動作 */}
        <div className="flex items-start justify-between mb-4">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl text-blue-500 group-hover:scale-110 transition-transform duration-300">
            {isCore ? <ShieldCheck size={24} /> : <Blocks size={24} />}
          </div>
          <div className="flex items-center gap-2">
             {!isCore && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
                className="p-2 rounded-xl text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                title={t('skillManager.actions.remove')}
              >
                <Trash2 size={16} />
              </button>
            )}
            {isCore && (
              <div className="p-2 text-slate-300 dark:text-slate-700" title={t('skillManager.status.systemRequired')}>
                <Lock size={14} />
              </div>
            )}
          </div>
        </div>

        {/* 標籤 */}
        <div className="mb-2">
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${badge}`}>
            {isCore ? 'CORE' : skill.category}
          </span>
        </div>

        {/* 標題與描述 */}
        <div className="flex-grow">
          <h4 className="font-bold text-slate-900 dark:text-white text-base mb-1 tracking-tight">
            {skill.name}
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2 min-h-[2.5rem]">
            {skill.desc}
          </p>
        </div>

        {/* 底部展開控制 */}
        <div className="mt-4 pt-4 border-t border-slate-50 dark:border-slate-800/50 flex items-center justify-between">
          <button 
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] font-bold text-slate-400 hover:text-blue-500 flex items-center gap-1 transition-colors"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {t('skillManager.actions.viewDetails')}
          </button>
          
          <div className="text-[10px] font-mono text-slate-300 dark:text-slate-600 truncate max-w-[80px]">
            {skill.id}
          </div>
        </div>

        {/* 展開詳情 */}
        {expanded && (
          <div className="mt-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-slate-50 dark:bg-black/20 rounded-2xl p-4 border border-slate-100 dark:border-slate-800/50">
              <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                <FolderOpen size={10} /> {t('skillManager.deepConfig')}
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed italic">
                {skill.details || t('skillManager.status.noDetails')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 主元件 ────────────────────────────────────────────────────────────────────
export function SkillManager() {
  const { t } = useTranslation();
  const { coreSkills, workspaceSkills, setCoreSkills, setWorkspaceSkills, config } = useStore();
  const [activeTab, setActiveTab] = useState<'core' | 'workspace'>('workspace');
  const [scanning, setScanning] = useState(false);
  const [acting, setActing] = useState(false);
  const [scanError, setScanError] = useState('');

  const rescan = async () => {
    if (!window.electronAPI) {
      setScanError('electronAPI 不可用，請確認 Electron 環境正確啟動。');
      return;
    }
    setScanError('');
    setScanning(true);
    try {
      const result = await window.electronAPI.exec('detect:paths');
      if (result?.exitCode === 0 && result.stdout) {
        try {
          const data = JSON.parse(result.stdout);
          if (data.coreSkills) setCoreSkills(data.coreSkills);
          if (data.existingConfig?.workspaceSkills !== undefined) {
            setWorkspaceSkills(data.existingConfig.workspaceSkills);
          }
        } catch (e) {
          setScanError('技能資料解析失敗，請重試。');
        }
      } else {
        setScanError(result?.stderr || '掃描失敗，請重試。');
      }
    } catch (e: any) {
      setScanError(e?.message || '掃描時發生未知錯誤。');
    }
    setScanning(false);
  };

  useEffect(() => {
    // 優先使用 App.tsx 初始化時偵測到的數據，僅在完全缺失且未在偵測中時才觸發
    if (coreSkills.length === 0 && workspaceSkills.length === 0) {
      rescan();
    }
  }, []);

  const handleImport = async () => {
    if (!window.electronAPI || acting) return;
    setActing(true);
    try {
      const result = await window.electronAPI.exec('skill:import');
      if (result?.exitCode === 0) {
        if (result.stdout !== 'Canceled') {
           await rescan();
        }
      } else {
        alert(result?.stderr || t('skillManager.status.importError', { msg: 'Unknown' }));
      }
    } catch (e) {}
    setActing(false);
  };

  const handleRemove = async (skill: SkillItem) => {
    if (!window.electronAPI || acting) return;
    
    const confirmed = confirm(t('skillManager.status.deleteConfirm', { name: skill.name }));
    if (!confirmed) return;

    setActing(true);
    try {
      const baseDir = config.workspacePath || config.configPath;
      if (!baseDir) {
        alert(t('skillManager.status.importError', { msg: 'Missing workspace/config path' }));
        setActing(false);
        return;
      }
      await window.electronAPI.exec(`skill:delete ${baseDir}/skills/${skill.id}`);
      await rescan();
    } catch (e) {}
    setActing(false);
  };

  const tabs = [
    {
      id: 'workspace' as const,
      label: t('skillManager.tabs.workspace'),
      icon: <Puzzle size={14} />,
      count: workspaceSkills.length,
    },
    {
      id: 'core' as const,
      label: t('skillManager.tabs.core'),
      icon: <ShieldCheck size={14} />,
      count: coreSkills.length,
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500 pb-20">
      <div className="flex items-center justify-between flex-wrap gap-6">
        <div>
          <h3 className="text-2xl font-black text-slate-900 dark:text-white flex items-center tracking-tight">
            <span className="w-2 h-8 bg-blue-500 rounded-full mr-4 shadow-lg shadow-blue-500/20" />
            {t('skillManager.title')}
          </h3>
          <p className="text-sm text-slate-400 mt-1 font-medium ml-6">
            {activeTab === 'core' ? t('skillManager.guide.core') : t('skillManager.guide.workspace')}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={handleImport}
            disabled={acting}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 dark:bg-blue-600 dark:border-blue-500 dark:hover:bg-blue-500 text-white rounded-2xl text-xs font-black transition-all shadow-xl shadow-slate-200 dark:shadow-blue-900/30 active:scale-95 disabled:opacity-50"
          >
            <PackagePlus size={16} />
            {t('skillManager.actions.import')}
          </button>
          
          <button
            onClick={rescan}
            disabled={scanning || acting}
            className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-40"
          >
            <RefreshCw size={18} className={scanning ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {scanError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-2xl text-xs text-red-600 dark:text-red-400 font-medium animate-in fade-in duration-200">
          <AlertCircle size={14} className="shrink-0" />
          {scanError}
        </div>
      )}

      <div className="flex gap-1 bg-slate-100/50 dark:bg-slate-900/50 p-1.5 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 max-w-sm">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-6 rounded-xl text-xs font-black transition-all duration-300
              ${activeTab === tab.id
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xl shadow-slate-200/50 dark:shadow-black/20 border border-slate-200/50 dark:border-slate-700'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
              }`}
          >
            {tab.icon}
            {tab.label}
            <span className="ml-2 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded-md text-[9px] opacity-70">
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div className="animate-in fade-in duration-500 slide-in-from-bottom-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {activeTab === 'core' ? (
            coreSkills.map(skill => (
              <SkillCard key={skill.id} skill={skill} isCore={true} />
            ))
          ) : (
            workspaceSkills.length === 0 ? (
              <div className="col-span-full flex flex-col items-center justify-center py-24 bg-slate-50/50 dark:bg-slate-900/10 rounded-[2.5rem] border-2 border-dashed border-slate-200 dark:border-slate-800/50">
                <Puzzle size={48} className="text-slate-200 dark:text-slate-800 mb-6" />
                <p className="text-sm text-slate-400 dark:text-slate-600 max-w-xs text-center leading-relaxed font-bold">
                  {t('skillManager.status.emptyWorkspace')}
                </p>
                <button
                  onClick={handleImport}
                  className="mt-8 px-8 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold text-blue-500 shadow-sm hover:shadow-md transition-all active:scale-95"
                >
                  {t('skillManager.actions.import')}
                </button>
              </div>
            ) : (
              workspaceSkills.map(skill => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  isCore={false}
                  onRemove={() => handleRemove(skill)}
                />
              ))
            )
          )}
        </div>
      </div>

      <div className="bg-gradient-to-br from-blue-600/5 to-indigo-600/5 border border-blue-500/10 p-8 rounded-[2.5rem] flex items-start gap-5">
        <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-500">
          <Info size={24} />
        </div>
        <div>
          <h5 className="text-base font-black text-blue-600 dark:text-blue-400 tracking-tight">
            {t('skillManager.securityTitle')}
          </h5>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed font-medium">
            {t('skillManager.securityDesc')}
          </p>
        </div>
      </div>
    </div>
  );
}


