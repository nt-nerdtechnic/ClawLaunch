import React, { useEffect, useRef } from 'react';

interface LogEntry {
  text: string;
  source: string;
  time?: string;
}

interface TerminalLogProps {
  logs: LogEntry[];
  height?: string;
  title?: string;
  showControls?: boolean;
    timeline?: Array<{ id: string; level: 'info' | 'warn' | 'action-required'; source: string; message: string; timestamp: string }>;
    dailyDigest?: string;
}

/**
 * TerminalLog: A reusable integrated terminal component.
 * Displays real-time logs from the Electron backend.
 */
const TerminalLog: React.FC<TerminalLogProps> = ({ logs, height = 'h-40', title = 'Terminal Output', showControls = true, timeline = [], dailyDigest = '' }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const formatTime = (value?: string) => {
        if (!value) return '--:--:--';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '--:--:--';
        return date.toLocaleTimeString();
    };

    // Auto-scroll to bottom when logs update
    useEffect(() => {
        if (!containerRef.current) return;
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }, [logs]);

    const handleLinkClick = (url: string) => {
        if (window.electronAPI && window.electronAPI.openExternal) {
            window.electronAPI.openExternal(url);
        } else {
            window.open(url, '_blank');
        }
    };

    const renderTextWithLinks = (text: unknown) => {
        let normalizedText = '';
        if (typeof text !== 'string') {
            try {
                normalizedText = JSON.stringify(text);
            } catch (e) {
                normalizedText = String(text || '');
            }
        } else {
            normalizedText = text;
        }
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const parts = normalizedText.split(urlRegex);
        
        return parts.map((part: string, i: number) => {
            if (part.match(urlRegex)) {
                return (
                    <span 
                        key={i} 
                        onClick={() => handleLinkClick(part)}
                        className="text-blue-400 hover:text-blue-300 underline cursor-pointer transition-colors font-bold"
                    >
                        {part}
                    </span>
                );
            }
            return <span key={i}>{part}</span>;
        });
    };

    return (
        <div ref={containerRef} className={`bg-[#020617] rounded-3xl p-4 font-mono text-[11px] text-slate-300 ${height} overflow-y-auto border border-slate-800 shadow-2xl relative group`}>
            {/* Header / Mac-style buttons */}
            {showControls && (
                <div className="sticky top-0 right-0 flex justify-between items-center mb-2 z-10 bg-[#020617]/90 backdrop-blur-md py-1">
                    <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest px-2">{title}</span>
                    <div className="flex items-center gap-1.5 px-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-rose-500/30 group-hover:bg-rose-500 transition-colors" />
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-500/30 group-hover:bg-amber-500 transition-colors" />
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/30 group-hover:bg-emerald-500 transition-colors" />
                    </div>
                </div>
            )}

            {dailyDigest && (
                <div className="mb-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Daily Digest</div>
                    <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-300">{dailyDigest}</pre>
                </div>
            )}

            {timeline.length > 0 && (
                <div className="mb-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Audit Timeline</div>
                    <div className="max-h-40 overflow-y-auto space-y-1.5">
                        {timeline.slice(-20).map((item) => (
                            <div key={item.id} className="text-[11px] leading-relaxed">
                                <span className="text-slate-500">[{formatTime(item.timestamp)}]</span>{' '}
                                <span className={item.level === 'action-required' ? 'text-rose-400' : item.level === 'warn' ? 'text-amber-400' : 'text-blue-400'}>{item.level}</span>{' '}
                                <span className="text-slate-400">({item.source})</span>{' '}
                                <span className="text-slate-200">{item.message}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Log Content */}
            <div className="space-y-1.5 px-2">
                {logs.length > 0 ? (
                    logs.map((log, i) => {
                        const entry = log && typeof log === 'object'
                            ? log
                            : ({ text: String(log ?? ''), source: 'stdout' } as LogEntry);
                        const source = String((entry as any).source || 'stdout');
                        const time = typeof (entry as any).time === 'string' && (entry as any).time
                            ? (entry as any).time
                            : new Date().toLocaleTimeString();

                        return (
                            <div key={i} className="flex gap-4 group/line">
                                <span className="opacity-20 shrink-0 select-none group-hover/line:opacity-50 transition-opacity">
                                    [{time}]
                                </span>
                                <span className={`break-all leading-relaxed ${
                                    source === 'stderr' ? 'text-rose-400' : 
                                    source === 'system' ? 'text-blue-400' : 
                                    'text-slate-300'
                                }`}>
                                    {renderTextWithLinks((entry as any).text)}
                                </span>
                            </div>
                        );
                    })
                ) : (
                    <div className="h-full flex items-center justify-center text-slate-700 italic py-8 border-2 border-dashed border-slate-800/50 rounded-2xl">
                        Waiting for soul core signal...
                    </div>
                )}
            </div>

            {/* Gradient Overlay for aesthetic fade */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#020617] to-transparent" />
        </div>
    );
};

export default TerminalLog;
