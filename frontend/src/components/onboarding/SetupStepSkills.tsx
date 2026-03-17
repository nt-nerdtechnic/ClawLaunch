// @ts-nocheck
import React from 'react';
import { Package, ArrowRight, Zap, Layout, RefreshCw, PackagePlus, Trash2, AlertCircle } from 'lucide-react';
import { useStore } from '../../store';
import { useTranslation } from 'react-i18next';

/**
 * NT-ClawLaunch Onboarding: Skill Selection Step
 * Ref: Neil's Strategy - "Granting Superpowers" Alignment (2026-03-14)
 */
const SetupStepSkills = ({ onNext }) => {
  const { t } = useTranslation();
  const { config, workspaceSkills, setCoreSkills, setWorkspaceSkills, userType } = useStore();
  const [scanning, setScanning] = React.useState(false);
  const [acting, setActing] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState('');

  const coreSystems = [
    { id: 'soul-core', name: t('setupSkills.manager.coreSoul'), icon: <Zap size={14} /> },
    { id: 'cli-bridge', name: t('setupSkills.manager.coreCli'), icon: <Layout size={14} /> }
  ];

  const detectedSkills = workspaceSkills || [];

  const rescan = async () => {
    if (!window.electronAPI || scanning || acting) return;
    setErrorMsg('');
    setScanning(true);
    try {
      const result = await window.electronAPI.exec('detect:paths');
      if (result?.exitCode === 0 && result.stdout) {
        try {
          const data = JSON.parse(result.stdout);
          if (data.coreSkills) setCoreSkills(data.coreSkills);
          if (data.existingConfig?.workspaceSkills) {
            setWorkspaceSkills(data.existingConfig.workspaceSkills);
          } else {
            setWorkspaceSkills([]);
          }
        } catch (e) {
          setErrorMsg(t('setupSkills.manager.errorParse'));
        }
      } else {
        setErrorMsg(result?.stderr || t('setupSkills.manager.errorScan'));
      }
    } catch (e) {
      setErrorMsg(e?.message || t('setupSkills.manager.errorScan'));
    }
    setScanning(false);
  };

  React.useEffect(() => {
    if (detectedSkills.length === 0) {
      rescan();
    }
  }, []);

  const handleImport = async () => {
    if (!window.electronAPI || acting || scanning) return;
    setErrorMsg('');
    setActing(true);
    try {
      const result = await window.electronAPI.exec('skill:import');
      if (result?.exitCode === 0) {
        if (result.stdout !== 'Canceled') {
          await rescan();
        }
      } else {
        setErrorMsg(result?.stderr || t('setupSkills.manager.errorImport'));
      }
    } catch (e) {
      setErrorMsg(e?.message || t('setupSkills.manager.errorImport'));
    }
    setActing(false);
  };

  const handleRemove = async (skillId, skillName) => {
    if (!window.electronAPI || acting || scanning) return;
    const confirmed = confirm(t('setupSkills.manager.removeConfirm', { name: skillName }));
    if (!confirmed) return;

    setErrorMsg('');
    setActing(true);
    try {
      const baseDir = config.workspacePath || config.configPath;
      if (!baseDir) {
        setErrorMsg(t('setupSkills.manager.errorMissingBaseDir'));
        setActing(false);
        return;
      }
      const result = await window.electronAPI.exec(`skill:delete ${baseDir}/skills/${skillId}`);
      if (result?.exitCode !== 0) {
        setErrorMsg(result?.stderr || t('setupSkills.manager.errorRemove'));
      }
      await rescan();
    } catch (e) {
      setErrorMsg(e?.message || t('setupSkills.manager.errorRemove'));
    }
    setActing(false);
  };





  const handleNext = () => {
    onNext();
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
            {t('setupSkills.manager.title')}
          </h2>
        </div>
        <p className="text-gray-500 italic">
          {t('setupSkills.manager.subtitle')}
        </p>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={handleImport}
          disabled={acting || scanning}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-2xl text-xs font-black transition-all active:scale-95 disabled:opacity-50"
        >
          <PackagePlus size={14} /> {t('setupSkills.manager.import')}
        </button>
        <button
          onClick={rescan}
          disabled={scanning || acting}
          className="p-2.5 rounded-2xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all disabled:opacity-40"
          title={t('setupSkills.manager.rescanTitle')}
        >
          <RefreshCw size={16} className={scanning ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 核心穩定性面板 (不可改) */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 mb-8 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 p-4 opacity-10 rotate-12 pointer-events-none">
            <Zap size={80} className="text-blue-500" />
        </div>
        <div className="flex items-center gap-2 text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] mb-4 relative z-10">
          {t('setupSkills.manager.corePanelTitle')}
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
      {detectedSkills.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 mb-8">
          {detectedSkills.map((skill) => {
            return (
              <div
                key={skill.id}
                className="p-5 rounded-[2rem] border-2 border-gray-100 hover:border-blue-200 bg-white transition-all relative group h-full flex flex-col"
              >
                <button
                  onClick={() => handleRemove(skill.id, String(skill.name || skill.id))}
                  disabled={acting || scanning}
                  className="absolute top-4 right-4 p-2 rounded-xl text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-40"
                  title={t('setupSkills.manager.removeTitle')}
                >
                  <Trash2 size={14} />
                </button>

                <div className="w-12 h-12 rounded-2xl mb-4 flex items-center justify-center transition-transform group-hover:scale-110 bg-slate-50 text-slate-400">
                  <Package size={20} />
                </div>
                <h3 className="font-black text-gray-800 text-sm mb-1">{String(skill.name || skill.id)}</h3>
                <p className="text-[11px] text-gray-400 leading-relaxed font-medium flex-grow">
                  {String(skill.desc || t('setupSkills.manager.fallbackDesc'))}
                </p>

                <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">
                    {String(skill.category || t('setupSkills.manager.defaultCategory'))}
                  </span>
                  <span className="text-[9px] font-black text-emerald-600 uppercase">{t('setupSkills.manager.installed')}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mb-8 rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-8 text-center">
          <p className="text-sm font-semibold text-slate-600">{t('setupSkills.manager.emptyTitle')}</p>
          <p className="mt-2 text-xs text-slate-400">
            {t('setupSkills.manager.emptyDesc')}
          </p>
          <button
            onClick={handleImport}
            disabled={acting || scanning}
            className="mt-5 px-6 py-2.5 bg-white border border-slate-200 rounded-2xl text-xs font-black text-blue-600 hover:bg-slate-50 transition-all disabled:opacity-50"
          >
            {t('setupSkills.manager.import')}
          </button>
        </div>
      )}

      {/* 下一步按鈕與錯誤 */}
      <div className="space-y-4">
        {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-600 text-[11px] animate-in slide-in-from-top-1">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <p className="font-medium">{errorMsg}</p>
            </div>
        )}

        <button 
          onClick={handleNext} 
          disabled={acting || scanning}
          className={`w-full flex items-center justify-center gap-3 ${(acting || scanning) ? 'bg-blue-400' : 'bg-slate-900 hover:bg-slate-800'} text-white font-black py-4 px-8 rounded-2xl transition-all shadow-2xl uppercase tracking-widest text-xs`}
        >
          {userType === 'existing' ? (
              <>{t('setupSkills.manager.next')} <ArrowRight size={18} /></>
          ) : (acting || scanning) ? (
             <>
                <RefreshCw size={18} className="animate-spin" /> {t('setupSkills.manager.syncing')}
            </>
          ) : (
            <>{t('setupSkills.manager.next')} <ArrowRight size={18} /></>
          )}
        </button>
      </div>
    </div>
  );
};

export default SetupStepSkills;
