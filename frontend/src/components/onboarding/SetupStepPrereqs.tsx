import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Terminal,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  Download,
} from 'lucide-react';
import TerminalLog from '../common/TerminalLog';
import { execInTerminal } from '../../utils/terminal';

type DepStatus = 'checking' | 'ok' | 'missing' | 'installing' | 'failed';

interface DepState {
  status: DepStatus;
  version?: string;
}

interface Dep {
  id: string;
  label: string;
  description: string;
  checkCmd: string;
  parseVersion: (stdout: string, stderr: string) => string | null;
  versionWarn?: (version: string) => string | null;
  installCmd: string;
  installTitle: string;
  openTerminal?: boolean;
  optional?: boolean;
}

const DEPS: Dep[] = [
  {
    id: 'homebrew',
    label: 'Homebrew',
    description: 'macOS 套件管理器，git / python / node 等工具的安裝基礎',
    checkCmd:
      'brew --version 2>/dev/null || /opt/homebrew/bin/brew --version 2>/dev/null || /usr/local/bin/brew --version 2>/dev/null',
    parseVersion: (out) => {
      const m = out.match(/Homebrew\s+([\d.]+)/);
      return m ? m[1] : null;
    },
    installCmd:
      '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    installTitle: '安裝 Homebrew（需要管理員密碼）',
    openTerminal: true,
  },
  {
    id: 'git',
    label: 'Git',
    description: '版本控制工具（ZIP 方式下載 OpenClaw 原始碼時可選）',
    checkCmd: 'git --version',
    parseVersion: (out) => {
      const m = out.match(/git version\s+([\d.]+)/);
      return m ? m[1] : null;
    },
    installCmd: 'brew install git 2>&1',
    installTitle: '安裝 Git',
  },
  {
    id: 'node',
    label: 'Node.js',
    description: 'JavaScript 執行環境，OpenClaw CLI 核心依賴（需要 v22+）',
    checkCmd:
      'zsh -ilc "node --version" 2>/dev/null || node --version 2>/dev/null',
    parseVersion: (out) => {
      const m = out.match(/v(\d+\.\d+\.\d+)/);
      return m ? m[1] : null;
    },
    versionWarn: (v) => {
      const major = parseInt(v.split('.')[0], 10);
      return major < 22 ? `目前 v${v}，建議升級至 v22` : null;
    },
    installCmd:
      'brew install node@22 2>&1 && brew link node@22 --force --overwrite 2>&1',
    installTitle: '安裝 Node.js v22',
  },
  {
    id: 'pnpm',
    label: 'pnpm',
    description: 'Node.js 套件管理器，OpenClaw 安裝與執行的直接依賴',
    checkCmd:
      'zsh -ilc "pnpm --version" 2>/dev/null || pnpm --version 2>/dev/null',
    parseVersion: (out) => {
      const lines = out.trim().split('\n').filter((l) => /^\d+\.\d+/.test(l));
      return lines[0]?.trim() || null;
    },
    installCmd:
      'zsh -ilc "npm install -g pnpm" 2>&1 || npm install -g pnpm 2>&1',
    installTitle: '安裝 pnpm',
  },
  {
    id: 'python',
    label: 'Python 3',
    description: 'OpenClaw 部分插件與 YAML 設定解析的執行環境',
    checkCmd: 'python3 --version 2>&1',
    parseVersion: (out, err) => {
      const m = (out + err).match(/Python\s+([\d.]+)/);
      return m ? m[1] : null;
    },
    installCmd: 'brew install python3 2>&1',
    installTitle: '安裝 Python 3',
  },
  {
    id: 'pyyaml',
    label: 'PyYAML',
    description: 'Python YAML 解析庫，OpenClaw 設定檔格式支援',
    checkCmd:
      'python3 -c "import yaml; print(yaml.__version__)" 2>/dev/null',
    parseVersion: (out) => {
      const lines = out.trim().split('\n').filter((l) => /^\d+/.test(l));
      return lines[0]?.trim() || null;
    },
    installCmd: 'pip3 install PyYAML 2>&1',
    installTitle: '安裝 PyYAML',
    optional: true,
  },
];

const StatusIcon = ({ status }: { status: DepStatus }) => {
  switch (status) {
    case 'checking':
    case 'installing':
      return <Loader2 size={16} className="text-blue-500 animate-spin shrink-0" />;
    case 'ok':
      return <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />;
    case 'failed':
      return <AlertCircle size={16} className="text-amber-500 shrink-0" />;
    case 'missing':
    default:
      return <XCircle size={16} className="text-red-400 shrink-0" />;
  }
};

const SetupStepPrereqs = ({ onNext }: { onNext: () => void }) => {
  const [states, setStates] = useState<Record<string, DepState>>(() =>
    Object.fromEntries(DEPS.map((d) => [d.id, { status: 'checking' as DepStatus }])),
  );
  const statesRef = useRef(states);
  const [logs, setLogs] = useState<{ text: string; source: string; time: string }[]>([]);
  const [bulkInstalling, setBulkInstalling] = useState(false);

  useEffect(() => {
    statesRef.current = states;
  }, [states]);

  const addLog = useCallback((text: string, source: 'stdout' | 'stderr' | 'system' = 'system') => {
    setLogs((prev) => [...prev, { text, source, time: new Date().toLocaleTimeString() }]);
  }, []);

  const checkDep = useCallback(async (dep: Dep): Promise<void> => {
    setStates((prev) => ({ ...prev, [dep.id]: { status: 'checking' } }));
    try {
      const res = await window.electronAPI.exec(dep.checkCmd);
      const out = String(res.stdout || '');
      const err = String(res.stderr || '');
      const version = dep.parseVersion(out, err);
      if (version) {
        setStates((prev) => ({ ...prev, [dep.id]: { status: 'ok', version } }));
      } else {
        setStates((prev) => ({ ...prev, [dep.id]: { status: 'missing' } }));
      }
    } catch {
      setStates((prev) => ({ ...prev, [dep.id]: { status: 'missing' } }));
    }
  }, []);

  const checkAll = useCallback(async () => {
    await Promise.all(DEPS.map((dep) => checkDep(dep)));
  }, [checkDep]);

  useEffect(() => {
    void checkAll();
  }, [checkAll]);

  const installDep = useCallback(
    async (dep: Dep): Promise<boolean> => {
      setStates((prev) => ({ ...prev, [dep.id]: { ...prev[dep.id], status: 'installing' } }));
      addLog(`>>> 安裝 ${dep.label}...`, 'system');

      if (dep.openTerminal) {
        await execInTerminal(dep.installCmd, { title: dep.installTitle, holdOpen: true });
        addLog(`>>> ${dep.label} 已在外部終端機執行，完成後請點擊「重新檢查」`, 'system');
        setStates((prev) => ({ ...prev, [dep.id]: { status: 'missing' } }));
        return false;
      }

      try {
        const res = await window.electronAPI.exec(dep.installCmd);
        const out = String(res.stdout || '').trim();
        const err = String(res.stderr || '').trim();
        if (out) addLog(out, 'stdout');
        if (err) addLog(err, 'stderr');
        if (res.code !== 0) {
          addLog(`✗ ${dep.label} 安裝失敗 (exit ${res.code})`, 'stderr');
          setStates((prev) => ({ ...prev, [dep.id]: { status: 'failed' } }));
          return false;
        }
        addLog(`✓ ${dep.label} 安裝完成，正在重新驗證...`, 'system');
        await checkDep(dep);
        return true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'unknown error';
        addLog(`✗ ${dep.label} 安裝失敗: ${msg}`, 'stderr');
        setStates((prev) => ({ ...prev, [dep.id]: { status: 'failed' } }));
        return false;
      }
    },
    [addLog, checkDep],
  );

  const installAllMissing = useCallback(async () => {
    const snapshot = statesRef.current;
    const toInstall = DEPS.filter((d) => {
      const s = snapshot[d.id];
      return s?.status === 'missing' || s?.status === 'failed';
    });
    if (toInstall.length === 0) return;

    setBulkInstalling(true);
    setLogs([]);

    // Homebrew requires an interactive terminal (sudo); handle separately
    const homebrewNeeded = toInstall.find((d) => d.id === 'homebrew');
    if (homebrewNeeded) {
      await installDep(homebrewNeeded);
      addLog(
        '>>> Homebrew 安裝中。完成後請點擊「重新檢查」，再次執行「一鍵安裝」以繼續其他套件。',
        'system',
      );
      setBulkInstalling(false);
      return;
    }

    for (const dep of toInstall) {
      await installDep(dep);
    }
    setBulkInstalling(false);
  }, [installDep, addLog]);

  const isChecking = Object.values(states).some((s) => s.status === 'checking');
  const allRequiredOk = DEPS.filter((d) => !d.optional).every(
    (d) => states[d.id]?.status === 'ok',
  );
  const missingDeps = DEPS.filter((d) => {
    const s = states[d.id];
    return s?.status === 'missing' || s?.status === 'failed';
  });
  const missingRequired = missingDeps.filter((d) => !d.optional);

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-[32px] shadow-2xl shadow-gray-100 border border-gray-100 p-10 animate-in fade-in zoom-in-95 duration-500">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-violet-50 rounded-2xl text-violet-600 mb-5 border border-violet-100">
          <Terminal size={28} />
        </div>
        <h2 className="text-3xl font-black text-gray-900 tracking-tight">環境前置依賴</h2>
        <p className="text-gray-500 mt-2 font-medium text-sm">
          以下套件為 OpenClaw 正常運作的必要環境
        </p>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={checkAll}
          disabled={isChecking || bulkInstalling}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 text-xs font-black uppercase tracking-widest transition-all disabled:opacity-40"
        >
          <RefreshCw size={12} className={isChecking ? 'animate-spin' : ''} />
          重新檢查
        </button>

        {missingDeps.length > 0 && (
          <button
            onClick={installAllMissing}
            disabled={bulkInstalling || isChecking}
            className="flex items-center gap-2 px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 shadow-lg"
          >
            {bulkInstalling ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Download size={12} />
            )}
            一鍵安裝全部缺少的
          </button>
        )}

        {allRequiredOk && !isChecking && (
          <span className="ml-auto flex items-center gap-1.5 text-[10px] font-black text-emerald-600 uppercase tracking-wider">
            <CheckCircle2 size={12} />
            所有必要項目就緒
          </span>
        )}
      </div>

      {/* Dependency list */}
      <div className="space-y-2 mb-6">
        {DEPS.map((dep) => {
          const st = states[dep.id] || { status: 'checking' as DepStatus };
          const activelyInstalling = st.status === 'installing';
          const versionWarn = st.version ? dep.versionWarn?.(st.version) : null;

          return (
            <div
              key={dep.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors ${
                st.status === 'ok' && !versionWarn
                  ? 'bg-emerald-50/30 border-emerald-100'
                  : st.status === 'ok' && versionWarn
                  ? 'bg-amber-50/30 border-amber-100'
                  : st.status === 'installing'
                  ? 'bg-blue-50/30 border-blue-100'
                  : st.status === 'failed'
                  ? 'bg-amber-50/30 border-amber-100'
                  : st.status === 'missing'
                  ? 'bg-red-50/20 border-red-100'
                  : 'bg-slate-50/50 border-slate-100'
              }`}
            >
              <StatusIcon status={activelyInstalling ? 'installing' : st.status} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-black text-slate-800">{dep.label}</span>
                  {dep.optional && (
                    <span className="text-[8px] font-black text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded uppercase tracking-wide">
                      可選
                    </span>
                  )}
                  {st.version && (
                    <span
                      className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        versionWarn
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      v{st.version}
                    </span>
                  )}
                  {versionWarn && (
                    <span className="text-[9px] text-amber-600 font-bold">{versionWarn}</span>
                  )}
                  {activelyInstalling && (
                    <span className="text-[9px] text-blue-600 font-bold">安裝中...</span>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5 font-medium">{dep.description}</p>
              </div>

              {/* Individual install button */}
              {(st.status === 'missing' || st.status === 'failed') &&
                !bulkInstalling &&
                !activelyInstalling && (
                  <button
                    onClick={() => installDep(dep)}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wide transition-all ${
                      dep.openTerminal
                        ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-200'
                        : 'bg-slate-800 hover:bg-slate-700 text-white shadow-lg shadow-slate-200'
                    }`}
                  >
                    {dep.openTerminal ? <Terminal size={10} /> : <Download size={10} />}
                    {dep.openTerminal ? '開啟終端機安裝' : '安裝'}
                  </button>
                )}

              {/* Upgrade button for outdated Node */}
              {dep.id === 'node' && st.status === 'ok' && versionWarn && !bulkInstalling && (
                <button
                  onClick={() => installDep(dep)}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wide bg-amber-600 hover:bg-amber-500 text-white transition-all"
                >
                  <Download size={10} />
                  升級至 v22
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Install log */}
      {logs.length > 0 && (
        <div className="mb-6">
          <TerminalLog logs={logs} height="h-44" title="安裝日誌" />
        </div>
      )}

      {/* Continue / Skip */}
      <div className="space-y-3">
        {allRequiredOk ? (
          <button
            onClick={onNext}
            className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-emerald-200 uppercase tracking-widest text-xs"
          >
            環境已就緒，繼續設定 <ArrowRight size={18} />
          </button>
        ) : (
          <>
            {missingRequired.length > 0 && (
              <p className="text-[10px] text-amber-600 font-bold text-center px-4">
                ⚠ 仍有 {missingRequired.length} 個必要套件尚未安裝，可能影響 OpenClaw 正常運作
              </p>
            )}
            <button
              onClick={onNext}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 text-xs font-black uppercase tracking-widest transition-all"
            >
              跳過，稍後再處理 <ArrowRight size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default SetupStepPrereqs;
