import { Layout, Activity, BarChart3, Radar, Brain, Boxes, Database, MonitorPlay, Building2, Info, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useState, type ReactNode } from 'react';

type SidebarProps = {
  activeTab: string;
  onChangeTab: (tab: string) => void;
  onToggleViewMode: () => void;
  appVersion?: string;
  t: TFunction;
};

type NavItemProps = {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
};

function NavItem({ icon, label, active = false, onClick }: NavItemProps) {
  return (
    <div onClick={onClick} className={`flex items-center px-4 py-4 rounded-2xl cursor-pointer transition-all duration-300 ${active ? 'bg-blue-600/10 text-blue-400 shadow-inner' : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'}`}>
      <span className={`mr-4 ${active ? 'scale-110 opacity-100' : 'opacity-70'}`}>{icon}</span>
      <span className={`text-[13px] font-bold uppercase tracking-wider ${active ? 'opacity-100' : 'opacity-60'}`}>{label}</span>
    </div>
  );
}

function InfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-[540px] max-h-[82vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Info size={16} className="text-white" />
            </div>
            <span className="text-base font-bold tracking-tight">ClawLaunch 使用說明</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Section 1: 功能導覽 */}
        <section className="mb-6">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-blue-400 mb-3">功能導覽</h2>
          <div className="space-y-2 text-sm">
            {[
              { name: '進程監控', desc: '即時查看 OpenClaw Gateway、子進程與系統資源狀態。' },
              { name: '消耗預算', desc: '追蹤各 Agent 的 Token 使用量與 API 費用趨勢。' },
              { name: '任務看板', desc: '檢視與管理 AI Agent 正在執行的任務、排程與阻塞狀態。' },
              { name: '記憶資料', desc: '瀏覽、搜尋 Agent 的長期記憶與知識庫條目。' },
              { name: 'Agent 辦公室', desc: '管理多個 Agent 的配置、認證、技能與排程任務。' },
            ].map(({ name, desc }) => (
              <div key={name} className="flex gap-3 p-3 bg-slate-800/60 rounded-xl">
                <span className="text-blue-400 font-bold min-w-[80px] shrink-0">{name}</span>
                <span className="text-slate-400 leading-relaxed">{desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Section 2: CLI 用法 */}
        <section>
          <h2 className="text-[11px] font-black uppercase tracking-widest text-emerald-400 mb-3">CLI 用法</h2>
          <p className="text-[12px] text-slate-400 mb-3">需先啟動 ClawLaunch App，CLI 才能連線（連接埠 19827）。</p>

          <div className="space-y-3">
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-bold mb-2">安裝（全局使用）</p>
              <pre className="text-[12px] text-emerald-300 font-mono whitespace-pre-wrap leading-relaxed">{`cd /path/to/NT-ClawLaunch
npm link          # 全局安裝 clawlaunch 指令`}</pre>
            </div>
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-bold mb-2">可用指令</p>
              <pre className="text-[12px] text-emerald-300 font-mono whitespace-pre-wrap leading-relaxed">{`clawlaunch health            # 確認 App 連線狀態
clawlaunch gateway:start     # 啟動 Gateway
clawlaunch gateway:stop      # 停止 Gateway
clawlaunch gateway:restart   # 重新啟動 Gateway`}</pre>
            </div>
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-bold mb-2">不安裝直接執行</p>
              <pre className="text-[12px] text-emerald-300 font-mono whitespace-pre-wrap leading-relaxed">{`node scripts/clawlaunch.mjs health
node scripts/clawlaunch.mjs gateway:start`}</pre>
            </div>
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-bold mb-2">回傳碼</p>
              <pre className="text-[12px] text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">{`0   成功
1   執行失敗（請查看 stderr）
2   指令用法錯誤
69  App 未啟動（找不到連接埠檔案）`}</pre>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function Sidebar({ activeTab, onChangeTab, onToggleViewMode, appVersion, t }: SidebarProps) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div className="w-64 bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col p-4 space-y-6">
      <div className="flex items-center space-y-1 py-4 px-2">
        <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center mr-3 shadow-xl shadow-blue-500/20">
          <Layout size={20} className="text-white" />
        </div>
        <div>
          <div className="font-bold text-lg leading-none tracking-tight">ClawLaunch</div>
          <div className="text-[10px] text-blue-500 font-mono uppercase tracking-widest">{t('app.version', { version: appVersion || '...' })}</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1">
        <NavItem icon={<Activity size={18} />} label={t('app.tabs.monitor')} active={activeTab === 'monitor'} onClick={() => onChangeTab('monitor')} />
        <NavItem icon={<BarChart3 size={18} />} label={t('app.tabs.analytics')} active={activeTab === 'analytics'} onClick={() => onChangeTab('analytics')} />
        <NavItem icon={<Radar size={18} />} label={t('app.tabs.controlCenter')} active={activeTab === 'controlCenter'} onClick={() => onChangeTab('controlCenter')} />
        {/* 已移至 agentOffice 統一管理 */}
        <NavItem icon={<Brain size={18} />} label={t('app.tabs.memory')} active={activeTab === 'memory'} onClick={() => onChangeTab('memory')} />
        {/* <NavItem icon={<Boxes size={18} />} label={t('app.tabs.skills')} active={activeTab === 'skills'} onClick={() => onChangeTab('skills')} /> */}
        {/* <NavItem icon={<Database size={18} />} label={t('app.tabs.runtimeSettings')} active={activeTab === 'runtimeSettings'} onClick={() => onChangeTab('runtimeSettings')} /> */}
        <NavItem icon={<Building2 size={18} />} label={t('app.tabs.agentOffice')} active={activeTab === 'agentOffice'} onClick={() => onChangeTab('agentOffice')} />
      </nav>

      <div onClick={onToggleViewMode} className="p-4 bg-blue-600/10 rounded-2xl border border-blue-500/20 cursor-pointer hover:bg-blue-600/20 transition-all flex items-center justify-between group">
        <div className="text-[10px] text-blue-400 uppercase font-black tracking-widest">{t('app.switchMiniMode')}</div>
        <MonitorPlay size={14} className="text-blue-400 group-hover:scale-110 transition-transform" />
      </div>

      <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-600 px-2 flex justify-between items-center font-mono">
        <span>{t('app.version', { version: appVersion || '...' })}</span>
        <div className="flex items-center gap-2">
          <span className="flex items-center"><div className="w-2 h-2 rounded-full bg-emerald-500 mr-1 animate-pulse"></div> {t('app.online')}</span>
          <button
            onClick={() => setShowInfo(true)}
            className="text-slate-500 hover:text-blue-400 transition-colors ml-1"
            title="使用說明"
          >
            <Info size={13} />
          </button>
        </div>
      </div>
      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}
    </div>
  );
}
