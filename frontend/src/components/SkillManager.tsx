import { useState } from 'react';
import { useStore } from '../store';
import { Info, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';

const SKILL_DATA = [
  { id: 'browser', name: 'Browser Automation', desc: '控制瀏覽器執行網頁操作', category: 'Core', details: '支持 Playwright 與 Puppeteer 雙引擎。' },
  { id: 'coding', name: 'Coding Agent', desc: '呼叫 Claude Code 執行代碼開發', category: 'Dev', details: '深度整合指令碼生成與 Git 自動提交功能。' },
  { id: 'search', name: 'Web Search', desc: '使用 Brave API 進行全網搜索', category: 'Core', details: '需要配置 BRAVE_API_KEY 以啟用實時搜索。' },
  { id: 'market', name: 'Market Sentinel', desc: '監測特定品牌與產品公關風險', category: 'Intel', details: '定期爬取社群媒體與新聞網站進行情感分析。' },
  { id: 'cron', name: 'Cron Guardian', desc: '監管背景排程與心跳機制', category: 'Ops', details: '管理 Moltbot 的週期性自定義任務。' },
];

export function SkillManager() {
  const { config, toggleSkill } = useStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const enabledSkills = config.enabledSkills || [];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500 pb-20">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-slate-100 flex items-center">
            <span className="w-1.5 h-6 bg-blue-500 rounded-full mr-3"></span>
            技能插件矩陣
        </h3>
        <div className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-3 py-1 rounded-full font-mono uppercase">
            Active: {enabledSkills.length} / {SKILL_DATA.length}
        </div>
      </div>

      <div className="grid gap-4">
        {SKILL_DATA.map((skill) => {
          const isEnabled = enabledSkills.includes(skill.id);
          return (
            <div key={skill.id} className="flex flex-col bg-slate-900/30 border border-slate-800/60 rounded-2xl overflow-hidden group hover:border-slate-700 transition-all">
              <div className="p-5 flex items-center justify-between cursor-pointer" onClick={() => setExpandedId(expandedId === skill.id ? null : skill.id)}>
                  <div className="flex-1">
                  <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-mono text-blue-500/80 bg-blue-500/5 px-2 py-0.5 rounded border border-blue-500/10 uppercase tracking-tighter">
                          {skill.category}
                      </span>
                      <h4 className="font-bold text-slate-200">{skill.name}</h4>
                      <HelpCircle size={12} className="text-slate-600" />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{skill.desc}</p>
                  </div>
                  
                  <div className="flex items-center space-x-6">
                      <div 
                          onClick={async (e) => { 
                            e.stopPropagation(); 
                            toggleSkill(skill.id); 
                            // 立即同步至本地配置
                            if (window.electronAPI) {
                                const newSkills = isEnabled 
                                    ? enabledSkills.filter(id => id !== skill.id)
                                    : [...enabledSkills, skill.id];
                                await window.electronAPI.exec(`config:write ${JSON.stringify({ ...config, enabledSkills: newSkills })}`);
                            }
                          }}
                          className={`w-11 h-6 rounded-full p-1 transition-all duration-300 cursor-pointer ${isEnabled ? 'bg-emerald-500' : 'bg-slate-800'}`}
                      >
                          <div className={`w-4 h-4 bg-white rounded-full shadow-md transition-transform duration-300 ${isEnabled ? 'translate-x-5' : 'translate-x-0'}`}></div>
                      </div>
                      {expandedId === skill.id ? <ChevronUp size={16} className="text-slate-600" /> : <ChevronDown size={16} className="text-slate-600" />}
                  </div>
              </div>
              
              {expandedId === skill.id && (
                  <div className="px-5 pb-5 pt-0 animate-in slide-in-from-top-2 duration-300">
                      <div className="bg-black/40 rounded-xl p-4 border border-slate-800/50">
                          <div className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mb-2">深度配置細節</div>
                          <p className="text-xs text-slate-400 leading-relaxed">{skill.details}</p>
                      </div>
                  </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-blue-600/5 border border-blue-500/10 p-6 rounded-3xl flex items-start space-x-4">
        <Info className="text-blue-500 mt-1 shrink-0" size={20} />
        <div>
            <h5 className="text-sm font-bold text-blue-400">主權插件安全協議</h5>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                所有開啟的技能均受 OpenClaw ACL 指令權限管控。點擊卡片可展開進階參數配置，實現漸進式功能揭露。
            </p>
        </div>
      </div>
    </div>
  );
}
