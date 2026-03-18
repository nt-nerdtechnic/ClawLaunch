// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { MessageSquare, Phone, Bot, Server, Mails, Hash, Shield, MessageCircle, Waves, AlertCircle, Loader2, HelpCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { useStore } from '../../store';
import TerminalLog from '../common/TerminalLog';
import { useOnboardingAction } from '../../hooks/useOnboardingAction';
import { useTranslation } from 'react-i18next';

/**
 * NT-ClawLaunch Onboarding: Messaging Platform Setup Step
 * Ref: Neil's Strategy - "Frictionless Help & Jargon Translation" (2026-03-12)
 * Updated 2026-03-14: Aligned with CLI CHAT_CHANNEL_ORDER
 */

const CHANNEL_OPTIONS = [
  { id: 'telegram', name: 'Telegram', icon: <MessageSquare size={16} />, descKey: 'setupMessaging.channels.telegram.desc', placeholderKey: 'setupMessaging.channels.telegram.placeholder', keyLabelKey: 'setupMessaging.channels.telegram.keyLabel' },
  { id: 'whatsapp', name: 'WhatsApp', icon: <Phone size={16} />, descKey: 'setupMessaging.channels.whatsapp.desc', placeholderKey: 'setupMessaging.channels.whatsapp.placeholder', keyLabelKey: 'setupMessaging.channels.whatsapp.keyLabel', reqKey: false },
  { id: 'discord', name: 'Discord', icon: <Bot size={16} />, descKey: 'setupMessaging.channels.discord.desc', placeholderKey: 'setupMessaging.channels.discord.placeholder', keyLabelKey: 'setupMessaging.channels.discord.keyLabel' },
  { id: 'irc', name: 'IRC', icon: <Server size={16} />, descKey: 'setupMessaging.channels.irc.desc', placeholderKey: 'setupMessaging.channels.irc.placeholder', keyLabelKey: 'setupMessaging.channels.irc.keyLabel', reqKey: false },
  { id: 'googlechat', name: 'Google Chat', icon: <Mails size={16} />, descKey: 'setupMessaging.channels.googlechat.desc', placeholderKey: 'setupMessaging.channels.googlechat.placeholder', keyLabelKey: 'setupMessaging.channels.googlechat.keyLabel' },
  { id: 'slack', name: 'Slack', icon: <Hash size={16} />, descKey: 'setupMessaging.channels.slack.desc', placeholderKey: 'setupMessaging.channels.slack.placeholder', keyLabelKey: 'setupMessaging.channels.slack.keyLabel' },
  { id: 'signal', name: 'Signal', icon: <Shield size={16} />, descKey: 'setupMessaging.channels.signal.desc', placeholderKey: 'setupMessaging.channels.signal.placeholder', keyLabelKey: 'setupMessaging.channels.signal.keyLabel', reqKey: false },
  { id: 'imessage', name: 'iMessage', icon: <MessageCircle size={16} />, descKey: 'setupMessaging.channels.imessage.desc', placeholderKey: 'setupMessaging.channels.imessage.placeholder', keyLabelKey: 'setupMessaging.channels.imessage.keyLabel', reqKey: false },
  { id: 'line', name: 'LINE', icon: <Waves size={16} />, descKey: 'setupMessaging.channels.line.desc', placeholderKey: 'setupMessaging.channels.line.placeholder', keyLabelKey: 'setupMessaging.channels.line.keyLabel' }
];

const SetupStepMessaging = ({ onNext }) => {
  const { t } = useTranslation();
  const { config, setConfig, detectedConfig, userType } = useStore();
  const onboardingAction = useOnboardingAction();
  const [showGuide, setShowGuide] = useState(false);
  const [showFullSetup, setShowFullSetup] = useState(userType === 'new');
  const [localError, setLocalError] = useState('');

  // 初始化：如果偵測到配置且為現有使用者，回填至 config
  useEffect(() => {
    if (userType !== 'new' && detectedConfig?.botToken && !config.botToken) {
        setConfig({ botToken: detectedConfig.botToken });
    }
  }, [config.botToken, detectedConfig?.botToken, setConfig, userType]);

  const handleChannelSelect = (channelId) => {
    setLocalError('');
    setConfig({ platform: channelId, botToken: '' }); // 重設 Token
  };

  const selectedChannel = CHANNEL_OPTIONS.find(c => c.id === config.platform) || CHANNEL_OPTIONS[0];



  const handleNext = async () => {
    const missing = [];
    if (!config.corePath) missing.push(t('setupMessaging.pathNames.core'));
    if (!config.configPath) missing.push(t('setupMessaging.pathNames.config'));
    if (!config.workspacePath) missing.push(t('setupMessaging.pathNames.workspace'));
    if (missing.length > 0) {
      setLocalError(t('setupMessaging.errors.pathRequired', { paths: missing.join(' / ') }));
      return;
    }

    setLocalError('');
    if (selectedChannel.reqKey !== false && !config.botToken) return;
    const success = await onboardingAction.execute('messaging');
    if (success) {
      onNext();
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-left">
      {/* 步驟頭部 */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-green-50 rounded-full text-green-600 mb-4">
          <MessageSquare size={24} />
        </div>
        <h2 className="text-2xl font-bold text-gray-800">
            {(detectedConfig?.botToken || config.botToken) && userType !== 'new' ? t('setupMessaging.titleLocked') : t('setupMessaging.title')}
        </h2>
        <p className="text-gray-500 mt-2 text-sm italic">
            {(detectedConfig?.botToken || config.botToken) && userType !== 'new'
              ? t('setupMessaging.subtitleLocked') 
              : t('setupMessaging.subtitle')}
        </p>
      </div>

      <div className="space-y-6">
        {localError && (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-600 text-[11px] animate-in slide-in-from-top-1">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <p className="font-medium">{localError}</p>
          </div>
        )}

        {/* 配置摘要 (若已有資料) */}
        {config.botToken && !showFullSetup && (
            <div className="p-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl space-y-4 animate-in fade-in zoom-in-95">
                <div className="flex justify-between items-center">
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">
                      {(detectedConfig?.botToken && userType !== 'new') ? t('setupMessaging.detectedConfig') : t('setupMessaging.readyChannel')}
                    </h4>
                    <button 
                        onClick={() => setShowFullSetup(true)}
                        className="text-[10px] font-black text-blue-600 hover:underline"
                    >
                        {t('setupMessaging.reselectChannel')}
                    </button>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                    <p className="text-[9px] text-gray-400 uppercase font-black">{config.platform || t('setupMessaging.platformFallback')} {t('setupMessaging.tokenLabelSuffix')}</p>
                        <div className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] font-black rounded uppercase">{t('setupMessaging.synced')}</div>
                    </div>
                    <p className="text-xs font-mono text-slate-700 break-all">
                        {config.botToken.slice(0, 10)}••••••••{config.botToken.slice(-4)}
                    </p>
                </div>

                {onboardingAction.executing && (
                    <div className="space-y-2 animate-in fade-in duration-300">
                        <div className="flex items-center gap-2 text-[10px] font-black text-emerald-500 uppercase tracking-widest px-1">
                            <Loader2 size={12} className="animate-spin" />
                            {t('setupMessaging.bindingLogs')}
                        </div>
                        <TerminalLog logs={onboardingAction.logs} height="h-32" />
                    </div>
                )}

                {onboardingAction.error && (
                    <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-600 text-[11px] animate-in slide-in-from-top-1">
                        <AlertCircle size={14} className="shrink-0 mt-0.5" />
                        <p className="font-medium">{onboardingAction.error}</p>
                    </div>
                )}

                <button 
                    onClick={handleNext}
                    disabled={onboardingAction.executing}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-emerald-500/20 uppercase tracking-widest text-xs flex items-center justify-center gap-2"
                >
                    {userType === 'existing' ? (
                      <>{t('setupMessaging.actions.confirmContinue')} <ArrowRight size={14} /></>
                    ) : onboardingAction.executing ? (
                      <><Loader2 size={16} className="animate-spin" /> {t('setupMessaging.actions.syncing')}</>
                    ) : (
                      <>{t('setupMessaging.actions.authorizeBond')} <ArrowRight size={14} /></>
                    )}
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
                      {t('setupMessaging.step1')}
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
                                <p className="text-[9px] text-gray-400 font-medium truncate w-full">{t(channel.descKey)}</p>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 第二步：Token / 授權區 */}
                <div className="space-y-3 bg-gray-50 p-4 rounded-3xl border border-gray-100 mt-4">
                    <div className="flex justify-between items-center px-1">
                        <label className="text-sm font-extrabold text-gray-700 flex items-center gap-2 mb-2">
                             <span className="w-5 h-5 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-[10px]">2</span>
                            {t(selectedChannel.keyLabelKey)}
                        </label>
                        {config.platform === 'telegram' && (
                            <button 
                                onClick={() => setShowGuide(true)}
                                className="text-[10px] font-black text-blue-600 hover:text-blue-800 flex items-center gap-1 uppercase tracking-tighter"
                            >
                                <HelpCircle size={12} /> {t('setupMessaging.guideTitle')}
                            </button>
                        )}
                    </div>
                    
                    <div className="relative">
                        <input 
                              type={selectedChannel.reqKey === false || config.platform === 'telegram' ? "text" : "password"}
                            placeholder={t(selectedChannel.placeholderKey)} 
                            value={config.botToken}
                            onChange={(e) => {
                              setLocalError('');
                              setConfig({ botToken: e.target.value });
                            }}
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="none"
                              spellCheck={false}
                            disabled={selectedChannel.reqKey === false}
                            className="w-full p-4 bg-white border border-gray-200 rounded-2xl focus:ring-4 focus:ring-green-500/10 focus:border-green-500/50 outline-none transition-all shadow-sm text-sm font-mono disabled:bg-gray-100 disabled:text-gray-400"
                        />
                    </div>
                    
                    {selectedChannel.reqKey === false && (
                        <div className="pt-2 px-1">
                            <p className="text-[11px] font-black text-emerald-600">
                              {t('setupMessaging.noTokenNeeded')}
                            </p>
                        </div>
                    )}
                </div>

                {/* 下一步按鈕 */}
                <div className="pt-4 space-y-4">
                    {onboardingAction.executing && (
                        <div className="space-y-2 animate-in fade-in duration-300">
                            <div className="flex items-center gap-2 text-[10px] font-black text-emerald-500 uppercase tracking-widest px-1">
                                <Loader2 size={12} className="animate-spin" />
                                {t('setupMessaging.bindingSyncLogs')}
                            </div>
                            <TerminalLog logs={onboardingAction.logs} height="h-32" />
                        </div>
                    )}

                    {onboardingAction.error && (
                        <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-600 text-[11px] animate-in slide-in-from-top-1">
                            <AlertCircle size={14} className="shrink-0 mt-0.5" />
                            <p className="font-medium">{onboardingAction.error}</p>
                        </div>
                    )}

                    <button 
                        onClick={handleNext} 
                        disabled={onboardingAction.executing || (selectedChannel.reqKey !== false && !config.botToken)}
                        className={`w-full flex items-center justify-center gap-2 ${onboardingAction.executing ? 'bg-slate-700' : 'bg-slate-900 hover:bg-slate-800'} disabled:bg-slate-100 disabled:text-slate-300 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-xl shadow-slate-900/10 uppercase tracking-widest text-xs`}
                    >
                        {userType === 'existing' ? (
                          <>{t('setupMessaging.actions.confirmContinue')} <ArrowRight size={18} /></>
                        ) : onboardingAction.executing ? (
                            <>
                            <Loader2 size={18} className="animate-spin" /> {t('setupMessaging.actions.binding')}
                            </>
                        ) : (
                          <>{t('setupMessaging.actions.authorizeBond')} <ArrowRight size={18} /></>
                        )}
                    </button>
                </div>
            </div>
        )}

        {/* 教學彈窗 (Modal Overlay) */}
        {showGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-black text-slate-800">{t('setupMessaging.guide.howToGetTelegram')}</h3>
                <button onClick={() => setShowGuide(false)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-sm font-black shadow-sm">1</div>
                  <p className="text-sm text-gray-600 leading-relaxed font-medium">
                    {t('setupMessaging.guide.step1Prefix')}<span className="font-black bg-gray-100 px-1.5 py-0.5 rounded text-blue-600 mx-1">@BotFather</span>{t('setupMessaging.guide.step1Suffix')}
                  </p>
                </div>
                <div className="flex gap-4">
                  <div className="shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-sm font-black shadow-sm">2</div>
                  <p className="text-sm text-gray-600 leading-relaxed font-medium">
                    {t('setupMessaging.guide.step2Prefix')}<span className="font-black bg-gray-100 px-1.5 py-0.5 rounded mx-1">/newbot</span>{t('setupMessaging.guide.step2Suffix')}
                  </p>
                </div>
                <div className="flex gap-4">
                  <div className="shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-sm font-black shadow-sm">3</div>
                  <p className="text-sm text-gray-600 leading-relaxed font-medium">
                    {t('setupMessaging.guide.step3')}
                  </p>
                </div>
                <div className="bg-emerald-50 p-4 rounded-2xl flex items-start gap-3 border border-emerald-100 mt-4 shadow-inner">
                  <CheckCircle2 size={16} className="text-emerald-500 mt-0.5" />
                  <p className="text-[11px] text-emerald-800 font-bold leading-relaxed">{t('setupMessaging.guide.tip')}</p>
                </div>
              </div>
              <button 
                onClick={() => setShowGuide(false)}
                className="w-full mt-8 py-4 bg-slate-900 text-white rounded-2xl font-black hover:bg-slate-800 shadow-xl transition-all uppercase tracking-widest text-xs"
              >
                {t('setupMessaging.guide.confirm')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SetupStepMessaging;
