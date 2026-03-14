import React, { useState } from 'react';
import { MessageSquare, ExternalLink, HelpCircle, ArrowRight, CheckCircle2, Bot, Server, Hash, Mails, Waves, Shield, MessageCircle, Phone } from 'lucide-react';
import { useStore } from '../../store';

/**
 * NT-ClawLaunch Onboarding: Messaging Platform Setup Step
 * Ref: Neil's Strategy - "Frictionless Help & Jargon Translation" (2026-03-12)
 * Updated 2026-03-14: Aligned with CLI CHAT_CHANNEL_ORDER
 */

const CHANNEL_OPTIONS = [
  { id: 'telegram', name: 'Telegram', icon: <MessageSquare size={16} />, desc: 'Bot API， 最推薦的加密頻道', placeholder: '12345678:ABCDefgh...', keyLabel: 'Bot API Token' },
  { id: 'whatsapp', name: 'WhatsApp', icon: <Phone size={16} />, desc: 'WhatsApp Web QR 連結模式', placeholder: '無須輸入，稍後掃描 QR Code', keyLabel: 'WhatsApp Account ID (可選留空)', reqKey: false },
  { id: 'discord', name: 'Discord', icon: <Bot size={16} />, desc: '穩定支援的 Bot API', placeholder: 'Discord Bot Token...', keyLabel: 'Bot Token' },
  { id: 'irc', name: 'IRC', icon: <Server size={16} />, desc: '連線至傳統 IRC 伺服器網域', placeholder: 'irc.libera.chat:6697...', keyLabel: 'IRC Server / Nick (稍後詳細設定)', reqKey: false },
  { id: 'googlechat', name: 'Google Chat', icon: <Mails size={16} />, desc: 'Google Workspace Webhook', placeholder: 'Google Chat Webhook URL...', keyLabel: 'Webhook URL' },
  { id: 'slack', name: 'Slack', icon: <Hash size={16} />, desc: '原生 Socket Mode 支援', placeholder: 'xoxb-xxxx-xxxx...', keyLabel: 'Bot Token' },
  { id: 'signal', name: 'Signal', icon: <Shield size={16} />, desc: '透過 signal-cli 連接，高隱私', placeholder: 'Signal REST API URL 或留空', keyLabel: 'Signal Config (稍後詳細設定)', reqKey: false },
  { id: 'imessage', name: 'iMessage', icon: <MessageCircle size={16} />, desc: '實驗性支援 (imsg)', placeholder: '稍後設定', keyLabel: 'iMessage ID (稍後詳細設定)', reqKey: false },
  { id: 'line', name: 'LINE', icon: <Waves size={16} />, desc: 'LINE Messaging API Webhook', placeholder: 'LINE Channel Access Token...', keyLabel: 'Channel Access Token' }
];

const SetupStepMessaging = ({ onNext }) => {
  const { config, setConfig, detectedConfig, userType } = useStore();
  const [showGuide, setShowGuide] = useState(false);
  const [showFullSetup, setShowFullSetup] = useState(userType === 'new');

  // 初始化：如果偵測到配置且為現有使用者，回填至 config
  useState(() => {
    if (userType !== 'new' && detectedConfig?.botToken && !config.botToken) {
        setConfig({ botToken: detectedConfig.botToken });
    }
  });

  const handleChannelSelect = (channelId) => {
    setConfig({ platform: channelId, botToken: '' }); // 重設 Token
  };

  const selectedChannel = CHANNEL_OPTIONS.find(c => c.id === config.platform) || CHANNEL_OPTIONS[0];

  const handleNext = () => {
    // 即使有些不需要 key，我們也允許通過，將由 CLI 接手詳細設定
    onNext();
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-left">
      {/* 步驟頭部 */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-green-50 rounded-full text-green-600 mb-4">
          <MessageSquare size={24} />
        </div>
        <h2 className="text-2xl font-bold text-gray-800">
            {(detectedConfig?.botToken || config.botToken) && userType !== 'new' ? '通訊頻率已鎖定' : '繫結您的通訊頻道 (Bonding Channel)'}
        </h2>
        <p className="text-gray-500 mt-2 text-sm italic">
            {(detectedConfig?.botToken || config.botToken) && userType !== 'new'
              ? '「機甲通訊模組已就緒，等待最後指令...」' 
              : 'OpenClaw 需要一個加密頻道與您建立心靈感應'}
        </p>
      </div>

      <div className="space-y-6">
        {/* 配置摘要 (若已有資料) */}
        {config.botToken && !showFullSetup && (
            <div className="p-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl space-y-4 animate-in fade-in zoom-in-95">
                <div className="flex justify-between items-center">
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">
                        {(detectedConfig?.botToken && userType !== 'new') ? '偵測到的通訊配置' : '準備繫結的頻道'}
                    </h4>
                    <button 
                        onClick={() => setShowFullSetup(true)}
                        className="text-[10px] font-black text-blue-600 hover:underline"
                    >
                        重新選擇頻道
                    </button>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] text-gray-400 uppercase font-black">{config.platform || 'Telegram'} Token</p>
                        <div className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] font-black rounded uppercase">已同步</div>
                    </div>
                    <p className="text-xs font-mono text-slate-700 break-all">
                        {config.botToken.slice(0, 10)}••••••••{config.botToken.slice(-4)}
                    </p>
                </div>
                <button 
                    onClick={onNext}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-emerald-500/20 uppercase tracking-widest text-xs flex items-center justify-center gap-2"
                >
                    授權並繫結頻道 (Authorize & Bond) <ArrowRight size={14} />
                </button>
            </div>
        )}

        {/* 手動輸入區 (僅在需要修改或無資料時顯示) */}
        {(showFullSetup || (!config.botToken && config.platform !== 'whatsapp' && config.platform !== 'irc' && config.platform !== 'signal' && config.platform !== 'imessage')) && (
            <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
                
                {/* 第一步：選擇通訊頻道 */}
                <div className="space-y-3">
                     <label className="text-sm font-extrabold text-gray-700 flex items-center gap-2">
                        <span className="w-5 h-5 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-[10px]">1</span>
                        選擇對接頻道 (Channel)
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {CHANNEL_OPTIONS.map(channel => (
                            <button
                                key={channel.id}
                                onClick={() => handleChannelSelect(channel.id)}
                                className={`p-3 rounded-2xl border-2 text-left transition-all flex flex-col items-start gap-1 ${
                                config.platform === channel.id ? 'border-green-500 bg-green-50/50 shadow-sm' : 'border-gray-100 hover:border-green-200 bg-white'
                                }`}
                            >
                                <div className={`w-6 h-6 rounded-lg flex items-center justify-center mb-1 ${config.platform === channel.id ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                                    {channel.icon}
                                </div>
                                <h3 className={`font-black text-[11px] ${config.platform === channel.id ? 'text-green-900' : 'text-gray-700'}`}>{channel.name}</h3>
                                <p className="text-[9px] text-gray-400 font-medium truncate w-full">{channel.desc}</p>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 第二步：Token / 授權區 */}
                <div className="space-y-3 bg-gray-50 p-4 rounded-3xl border border-gray-100 mt-4">
                    <div className="flex justify-between items-center px-1">
                        <label className="text-sm font-extrabold text-gray-700 flex items-center gap-2 mb-2">
                             <span className="w-5 h-5 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-[10px]">2</span>
                            {selectedChannel.keyLabel}
                        </label>
                        {config.platform === 'telegram' && (
                            <button 
                                onClick={() => setShowGuide(true)}
                                className="text-[10px] font-black text-blue-600 hover:text-blue-800 flex items-center gap-1 uppercase tracking-tighter"
                            >
                                <HelpCircle size={12} /> 教學攻略
                            </button>
                        )}
                    </div>
                    
                    <div className="relative">
                        <input 
                            type={selectedChannel.reqKey === false ? "text" : "password"}
                            placeholder={selectedChannel.placeholder} 
                            value={config.botToken}
                            onChange={(e) => setConfig({ botToken: e.target.value })}
                            disabled={selectedChannel.reqKey === false}
                            className="w-full p-4 bg-white border border-gray-200 rounded-2xl focus:ring-4 focus:ring-green-500/10 focus:border-green-500/50 outline-none transition-all shadow-sm text-sm font-mono disabled:bg-gray-100 disabled:text-gray-400"
                        />
                    </div>
                    
                    {selectedChannel.reqKey === false && (
                        <div className="pt-2 px-1">
                            <p className="text-[11px] font-black text-emerald-600">
                                ✓ 此頻道無須在此輸入 Token。在稍後的「核心發射」階段，CLI 將自動引導您完成互動式認證登入程序。
                            </p>
                        </div>
                    )}
                </div>

                {/* 下一步按鈕 */}
                <div className="pt-4">
                <button 
                    onClick={handleNext} 
                    disabled={selectedChannel.reqKey !== false && !config.botToken}
                    className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-100 disabled:text-slate-300 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-xl shadow-slate-900/10 uppercase tracking-widest text-xs"
                >
                    授權並繫結頻道 (Authorize & Bond) <ArrowRight size={18} />
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
