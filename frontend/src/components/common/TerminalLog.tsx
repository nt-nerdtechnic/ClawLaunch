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
}

/**
 * TerminalLog: A reusable integrated terminal component.
 * Displays real-time logs from the Electron backend.
 */
const TerminalLog: React.FC<TerminalLogProps> = ({ logs, height = 'h-40', title = 'Terminal Output', showControls = true }) => {
    const logEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when logs update
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const handleLinkClick = (url: string) => {
        if (window.electronAPI && window.electronAPI.openExternal) {
            window.electronAPI.openExternal(url);
        } else {
            window.open(url, '_blank');
        }
    };

    const renderTextWithLinks = (text: string) => {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const parts = text.split(urlRegex);
        
        return parts.map((part, i) => {
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
        <div className={`bg-[#020617] rounded-3xl p-4 font-mono text-[11px] text-slate-300 ${height} overflow-y-auto border border-slate-800 shadow-2xl relative group`}>
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

            {/* Log Content */}
            <div className="space-y-1.5 px-2">
                {logs.length > 0 ? (
                    logs.map((log, i) => (
                        <div key={i} className="flex gap-4 group/line">
                            <span className="opacity-20 shrink-0 select-none group-hover/line:opacity-50 transition-opacity">
                                [{log.time || new Date().toLocaleTimeString()}]
                            </span>
                            <span className={`break-all leading-relaxed ${
                                log.source === 'stderr' ? 'text-rose-400' : 
                                log.source === 'system' ? 'text-blue-400' : 
                                'text-slate-300'
                            }`}>
                                {renderTextWithLinks(log.text)}
                            </span>
                        </div>
                    ))
                ) : (
                    <div className="h-full flex items-center justify-center text-slate-700 italic py-8 border-2 border-dashed border-slate-800/50 rounded-2xl">
                        Waiting for soul core signal...
                    </div>
                )}
                <div ref={logEndRef} />
            </div>

            {/* Gradient Overlay for aesthetic fade */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#020617] to-transparent" />
        </div>
    );
};

export default TerminalLog;
