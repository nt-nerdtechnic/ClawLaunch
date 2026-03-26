import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface CustomTooltipProps {
  content: string;
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({ content, children, delay = 0.3, className = '' }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [timer, setTimer] = useState<any>(null);

  const handleMouseEnter = () => {
    const t = setTimeout(() => setIsVisible(true), delay * 1000);
    setTimer(t);
  };

  const handleMouseLeave = () => {
    if (timer) clearTimeout(timer);
    setIsVisible(false);
  };

  if (!content) return <>{children}</>;

  return (
    <div 
      className={`relative ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 5 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute z-[100] left-0 top-full mt-2 w-max max-w-[280px]"
          >
            <div className="bg-slate-900 dark:bg-slate-800 text-slate-100 text-[11px] leading-relaxed px-3 py-2 rounded-xl shadow-xl border border-slate-700/50 backdrop-blur-md">
              <div className="absolute -top-1 left-4 w-2 h-2 bg-slate-900 dark:bg-slate-800 border-t border-l border-slate-700/50 rotate-45" />
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
