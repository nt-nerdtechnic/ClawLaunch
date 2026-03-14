import { CheckCircle2, XCircle, Clock, ExternalLink } from 'lucide-react';
import { useStore } from '../store';
import { useTranslation } from 'react-i18next';

export function ActionCenter() {
  const { t } = useTranslation();
  const { snapshot } = useStore();

  if (!snapshot) return null;

  const { approvals = [] } = snapshot;
  
  // Show only pending approvals for now
  const pendingApprovals = approvals.filter((a: any) => a.status === 'pending');

  if (pendingApprovals.length === 0) {
    return (
      <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 p-8 rounded-3xl flex flex-col items-center justify-center text-center space-y-3">
        <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500">
          <CheckCircle2 size={24} />
        </div>
        <div className="space-y-1">
          <h4 className="font-bold text-slate-900 dark:text-slate-100">{t('monitor.allClear', '系統運作正常')}</h4>
          <p className="text-xs text-slate-500">{t('monitor.noPendingActions', '目前沒有需要您介入的待處理事項。')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-2">
        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
          {t('monitor.actionQueue', '待處理事項')} ({pendingApprovals.length})
        </h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {pendingApprovals.map((action: any) => (
          <div key={action.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-[24px] shadow-lg hover:border-blue-500/30 transition-all group relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
            
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-500">
                  <Clock size={20} />
                </div>
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{action.agentId}</div>
                  <div className="font-bold text-slate-900 dark:text-slate-100">{action.title || '需要審批'}</div>
                </div>
              </div>
              <div className="px-2 py-1 bg-amber-500/10 text-amber-500 text-[10px] font-black rounded-lg uppercase tracking-widest">
                Pending
              </div>
            </div>
            
            <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 mb-6">
              {action.prompt || 'Agent 正在請求執行一項工具或作業，需要您的授權。'}
            </p>
            
            <div className="flex gap-3">
              <button className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-95">
                {t('monitor.approve', '批准')}
              </button>
              <button className="px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95">
                <XCircle size={16} />
              </button>
            </div>
            
            {action.url && (
              <a href={action.url} target="_blank" rel="noreferrer" className="absolute top-6 right-6 text-slate-400 hover:text-blue-500 transition-colors">
                <ExternalLink size={16} />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
