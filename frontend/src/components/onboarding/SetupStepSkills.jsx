import React, { useState } from 'react';
import { Package, Globe, Brain, Cpu, Music, Shield, Check, ArrowRight } from 'lucide-react';

/**
 * NT-ClawLaunch Onboarding: Skill Selection Step
 * Ref: Neil's Strategy - "Jargon Translation & Stepper UI" (2026-03-12)
 */
const SetupStepSkills = ({ onNext }) => {
  const [selectedSkills, setSelectedSkills] = useState(['browser', 'memory']);

  const skills = [
    {
      id: 'browser',
      icon: <Globe size={20} />,
      title: '網路導航員 (Browser)',
      desc: '讓 AI 能上網查資料、操作瀏覽器，甚至是幫您訂機票。',
      color: 'blue'
    },
    {
      id: 'memory',
      icon: <Brain size={20} />,
      title: '長效記憶系統 (Memory)',
      desc: '記住您的偏好、過去的對話與工作習慣，越聊越懂您。',
      color: 'purple'
    },
    {
      id: 'system',
      icon: <Cpu size={20} />,
      title: '系統工程師 (Core)',
      desc: '具備執行終端機代碼、管理檔案與自動化指令的能力。',
      color: 'orange'
    },
    {
      id: 'security',
      icon: <Shield size={20} />,
      title: '治安哨兵 (Security)',
      desc: '實時監控系統安全，防止惡意攻擊與敏感資料外洩。',
      color: 'red'
    },
    {
      id: 'voice',
      icon: <Music size={20} />,
      title: '語音中樞 (Voice)',
      desc: '支援語音對談、語音轉文字，像真人一樣與您交流。',
      color: 'green'
    },
    {
      id: 'custom',
      icon: <Package size={20} />,
      title: '擴展技能庫 (Plugins)',
      desc: '未來可隨時從 ClawHub 下載更多行業專屬技能。',
      color: 'gray'
    }
  ];

  const toggleSkill = (id) => {
    if (selectedSkills.includes(id)) {
      setSelectedSkills(selectedSkills.filter(s => s !== id));
    } else {
      setSelectedSkills([...selectedSkills, id]);
    }
  };

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
