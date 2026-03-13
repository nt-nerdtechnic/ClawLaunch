import { useState, useEffect } from 'react';
import { RefreshCcw, ArrowUpCircle, X, Loader2, CheckCircle } from 'lucide-react';
import tokens from '../../../shared/design_tokens.json';

const UpdateBanner = () => {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [complete, setComplete] = useState(false);
  const [versions, setVersions] = useState({ local: '...', remote: '...' });

  useEffect(() => {
    checkVersion();
  }, []);

  const checkVersion = async () => {
    if (window.electronAPI) {
      try {
        const res = await window.electronAPI.exec('version:check');
        const data = JSON.parse(res.stdout);
        setVersions({ local: data.local, remote: data.remote });
        setHasUpdate(data.hasUpdate);
      } catch (e) {
        console.error("Failed to check version", e);
      }
    }
  };

  const handleUpdate = async () => {
    setUpdating(true);
    if (window.electronAPI) {
      try {
        await window.electronAPI.exec('execute:update');
        setUpdating(false);
        setComplete(true);
      } catch (e) {
        setUpdating(false);
        alert("更新失敗，請檢查網路或權限。");
      }
    }
  };

  if (complete) {
    return (
      <div className="mx-6 mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between animate-in slide-in-from-top duration-500 shadow-sm">
        <div className="flex items-center gap-3">
          <CheckCircle className="text-emerald-500" size={20} />
          <span className="text-sm font-bold text-emerald-800">更新成功！版本已升級至 {versions.remote}。請重啟以套用。</span>
        </div>
        <button 
          onClick={() => window.location.reload()}
          className="px-4 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-all"
        >
          立即重啟
        </button>
      </div>
    );
  }

  if (!hasUpdate) return null;

  return (
    <div 
      style={{ backgroundColor: tokens.colors.update_banner_bg, borderColor: tokens.colors.update_banner_border }}
      className="mx-6 mt-4 p-4 border rounded-2xl flex items-center justify-between animate-in slide-in-from-top duration-500 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
          <ArrowUpCircle size={18} />
        </div>
        <div>
          <h4 className="font-bold text-blue-900 text-sm">發現新版本 {versions.remote} (目前: {versions.local})</h4>
          <p className="text-xs text-blue-700 opacity-80 font-medium">優化了底層通訊架構並新增了主權研發接力賽協定。</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button 
          disabled={updating}
          onClick={handleUpdate}
          className="px-6 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center gap-2 disabled:bg-blue-300"
        >
          {updating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
          {updating ? '正在執行 git pull...' : '立即更新'}
        </button>
        <button onClick={() => setHasUpdate(false)} className="p-2 text-blue-400 hover:text-blue-600">
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default UpdateBanner;
