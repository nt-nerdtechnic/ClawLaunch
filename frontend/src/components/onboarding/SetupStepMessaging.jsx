import React, { useState } from 'react';
import { MessageSquare, ExternalLink, HelpCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useStore } from '../../store';

/**
 * NT-ClawLaunch Onboarding: Messaging Platform Setup Step
 * Ref: Neil's Strategy - "Frictionless Help & Jargon Translation" (2026-03-12)
 */
const SetupStepMessaging = ({ onNext }) => {
  const { config, setConfig } = useStore();
  const [showGuide, setShowGuide] = useState(false);

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
      {/* 步驟頭部 */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-green-50 rounded-full text-green-600 mb-4">
          <MessageSquare size={24} />
        </div>
        <h2 className="text-2xl font-bold text-gray-800">連接您的通訊終端</h2>
        <p className="text-gray-500 mt-2">OpenClaw 將透過此管道與您對話並回報進度</p>
      </div>

      <div className="space-y-6">
        {/* 平台選擇 */}
        <div className="flex gap-4 p-1 bg-gray-50 rounded-xl">
          <button
            onClick={() => setConfig({ platform: 'telegram' })}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
              config.platform === 'telegram' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Telegram (推薦)
          </button>
          <button
            onClick={() => setConfig({ platform: 'feishu' })}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
              config.platform === 'feishu' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            飛書 (Feishu)
          </button>
        </div>

        {/* Token 輸入區 */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-semibold text-gray-700">
              {config.platform === 'telegram' ? 'Bot API Token' : 'App ID & Secret'}
            </label>
            <button 
              onClick={() => setShowGuide(true)}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <HelpCircle size={14} /> 查看保姆級教學
            </button>
          </div>
          
          <div className="relative">
            <input 
              type="password" 
              placeholder={config.platform === 'telegram' ? "12345678:ABCDefgh..." : "cli_xxxxxxxx"} 
              value={config.botToken}
              onChange={(e) => setConfig({ botToken: e.target.value })}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
        </div>

        {/* 教學彈窗 (Modal Overlay) */}
        {showGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold">如何獲取 Telegram Token?</h3>
                <button onClick={() => setShowGuide(false)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">1</div>
                  <p className="text-sm text-gray-600">
                    在 Telegram 搜尋 <span className="font-mono bg-gray-100 px-1 rounded text-blue-600">@BotFather</span> 並點擊 Start。
                  </p>
                </div>
                <div className="flex gap-3">
                  <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">2</div>
                  <p className="text-sm text-gray-600">
                    輸入 <span className="font-mono bg-gray-100 px-1 rounded">/newbot</span> 並依照指示為您的龍蝦命名。
                  </p>
                </div>
                <div className="flex gap-3">
                  <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">3</div>
                  <p className="text-sm text-gray-600">
                    完成後，您會收到一串包含數字與字母的 API Token，將其複製貼上即可！
                  </p>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg flex items-start gap-2 border border-blue-100 mt-4">
                  <CheckCircle2 size={16} className="text-blue-500 mt-0.5" />
                  <p className="text-xs text-blue-700">小秘訣：這隻 Bot 將成為您與 OpenClaw 的專屬加密頻道。</p>
                </div>
              </div>
              <button 
                onClick={() => setShowGuide(false)}
                className="w-full mt-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
              >
                我了解了，去填寫
              </button>
            </div>
          </div>
        )}

        {/* 下一步按鈕 */}
        <div className="pt-6">
          <button 
            onClick={onNext} 
            disabled={!config.botToken}
            className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white font-bold py-3 px-8 rounded-xl transition-all"
          >
            下一步：選擇初始化技能 <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SetupStepMessaging;
