import React from 'react';
import { Package, Globe, Brain, Cpu, Shield, Check, ArrowRight } from 'lucide-react';
import { useStore } from '../../store';

/**
 * NT-ClawLaunch Onboarding: Skill Selection Step
 * Ref: Neil's Strategy - "Jargon Translation & Stepper UI" (2026-03-12)
 */
const SetupStepSkills = ({ onNext }) => {
  const { config, toggleSkill } = useStore();

  const skills = [
    {
      id: 'browser-automation',
      icon: <Globe size={20} />,
      title: '網路導航員 (Browser)',
      desc: '具備自主識別與操作瀏覽器的能力，能完成查詢、訂購甚至複雜網頁自動化。',
      color: 'blue'
    },
    {
      id: 'coding-agent',
      icon: <Cpu size={20} />,
      title: '開發自動化 (Coding)',
      desc: '整合 Codex 與 Claude Code，能自主進行代碼編寫、審查與修復 Bug。',
      color: 'orange'
    },
    {
      id: 'healthcheck',
      icon: <Shield size={20} />,
      title: '系統監控官 (Monitor)',
      desc: '即時監控機甲狀態（如 Port 衝突、DB 連網），具備自主診斷與自癒能力。',
      color: 'red'
    },
    {
      id: 'memory-compactor',
      icon: <Brain size={20} />,
      title: '長效脈絡記憶 (Memory)',
      desc: '智慧壓縮並跨 session 保持您的偏好與工作記憶，越用越聰明。',
      color: 'purple'
    },
    {
      id: 'task-manager',
      icon: <Package size={20} />,
      title: '任務協調官 (Tasks)',
      desc: '管理並跟蹤多線程任務進度，確保異步工作流程能按時回報。',
      color: 'green'
    },
    {
      id: 'nt-safe-evolution-architect',
      icon: <Shield size={20} />,
      title: '安全演進架構 (Safety)',
      desc: '核心演進的守護者，確保每一次技能加載與系統變更都符合安全規範。',
      color: 'gray'
    }
  ];

  const selectedSkills = config.enabledSkills || [];

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
      {/* 步驟頭部 */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-orange-50 rounded-full text-orange-600 mb-4">
          <Package size={24} />
        </div>
        <h2 className="text-2xl font-bold text-gray-800">賦予您的龍蝦超能力</h2>
        <p className="text-gray-500 mt-2">勾選您希望 OpenClaw 具備的初始技能（隨時可修改）</p>
      </div>

      {/* 技能矩陣網格 */}
      <div className="grid grid-cols-2 gap-4">
        {skills.map((skill) => (
          <div 
            key={skill.id}
            onClick={() => toggleSkill(skill.id)}
            className={`p-4 rounded-2xl border-2 cursor-pointer transition-all relative group ${
              selectedSkills.includes(skill.id) 
                ? 'border-blue-500 bg-blue-50/30' 
                : 'border-gray-100 hover:border-blue-200'
            }`}
          >
            {/* 選中標記 */}
            {selectedSkills.includes(skill.id) && (
              <div className="absolute top-3 right-3 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white">
                <Check size={12} strokeWidth={4} />
              </div>
            )}

            <div className={`w-10 h-10 rounded-xl mb-3 flex items-center justify-center ${
              selectedSkills.includes(skill.id) ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
            }`}>
              {skill.icon}
            </div>
            <h3 className="font-bold text-gray-800 text-sm">{skill.title}</h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              {skill.desc}
            </p>
          </div>
        ))}
      </div>

      {/* 下一步按鈕 */}
      <div className="pt-8">
        <button 
          onClick={onNext} 
          disabled={selectedSkills.length === 0}
          className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white font-bold py-3 px-8 rounded-xl transition-all shadow-lg shadow-gray-200"
        >
          最後一步：啟動我的 OpenClaw <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
};

export default SetupStepSkills;
