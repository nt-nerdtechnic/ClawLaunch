import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface CustomTooltipProps {
  content: string;
  children: React.ReactNode;
  delay?: number;
  className?: string;
  position?: 'left' | 'right';
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({ 
  content, 
  children, 
  delay = 0.3, 
  className = '',
  position = 'left' 
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [timer, setTimer] = useState<any>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });

  const handleMouseEnter = () => {
    const t = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setCoords({
          top: rect.bottom,
          left: rect.left,
          width: rect.width
        });
      }
      setIsVisible(true);
    }, delay * 1000);
    setTimer(t);
  };

  const handleMouseLeave = () => {
    if (timer) clearTimeout(timer);
    setIsVisible(false);
  };

  if (!content) return <>{children}</>;

  // Tooltip content rendered via Portal
  const tooltipContent = (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 5 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            top: coords.top + 8,
            left: position === 'right' 
              ? Math.max(8, coords.left + coords.width - 320)
              : Math.min(window.innerWidth - 320 - 8, coords.left),
            zIndex: 9999,
          }}
          className="pointer-events-none w-max max-w-[320px]"
        >
          <div className="bg-slate-900 dark:bg-slate-800 text-slate-100 text-[11px] leading-relaxed px-3 py-2 rounded-xl shadow-2xl border border-slate-700/50 backdrop-blur-md">
            {/* Arrow */}
            <div 
              className="absolute -top-1 w-2 h-2 bg-slate-900 dark:bg-slate-800 border-t border-l border-slate-700/50 rotate-45"
              style={{
                left: position === 'right' ? 'calc(100% - 24px)' : '16px'
              }}
            />
            {content}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div 
      ref={triggerRef}
      className={`relative inline-block ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {createPortal(tooltipContent, document.body)}
    </div>
  );
};
