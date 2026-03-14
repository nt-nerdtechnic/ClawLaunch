import React from 'react';
import { Package, Sparkles, ArrowRight, Layers, Settings, Database } from 'lucide-react';
import { useStore } from '../../store';
import { useTranslation } from 'react-i18next';

/**
 * SetupStepWelcome: Step 0 - Environment Choice
 * Implements the "Split Selection" UI.
 */
const SetupStepWelcome = ({ onNext }) => {
  const { setUserType, setConfig, setDetectedConfig } = useStore();
  const { t } = useTranslation();

  const handleChoice = (type) => {
    setUserType(type);
    if (type === 'new') {
      // 若為新建專案，清除所有內容，確保完全從零開始
      setConfig({ 
        corePath: '', 
        configPath: '', 
        workspacePath: '',
        authChoice: '',
        model: '',     
        apiKey: '',
        botToken: '',
        platform: 'telegram',
        enabledSkills: []
      });
      setDetectedConfig(null);
      localStorage.removeItem('onboarding_finished');
    } else if (type === 'existing' && detectedConfig) {
      // 若為現有專案且有偵測到配置，則預填入核心路徑與設定
      // 但保留 API Key 等敏感資訊在 detectedConfig 中，待後續步驟確認
      setConfig({
        corePath: detectedConfig.corePath || '',
        configPath: detectedConfig.configPath || '',
        workspacePath: detectedConfig.workspacePath || ''
      });
    }
    onNext();
  };

  return (
    <div className="w-full max-w-3xl mx-auto bg-white rounded-3xl shadow-xl shadow-gray-100 border border-gray-100 p-10 animate-in fade-in zoom-in-95 duration-500">
      <div className="mb-12 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-2xl text-blue-600 mb-6 rotate-3 hover:rotate-0 transition-transform duration-300">
          <Sparkles size={32} />
        </div>
        <h2 className="text-3xl font-black text-gray-900 tracking-tight">{t('welcome.title')}</h2>
        <p className="text-gray-500 mt-3 text-lg">{t('welcome.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 gap-8">
        {/* 選項 1: 已有安裝 (現有用戶) */}
        <div 
          onClick={() => handleChoice('existing')}
          className="group relative p-8 rounded-[32px] border-2 border-gray-100 hover:border-blue-500 hover:bg-blue-50/30 transition-all duration-300 cursor-pointer overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
             <Layers size={100} />
          </div>
          
          <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 mb-6 group-hover:scale-110 transition-transform">
            <Package size={28} />
          </div>
          
          <h3 className="text-xl font-bold text-gray-900 mb-2">{t('welcome.existingTitle')}</h3>
          <p className="text-sm text-gray-500 leading-relaxed mb-6">
            {t('welcome.existingDesc')}
          </p>
          
          <div className="flex items-center gap-2 text-blue-600 font-bold text-sm uppercase tracking-widest">
            {t('welcome.linkBtn')} <ArrowRight size={16} />
          </div>

          <div className="mt-6 pt-6 border-t border-gray-100 flex gap-3">
             <div className="flex flex-col items-center opacity-40 group-hover:opacity-100 transition-opacity">
                <Settings size={14} className="text-gray-400" />
                <span className="text-[8px] mt-1 uppercase font-bold">{t('welcome.core')}</span>
             </div>
             <div className="flex flex-col items-center opacity-40 group-hover:opacity-100 transition-opacity">
                <Database size={14} className="text-gray-400" />
                <span className="text-[8px] mt-1 uppercase font-bold">{t('welcome.workspace')}</span>
             </div>
          </div>
        </div>

        {/* 選項 2: 尚未安裝 (新用戶) */}
        <div 
          onClick={() => handleChoice('new')}
          className="group relative p-8 rounded-[32px] border-2 border-gray-100 hover:border-indigo-500 hover:bg-indigo-50/30 transition-all duration-300 cursor-pointer overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
             <Sparkles size={100} />
          </div>
          
          <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 mb-6 group-hover:scale-110 transition-transform">
            <Sparkles size={28} />
          </div>
          
          <h3 className="text-xl font-bold text-gray-900 mb-2">{t('welcome.newTitle')}</h3>
          <p className="text-sm text-gray-500 leading-relaxed mb-6">
            {t('welcome.newDesc')}
          </p>
          
          <div className="flex items-center gap-2 text-indigo-600 font-bold text-sm uppercase tracking-widest">
            {t('welcome.startBtn')} <ArrowRight size={16} />
          </div>
        </div>
      </div>

      <div className="mt-12 text-center text-xs text-gray-400 font-medium">
         {t('welcome.architectureDesc')}
      </div>
    </div>
  );
};

export default SetupStepWelcome;
