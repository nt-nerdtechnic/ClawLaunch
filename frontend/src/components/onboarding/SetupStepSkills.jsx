import React from 'react';
import { Package, Globe, Brain, Cpu, Shield, Check, ArrowRight, MessageSquare, FileText, Layout, Music, Navigation, Zap } from 'lucide-react';
import { useStore } from '../../store';

/**
 * NT-ClawLaunch Onboarding: Skill Selection Step
 * Ref: Neil's Strategy - "Jargon Translation & Stepper UI" (2026-03-12)
 */
const SetupStepSkills = ({ onNext }) => {
  const { config, toggleSkill, detectedConfig } = useStore();

  const marketplaceSkills = [
    {
      id: 'telegram',
      icon: <MessageSquare size={20} />,
      title: 'Telegram 連結插件',
      desc: 'OpenClaw 最推薦的通訊管道，支援完整的隱私對話與指令互動。',
      color: 'blue',
      recommended: true
    },
    {
      id: 'discord',
      icon: <Globe size={20} />,
      title: 'Discord 連結插件',
      desc: '入駐 Discord 伺服器，支援多頻道協作與複雜權限管理。',
      color: 'blue',
      recommended: true
    },
    {
      id: 'whatsapp',
      icon: <MessageSquare size={20} />,
      title: 'WhatsApp 連結插件',
      desc: '整合 WhatsApp 商業帳號，讓 AI 直接在您的通訊軟體回覆。',
      color: 'green'
    },
    {
      id: 'obsidian',
      icon: <FileText size={20} />,
      title: 'Obsidian 知識庫',
      desc: '同步您的 Obsidian 筆記，讓 AI 具備持久的第二大腦記憶。',
      color: 'purple',
      recommended: true
    },
    {
      id: 'notion',
      icon: <Layout size={20} />,
      title: 'Notion 協同官',
      desc: '自動整理任務並更新頁面，與 Notion 專案深度整合。',
      color: 'gray'
    },
    {
      id: 'goplaces',
      icon: <Navigation size={20} />,
      title: 'Google Maps 探路者',
      desc: '搜尋地點、查詢營業時間與路況，生活機能一把罩。',
      color: 'red'
    }
  ];

  const coreSkills = [
    { name: '網路導航核心 (Browser)', icon: <Globe size={14} /> },
    { name: '開發自動化 (Coding)', icon: <Cpu size={14} /> },
    { name: '系統健康監控 (Monitor)', icon: <Shield size={14} /> }
  ];

  const installedSkills = detectedConfig?.installedSkills || [];
  const selectedSkills = config.enabledSkills || [];

  // 智慧預選：如果初次安裝且沒選過，預選推薦項
  React.useEffect(() => {
    if (selectedSkills.length === 0 && installedSkills.length === 0) {
      marketplaceSkills.filter(s => s.recommended).forEach(s => {
        toggleSkill(s.id);
      });
    }
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
      {/* 步驟頭部 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
            <Package size={20} />
          </div>
          <h2 className="text-2xl font-bold text-gray-800">擴展您的龍蝦超能力</h2>
        </div>
        <p className="text-gray-500">
          從 ClawHub 勾選您想安裝的額外技能{installedSkills.length > 0 && `（已為您偵測到 ${installedSkills.length} 個已安裝技能）`}。
        </p>
      </div>

      {/* 核心狀態面板 */}
      <div className="bg-gray-50/50 border border-gray-100 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
          <Zap size={14} className="text-orange-500" /> 機甲核心 (已預設啟動)
        </div>
        <div className="flex flex-wrap gap-2">
          {coreSkills.map(skill => (
            <div key={skill.name} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-600 shadow-sm">
              {skill.icon} {skill.name}
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full ml-1 animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      {/* 技能矩陣網格 */}
      <div className="grid grid-cols-2 gap-4">
        {marketplaceSkills.map((skill) => {
          const isInstalled = installedSkills.includes(skill.id);
          const isSelected = selectedSkills.includes(skill.id);
          
          return (
            <div 
              key={skill.id}
              onClick={() => toggleSkill(skill.id)}
              className={`p-4 rounded-2xl border-2 cursor-pointer transition-all relative group h-full flex flex-col ${
                isSelected || isInstalled
                  ? 'border-blue-500 bg-blue-50/30' 
                  : 'border-gray-100 hover:border-blue-200'
              }`}
            >
              {/* 選中與安裝標記 */}
              {(isSelected || isInstalled) && (
                <div className="absolute top-3 right-3 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white">
                  <Check size={12} strokeWidth={4} />
                </div>
              )}

              {/* 推薦標籤 */}
              {skill.recommended && !isInstalled && (
                <div className="absolute top-3 right-10 px-1.5 py-0.5 bg-orange-100 text-orange-600 text-[9px] font-bold rounded uppercase">
                  推薦
                </div>
              )}

              <div className={`w-10 h-10 rounded-xl mb-3 flex items-center justify-center ${
                isSelected || isInstalled ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
              }`}>
                {skill.icon}
              </div>
              <h3 className="font-bold text-gray-800 text-sm">{skill.title}</h3>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed flex-grow">
                {skill.desc}
              </p>
              
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-[10px] font-bold text-gray-400">CLAW HUB</span>
                {isInstalled ? (
                  <span className="text-[10px] font-bold text-green-600 uppercase">目前已安裝</span>
                ) : isSelected ? (
                  <span className="text-[10px] font-bold text-blue-600 uppercase">準備安裝</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* 下一步按鈕 */}
      <div className="pt-8 text-center">
        <button 
          onClick={onNext} 
          className="w-full mb-3 flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white font-bold py-3 px-8 rounded-xl transition-all shadow-lg shadow-gray-200"
        >
          最後一步：點火啟動機甲 <ArrowRight size={18} />
        </button>
        <p className="text-[11px] text-gray-400">註：核心技能模組由恩梯科技預設提供，穩定性優先。</p>
      </div>
    </div>
  );
};

export default SetupStepSkills;
