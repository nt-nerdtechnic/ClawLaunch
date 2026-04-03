import { useState, useRef, useEffect } from 'react';
import { Layers, ChevronDown, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { OFFICE_SCENES } from './engine/scenes';
import { useStore } from '../../store';

export default function ScenePicker() {
  const { t } = useTranslation();
  const officeSceneId = useStore(s => s.officeSceneId);
  const setOfficeSceneId = useStore(s => s.setOfficeSceneId);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const currentScene = OFFICE_SCENES.find(s => s.id === officeSceneId) ?? OFFICE_SCENES[0];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        title={t('pixelOffice.scenes.switchScene', 'Switch Scene')}
      >
        <Layers size={10} />
        <span className="hidden sm:inline">{t(currentScene.labelKey, currentScene.id)}</span>
        <ChevronDown size={8} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[150px] rounded-lg border border-slate-200 bg-white/95 py-1 shadow-lg backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95">
          {OFFICE_SCENES.map(scene => (
            <button
              key={scene.id}
              type="button"
              disabled={!scene.available}
              onClick={() => { setOfficeSceneId(scene.id); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[10px] font-medium transition-colors ${
                scene.available
                  ? 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  : 'cursor-not-allowed text-slate-400 dark:text-slate-600'
              }`}
            >
              <span className="flex-1">{t(scene.labelKey, scene.id)}</span>
              {!scene.available && (
                <span className="rounded bg-slate-100 px-1 py-0.5 text-[8px] font-semibold text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                  {t('pixelOffice.scenes.soon', 'Soon')}
                </span>
              )}
              {scene.available && scene.id === officeSceneId && (
                <Check size={9} className="text-indigo-500 dark:text-indigo-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
