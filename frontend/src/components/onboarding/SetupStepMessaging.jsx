import React, { useState } from 'react';
import { MessageSquare, ExternalLink, HelpCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useStore } from '../../store';

/**
 * NT-ClawLaunch Onboarding: Messaging Platform Setup Step
 * Ref: Neil's Strategy - "Frictionless Help & Jargon Translation" (2026-03-12)
 */
const SetupStepMessaging = ({ onNext }) => {
  const { config, setConfig, detectedConfig } = useStore();
  const [showGuide, setShowGuide] = useState(false);
  const [showFullSetup, setShowFullSetup] = useState(false);

  // 初始化：如果偵測到配置且 config 為空，回填至 config
  useState(() => {
    if (detectedConfig?.botToken && !config.botToken) {
        setConfig({ botToken: detectedConfig.botToken });
    }
  });

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
      {/* 步驟頭部 */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-green-50 rounded-full text-green-600 mb-4">
          <MessageSquare size={24} />
        </div>
        <h2 className="text-2xl font-bold text-gray-800">
            {(detectedConfig?.botToken || config.botToken) ? '連線通訊終端終章' : '連接您的通訊終端'}
        </h2>
        <p className="text-gray-500 mt-2 text-sm italic">
            {(detectedConfig?.botToken || config.botToken) 
              ? '「通訊頻率已對準，即將完成最後校驗...」' 
              : 'OpenClaw 將透過此管道與您對話並回報進度'}
        </p>
      </div>

      <div className="space-y-6">
        {/* 配置摘要 (若已有資料) */}
        {config.botToken && !showFullSetup && (
            <div className="p-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl space-y-4 animate-in fade-in zoom-in-95">
                <div className="flex justify-between items-center">
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">
                        {(detectedConfig?.botToken || config.botToken) ? '偵測到的通訊配置' : '準備對接的終端'}
                    </h4>
                    <button 
                        onClick={() => setShowFullSetup(true)}
                        className="text-[10px] font-black text-blue-600 hover:underline"
                    >
                        切換其他頻道
                    </button>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] text-gray-400 uppercase font-black">Telegram Bot Token</p>
                        <div className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] font-black rounded uppercase">已對位</div>
                    </div>
                    <p className="text-xs font-mono text-slate-700 break-all">
                        {config.botToken.slice(0, 10)}••••••••{config.botToken.slice(-4)}
                    </p>
                </div>
                <button 
                    onClick={onNext}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3.5 rounded-2xl transition-all shadow-xl shadow-emerald-500/20 uppercase tracking-widest text-xs flex items-center justify-center gap-2"
                >
                    完成最後對接：啟動機甲 <ArrowRight size={14} />
                </button>
            </div>
        )}

        {/* 手動輸入區 (僅在需要修改或無資料時顯示) */}
        {(showFullSetup || !config.botToken) && (
            <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
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
                    <div className="flex justify-between items-center px-1">
                        <label className="text-sm font-extrabold text-gray-700 flex items-center gap-2">
                        {config.platform === 'telegram' ? 'Bot API Token' : 'App ID & Secret'}
                        </label>
                        <button 
                        onClick={() => setShowGuide(true)}
                        className="text-[10px] font-black text-blue-600 hover:text-blue-800 flex items-center gap-1 uppercase tracking-tighter"
                        >
                        <HelpCircle size={12} /> 教學攻略
                        </button>
                    </div>
                    
                    <div className="relative">
                        <input 
                        type="password" 
                        placeholder={config.platform === 'telegram' ? "12345678:ABCDefgh..." : "cli_xxxxxxxx"} 
                        value={config.botToken}
                        onChange={(e) => setConfig({ botToken: e.target.value })}
                        className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-inner text-sm font-mono"
                        />
                    </div>
                </div>

                {/* 下一步按鈕 */}
                <div className="pt-6">
                <button 
                    onClick={onNext} 
                    disabled={!config.botToken}
                    className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:bg-gray-200 disabled:text-gray-400 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-xl shadow-slate-900/10 uppercase tracking-widest text-xs"
                >
                    確認終端：進入最後準備 <ArrowRight size={18} />
                </button>
                </div>
            </div>
        )}

        {/* 教學彈窗 (Modal Overlay) */}
        {showGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-black text-slate-800">如何獲取 Telegram Token?</h3>
                <button onClick={() => setShowGuide(false)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-sm font-black shadow-sm">1</div>
                  <p className="text-sm text-gray-600 leading-relaxed font-medium">
                    在 Telegram 搜尋 <span className="font-black bg-gray-100 px-1.5 py-0.5 rounded text-blue-600 mx-1">@BotFather</span> 並點擊 Start。
                  </p>
                </div>
                <div className="flex gap-4">
                  <div className="shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-sm font-black shadow-sm">2</div>
                  <p className="text-sm text-gray-600 leading-relaxed font-medium">
                    發送指令 <span className="font-black bg-gray-100 px-1.5 py-0.5 rounded mx-1">/newbot</span> 並依照指示為您的龍蝦命名（需以 _bot 結尾）。
                  </p>
                </div>
                <div className="flex gap-4">
                  <div className="shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-sm font-black shadow-sm">3</div>
                  <p className="text-sm text-gray-600 leading-relaxed font-medium">
                    完成後，BotFather 會給您一串 API Token。**請務必妥善保管，切勿外流**。
                  </p>
                </div>
                <div className="bg-emerald-50 p-4 rounded-2xl flex items-start gap-3 border border-emerald-100 mt-4 shadow-inner">
                  <CheckCircle2 size={16} className="text-emerald-500 mt-0.5" />
                  <p className="text-[11px] text-emerald-800 font-bold leading-relaxed">小秘訣：這隻 Bot 將成為您與 OpenClaw 的專屬加密頻道，所有的分析回報都將在此進行。</p>
                </div>
              </div>
              <button 
                onClick={() => setShowGuide(false)}
                className="w-full mt-8 py-4 bg-slate-900 text-white rounded-2xl font-black hover:bg-slate-800 shadow-xl transition-all uppercase tracking-widest text-xs"
              >
                我了解了，去填寫
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SetupStepMessaging;
