import { useState, useEffect, useRef } from 'react';
import { RefreshCcw, ArrowUpCircle, Loader2, CheckCircle } from 'lucide-react';
import TerminalLog from './common/TerminalLog';

const UpdateBanner = () => {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [complete, setComplete] = useState(false);
  const [versions, setVersions] = useState({ local: '...', remote: '...' });
  const [localLogs, setLocalLogs] = useState<any[]>([]);
  const logCleanupRef = useRef<any>(null);

  useEffect(() => {
    checkVersion();
    
    if (window.electronAPI) {
        logCleanupRef.current = window.electronAPI.onLog((payload) => {
            setLocalLogs(prev => [...prev.slice(-49), { text: payload.data, source: payload.source, time: new Date().toLocaleTimeString() }]);
        });
    }

    return () => {
      if (typeof logCleanupRef.current === 'function') {
            logCleanupRef.current();
        }
    };
  }, []);

  const checkVersion = async () => {
    if (window.electronAPI) {
      try {
        const res = await window.electronAPI.exec('version:check');
        if (res.code !== 0 || !res.stdout) {
          return;
        }
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
    setLocalLogs([{ text: '🚀 啟動系統更新程序...', source: 'system', time: new Date().toLocaleTimeString() }]);
    
    try {
      // 在專案根目錄執行更新
      const res = await window.electronAPI.exec('git pull && pnpm install --no-frozen-lockfile || npm install');
      
      if (res.code === 0) {
          setComplete(true);
      } else {
          alert("更新失敗，請檢查日誌輸出。");
      }
    } catch (e) {
      alert("更新系統異常。");
    } finally {
      setUpdating(false);
    }
  };

  if (complete) {
    return (
      <div className="mx-6 mt-4 p-8 bg-emerald-50 dark:bg-emerald-950/20 border-2 border-emerald-200 dark:border-emerald-800 rounded-3xl flex flex-col gap-6 animate-in slide-in-from-top duration-500 shadow-xl shadow-emerald-500/10">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600 shadow-inner">
                    <CheckCircle size={24} />
                </div>
                <div>
                    <h4 className="text-lg font-black text-emerald-900 dark:text-emerald-100">系統更新成功！</h4>
                    <p className="text-sm text-emerald-700 dark:text-emerald-300 font-medium">版本已升級至 {String(versions.remote || '')}。請立即重啟以啟動新核心。</p>
                </div>
            </div>
            <button 
                onClick={() => window.location.reload()}
                className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black rounded-xl transition-all shadow-lg active:scale-95"
            >
                立即重啟
            </button>
        </div>
      </div>
    );
  }

  if (!hasUpdate) return null;

  return (
    <div 
      className="mx-6 mt-4 p-6 bg-blue-50 dark:bg-blue-950/20 border-2 border-blue-100 dark:border-blue-900 rounded-[32px] flex flex-col gap-6 animate-in slide-in-from-top duration-600 shadow-xl shadow-blue-500/5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/50 rounded-2xl flex items-center justify-center text-blue-600 dark:text-blue-400 shadow-inner group overflow-hidden">
                <ArrowUpCircle size={28} className="group-hover:scale-110 transition-transform" />
            </div>
            <div>
                <h4 className="font-black text-blue-900 dark:text-blue-50 text-lg tracking-tight">發現龍蝦新演化 {String(versions.remote || '')}</h4>
                <p className="text-xs text-blue-700 dark:text-blue-400 font-medium flex items-center gap-1.5 mt-1">
                    <RefreshCcw size={12} /> 目前版本: {String(versions.local || '')} • 建議立即升級以同步最新底層協定
                </p>
            </div>
        </div>

        <div className="flex items-center gap-4">
            {!updating && (
                <button onClick={() => setHasUpdate(false)} className="px-4 py-2 text-blue-400 hover:text-blue-600 font-black text-xs uppercase tracking-widest transition-colors">
                    先不要
                </button>
            )}
            <button 
                disabled={updating}
                onClick={handleUpdate}
                className="px-8 py-4 bg-gray-900 hover:bg-black text-white text-xs font-black rounded-2xl transition-all shadow-xl shadow-blue-200/50 flex items-center gap-2 active:scale-95 disabled:bg-gray-400"
            >
                {updating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                {updating ? '正在升級核心...' : '立即升級'}
            </button>
        </div>
      </div>

      {/* 展開的日誌區域 */}
      {(updating || localLogs.length > 0) && !complete && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-500">
              <TerminalLog logs={localLogs} height="h-44" title="System Update Core Logs" />
          </div>
      )}
    </div>
  );
};

export default UpdateBanner;
