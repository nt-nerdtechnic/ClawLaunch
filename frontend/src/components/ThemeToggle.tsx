import { Sun, Moon } from 'lucide-react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';

export function ThemeToggle() {
  const { theme, setTheme } = useStore();

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <button
      onClick={toggleTheme}
      className="relative w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center cursor-pointer hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors overflow-hidden"
      aria-label="Toggle theme"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={theme}
          initial={{ y: 20, opacity: 0, rotate: 45 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: -20, opacity: 0, rotate: -45 }}
          transition={{ duration: 0.2 }}
        >
          {theme === 'dark' ? (
            <Moon size={18} className="text-blue-400" />
          ) : (
            <Sun size={18} className="text-amber-500" />
          )}
        </motion.div>
      </AnimatePresence>
    </button>
  );
}
