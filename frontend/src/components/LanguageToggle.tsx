import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { Globe } from 'lucide-react';

export function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const { language, setLanguage } = useStore();

  const toggleLanguage = () => {
    const nextLang = language === 'zh-TW' ? 'zh-CN' : language === 'zh-CN' ? 'en' : 'zh-TW';
    i18n.changeLanguage(nextLang);
    setLanguage(nextLang);
  };

  const labels: Record<string, string> = {
    'zh-TW': t('language.labels.zhTW'),
    'zh-CN': t('language.labels.zhCN'),
    'en': t('language.labels.en')
  };

  return (
    <button 
      onClick={toggleLanguage}
      className="flex items-center space-x-2 bg-slate-100 dark:bg-slate-900/80 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-800 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
      title={t('language.toggleTitle')}
    >
      <Globe size={14} className="text-slate-600 dark:text-slate-400" />
      <span className="text-[10px] font-black text-slate-500 dark:text-slate-400">
        {labels[language] || labels['zh-TW']}
      </span>
    </button>
  );
}
